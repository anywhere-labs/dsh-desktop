/** Bilingual copy for the pre-Host native Setup Wizard. */

import type { DesktopLocale } from './runtime.ts'

export interface DesktopSetupWizardCopy {
  readonly beta: string
  readonly title: string
  readonly profile: string
  readonly welcomeTitle: string
  readonly welcomeBody: string
  readonly firstProfileSetup: string
  readonly startSetup: string
  readonly presentationTitle: string
  readonly presentationBody: string
  readonly compatibilityMode: string
  readonly compatibilityModeBody: string
  readonly extendedMode: string
  readonly extendedModeBody: string
  readonly advancedMode: string
  readonly advancedModeBody: string
  readonly unavailableOnLinux: string
  readonly windowMaterial: string
  readonly windowMaterialBody: string
  readonly materialOff: string
  readonly materialOffBody: string
  readonly materialTransparent: string
  readonly materialTransparentBody: string
  readonly materialAcrylic: string
  readonly materialAcrylicBody: string
  readonly materialMica: string
  readonly materialMicaBody: string
  readonly browserTitle: string
  readonly browserBody: string
  readonly openBrowser: string
  readonly browserCompatibilityNotice: string
  readonly browserCompatibilityDialogTitle: string
  readonly browserCompatibilityDialogBody: string
  readonly confirmBrowserCompatibility: string
  readonly cancelBrowserCompatibility: string
  readonly networkExposure: string
  readonly networkExposureBody: string
  readonly loopback: string
  readonly loopbackBody: string
  readonly lan: string
  readonly lanBody: string
  readonly lanWarningTitle: string
  readonly lanWarningBody: string
  readonly confirmLan: string
  readonly cancelLan: string
  readonly marketTitle: string
  readonly marketBody: string
  readonly marketDisabled: string
  readonly marketDisabledBody: string
  readonly communityMarket: string
  readonly communityMarketBody: string
  readonly dshMarket: string
  readonly dshMarketBody: string
  readonly notificationsTitle: string
  readonly notificationsBody: string
  readonly notificationsEnabled: string
  readonly turnCompletion: string
  readonly turnFailure: string
  readonly jobCompletion: string
  readonly jobFailure: string
  readonly back: string
  readonly next: string
  readonly skip: string
  readonly skipDialogTitle: string
  readonly skipDialogBody: string
  readonly cancelSkip: string
  readonly confirmSkip: string
  readonly successTitle: string
  readonly successBody: string
  readonly startUsing: string
  readonly invalidState: string
}

