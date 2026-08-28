# Генерирует иконки SoundWave (градиент + белое облако)
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

foreach ($s in 180, 192, 512) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 232, 58, 0),
        [System.Drawing.Color]::FromArgb(255, 255, 149, 0), 45)
    $g.FillRectangle($brush, $rect)

    $white = [System.Drawing.Brushes]::White
    $k = $s / 256.0
    function Ell([single]$x, [single]$y, [single]$w, [single]$h) {
        $g.FillEllipse($white, ($x * $k), ($y * $k), ($w * $k), ($h * $k))
    }
    # облако
    Ell 62 122 132 58    # основание
    Ell 78 84 74 74      # левый бугор
    Ell 106 62 88 88     # центральный бугор
    Ell 148 94 62 62     # правый бугор

    $g.Dispose()
    $bmp.Save((Join-Path $outDir "icon-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "icons/icon-$s.png готова"
}
