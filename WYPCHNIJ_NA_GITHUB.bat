@echo off
chcp 65001 >nul
title Push do GitHub
color 0B

echo.
echo ============================================
echo   Push projektu na GitHub
echo ============================================
echo.

cd /d "%~dp0"
echo Folder: %CD%
echo.

REM Sprawdz czy git jest zainstalowany
where git >nul 2>nul
if errorlevel 1 (
    echo [BLAD] Git nie jest zainstalowany!
    echo.
    echo Pobierz Git ze strony:
    echo https://git-scm.com/download/win
    echo.
    echo Po instalacji uruchom ten skrypt ponownie.
    pause
    exit /b 1
)
echo [OK] Git znaleziony:
git --version
echo.

REM Sprawdz i ustaw git identity (jednorazowo)
for /f "tokens=*" %%i in ('git config --global user.email 2^>nul') do set GIT_EMAIL=%%i
if not defined GIT_EMAIL (
    echo [INFO] Konfiguruje git identity...
    git config --global user.email "artur.stasiak@freshmarket.eu"
    git config --global user.name "Artur Stasiak"
    echo [OK] Identity ustawione: Artur Stasiak ^<artur.stasiak@freshmarket.eu^>
    echo.
)

REM Sprawdz czy git repo juz istnieje
if exist ".git" (
    echo [INFO] Repozytorium git juz istnieje.
    echo Sprawdzam status...
    git status --short
    echo.
    echo Dodaje wszystkie zmiany...
    git add .
    git commit -m "Update: %date% %time%"
    echo.
    echo Wypycham na GitHub...
    git push
    echo.
    echo [OK] Gotowe! Zmiany wypchniete.
    pause
    exit /b 0
)

REM Pierwsze uruchomienie - inicjalizacja
echo [INFO] Pierwsze uruchomienie - inicjalizuje repozytorium...
echo.

git init
if errorlevel 1 (
    echo [BLAD] git init nie powiodlo sie.
    pause
    exit /b 1
)

echo.
echo Dodaje wszystkie pliki...
git add .
if errorlevel 1 (
    echo [BLAD] git add nie powiodlo sie.
    pause
    exit /b 1
)

echo.
echo Pierwszy commit...
git commit -m "Initial commit - Fresh Market app"
if errorlevel 1 (
    echo [BLAD] git commit nie powiodlo sie.
    echo Mozliwe ze git wymaga konfiguracji uzytkownika:
    echo   git config --global user.email "twoj@email.com"
    echo   git config --global user.name "Twoja Nazwa"
    pause
    exit /b 1
)

echo.
echo Ustawiam glowna galaz na 'main'...
git branch -M main

echo.
echo Lacze z GitHub...
git remote add origin https://github.com/artursilvicola/freshmarket-app.git
if errorlevel 1 (
    echo [INFO] Remote juz istnieje, kontynuuje...
    git remote set-url origin https://github.com/artursilvicola/freshmarket-app.git
)

echo.
echo ============================================
echo   Wypycham na GitHub...
echo ============================================
echo.
echo Jesli to pierwszy raz - moze pojawic sie okno
echo logowania do GitHub w przegladarce. Zaloguj sie
echo i autoryzuj git (1 raz, potem zapamietuje).
echo.

git push -u origin main
if errorlevel 1 (
    echo.
    echo [BLAD] Push nie powiodl sie.
    echo Mozliwe przyczyny:
    echo   - autoryzacja w przegladarce nie wykonana
    echo   - branch konflikt (jesli na GitHub jest juz README itp.)
    echo.
    echo Jesli git mowi 'rejected' bo remote ma juz pliki:
    echo   git pull origin main --allow-unrelated-histories
    echo   potem ponownie URUCHOM ten skrypt
    pause
    exit /b 1
)

echo.
echo ============================================
echo   [OK] SUKCES!
echo ============================================
echo.
echo Twoj kod jest na GitHubie:
echo https://github.com/artursilvicola/freshmarket-app
echo.
echo Mozesz teraz przejsc do Netlify deploy.
echo.
pause
