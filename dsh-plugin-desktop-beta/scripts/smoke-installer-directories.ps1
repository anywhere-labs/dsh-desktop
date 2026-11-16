# Exercise the shared Desktop installer hooks and the vendored NSIS directory transaction with private installation directories.
param(
  [Parameter(Mandatory)][string]$Makensis,
  [Parameter(Mandatory)][string]$SevenZip
)
$ErrorActionPreference = 'Stop'
$Makensis = [System.IO.Path]::GetFullPath($Makensis)
$SevenZip = [System.IO.Path]::GetFullPath($SevenZip)
$scratch = [System.IO.Directory]::CreateTempSubdirectory('dsh-directory-smoke-').FullName
$fixture = Join-Path $PSScriptRoot '../tests/fixtures/installer-directory-smoke.nsi'

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$Executable exited with $LASTEXITCODE" }
}

# Setup log lines each case must write; the log is UTF-16LE with a byte order mark.
$expectedLog = @{
  'first' = @('Staged the new version in')
  'upgrade' = @('Staged the new version in')
  'transient-lock' = @('Staged the new version in')
  'locked' = @('Staged the new version in', 'Cannot move', '; restore error 0;')
  'locked-stage' = @('Staged the new version in', 'Cannot move', '; restore error 0;')
  'missing-stage' = @('Staged the new version in', 'Cannot move', '(Win32 error 2:', '; restore error 0;')
  'restore-conflict' = @('Staged the new version in', '(Win32 error 183:', '; restore error 183;')
  'broken' = @('7-Zip exit code 2 extracting', 'Cannot open the file as')
  'cancelled' = @('Staged the new version in')
  'denied' = @('Cannot create', '(Win32 error 5:', 'Setup cancelled: the installation location is not writable')
  'incomplete' = @('Staged files are missing: resources\app.asar; the installation folder is unchanged')
  'outer-instance' = @('Staged the new version in')
  'low-integrity' = @('runs at integrity level 4096, below Medium (8192)', 'Setup cancelled: it runs below Medium integrity')
}
# Cases that replace the installation.
$succeeding = @('first', 'upgrade', 'transient-lock', 'outer-instance')
# Failed directory operations the Setup log directory keeps: phase pattern and number of attempts.
$expectedOperations = @{
  'locked' = @('^backup: Windows error: (5|32|33)$', 10)
  'locked-stage' = @('^promote: Windows error: (5|32|33)$', 10)
  'missing-stage' = @('^promote: Windows error: 2$', 1)
  'restore-conflict' = @('^(promote|restore): Windows error: 183$', 2)
}

