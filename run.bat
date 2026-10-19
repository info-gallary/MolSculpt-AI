@echo off
rem MolSculpt launcher for Windows: double-click to start the app.
setlocal
cd /d "%~dp0"
title MolSculpt

rem --- Node.js 18.17+ is the only requirement --------------------------------
where node >nul 2>nul
if errorlevel 1 goto :no_node
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>18||(a===18&&b>=17)?0:1)"
if errorlevel 1 goto :old_node

rem --- First run: create .env from the template ------------------------------
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo Created .env from .env.example
)

rem --- Ask for a Groq API key if none is configured --------------------------
findstr /r /c:"^GROQ_API_KEY=..*" ".env" >nul
if not errorlevel 1 goto :key_ok
echo.
echo No Groq API key found in .env. Without it the AI Chemist runs in offline
echo mode (tools only). Get a free key at https://console.groq.com/keys
set "GROQ_KEY_INPUT="
set /p "GROQ_KEY_INPUT=Paste your Groq API key, or press Enter to skip: "
if not defined GROQ_KEY_INPUT goto :key_ok
powershell -NoProfile -Command "$k=$env:GROQ_KEY_INPUT.Trim(); $c=Get-Content '.env'; if ($c -match '^GROQ_API_KEY=') { $c=$c -replace '^GROQ_API_KEY=.*', ('GROQ_API_KEY=' + $k) } else { $c+=('GROQ_API_KEY=' + $k) }; Set-Content -Path '.env' -Value $c -Encoding ascii"
echo Saved the key to .env
:key_ok

rem --- Port from .env (default 5173) ----------------------------------------
set "PORT="
for /f "usebackq tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" set "PORT=%%b"
if not defined PORT set "PORT=5173"
set "URL=http://127.0.0.1:%PORT%"

echo.
echo Starting MolSculpt at %URL%
echo Use Chrome or Edge, then click "Hand tracking". Close this window to stop.
echo.

rem Open the browser once the server has had a moment to start.
if not defined MOLSCULPT_NO_BROWSER start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" %URL%"

node server\server.js
echo.
echo MolSculpt stopped.
pause
exit /b 0

:no_node
echo Node.js was not found. Install Node.js 18.17 or newer from https://nodejs.org/
echo and run this file again.
pause
exit /b 1

:old_node
echo Your Node.js version is too old. Install Node.js 18.17 or newer from https://nodejs.org/
pause
exit /b 1
