; Check the exact app process before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid

; Next and Beta install through the directory transaction in installer-directories.nsh,
; which scripts/windows-directory-installer.ts enables by defining DSH_SEVENZIP_PATH.
; Frozen Stable never defines it and keeps electron-builder's in-place installation.
!define /ifndef DSH_INSTALLER_SCRIPTS_DIR "${__FILEDIR__}"
!define DSH_DOWNLOAD_URL "https://dshdesktop.cn"
; The transaction keeps its failure evidence beside the Setup log.
!define DSH_INSTALLER_LOG_DIR "$dshInstallLogDir"

; Quit after staging removes the transaction directories first. Visible installers
; also clean up from .onGUIEnd; silent ones end without it.
!macro dshQuit
  !ifndef BUILD_UNINSTALLER
    !ifdef DSH_SEVENZIP_PATH
      Call dshCleanupDirectories
    !endif
  !endif
  Quit
!macroend

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
    ; The patched builder macros match DSH Desktop Beta.exe, not every executable
    ; below $INSTDIR. They handle pre-handoff releases and stubborn processes.
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK dsh_installer_stop_app
    !insertmacro dshQuit

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
      !insertmacro dshQuit
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
    !ifdef DSH_SEVENZIP_PATH
      !insertmacro dshBeginInstallLog
    !endif
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

; Remove the replaced version before launch. When launched visibly by an in-app
; update (--updated --force-run), relaunch the updated application and close the
; installer as soon as installation finishes without stopping on the Finish page.
!macro customInstall
  !ifmacrodef dshFinishDirectories
    !insertmacro InstallerPublishStage 4
    !insertmacro dshFinishDirectories
    !insertmacro dshLog "Installed $INSTDIR and removed the replaced version"
  !endif
  ${if} ${isUpdated}
  ${andIf} ${isForceRun}
  ${andIfNot} ${Silent}
    HideWindow
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
    !insertmacro quitSuccess
  ${endIf}
!macroend

; This file is included before the builder templates add LogicLib, FileFunc and
; the bundled plugin directories, and before the adapter's defines.
; customHeader is inserted after all of them.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    !ifdef DSH_SEVENZIP_PATH
      ; The transaction's functions expand the custom* macros below, which use these.
      Var dshInstallLogDir
      Var dshInstallLog
      Var dshStageError
      Var dshErrorText
      Var dshText
      Var dshMessage

      !include "${DSH_INSTALLER_SCRIPTS_DIR}\installer-directories.nsh"

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
  !endif
!macroend

!macro dshLog LINE
  Push `${LINE}`
  Call dshWriteInstallLog
!macroend

; The Setup log sits beside electron-builder's per-user installer copy, outside
; $INSTDIR and the transaction directories, so it outlives a failed installation.
!macro dshBeginInstallLog
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endIf}
  StrCpy $dshInstallLogDir "$LOCALAPPDATA\${DSH_UPDATER_CACHE_NAME}"
  StrCpy $dshInstallLog "$dshInstallLogDir\install.log"
  CreateDirectory $dshInstallLogDir
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
!macroend

; Set $dshErrorText to the system's description of a Win32 error code.
!macro dshDescribeError CODE
  Push $0
  Push $1
  StrCpy $0 ""
  ; FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS
  System::Call 'kernel32::FormatMessageW(i 0x1200, p 0, i ${CODE}, i 0, w .r0, i ${NSIS_MAX_STRLEN}, p 0) i .r1'
  StrCpy $1 $0 "" -2
  ${if} $1 == "$\r$\n"
    StrCpy $0 $0 -2
  ${endIf}
  StrCpy $dshErrorText $0
  Pop $1
  Pop $0
!macroend

; Upstream's stage hook: 1 extraction, 2 directory replacement, 3 replaced,
; 4 removing the replaced version. Without its native window, the status line
; above the progress bar names the slow stages.
!macro InstallerPublishStage Stage
  ${ifNot} ${Silent}
    SetDetailsPrint textonly
    !if ${Stage} == 1
      DetailPrint "正在解压新版本… / Extracting the new version…"
    !else if ${Stage} == 2
      DetailPrint "正在替换旧版本… / Replacing the previous version…"
    !else if ${Stage} == 4
      DetailPrint "正在清理旧版本… / Removing the previous version…"
    !else
      DetailPrint ""
    !endif
    SetDetailsPrint none
  ${endIf}
!macroend

; Upstream's command-line extraction, with the stage line it otherwise draws natively.
!macro customInstallerExtract Archive
  !insertmacro InstallerPublishStage 1
  nsExec::ExecToStack '"$PLUGINSDIR\dsh-7za.exe" x -y -bd -bb0 "-o$INSTDIR" "${Archive}"'
  Pop $R0
  Pop $R1
