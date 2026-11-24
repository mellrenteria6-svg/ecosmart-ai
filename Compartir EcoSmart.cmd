@echo off
rem Prepara EcoSmart AI para compartirla desde VS Code (puerto 3001):
rem compila la pagina completa, prende el servidor y abre la pagina en el navegador.
rem Despues, en VS Code: pestana PUERTOS > Reenviar un puerto > 3001 > Visibilidad: Publica.
cd /d "%~dp0"
echo Preparando la pagina completa (tarda unos segundos)...
call npm.cmd run build:bd >nul 2>&1
if errorlevel 1 (
  echo No se pudo compilar la pagina. Avisale a quien te ayuda con el proyecto.
  pause
  exit /b 1
)
netstat -ano | findstr ":3001 " | findstr LISTENING >nul || start "EcoSmart - servidor (no cerrar)" cmd /k npm.cmd run servidor:dev
timeout /t 6 /nobreak >nul
start "" http://localhost:3001
echo.
echo Listo. Ahora comparte el puerto 3001 desde VS Code (pestana PUERTOS).
timeout /t 8 >nul
