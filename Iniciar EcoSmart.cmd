@echo off
rem Prende EcoSmart AI con doble clic: el servidor, la pagina y Chrome.
rem Para apagar, cierra las dos ventanas negras "EcoSmart".
cd /d "%~dp0"
netstat -ano | findstr ":3001 " | findstr LISTENING >nul || start "EcoSmart - servidor (no cerrar)" cmd /k npm.cmd run servidor:dev
netstat -ano | findstr ":5173 " | findstr LISTENING >nul || start "EcoSmart - pagina (no cerrar)" cmd /k npm.cmd run dev:bd
echo Prendiendo EcoSmart AI, espera unos segundos...
timeout /t 8 /nobreak >nul
start "" http://localhost:5173
