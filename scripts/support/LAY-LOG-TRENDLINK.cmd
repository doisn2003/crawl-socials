@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-trendlink-diagnostics.ps1"
if errorlevel 1 echo Chua tao duoc ZIP. Hay gui lai dong thong bao loi trong cua so nay.
pause
