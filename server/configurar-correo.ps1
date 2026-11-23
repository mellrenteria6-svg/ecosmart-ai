# Configura el envio real de correos (RF01, RF02, RNF13) en server\.env.
# Opcion 1, Gmail: cuenta con verificacion en 2 pasos y "contrasena de aplicacion" (16 letras).
# Opcion 2, Brevo (gratis, 300 correos al dia): no necesita contrasena de aplicacion.
# La clave se escribe oculta y no se muestra nunca.
#
# Uso: powershell -ExecutionPolicy Bypass -File server\configurar-correo.ps1
# Para apagar el envio real: borre las lineas SMTP_ de server\.env

$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $archivo)) { throw 'No existe server\.env. Primero corra server\configurar.ps1' }

function Leer-Clave([string]$texto) {
  $seguro = Read-Host $texto -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
function Probar-Correo([string]$c) { if ($c -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw "'$c' no parece una direccion de correo." } }

Write-Host ''
Write-Host 'Correo real para EcoSmart AI' -ForegroundColor Green
Write-Host '  1 = Gmail (necesita contrasena de aplicacion)'
Write-Host '  2 = Brevo (gratis, no necesita contrasena de aplicacion)'
$opcion = (Read-Host 'Escriba 1 o 2').Trim()

if ($opcion -eq '1') {
  $remitente = (Read-Host 'Cuenta de Gmail que enviara los correos').Trim()
  Probar-Correo $remitente
  $usuario = $remitente
  $clave = (Leer-Clave 'Contrasena de aplicacion (16 letras; no se vera al escribir)') -replace '\s', ''
  if ($clave.Length -ne 16) { throw 'La contrasena de aplicacion tiene 16 letras. Revise y vuelva a intentar.' }
  $servidor = 'smtp.gmail.com'; $puerto = 465
}
elseif ($opcion -eq '2') {
  Write-Host 'En Brevo: menu de su nombre > "SMTP y API" > pestana SMTP.'
  $usuario = (Read-Host 'Inicio de sesion SMTP (aparece como "Login", algo como 9a1b2c@smtp-brevo.com)').Trim()
  Probar-Correo $usuario
  $clave = (Leer-Clave 'Clave SMTP (boton "Generar una nueva clave SMTP"; no se vera al escribir)').Trim()
  if ($clave.Length -lt 10) { throw 'Esa clave SMTP parece incompleta. Copiela de nuevo desde Brevo.' }
  $remitente = (Read-Host 'Correo remitente (el que verifico en Brevo; lo veran los estudiantes)').Trim()
  Probar-Correo $remitente
  $servidor = 'smtp-relay.brevo.com'; $puerto = 587
}
else { throw 'Escriba 1 o 2.' }

# Reemplaza la configuracion anterior de correo y conserva el resto de server\.env
$resto = @(Get-Content -LiteralPath $archivo | Where-Object { $_ -notmatch '^(SMTP_|CORREO_REMITENTE=|URL_PUBLICA=)' })
$nuevas = @(
  "SMTP_HOST=$servidor",
  "SMTP_PUERTO=$puerto",
  "SMTP_USUARIO=$usuario",
  "SMTP_CLAVE=$clave",
  "CORREO_REMITENTE=EcoSmart AI <$remitente>",
  'URL_PUBLICA=http://localhost:5173/'
)
Set-Content -LiteralPath $archivo -Value ($resto + $nuevas) -Encoding ascii
$clave = $null

Write-Host ''
Write-Host "Listo: los correos saldran como $remitente." -ForegroundColor Green
Write-Host 'Cierre las ventanas negras de EcoSmart y vuelva a abrir "Iniciar EcoSmart" para que tome el cambio.'
