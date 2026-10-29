; Check the exact app process before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid

!macro customCheckAppRunning
  ${if} ${isUpdated}
  ${andIfNot} ${Silent}
    ; Ensure the installer progress window is visible and focused even when an
    ; older updater (<= 2.0.18-next) spawned the installer with windowsHide: true.
    ShowWindow $HWNDPARENT ${SW_SHOW}
    BringToFront
  ${endIf}
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 != 0
    Goto dsh_installer_app_stopped
  ${endIf}

  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 dsh_installer_scoped_fallback
    ; Newer versions receive this through Electron's single-instance channel.
    ; 2.0.2 ignores it, so the scoped builder fallback remains necessary for
    ; the first upgrade to a version that supports orderly shutdown.
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --dsh-installer-quit'
    StrCpy $R1 0

  dsh_installer_wait_for_exit:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    IntOp $R1 $R1 + 1
    ; Slow disks, antivirus hooks, and a large physical runtime can keep the
    ; process alive after Cordis disposal begins. Give the orderly handoff a
    ; full 30 seconds before escalating to the scoped forced-close path.
    ${if} $R1 < 60
      Sleep 500
      Goto dsh_installer_wait_for_exit
    ${endIf}

  dsh_installer_scoped_fallback:
    ; The patched builder macros match DSH Desktop.exe, not every executable
    ; below $INSTDIR. They handle pre-handoff releases and stubborn processes.
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dsh_installer_stop_app
    Quit

  dsh_installer_stop_app:
    DetailPrint "$(appClosing)"
    ; KILL_PROCESS's tasklist fallback excludes $pid. The installer never has
    ; the application executable name, so zero is a safe sentinel here.
    StrCpy $pid 0
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 0
    Sleep 500
    StrCpy $R1 0

  dsh_installer_wait_for_fallback:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto dsh_installer_app_stopped
    ${endIf}
    IntOp $R1 $R1 + 1
    ${if} $R1 > 1
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY dsh_installer_wait_for_fallback
      Quit
    ${endIf}
    Sleep 1000
    !insertmacro KILL_PROCESS "${APP_EXECUTABLE_FILENAME}" 1
    Sleep 500
    Goto dsh_installer_wait_for_fallback

  dsh_installer_app_stopped:
!macroend

; Override /S when an older updater (<= 2.0.18-next) launches an in-app update
; with ['/S', '--updated', '--force-run'], so the new installer still displays
; the visible extraction progress window.
!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${if} ${isUpdated}
    ${andIf} ${isForceRun}
      SetSilent normal
    ${endIf}
  !endif
!macroend

; Skip the install-mode wizard page during in-app updates while preserving
; the existing per-machine or per-user installation scope, so the installer
; opens directly to the visible extraction progress window.
!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ${if} ${isUpdated}
      ${if} $hasPerMachineInstallation == "1"
      ${andIf} $hasPerUserInstallation == "0"
        StrCpy $isForceMachineInstall "1"
      ${else}
        StrCpy $isForceCurrentInstall "1"
      ${endIf}
    ${endIf}
  !endif
!macroend

; When launched visibly by an in-app update (--updated --force-run), relaunch
; the updated application and close the installer as soon as extraction finishes
; without stopping on the Finish wizard page.
!macro customInstall
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
  ${andIfNot} ${Silent}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
    !insertmacro quitSuccess
  ${endIf}
!macroend

; Install-directory guards. The patched installSection.nsh inserts
; dshEnsureInstallDirWritable after the previous version's uninstaller returns
; and dshVerifyInstalledFiles after the application files are written, before
; registration, shortcuts and relaunch. The uninstaller that runs is the one
; already installed, so only the new installer can enforce these checks.
!ifndef BUILD_UNINSTALLER
  !define DSH_INSTALL_DIR_WAIT_MS 30000
  !define DSH_INSTALL_PROBE "dsh-install-probe.tmp"
  !define DSH_DOWNLOAD_URL "https://dshdesktop.cn"
  ; The log sits beside electron-builder's per-user installer copy, outside
  ; $INSTDIR, so it survives an install that could not write there.
  !searchreplace DSH_INSTALL_LOG_DIR "${APP_INSTALLER_STORE_FILE}" "\installer.exe" ""

  Var dshInstallLog
  Var dshWaitStart
  Var dshWaitBudget
  Var dshWaited
  Var dshAttempts
  Var dshProbeError
  Var dshFirstError
  Var dshErrorText
  Var dshText
  Var dshMessage
