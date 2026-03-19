param(
    [Alias("DocumentPath")]
    [string]$FilePath
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8080
$serverUrl = "http://localhost:$port"
& (Join-Path $root "ensure-chromeviewera3-services.ps1")

# Open viewer
if ($FilePath) {
    $resolvedPath = $FilePath
    $isDirectory = $false
    try {
        $item = Get-Item -LiteralPath $FilePath -ErrorAction Stop
        $resolvedPath = $item.FullName
        $isDirectory = $item.PSIsContainer
    }
    catch {
        # Keep original; viewer will likely fail gracefully if it can't be streamed.
        $resolvedPath = $FilePath
    }

    $encodedPath = [uri]::EscapeDataString($resolvedPath)
    if ($isDirectory) {
        $viewerUrl = "$serverUrl/web/files-classic.html?path=$encodedPath"
    }
    else {
        $ext = [IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
        if ($ext -eq ".epub") {
            $viewerUrl = "$serverUrl/web/epub-viewer.html?file=/stream?path=$encodedPath"
        }
        elseif ($ext -eq ".pdf") {
            $viewerUrl = "$serverUrl/web/viewer.html?file=/stream?path=$encodedPath"
        }
        else {
            $viewerUrl = "$serverUrl/stream?path=$encodedPath"
        }
    }
}
else {
    $viewerUrl = "$serverUrl/web/start.html"
}

Start-Process $viewerUrl
