import { describe, expect, it } from 'vitest'
import { en as desktopSettingsEnglish, ru as desktopSettingsRussian } from '../src/client/desktop-settings-locales.ts'
import { desktopNativeCopy } from '../src/native-dialog-copy.ts'
import { desktopRecoveryCopy } from '../src/recovery-copy.ts'
import { desktopSetupWizardCopy } from '../src/setup-wizard-copy.ts'
import {
  desktopDiagnosticsPrivacyCopy,
  desktopLocaleFromLanguageTag,
  desktopRestartConfirmationCopy,
  desktopTrayLabel,
  rendererRecoveryCopy,
} from '../src/tray-locale.ts'
import { desktopWorkspaceAdmissionCopy } from '../src/workspace-admission-copy.ts'

describe('Russian Desktop localization', () => {
  it.each([
    ['ru', 'ru'],
    ['ru-RU', 'ru'],
    ['ru_RU', 'ru'],
    ['RU-ru', 'ru'],
    ['zh-Hans-CN', 'zh'],
    ['en-GB', 'en'],
    ['fr-FR', 'en'],
    ['', 'en'],
  ] as const)('resolves %s to %s', (tag, expected) => {
    expect(desktopLocaleFromLanguageTag(tag)).toBe(expected)
  })

  it('localizes current tray actions and recovery confirmations', () => {
    expect(desktopTrayLabel('ru', 'openDesktop', 'DSH Desktop')).toBe('Открыть DSH Desktop')
    expect(desktopTrayLabel('ru', 'enterSafeMode')).toContain('безопасный режим')
    expect(desktopTrayLabel('ru', 'installStable')).toContain('стабильную версию')
    expect(desktopTrayLabel('ru', 'profile', 'work')).toBe('Профиль: work')
    expect(rendererRecoveryCopy.ru.confirm).toBe('Повторить восстановление')
    expect(desktopRestartConfirmationCopy('ru', 'recovery').confirm).toContain('режиме восстановления')
    expect(desktopDiagnosticsPrivacyCopy('ru').detail).toContain('фрагменты памяти процесса')
  })

  it('retains dynamic values in native dialogs and workspace warnings', () => {
    const native = desktopNativeCopy('ru')
    expect(native.updateAvailableMessage('2.1.0')).toContain('2.1.0')
    expect(native.removeInstallerQuestion('C:\\Updates\\setup.exe')).toContain('C:\\Updates\\setup.exe')
    const workspace = desktopWorkspaceAdmissionCopy('ru')
    expect(workspace.removableDetail('E:\\Проекты')).toContain('E:\\Проекты')
    expect(workspace.unsupportedMessage('EXFAT')).toContain('«EXFAT»')
  })

  it('ships Russian setup and recovery copy without translating technical identifiers', () => {
    const wizard = desktopSetupWizardCopy('ru')
    expect(wizard.lanWarningBody).toContain('HTTPS')
    expect(wizard.marketBody).toContain('профиля')
    const recovery = desktopRecoveryCopy('ru')
    expect(recovery.title).not.toBe('')
    expect(recovery.confirmSafeModeBody).not.toBe('')
  })

  it('covers every Desktop settings key, including newer native chrome actions', () => {
    expect(Object.keys(desktopSettingsRussian).sort()).toEqual(Object.keys(desktopSettingsEnglish).sort())
    expect(desktopSettingsRussian.nav).toBe('Настройки Desktop')
    expect(desktopSettingsRussian.restartToRecovery).toContain('режиме восстановления')
  })
})
