# Start ChromeViewerA3 and open the mode chooser.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverUrl = "http://localhost:8080"
& (Join-Path $root "ensure-chromeviewera3-services.ps1")

Start-Process "$serverUrl/web/start.html"
