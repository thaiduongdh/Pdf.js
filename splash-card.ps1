param(
    [string]$AppName = "ReaderA3"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$imagePath = Join-Path $scriptDir "splash.jpg"

if (-not (Test-Path $imagePath)) {
    exit
}

$gitInfo = ""
try {
    $gitInfo = & git -C $scriptDir log -1 --format="%ci @%h" 2>$null
} catch {}

if ([string]::IsNullOrWhiteSpace($gitInfo)) {
    $gitInfo = "Unknown Build"
} else {
    $gitInfo = "Updated: $gitInfo"
}

$targetSize = 480
$footerHeight = 80

$form = New-Object System.Windows.Forms.Form
$form.Text = "Startup Splash"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.TopMost = $true
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#111111")
$form.ClientSize = New-Object System.Drawing.Size($targetSize, $targetSize + $footerHeight)
$form.ShowInTaskbar = $false

$pic = New-Object System.Windows.Forms.PictureBox
$pic.ImageLocation = $imagePath
$pic.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
$pic.Size = New-Object System.Drawing.Size($targetSize, $targetSize)
$pic.Location = New-Object System.Drawing.Point(0, 0)
$form.Controls.Add($pic)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = $AppName
$titleLabel.Font = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
$titleLabel.AutoSize = $true
$titleLabel.Location = New-Object System.Drawing.Point(14, $targetSize + 14)
$form.Controls.Add($titleLabel)

$metaLabel = New-Object System.Windows.Forms.Label
$metaLabel.Text = $gitInfo
$metaLabel.Font = New-Object System.Drawing.Font("Segoe UI", 8)
$metaLabel.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#C6C6C6")
$metaLabel.AutoSize = $true
$metaLabel.Location = New-Object System.Drawing.Point(14, $targetSize + 38)
$form.Controls.Add($metaLabel)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2400
$timer.Add_Tick({
    $form.Close()
})
$timer.Start()

[void]$form.ShowDialog()
