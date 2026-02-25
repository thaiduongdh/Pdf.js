param(
    [Alias("PdfPath")]
    [string]$FilePath
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080
$serverUrl = "http://localhost:$port"

# Check if server is running
function Test-Server {
    try {
        Invoke-WebRequest -Uri $serverUrl -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

# Start server if not running
if (-not (Test-Server)) {
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden
    Start-Sleep -Milliseconds 800
}

# Open viewer
if ($FilePath) {
    $resolvedPath = $FilePath
    try {
        $resolvedPath = (Resolve-Path -LiteralPath $FilePath -ErrorAction Stop).ProviderPath
    }
    catch {
        # Keep original; viewer will likely fail gracefully if it can't be streamed.
        $resolvedPath = $FilePath
    }

    # Pass path to server stream endpoint
    $encodedPath = [uri]::EscapeDataString($resolvedPath)
    $ext = [IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
    if ($ext -eq ".epub") {
        $viewerUrl = "$serverUrl/web/epub-viewer.html?file=/stream?path=$encodedPath"
    }
    else {
        $viewerUrl = "$serverUrl/web/viewer.html?file=/stream?path=$encodedPath"
    }
}
else {
    $viewerUrl = "$serverUrl/web/viewer.html"
}

Start-Process $viewerUrl
