import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { verifyElectronExecutableFuses } from '../../dsh-plugin-desktop-beta/scripts/verify-electron-fuses.ts'
import { withoutMacReleaseSecrets } from '../../dsh-plugin-desktop-beta/scripts/release-preflight.ts'
import { withoutWindowsSigningSecrets } from '../../dsh-plugin-desktop-beta/scripts/package-win.ts'
export default async function afterAllArtifactBuild(result: { outDir: string }): Promise<string[]> {
  const paths = ['mac/DSH NEXT.app/Contents/MacOS/DSH NEXT', 'mac-arm64/DSH NEXT.app/Contents/MacOS/DSH NEXT',
    'mac-universal/DSH NEXT.app/Contents/MacOS/DSH NEXT', 'win-unpacked/DSH NEXT.exe', 'linux-unpacked/dsh-desktop-next']
  const executables = paths.map(path => join(result.outDir, path)).filter(existsSync)
  if (!executables.length) throw new Error('No packaged Next executable to verify')
  for (const path of executables) {
    await verifyElectronExecutableFuses(path, undefined, false)
    const root = path.includes('.app/') ? join(dirname(path), '../Resources/app') : join(dirname(path), 'resources/app')
    const smoke = spawnSync(path, ['--input-type=module', '-e', `
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const root = process.argv[1];
      const require = createRequire(root + '/package.json');
      if (require('./package.json').name !== 'dsh-desktop-next') throw new Error('Wrong packaged application');
      await import(pathToFileURL(root + '/lib/profiles.js'));
      await import(pathToFileURL(root + '/lib/desktop-runtime.js'));
      require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html');
    `, root], { env: { ...withoutWindowsSigningSecrets(withoutMacReleaseSecrets(process.env)), ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000, encoding: 'utf8' })
    if (smoke.error || smoke.status !== 0) throw smoke.error ?? new Error(`Packaged Next runtime failed: ${smoke.stderr}`)
  }
  return []
}
