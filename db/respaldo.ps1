param(
  [string]$Destino = (Join-Path $PSScriptRoot 'respaldos'),
  [string]$HostBd = 'localhost',
  [int]$Puerto = 5432,
  [string]$Base = 'ecosmart',
  [string]$Usuario = 'postgres',
  [int]$RetencionDias = 0,
  # Para el Programador de tareas: nunca pide la clave por teclado
  [switch]$Desatendido
)

# RNF06 y RNF12: respaldo verificable de PostgreSQL.
# Uso manual:
#   powershell -ExecutionPolicy Bypass -File db\respaldo.ps1
# Para una tarea programada, configure PGPASSFILE o PGPASSWORD en la cuenta que ejecuta la tarea.

$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$pgDump = Join-Path $bin 'pg_dump.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$claveTemporal = $false

if (-not (Test-Path -LiteralPath $pgDump) -or -not (Test-Path -LiteralPath $pgRestore)) {
  throw 'No se encontro PostgreSQL 18 en C:\Program Files\PostgreSQL\18\bin.'
}

# Archivo de claves estandar de PostgreSQL en Windows: pg_dump lo usa solo, sin pedir nada
$pgpassPorDefecto = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
if (-not $env:PGPASSWORD -and -not $env:PGPASSFILE -and -not (Test-Path -LiteralPath $pgpassPorDefecto)) {
  if ($Desatendido) {
    throw "Sin clave para la tarea programada: cree $pgpassPorDefecto (ver docs\continuidad-y-capacidad.md)."
  }
  $seguro = Read-Host "Clave de $Usuario para respaldar la base $Base" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    $claveTemporal = $true
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$reloj = [Diagnostics.Stopwatch]::StartNew()
try {
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null
  $destinoReal = (Resolve-Path -LiteralPath $Destino).Path
  $marca = Get-Date -Format 'yyyyMMdd-HHmmss'
  $nombre = "$Base-$marca.dump"
  $temporal = Join-Path $destinoReal "$nombre.tmp"
  $final = Join-Path $destinoReal $nombre
  $hashFinal = "$final.sha256"

  & $pgDump -h $HostBd -p $Puerto -U $Usuario -d $Base --format=custom --compress=6 --file=$temporal
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump no pudo crear el respaldo.' }

  & $pgRestore --list $temporal | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'El archivo creado no paso la verificacion de pg_restore.' }

  Move-Item -LiteralPath $temporal -Destination $final
  $hash = (Get-FileHash -LiteralPath $final -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($hashFinal, "$hash  $nombre`r`n", [Text.Encoding]::ASCII)

  if ($RetencionDias -gt 0) {
    $limite = (Get-Date).AddDays(-$RetencionDias)
    Get-ChildItem -LiteralPath $destinoReal -Filter "$Base-*.dump" -File |
      Where-Object { $_.LastWriteTime -lt $limite } |
      ForEach-Object {
        Remove-Item -LiteralPath $_.FullName
        Remove-Item -LiteralPath "$($_.FullName).sha256" -ErrorAction SilentlyContinue
      }
  }

  # Evidencia de finalización (RNF06): una línea por respaldo en registro-respaldos.csv
  $reloj.Stop()
  $registro = Join-Path $destinoReal 'registro-respaldos.csv'
  if (-not (Test-Path -LiteralPath $registro)) {
    [IO.File]::WriteAllText($registro, "fecha;archivo;bytes;segundos;sha256;resultado`r`n", [Text.Encoding]::ASCII)
  }
  $bytes = (Get-Item -LiteralPath $final).Length
  $segundos = [math]::Round($reloj.Elapsed.TotalSeconds, 1).ToString([Globalization.CultureInfo]::InvariantCulture)
  [IO.File]::AppendAllText($registro, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss');$nombre;$bytes;$segundos;$hash;verificado`r`n", [Text.Encoding]::ASCII)

  Write-Host "Respaldo verificado: $final" -ForegroundColor Green
  Write-Host "Peso: $bytes bytes - Tiempo: $segundos s"
  Write-Host "SHA-256: $hash"
}
catch {
  if ($temporal -and (Test-Path -LiteralPath $temporal)) {
    Remove-Item -LiteralPath $temporal -ErrorAction SilentlyContinue
  }
  throw
}
finally {
  if ($claveTemporal) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
