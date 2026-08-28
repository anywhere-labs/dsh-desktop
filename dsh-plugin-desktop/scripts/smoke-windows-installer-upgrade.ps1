param(
  [Parameter(Mandatory = $true)]
  [string]$BaseInstaller,

  [Parameter(Mandatory = $true)]
  [string]$CandidateInstaller
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This smoke test requires Windows.'
}

$taskBaseInstaller = (Resolve-Path -LiteralPath $BaseInstaller).Path
$taskCandidateInstaller = (Resolve-Path -LiteralPath $CandidateInstaller).Path
$taskBaseExpectedVersion = (Get-Item -LiteralPath $taskBaseInstaller).VersionInfo.ProductVersion
$taskCandidateExpectedVersion = (Get-Item -LiteralPath $taskCandidateInstaller).VersionInfo.ProductVersion
$taskExistingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -ieq 'DSH Desktop.exe'
})
$taskUninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$taskExistingInstalls = @(Get-ItemProperty $taskUninstallRoots -ErrorAction SilentlyContinue | Where-Object {
  $_.DisplayName -match '^DSH Desktop'
})

if ($taskExistingProcesses.Count -gt 0 -or $taskExistingInstalls.Count -gt 0) {
  throw 'Refusing to run while an existing DSH Desktop process or installation is present.'
}

$taskTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$taskRoot = Join-Path $taskTempRoot ("dsh-installer-upgrade-" + [guid]::NewGuid().ToString('N'))
$taskInstallRoot = Join-Path $taskRoot 'app'
$taskUserData = Join-Path $env:APPDATA 'DSH Desktop'
$taskDshHome = Join-Path $taskRoot 'dsh-home'
$taskActiveRunMarker = Join-Path $taskUserData 'crash-evidence\active-run.json'
$taskAppPath = Join-Path $taskInstallRoot 'DSH Desktop.exe'
$taskUninstallerPath = Join-Path $taskInstallRoot 'Uninstall DSH Desktop.exe'
if (Test-Path -LiteralPath $taskActiveRunMarker) {
  throw 'Refusing to overwrite an existing DSH Desktop active run marker.'
}
$taskResult = [ordered]@{
  scenario = 'temporary install and DSH_HOME: 2.0.2 to 2.0.3 upgrade and fixed-version overwrite'
  testRoot = $taskRoot
  baseInstaller = $taskBaseInstaller
  baseInstallerSha256 = (Get-FileHash -LiteralPath $taskBaseInstaller -Algorithm SHA256).Hash
  baseExpectedVersion = $taskBaseExpectedVersion
  candidateInstaller = $taskCandidateInstaller
  candidateInstallerSha256 = (Get-FileHash -LiteralPath $taskCandidateInstaller -Algorithm SHA256).Hash
  candidateExpectedVersion = $taskCandidateExpectedVersion
  desktopUserData = $taskUserData
  baseInstallExitCode = $null
  baseInstallElapsedMs = $null
  baseInstalledVersion = $null
  baseProcessId = $null
  baseProcessStarted = $false
  upgradeExitCode = $null
  upgradeElapsedMs = $null
  upgradedVersion = $null
  baseProcessStopped = $false
  candidateProcessId = $null
  candidateProcessStarted = $false
  activeRunMarkerObserved = $false
  overwriteExitCode = $null
  overwriteElapsedMs = $null
  overwriteVersion = $null
  activeRunMarkerCleared = $false
  candidateProcessStopped = $false
  uninstallExitCode = $null
  installRootRemoved = $false
  uninstallEntryRemoved = $false
  shortcutsRemoved = $false
  testProcessesRemaining = $null
  activeRunMarkerAbsentAfterCleanup = $false
  error = $null
  success = $false
}

function Start-TaskInstaller([string]$taskInstallerPath) {
  $taskStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $taskProcess = Start-Process -FilePath $taskInstallerPath -ArgumentList @(
    '/S'
    '/currentuser'
    "/D=$taskInstallRoot"
  ) -PassThru -Wait -WindowStyle Hidden
  $taskStopwatch.Stop()
  return [ordered]@{
    exitCode = $taskProcess.ExitCode
    elapsedMs = $taskStopwatch.ElapsedMilliseconds
  }
}

function Start-TaskDesktop {
  $taskStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $taskStartInfo.FileName = $taskAppPath
  $taskStartInfo.WorkingDirectory = $taskInstallRoot
  $taskStartInfo.UseShellExecute = $false
  $taskStartInfo.EnvironmentVariables['DSH_HOME'] = $taskDshHome
  $taskStartInfo.EnvironmentVariables['ELECTRON_ENABLE_LOGGING'] = '1'
  return [System.Diagnostics.Process]::Start($taskStartInfo)
}

