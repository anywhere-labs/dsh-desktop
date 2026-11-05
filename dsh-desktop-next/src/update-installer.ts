/** Native installer handoff with explicit user-visible progress on Windows and macOS. */
import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export const NEXT_APP_ID = 'ai.deepseek.dsh.desktop.next'

const MAC_PROGRESS_UI_SCRIPT = `
ObjC.import("Cocoa");
const app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
const env = $.NSProcessInfo.processInfo.environment;
const title = ObjC.unwrap(env.objectForKey("DSH_UPDATE_TITLE")) || "DSH NEXT";
const message = ObjC.unwrap(env.objectForKey("DSH_UPDATE_MESSAGE")) || "Updating DSH NEXT…";
const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer($.NSMakeRect(0, 0, 380, 110), $.NSTitledWindowMask, $.NSBackingStoreBuffered, false);
win.setTitle($(title));
win.setLevel($.NSFloatingWindowLevel);
win.setReleasedWhenClosed(false);
const content = win.contentView;
const label = $.NSTextField.alloc.initWithFrame($.NSMakeRect(24, 58, 332, 24));
label.setStringValue($(message));
label.setBezeled(false);
label.setDrawsBackground(false);
label.setEditable(false);
label.setSelectable(false);
label.setFont($.NSFont.systemFontOfSize(13));
content.addSubview(label);
const bar = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect(24, 28, 332, 20));
bar.setStyle($.NSProgressIndicatorBarStyle);
bar.setIndeterminate(true);
bar.startAnimation(null);
content.addSubview(bar);
win.center;
win.makeKeyAndOrderFront(null);
app.activateIgnoringOtherApps(true);
app.run;
`

export const MAC_UPDATE_SCRIPT = [
  '/usr/bin/osascript -l JavaScript -e "$DSH_UPDATE_UI_SCRIPT" >/dev/null 2>&1 &',
  'UI_PID=$!',
  'cleanup() { kill "$UI_PID" 2>/dev/null || true; }',
  'trap cleanup EXIT',
  'i=0',
  'while kill -0 "$DSH_UPDATE_PID" 2>/dev/null; do',
  '  i=$((i + 1))',
  '  [ "$i" -ge 150 ] && exit 1',
  '  sleep 0.2',
  'done',
  'BACKUP="${DSH_UPDATE_INSTALLED}.backup-$$"',
  'rm -rf "$BACKUP"',
  'mv "$DSH_UPDATE_INSTALLED" "$BACKUP" || exit 1',
  'if mv "$DSH_UPDATE_STAGED" "$DSH_UPDATE_INSTALLED" 2>/dev/null || /usr/bin/ditto "$DSH_UPDATE_STAGED" "$DSH_UPDATE_INSTALLED"; then',
  '  rm -rf "$BACKUP" "$DSH_UPDATE_DIR"',
  'else',
  '  rm -rf "$DSH_UPDATE_INSTALLED"',
  '  mv "$BACKUP" "$DSH_UPDATE_INSTALLED"',
  '  cleanup',
  '  /usr/bin/open "$DSH_UPDATE_INSTALLED"',
  '  exit 1',
  'fi',
  '/usr/bin/xattr -dr com.apple.quarantine "$DSH_UPDATE_INSTALLED" 2>/dev/null || true',
  'sleep 0.8',
  'cleanup',
  '/usr/bin/open "$DSH_UPDATE_INSTALLED" --args --updated',
].join('\n')

/** Check both bundle identity and embedded SemVer before validating the signature. */
export function assertNextMacBundle(identifier: string, manifest: unknown, version: string): void {
  if (identifier.trim() !== NEXT_APP_ID || !manifest || typeof manifest !== 'object'
    || (manifest as { name?: unknown }).name !== 'dsh-desktop-next' || (manifest as { version?: unknown }).version !== version) {
    throw new Error('The downloaded application does not match this Next release')
  }
}

export function assertNextWindowsInstaller(info: { ProductName?: unknown; ProductVersion?: unknown }, version: string): void {
  if (info.ProductName !== 'DSH NEXT' || info.ProductVersion !== version) throw new Error('The installer does not match this Next release')
}

