// The managed Electron Node launcher puts `dsh-desktop` in argv[0], causing
// yargs to mistake the CLI script path for an option. Normalize argv[0] first.
const builderCli = process.argv[2]
if (builderCli === undefined) {
  throw new Error('electron-builder CLI path is required')
}

process.argv = [process.execPath, 'build', ...process.argv.slice(3)]
// Electron's virtual ASAR filesystem can intercept real .asar files in output paths.
process.noAsar = true
require(builderCli)
