param (
    [switch]$Silent
)

$org = "mozilla"
$repo = "pdf.js"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$versionFile = Join-Path $root "version.txt"

Write-Host "Checking for pdf.js updates..." -ForegroundColor Cyan

# Get latest release
try {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$org/$repo/releases/latest" -ErrorAction Stop
}
catch {
    Write-Host "Failed to check for updates. Skipping." -ForegroundColor Red
    exit
}

$latestVersion = $release.tag_name
Write-Host "Latest version: $latestVersion" -ForegroundColor Green

# Check local version
$isUpToDate = $false
if (Test-Path $versionFile) {
    $currentVersion = Get-Content $versionFile -Raw
    if ($currentVersion.Trim() -eq $latestVersion) {
        Write-Host "Already up to date ($currentVersion). Skipping download." -ForegroundColor Gray
        $isUpToDate = $true
    }
}

if ($isUpToDate) {
    # Still update build timestamps across all html files to bust cache
    $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $htmlFiles = Get-ChildItem -Path (Join-Path $root "web") -Filter "*.html"
    foreach ($htmlFile in $htmlFiles) {
        $htmlContent = Get-Content $htmlFile.FullName -Raw
        if ($htmlContent -match '\?v=[0-9a-zA-Z_-]+') {
            $htmlContent = $htmlContent -replace '\?v=[0-9a-zA-Z_-]+', "?v=$timestamp"
            $htmlContent | Set-Content $htmlFile.FullName -NoNewline
            Write-Host "Updated timestamps in $($htmlFile.Name)" -ForegroundColor Green
        }
    }
    exit
}

$asset = $release.assets | Where-Object { $_.name -like "*dist*" -and $_.name -notlike "*legacy*" } | Select-Object -First 1
Write-Host "Download URL: $($asset.browser_download_url)" -ForegroundColor Gray

if (-not $Silent) {
    $confirm = Read-Host "Download and update? (y/n)"
    if ($confirm -ne 'y') { exit }
}
else {
    Write-Host "Auto-updating to $latestVersion..." -ForegroundColor Cyan
}

# Backup customizations (Define list of files to preserve)
$customFiles = @("web\dark-mode.css", "web\dark-mode.js", "web\reading-position.js", "web\recent-files.css", "web\recent-files.js", "web\drop-handler.js", "web\epub-viewer.html", "web\epub-viewer.css", "web\epub-viewer.js", "web\epub.min.js", "web\jszip.min.js", "web\files-classic.html", "web\files.css", "web\files.html", "web\files.js", "web\start.css", "web\start.html", "web\startup-entry.js")
$preservedFiles = @{}

foreach ($file in $customFiles) {
    if (Test-Path (Join-Path $root $file)) {
        $preservedFiles[$file] = $true
        Write-Host "Found custom file: $file" -ForegroundColor Yellow
    }
}

# Backup current version
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupDir = Join-Path $root "backup_$timestamp"
Write-Host "Backing up current version to $backupDir..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
Move-Item (Join-Path $root "build") $backupDir -ErrorAction SilentlyContinue
Move-Item (Join-Path $root "web") $backupDir -ErrorAction SilentlyContinue

# Download and extract
$zipPath = Join-Path $env:TEMP "pdfjs_update.zip"
Write-Host "Downloading..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
Write-Host "Extracting..." -ForegroundColor Cyan
Expand-Archive -Path $zipPath -DestinationPath $root -Force
Remove-Item $zipPath

# Restore customizations from backup
foreach ($file in $preservedFiles.Keys) {
    $src = Join-Path $backupDir $file
    $dest = Join-Path $root $file
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dest -Force
        Write-Host "Restored $file" -ForegroundColor Green
    }
}

# Re-inject customizations into viewer.html
$viewerHtml = Join-Path $root "web\viewer.html"
$content = Get-Content $viewerHtml -Raw
$modified = $false

