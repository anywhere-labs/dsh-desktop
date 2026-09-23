import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertPortableExecutable } from '../../dsh-plugin-desktop-beta/scripts/verify-win-installer.ts'
const root = fileURLToPath(new URL('..', import.meta.url))
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
assertPortableExecutable(join(root, 'dist', `DSH-NEXT-${version}-x64-Setup.exe`), 'Next NSIS installer')
assertPortableExecutable(join(root, 'dist', 'win-unpacked', 'DSH NEXT.exe'), 'Next application')
