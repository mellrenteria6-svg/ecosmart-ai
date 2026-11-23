param(
  [string]$HostBd = 'localhost',
  [int]$Puerto = 5432,
  [string]$Usuario = 'postgres'
)

# RNF06: deja la clave de PostgreSQL en el archivo estandar %APPDATA%\postgresql\pgpass.conf para
# que el respaldo programado corra sin pedirla. Toma la clave de server\.env (PGPASSWORD); si no
# existe, la pide sin mostrarla. Nunca la escribe en pantalla. Al terminar, solo la cuenta actual
# de Windows puede leer el archivo.
#
# Uso: powershell -ExecutionPolicy Bypass -File db\guardar-clave.ps1

$ErrorActionPreference = 'Stop'
$env_ = Join-Path $PSScriptRoot '..\server\.env'
$clave = $null
if (Test-Path -LiteralPath $env_) {
  $linea = Get-Content -LiteralPath $env_ | Where-Object { $_ -like 'PGPASSWORD=*' } | Select-Object -First 1
  if ($linea) { $clave = $linea.Substring('PGPASSWORD='.Length) }
}
if (-not $clave) {
  $seguro = Read-Host "Clave de $Usuario" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { $clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $clave) { throw 'No se obtuvo ninguna clave.' }

# En pgpass, ":" y "\" dentro de un campo se escriben con "\" delante
$escapada = $clave.Replace('\', '\\').Replace(':', '\:')
# "*" en la base: sirve para ecosmart y para las bases de los simulacros de restauracion
$entrada = "${HostBd}:${Puerto}:*:${Usuario}:$escapada"

$carpeta = Join-Path $env:APPDATA 'postgresql'
$archivo = Join-Path $carpeta 'pgpass.conf'
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
$previas = @()
if (Test-Path -LiteralPath $archivo) {
  # Conserva otras entradas y reemplaza la de este servidor y usuario
  $previas = @(Get-Content -LiteralPath $archivo | Where-Object { $_ -and -not $_.StartsWith("${HostBd}:${Puerto}:*:${Usuario}:") })
}
Set-Content -LiteralPath $archivo -Value (@($previas) + $entrada) -Encoding ascii
$clave = $null; $escapada = $null; $entrada = $null

# Solo la cuenta actual (sin herencia de permisos)
& icacls $archivo /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir los permisos del archivo.' }
Write-Host "Listo: $archivo (solo lo puede leer $env:USERNAME)."
