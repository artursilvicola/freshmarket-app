# Skrypt kopiujący freshmarket-eu-content do clone'a repo z gwarantowanym UTF-8
# Uruchomienie: PowerShell → ./copy-to-repo.ps1 -DestPath "C:\Users\Artur\Documents\GitHub\freshmarket-eu"

param(
    [string]$DestPath = "C:\Users\Artur\Documents\GitHub\freshmarket-eu"
)

$ErrorActionPreference = "Stop"

$src = "C:\Users\Artur\OneDrive\Dokumenty\Claude\Projects\Fresh Market 2026\freshmarket-eu-content"

if (-not (Test-Path $DestPath)) {
    Write-Error "Folder docelowy nie istnieje: $DestPath"
    Write-Host "Sklonuj repo najpierw: git clone https://github.com/artursilvicola/freshmarket-eu.git $DestPath"
    exit 1
}

if (-not (Test-Path $src)) {
    Write-Error "Folder źródłowy nie istnieje: $src"
    exit 1
}

Write-Host "Źródło: $src" -ForegroundColor Cyan
Write-Host "Cel:    $DestPath" -ForegroundColor Cyan
Write-Host ""

# Wyklucz lokalne foldery
$exclude = @('node_modules', 'dist', '.astro', '.netlify')

Write-Host "Kopiowanie plików (zachowując UTF-8)..." -ForegroundColor Yellow

# Robocopy z /MIR flagą — mirror, ale wykluczamy node_modules itd.
# /XD = exclude directories, /XF = exclude files, /COPY:DAT = data, attributes, timestamps
$excludeArgs = $exclude | ForEach-Object { "/XD"; $_ }

# Najprościej i najbezpieczniej: Copy-Item z -Recurse (zachowuje encoding bajtowo)
Get-ChildItem -Path $src -Exclude $exclude | ForEach-Object {
    $target = Join-Path $DestPath $_.Name
    Write-Host "  → $($_.Name)"
    Copy-Item -Path $_.FullName -Destination $target -Recurse -Force
}

Write-Host ""
Write-Host "Sprawdzenie poprawności kodowania kilku plików:" -ForegroundColor Yellow

$samples = @(
    "src\content\pages\pl\index.md",
    "src\content\pages\pl\contact.md",
    "src\components\ContactForm.astro"
)

foreach ($f in $samples) {
    $full = Join-Path $DestPath $f
    if (Test-Path $full) {
        $content = Get-Content -Path $full -Raw -Encoding UTF8
        $hasMojibake = $content -match 'TytuĹ|DziÄ|â€|â‚|Ä™|Ĺ‚'
        $hasPolishChars = $content -match '[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]'
        if ($hasMojibake) {
            Write-Host "  ✗ $f - WYKRYTO MOJIBAKE" -ForegroundColor Red
        } elseif ($hasPolishChars) {
            Write-Host "  ✓ $f - polskie znaki OK" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ $f - brak polskich znaków (sprawdź ręcznie)" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Gotowe. Następne kroki:" -ForegroundColor Cyan
Write-Host "  cd `"$DestPath`""
Write-Host "  npm install"
Write-Host "  npm run build"
Write-Host "  # Jeśli build OK → GitHub Desktop → commit + push"
