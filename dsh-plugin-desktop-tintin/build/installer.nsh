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
    ; The patched builder macros match TinTin.exe, not every executable
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

; ── 卸载可选段：同时删除用户数据（2026-10-12 用户裁决：默认不勾选）──────────
; 组件勾选页由模板在感知到本宏时自动启用（installer.nsi → MUI_UNPAGE_COMPONENTS，
; 宏经文件前置对 !ifmacrodef 可见）。范围=本产品自有用户数据：
;   $PROFILE\.dsh-tintin（TinTin 通道 home：config.json/会话/素材引用）
;   $PROFILE\.dsh（共享 home：settings.yaml/profiles/storages）
;   $APPDATA\tintin（Roaming 运行数据/日志）
; 不碰 %APPDATA%\tintin-client-electron（旧客户端遗留=首启迁移源）。
; DSH_HOME 环境变量重定向的 home 也一并删除（未设则跳过）。
; 段名用字面量（不用 LangString）：builder 语言表随版本变化（实测先越南语后泰语），
; LangString 缺语言表项=警告 6040，而 makensis 警告即错误——字面量永零警告。
!macro customUnInstallSection
  Section /o "同时删除用户数据（服务器配置/会话/素材库引用）" un.sec.DeleteUserData
    DetailPrint "Deleting user data: $PROFILE\.dsh-tintin"
    RMDir /r "$PROFILE\.dsh-tintin"
    DetailPrint "Deleting user data: $PROFILE\.dsh"
    RMDir /r "$PROFILE\.dsh"
    DetailPrint "Deleting user data: $APPDATA\tintin"
    RMDir /r "$APPDATA\tintin"
    ReadEnvStr $R0 "DSH_HOME"
    ${If} $R0 != ""
      DetailPrint "Deleting user data: $R0"
      RMDir /r "$R0"
    ${EndIf}
  SectionEnd
!macroend
