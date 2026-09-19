param(
  [string]$BaseManifest,
  [string]$CandidateManifest,
  [ValidateSet('Benchmark', 'Faults', 'All', 'PrepareColdSnapshot')]
  [string]$Mode = 'All',
  [ValidateRange(1, 20)]
  [int]$Iterations = 1,
  [ValidateRange(30, 3600)]
  [int]$InstallerTimeoutSeconds = 900,
  [ValidateRange(10, 900)]
  [int]$FaultTimeoutSeconds = 120,
  [ValidateSet('Direct', 'Staged', 'Both')]
  [string]$Variant = 'Both',
  [ValidateSet('FreshInstall', 'Upgrade', 'Both')]
  [string]$BenchmarkCase = 'Both',
  [ValidateSet('WarmBatch', 'ColdSnapshot')]
  [string]$CacheRegime = 'WarmBatch',
  [ValidateSet('Direct', 'Staged')]
  [string]$CanonicalBaseVariant = 'Direct',
  [string]$ColdSnapshotStatePath,
  [switch]$ConfirmFreshSnapshot,
  [switch]$AllowNonUpgrade,
  [string]$OutputPath,
  [switch]$RequireFaultCoherence
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  [ordered]@{
    schemaVersion = 2
    skipped = $true
    reason = 'Windows NSIS A/B measurements require a disposable native Windows VM.'
    success = $true
  } | ConvertTo-Json
  exit 0
}

if ([string]::IsNullOrWhiteSpace($BaseManifest) -or [string]::IsNullOrWhiteSpace($CandidateManifest)) {
  throw '-BaseManifest and -CandidateManifest are required on Windows.'
}

$taskScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$taskInspector = Join-Path $taskScriptRoot 'inspect-windows-installed-app.ts'
$taskRuntimeProbe = Join-Path $taskScriptRoot 'probe-windows-packaged-runtime.ts'
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$taskUninstallerRelativePath = 'Uninstall DSH Desktop.exe'
$taskUninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)

function Get-TaskInstallEntries {
  return @(Get-ItemProperty $taskUninstallRoots -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -match '^DSH Desktop(?:$|\s)'
  })
}

function Get-TaskShortcuts {
  $taskRoots = @(
    [Environment]::GetFolderPath('Desktop')
    [Environment]::GetFolderPath('StartMenu')
    [Environment]::GetFolderPath('CommonDesktopDirectory')
    [Environment]::GetFolderPath('CommonStartMenu')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  return @($taskRoots | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Filter 'DSH Desktop*.lnk' -Recurse -File -ErrorAction SilentlyContinue
  })
}

function Test-TaskPathIsBelow([string]$taskPath, [string]$taskRoot) {
  try {
    $taskFullPath = [System.IO.Path]::GetFullPath($taskPath)
    $taskFullRoot = [System.IO.Path]::GetFullPath($taskRoot).TrimEnd(
      [System.IO.Path]::DirectorySeparatorChar,
      [System.IO.Path]::AltDirectorySeparatorChar
    ) + [System.IO.Path]::DirectorySeparatorChar
    return $taskFullPath.StartsWith($taskFullRoot, [System.StringComparison]::OrdinalIgnoreCase)
  } catch {
    return $false
  }
}

function Get-TaskShortcutsForInstallation([string]$taskInstallRoot) {
  $taskShell = New-Object -ComObject WScript.Shell
  try {
    return @(Get-TaskShortcuts | Where-Object {
      try {
        $taskTarget = [string]$taskShell.CreateShortcut($_.FullName).TargetPath
        $taskTarget -and (Test-TaskPathIsBelow $taskTarget $taskInstallRoot)
      } catch {
        $false
      }
    })
  } finally {
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell)
  }
}

function Get-TaskInstallEntriesForInstallation([string]$taskInstallRoot) {
  return @(Get-TaskInstallEntries | Where-Object {
    $taskLocation = [string]$_.InstallLocation
    $taskUninstallString = [string]$_.UninstallString
    ($taskLocation -and $taskLocation.Trim('"').Equals(
      $taskInstallRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )) -or ($taskUninstallString -and $taskUninstallString.IndexOf(
      $taskInstallRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    ) -ge 0)
  })
}

function Assert-TaskMachineIsClean {
  $taskProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'DSH Desktop.exe' })
  $taskEntries = @(Get-TaskInstallEntries)
  $taskShortcuts = @(Get-TaskShortcuts)
  if ($taskProcesses.Count -gt 0 -or $taskEntries.Count -gt 0 -or $taskShortcuts.Count -gt 0) {
    throw 'Refusing to run outside a clean VM: an existing DSH Desktop process, install entry, or shortcut is present.'
  }
}

function Read-TaskManifest([string]$taskPath) {
  $taskResolved = (Resolve-Path -LiteralPath $taskPath).Path
  $taskValue = Get-Content -LiteralPath $taskResolved -Raw | ConvertFrom-Json
  if ($taskValue.schemaVersion -ne 2 -or $taskValue.electronBuilderVersion -ne '26.15.7') {
    throw "Unsupported NSIS A/B manifest: $taskResolved"
  }
  foreach ($taskVariant in @('direct', 'staged')) {
    if ($null -eq $taskValue.variants.PSObject.Properties[$taskVariant]) {
      throw "NSIS A/B manifest is missing variant $taskVariant`: $taskResolved"
    }
  }
  return [pscustomobject]@{
    Path = $taskResolved
    Root = Split-Path -Parent $taskResolved
    Value = $taskValue
  }
}

function Resolve-TaskManifestPath($taskManifest, [string]$taskRelativePath) {
  if ([System.IO.Path]::IsPathRooted($taskRelativePath)) {
    throw "Manifest path must be relative: $taskRelativePath"
  }
  $taskRoot = [System.IO.Path]::GetFullPath($taskManifest.Root)
  $taskResolved = [System.IO.Path]::GetFullPath((Join-Path $taskRoot $taskRelativePath))
  $taskPrefix = $taskRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $taskResolved.StartsWith($taskPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Manifest path escapes its directory: $taskRelativePath"
  }
  return $taskResolved
}