function Wait-TaskProcess([bool]$taskShouldExist, [int]$taskTimeoutSeconds = 30) {
  $taskDeadline = [DateTime]::UtcNow.AddSeconds($taskTimeoutSeconds)
  do {
    $taskMatches = @(Get-CimInstance Win32_Process | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.Equals($taskAppPath, [System.StringComparison]::OrdinalIgnoreCase)
    })
    if (($taskMatches.Count -gt 0) -eq $taskShouldExist) {
      return $taskMatches
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  throw "Timed out waiting for DSH Desktop process state: shouldExist=$taskShouldExist"
}

function Wait-TaskActiveRunMarker([bool]$taskShouldExist, [int]$taskTimeoutSeconds = 30) {
  $taskDeadline = [DateTime]::UtcNow.AddSeconds($taskTimeoutSeconds)
  do {
    $taskMarkerExists = Test-Path -LiteralPath $taskActiveRunMarker
    if ($taskMarkerExists -eq $taskShouldExist) {
      return $taskActiveRunMarker
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  throw "Timed out waiting for active-run marker state: shouldExist=$taskShouldExist"
}

function ConvertTo-TaskVersion([string]$taskVersion) {
  $taskParsedVersion = [version]$taskVersion
  return [version]::new(
    $taskParsedVersion.Major,
    $taskParsedVersion.Minor,
    [Math]::Max(0, $taskParsedVersion.Build),
    [Math]::Max(0, $taskParsedVersion.Revision)
  )
}

function Test-TaskVersionEquals([string]$taskActualVersion, [string]$taskExpectedVersion) {
  return (ConvertTo-TaskVersion $taskActualVersion) -eq (ConvertTo-TaskVersion $taskExpectedVersion)
}

try {
  New-Item -ItemType Directory -Path $taskRoot | Out-Null

  $taskBaseInstall = Start-TaskInstaller $taskBaseInstaller
  $taskResult.baseInstallExitCode = $taskBaseInstall.exitCode
  $taskResult.baseInstallElapsedMs = $taskBaseInstall.elapsedMs
  if ($taskBaseInstall.exitCode -ne 0 -or -not (Test-Path -LiteralPath $taskAppPath)) {
    throw "Base installer failed with exit code $($taskBaseInstall.exitCode)."
  }
  $taskResult.baseInstalledVersion = (Get-Item -LiteralPath $taskAppPath).VersionInfo.ProductVersion
  if (-not (Test-TaskVersionEquals $taskResult.baseInstalledVersion $taskBaseExpectedVersion)) {
    throw "Expected base version $taskBaseExpectedVersion but installed $($taskResult.baseInstalledVersion)."
  }

  $taskBaseProcess = Start-TaskDesktop
  Wait-TaskProcess $true | Out-Null
  $taskResult.baseProcessId = $taskBaseProcess.Id
  $taskResult.baseProcessStarted = -not $taskBaseProcess.HasExited

  $taskUpgrade = Start-TaskInstaller $taskCandidateInstaller
  $taskResult.upgradeExitCode = $taskUpgrade.exitCode
  $taskResult.upgradeElapsedMs = $taskUpgrade.elapsedMs
  if ($taskUpgrade.exitCode -ne 0) {
    throw "Candidate upgrade failed with exit code $($taskUpgrade.exitCode)."
  }
  Wait-TaskProcess $false | Out-Null
  $taskResult.baseProcessStopped = $true
  $taskResult.upgradedVersion = (Get-Item -LiteralPath $taskAppPath).VersionInfo.ProductVersion
  if (-not (Test-TaskVersionEquals $taskResult.upgradedVersion $taskCandidateExpectedVersion)) {
    throw "Expected upgraded version $taskCandidateExpectedVersion but installed $($taskResult.upgradedVersion)."
  }

  $taskCandidateProcess = Start-TaskDesktop
  Wait-TaskProcess $true | Out-Null
  $taskResult.candidateProcessId = $taskCandidateProcess.Id
  $taskResult.candidateProcessStarted = -not $taskCandidateProcess.HasExited
  Wait-TaskActiveRunMarker $true | Out-Null
  $taskResult.activeRunMarkerObserved = $true

  $taskOverwrite = Start-TaskInstaller $taskCandidateInstaller
  $taskResult.overwriteExitCode = $taskOverwrite.exitCode
  $taskResult.overwriteElapsedMs = $taskOverwrite.elapsedMs
  if ($taskOverwrite.exitCode -ne 0) {
    throw "Candidate overwrite failed with exit code $($taskOverwrite.exitCode)."
  }
  Wait-TaskProcess $false | Out-Null
  $taskResult.candidateProcessStopped = $true
  Wait-TaskActiveRunMarker $false | Out-Null
  $taskResult.activeRunMarkerCleared = $true
  $taskResult.overwriteVersion = (Get-Item -LiteralPath $taskAppPath).VersionInfo.ProductVersion
  if (-not (Test-TaskVersionEquals $taskResult.overwriteVersion $taskCandidateExpectedVersion)) {
    throw "Expected overwrite version $taskCandidateExpectedVersion but installed $($taskResult.overwriteVersion)."
  }
} catch {
  $taskResult.error = $_.Exception.Message
} finally {
  $taskTestProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
      $taskInstallRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  })
  foreach ($taskProcess in $taskTestProcesses) {
    Stop-Process -Id $taskProcess.ProcessId -Force -ErrorAction SilentlyContinue
  }

  if (Test-Path -LiteralPath $taskUninstallerPath) {
    $taskUninstaller = Start-Process -FilePath $taskUninstallerPath -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    $taskResult.uninstallExitCode = $taskUninstaller.ExitCode
  }

  Start-Sleep -Milliseconds 500
  $taskResolvedRoot = [System.IO.Path]::GetFullPath($taskRoot)
  if (-not $taskResolvedRoot.StartsWith($taskTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not ([System.IO.Path]::GetFileName($taskResolvedRoot)).StartsWith('dsh-installer-upgrade-', [System.StringComparison]::Ordinal)) {
    throw "Refusing to remove unexpected test path: $taskResolvedRoot"
  }
  if ($taskResult.uninstallExitCode -eq 0 -and (Test-Path -LiteralPath $taskResolvedRoot)) {
    Remove-Item -LiteralPath $taskResolvedRoot -Recurse -Force
  }
  $taskResult.installRootRemoved = -not (Test-Path -LiteralPath $taskResolvedRoot)

  $taskRemainingProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith(
      $taskInstallRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  })
  $taskResult.testProcessesRemaining = $taskRemainingProcesses.Count

  $taskRemainingInstalls = @(Get-ItemProperty $taskUninstallRoots -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -match '^DSH Desktop'
  })
  $taskResult.uninstallEntryRemoved = $taskRemainingInstalls.Count -eq 0

  $taskShortcutRoots = @(
    [Environment]::GetFolderPath('Desktop')
    [Environment]::GetFolderPath('StartMenu')
    [Environment]::GetFolderPath('CommonDesktopDirectory')
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  $taskRemainingShortcuts = @($taskShortcutRoots | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Filter '*DSH Desktop*' -Recurse -ErrorAction SilentlyContinue
  })
  $taskResult.shortcutsRemoved = $taskRemainingShortcuts.Count -eq 0

  if (Test-Path -LiteralPath $taskActiveRunMarker) {
    try {
      $taskMarkerRecord = Get-Content -LiteralPath $taskActiveRunMarker -Raw | ConvertFrom-Json
      if ($taskMarkerRecord.pid -eq $taskResult.baseProcessId -or
          $taskMarkerRecord.pid -eq $taskResult.candidateProcessId) {
        Remove-Item -LiteralPath $taskActiveRunMarker -Force
      }
    } catch {}
  }
  $taskResult.activeRunMarkerAbsentAfterCleanup = -not (Test-Path -LiteralPath $taskActiveRunMarker)
}

