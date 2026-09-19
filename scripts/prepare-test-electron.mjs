import { createRequire } from 'node:module'
import { join } from 'node:path'

export default function prepareTestElectron(project) {
  // Electron installs lazily on first require. Finish that work before test
  // workers can concurrently extract and execute the same Windows binary.
  // Resolving the path prepares the runtime without launching Electron.
  createRequire(join(project.config.root, 'package.json'))('electron')
}
