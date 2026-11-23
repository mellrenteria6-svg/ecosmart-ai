param(
  # Hora del respaldo diario (RPO de 24 horas, RNF12)
  [string]$HoraRespaldo = '02:00',
  # Cada cuantos minutos se verifica /api/salud (RNF06)
  [int]$IntervaloMonitoreo = 5,
  [string]$UrlSalud = 'http://localhost:3001/api/salud',
  [int]$RetencionDias = 7,
  # Quita las dos tareas
  [switch]$Quitar
)

# RNF06 y RNF12: registra en el Programador de tareas de Windows
#   1. "EcoSmart - respaldo diario": db\respaldo.ps1 cada dia (si el equipo estaba apagado, corre al encender)
#   2. "EcoSmart - monitoreo":       scripts\monitor-disponibilidad.mjs cada 5 minutos
# Corren con la cuenta actual, cuando la sesion esta iniciada. No guarda ninguna clave:
# el respaldo usa %APPDATA%\postgresql\pgpass.conf (ver docs\continuidad-y-capacidad.md).
#
# Uso:    powershell -ExecutionPolicy Bypass -File db\programar-tareas.ps1
# Quitar: powershell -ExecutionPolicy Bypass -File db\programar-tareas.ps1 -Quitar

$ErrorActionPreference = 'Stop'
$raiz = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nombreRespaldo = 'EcoSmart - respaldo diario'
$nombreMonitoreo = 'EcoSmart - monitoreo'

if ($Quitar) {
  foreach ($n in @($nombreRespaldo, $nombreMonitoreo)) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $n -Confirm:$false
      Write-Host "Tarea quitada: $n"
    }
  }
  return
}

$pgpass = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
if (-not (Test-Path -LiteralPath $pgpass) -and -not $env:PGPASSFILE) {
  throw "Falta $pgpass. Primero corra: powershell -ExecutionPolicy Bypass -File db\guardar-clave.ps1"
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'No se encontro node.exe en el PATH.' }

$ajustes = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# 1. Respaldo diario
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $raiz `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$raiz\db\respaldo.ps1`" -Desatendido -RetencionDias $RetencionDias"
$disparador = New-ScheduledTaskTrigger -Daily -At $HoraRespaldo
Register-ScheduledTask -TaskName $nombreRespaldo -Action $accion -Trigger $disparador -Settings $ajustes `
  -Description 'RNF06/RNF12: respaldo verificable de PostgreSQL (db\respaldos\registro-respaldos.csv)' -Force | Out-Null
Write-Host "Tarea registrada: $nombreRespaldo (todos los dias a las $HoraRespaldo)"

# 2. Monitoreo de disponibilidad
$accion = New-ScheduledTaskAction -Execute $node -WorkingDirectory $raiz `
  -Argument "scripts\monitor-disponibilidad.mjs --url=$UrlSalud"
$disparador = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervaloMonitoreo)
Register-ScheduledTask -TaskName $nombreMonitoreo -Action $accion -Trigger $disparador -Settings $ajustes `
  -Description 'RNF06: verifica /api/salud y anota el resultado en monitoreo\disponibilidad.csv' -Force | Out-Null
Write-Host "Tarea registrada: $nombreMonitoreo (cada $IntervaloMonitoreo minutos)"
Write-Host 'Informe de disponibilidad: node scripts\monitor-disponibilidad.mjs --informe'