export class NextUpdateInstaller {
  private prepared?: { path: string; version: string; directory?: string; bundle?: string; installed?: string }
  private nativeReady = false
  constructor(private readonly options: { platform: string; executable: string; language?: () => string; log(error: unknown): void }) {}
  async prepare(path: string, version: string, directory: string, signal: AbortSignal): Promise<void> {
    this.prepared = undefined; this.nativeReady = false
    if (this.options.platform === 'win32') {
      const script = '$ErrorActionPreference="Stop"; (Get-Item -LiteralPath $env:DSH_UPDATE_INSTALLER).VersionInfo | Select-Object ProductName,ProductVersion | ConvertTo-Json -Compress'
      const info = await execute(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
        { signal, timeout: 30_000, windowsHide: true, env: { ...process.env, DSH_UPDATE_INSTALLER: path }, maxBuffer: 16_384 })
      assertNextWindowsInstaller(JSON.parse(info.stdout.replace(/^\uFEFF/, '')), version)
      this.prepared = { path, version }; return
    }
    if (this.options.platform !== 'darwin') throw new Error('Unsupported update platform')
    const mount = join(directory, 'volume'); await mkdir(mount, { mode: 0o700 })
    const run = (file: string, args: string[]) => execute(file, args, { signal, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 })
    const installed = dirname(dirname(dirname(this.options.executable)))
    if (!installed.endsWith('.app')) throw new Error('Invalid installed Next application bundle')
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', installed])
    let attached = false
    try {
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, path]); attached = true
      const entries = await readdir(mount, { withFileTypes: true })
      const apps = entries.filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
      if (apps.length !== 1) throw new Error('Expected one application in the Next disk image')
      const bundle = join(mount, apps[0]!.name)
      const info = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', join(bundle, 'Contents', 'Info.plist')])
      // Releases through 2.0.17-next shipped the application unpacked, and every shipped updater reads the manifest
      // at that location. Archived releases keep a byte-for-byte copy of the archived manifest there as an extra
      // resource (`build.mac.extraResources`, checked by scripts/packaged-payload.ts) so that they all accept them.
      const manifestPath = join(bundle, 'Contents', 'Resources', 'app', 'package.json')
      const meta = await lstat(manifestPath)
      if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 128 * 1024) throw new Error('Invalid Next application manifest')
      assertNextMacBundle(info.stdout, JSON.parse(await readFile(manifestPath, 'utf8')), version)
      await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle])
      const installedSignature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', installed])
      const candidateSignature = await run('/usr/bin/codesign', ['-dv', '--verbose=4', bundle])
      const team = /^TeamIdentifier=([A-Z0-9]+)$/m.exec(installedSignature.stderr)?.[1]
      if (!team || !candidateSignature.stderr.split('\n').includes(`TeamIdentifier=${team}`)) throw new Error('Next update signing team does not match the installed application')
      const staged = join(directory, apps[0]!.name)
      await run('/usr/bin/ditto', [bundle, staged])
      this.prepared = { path, version, directory, bundle: staged, installed }
    } finally {
      // Do not use the aborted operation signal for unmounting a disk image.
      await execute('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 }).catch(async () => {
        try { await execute('/usr/bin/hdiutil', ['detach', '-force', mount], { timeout: 30_000 }) }
        catch (error) { if (attached) throw error }
      })
    }
  }
  /** Validate that the prepared bundle and target directory are ready before shutting down the app. */
  async stage(): Promise<void> {
    const prepared = this.prepared
    if (!prepared) throw new Error('No prepared Next update')
    if (this.options.platform === 'win32') return
    if (this.nativeReady) return
    if (!prepared.bundle || !prepared.installed || !prepared.directory) throw new Error('No prepared Next update')
    const stat = await lstat(prepared.bundle)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Prepared Next application bundle is unavailable')
    await access(dirname(prepared.installed), constants.W_OK)
    await access(prepared.installed, constants.W_OK)
    this.nativeReady = true
  }
  /** Called after the Host and windows have finished shutting down. */
  async launch(): Promise<void> {
    if (this.options.platform === 'darwin') {
      const prepared = this.prepared
      if (!this.nativeReady || !prepared?.bundle || !prepared.installed || !prepared.directory) throw new Error('No prepared update installer')
      const zh = (this.options.language?.() ?? 'en').toLowerCase().startsWith('zh')
      const message = zh ? `正在更新 DSH NEXT 至 ${prepared.version}，请稍候…` : `Updating DSH NEXT to ${prepared.version}, please wait…`
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', MAC_UPDATE_SCRIPT], {
          detached: true, stdio: 'ignore', shell: false, cwd: '/',
          env: {
            ...process.env,
            DSH_UPDATE_PID: String(process.pid),
            DSH_UPDATE_STAGED: prepared.bundle!,
            DSH_UPDATE_INSTALLED: prepared.installed!,
            DSH_UPDATE_DIR: prepared.directory!,
            DSH_UPDATE_TITLE: 'DSH NEXT',
            DSH_UPDATE_MESSAGE: message,
            DSH_UPDATE_UI_SCRIPT: MAC_PROGRESS_UI_SCRIPT,
          },
        })
        child.once('error', reject)
        child.once('spawn', () => { child.off('error', reject); child.on('error', this.options.log); child.unref(); resolve() })
      })
      return
    }
    if (this.options.platform !== 'win32' || !this.prepared) throw new Error('No prepared update installer')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.prepared!.path, ['--updated', '--force-run'], { detached: true, stdio: 'ignore', shell: false, windowsHide: false })
      child.once('error', reject)
      child.once('spawn', () => { child.off('error', reject); child.on('error', this.options.log); child.unref(); resolve() })
    })
  }
}
