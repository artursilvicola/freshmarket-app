@echo off
chcp 65001 >nul
title Fresh Market - Uruchamianie aplikacji
color 0A

echo.
echo ============================================
echo   FRESH MARKET - Uruchamianie aplikacji
echo ============================================
echo.

cd /d "%~dp0"
echo Folder: %CD%
echo.

REM Sprawdz czy Node jest zainstalowany
where node >nul 2>nul
if errorlevel 1 (
    echo [BLAD] Node.js nie jest zainstalowany!
    echo.
    echo Pobierz Node.js ze strony:
    echo https://nodejs.org/  ^(wersja LTS^)
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js znaleziony:
node --version
echo.

REM Sprawdz czy node_modules istnieje
if not exist "node_modules" (
    echo [INFO] Pierwsze uruchomienie - instaluje zaleznosci...
    echo To moze potrwac 1-2 minuty.
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [BLAD] npm install nie powiodlo sie.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Zaleznosci zainstalowane.
    echo.
)

REM Sprawdz czy plik .env istnieje
if not exist ".env" (
    echo [BLAD] Brak pliku .env!
    echo.
    echo Skopiuj .env.example jako .env i wstaw klucze Supabase.
    echo Patrz: SETUP_INSTRUKCJA.md krok 4.
    pause
    exit /b 1
)

REM Sprawdz czy istnieje plik PreconnectFM
if not exist "src\legacy\PreconnectFM.jsx" (
    echo [OSTRZEZENIE] Brak pliku src\legacy\PreconnectFM.jsx
    echo.
    echo Skopiuj swoj plik "PreconnectFM (22).jsx" do folderu:
    echo   src\legacy\
    echo i zmien nazwe na: PreconnectFM.jsx
    echo.
    echo Aplikacja sie nie uruchomi bez tego pliku.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Uruchamiam serwer...
echo ============================================
echo.
echo Po uruchomieniu otworz w przegladarce:
echo   http://localhost:5173/
echo.
echo Aby zatrzymac serwer: nacisnij Ctrl+C
echo.

call npm run dev

pause
