@echo off
title Airbnb Market Intelligence - NestJS + React
cd /d "%~dp0"

echo ============================================================
echo  KHOI DONG AIRBNB MARKET INTELLIGENCE (NESTJS + REACT)
echo  Backend API : http://localhost:3000
echo  Frontend UI : http://localhost:5173
echo ============================================================
echo.

echo [1/3] Dang don tien trinh cu chiem cong 3000 (neu co)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

echo [2/3] Dang bien dich Backend NestJS (npm --prefix backend run build)...
call npm --prefix backend run build
if errorlevel 1 (
  echo [LOI] Bien dich Backend that bai! Vui long kiem tra lai ma nguon.
  pause
  exit /b 1
)

echo [3/3] Dang khoi chay Backend (dist/main.js) va React Frontend (5173)...
start "Airbnb Monorepo (NestJS + React)" cmd /k "npm start"

REM Doi 4 giay cho Backend & Vite san sang roi mo trinh duyet
timeout /t 4 /nobreak >nul
start "" "http://localhost:5173"

echo Da mo trinh duyet tai http://localhost:5173
echo Ban co the dong cua so nay. De tat server, hay dong cua so "Airbnb Monorepo (NestJS + React)".
pause
