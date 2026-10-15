; Check the exact app process before launching the quit handoff. This preserves
; the #469 fix: unrelated helpers under $INSTDIR must never block an upgrade.
Var pid

!macro customCheckAppRunning
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

; Chromium starts its GPU and renderer processes under a sandbox token that must
; read the install tree through ALL RESTRICTED APPLICATION PACKAGES
; (S-1-15-2-2). The default ACL inherited under %LOCALAPPDATA%\Programs or a
; custom directory such as D:\apps normally passes, but once any parent carries
; an ACE for a specific AppContainer package SID (S-1-15-2-*, whether left
; behind by an uninstalled package or still registered) the same check fails:
; every sandboxed child dies with 0x80000003 while it maps ICU data, the GPU
; process restarts until Chromium exits, and no window ever appears (#1366,
; #333, electron/electron#51761). Chrome's installer grants this read access for
; the same reason. One inheritable ACE on $INSTDIR reaches every installed file;
; it adds read/execute only and removes nothing.
!ifndef BUILD_UNINSTALLER
  Var dshSandboxGrant
!endif

!macro dshGrantSandboxRead
  Push $0
  Push $1
  ; Only touch the application's own folder. A silent /D= can name any
  ; directory (even a drive root), and an inheritable grant there would hand
  ; AppContainer processes read access to unrelated files.
  StrLen $0 "\${APP_FILENAME}"
  IntOp $0 0 - $0
  StrCpy $1 "$INSTDIR" "" $0
  ${if} $1 == "\${APP_FILENAME}"
    DetailPrint "Granting sandbox read access to $INSTDIR"
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /C /Q'
    Pop $0
    ${if} $0 != 0
      ; Never fail the install over this: the app still starts on machines
      ; whose inherited ACL is clean, which is almost all of them.
      DetailPrint "Could not grant sandbox read access (icacls result: $0)"
    ${endIf}
  ${else}
    DetailPrint "Skipped sandbox read access: $INSTDIR is not a ${APP_FILENAME} folder"
  ${endIf}
  StrCpy $dshSandboxGrant "done"
  Pop $1
  Pop $0
!macroend

; Preferred path: patches/app-builder-lib@26.15.7.patch calls this after the old
; version is uninstalled and before extraction, so every extracted file inherits
; the ACE as it is created instead of the system re-propagating ~28k files later
; (measured: about +6 s on a 47 s install when applied afterwards).
!macro dshPrepareInstallDir
  !insertmacro dshGrantSandboxRead
!macroend

; Fallback: if a builder upgrade ever drops the extraction hook, still grant
; after extraction. Correctness never depends on the patch, only speed does.
!macro customInstall
  ${if} $dshSandboxGrant != "done"
    !insertmacro dshGrantSandboxRead
  ${endIf}
!macroend