try {
  $payload = Join-Path $scratch 'payload'
  New-Item -ItemType Directory -Path (Join-Path $payload 'resources') | Out-Null
  foreach ($file in @('Smoke.exe', 'Uninstall Smoke.exe', 'resources\app.asar')) {
    [System.IO.File]::WriteAllText((Join-Path $payload $file), "new $file")
  }
  [System.IO.File]::WriteAllText((Join-Path $payload 'asset.txt'), 'new asset')
  $deepPayload = Join-Path $payload (('nested-' * 20) + '\asset-' + ('x' * 60) + '.txt')
  [IO.Directory]::CreateDirectory((Split-Path $deepPayload -Parent)) | Out-Null
  [IO.File]::WriteAllText($deepPayload, 'long path asset')
  $archive = Join-Path $scratch 'payload.7z'
  Invoke-Checked $SevenZip @('a', '-bd', '-t7z', $archive, "$payload/*")
  # 7-Zip extracts this archive without error; the staged check must still reject it.
  Remove-Item -LiteralPath (Join-Path $payload 'resources\app.asar')
  $incompleteArchive = Join-Path $scratch 'incomplete.7z'
  Invoke-Checked $SevenZip @('a', '-bd', '-t7z', $incompleteArchive, "$payload/*")
  $brokenArchive = Join-Path $scratch 'broken.7z'
  [System.IO.File]::WriteAllText($brokenArchive, 'invalid archive')
  $account = '*' + [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value

  foreach ($mode in @('first', 'upgrade', 'transient-lock', 'locked', 'locked-stage', 'missing-stage', 'restore-conflict', 'broken', 'cancelled', 'denied', 'incomplete', 'outer-instance', 'low-integrity')) {
    $caseRoot = Join-Path $scratch $mode
    $target = Join-Path $caseRoot 'Application'
    $logDir = Join-Path $caseRoot 'installer-logs'
    $lowTemp = Join-Path $caseRoot 'low-temp'
    New-Item -ItemType Directory -Path $logDir | Out-Null
    if ($mode -ne 'first') {
      New-Item -ItemType Directory -Path $target | Out-Null
      [System.IO.File]::WriteAllText((Join-Path $target 'asset.txt'), 'old asset')
      [System.IO.File]::WriteAllText((Join-Path $target 'obsolete.txt'), 'old only')
      $oldDeep = Join-Path $target ([IO.Path]::GetRelativePath($payload, $deepPayload))
      [IO.Directory]::CreateDirectory((Split-Path $oldDeep -Parent)) | Out-Null
      [IO.File]::WriteAllText($oldDeep, 'old long path asset')
    }
    $probe = Join-Path $caseRoot 'probe.exe'
    $caseArchive = switch ($mode) { 'broken' { $brokenArchive } 'incomplete' { $incompleteArchive } default { $archive } }
    $compileArgs = @('/V2', "/DOUTPUT_FILE=$probe", "/DPAYLOAD_FILE=$caseArchive", "/DTARGET_DIR=$target", "/DLOG_DIR=$logDir", "/DDSH_SEVENZIP_PATH=$SevenZip")
    if ($mode -eq 'missing-stage') { $compileArgs += '/DMISSING_STAGE' }
    if ($mode -eq 'locked-stage') { $compileArgs += '/DLOCKED_STAGE' }
    if ($mode -eq 'restore-conflict') { $compileArgs += '/DRESTORE_CONFLICT' }
    if ($mode -eq 'cancelled') { $compileArgs += '/DCANCELLED' }
    if ($mode -eq 'outer-instance') { $compileArgs += '/DOUTER_INSTANCE' }
    Invoke-Checked $Makensis ($compileArgs + $fixture)
    $handle = $null
    $process = $null
    $denied = $false
    try {
      if ($mode -in @('locked', 'transient-lock')) {
        $handle = [System.IO.File]::Open((Join-Path $target 'asset.txt'), 'Open', 'Read', 'Read')
      }
      if ($mode -eq 'denied') {
        # This account may not add entries beside the installation, where the staged version belongs.
        Invoke-Checked 'icacls.exe' @($caseRoot, '/deny', "${account}:(WD,AD)")
        $denied = $true
      }
      # Start Setup as the in-app updater does: Node's spawn calls CreateProcess. Start-Process would use
      # ShellExecuteEx, which zone-checks a Low-labeled program like a download and then waits on a SmartScreen
      # dialog that nobody can close on a runner.
      $start = [System.Diagnostics.ProcessStartInfo]::new($probe)
      $start.ArgumentList.Add('/S')
      $start.UseShellExecute = $false
      $start.CreateNoWindow = $true
      if ($mode -eq 'outer-instance') {
        # An in-app update starts Setup in the application's working directory: the installation.
        $start.WorkingDirectory = $target
      }
      $savedTemp = $env:TEMP
      $savedTmp = $env:TMP
      if ($mode -eq 'low-integrity') {
        # An installer saved below a workspace-write workspace carries its Low label, so Windows runs it at Low
        # integrity. NSIS starts only with a temporary directory it can write at that level.
        New-Item -ItemType Directory -Path $lowTemp | Out-Null
        Invoke-Checked 'icacls.exe' @($lowTemp, '/setintegritylevel', '(OI)(CI)Low')
        Invoke-Checked 'icacls.exe' @($probe, '/setintegritylevel', 'Low')
        $env:TEMP = $lowTemp
        $env:TMP = $lowTemp
      }
      # Setup inherits this process's environment, including the TEMP set above.
      try { $process = [System.Diagnostics.Process]::Start($start) } finally { $env:TEMP = $savedTemp; $env:TMP = $savedTmp }
      if ($mode -eq 'transient-lock') {
        $deadline = [Diagnostics.Stopwatch]::StartNew()
        $observedFailure = $false
        while (-not $process.HasExited -and $deadline.Elapsed.TotalSeconds -lt 30) {
          $pluginPath = "$target.plugin-dir"
          if (Test-Path -LiteralPath $pluginPath) {
            $trace = Join-Path ([IO.File]::ReadAllText($pluginPath)) 'directory-operations.log'
            if (Test-Path -LiteralPath $trace) {
              $stream = [IO.File]::Open($trace, 'Open', 'Read', 'ReadWrite')
              $reader = [IO.StreamReader]::new($stream)
              try { $attempts = $reader.ReadToEnd() } finally { $reader.Dispose() }
              if ($attempts -match 'Windows error: (5|32|33)\b') {
                $observedFailure = $true
                break
              }
            }
          }
          Start-Sleep -Milliseconds 20
        }
        if (-not $observedFailure) { throw 'Transient-lock smoke did not observe the failed operation before release' }
        $handle.Dispose()
        $handle = $null
      }
      if (-not $process.WaitForExit(60000)) {
        $process.Kill($true)
        $process.WaitForExit()
        throw "Directory smoke $mode did not exit within 60 seconds"
      }
      $expectedExit = if ($mode -in $succeeding) { 0 } else { 2 }
      if ($process.ExitCode -ne $expectedExit) {
        throw "Directory smoke $mode exited with $($process.ExitCode), expected $expectedExit"
      }
    } finally {
      if ($null -ne $handle) { $handle.Dispose() }
      if ($null -ne $process) {
        if (-not $process.HasExited) { $process.Kill($true); $process.WaitForExit() }
        $process.Dispose()
      }
      if ($denied) { Invoke-Checked 'icacls.exe' @($caseRoot, '/remove:d', $account) }
    }
    $installLog = if ($mode -eq 'low-integrity') {
      # Setup stopped in .onInit and kept its log in the only temporary folder it can write.
      if (Test-Path -LiteralPath (Join-Path $logDir 'install.log')) { throw "Directory smoke $mode staged at low integrity" }
      [IO.File]::ReadAllText((Join-Path $lowTemp 'dsh-directory-smoke-updater\install.log'))
    } else {
      [IO.File]::ReadAllText((Join-Path $logDir 'install.log'))
    }
    foreach ($expected in $expectedLog[$mode]) {
      if (-not $installLog.Contains($expected)) { throw "Directory smoke $mode Setup log lacks '$expected':`n$installLog" }
    }
    $operations = Join-Path $logDir 'directory-operations.log'
    if ($expectedOperations.ContainsKey($mode)) {
      if (-not (Test-Path -LiteralPath $operations)) { throw "Directory smoke $mode did not keep its failed directory attempts" }
      $pattern, $count = $expectedOperations[$mode]
      $lines = @([IO.File]::ReadAllLines($operations) | Where-Object { $_ -ne '' })
      if ($lines.Count -ne $count -or @($lines | Where-Object { $_ -notmatch $pattern }).Count -ne 0) {
        throw "Directory smoke $mode kept unexpected directory attempts:`n$($lines -join "`n")"
      }
    } elseif (Test-Path -LiteralPath $operations) {
      throw "Directory smoke $mode kept directory attempts after its operations succeeded"
    }
    if ($mode -eq 'restore-conflict') {
      $backups = @(Get-ChildItem -LiteralPath $caseRoot -Directory -Filter 'Application.old-*')
      if ($backups.Count -ne 1 -or [IO.File]::ReadAllText((Join-Path $backups[0].FullName 'asset.txt')) -ne 'old asset' -or
          [IO.File]::ReadAllText((Join-Path $backups[0].FullName 'obsolete.txt')) -ne 'old only' -or
          [IO.File]::ReadAllText((Join-Path "$target.conflict" 'unrelated.txt')) -ne 'unrelated file') {
        throw 'Failed restoration did not preserve the backup and the conflicting destination'
      }
      if ((Test-Path -LiteralPath $target) -or @(Get-ChildItem -LiteralPath $caseRoot -Directory -Filter 'Application.new-*').Count -ne 0) {
        throw 'Reported restoration failure retried recovery or retained its unlocked staging directory'
      }
      Write-Output "Directory replacement smoke passed: $mode"
      continue
    }
    $expectedAsset = if ($mode -in $succeeding) { 'new asset' } else { 'old asset' }
    if ([System.IO.File]::ReadAllText((Join-Path $target 'asset.txt')) -ne $expectedAsset) {
      throw "Directory smoke $mode changed the wrong version"
    }
    $expectObsolete = $mode -notin $succeeding
    if ((Test-Path -LiteralPath (Join-Path $target 'obsolete.txt')) -ne $expectObsolete) {
      throw "Directory smoke $mode did not preserve the expected old-only file state"
    }
    if (@(Get-ChildItem -LiteralPath $caseRoot -Directory | Where-Object Name -notin @('Application', 'installer-logs', 'low-temp')).Count -ne 0) {
      throw "Directory smoke $mode left transaction directories behind"
    }
    Write-Output "Directory replacement smoke passed: $mode"
  }
} finally {
  $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  $resolvedScratch = [System.IO.Path]::GetFullPath($scratch)
  if (-not $resolvedScratch.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing cleanup outside the temporary root: $resolvedScratch"
  }
  Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
}
