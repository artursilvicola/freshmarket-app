@echo off
chcp 65001 >nul
title Push do GitHub
color 0B

set REPO_URL=https://github.com/artursilvicola/freshmarket-app.git

echo.
echo ============================================
echo   Push projektu na GitHub
echo ============================================
echo.

cd /d "%~dp0"
echo Folder: %CD%
echo.

REM 1. Sprawdz git
where git >nul 2>nul
if errorlevel 1 (
    echo [BLAD] Git nie jest zainstalowany!
    echo Pobierz: https://git-scm.com/download/win
    pause
    exit /b 1
)
echo [OK] Git znaleziony:
git --version
echo.

REM 2. Identity
for /f "tokens=*" %%i in ('git config --global user.email 2^>nul') do set GIT_EMAIL=%%i
if not defined GIT_EMAIL (
    echo [INFO] Konfiguruje git identity...
    git config --global user.email "artur.stasiak@freshmarket.eu"
    git config --global user.name "Artur Stasiak"
    echo [OK] Identity ustawione
    echo.
)

REM 3. Init repo jesli nie istnieje
if not exist ".git" (
    echo [INFO] Inicjalizuje repozytorium git...
    git init
    echo.
)

REM 4. Dodaj wszystkie pliki i commit (bezpieczne - jesli nic do commitu, idzie dalej)
echo [INFO] Dodaje pliki...
git add .
echo.
echo [INFO] Commit (jesli sa nowe zmiany)...
git commit -m "Update %date% %time%" 2>nul
echo.

REM 5. Ustaw galaz na 'main'
git branch -M main 2>nul

REM 6. Sprawdz / ustaw remote
git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo [INFO] Dodaje remote origin -^> %REPO_URL%
    git remote add origin %REPO_URL%
) else (
    echo [INFO] Aktualizuje remote origin -^> %REPO_URL%
    git remote set-url origin %REPO_URL%
)
echo.

REM 7. Push
echo ============================================
echo   Wypycham na GitHub...
echo ============================================
echo.
echo Jesli to pierwszy raz - moze pojawic sie okno
echo logowania do GitHub w przegladarce.
echo.

git push -u origin main
if errorlevel 1 (
    echo.
    echo [BLAD] Push nie powiodl sie.
    echo.
    echo Mozliwe przyczyny:
    echo   1. Anulowane logowanie w przegladarce
    echo   2. Token wygasl
    echo   3. Remote ma juz pliki ^(np. README dodany przez github.com^)
    echo.
    echo Jesli widzisz 'rejected' bo remote ma pliki:
    echo   git pull origin main --allow-unrelated-histories --no-edit
    echo   git push -u origin main
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
pause