function Get-TaskVariant($taskManifest, [string]$taskVariant, [bool]$taskSkipInstallerHash = $false) {
  $taskEntry = $taskManifest.Value.variants.PSObject.Properties[$taskVariant].Value
  $taskInstaller = Resolve-TaskManifestPath $taskManifest $taskEntry.installer.path
  if (-not (Test-Path -LiteralPath $taskInstaller -PathType Leaf)) {
    throw "Installer from manifest does not exist: $taskInstaller"
  }
  $taskManifestHash = ([string]$taskEntry.installer.sha256).ToLowerInvariant()
  $taskActualHash = $taskManifestHash
  if (-not $taskSkipInstallerHash) {
    $taskActualHash = (Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($taskActualHash -ne $taskManifestHash) {
      throw "Installer hash does not match its manifest: $taskInstaller"
    }
  }
  return [pscustomobject]@{
    Name = $taskVariant
    Extraction = $taskEntry.extraction
    Installer = $taskInstaller
    InstallerSha256 = $taskActualHash
    InstallerHashVerifiedInThisRun = -not $taskSkipInstallerHash
    ExpectedApplicationSha256 = ([string]$taskManifest.Value.application.tree.treeSha256).ToLowerInvariant()
    ExpectedResourcesSha256 = ([string]$taskManifest.Value.application.resources.treeSha256).ToLowerInvariant()
    ExpectedAppAsarSha256 = ([string]$taskManifest.Value.application.appAsar.sha256).ToLowerInvariant()
    ExpectedUnpackedTreeSha256 = if ($null -eq $taskManifest.Value.application.unpacked) {
      $null
    } else {
      ([string]$taskManifest.Value.application.unpacked.treeSha256).ToLowerInvariant()
    }
    AppVersion = [string]$taskManifest.Value.appVersion
    Provenance = $taskManifest.Value.provenance
  }
}

function Write-TaskJsonFile([string]$taskPath, $taskValue, [bool]$taskRefuseExisting = $false) {
  $taskFullPath = [System.IO.Path]::GetFullPath($taskPath)
  if ($taskRefuseExisting -and (Test-Path -LiteralPath $taskFullPath)) {
    throw "Refusing to overwrite existing evidence: $taskFullPath"
  }
  $taskDirectory = Split-Path -Parent $taskFullPath
  if (-not (Test-Path -LiteralPath $taskDirectory)) {
    New-Item -ItemType Directory -Path $taskDirectory | Out-Null
  }
  Set-Content -LiteralPath $taskFullPath -Value ($taskValue | ConvertTo-Json -Depth 20) -Encoding UTF8
  return $taskFullPath
}

function Stop-TaskProcessTree([int]$taskProcessId) {
  $taskExisting = Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue
  if ($null -eq $taskExisting) {
    return [pscustomobject]@{ requested = $false; taskkillExitCode = $null; processExited = $true }
  }
  $taskTaskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
  & $taskTaskkill /PID $taskProcessId /T /F 2>&1 | Out-Null
  $taskExitCode = $LASTEXITCODE
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    if ($null -eq (Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  $taskExited = $null -eq (Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue)
  if ($taskExitCode -ne 0 -or -not $taskExited) {
    throw "Failed to terminate process tree $taskProcessId (taskkill=$taskExitCode, exited=$taskExited)."
  }
  return [pscustomobject]@{ requested = $true; taskkillExitCode = $taskExitCode; processExited = $taskExited }
}

function Invoke-TaskInstaller([string]$taskInstaller, [string]$taskInstallRoot, [int]$taskTimeoutSeconds) {
  $taskStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $taskProcess = Start-Process -FilePath $taskInstaller -ArgumentList @(
    '/S'
    '/currentuser'
    "/D=$taskInstallRoot"
  ) -PassThru -WindowStyle Hidden
  $taskCompleted = $taskProcess.WaitForExit($taskTimeoutSeconds * 1000)
  $taskTermination = $null
  if (-not $taskCompleted) {
    $taskTermination = Stop-TaskProcessTree $taskProcess.Id
    if (-not $taskProcess.WaitForExit(10000)) {
      throw "Timed-out installer process $($taskProcess.Id) did not exit after taskkill."
    }
  }
  $taskStopwatch.Stop()
  $taskProcess.Refresh()
  return [pscustomobject]@{
    processId = $taskProcess.Id
    completed = $taskCompleted
    timedOut = -not $taskCompleted
    exitCode = if ($taskCompleted) { $taskProcess.ExitCode } else { $null }
    elapsedMs = $taskStopwatch.ElapsedMilliseconds
    termination = $taskTermination
  }
}

function ConvertFrom-TaskJson([string]$taskOutput, [string]$taskLabel) {
  try {
    return $taskOutput | ConvertFrom-Json
  } catch {
    throw "$taskLabel did not return JSON: $taskOutput"
  }
}

function Invoke-TaskInspection([string]$taskInstallRoot, [string[]]$taskIgnoredRelativePaths = @()) {
  $taskArguments = @($taskInspector, '--install-root', $taskInstallRoot)
  foreach ($taskIgnoredPath in $taskIgnoredRelativePaths) {
    $taskArguments += @('--ignore-relative-path', $taskIgnoredPath)
  }
  $taskOutput = (& $taskNode @taskArguments 2>&1 | Out-String).Trim()
  $taskExitCode = $LASTEXITCODE
  return [pscustomobject]@{
    exitCode = $taskExitCode
    report = ConvertFrom-TaskJson $taskOutput 'installed app inspection'
  }
}

function Invoke-TaskStartupProbe([string]$taskInstallRoot) {
  $taskOutput = (& $taskNode $taskRuntimeProbe --install-root $taskInstallRoot 2>&1 | Out-String).Trim()
  $taskExitCode = $LASTEXITCODE
  return [pscustomobject]@{
    exitCode = $taskExitCode
    report = ConvertFrom-TaskJson $taskOutput 'packaged app startup probe'
  }
}

function Add-TaskUpgradeSentinel([string]$taskInstallRoot) {
  $taskUnpacked = Join-Path $taskInstallRoot 'resources\app.asar.unpacked'
  if (-not (Test-Path -LiteralPath $taskUnpacked -PathType Container)) {
    New-Item -ItemType Directory -Path $taskUnpacked | Out-Null
  }
  $taskOldCount = @(Get-ChildItem -LiteralPath $taskUnpacked -Recurse -File -Force).Count
  $taskSentinel = Join-Path $taskUnpacked ('.dsh-nsis-ab-old-sentinel-' + [guid]::NewGuid().ToString('N'))
  Set-Content -LiteralPath $taskSentinel -Value 'This file must not survive a normal upgrade.' -Encoding Ascii
  return [pscustomobject]@{
    path = $taskSentinel
    relativePath = 'resources/app.asar.unpacked/' + [System.IO.Path]::GetFileName($taskSentinel)
    oldUnpackedFileCount = $taskOldCount
  }
}

function Get-TaskContentState($taskInspection, $taskBase, $taskCandidate) {
  $taskHash = $taskInspection.report.application.treeSha256
  if ($null -eq $taskHash) { return 'unknown' }
  $taskNormalized = ([string]$taskHash).ToLowerInvariant()
  if ($taskNormalized -eq $taskCandidate.ExpectedApplicationSha256) { return 'candidate' }
  if ($taskNormalized -eq $taskBase.ExpectedApplicationSha256) { return 'base' }
  return 'mixed-or-corrupt'
}

function Compare-TaskSemver([string]$taskLeft, [string]$taskRight) {
  $taskPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$'
  $taskLeftMatch = [regex]::Match($taskLeft, $taskPattern)
  $taskRightMatch = [regex]::Match($taskRight, $taskPattern)
  if (-not $taskLeftMatch.Success -or -not $taskRightMatch.Success) {
    throw "A/B app versions must be SemVer values: base=$taskRight candidate=$taskLeft"
  }
  foreach ($taskIndex in 1..3) {
    $taskLeftPart = [int64]$taskLeftMatch.Groups[$taskIndex].Value
    $taskRightPart = [int64]$taskRightMatch.Groups[$taskIndex].Value
    if ($taskLeftPart -gt $taskRightPart) { return 1 }
    if ($taskLeftPart -lt $taskRightPart) { return -1 }
  }
  $taskLeftPre = $taskLeftMatch.Groups[4].Value
  $taskRightPre = $taskRightMatch.Groups[4].Value
  if (-not $taskLeftPre -and -not $taskRightPre) { return 0 }
  if (-not $taskLeftPre) { return 1 }
  if (-not $taskRightPre) { return -1 }
  $taskLeftParts = @($taskLeftPre.Split('.'))
  $taskRightParts = @($taskRightPre.Split('.'))
  $taskLimit = [Math]::Max($taskLeftParts.Count, $taskRightParts.Count)
  for ($taskIndex = 0; $taskIndex -lt $taskLimit; $taskIndex++) {
    if ($taskIndex -ge $taskLeftParts.Count) { return -1 }
    if ($taskIndex -ge $taskRightParts.Count) { return 1 }
    $taskLeftIdentifier = $taskLeftParts[$taskIndex]
    $taskRightIdentifier = $taskRightParts[$taskIndex]
    $taskLeftNumeric = $taskLeftIdentifier -match '^\d+$'
    $taskRightNumeric = $taskRightIdentifier -match '^\d+$'
    if ($taskLeftNumeric -and $taskRightNumeric) {
      $taskComparison = ([System.Numerics.BigInteger]::Parse($taskLeftIdentifier)).CompareTo(
        [System.Numerics.BigInteger]::Parse($taskRightIdentifier)
      )
    } elseif ($taskLeftNumeric) {
      $taskComparison = -1
    } elseif ($taskRightNumeric) {
      $taskComparison = 1
    } else {
      $taskComparison = [string]::CompareOrdinal($taskLeftIdentifier, $taskRightIdentifier)
    }
    if ($taskComparison -gt 0) { return 1 }
    if ($taskComparison -lt 0) { return -1 }
  }
  return 0
}

function Invoke-TaskPayloadVerification(
  [string]$taskInstallRoot,
  $taskExpected,
  [string[]]$taskIgnoredRelativePaths = @()
) {
  $taskInspection = Invoke-TaskInspection $taskInstallRoot $taskIgnoredRelativePaths
  $taskStartup = Invoke-TaskStartupProbe $taskInstallRoot
  $taskApplicationHash = [string]$taskInspection.report.application.treeSha256
  $taskResourcesHash = [string]$taskInspection.report.resources.treeSha256
  $taskAsarHash = [string]$taskInspection.report.appAsar.sha256
  $taskUnpackedHash = if ($null -eq $taskInspection.report.unpacked) {
    $null
  } else {
    [string]$taskInspection.report.unpacked.treeSha256
  }
  $taskUnpackedMatches = if ($null -eq $taskExpected.ExpectedUnpackedTreeSha256) {
    $null -eq $taskInspection.report.unpacked
  } else {
    $taskUnpackedHash -eq $taskExpected.ExpectedUnpackedTreeSha256
  }
  $taskStartupSucceeded = $taskStartup.exitCode -eq 0 -and [bool]$taskStartup.report.success
  $taskSuccess = $taskInspection.exitCode -eq 0 -and [bool]$taskInspection.report.valid -and
    $taskApplicationHash -eq $taskExpected.ExpectedApplicationSha256 -and
    $taskResourcesHash -eq $taskExpected.ExpectedResourcesSha256 -and
    $taskAsarHash -eq $taskExpected.ExpectedAppAsarSha256 -and
    $taskUnpackedMatches -and $taskStartupSucceeded
  return [pscustomobject]@{
    success = $taskSuccess
    inspectionExitCode = $taskInspection.exitCode
    inspectionErrors = @($taskInspection.report.errors)
    applicationTreeSha256 = $taskApplicationHash
    applicationMatchesExpected = $taskApplicationHash -eq $taskExpected.ExpectedApplicationSha256
    resourcesTreeSha256 = $taskResourcesHash
    resourcesMatchExpected = $taskResourcesHash -eq $taskExpected.ExpectedResourcesSha256
    appAsarReadable = [bool]$taskInspection.report.valid
    appAsarSha256 = $taskAsarHash
    appAsarMatchesExpected = $taskAsarHash -eq $taskExpected.ExpectedAppAsarSha256
    unpackedTreeSha256 = $taskUnpackedHash
    unpackedFileCount = $taskInspection.report.unpacked.fileCount
    unpackedMatchesExpected = $taskUnpackedMatches
    startupSucceeded = $taskStartupSucceeded
    startup = $taskStartup.report
    inspection = $taskInspection
  }
}

function Remove-TaskInstallation([string]$taskRoot, [string]$taskInstallRoot) {
  $taskProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and (Test-TaskPathIsBelow $_.ExecutablePath $taskInstallRoot)
  })
  foreach ($taskProcess in $taskProcesses) {
    Stop-TaskProcessTree $taskProcess.ProcessId | Out-Null
  }

  $taskUninstallExitCode = $null
  $taskUninstallError = $null
  $taskUninstaller = Join-Path $taskInstallRoot 'Uninstall DSH Desktop.exe'
  if (Test-Path -LiteralPath $taskUninstaller -PathType Leaf) {
    try {
      $taskUninstall = Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
      if ($taskUninstall.WaitForExit(120000)) {
        $taskUninstallExitCode = $taskUninstall.ExitCode
      } else {
        Stop-TaskProcessTree $taskUninstall.Id | Out-Null
        if (-not $taskUninstall.WaitForExit(10000)) {
          throw "Uninstaller process $($taskUninstall.Id) did not exit after taskkill."
        }
      }
    } catch {
      $taskUninstallError = $_.Exception.Message
    }
  }
  Start-Sleep -Milliseconds 500

  foreach ($taskEntry in @(Get-TaskInstallEntriesForInstallation $taskInstallRoot)) {
    Remove-Item -LiteralPath $taskEntry.PSPath -Recurse -Force -ErrorAction SilentlyContinue
  }
  foreach ($taskShortcut in @(Get-TaskShortcutsForInstallation $taskInstallRoot)) {
    Remove-Item -LiteralPath $taskShortcut.FullName -Force -ErrorAction SilentlyContinue
  }

  $taskResolvedRoot = [System.IO.Path]::GetFullPath($taskRoot)
  if (-not $taskResolvedRoot.StartsWith($taskTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not ([System.IO.Path]::GetFileName($taskResolvedRoot)).StartsWith('dsh-nsis-ab-', [System.StringComparison]::Ordinal)) {
    throw "Refusing to remove unexpected lab path: $taskResolvedRoot"
  }
  if (Test-Path -LiteralPath $taskResolvedRoot) {
    Remove-Item -LiteralPath $taskResolvedRoot -Recurse -Force
  }
  return [pscustomobject]@{
    uninstallExitCode = $taskUninstallExitCode
    uninstallError = $taskUninstallError
    testRootRemoved = -not (Test-Path -LiteralPath $taskResolvedRoot)
    installEntriesRemaining = @(Get-TaskInstallEntriesForInstallation $taskInstallRoot).Count
    shortcutsRemaining = @(Get-TaskShortcutsForInstallation $taskInstallRoot).Count
    globalDshProcessesRemaining = @(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -ieq 'DSH Desktop.exe'
    }).Count
    globalInstallEntriesRemaining = @(Get-TaskInstallEntries).Count
    globalShortcutsRemaining = @(Get-TaskShortcuts).Count
  }
}

function New-TaskCaseRoot([string]$taskKind) {
  $taskRoot = Join-Path $taskTempRoot ("dsh-nsis-ab-$taskKind-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $taskRoot | Out-Null
  return $taskRoot
}

function Get-TaskColdArtifactEvidence($taskVariants) {
  return [pscustomobject]@{
    appVersion = $taskVariants.direct.AppVersion
    applicationTreeSha256 = $taskVariants.direct.ExpectedApplicationSha256
    resourcesTreeSha256 = $taskVariants.direct.ExpectedResourcesSha256
    appAsarSha256 = $taskVariants.direct.ExpectedAppAsarSha256
    unpackedTreeSha256 = $taskVariants.direct.ExpectedUnpackedTreeSha256
    installers = [pscustomobject]@{
      direct = $taskVariants.direct.InstallerSha256
      staged = $taskVariants.staged.InstallerSha256
    }
  }
}

function Assert-TaskColdArtifactEvidence($taskRecorded, $taskCurrent, [string]$taskLabel) {
  foreach ($taskProperty in @(
    'appVersion',
    'applicationTreeSha256',
    'resourcesTreeSha256',
    'appAsarSha256',
    'unpackedTreeSha256'
  )) {
    if ([string]$taskRecorded.$taskProperty -ne [string]$taskCurrent.$taskProperty) {
      throw "Cold snapshot $taskLabel evidence no longer matches its manifest: $taskProperty"
    }
  }
  foreach ($taskVariant in @('direct', 'staged')) {
    if ([string]$taskRecorded.installers.$taskVariant -ne [string]$taskCurrent.installers.$taskVariant) {
      throw "Cold snapshot $taskLabel installer evidence no longer matches its manifest: $taskVariant"
    }
  }
}

function New-TaskColdSnapshotPreparation($taskBaseVariants, $taskCandidateVariants) {
  if ([string]::IsNullOrWhiteSpace($ColdSnapshotStatePath)) {
    throw '-ColdSnapshotStatePath is required when preparing a cold snapshot.'
  }
  Assert-TaskMachineIsClean
  $taskStatePath = [System.IO.Path]::GetFullPath($ColdSnapshotStatePath)
  $taskPreparationToken = [guid]::NewGuid().ToString('N')
  $taskCaseKind = @($taskSelectedBenchmarkKinds)[0]
  $taskCaseRoot = $null
  $taskInstallRoot = $null
  $taskBasePreparation = $null
  $taskBaseVerification = $null
  $taskSentinel = $null
  try {
    if ($taskCaseKind -eq 'upgrade') {
      $taskCanonicalVariant = $CanonicalBaseVariant.ToLowerInvariant()
      $taskCanonicalBase = $taskBaseVariants[$taskCanonicalVariant]
      $taskCaseRoot = New-TaskCaseRoot 'cold-upgrade-canonical-base'
      $taskInstallRoot = Join-Path $taskCaseRoot 'app'
      if (Test-TaskPathIsBelow $taskStatePath $taskCaseRoot) {
        throw 'Cold snapshot state must be stored outside the prepared installation root.'
      }
      $taskBasePreparation = Invoke-TaskInstaller $taskCanonicalBase.Installer `
        $taskInstallRoot $InstallerTimeoutSeconds
      if (-not $taskBasePreparation.completed -or $taskBasePreparation.exitCode -ne 0) {
        throw 'Canonical base installer failed while preparing the cold upgrade snapshot.'
      }
      $taskBaseVerification = Invoke-TaskPayloadVerification $taskInstallRoot $taskCanonicalBase `
        @($taskUninstallerRelativePath)
      if (-not $taskBaseVerification.success) {
        throw 'Canonical base failed full application-tree or packaged-runtime verification.'
      }
      $taskSentinel = Add-TaskUpgradeSentinel $taskInstallRoot
    }

    $taskState = [ordered]@{
      schemaVersion = 1
      kind = 'dsh-nsis-ab-cold-snapshot-preparation'
      preparationToken = $taskPreparationToken
      createdAt = [DateTime]::UtcNow.ToString('o')
      readyForPoweredOffSnapshot = $true
      benchmarkCase = $taskCaseKind
      canonicalBaseVariant = if ($taskCaseKind -eq 'upgrade') {
        $CanonicalBaseVariant.ToLowerInvariant()
      } else {
        $null
      }
      base = Get-TaskColdArtifactEvidence $taskBaseVariants
      candidate = Get-TaskColdArtifactEvidence $taskCandidateVariants
      caseRoot = $taskCaseRoot
      installRoot = $taskInstallRoot
      sentinelPath = if ($null -eq $taskSentinel) { $null } else { $taskSentinel.path }
      sentinelRelativePath = if ($null -eq $taskSentinel) { $null } else { $taskSentinel.relativePath }
      oldUnpackedFileCount = if ($null -eq $taskSentinel) { $null } else { $taskSentinel.oldUnpackedFileCount }
      basePreparation = $taskBasePreparation
      baseVerification = $taskBaseVerification
      instructions = 'Power off the VM, take the canonical snapshot, then restore it before each single-case measurement.'
    }
    $taskWrittenStatePath = Write-TaskJsonFile $taskStatePath $taskState $true
    return [pscustomobject]@{
      success = $true
      statePath = $taskWrittenStatePath
      preparation = [pscustomobject]$taskState
    }
  } catch {
    if ($null -ne $taskCaseRoot) {
      Remove-TaskInstallation $taskCaseRoot $taskInstallRoot | Out-Null
    }
    throw
  }
}

function Read-TaskColdSnapshotPreparation($taskBaseVariants, $taskCandidateVariants) {
  if ([string]::IsNullOrWhiteSpace($ColdSnapshotStatePath)) {
    throw '-ColdSnapshotStatePath is required for a formal ColdSnapshot measurement.'
  }
  $taskStatePath = (Resolve-Path -LiteralPath $ColdSnapshotStatePath).Path
  $taskState = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
  $taskExpectedBenchmarkCase = @($taskSelectedBenchmarkKinds)[0]
  if (
    $taskState.schemaVersion -ne 1 -or
    $taskState.kind -ne 'dsh-nsis-ab-cold-snapshot-preparation' -or
    -not [bool]$taskState.readyForPoweredOffSnapshot -or
    ([string]$taskState.preparationToken) -notmatch '^[0-9a-f]{32}$' -or
    $taskState.benchmarkCase -ne $taskExpectedBenchmarkCase
  ) {
    throw "Invalid or mismatched cold snapshot preparation evidence: $taskStatePath"
  }
  Assert-TaskColdArtifactEvidence $taskState.base `
    (Get-TaskColdArtifactEvidence $taskBaseVariants) 'base'
  Assert-TaskColdArtifactEvidence $taskState.candidate `
    (Get-TaskColdArtifactEvidence $taskCandidateVariants) 'candidate'

  if ($taskState.benchmarkCase -eq 'upgrade') {
    $taskCaseRoot = [System.IO.Path]::GetFullPath([string]$taskState.caseRoot)
    $taskInstallRoot = [System.IO.Path]::GetFullPath([string]$taskState.installRoot)
    $taskSentinelPath = [System.IO.Path]::GetFullPath([string]$taskState.sentinelPath)
    if (
      -not ([System.IO.Path]::GetFileName($taskCaseRoot)).StartsWith(
        'dsh-nsis-ab-cold-upgrade-canonical-base-',
        [System.StringComparison]::Ordinal
      ) -or
      -not $taskCaseRoot.StartsWith($taskTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not (Test-TaskPathIsBelow $taskInstallRoot $taskCaseRoot) -or
      -not (Test-TaskPathIsBelow $taskSentinelPath $taskInstallRoot) -or
      (Test-TaskPathIsBelow $taskStatePath $taskCaseRoot) -or
      -not (Test-Path -LiteralPath (Join-Path $taskInstallRoot 'DSH Desktop.exe') -PathType Leaf) -or
      -not (Test-Path -LiteralPath (Join-Path $taskInstallRoot 'resources\app.asar') -PathType Leaf) -or
      -not (Test-Path -LiteralPath $taskSentinelPath -PathType Leaf)
    ) {
      throw 'Restored canonical base installation does not match its cold snapshot preparation evidence.'
    }
    $taskProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'DSH Desktop.exe' })
    $taskExpectedEntryPaths = @(Get-TaskInstallEntriesForInstallation $taskInstallRoot | `
      ForEach-Object { [string]$_.PSPath })
    $taskForeignEntries = @(Get-TaskInstallEntries | Where-Object {
      $taskExpectedEntryPaths -notcontains [string]$_.PSPath
    })
    $taskAllShortcuts = @(Get-TaskShortcuts)
    $taskExpectedShortcutPaths = @(Get-TaskShortcutsForInstallation $taskInstallRoot | `
      ForEach-Object { [string]$_.FullName })
    $taskForeignShortcuts = @($taskAllShortcuts | Where-Object {
      $taskExpectedShortcutPaths -notcontains [string]$_.FullName
    })
    if ($taskProcesses.Count -gt 0 -or $taskForeignEntries.Count -gt 0 -or $taskForeignShortcuts.Count -gt 0) {
      throw 'Cold upgrade snapshot contains DSH state outside the prepared canonical base installation.'
    }
  } else {
    Assert-TaskMachineIsClean
  }
  return [pscustomobject]@{
    path = $taskStatePath
    value = $taskState
  }
}

function Invoke-TaskBenchmarkCase(
  [string]$taskKind,
  $taskBase,
  $taskCandidate,
  [int]$taskIteration,
  $taskColdPreparation = $null
) {
  $taskUsesPreparedBase = $taskKind -eq 'upgrade' -and $null -ne $taskColdPreparation
  $taskRoot = if ($taskUsesPreparedBase) {
    [string]$taskColdPreparation.value.caseRoot
  } else {
    New-TaskCaseRoot "benchmark-$taskKind"
  }
  $taskInstallRoot = if ($taskUsesPreparedBase) {
    [string]$taskColdPreparation.value.installRoot
  } else {
    Join-Path $taskRoot 'app'
  }
  $taskResult = [ordered]@{
    kind = $taskKind
    variant = $taskCandidate.Name
    extraction = $taskCandidate.Extraction
    iteration = $taskIteration
    baseVersion = $taskBase.AppVersion
    candidateVersion = $taskCandidate.AppVersion
    coldSnapshotPreparationToken = if ($taskUsesPreparedBase) {
      [string]$taskColdPreparation.value.preparationToken
    } else {
      $null
    }
    basePreparation = $null
    baseVerification = $null
    measurement = $null
    oldUnpackedFileCount = $null
    oldResidualSentinelPresent = $null
    installedContentState = $null
    installedApplicationTreeSha256 = $null
    applicationTreeMatchesCandidate = $false
    appAsarReadable = $false
    installedAppAsarSha256 = $null
    appAsarMatchesCandidate = $false
    installedUnpackedTreeSha256 = $null
    installedUnpackedFileCount = $null
    unpackedTreeMatchesCandidate = $false
    startupSucceeded = $false
    cleanup = $null
    error = $null
    success = $false
  }
  try {
    if ($taskKind -eq 'upgrade') {
      if ($taskUsesPreparedBase) {
        $taskResult.basePreparation = $taskColdPreparation.value.basePreparation
        $taskResult.baseVerification = $taskColdPreparation.value.baseVerification
        $taskSentinel = [pscustomobject]@{
          path = [string]$taskColdPreparation.value.sentinelPath
          relativePath = [string]$taskColdPreparation.value.sentinelRelativePath
          oldUnpackedFileCount = $taskColdPreparation.value.oldUnpackedFileCount
        }
      } else {
        $taskResult.basePreparation = Invoke-TaskInstaller $taskBase.Installer $taskInstallRoot $InstallerTimeoutSeconds
        if (-not $taskResult.basePreparation.completed -or $taskResult.basePreparation.exitCode -ne 0) {
          throw 'Base installer failed before the upgrade measurement.'
        }
        $taskResult.baseVerification = Invoke-TaskPayloadVerification $taskInstallRoot $taskBase `
          @($taskUninstallerRelativePath)
        if (-not $taskResult.baseVerification.success) {
          throw 'Base installation failed full application-tree or packaged-runtime verification.'
        }
        $taskSentinel = Add-TaskUpgradeSentinel $taskInstallRoot
      }
      $taskResult.oldUnpackedFileCount = $taskSentinel.oldUnpackedFileCount
      $taskResult.measurement = Invoke-TaskInstaller $taskCandidate.Installer $taskInstallRoot $InstallerTimeoutSeconds
      $taskResult.oldResidualSentinelPresent = Test-Path -LiteralPath $taskSentinel.path
    } else {
      $taskResult.measurement = Invoke-TaskInstaller $taskCandidate.Installer $taskInstallRoot $InstallerTimeoutSeconds
    }
    if (-not $taskResult.measurement.completed -or $taskResult.measurement.exitCode -ne 0) {
      throw 'Measured installer did not complete successfully.'
    }
    $taskInspection = Invoke-TaskInspection $taskInstallRoot @($taskUninstallerRelativePath)
    $taskResult.installedContentState = Get-TaskContentState $taskInspection $taskBase $taskCandidate
    $taskResult.installedApplicationTreeSha256 = $taskInspection.report.application.treeSha256
    $taskResult.applicationTreeMatchesCandidate = $taskResult.installedApplicationTreeSha256 -eq `
      $taskCandidate.ExpectedApplicationSha256
    $taskResult.appAsarReadable = [bool]$taskInspection.report.valid
    $taskResult.installedAppAsarSha256 = $taskInspection.report.appAsar.sha256
    $taskResult.appAsarMatchesCandidate = $taskResult.installedAppAsarSha256 -eq $taskCandidate.ExpectedAppAsarSha256
    $taskResult.installedUnpackedTreeSha256 = $taskInspection.report.unpacked.treeSha256
    $taskResult.installedUnpackedFileCount = $taskInspection.report.unpacked.fileCount
    $taskResult.unpackedTreeMatchesCandidate = $taskResult.installedUnpackedTreeSha256 -eq `
      $taskCandidate.ExpectedUnpackedTreeSha256
    $taskStartup = Invoke-TaskStartupProbe $taskInstallRoot
    $taskResult.startupSucceeded = $taskStartup.exitCode -eq 0 -and [bool]$taskStartup.report.success
    if ($taskKind -eq 'upgrade' -and $taskResult.oldResidualSentinelPresent) {
      throw 'Normal upgrade retained the old unpacked sentinel.'
    }
    if ($taskResult.installedContentState -ne 'candidate' -or -not $taskResult.applicationTreeMatchesCandidate) {
      throw "Installed application is $($taskResult.installedContentState), not the candidate payload."
    }
    if (-not $taskResult.appAsarReadable -or -not $taskResult.appAsarMatchesCandidate -or
        -not $taskResult.unpackedTreeMatchesCandidate -or -not $taskResult.startupSucceeded) {
      throw 'Installed candidate failed ASAR or startup verification.'
    }
  } catch {
    $taskResult.error = $_.Exception.Message
  } finally {
    $taskResult.cleanup = Remove-TaskInstallation $taskRoot $taskInstallRoot
  }
  $taskResult.success = $null -eq $taskResult.error -and $taskResult.cleanup.testRootRemoved -and
    $taskResult.cleanup.installEntriesRemaining -eq 0 -and $taskResult.cleanup.shortcutsRemaining -eq 0 -and
    $taskResult.cleanup.globalDshProcessesRemaining -eq 0 -and
    $taskResult.cleanup.globalInstallEntriesRemaining -eq 0 -and
    $taskResult.cleanup.globalShortcutsRemaining -eq 0
  return [pscustomobject]$taskResult
}

function Get-TaskProcessSnapshot {
  return @(Get-CimInstance Win32_Process | Select-Object `
    ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, CreationDate)
}

function Get-TaskProcessTreeIds([int]$taskRootProcessId, $taskProcesses = $null) {
  if ($null -eq $taskProcesses) {
    $taskProcesses = Get-TaskProcessSnapshot
  }
  [int[]]$taskIds = @($taskRootProcessId)
  do {
    $taskAdded = $false
    foreach ($taskProcess in $taskProcesses) {
      if ($taskIds -contains [int]$taskProcess.ParentProcessId -and
          $taskIds -notcontains [int]$taskProcess.ProcessId) {
        $taskIds += [int]$taskProcess.ProcessId
        $taskAdded = $true
      }
    }
  } while ($taskAdded)
  return $taskIds
}

function Get-TaskRelatedInstallerProcesses(
  $taskProcesses,
  [int]$taskRootProcessId,
  [int[]]$taskObservedProcessIds,
  [string]$taskInstaller,
  [string]$taskInstallRoot
) {
  [int[]]$taskTreeIds = @(Get-TaskProcessTreeIds $taskRootProcessId $taskProcesses)
  return @($taskProcesses | Where-Object {
    $taskProcessId = [int]$_.ProcessId
    $taskExecutable = [string]$_.ExecutablePath
    $taskCommandLine = [string]$_.CommandLine
    $taskTreeIds -contains $taskProcessId -or
      $taskObservedProcessIds -contains $taskProcessId -or
      ($taskExecutable -and $taskExecutable.Equals($taskInstaller, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($taskCommandLine -and $taskCommandLine.IndexOf(
        $taskInstallRoot,
        [System.StringComparison]::OrdinalIgnoreCase
      ) -ge 0)
  })
}

function Stop-TaskTrackedInstallerProcesses(
  [int]$taskRootProcessId,
  [int[]]$taskObservedProcessIds,
  [string]$taskInstaller,
  [string]$taskInstallRoot
) {
  $taskKillEvidence = @()
  $taskObserved = @($taskObservedProcessIds)
  $taskQuietSince = $null
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(15)
  do {
    $taskSnapshot = Get-TaskProcessSnapshot
    $taskRelated = @(Get-TaskRelatedInstallerProcesses $taskSnapshot $taskRootProcessId `
      @($taskObserved) $taskInstaller $taskInstallRoot | Where-Object { [int]$_.ProcessId -ne $PID })
    foreach ($taskProcess in $taskRelated) {
      $taskProcessId = [int]$taskProcess.ProcessId
      if ($taskObserved -notcontains $taskProcessId) { $taskObserved += $taskProcessId }
      try {
        $taskTermination = Stop-TaskProcessTree $taskProcessId
        $taskKillEvidence += [pscustomobject]@{
          processId = $taskProcessId
          parentProcessId = [int]$taskProcess.ParentProcessId
          name = [string]$taskProcess.Name
          executablePath = [string]$taskProcess.ExecutablePath
          creationDate = [string]$taskProcess.CreationDate
          requested = [bool]$taskTermination.requested
          taskkillExitCode = $taskTermination.taskkillExitCode
          processExited = [bool]$taskTermination.processExited
          error = $null
        }
      } catch {
        $taskStillAlive = $null -ne (Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue)
        $taskKillEvidence += [pscustomobject]@{
          processId = $taskProcessId
          parentProcessId = [int]$taskProcess.ParentProcessId
          name = [string]$taskProcess.Name
          executablePath = [string]$taskProcess.ExecutablePath
          creationDate = [string]$taskProcess.CreationDate
          requested = $true
          taskkillExitCode = $null
          processExited = -not $taskStillAlive
          error = $_.Exception.Message
        }
        if ($taskStillAlive) { throw }
      }
    }

    $taskRemainingSnapshot = Get-TaskProcessSnapshot
    $taskRemaining = @(Get-TaskRelatedInstallerProcesses $taskRemainingSnapshot $taskRootProcessId `
      @($taskObserved) $taskInstaller $taskInstallRoot | Where-Object { [int]$_.ProcessId -ne $PID })
    if ($taskRemaining.Count -eq 0) {
      if ($null -eq $taskQuietSince) { $taskQuietSince = [DateTime]::UtcNow }
      if (([DateTime]::UtcNow - $taskQuietSince).TotalSeconds -ge 2) { break }
    } else {
      $taskQuietSince = $null
    }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $taskDeadline)

  $taskFinalSnapshot = Get-TaskProcessSnapshot
  $taskFinalRemaining = @(Get-TaskRelatedInstallerProcesses $taskFinalSnapshot $taskRootProcessId `
    @($taskObserved) $taskInstaller $taskInstallRoot | Where-Object { [int]$_.ProcessId -ne $PID })
  return [pscustomobject]@{
    confirmed = $taskFinalRemaining.Count -eq 0 -and
      $null -ne $taskQuietSince -and
      @($taskKillEvidence | Where-Object { $_.requested -and $_.taskkillExitCode -eq 0 }).Count -gt 0
    quietWindowMs = if ($null -eq $taskQuietSince) {
      0
    } else {
      [Math]::Floor(([DateTime]::UtcNow - $taskQuietSince).TotalMilliseconds)
    }
    observedProcessIds = @($taskObserved | Sort-Object -Unique)
    killEvidence = $taskKillEvidence
    remainingProcesses = @($taskFinalRemaining | Select-Object `
      ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate)
  }
}

function Get-TaskInstallTreeFingerprint([string]$taskInstallRoot) {
  if (-not (Test-Path -LiteralPath $taskInstallRoot -PathType Container)) {
    return [pscustomobject]@{ sha256 = '<missing>'; fileCount = 0; directoryCount = 0; totalBytes = 0 }
  }
  $taskRoot = [System.IO.Path]::GetFullPath($taskInstallRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $taskPrefixLength = $taskRoot.Length + 1
  $taskLines = New-Object 'System.Collections.Generic.List[string]'
  [long]$taskTotalBytes = 0
  [int]$taskFileCount = 0
  [int]$taskDirectoryCount = 0
  foreach ($taskEntry in @(Get-ChildItem -LiteralPath $taskRoot -Recurse -Force -ErrorAction Stop | `
      Sort-Object FullName)) {
    $taskRelative = $taskEntry.FullName.Substring($taskPrefixLength).Replace('\', '/')
    if ($taskEntry.PSIsContainer) {
      $taskDirectoryCount++
      [void]$taskLines.Add("D|$taskRelative")
    } else {
      $taskFileCount++
      $taskTotalBytes += [long]$taskEntry.Length
      $taskFileHash = (Get-FileHash -LiteralPath $taskEntry.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      [void]$taskLines.Add("F|$taskRelative|$($taskEntry.Length)|$taskFileHash")
    }
  }
  $taskHasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $taskPayload = [System.Text.Encoding]::UTF8.GetBytes(($taskLines -join "`n"))
    $taskDigest = ([System.BitConverter]::ToString($taskHasher.ComputeHash($taskPayload))).Replace('-', '').ToLowerInvariant()
  } finally {
    $taskHasher.Dispose()
  }
  return [pscustomobject]@{
    sha256 = $taskDigest
    fileCount = $taskFileCount
    directoryCount = $taskDirectoryCount
    totalBytes = $taskTotalBytes
  }
}

function Confirm-TaskInstallTreeStable([string]$taskInstallRoot) {
  $taskObservations = @()
  $taskPrevious = $null
  $taskStableSince = $null
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    $taskObservedAt = [DateTime]::UtcNow
    $taskCurrent = Get-TaskInstallTreeFingerprint $taskInstallRoot
    $taskObservations += [pscustomobject]@{
      observedAt = $taskObservedAt.ToString('o')
      sha256 = $taskCurrent.sha256
      fileCount = $taskCurrent.fileCount
      directoryCount = $taskCurrent.directoryCount
      totalBytes = $taskCurrent.totalBytes
    }
    if ($null -eq $taskPrevious -or $taskPrevious.sha256 -ne $taskCurrent.sha256) {
      $taskStableSince = $taskObservedAt
    } elseif (([DateTime]::UtcNow - $taskStableSince).TotalSeconds -ge 2) {
      return [pscustomobject]@{
        confirmed = $true
        stableWindowMs = [Math]::Floor(([DateTime]::UtcNow - $taskStableSince).TotalMilliseconds)
        finalFingerprint = $taskCurrent
        observations = $taskObservations
      }
    }
    $taskPrevious = $taskCurrent
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  return [pscustomobject]@{
    confirmed = $false
    stableWindowMs = 0
    finalFingerprint = $taskPrevious
    observations = $taskObservations
  }
}

function Invoke-TaskInterruptedInstaller([string]$taskInstaller, [string]$taskInstallRoot, [string]$taskAsar) {
  $taskOriginal = Get-Item -LiteralPath $taskAsar
  $taskOriginalLength = $taskOriginal.Length
  $taskOriginalWrite = $taskOriginal.LastWriteTimeUtc
  $taskProcess = Start-Process -FilePath $taskInstaller -ArgumentList @('/S', '/currentuser', "/D=$taskInstallRoot") `
    -PassThru -WindowStyle Hidden
  $taskStopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $taskDeadline = [DateTime]::UtcNow.AddSeconds($FaultTimeoutSeconds)
  $taskSawMissing = $false
  $taskMutationObserved = $false
  $taskInjectionConfirmed = $false
  $taskTermination = $null
  $taskTreeStability = $null
  $taskProcessEvidenceAtInjection = @()
  $taskExitedBeforeInjection = $false
  [int[]]$taskObservedProcessIds = @($taskProcess.Id)
  [int[]]$taskProcessTreeIds = @()
  while ([DateTime]::UtcNow -lt $taskDeadline) {
    $taskSnapshot = Get-TaskProcessSnapshot
    $taskActive = @(Get-TaskRelatedInstallerProcesses $taskSnapshot $taskProcess.Id `
      @($taskObservedProcessIds) $taskInstaller $taskInstallRoot | Where-Object { [int]$_.ProcessId -ne $PID })
    foreach ($taskActiveProcess in $taskActive) {
      $taskActiveId = [int]$taskActiveProcess.ProcessId
      if ($taskObservedProcessIds -notcontains $taskActiveId) { $taskObservedProcessIds += $taskActiveId }
    }
    if ($taskActive.Count -eq 0) {
      $taskExitedBeforeInjection = $true
      break
    }
    if (-not (Test-Path -LiteralPath $taskAsar)) {
      $taskSawMissing = $true
    } else {
      $taskCurrent = Get-Item -LiteralPath $taskAsar
      if ($taskSawMissing -or $taskCurrent.Length -ne $taskOriginalLength -or
          $taskCurrent.LastWriteTimeUtc -ne $taskOriginalWrite) {
        $taskMutationObserved = $true
        $taskProcessEvidenceAtInjection = @($taskActive | Select-Object `
          ProcessId, ParentProcessId, Name, ExecutablePath, CreationDate)
        $taskProcessTreeIds = @($taskProcessEvidenceAtInjection | ForEach-Object { [int]$_.ProcessId })
        $taskTermination = Stop-TaskTrackedInstallerProcesses $taskProcess.Id `
          @($taskObservedProcessIds) $taskInstaller $taskInstallRoot
        $taskTreeStability = Confirm-TaskInstallTreeStable $taskInstallRoot
        $taskInjectionConfirmed = [bool]$taskTermination.confirmed -and [bool]$taskTreeStability.confirmed
        break
      }
    }
    Start-Sleep -Milliseconds 10
  }
  $taskProcess.Refresh()
  $taskFinalActive = @(Get-TaskRelatedInstallerProcesses (Get-TaskProcessSnapshot) $taskProcess.Id `
    @($taskObservedProcessIds) $taskInstaller $taskInstallRoot | Where-Object { [int]$_.ProcessId -ne $PID })
  if ($taskFinalActive.Count -gt 0) {
    $taskDeadlineTermination = Stop-TaskTrackedInstallerProcesses $taskProcess.Id `
      @($taskObservedProcessIds) $taskInstaller $taskInstallRoot
    if ($null -eq $taskTermination) { $taskTermination = $taskDeadlineTermination }
  }
  if (-not $taskProcess.WaitForExit(10000)) {
    throw "Installer process $($taskProcess.Id) did not exit after the interruption probe."
  }
  $taskStopwatch.Stop()
  return [pscustomobject]@{
    processId = $taskProcess.Id
    mutationObserved = $taskMutationObserved
    sawTargetMissing = $taskSawMissing
    injectionConfirmed = $taskInjectionConfirmed
    processTreeIdsAtInjection = $taskProcessTreeIds
    observedProcessIds = @($taskObservedProcessIds | Sort-Object -Unique)
    processEvidenceAtInjection = $taskProcessEvidenceAtInjection
    termination = $taskTermination
    installTreeStability = $taskTreeStability
    elapsedMs = $taskStopwatch.ElapsedMilliseconds
    processExitedBeforeInjection = $taskExitedBeforeInjection
  }
}

function Invoke-TaskFaultCase([string]$taskKind, $taskBase, $taskCandidate) {
  $taskRoot = New-TaskCaseRoot "fault-$taskKind"
  $taskInstallRoot = Join-Path $taskRoot 'app'
  $taskLock = $null
  $taskResult = [ordered]@{
    kind = $taskKind
    variant = $taskCandidate.Name
    extraction = $taskCandidate.Extraction
    controlledFault = if ($taskKind -eq 'locked-app-asar') { 'exclusive app.asar handle; old uninstaller/code-2 path may be exercised' } else { 'installer process tree killed after target mutation' }
    baseVersion = $taskBase.AppVersion
    candidateVersion = $taskCandidate.AppVersion
    basePreparation = $null
    baseVerification = $null
    faultInjection = $null
    oldUnpackedFileCount = $null
    oldResidualSentinelPresent = $null
    sentinelConsistentWithContentState = $false
    installedContentState = $null
    installedApplicationTreeSha256 = $null
    appAsarReadable = $false
    installedAppAsarSha256 = $null
    appAsarMatchesBase = $false
    appAsarMatchesCandidate = $false
    installedUnpackedTreeSha256 = $null
    installedUnpackedFileCount = $null
    unpackedTreeMatchesCandidate = $false
    startupSucceeded = $false
    coherentAfterFault = $false
    cleanup = $null
    harnessError = $null
    harnessCompleted = $false
  }
  try {
    $taskResult.basePreparation = Invoke-TaskInstaller $taskBase.Installer $taskInstallRoot $InstallerTimeoutSeconds
    if (-not $taskResult.basePreparation.completed -or $taskResult.basePreparation.exitCode -ne 0) {
      throw 'Base installer failed before fault injection.'
    }
    $taskResult.baseVerification = Invoke-TaskPayloadVerification $taskInstallRoot $taskBase `
      @($taskUninstallerRelativePath)
    if (-not $taskResult.baseVerification.success) {
      throw 'Base installation failed full application-tree or packaged-runtime verification.'
    }
    $taskSentinel = Add-TaskUpgradeSentinel $taskInstallRoot
    $taskResult.oldUnpackedFileCount = $taskSentinel.oldUnpackedFileCount
    $taskAsar = Join-Path $taskInstallRoot 'resources\app.asar'
    if ($taskKind -eq 'locked-app-asar') {
      $taskLock = [System.IO.File]::Open(
        $taskAsar,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::None
      )
      $taskResult.faultInjection = Invoke-TaskInstaller $taskCandidate.Installer $taskInstallRoot $FaultTimeoutSeconds
      $taskLock.Dispose()
      $taskLock = $null
    } else {
      $taskResult.faultInjection = Invoke-TaskInterruptedInstaller $taskCandidate.Installer $taskInstallRoot $taskAsar
      if (-not $taskResult.faultInjection.mutationObserved -or
          -not $taskResult.faultInjection.injectionConfirmed) {
        throw 'Installer finished or timed out before a target mutation could be demonstrably interrupted.'
      }
    }
    $taskResult.oldResidualSentinelPresent = Test-Path -LiteralPath $taskSentinel.path
    $taskInspection = Invoke-TaskInspection $taskInstallRoot @(
      $taskUninstallerRelativePath,
      $taskSentinel.relativePath
    )
    $taskResult.installedContentState = Get-TaskContentState $taskInspection $taskBase $taskCandidate
    $taskResult.installedApplicationTreeSha256 = $taskInspection.report.application.treeSha256
    $taskResult.appAsarReadable = [bool]$taskInspection.report.valid
    $taskResult.installedAppAsarSha256 = $taskInspection.report.appAsar.sha256
    $taskResult.appAsarMatchesBase = $taskResult.installedAppAsarSha256 -eq `
      $taskBase.ExpectedAppAsarSha256
    $taskResult.appAsarMatchesCandidate = $taskResult.installedAppAsarSha256 -eq `
      $taskCandidate.ExpectedAppAsarSha256
    $taskResult.installedUnpackedTreeSha256 = $taskInspection.report.unpacked.treeSha256
    $taskResult.installedUnpackedFileCount = $taskInspection.report.unpacked.fileCount
    $taskResult.unpackedTreeMatchesCandidate = $taskResult.installedUnpackedTreeSha256 -eq `
      $taskCandidate.ExpectedUnpackedTreeSha256
    if (Test-Path -LiteralPath (Join-Path $taskInstallRoot 'DSH Desktop.exe')) {
      $taskStartup = Invoke-TaskStartupProbe $taskInstallRoot
      $taskResult.startupSucceeded = $taskStartup.exitCode -eq 0 -and [bool]$taskStartup.report.success
    }
    $taskResult.sentinelConsistentWithContentState = `
      ($taskResult.installedContentState -eq 'base' -and $taskResult.oldResidualSentinelPresent) -or `
      ($taskResult.installedContentState -eq 'candidate' -and -not $taskResult.oldResidualSentinelPresent)
    $taskResult.coherentAfterFault = $taskResult.appAsarReadable -and $taskResult.startupSucceeded -and
      $taskResult.installedContentState -in @('base', 'candidate') -and
      $taskResult.sentinelConsistentWithContentState
  } catch {
    $taskResult.harnessError = $_.Exception.Message
  } finally {
    if ($null -ne $taskLock) { $taskLock.Dispose() }
    $taskResult.cleanup = Remove-TaskInstallation $taskRoot $taskInstallRoot
  }
  $taskResult.harnessCompleted = $null -eq $taskResult.harnessError -and $taskResult.cleanup.testRootRemoved -and
    $taskResult.cleanup.installEntriesRemaining -eq 0 -and $taskResult.cleanup.shortcutsRemaining -eq 0 -and
    $taskResult.cleanup.globalDshProcessesRemaining -eq 0 -and
    $taskResult.cleanup.globalInstallEntriesRemaining -eq 0 -and
    $taskResult.cleanup.globalShortcutsRemaining -eq 0
  return [pscustomobject]$taskResult
}

function Get-TaskMedian([long[]]$taskValues) {
  if ($taskValues.Count -eq 0) { return $null }
  $taskSorted = @($taskValues | Sort-Object)
  $taskMiddle = [Math]::Floor($taskSorted.Count / 2)
  if ($taskSorted.Count % 2 -eq 1) { return $taskSorted[$taskMiddle] }
  return [Math]::Round(($taskSorted[$taskMiddle - 1] + $taskSorted[$taskMiddle]) / 2)
}

$taskBaseManifest = Read-TaskManifest $BaseManifest
$taskCandidateManifest = Read-TaskManifest $CandidateManifest
$taskSelectedVariants = @(switch ($Variant) {
  'Direct' { @('direct') }
  'Staged' { @('staged') }
  default { @('direct', 'staged') }
})
$taskSelectedBenchmarkKinds = @(switch ($BenchmarkCase) {
  'FreshInstall' { @('fresh-install') }
  'Upgrade' { @('upgrade') }
  default { @('fresh-install', 'upgrade') }
})
if ($Mode -eq 'PrepareColdSnapshot') {
  if ($CacheRegime -ne 'ColdSnapshot' -or $Iterations -ne 1 -or $BenchmarkCase -eq 'Both' -or
      [string]::IsNullOrWhiteSpace($ColdSnapshotStatePath)) {
    throw 'PrepareColdSnapshot requires -CacheRegime ColdSnapshot, -Iterations 1, one -BenchmarkCase, and -ColdSnapshotStatePath.'
  }
} elseif ($CacheRegime -eq 'ColdSnapshot') {
  if ($Mode -ne 'Benchmark' -or $Iterations -ne 1 -or $Variant -eq 'Both' -or
      $BenchmarkCase -eq 'Both' -or -not $ConfirmFreshSnapshot -or
      [string]::IsNullOrWhiteSpace($ColdSnapshotStatePath)) {
    throw 'ColdSnapshot requires -Mode Benchmark, -Iterations 1, one -Variant, one -BenchmarkCase, -ColdSnapshotStatePath, and -ConfirmFreshSnapshot.'
  }
}
$taskBaseVariants = @{}
$taskCandidateVariants = @{}
$taskSkipInstallerHashes = $Mode -eq 'Benchmark' -and $CacheRegime -eq 'ColdSnapshot'
foreach ($taskVariant in @('direct', 'staged')) {
  $taskBaseVariants[$taskVariant] = Get-TaskVariant $taskBaseManifest $taskVariant $taskSkipInstallerHashes
  $taskCandidateVariants[$taskVariant] = Get-TaskVariant $taskCandidateManifest $taskVariant $taskSkipInstallerHashes
}
$taskVersionComparison = Compare-TaskSemver $taskCandidateVariants.direct.AppVersion `
  $taskBaseVariants.direct.AppVersion
$taskVersionRelationship = if ($taskVersionComparison -gt 0) {
  'ascending-upgrade'
} elseif ($taskVersionComparison -eq 0) {
  'same-version-repair'
} else {
  'downgrade'
}
$taskRunsUpgrade = $Mode -in @('Faults', 'All') -or $taskSelectedBenchmarkKinds -contains 'upgrade'
if ($taskRunsUpgrade -and $taskVersionComparison -le 0 -and -not $AllowNonUpgrade) {
  throw "Upgrade/fault cases require candidate > base; observed $taskVersionRelationship. Use -AllowNonUpgrade only for an explicitly labelled repair/downgrade experiment."
}

if ($Mode -eq 'PrepareColdSnapshot') {
  $taskPreparationResult = New-TaskColdSnapshotPreparation $taskBaseVariants $taskCandidateVariants
  $taskPreparationJson = $taskPreparationResult | ConvertTo-Json -Depth 20
  if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $taskUnusedPreparationOutput = Write-TaskJsonFile $OutputPath $taskPreparationResult $false
  }
  $taskPreparationJson
  exit 0
}

$taskColdPreparation = $null
if ($CacheRegime -eq 'ColdSnapshot') {
  $taskColdPreparation = Read-TaskColdSnapshotPreparation $taskBaseVariants $taskCandidateVariants
} else {
  Assert-TaskMachineIsClean
}

$taskBenchmarks = @()
$taskEnvironmentContaminated = $false
if ($Mode -in @('Benchmark', 'All')) {
  :taskBenchmarkLoop
  for ($taskIteration = 1; $taskIteration -le $Iterations; $taskIteration++) {
    $taskCaseOrder = @(
      [pscustomobject]@{ variant = 'direct'; kind = 'fresh-install' }
      [pscustomobject]@{ variant = 'staged'; kind = 'upgrade' }
      [pscustomobject]@{ variant = 'staged'; kind = 'fresh-install' }
      [pscustomobject]@{ variant = 'direct'; kind = 'upgrade' }
    )
    if ($taskIteration % 2 -eq 0) { [array]::Reverse($taskCaseOrder) }
    foreach ($taskCase in $taskCaseOrder) {
      if ($taskSelectedVariants -notcontains $taskCase.variant -or
          $taskSelectedBenchmarkKinds -notcontains $taskCase.kind) { continue }
      $taskBenchmark = Invoke-TaskBenchmarkCase $taskCase.kind $taskBaseVariants[$taskCase.variant] `
        $taskCandidateVariants[$taskCase.variant] $taskIteration $taskColdPreparation
      $taskBenchmarks += $taskBenchmark
      if (-not $taskBenchmark.cleanup.testRootRemoved -or
          $taskBenchmark.cleanup.installEntriesRemaining -ne 0 -or
          $taskBenchmark.cleanup.shortcutsRemaining -ne 0 -or
          $taskBenchmark.cleanup.globalDshProcessesRemaining -ne 0 -or
          $taskBenchmark.cleanup.globalInstallEntriesRemaining -ne 0 -or
          $taskBenchmark.cleanup.globalShortcutsRemaining -ne 0) {
        $taskEnvironmentContaminated = $true
        break taskBenchmarkLoop
      }
    }
  }
}

$taskFaults = @()
if ($Mode -in @('Faults', 'All') -and -not $taskEnvironmentContaminated) {
  :taskFaultLoop
  foreach ($taskVariant in $taskSelectedVariants) {
    foreach ($taskKind in @('interrupted-upgrade', 'locked-app-asar')) {
      $taskFault = Invoke-TaskFaultCase $taskKind $taskBaseVariants[$taskVariant] `
        $taskCandidateVariants[$taskVariant]
      $taskFaults += $taskFault
      if (-not $taskFault.cleanup.testRootRemoved -or
          $taskFault.cleanup.installEntriesRemaining -ne 0 -or
          $taskFault.cleanup.shortcutsRemaining -ne 0 -or
          $taskFault.cleanup.globalDshProcessesRemaining -ne 0 -or
          $taskFault.cleanup.globalInstallEntriesRemaining -ne 0 -or
          $taskFault.cleanup.globalShortcutsRemaining -ne 0) {
        $taskEnvironmentContaminated = $true
        break taskFaultLoop
      }
    }
  }
}

$taskSummary = @()
foreach ($taskVariant in $taskSelectedVariants) {
  foreach ($taskKind in $taskSelectedBenchmarkKinds) {
    [long[]]$taskTimes = @($taskBenchmarks | Where-Object {
      $_.variant -eq $taskVariant -and $_.kind -eq $taskKind -and $_.success
    } | ForEach-Object { $_.measurement.elapsedMs })
    if ($taskTimes.Count -gt 0) {
      $taskSummary += [pscustomobject]@{
        variant = $taskVariant
        kind = $taskKind
        samples = $taskTimes.Count
        medianElapsedMs = Get-TaskMedian $taskTimes
        minElapsedMs = ($taskTimes | Measure-Object -Minimum).Minimum
        maxElapsedMs = ($taskTimes | Measure-Object -Maximum).Maximum
      }
    }
  }
}

$taskSuccess = @($taskBenchmarks | Where-Object { -not $_.success }).Count -eq 0 -and
  @($taskFaults | Where-Object { -not $_.harnessCompleted }).Count -eq 0 -and
  -not $taskEnvironmentContaminated
if ($RequireFaultCoherence) {
  $taskSuccess = $taskSuccess -and @($taskFaults | Where-Object { -not $_.coherentAfterFault }).Count -eq 0
}
$taskBuildGatesVerified = [bool]$taskBaseManifest.Value.provenance.gateRan -and
  [bool]$taskCandidateManifest.Value.provenance.gateRan
$taskColdEligibilityReasons = @()
if (-not $taskSuccess) { $taskColdEligibilityReasons += 'measurement-or-cleanup-failed' }
if ($null -eq $taskColdPreparation) { $taskColdEligibilityReasons += 'cold-snapshot-preparation-not-validated' }
if (-not $taskBuildGatesVerified) { $taskColdEligibilityReasons += 'build-gate-provenance-not-verified' }
if (@($taskBenchmarks).Count -ne 1) { $taskColdEligibilityReasons += 'expected-exactly-one-benchmark-case' }
if (@($taskBenchmarks | Where-Object { $_.success }).Count -ne 1) {
  $taskColdEligibilityReasons += 'expected-exactly-one-successful-benchmark-case'
}
if ($taskSelectedBenchmarkKinds -contains 'upgrade' -and $taskVersionComparison -le 0) {
  $taskColdEligibilityReasons += 'upgrade-version-not-ascending'
}
$taskEligibleForColdAggregation = $Mode -eq 'Benchmark' -and
  $CacheRegime -eq 'ColdSnapshot' -and [bool]$ConfirmFreshSnapshot -and
  $taskColdEligibilityReasons.Count -eq 0
$taskResult = [ordered]@{
  schemaVersion = 2
  skipped = $false
  mode = $Mode
  variant = $Variant
  benchmarkCase = $BenchmarkCase
  cacheRegime = $CacheRegime
  measurementClass = if ($Mode -eq 'Faults') {
    'not-applicable'
  } elseif ($taskEligibleForColdAggregation) {
    'formal-cold-snapshot-sample'
  } elseif ($CacheRegime -eq 'ColdSnapshot') {
    'ineligible-cold-snapshot-observation'
  } else {
    'exploratory-warm-batch'
  }
  confirmedFreshSnapshot = [bool]$ConfirmFreshSnapshot
  coldSnapshotPreparation = if ($null -eq $taskColdPreparation) {
    $null
  } else {
    [ordered]@{
      path = $taskColdPreparation.path
      preparationToken = $taskColdPreparation.value.preparationToken
      canonicalBaseVariant = $taskColdPreparation.value.canonicalBaseVariant
      installerHashesVerifiedBeforeSnapshot = $true
    }
  }
  coldEligibilityReasons = $taskColdEligibilityReasons
  eligibleForCrossVmColdAggregation = $taskEligibleForColdAggregation
  generatedAt = [DateTime]::UtcNow.ToString('o')
  machine = [ordered]@{
    os = [Environment]::OSVersion.VersionString
    processor = $env:PROCESSOR_IDENTIFIER
    defenderPreferenceChanged = $false
  }
  baseManifest = $taskBaseManifest.Path
  candidateManifest = $taskCandidateManifest.Path
  baseBuildProvenance = $taskBaseManifest.Value.provenance
  candidateBuildProvenance = $taskCandidateManifest.Value.provenance
  versionRelationship = $taskVersionRelationship
  nonUpgradeExplicitlyAllowed = [bool]$AllowNonUpgrade
  iterations = $Iterations
  benchmark = $taskBenchmarks
  summary = $taskSummary
  faults = $taskFaults
  environmentContaminated = $taskEnvironmentContaminated
  requireFaultCoherence = [bool]$RequireFaultCoherence
  success = $taskSuccess
}
$taskJson = $taskResult | ConvertTo-Json -Depth 20
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
  $taskUnusedOutputPath = Write-TaskJsonFile $OutputPath $taskResult $false
}
$taskJson
if (-not $taskSuccess) { exit 1 }
