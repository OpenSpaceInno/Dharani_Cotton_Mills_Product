@echo off
setlocal EnableDelayedExpansion
title Dharani Weighbridge - Client Laptop Diagnostic Check
color 0F

echo ================================================================================
echo         DHARANI WEIGHBRIDGE - CLIENT LAPTOP SYSTEM VERIFICATION
echo ================================================================================
echo.
echo Checking required client prerequisites on this computer...
echo.

set "ALL_OK=1"

:: 1. Check Visual C++ Runtime 64-bit
echo [1/3] Checking Microsoft Visual C++ 2015-2022 Redistributable (x64)...
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" /v Installed >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo    [PASS] Microsoft Visual C++ 64-bit Redistributable is INSTALLED.
) else (
    echo    [FAIL] Microsoft Visual C++ 64-bit Redistributable is MISSING!
    echo           Please install: https://aka.ms/vs/17/release/vc_redist.x64.exe
    set "ALL_OK=0"
)
echo.

:: 2. Check if MySQL Service exists and is running
echo [2/3] Checking MySQL Server 8.0 Service...
sc query MySQL80 >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    sc query MySQL80 | find "STATE" | find "RUNNING" >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo    [PASS] MySQL80 Windows Service is RUNNING.
    ) else (
        echo    [WARN] MySQL80 Windows Service is STOPPED. Starting it now...
        net start MySQL80
    )
) else (
    sc query mysql >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo    [PASS] MySQL Windows Service is RUNNING.
    ) else (
        echo    [FAIL] MySQL Server is NOT INSTALLED or service not found!
        echo           Please install MySQL Server 8.0 from:
        echo           https://dev.mysql.com/downloads/installer/
        set "ALL_OK=0"
    )
)
echo.

:: 3. Check Port 3306 Listening
echo [3/3] Checking Port 3306 Local Connection...
netstat -ano | find "3306" | find "LISTENING" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo    [PASS] Local MySQL is actively listening on Port 3306.
) else (
    echo    [FAIL] Nothing is listening on Port 3306!
    echo           Ensure MySQL Server is started.
    set "ALL_OK=0"
)
echo.

:: 4. Summary & Recommendation
echo ================================================================================
if "%ALL_OK%"=="1" (
    color 0A
    echo   STATUS: READY FOR DHARANI WEIGHBRIDGE!
    echo   You can launch 'Dharani Weighbridge' from your Desktop.
    echo   Default Login: admin / admin123
) else (
    color 0C
    echo   STATUS: ACTION REQUIRED!
    echo   Please complete the missing installations listed above.
)
echo ================================================================================
echo.
pause