const COPY: Record<DesktopLocale, DesktopSetupWizardCopy> = {
  en: {
    beta: 'Beta',
    title: 'Set up DSH Desktop',
    profile: 'Profile',
    welcomeTitle: 'Welcome to DSH Desktop',
    welcomeBody: 'This wizard configures the Desktop experience for the Profile shown below.',
    firstProfileSetup: 'This is the first time you are setting up Desktop mode for this Profile.',
    startSetup: 'Start setup',
    presentationTitle: 'Choose a window mode',
    presentationBody: 'Choose how DSH Desktop presents the official client.',
    compatibilityMode: 'Compatibility mode',
    compatibilityModeBody: 'Keep the official client layout for the broadest compatibility.',
    extendedMode: 'Extended window',
    extendedModeBody: 'Add Desktop controls around the official content area.',
    advancedMode: 'Enhanced mode',
    advancedModeBody: 'Use the layout and window interactions optimized for Desktop.',
    unavailableOnLinux: 'This mode is currently available on macOS and Windows.',
    windowMaterial: 'Choose a window material',
    windowMaterialBody: 'Choose the transparency or glass effect used by the Desktop window.',
    materialOff: 'No window material',
    materialOffBody: 'Use a solid, opaque window background.',
    materialTransparent: 'Transparent',
    materialTransparentBody: 'Let content behind the window show through the Desktop surface.',
    materialAcrylic: 'Acrylic',
    materialAcrylicBody: 'Use the Windows acrylic blur material.',
    materialMica: 'Mica',
    materialMicaBody: 'Use the native Windows Mica material when it is supported.',
    browserTitle: 'Set up browser access',
    browserBody: 'Choose whether this Profile may be opened in a browser and who may reach it.',
    openBrowser: 'Allow opening this Profile in a browser',
    browserCompatibilityNotice: 'Browser access is only available in compatibility mode.',
    browserCompatibilityDialogTitle: 'Switch to compatibility mode?',
    browserCompatibilityDialogBody: 'Opening this Profile in a browser requires compatibility mode. Continue to switch the window mode and enable browser access.',
    confirmBrowserCompatibility: 'Switch and enable',
    cancelBrowserCompatibility: 'Cancel',
    networkExposure: 'Network access',
    networkExposureBody: 'Loopback keeps access on this computer. LAN makes the client reachable from your local network.',
    loopback: 'This computer only',
    loopbackBody: 'Listen on loopback addresses only.',
    lan: 'Local network',
    lanBody: 'Allow other devices on the same LAN to open and operate the client.',
    lanWarningTitle: 'Allow control from your local network?',
    lanWarningBody: 'This is dangerous: everyone on your local network may be able to operate your computer directly. Enable it only with great care. Browser security restrictions may prevent some security modules from working when DSH Desktop is accessed over HTTP from the local network, which may cause it not to work correctly.',
    confirmLan: 'Enable LAN access',
    cancelLan: 'Keep this computer only',
    marketTitle: 'Choose a plugin market',
    marketBody: 'Choose one plugin market for this Desktop installation.',
    marketDisabled: 'Do not enable a plugin market',
    marketDisabledBody: 'Keep plugin market features turned off.',
    communityMarket: 'dsh-community-market',
    communityMarketBody: 'The open market built into DSH Desktop, including custom data sources.',
    dshMarket: 'dsh-market',
    dshMarketBody: 'The popular community market powered by awesome-dsh-plugin data.',
    notificationsTitle: 'Set up Desktop notifications',
    notificationsBody: 'Choose which completion and failure events send a system notification. Notification text never includes conversation content.',
    notificationsEnabled: 'Enable Desktop notifications',
    turnCompletion: 'User turn completed',
    turnFailure: 'User turn failed',
    jobCompletion: 'Background job completed',
    jobFailure: 'Background job failed',
    back: 'Previous',
    next: 'Next',
    skip: 'Skip setup',
    skipDialogTitle: 'Skip setup?',
    skipDialogBody: 'You can still configure all of these options later under Settings > Desktop settings.',
    cancelSkip: 'Continue setup',
    confirmSkip: 'Skip setup',
    successTitle: 'Setup complete',
    successBody: 'DSH Desktop is ready for this Profile.',
    startUsing: 'Start using DSH Desktop',
    invalidState: 'Setup information could not be loaded. Close this window and try again.',
  },
  zh: {
    beta: 'Beta',
    title: '设置 DSH Desktop',
    profile: 'Profile',
    welcomeTitle: '欢迎设置 DSH Desktop',
    welcomeBody: '此向导将为下方 Profile 配置桌面体验。',
    firstProfileSetup: '这是您第一次为这个 Profile 设置桌面模式。',
    startSetup: '开始设置',
    presentationTitle: '选择窗口模式',
    presentationBody: '选择 DSH Desktop 如何呈现官方客户端。',
    compatibilityMode: '兼容模式',
    compatibilityModeBody: '保留官方客户端布局，兼容性最好。',
    extendedMode: '扩展窗口',
    extendedModeBody: '在官方内容区域周围增加桌面控制。',
    advancedMode: '增强模式',
    advancedModeBody: '使用针对桌面端优化的布局和窗口交互。',
    unavailableOnLinux: '此模式目前支持 macOS 和 Windows。',
    windowMaterial: '选择窗口材质',
    windowMaterialBody: '选择桌面窗口使用的透明或玻璃效果。',
    materialOff: '不使用窗口材质',
    materialOffBody: '使用不透明的纯色窗口背景。',
    materialTransparent: '透明材质',
    materialTransparentBody: '让桌面窗口呈现可透出背后内容的透明效果。',
    materialAcrylic: '亚克力',
    materialAcrylicBody: '使用 Windows 亚克力模糊材质。',
    materialMica: 'Mica',
    materialMicaBody: '在系统支持时使用 Windows 原生 Mica 材质。',
    browserTitle: '设置浏览器访问',
    browserBody: '选择是否允许在浏览器中打开这个 Profile，以及谁可以访问。',
    openBrowser: '允许在浏览器中打开',
    browserCompatibilityNotice: '浏览器访问仅在兼容模式下可用。',
    browserCompatibilityDialogTitle: '切换到兼容模式？',
    browserCompatibilityDialogBody: '在浏览器中打开只能使用兼容模式。继续将把这个 Profile 的窗口模式切换为兼容模式，并开启浏览器访问。',
    confirmBrowserCompatibility: '切换并开启',
    cancelBrowserCompatibility: '取消',
    networkExposure: '网络访问范围',
    networkExposureBody: '仅本机访问只监听回环地址；局域网访问会让同一网络中的设备能够打开客户端。',
    loopback: '仅这台电脑',
    loopbackBody: '只监听本机回环地址。',
    lan: '局域网',
    lanBody: '允许同一局域网中的其他设备打开并操作客户端。',
    lanWarningTitle: '允许局域网中的设备控制吗？',
    lanWarningBody: '这样很危险，所有在你局域网内的人都能直接操作你的电脑，请谨慎开启。由于浏览器安全限制，从局域网内使用 HTTP 访问时，部分安全模块可能不可用，可能导致 DSH Desktop 无法正常使用。',
    confirmLan: '确认开启局域网访问',
    cancelLan: '保持仅本机访问',
    marketTitle: '选择插件市场',
    marketBody: '为这套桌面安装选择一个插件市场。',
    marketDisabled: '不启用插件市场',
    marketDisabledBody: '保持插件市场功能关闭。',
    communityMarket: 'dsh-community-market',
    communityMarketBody: 'DSH Desktop 内置的开放市场，并支持自定义数据源。',
    dshMarket: 'dsh-market',
    dshMarketBody: '使用 awesome-dsh-plugin 数据的热门社区市场。',
    notificationsTitle: '设置桌面通知',
    notificationsBody: '选择哪些完成或失败事件发送系统通知。通知文本不会包含会话内容。',
    notificationsEnabled: '启用桌面通知',
    turnCompletion: '用户回合完成',
    turnFailure: '用户回合失败',
    jobCompletion: '后台任务完成',
    jobFailure: '后台任务失败',
    back: '上一步',
    next: '下一步',
    skip: '跳过设置',
    skipDialogTitle: '跳过设置？',
    skipDialogBody: '之后仍可在“设置” > “桌面设置”中配置这里的所有内容。',
    cancelSkip: '继续设置',
    confirmSkip: '确认跳过',
    successTitle: '设置成功',
    successBody: '这个 Profile 的 DSH Desktop 已准备就绪。',
    startUsing: '开始使用',
    invalidState: '无法加载设置信息。请关闭此窗口后重试。',
  },
}

export function desktopSetupWizardCopy(locale: DesktopLocale): DesktopSetupWizardCopy {
  return COPY[locale]
}
