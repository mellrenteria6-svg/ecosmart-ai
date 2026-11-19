# Crea server\.env con la clave de PostgreSQL (se pide aqui, no se muestra).
# Uso:  powershell -ExecutionPolicy Bypass -File server\configurar.ps1
$seguro = Read-Host 'Clave del usuario postgres' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
$clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
$lineas = @(
  'PGHOST=localhost',
  'PGPORT=5432',
  'PGDATABASE=ecosmart',
  'PGUSER=postgres',
  "PGPASSWORD=$clave",
  'PUERTO=3001',
  'BANDEJA_DEMO=1'
)
Set-Content -Path (Join-Path $PSScriptRoot '.env') -Value $lineas -Encoding ascii
Write-Host 'Listo: server\.env creado. Ahora corre: npm run servidor' -ForegroundColor Green
