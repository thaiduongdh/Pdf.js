# Start PDF.js server (hidden) and open browser
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $scriptPath -WindowStyle Hidden
Start-Sleep -Seconds 1
Start-Process "http://localhost:8080"