!endif

; This file is included before the builder templates load LogicLib, FileFunc
; and the bundled plugin directories. customHeader is inserted after them, so
; the plugin call inside ${GetTime} resolves against the bundled plugins.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    ; Append one timestamped line to the UTF-16LE Setup log. Logging never
    ; affects the installation.
    Function dshWriteInstallLog
      Exch $R0
      ${if} $dshInstallLog != ""
        Push $R1
        Push $0
        Push $1
        Push $2
        Push $3
        Push $4
        Push $5
        Push $6
        ClearErrors
        FileOpen $R1 $dshInstallLog a
        ${ifNot} ${Errors}
          ; Every FileOpen mode starts at offset 0; /BOM only marks an empty file.
          FileSeek $R1 0 END
          ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
          FileWriteUTF16LE /BOM $R1 "$2-$1-$0 $4:$5:$6 $R0$\r$\n"
          FileClose $R1
        ${endIf}
        ClearErrors
        Pop $6
        Pop $5
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Pop $0
        Pop $R1
      ${endIf}
      Pop $R0
    FunctionEnd
  !endif
!macroend

!ifndef BUILD_UNINSTALLER
  !macro dshLog LINE
    Push `${LINE}`
    Call dshWriteInstallLog
  !macroend

  ; Set $dshErrorText to the system's description of $dshProbeError.
  !macro dshDescribeProbeError
    Push $0
    Push $1
    StrCpy $0 ""
    ; FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS
    System::Call 'kernel32::FormatMessageW(i 0x1200, p 0, i $dshProbeError, i 0, w .r0, i ${NSIS_MAX_STRLEN}, p 0) i .r1'
    StrCpy $1 $0 "" -2
    ${if} $1 == "$\r$\n"
      StrCpy $0 $0 -2
    ${endIf}
    StrCpy $dshErrorText $0
    Pop $1
    Pop $0
  !macroend

  ; The previous version's uninstaller removes $INSTDIR. While another process
  ; (usually a File Explorer window or an editor) still holds the folder open,
  ; Windows only marks it for deletion and reports every write below it as
  ; access denied until that handle closes. Retrying a File command cannot
  ; recover, because the folder is gone by then, so recreate the folder and
  ; probe until a write succeeds. Waiting helps only in that case; any other
  ; failure, such as a folder the account may not write to, is reported at once.
  !macro dshEnsureInstallDirWritable
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endIf}
    StrCpy $dshInstallLog "$LOCALAPPDATA\${DSH_INSTALL_LOG_DIR}\install.log"
    CreateDirectory "$LOCALAPPDATA\${DSH_INSTALL_LOG_DIR}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endIf}
    ${if} ${isUpdated}
      StrCpy $dshText "update"
    ${else}
      StrCpy $dshText "install"
    ${endIf}
    ${if} ${Silent}
      StrCpy $dshText "$dshText, silent"
    ${endIf}
    !insertmacro dshLog "${PRODUCT_NAME} ${VERSION} $dshText ($installMode) from $EXEPATH"
    !insertmacro dshLog "Install directory: $INSTDIR"

    StrCpy $dshAttempts 0
    StrCpy $dshFirstError ""
    StrCpy $dshWaitBudget 0
    System::Call 'kernel32::GetTickCount() i .s'
    Pop $dshWaitStart

  dsh_install_dir_probe:
    IntOp $dshAttempts $dshAttempts + 1
    Push $0
    Push $1
    ; Unlike CreateDirectory, this returns the Win32 error of the step that failed.
    System::Call 'shell32::SHCreateDirectoryExW(p 0, w "$INSTDIR", p 0) i .r0'
    ; ERROR_FILE_EXISTS and ERROR_ALREADY_EXISTS both mean the folder exists.
    ${if} $0 = 0
    ${orIf} $0 = 80
    ${orIf} $0 = 183
      ; Open the probe the way the File command opens its targets.
      System::Call 'kernel32::CreateFileW(w "$INSTDIR\${DSH_INSTALL_PROBE}", i 0x40000000, i 1, p 0, i 2, i 0x80, p 0) p .r0 ?e'
      Pop $1
      ${if} $0 = -1
        StrCpy $dshProbeError $1
      ${else}
        System::Call 'kernel32::CloseHandle(p r0)'
        Delete "$INSTDIR\${DSH_INSTALL_PROBE}"
        StrCpy $dshProbeError 0
      ${endIf}
    ${else}
      StrCpy $dshProbeError $0
    ${endIf}
    Pop $1
    Pop $0
    System::Call 'kernel32::GetTickCount() i .s'
    Pop $dshWaited
    IntOp $dshWaited $dshWaited - $dshWaitStart
    ${if} $dshProbeError = 0
      Goto dsh_install_dir_ready
    ${endIf}
    ${if} $dshFirstError == ""
      StrCpy $dshFirstError $dshProbeError
      !insertmacro dshDescribeProbeError
      ; $installationDir is the folder this run handed to the previous version's
      ; uninstaller. A folder pending deletion reports access denied (5); a
      ; sharing violation (32) is just as short-lived.
      ${if} $installationDir == $INSTDIR
        ${if} $dshProbeError = 5
        ${orIf} $dshProbeError = 32
          StrCpy $dshWaitBudget ${DSH_INSTALL_DIR_WAIT_MS}
        ${endIf}
      ${endIf}
      ${if} $dshWaitBudget > 0
        !insertmacro dshLog "Install directory is not writable (Win32 error $dshProbeError: $dshErrorText); waiting up to $dshWaitBudget ms because the previous version was just removed from it"
        ${ifNot} ${Silent}
          SetDetailsPrint textonly
          DetailPrint "正在等待安装目录可以写入… / Waiting for the installation folder to accept files…"
          SetDetailsPrint none
        ${endIf}
      ${else}
        !insertmacro dshLog "Install directory is not writable (Win32 error $dshProbeError: $dshErrorText); asking now because waiting cannot help"
      ${endIf}
    ${endIf}
    ${if} $dshWaited < $dshWaitBudget
      Sleep 500
      Goto dsh_install_dir_probe
    ${endIf}

    !insertmacro dshDescribeProbeError
    !insertmacro dshLog "Asking the user after $dshWaited ms and $dshAttempts attempts (Win32 error $dshProbeError)"
    StrCpy $dshMessage "无法写入安装目录：$\r$\n$INSTDIR$\r$\n系统错误 $dshProbeError：$dshErrorText$\r$\n$\r$\n"
    ${if} $dshWaitBudget > 0
      StrCpy $dshMessage "$dshMessage通常是资源管理器窗口、编辑器或其他程序正在打开这个文件夹，也可能是安全软件拦截了写入。请关闭它们（或在安全软件中放行）后点击“重试”；点击“取消”将退出安装，稍后可重新运行安装包：$\r$\n"
    ${else}
      StrCpy $dshMessage "$dshMessage当前账户可能没有这个文件夹的写入权限，也可能是安全软件拦截了写入。请点击“取消”退出，然后重新运行安装包并选择有写入权限的位置（例如默认位置）；如果已经修复权限或在安全软件中放行，可以点击“重试”。安装包：$\r$\n"
    ${endIf}
    StrCpy $dshMessage "$dshMessage$EXEPATH$\r$\n或从 ${DSH_DOWNLOAD_URL} 下载。用户数据不在安装目录中，不受影响。$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessageSetup cannot write to the installation folder:$\r$\n$INSTDIR$\r$\nSystem error $dshProbeError: $dshErrorText$\r$\n$\r$\n"
    ${if} $dshWaitBudget > 0
      StrCpy $dshMessage "$dshMessageA File Explorer window, an editor or another program usually has this folder open, or security software is blocking Setup. Close it (or allow Setup) and click Retry. Click Cancel to exit Setup; you can run the installer again later:$\r$\n"
    ${else}
      StrCpy $dshMessage "$dshMessageYour account may not be allowed to write to this folder, or security software is blocking Setup. Click Cancel, then run the installer again and choose a location you can write to (such as the default one). If you have fixed the permissions or allowed Setup, click Retry. Installer:$\r$\n"
    ${endIf}
    StrCpy $dshMessage "$dshMessage$EXEPATH$\r$\nor download it from ${DSH_DOWNLOAD_URL}. Your user data is stored outside the installation folder and is not affected.$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessage安装日志 / Setup log:$\r$\n$dshInstallLog"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$dshMessage" /SD IDCANCEL IDRETRY dsh_install_dir_retry
    !insertmacro dshLog "Setup cancelled: the install directory is not writable"
    SetErrorLevel 2
    Quit

  dsh_install_dir_retry:
    !insertmacro dshLog "Retrying the install directory"
    StrCpy $dshAttempts 0
    System::Call 'kernel32::GetTickCount() i .s'
    Pop $dshWaitStart
    Goto dsh_install_dir_probe

  dsh_install_dir_ready:
    ${if} $dshFirstError == ""
      !insertmacro dshLog "Install directory is writable"
    ${else}
      ${ifNot} ${Silent}
        SetDetailsPrint textonly
        DetailPrint ""
        SetDetailsPrint none
      ${endIf}
      !insertmacro dshLog "Install directory became writable after $dshWaited ms and $dshAttempts attempts (first Win32 error $dshFirstError)"
    ${endIf}
  !macroend

  ; Add RELATIVE to $dshText unless it is a regular file; a directory of the
  ; same name does not count.
  !macro dshRequireInstalledFile RELATIVE
    ${ifNot} ${FileExists} "$INSTDIR\${RELATIVE}"
    ${orIf} ${FileExists} "$INSTDIR\${RELATIVE}\*.*"
      ${if} $dshText == ""
        StrCpy $dshText "${RELATIVE}"
      ${else}
        StrCpy $dshText "$dshText, ${RELATIVE}"
      ${endIf}
    ${endIf}
  !macroend

  ; The archive extractor and an ignored File error both fail silently. Stop
  ; before the incomplete application is registered, linked or launched.
  !macro dshVerifyInstalledFiles
    StrCpy $dshText ""
    !insertmacro dshRequireInstalledFile "${APP_EXECUTABLE_FILENAME}"
    ; Next and Beta ship resources\app.asar. Frozen Stable shares this script
    ; and still ships the unpacked resources\app.
    ${ifNot} ${FileExists} "$INSTDIR\resources\app\package.json"
      !insertmacro dshRequireInstalledFile "resources\app.asar"
    ${endIf}
    !insertmacro dshRequireInstalledFile "${UNINSTALL_FILENAME}"
    ${if} $dshText == ""
      !insertmacro dshLog "Installed files verified"
    ${else}
      !insertmacro dshLog "Installed files are missing: $dshText; stopped before registration"
      StrCpy $dshMessage "安装未完成，以下文件没有写入安装目录：$\r$\n$dshText$\r$\n安装目录：$INSTDIR$\r$\n$\r$\n"
      StrCpy $dshMessage "$dshMessage${PRODUCT_NAME} 尚未注册，也不会启动。请关闭正在打开安装目录的资源管理器窗口、编辑器或其他程序（如有安全软件拦截，请先放行），然后重新运行安装包：$\r$\n$EXEPATH$\r$\n"
      StrCpy $dshMessage "$dshMessage或从 ${DSH_DOWNLOAD_URL} 下载。用户数据不在安装目录中，不受影响。$\r$\n$\r$\n"
      StrCpy $dshMessage "$dshMessageSetup did not finish. These files were not written to the installation folder:$\r$\n$dshText$\r$\nInstallation folder: $INSTDIR$\r$\n$\r$\n"
      StrCpy $dshMessage "$dshMessage${PRODUCT_NAME} has not been registered and will not start. Close any File Explorer window, editor or other program that has the installation folder open (and allow Setup if security software blocked it), then run the installer again:$\r$\n$EXEPATH$\r$\n"
      StrCpy $dshMessage "$dshMessageor download it from ${DSH_DOWNLOAD_URL}. Your user data is stored outside the installation folder and is not affected.$\r$\n$\r$\n"
      StrCpy $dshMessage "$dshMessage安装日志 / Setup log:$\r$\n$dshInstallLog"
      MessageBox MB_OK|MB_ICONSTOP "$dshMessage" /SD IDOK
      SetErrorLevel 2
      Quit
    ${endIf}
  !macroend
!endif
