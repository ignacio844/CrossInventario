param([switch]$RegisterStartup)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $project '.wms'
$python = Join-Path $runtime 'venv\Scripts\python.exe'
$worker = Join-Path $PSScriptRoot 'wms_agent.py'
$configuration = Join-Path $project '.env.wms'
if (-not (Test-Path -LiteralPath $python)) { throw 'Primero preparar el entorno Python indicado en WMS_PRODUCCION.md.' }
if (-not (Test-Path -LiteralPath $configuration)) { throw 'Falta .env.wms con la cuenta SGL y la conexión del equipo.' }
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$pidFile = Join-Path $runtime 'worker.pid'
$running = $false
if (Test-Path -LiteralPath $pidFile) {
  $workerPid = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$workerPid)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $workerPid" -ErrorAction SilentlyContinue
    $running = $process -and $process.CommandLine -like "*$worker*"
  }
}
if (-not $running) {
  $arguments = @('-u', ('"{0}"' -f $worker), '--config', ('"{0}"' -f $configuration))
  $process = Start-Process -FilePath $python -ArgumentList $arguments -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'worker.log') -RedirectStandardError (Join-Path $runtime 'worker-error.log') -PassThru
  Set-Content -LiteralPath $pidFile -Value $process.Id
  Start-Sleep -Seconds 2
  if (-not (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { throw 'El descargador se cerró. Revisar .wms\worker-error.log y .wms\worker.log.' }
  Write-Output 'Descargador de producción iniciado en segundo plano.'
} else { Write-Output 'El descargador ya está en ejecución.' }
if ($RegisterStartup) {
  $user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $shell = (Get-Command powershell.exe).Source
  $arguments = '-NoProfile -WindowStyle Hidden -File "{0}"' -f $PSCommandPath
  $action = New-ScheduledTaskAction -Execute $shell -Argument $arguments -WorkingDirectory $project
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName 'CrossInventario-WMS-PROD' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Stock detallado WMS de producción de CD ESCOBAR para CrossInventario.' -Force | Out-Null
  Write-Output 'Inicio automático configurado al ingresar a Windows con este usuario.'
}
