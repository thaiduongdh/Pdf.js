[CmdletBinding()]
param(
    [string]$ViewerUrl
)

$ErrorActionPreference = "Stop"

function Start-ChromeViewerA3TrayHost {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [string]$Url
    )

    $argumentList = @(
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        "`"$ScriptPath`""
    )

    if ($Url) {
        $argumentList += @(
            "-ViewerUrl",
            "`"$Url`""
        )
    }

    Start-Process -FilePath "powershell.exe" -ArgumentList $argumentList -WorkingDirectory $PSScriptRoot -WindowStyle Hidden | Out-Null
}

if ([Threading.Thread]::CurrentThread.ApartmentState -ne [Threading.ApartmentState]::STA) {
    Start-ChromeViewerA3TrayHost -ScriptPath $PSCommandPath -Url $ViewerUrl
    exit
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class ChromeViewerA3NativeMethods
{
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

function Hide-ConsoleWindow {
    $consoleHandle = [ChromeViewerA3NativeMethods]::GetConsoleWindow()
    if ($consoleHandle -ne [IntPtr]::Zero) {
        [ChromeViewerA3NativeMethods]::ShowWindow($consoleHandle, 0) | Out-Null
    }
}

function Show-StartupError {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        "ChromeViewerA3",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}

function Get-AppBrowserPath {
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($env:ProgramFiles) {
        $candidates.Add((Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"))
        $candidates.Add((Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"))
    }

    if (${env:ProgramFiles(x86)}) {
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"))
        $candidates.Add((Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"))
    }

    if ($env:LocalAppData) {
        $candidates.Add((Join-Path $env:LocalAppData "Google\Chrome\Application\chrome.exe"))
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    return $null
}

function Open-ChromeViewerA3Window {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    $browserPath = Get-AppBrowserPath
    if ($browserPath) {
        Start-Process -FilePath $browserPath -ArgumentList "--app=$Url" | Out-Null
        return
    }

    Start-Process $Url | Out-Null
}

$root = $PSScriptRoot
$serverUrl = "http://localhost:8080"
if (-not $ViewerUrl) {
    $ViewerUrl = "$serverUrl/web/start.html"
}

$notifyIcon = $null
$icon = $null
$mutex = $null
$ownsMutex = $false

try {
    Hide-ConsoleWindow
    & (Join-Path $root "ensure-chromeviewera3-services.ps1")

    $mutex = [System.Threading.Mutex]::new($false, "Local\ChromeViewerA3.Tray")
    try {
        $ownsMutex = $mutex.WaitOne(0, $false)
    }
    catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }

    if (-not $ownsMutex) {
        Open-ChromeViewerA3Window -Url $ViewerUrl
        return
    }

    [System.Windows.Forms.Application]::EnableVisualStyles()
    $applicationContext = [System.Windows.Forms.ApplicationContext]::new()

    $contextMenu = [System.Windows.Forms.ContextMenuStrip]::new()
    $openMenuItem = [System.Windows.Forms.ToolStripMenuItem]::new("Open ChromeViewerA3")
    $openMenuItem.add_Click({
        Open-ChromeViewerA3Window -Url $ViewerUrl
    })

    $exitMenuItem = [System.Windows.Forms.ToolStripMenuItem]::new("Exit Tray")
    $exitMenuItem.add_Click({
        if ($notifyIcon) {
            $notifyIcon.Visible = $false
        }
        $applicationContext.ExitThread()
    })

    [void]$contextMenu.Items.Add($openMenuItem)
    [void]$contextMenu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
    [void]$contextMenu.Items.Add($exitMenuItem)

    $notifyIcon = [System.Windows.Forms.NotifyIcon]::new()
    $notifyIcon.Text = "ChromeViewerA3"
    $notifyIcon.ContextMenuStrip = $contextMenu
    $notifyIcon.add_MouseDoubleClick({
        param($sender, $eventArgs)
        if ($eventArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
            Open-ChromeViewerA3Window -Url $ViewerUrl
        }
    })

    $iconPath = Join-Path $root "chromeviewera3.ico"
    if (Test-Path -LiteralPath $iconPath) {
        $icon = [System.Drawing.Icon]::new($iconPath)
        $notifyIcon.Icon = $icon
    }
    else {
        $notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    }

    $notifyIcon.Visible = $true
    Open-ChromeViewerA3Window -Url $ViewerUrl

    [System.Windows.Forms.Application]::Run($applicationContext)
}
catch {
    Show-StartupError -Message ("ChromeViewerA3 could not start.`r`n`r`n" + $_.Exception.Message)
    exit 1
}
finally {
    if ($notifyIcon) {
        $notifyIcon.Visible = $false
        $notifyIcon.Dispose()
    }

    if ($icon) {
        $icon.Dispose()
    }

    if ($ownsMutex -and $mutex) {
        try {
            $mutex.ReleaseMutex()
        }
        catch {
        }
    }

    if ($mutex) {
        $mutex.Dispose()
    }
}
