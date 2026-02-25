# Creates/updates a Start Menu shortcut for this repo's launcher, with a custom icon.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\\install-start-shortcut.ps1

[CmdletBinding()]
param(
  [string]$ShortcutName = "Start PDF.js",
  [switch]$Desktop
)

$root = $PSScriptRoot
$target = Join-Path $root "start-pdfjs.bat"
$iconPath = Join-Path $root "pdfjs.ico"

if (-not (Test-Path -LiteralPath $target)) {
  throw "Missing launcher: $target"
}

function New-PdfJsIcon {
  param([Parameter(Mandatory = $true)][string]$Path)

  Add-Type -AssemblyName System.Drawing

  $size = 256
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $bg = [System.Drawing.ColorTranslator]::FromHtml("#f15a24")
  $g.Clear($bg)

  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.ColorTranslator]::FromHtml("#d64a1c"), 10)
  $g.DrawRectangle($borderPen, 5, 5, $size - 10, $size - 10)

  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center

  $font = New-Object System.Drawing.Font ("Segoe UI", 96, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $shadowBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(60, 0, 0, 0))
  $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $rect = New-Object System.Drawing.RectangleF (0, 0, $size, $size)

  # Simple "PDF" mark; keep it readable at small icon sizes.
  $g.DrawString("PDF", $font, $shadowBrush, (New-Object System.Drawing.RectangleF(2, 4, $size, $size)), $fmt)
  $g.DrawString("PDF", $font, $textBrush, $rect, $fmt)

  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $icon.Save($fs)
  } finally {
    $fs.Close()
    $icon.Dispose()
    $borderPen.Dispose()
    $font.Dispose()
    $shadowBrush.Dispose()
    $textBrush.Dispose()
    $fmt.Dispose()
    $g.Dispose()
    $bmp.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $iconPath)) {
  New-PdfJsIcon -Path $iconPath
}

$programsDir = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs"
$startShortcut = Join-Path $programsDir ($ShortcutName + ".lnk")

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($startShortcut)
$sc.TargetPath = $target
$sc.WorkingDirectory = $root
$sc.IconLocation = $iconPath
$sc.Description = "Launch the local PDF.js viewer (server + browser)."
$sc.Save()

if ($Desktop) {
  $desktopDir = [Environment]::GetFolderPath("Desktop")
  $desktopShortcut = Join-Path $desktopDir ($ShortcutName + ".lnk")
  $sc2 = $wsh.CreateShortcut($desktopShortcut)
  $sc2.TargetPath = $target
  $sc2.WorkingDirectory = $root
  $sc2.IconLocation = $iconPath
  $sc2.Description = "Launch the local PDF.js viewer (server + browser)."
  $sc2.Save()
}

