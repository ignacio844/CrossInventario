param([switch]$RemoveStartup)
$ErrorActionPreference='Stop'
$project=Split-Path -Parent $PSScriptRoot
$worker=Join-Path $PSScriptRoot 'wms_agent.py'
$pidFile=Join-Path $project '.wms\worker.pid'
if(Test-Path -LiteralPath $pidFile){
  $workerPid=0
  if([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(),[ref]$workerPid)){
    $process=Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
    if($process -and $process.CommandLine -like "*$worker*"){Stop-Process -Id $workerPid;Write-Output 'Descargador detenido.'}
  }
}
if($RemoveStartup){Unregister-ScheduledTask -TaskName 'CrossInventario-WMS-PROD' -Confirm:$false -ErrorAction SilentlyContinue;Write-Output 'Inicio automático desactivado.'}
