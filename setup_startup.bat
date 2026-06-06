@echo off
set "TARGET_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "BATCH_FILE=%TARGET_DIR%\start_owl_gateway.bat"

echo Creating startup script at: %BATCH_FILE%

(
echo @echo off
echo cd /d "%cd%"
echo start "" /B python owl_gateway.py --port 3710
) > "%BATCH_FILE%"

echo Startup script created successfully. The OWL Gateway will run automatically on Windows boot.
pause
