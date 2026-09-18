param()

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
  throw 'This reproduction requires Windows.'
}

$taskRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-issue-469-" + [guid]::NewGuid().ToString('N'))
$taskHelperPath = Join-Path $taskRoot 'DSH Helper.exe'
$taskHelper = $null

try {
  New-Item -ItemType Directory -Path $taskRoot | Out-Null
  Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32\ping.exe') -Destination $taskHelperPath
  $taskHelper = Start-Process -FilePath $taskHelperPath -ArgumentList '-t', '127.0.0.1' -PassThru -WindowStyle Hidden
  Start-Sleep -Milliseconds 500

  $taskProcesses = @(Get-CimInstance -ClassName Win32_Process)
  $taskOldMatches = @($taskProcesses | Where-Object {
    $_.Path -and $_.Path.StartsWith($taskRoot, [System.StringComparison]::CurrentCultureIgnoreCase)
  })
  $taskFixedMatches = @($taskProcesses | Where-Object {
    $_.Path -and [System.IO.Path]::GetFileName($_.Path) -ieq 'DSH Desktop.exe'
  })

  [ordered]@{
    scenario = 'unrelated helper executable under the DSH install directory'
    helperPid = $taskHelper.Id
    helperPath = $taskHelperPath
    oldInstallDirectoryPredicateMatchedHelper = $taskOldMatches.ProcessId -contains $taskHelper.Id
    fixedExecutableNamePredicateMatchedHelper = $taskFixedMatches.ProcessId -contains $taskHelper.Id
    reproduced = ($taskOldMatches.ProcessId -contains $taskHelper.Id) -and -not ($taskFixedMatches.ProcessId -contains $taskHelper.Id)
  } | ConvertTo-Json
} finally {
  if ($null -ne $taskHelper -and -not $taskHelper.HasExited) {
    Stop-Process -Id $taskHelper.Id -Force
    $taskHelper.WaitForExit()
  }
  if (Test-Path -LiteralPath $taskRoot) {
    $taskResolvedRoot = [System.IO.Path]::GetFullPath($taskRoot)
    $taskResolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $taskResolvedRoot.StartsWith($taskResolvedTemp, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove unexpected path: $taskResolvedRoot"
    }
    Remove-Item -LiteralPath $taskResolvedRoot -Recurse -Force
  }
}