!macroend

; The staging directory beside the installation could not be created. Waiting
; cannot fix a folder this account may not write to, so ask at once.
!macro customInstallerStageFailed
  dsh_installer_stage_retry:
    Push $0
    ; Unlike CreateDirectory, this returns the Win32 error of the step that failed.
    System::Call 'shell32::SHCreateDirectoryExW(p 0, w "$dshNewDirectory", p 0) i .r0'
    StrCpy $dshStageError $0
    Pop $0
    ${if} $dshStageError = 0
    ${orIf} $dshStageError = 183
      ClearErrors
      Goto dsh_installer_stage_ready
    ${endIf}
    !insertmacro dshDescribeError $dshStageError
    ${GetParent} $dshFinalDirectory $dshText
    !insertmacro dshLog "Cannot create $dshNewDirectory (Win32 error $dshStageError: $dshErrorText)"
    StrCpy $dshMessage "无法写入安装位置：$\r$\n$dshText$\r$\n系统错误 $dshStageError：$dshErrorText$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessage当前账户可能没有这个位置的写入权限，也可能是安全软件拦截了写入。请点击“取消”退出，然后重新运行安装包并选择有写入权限的位置（例如默认位置）；如果已经修复权限或在安全软件中放行，可以点击“重试”。安装包：$\r$\n$EXEPATH$\r$\n"
    StrCpy $dshMessage "$dshMessage或从 ${DSH_DOWNLOAD_URL} 下载。用户数据不在安装目录中，不受影响。$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessageSetup cannot write to the installation location:$\r$\n$dshText$\r$\nSystem error $dshStageError: $dshErrorText$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessageYour account may not be allowed to write there, or security software is blocking Setup. Click Cancel, then run the installer again and choose a location you can write to (such as the default one). If you have fixed the permissions or allowed Setup, click Retry. Installer:$\r$\n$EXEPATH$\r$\n"
    StrCpy $dshMessage "$dshMessageor download it from ${DSH_DOWNLOAD_URL}. Your user data is stored outside the installation folder and is not affected.$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessage安装日志 / Setup log:$\r$\n$dshInstallLog"
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$dshMessage" /SD IDCANCEL IDRETRY dsh_installer_stage_retry
    !insertmacro dshLog "Setup cancelled: the installation location is not writable"
    SetErrorLevel 2
    !insertmacro dshQuit
  dsh_installer_stage_ready:
!macroend

; Add RELATIVE to $dshText unless the staged tree has it as a regular file.
!macro dshRequireStagedFile RELATIVE
  ${ifNot} ${FileExists} "$dshNewDirectory\${RELATIVE}"
  ${orIf} ${FileExists} "$dshNewDirectory\${RELATIVE}\*.*"
    ${if} $dshText == ""
      StrCpy $dshText "${RELATIVE}"
    ${else}
      StrCpy $dshText "$dshText, ${RELATIVE}"
    ${endIf}
  ${endIf}
!macroend

; 7-Zip reported success, but security software can still remove a file it
; wrote. Check the staged tree before anything replaces the installation.
!macro customInstallerStaged
  StrCpy $dshText ""
  !insertmacro dshRequireStagedFile "${APP_EXECUTABLE_FILENAME}"
  !insertmacro dshRequireStagedFile "resources\app.asar"
  !insertmacro dshRequireStagedFile "${UNINSTALL_FILENAME}"
  ${if} $dshText == ""
    !insertmacro dshLog "Staged the new version in $dshNewDirectory for $dshFinalDirectory"
  ${else}
    !insertmacro dshLog "Staged files are missing: $dshText; the installation folder is unchanged"
    Call dshRollbackDirectories
    StrCpy $dshMessage "新版本文件不完整，缺少：$\r$\n$dshText$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessage安装目录保持原样，已安装的版本仍可使用。通常是安全软件删除或拦截了刚解压的文件，请在安全软件中放行后重新运行安装包：$\r$\n$EXEPATH$\r$\n"
    StrCpy $dshMessage "$dshMessage或从 ${DSH_DOWNLOAD_URL} 下载。用户数据不在安装目录中，不受影响。$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessageThe new version is incomplete. Missing:$\r$\n$dshText$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessageThe installation folder was left unchanged; an installed version keeps working. Security software usually removed or blocked the extracted files. Allow Setup in it, then run the installer again:$\r$\n$EXEPATH$\r$\n"
    StrCpy $dshMessage "$dshMessageor download it from ${DSH_DOWNLOAD_URL}. Your user data is stored outside the installation folder and is not affected.$\r$\n$\r$\n"
    StrCpy $dshMessage "$dshMessage安装日志 / Setup log:$\r$\n$dshInstallLog"
    MessageBox MB_OK|MB_ICONSTOP "$dshMessage" /SD IDOK
    SetErrorLevel 2
    !insertmacro dshQuit
  ${endIf}