$taskResult.success = (
  $null -eq $taskResult.error -and
  $taskResult.baseInstallExitCode -eq 0 -and
  (Test-TaskVersionEquals $taskResult.baseInstalledVersion $taskBaseExpectedVersion) -and
  $taskResult.baseProcessStarted -and
  $taskResult.upgradeExitCode -eq 0 -and
  (Test-TaskVersionEquals $taskResult.upgradedVersion $taskCandidateExpectedVersion) -and
  $taskResult.baseProcessStopped -and
  $taskResult.candidateProcessStarted -and
  $taskResult.activeRunMarkerObserved -and
  $taskResult.overwriteExitCode -eq 0 -and
  (Test-TaskVersionEquals $taskResult.overwriteVersion $taskCandidateExpectedVersion) -and
  $taskResult.candidateProcessStopped -and
  $taskResult.activeRunMarkerCleared -and
  $taskResult.uninstallExitCode -eq 0 -and
  $taskResult.installRootRemoved -and
  $taskResult.uninstallEntryRemoved -and
  $taskResult.shortcutsRemoved -and
  $taskResult.testProcessesRemaining -eq 0 -and
  $taskResult.activeRunMarkerAbsentAfterCleanup
)

$taskResult | ConvertTo-Json
if (-not $taskResult.success) {
  exit 1
}
