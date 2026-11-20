# Optional Host recovery / 可选 Host 自动恢复

## 中文

Beta 和 Next 默认仍在 Host 故障后打开恢复助手。需要自动恢复时，在启动应用的环境中设置 `DSH_DESKTOP_AUTO_RECOVER_HOST=1`。例如 Windows PowerShell：

```powershell
$env:DSH_DESKTOP_AUTO_RECOVER_HOST = '1'
& 'C:\path\to\DSH Desktop Beta.exe'
```

这项选择只对从该环境启动的应用生效；删除环境变量并完全退出、重新启动即可关闭。macOS/Linux 可在启动命令前加 `DSH_DESKTOP_AUTO_RECOVER_HOST=1`；macOS 经 LaunchServices 重启时采用系统提供的环境，终端临时设置的变量不保证保留。

已成功启动的 Host 在运行期间失败时，应用按 1、2、4 秒的等待时间尝试整体重启，每 15 分钟最多 3 次。次数保存在正常 Electron 用户数据目录的 `host-recovery.json`，重新启动应用不会清零。达到上限、状态损坏或无法写入时，仍打开恢复助手。启动失败、安全模式、恢复模式、设置向导和正常退出不触发自动重启；手动恢复操作会取消等待中的重启。

重启沿用应用现有的关闭流程，等待 Host 清理和故障报告保存；关闭失败或超时则退出，不启动另一个 Host。原有诊断证据仍保留，日志额外记录 `host.recovery.*` 事件。

恢复代码不重新发送 `session/prompt`，也不恢复或重放工具调用。它会重新启动应用和已配置的插件；插件自身的启动行为、计划任务不由此开关改变。中断的任务需要用户检查后决定是否继续，未保存的界面状态可能丢失。

这改善的是 Host 失败后的可用性，并不修复所有崩溃原因，也不保证任务连续执行。Stable 2.0.13 使用不同的启动架构，此开关不适用于该版本。

## English

Beta and Next still open the recovery assistant on Host failure by default. To opt in to automatic recovery, set `DSH_DESKTOP_AUTO_RECOVER_HOST=1` in the environment used to launch the application. The PowerShell example above sets it only for that shell and its children. Remove the variable and fully quit/reopen the app to disable it. On macOS/Linux, prefix the launch command with `DSH_DESKTOP_AUTO_RECOVER_HOST=1`. A macOS relaunch through LaunchServices receives the system's launch environment; a temporary terminal variable is not guaranteed to survive that handoff.

A Host failure after successful startup schedules a whole-app restart after 1, 2, then 4 seconds, limited to three attempts in a rolling 15-minute window. `host-recovery.json` in the normal Electron user-data directory retains the budget across application launches. An exhausted budget, invalid state or a failed write falls back to the existing recovery assistant. Startup failures, Safe Mode, recovery mode, onboarding and normal shutdown do not automatically restart. Manual recovery cancels a pending restart.

The existing shutdown path waits for Host cleanup and the failure report before relaunching. Failed or timed-out shutdown exits without starting another Host. Existing diagnostic evidence remains available, with additional `host.recovery.*` events.

Recovery never resends `session/prompt` or resumes/replays a tool call. It restarts the application and configured plugins; plugins' own startup behavior and scheduled jobs are unchanged. Review interrupted work before deciding to continue it. Unsaved window state may be lost.

This improves availability after a Host failure; it does not fix every crash cause or promise uninterrupted tasks. Stable 2.0.13 uses a different startup architecture and does not support this switch.
