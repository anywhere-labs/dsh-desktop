param(
  [Parameter(Mandatory = $true)]
  [string]$CandidateApp
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This probe requires Windows.'
}

$taskAppPath = (Resolve-Path -LiteralPath $CandidateApp).Path
$taskTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$taskRoot = Join-Path $taskTempRoot ("dsh-installer-quit-probe-" + [guid]::NewGuid().ToString('N'))
$taskUserData = Join-Path $taskRoot 'user-data'
$taskDshHome = Join-Path $taskRoot 'dsh-home'
$taskActiveRunMarker = Join-Path $taskUserData 'crash-evidence\active-run.json'
$taskPrimary = $null
$taskResult = [ordered]@{
  scenario = 'isolated packaged app receives installer quit handoff'
  testRoot = $taskRoot
  candidateApp = $taskAppPath
  candidateVersion = (Get-Item -LiteralPath $taskAppPath).VersionInfo.ProductVersion
  primaryProcessId = $null
  activeRunMarkerObserved = $false
  quitRequestExitCode = $null
  primaryProcessStopped = $false
  activeRunMarkerCleared = $false
  testRootRemoved = $false
  error = $null
  success = $false
}

function Wait-TaskCondition([scriptblock]$taskCondition, [string]$taskDescription, [int]$taskTimeoutSeconds = 30) {
  $taskDeadline = [DateTime]::UtcNow.AddSeconds($taskTimeoutSeconds)
  do {
    if (& $taskCondition) { return }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $taskDeadline)
  throw "Timed out waiting for $taskDescription."
}

try {
  New-Item -ItemType Directory -Path $taskRoot | Out-Null
  $taskStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $taskStartInfo.FileName = $taskAppPath
  $taskStartInfo.Arguments = "--user-data-dir=`"$taskUserData`""
  $taskStartInfo.WorkingDirectory = Split-Path -Parent $taskAppPath
  $taskStartInfo.UseShellExecute = $false
  $taskStartInfo.CreateNoWindow = $true
  $taskStartInfo.EnvironmentVariables['DSH_HOME'] = $taskDshHome
  $taskPrimary = [System.Diagnostics.Process]::Start($taskStartInfo)
  $taskResult.primaryProcessId = $taskPrimary.Id

  Wait-TaskCondition { Test-Path -LiteralPath $taskActiveRunMarker } 'active run marker creation'
  $taskResult.activeRunMarkerObserved = $true

  $taskQuitStartInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $taskQuitStartInfo.FileName = $taskAppPath
  $taskQuitStartInfo.Arguments = "--user-data-dir=`"$taskUserData`" --dsh-installer-quit"
  $taskQuitStartInfo.WorkingDirectory = Split-Path -Parent $taskAppPath
  $taskQuitStartInfo.UseShellExecute = $false
  $taskQuitStartInfo.CreateNoWindow = $true
  $taskQuitStartInfo.EnvironmentVariables['DSH_HOME'] = $taskDshHome
  $taskQuitRequest = [System.Diagnostics.Process]::Start($taskQuitStartInfo)
  $taskQuitRequest.WaitForExit()
  $taskResult.quitRequestExitCode = $taskQuitRequest.ExitCode

  Wait-TaskCondition {
    $taskPrimary.Refresh()
    $taskPrimary.HasExited
  } 'primary app exit' 15
  $taskResult.primaryProcessStopped = $true

  Wait-TaskCondition { -not (Test-Path -LiteralPath $taskActiveRunMarker) } 'active run marker cleanup' 15
  $taskResult.activeRunMarkerCleared = $true
} catch {
  $taskResult.error = $_.Exception.Message
} finally {
  if ($null -ne $taskPrimary) {
    $taskPrimary.Refresh()
    if (-not $taskPrimary.HasExited) {
      Stop-Process -Id $taskPrimary.Id -Force -ErrorAction SilentlyContinue
    }
  }

  $taskResolvedRoot = [System.IO.Path]::GetFullPath($taskRoot)
  if (-not $taskResolvedRoot.StartsWith($taskTempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      -not ([System.IO.Path]::GetFileName($taskResolvedRoot)).StartsWith('dsh-installer-quit-probe-', [System.StringComparison]::Ordinal)) {
    throw "Refusing to remove unexpected probe path: $taskResolvedRoot"
  }
  if (Test-Path -LiteralPath $taskResolvedRoot) {
    Remove-Item -LiteralPath $taskResolvedRoot -Recurse -Force
  }
  $taskResult.testRootRemoved = -not (Test-Path -LiteralPath $taskResolvedRoot)
}

$taskResult.success = (
  $null -eq $taskResult.error -and
  $taskResult.activeRunMarkerObserved -and
  $taskResult.quitRequestExitCode -eq 0 -and
  $taskResult.primaryProcessStopped -and
  $taskResult.activeRunMarkerCleared -and
  $taskResult.testRootRemoved
)

$taskResult | ConvertTo-Json
if (-not $taskResult.success) {
  exit 1
}
