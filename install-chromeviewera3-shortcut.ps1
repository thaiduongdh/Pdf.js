# Creates/updates a Start Menu shortcut for this repo's launcher, with a custom icon.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\\install-chromeviewera3-shortcut.ps1

[CmdletBinding()]
param(
  [string]$ShortcutName = "ChromeViewerA3",
  [switch]$Desktop
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$preferredTarget = Join-Path $root "chromeviewera3-app.vbs"
$fallbackTargets = @(
  (Join-Path $root "chromeviewera3-app.bat"),
  (Join-Path $root "start-chromeviewera3.bat")
)

$target = $null
if (Test-Path -LiteralPath $preferredTarget) {
  $target = $preferredTarget
} else {
  foreach ($candidate in $fallbackTargets) {
    if (Test-Path -LiteralPath $candidate) {
      $target = $candidate
      break
    }
  }
}

if (-not $target) {
  throw "Missing launcher: $preferredTarget or $($fallbackTargets -join ', ')"
}
$iconPath = Join-Path $root "chromeviewera3.ico"

function Find-ChromeViewerA3SourceImage {
  $desktopDir = [Environment]::GetFolderPath("Desktop")
  $preferredNames = @(
    "652252885_1358756739620402_5101296490549388290_n.jpg"
  )

  foreach ($name in $preferredNames) {
    $directPath = Join-Path $desktopDir $name
    if (Test-Path -LiteralPath $directPath) {
      return $directPath
    }

    $match = Get-ChildItem -Path $desktopDir -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -eq $name } |
      Select-Object -First 1 -ExpandProperty FullName

    if ($match) {
      return $match
    }
  }

  return $null
}

function New-ChromeViewerA3Icon {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$SourceImagePath
  )

  Add-Type -AssemblyName System.Drawing

  $size = 256
  $sourceImage = [System.Drawing.Image]::FromFile($SourceImagePath)
  $bmp = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = [Math]::Max($size / $sourceImage.Width, $size / $sourceImage.Height)
  $drawWidth = [int][Math]::Ceiling($sourceImage.Width * $scale)
  $drawHeight = [int][Math]::Ceiling($sourceImage.Height * $scale)
  $offsetX = [int][Math]::Floor(($size - $drawWidth) / 2)
  $offsetY = [int][Math]::Floor(($size - $drawHeight) / 2)
  $destRect = New-Object System.Drawing.Rectangle($offsetX, $offsetY, $drawWidth, $drawHeight)
  $g.DrawImage($sourceImage, $destRect)

  $pngStream = New-Object System.IO.MemoryStream
  $bmp.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $pngStream.ToArray()

  $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = New-Object System.IO.BinaryWriter($fs)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]1)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$pngBytes.Length)
    $writer.Write([UInt32]22)
    $writer.BaseStream.Write($pngBytes, 0, $pngBytes.Length)
    $writer.Flush()
  } finally {
    $writer.Close()
    $fs.Close()
    $pngStream.Dispose()
    $g.Dispose()
    $bmp.Dispose()
    $sourceImage.Dispose()
  }
}

$sourceImagePath = Find-ChromeViewerA3SourceImage
if ($sourceImagePath) {
  New-ChromeViewerA3Icon -Path $iconPath -SourceImagePath $sourceImagePath
} elseif (-not (Test-Path -LiteralPath $iconPath)) {
  throw "Could not find the ChromeViewerA3 source image on the Desktop and the existing icon is missing: $iconPath"
}

$legacyNames = @("Start LocalReader")
$programsDir = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs"
foreach ($legacyName in $legacyNames) {
  $legacyShortcut = Join-Path $programsDir ($legacyName + ".lnk")
  if (Test-Path -LiteralPath $legacyShortcut) {
    Remove-Item -LiteralPath $legacyShortcut -Force -ErrorAction SilentlyContinue
  }
}
$startShortcut = Join-Path $programsDir ($ShortcutName + ".lnk")

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($startShortcut)
$sc.TargetPath = $target
$sc.WorkingDirectory = $root
$sc.IconLocation = $iconPath
$sc.Description = "Launch ChromeViewerA3."
$sc.Save()

if ($Desktop) {
  $desktopDir = [Environment]::GetFolderPath("Desktop")
  $desktopShortcut = Join-Path $desktopDir ($ShortcutName + ".lnk")
  foreach ($legacyName in $legacyNames) {
    $legacyDesktopShortcut = Join-Path $desktopDir ($legacyName + ".lnk")
    if (Test-Path -LiteralPath $legacyDesktopShortcut) {
      Remove-Item -LiteralPath $legacyDesktopShortcut -Force -ErrorAction SilentlyContinue
    }
  }
  $sc2 = $wsh.CreateShortcut($desktopShortcut)
  $sc2.TargetPath = $target
  $sc2.WorkingDirectory = $root
  $sc2.IconLocation = $iconPath
  $sc2.Description = "Launch ChromeViewerA3."
  $sc2.Save()
}
