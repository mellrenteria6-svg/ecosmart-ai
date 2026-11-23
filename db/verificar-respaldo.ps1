param(
  [Parameter(Mandatory = $true)]
  [string]$Archivo
)

# Verifica integridad, suma SHA-256 y contenido lógico sin modificar ninguna base.

$ErrorActionPreference = 'Stop'
$pgRestore = 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe'

if (-not (Test-Path -LiteralPath $pgRestore)) {
  throw 'No se encontro pg_restore de PostgreSQL 18.'
}

$respaldo = (Resolve-Path -LiteralPath $Archivo).Path
$hashCalculado = (Get-FileHash -LiteralPath $respaldo -Algorithm SHA256).Hash.ToLowerInvariant()
$archivoHash = "$respaldo.sha256"

if (Test-Path -LiteralPath $archivoHash) {
  $hashEsperado = ((Get-Content -LiteralPath $archivoHash -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  if ($hashCalculado -ne $hashEsperado) {
    throw 'La suma SHA-256 no coincide. El respaldo puede estar incompleto o alterado.'
  }
}

$contenido = @(& $pgRestore --list $respaldo)
if ($LASTEXITCODE -ne 0 -or $contenido.Count -eq 0) {
  throw 'pg_restore no reconoce el respaldo o no encontro objetos restaurables.'
}

Write-Host 'Respaldo valido.' -ForegroundColor Green
Write-Host "Objetos registrados: $($contenido.Count)"
Write-Host "SHA-256: $hashCalculado"
