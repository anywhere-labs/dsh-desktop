/** Canonical owner-facing identity for this AERA desktop overlay. */

/** Product metadata shared by Electron, renderer composition, and packaging tests. */
export const AERA_CODE_PRODUCT = Object.freeze({
  productName: 'Aera Code',
  shortName: 'Aera Code',
  bundleIdentifier: 'dev.aerastudios.code',
  description: 'AERA-branded desktop agent workspace with governed AERA Gateway integration',
  userDataDirectoryName: 'Aera Code',
  legacyUserDataDirectoryName: 'DSH Desktop',
  windowTitle: 'Aera Code',
  iconFilename: 'aera-code-icon.png',
  macIconFilename: 'aera-code-icon-mac.png',
  trayIconFilename: 'aera-aperture-tray.svg',
  gatewayProfileName: 'aera-gateway-eval',
  gatewayCredentialEnvironmentName: 'AERA_GATEWAY_DSH_EVAL_KEY',
  gatewayKeychainService: 'com.aera.gateway.canary.execution',
  gatewayKeychainAccount: 'Allyd',
  gatewayProfiles: Object.freeze({
    'aera-gateway-eval': Object.freeze({
      credentialEnvironmentName: 'AERA_GATEWAY_DSH_EVAL_KEY',
      keychainService: 'com.aera.gateway.canary.execution',
      keychainAccount: 'Allyd',
    }),
    'aera-gateway-dev-eval': Object.freeze({
      credentialEnvironmentName: 'AERA_GATEWAY_DEV_EXECUTION_KEY',
      keychainService: 'com.aera.gateway.dev.execution',
      keychainAccount: 'Alyshia Daley',
    }),
  }),
} as const)

export type AeraCodeProduct = typeof AERA_CODE_PRODUCT
