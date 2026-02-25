# Debug script - start server and print URL
$serverScript = "C:\Users\thaid\Source\Pdf.js\server.js"
$targetPdf = "C:\Users\thaid\Source\Pdf.js\server.js" # Using this file as a dummy target

# Stop any running node
Stop-Process -Name "node" -ErrorAction SilentlyContinue

# Start server
Start-Process -FilePath "node" -ArgumentList $serverScript -WorkingDirectory "C:\Users\thaid\Source\Pdf.js" -WindowStyle Hidden
Start-Sleep -Seconds 2

# Generate URL
$encodedPath = [uri]::EscapeDataString($targetPdf)
$url = "http://localhost:8080/web/viewer.html?file=/stream?path=$encodedPath"
Write-Output $url
