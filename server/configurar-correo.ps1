# Configura el envio real de correos (RF01, RF02, RNF13) en server\.env.
# Pide la cuenta de Gmail y su "contrasena de aplicacion" (16 letras que da Google; NO es la
# contrasena normal). La clave se escribe oculta y no se muestra nunca.
#
# Uso: powershell -ExecutionPolicy Bypass -File server\configurar-correo.ps1
# Para apagar el envio real: borre las lineas SMTP_ de server\.env

$ErrorActionPreference = 'Stop'
$archivo = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $archivo)) { throw 'No existe server\.env. Primero corra server\configurar.ps1' }

Write-Host ''
Write-Host 'Correo real para EcoSmart AI' -ForegroundColor Green
Write-Host 'Necesita una cuenta de Gmail con verificacion en 2 pasos y una contrasena de aplicacion'
Write-Host '(https://myaccount.google.com/apppasswords).'
Write-Host ''
$cuenta = (Read-Host 'Cuenta de Gmail que enviara los correos').Trim()
if ($cuenta -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { throw 'Esa no parece una direccion de correo.' }

$seguro = Read-Host 'Contrasena de aplicacion (16 letras; no se vera al escribir)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
try { $clave = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$clave = $clave -replace '\s', ''   # Google la muestra en grupos de 4 con espacios
if ($clave.Length -lt 16) { throw 'La contrasena de aplicacion tiene 16 letras. Revise y vuelva a intentar.' }

# Reemplaza la configuracion anterior de correo y conserva el resto de server\.env
$resto = @(Get-Content -LiteralPath $archivo | Where-Object { $_ -notmatch '^(SMTP_|CORREO_REMITENTE=|URL_PUBLICA=)' })
$nuevas = @(
  'SMTP_HOST=smtp.gmail.com',
  'SMTP_PUERTO=465',
  "SMTP_USUARIO=$cuenta",
  "SMTP_CLAVE=$clave",
  "CORREO_REMITENTE=EcoSmart AI <$cuenta>",
  'URL_PUBLICA=http://localhost:5173/'
)
Set-Content -LiteralPath $archivo -Value ($resto + $nuevas) -Encoding ascii
$clave = $null

Write-Host ''
Write-Host "Listo: los correos saldran desde $cuenta." -ForegroundColor Green
Write-Host 'Cierre las ventanas negras de EcoSmart y vuelva a abrir "Iniciar EcoSmart" para que tome el cambio.'