if ($preservedFiles["web\dark-mode.css"] -and $content -notmatch 'dark-mode\.css') {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    $content = $content -replace '(<link rel="stylesheet" href="viewer\.css" />)', "`$1
    <link rel='stylesheet' href='dark-mode.css?v=$timestamp' />"
    $modified = $true
}
if ($preservedFiles["web\dark-mode.js"] -and $content -notmatch 'dark-mode\.js') {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    # Match either single- or double-quoted attributes.
    $content = $content -replace '(<link\s+rel=[\"'']stylesheet[\"'']\s+href=[\"'']dark-mode\.css\?v=\d+[\"'']\s*/>)', "`$1
    <script src='dark-mode.js?v=$timestamp' defer></script>"
    $modified = $true
}
if ($preservedFiles["web\reading-position.js"] -and $content -notmatch 'reading-position\.js') {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    # Insert after dark-mode.js when present.
    if ($content -match 'dark-mode\.js') {
        $content = $content -replace '(<script\s+src=[\"'']dark-mode\.js\?v=\d+[\"'']\s+defer></script>)', "`$1
    <script src='reading-position.js?v=$timestamp' defer></script>"
    } else {
        $content = $content -replace '(<link\s+rel=[\"'']stylesheet[\"'']\s+href=[\"'']dark-mode\.css\?v=\d+[\"'']\s*/>)', "`$1
    <script src='reading-position.js?v=$timestamp' defer></script>"
    }
    $modified = $true
}
if ($preservedFiles["web\recent-files.css"] -and $content -notmatch 'recent-files\.css') {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    # Insert after reading-position.js when present, else after dark-mode.js.
    if ($content -match 'reading-position\.js') {
        $content = $content -replace '(<script\s+src=[\"'']reading-position\.js\?v=\d+[\"'']\s+defer></script>)', "`$1
    <link rel='stylesheet' href='recent-files.css?v=$timestamp' />"
    } else {
        $content = $content -replace '(<script\s+src=[\"'']dark-mode\.js\?v=\d+[\"'']\s+defer></script>)', "`$1
    <link rel='stylesheet' href='recent-files.css?v=$timestamp' />"
    }
    $modified = $true
}
if ($preservedFiles["web\recent-files.js"] -and $content -notmatch 'recent-files\.js') {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    if ($content -match 'recent-files\.css') {
        $content = $content -replace '(<link\s+rel=[\"'']stylesheet[\"'']\s+href=[\"'']recent-files\.css\?v=\d+[\"'']\s*/>)', "`$1
    <script src='recent-files.js?v=$timestamp' defer></script>"
    } else {
        $content = $content -replace '(<script\s+src=[\"'']reading-position\.js\?v=\d+[\"'']\s+defer></script>)', "`$1
    <script src='recent-files.js?v=$timestamp' defer></script>"
    }
    $modified = $true
}
if ($preservedFiles["web\drop-handler.js"] -and $content -notmatch 'drop-handler\.js') {
    $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
    if ($content -match 'recent-files\.js') {
        $content = $content -replace '(<script\s+src=[\"'']recent-files\.js\?v=\d+[\"'']\s+defer></script>)', "`$1
    <script src='drop-handler.js?v=$timestamp' defer></script>"
    } else {
        $content = $content -replace '(<script\s+src=[\"'']reading-position\.js\?v=\d+[\"'']\s+defer></script>)', "`$1
    <script src='drop-handler.js?v=$timestamp' defer></script>"
    }
    $modified = $true
}
if ($modified) {
    $content | Set-Content $viewerHtml -NoNewline
    Write-Host "Injected customizations into viewer.html" -ForegroundColor Green
}

# Update build timestamps across all html files to bust cache
$htmlFiles = Get-ChildItem -Path (Join-Path $root "web") -Filter "*.html"
foreach ($htmlFile in $htmlFiles) {
    $htmlContent = Get-Content $htmlFile.FullName -Raw
    if ($htmlContent -match '\?v=[0-9a-zA-Z_-]+') {
        $htmlContent = $htmlContent -replace '\?v=[0-9a-zA-Z_-]+', "?v=$timestamp"
        $htmlContent | Set-Content $htmlFile.FullName -NoNewline
        Write-Host "Updated timestamps in $($htmlFile.Name)" -ForegroundColor Green
    }
}

# Remove default sample PDF
$samplePdf = Join-Path $root "web\compressed.tracemonkey-pldi-09.pdf"
if (Test-Path $samplePdf) {
    Remove-Item $samplePdf
    Write-Host "Removed sample PDF" -ForegroundColor Gray
}

Write-Host "Update complete! Restart the server to apply changes." -ForegroundColor Green
$latestVersion | Set-Content $versionFile
