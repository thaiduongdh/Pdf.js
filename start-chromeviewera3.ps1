$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appScript = Join-Path $root "chromeviewera3-app.ps1"
$argumentList = @(
    "-NoProfile",
    "-STA",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-File",
    "`"$appScript`""
)

Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -WorkingDirectory $root -WindowStyle Hidden | Out-Null
