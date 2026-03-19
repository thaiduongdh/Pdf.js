[CmdletBinding()]
param()

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverUrl = "http://localhost:8080"
$serverMetaUrl = "$serverUrl/api/app-meta"
$fileBrowserExe = Join-Path $root "vendor\filebrowser\windows-amd64\filebrowser.exe"
$fileBrowserBasePort = 8081

function Get-HttpResponse {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest `
            -Uri $Url `
            -TimeoutSec 2 `
            -UseBasicParsing `
            -Headers @{ "Cache-Control" = "no-cache" } `
            -ErrorAction Stop

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Content = [string]$response.Content
        }
    }
    catch {
        return $null
    }
}

function Get-AppMeta {
    $response = Get-HttpResponse -Url $serverMetaUrl
    if (-not $response) {
        return $null
    }

    try {
        return $response.Content | ConvertFrom-Json
    }
    catch {
        return $null
    }
}

function Get-DriveRoots {
    $roots = @()
    foreach ($code in 65..90) {
        $driveRoot = "{0}:\" -f [char]$code
        if (Test-Path -LiteralPath $driveRoot) {
            $roots += $driveRoot
        }
    }
    return $roots
}

function Get-FileBrowserTargets {
    $targets = @()
    $driveRoots = @(Get-DriveRoots)
    for ($index = 0; $index -lt $driveRoots.Count; $index += 1) {
        $driveRoot = $driveRoots[$index]
        $driveKey = $driveRoot.Substring(0, 1).ToLowerInvariant()
        $port = $fileBrowserBasePort + $index
        $targets += [pscustomobject]@{
            Name = $driveRoot.Substring(0, 2)
            RootPath = $driveRoot
            Port = $port
            Url = "http://localhost:$port/files/"
            DatabasePath = Join-Path $root "vendor\filebrowser\drive-$driveKey-filebrowser.db"
        }
    }
    return $targets
}

function Get-ListeningProcessIds {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $output = @(cmd /c netstat -ano -p tcp 2>$null)
    if (-not $output) {
        return @()
    }

    $processIds = @()
    foreach ($line in $output) {
        if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)\s*$") {
            $processIds += [int]$matches[1]
        }
    }

    return @($processIds | Select-Object -Unique)
}

function Get-ListeningProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedProcessName
    )

    $owningProcesses = @(Get-ListeningProcessIds -Port $Port)
    foreach ($processId in $owningProcesses) {
        try {
            $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
        }
        catch {
            continue
        }

        if ($process.Name -ne "$ExpectedProcessName.exe") {
            continue
        }

        return $process
    }

    return $null
}

function Get-FileBrowserProcesses {
    return @(Get-CimInstance Win32_Process -Filter "Name = 'filebrowser.exe'" -ErrorAction SilentlyContinue)
}

function Test-CurrentNodeServer {
    $meta = Get-AppMeta
    $targets = @(Get-FileBrowserTargets)
    if (-not $meta -or $meta.suiteName -ne "ChromeViewerA3" -or $meta.workspacePath -ne $root) {
        return $false
    }

    $metaTargets = @($meta.fileBrowserTargets)
    if ($metaTargets.Count -ne $targets.Count) {
        return $false
    }

    for ($index = 0; $index -lt $targets.Count; $index += 1) {
        if ($metaTargets[$index].path -ne $targets[$index].RootPath -or
            $metaTargets[$index].port -ne $targets[$index].Port -or
            $metaTargets[$index].url -ne $targets[$index].Url) {
            return $false
        }
    }

    return $true
}

function Test-CurrentFileBrowser {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Target
    )

    $process = Get-ListeningProcess -Port $Target.Port -ExpectedProcessName "filebrowser"
    if (-not $process) {
        return $false
    }

    return $process.CommandLine -match [regex]::Escape($Target.DatabasePath)
}

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Condition,
        [int]$Attempts = 20,
        [int]$DelayMs = 300
    )

    for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
        if (& $Condition) {
            return $true
        }
        Start-Sleep -Milliseconds $DelayMs
    }

    return $false
}

function Stop-ListeningProcess {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$ExpectedProcessName
    )

    $owningProcesses = @(Get-ListeningProcessIds -Port $Port)

    foreach ($processId in $owningProcesses) {
        if (-not $processId) {
            continue
        }

        try {
            $process = Get-Process -Id $processId -ErrorAction Stop
        }
        catch {
            continue
        }

        if ($process.ProcessName -ne $ExpectedProcessName) {
            continue
        }

        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Milliseconds 400
}

function Stop-FileBrowserProcessByDatabase {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DatabasePath
    )

    $pattern = [regex]::Escape($DatabasePath)
    foreach ($process in @(Get-FileBrowserProcesses)) {
        if ($process.CommandLine -notmatch $pattern) {
            continue
        }

        Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
    }

    Start-Sleep -Milliseconds 400
}

function Ensure-NodeServer {
    if (Test-CurrentNodeServer) {
        return
    }

    Stop-ListeningProcess -Port 8080 -ExpectedProcessName "node"
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $root -WindowStyle Hidden | Out-Null

    if (-not (Wait-Until -Condition { Test-CurrentNodeServer } -Attempts 24 -DelayMs 300)) {
        throw "ChromeViewerA3 server did not start with the expected API shape."
    }
}

function Configure-FileBrowser {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Target
    )

    if (-not (Test-Path -LiteralPath $Target.DatabasePath)) {
        & $fileBrowserExe config init `
            -d $Target.DatabasePath `
            -a 127.0.0.1 `
            -p $Target.Port `
            -r $Target.RootPath `
            --auth.method noauth `
            --branding.name "ChromeViewerA3" `
            --branding.disableExternal `
            --branding.disableUsedPercentage `
            --singleClick `
            --hideLoginButton *> $null
    }

    & $fileBrowserExe config set `
        -d $Target.DatabasePath `
        -a 127.0.0.1 `
        -p $Target.Port `
        -r $Target.RootPath `
        --auth.method noauth `
        --branding.name "ChromeViewerA3" `
        --branding.disableExternal `
        --branding.disableUsedPercentage `
        --singleClick `
        --hideLoginButton *> $null
}

function Ensure-FileBrowser {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Target
    )

    if (Test-CurrentFileBrowser -Target $Target) {
        return
    }

    Stop-ListeningProcess -Port $Target.Port -ExpectedProcessName "filebrowser"
    Stop-FileBrowserProcessByDatabase -DatabasePath $Target.DatabasePath
    Configure-FileBrowser -Target $Target
    Start-Process `
        -FilePath $fileBrowserExe `
        -ArgumentList @("-d", $Target.DatabasePath, "-a", "127.0.0.1", "-p", "$($Target.Port)", "-r", $Target.RootPath) `
        -WorkingDirectory (Split-Path -Parent $fileBrowserExe) `
        -WindowStyle Hidden | Out-Null

    if (-not (Wait-Until -Condition { Test-CurrentFileBrowser -Target $Target } -Attempts 20 -DelayMs 300)) {
        throw "ChromeViewerA3 File Browser did not start for $($Target.RootPath)."
    }
}

if (-not (Test-Path -LiteralPath $fileBrowserExe)) {
    throw "Missing File Browser binary: $fileBrowserExe"
}

Ensure-NodeServer
foreach ($target in @(Get-FileBrowserTargets)) {
    Ensure-FileBrowser -Target $target
}
