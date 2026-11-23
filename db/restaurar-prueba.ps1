param(
  [Parameter(Mandatory = $true)]
  [string]$Archivo,
  [string]$BaseDestino = 'ecosmart_restauracion',
  [string]$HostBd = 'localhost',
  [int]$Puerto = 5432,
  [string]$Usuario = 'postgres',
  [string]$BaseOrigen = 'ecosmart',
  # Borra la base de prueba al terminar (la evidencia queda en el registro)
  [switch]$BorrarAlTerminar
)

# RNF12: simulacro seguro de recuperacion.
# Solo restaura en una base NUEVA y nunca permite usar la base productiva "ecosmart".

$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$createdb = Join-Path $bin 'createdb.exe'
$dropdb = Join-Path $bin 'dropdb.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$psql = Join-Path $bin 'psql.exe'
$claveTemporal = $false
$baseCreada = $false

if ($BaseDestino -eq 'ecosmart') {
  throw 'Por seguridad, el simulacro no puede restaurar sobre la base ecosmart.'
}
if ($BaseDestino -notmatch '^[a-zA-Z][a-zA-Z0-9_]{2,62}$') {
  throw 'El nombre de la base destino solo puede contener letras, numeros y guion bajo.'
}
foreach ($programa in @($createdb, $dropdb, $pgRestore, $psql)) {
  if (-not (Test-Path -LiteralPath $programa)) { throw "No se encontro $programa" }
}

$respaldo = (Resolve-Path -LiteralPath $Archivo).Path

if (-not $env:PGPASSWORD -and -not $env:PGPASSFILE) {
  $seguro = Read-Host "Clave de $Usuario para el simulacro" -AsSecureString
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
  $existe = & $psql -h $HostBd -p $Puerto -U $Usuario -d postgres -tAqc "SELECT 1 FROM pg_database WHERE datname = '$BaseDestino'"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar PostgreSQL.' }
  if ("$existe".Trim() -eq '1') {
    throw "La base $BaseDestino ya existe. Use otro nombre; el simulacro nunca sobrescribe una base existente."
  }

  & $createdb -h $HostBd -p $Puerto -U $Usuario -E UTF8 $BaseDestino
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base de restauracion.' }
  $baseCreada = $true

  & $pgRestore -h $HostBd -p $Puerto -U $Usuario -d $BaseDestino --clean --if-exists --no-owner --no-privileges $respaldo
  if ($LASTEXITCODE -ne 0) { throw 'La restauracion no termino correctamente.' }

  $tablas = & $psql -h $HostBd -p $Puerto -U $Usuario -d $BaseDestino -tAqc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  if ($LASTEXITCODE -ne 0 -or [int]"$tablas" -lt 1) { throw 'La base restaurada no contiene tablas verificables.' }

  $reloj.Stop()

  # Comparación con la base de origen: las tablas clave deben tener las mismas filas que el respaldo
  # (si la base de origen cambió después del respaldo, puede tener más filas; nunca menos que la restaurada)
  $clave = @('usuario', 'reciclaje', 'movimiento_puntos', 'canje', 'auditoria')
  $consulta = ($clave | ForEach-Object { "(SELECT count(*) FROM $_)" }) -join " || ',' || "
  $enRestaurada = (& $psql -h $HostBd -p $Puerto -U $Usuario -d $BaseDestino -tAqc "SELECT $consulta").Trim()
  $enOrigen = (& $psql -h $HostBd -p $Puerto -U $Usuario -d $BaseOrigen -tAqc "SELECT $consulta").Trim()
  $detalle = for ($i = 0; $i -lt $clave.Count; $i++) { "$($clave[$i])=$(($enRestaurada -split ',')[$i])/$(($enOrigen -split ',')[$i])" }
  $saldo = (& $psql -h $HostBd -p $Puerto -U $Usuario -d $BaseDestino -tAqc "SELECT COALESCE(sum(puntos), 0) FROM movimiento_puntos").Trim()

  # Evidencia del simulacro (RNF12): tiempo de recuperación y resultado
  $segundos = [math]::Round($reloj.Elapsed.TotalSeconds, 1).ToString([Globalization.CultureInfo]::InvariantCulture)
  $carpeta = Split-Path -Parent $respaldo
  $registro = Join-Path $carpeta 'registro-restauraciones.csv'
  if (-not (Test-Path -LiteralPath $registro)) {
    [IO.File]::WriteAllText($registro, "fecha;respaldo;base_prueba;segundos;tablas;filas_restaurada/origen;ecopoints_en_libro;resultado`r`n", [Text.Encoding]::ASCII)
  }
  [IO.File]::AppendAllText($registro, "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss');$(Split-Path -Leaf $respaldo);$BaseDestino;$segundos;$($tablas.Trim());$($detalle -join ' ');$saldo;correcto`r`n", [Text.Encoding]::ASCII)

  Write-Host "Simulacro correcto: $BaseDestino contiene $($tablas.Trim()) tablas." -ForegroundColor Green
  Write-Host "Tiempo de recuperacion: $segundos s (objetivo RTO: 4 h)"
  Write-Host "Filas restaurada/origen: $($detalle -join ', ')"
  Write-Host "Evidencia guardada en $registro"
  if ($BorrarAlTerminar) {
    & $dropdb -h $HostBd -p $Puerto -U $Usuario --if-exists --force $BaseDestino | Out-Null
    Write-Host "Base de prueba $BaseDestino eliminada."
  } else {
    Write-Host "Revise la base y eliminela cuando termine el simulacro (o use -BorrarAlTerminar)."
  }
}
catch {
  if ($baseCreada) {
    & $dropdb -h $HostBd -p $Puerto -U $Usuario --if-exists --force $BaseDestino | Out-Null
  }
  throw
}
finally {
  if ($claveTemporal) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
