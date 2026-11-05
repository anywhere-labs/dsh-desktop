/** Measurement-only wrappers for the pinned Electron Builder; loaded before its CLI via --import. */
import { createRequire } from 'node:module'
import { packagingStep } from './packaging-step.ts'

if (process.env.DSH_DESKTOP_PACKAGING_RUN_DIR !== undefined) {
  const require = createRequire(import.meta.url)
  const { version } = require('app-builder-lib/package.json')
  if (version !== '26.15.7') throw new Error(`Update the Next packaging measurement adapters for Electron Builder ${version}`)
  // Load the public entry first: internal packager modules depend on its initialized platform exports.
  require('app-builder-lib')

  function measure(prototype, method, label) {
    const original = prototype[method]
    if (typeof original !== 'function') throw new Error(`Next packaging measurement: missing ${method}`)
    prototype[method] = function (...args) {
      return packagingStep(label, () => original.apply(this, args))
    }
  }

  const { PlatformPackager } = require('app-builder-lib/out/platformPackager.js')
  const { AsarPackager } = require('app-builder-lib/out/asar/asarUtil.js')
  const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget.js')
  const archive = require('app-builder-lib/out/targets/archive.js')
  const electron = require('app-builder-lib/out/electron/ElectronFramework.js')
  const createFramework = electron.createElectronFrameworkSupport
  electron.createElectronFrameworkSupport = async function (...args) {
    const framework = await createFramework.apply(this, args)
    measure(framework, 'prepareApplicationStageDirectory', 'builder:prepare-electron')
    return framework
  }
  measure(PlatformPackager.prototype, 'doPack', 'builder:assemble-application')
  measure(AsarPackager.prototype, 'pack', 'builder:asar')
  measure(archive, 'archive', 'builder:archive-compression')
  measure(NsisTarget.prototype, 'buildAppPackage', 'builder:compress-nsis-payload')
  measure(NsisTarget.prototype, 'executeMakensis', 'builder:makensis')
}
