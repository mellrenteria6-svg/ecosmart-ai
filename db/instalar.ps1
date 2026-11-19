# Crea o actualiza la base "ecosmart" en PostgreSQL 18.
#  - Si no existe: la crea y carga esquema, datos y todas las migraciones.
#  - Si ya existe: aplica solo las migraciones que falten (db\migraciones\*.sql).
# Uso:  powershell -ExecutionPolicy Bypass -File db\instalar.ps1
# La clave se pide aqui y solo vive en esta ventana mientras corre el script.

$ErrorActionPreference = 'Stop'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$dir = $PSScriptRoot

$seguro = Read-Host 'Clave del usuario postgres (la que pusiste al instalar)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
$env:PGCLIENTENCODING = 'UTF8'
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

function Consulta([string]$sql) {
  $r = & "$bin\psql.exe" -U postgres -h localhost -d ecosmart -tAqc "SET client_min_messages = warning; $sql"
  if ($LASTEXITCODE -ne 0) { throw "Fallo la consulta: $sql" }
  return "$r".Trim()
}

function Ejecutar([string[]]$archivos) {
  $params = @('-U', 'postgres', '-h', 'localhost', '-d', 'ecosmart', '-q', '-v', 'ON_ERROR_STOP=1')
  foreach ($a in $archivos) { $params += @('-f', $a) }
  & "$bin\psql.exe" @params
  if ($LASTEXITCODE -ne 0) { throw 'Fallo la carga de los scripts (mira el error de arriba).' }
}

try {
  $existe = & "$bin\psql.exe" -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname = 'ecosmart'"
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo conectar a PostgreSQL. Revisa la clave e intenta de nuevo.' }
  if ("$existe".Trim() -ne '1') {
    Write-Host 'Creando la base ecosmart...'
    & "$bin\createdb.exe" -U postgres -h localhost -E UTF8 ecosmart
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base.' }
  }

  # Esquema base
  if ((Consulta "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'usuario'") -eq '0') {
    Write-Host 'Cargando esquema y datos iniciales...'
    Ejecutar @("$dir\schema.sql", "$dir\seed.sql")
  }

  # Registro de migraciones aplicadas
  Consulta "CREATE TABLE IF NOT EXISTS migracion_aplicada (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())" | Out-Null
  # Bases creadas antes de este registro: se detecta lo que ya estaba aplicado
  if ((Consulta "SELECT to_regclass('public.institucion') IS NOT NULL") -eq 't') { Consulta "INSERT INTO migracion_aplicada (nombre) VALUES ('002_instituciones.sql') ON CONFLICT DO NOTHING" | Out-Null }
  if ((Consulta "SELECT to_regclass('public.correo_simulado') IS NOT NULL") -eq 't') { Consulta "INSERT INTO migracion_aplicada (nombre) VALUES ('003_servidor.sql') ON CONFLICT DO NOTHING" | Out-Null }

  $aplicadas = 0
  foreach ($m in Get-ChildItem "$dir\migraciones\*.sql" | Sort-Object Name) {
    if ((Consulta "SELECT count(*) FROM migracion_aplicada WHERE nombre = '$($m.Name)'") -eq '0') {
      Write-Host "Aplicando migracion $($m.Name)..."
      Ejecutar @($m.FullName)
      Consulta "INSERT INTO migracion_aplicada (nombre) VALUES ('$($m.Name)')" | Out-Null
      $aplicadas++
    }
  }

  $tablas = Consulta "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  $unis = Consulta "SELECT string_agg(siglas, ', ' ORDER BY siglas) FROM institucion"
  Write-Host "Listo: base ecosmart con $tablas tablas ($aplicadas migraciones nuevas). Universidades: $unis." -ForegroundColor Green
}
catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
}
finally {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:PGCLIENTENCODING -ErrorAction SilentlyContinue
}
