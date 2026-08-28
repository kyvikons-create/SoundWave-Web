# Иконки приложения SoundWave для iOS (120/180) и веб (192/512)
Add-Type -AssemblyName System.Drawing

$iosDir = Join-Path $PSScriptRoot "icons"
$webDir = Join-Path (Split-Path $PSScriptRoot -Parent) "icons"
New-Item -ItemType Directory -Force -Path $iosDir | Out-Null
New-Item -ItemType Directory -Force -Path $webDir | Out-Null

function Make-Icon([int]$s, [string]$outPath) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, [System.Drawing.Color]::FromArgb(255, 232, 58, 0),
        [System.Drawing.Color]::FromArgb(255, 255, 149, 0), 45)
    $g.FillRectangle($brush, $rect)
    $white = [System.Drawing.Brushes]::White
    $k = $s / 256.0
    function Ell([single]$x, [single]$y, [single]$w, [single]$h) {
        $g.FillEllipse($white, ($x * $k), ($y * $k), ($w * $k), ($h * $k))
    }
    Ell 62 122 132 58
    Ell 78 84 74 74
    Ell 106 62 88 88
    Ell 148 94 62 62
    $g.Dispose()
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "иконка: $outPath"
}

Make-Icon 120 (Join-Path $iosDir "AppIcon60x60@2x.png")
Make-Icon 180 (Join-Path $iosDir "AppIcon60x60@3x.png")
Make-Icon 192 (Join-Path $webDir "icon-192.png")
Make-Icon 512 (Join-Path $webDir "icon-512.png")