!macroend

; dshExtractPayload has already rolled back the staging directory.
!macro customInstallerExtractFailed Archive
  !insertmacro dshLog "7-Zip exit code $R0 extracting ${Archive}; the installation folder is unchanged. Output: $R1"
  StrCpy $dshMessage "无法解压新版本（7-Zip 退出码 $R0）。$\r$\n$\r$\n"
  StrCpy $dshMessage "$dshMessage安装目录保持原样，已安装的版本仍可使用。通常是磁盘空间不足或安全软件拦截，请处理后重新运行安装包：$\r$\n$EXEPATH$\r$\n"
  StrCpy $dshMessage "$dshMessage或从 ${DSH_DOWNLOAD_URL} 下载。用户数据不在安装目录中，不受影响。$\r$\n$\r$\n"
  StrCpy $dshMessage "$dshMessageSetup could not extract the new version (7-Zip exit code $R0).$\r$\n$\r$\n"
  StrCpy $dshMessage "$dshMessageThe installation folder was left unchanged; an installed version keeps working. Low disk space or security software is the usual cause. Fix it, then run the installer again:$\r$\n$EXEPATH$\r$\n"
  StrCpy $dshMessage "$dshMessageor download it from ${DSH_DOWNLOAD_URL}. Your user data is stored outside the installation folder and is not affected.$\r$\n$\r$\n"
  StrCpy $dshMessage "$dshMessage安装日志 / Setup log:$\r$\n$dshInstallLog"
  MessageBox MB_OK|MB_ICONSTOP "$dshMessage" /SD IDOK
!macroend

; dshReportDirectoryFailure calls this after rollback. A failed restoration keeps
; the complete backup, which exit cleanup then leaves alone.
!macro customInstallerDirectoryFailed
  !insertmacro dshDescribeError $dshDirectoryError
  ; Every failed attempt is recorded below $PLUGINSDIR, which Setup deletes on exit.
  System::Call 'kernel32::CopyFileW(w "$PLUGINSDIR\directory-operations.log", w "$dshDirectoryLogDirectory\directory-operations.log", i 0)'
  !insertmacro dshLog "Cannot move $dshDirectorySource to $dshDirectoryDestination (Win32 error $dshDirectoryError: $dshErrorText); restore error $dshRestoreError; attempts in directory-operations.log"
  StrCpy $dshMessage "无法替换安装目录：$\r$\n$dshFinalDirectory$\r$\n系统错误 $dshDirectoryError：$dshErrorText$\r$\n$\r$\n"
  ${if} $dshRestoreError = 0
    StrCpy $dshMessage "$dshMessage安装目录保持原样，已安装的版本仍可使用。通常是仍在运行的程序、资源管理器窗口、编辑器或安全软件占用了安装目录中的文件，请关闭它们后重新运行安装包：$\r$\n$EXEPATH$\r$\n"
  ${else}
    StrCpy $dshMessage "$dshMessage旧版本未能移回原位置（系统错误 $dshRestoreError），它完整保存在：$\r$\n$dshOldDirectory$\r$\n请不要删除这个目录，带上安装日志联系我们后再重新安装。安装包：$\r$\n$EXEPATH$\r$\n"
  ${endIf}
  StrCpy $dshMessage "$dshMessage或从 ${DSH_DOWNLOAD_URL} 下载。用户数据不在安装目录中，不受影响。$\r$\n$\r$\n"
  StrCpy $dshMessage "$dshMessageSetup could not replace the installation folder:$\r$\n$dshFinalDirectory$\r$\nSystem error $dshDirectoryError: $dshErrorText$\r$\n$\r$\n"
  ${if} $dshRestoreError = 0
    StrCpy $dshMessage "$dshMessageThe installation folder was left unchanged; an installed version keeps working. A running program, a File Explorer window, an editor or security software usually has files in the installation folder open. Close them, then run the installer again:$\r$\n$EXEPATH$\r$\n"
  ${else}
    StrCpy $dshMessage "$dshMessageThe previous version could not be moved back (system error $dshRestoreError). It is complete in:$\r$\n$dshOldDirectory$\r$\nDo not delete this folder; contact us with the Setup log before reinstalling. Installer:$\r$\n$EXEPATH$\r$\n"
  ${endIf}
  StrCpy $dshMessage "$dshMessageor download it from ${DSH_DOWNLOAD_URL}. Your user data is stored outside the installation folder and is not affected.$\r$\n$\r$\n"
  StrCpy $dshMessage "$dshMessage安装日志 / Setup log:$\r$\n$dshInstallLog"
  MessageBox MB_OK|MB_ICONSTOP "$dshMessage" /SD IDOK
!macroend
