# Устанавливает плагин в Stream Deck: ставит зависимости, копирует папку плагина
# в папку плагинов Stream Deck и перезапускает его. После правок кода запустить снова.
# (Junction не подходит: Stream Deck не читает ссылки на некоторые диски, например S:.)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$name = "com.silence02.openmeteo.sdPlugin"
$src = Join-Path $root $name
$dst = Join-Path $env:APPDATA "Elgato\StreamDeck\Plugins\$name"

Push-Location $src
try { npm install --omit=dev --no-audit --no-fund } finally { Pop-Location }

$sd = Get-Process StreamDeck -ErrorAction SilentlyContinue
$exe = if ($sd) { $sd.Path } else { "C:\Program Files\Elgato\StreamDeck\StreamDeck.exe" }
if ($sd) { $sd | Stop-Process -Force; Start-Sleep -Seconds 2 }

if (Test-Path $dst) {
    $item = Get-Item $dst -Force
    if ($item.LinkType) { $item.Delete() } else { Remove-Item $dst -Recurse -Force }
}
robocopy $src $dst /MIR /XD logs /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy завершился с кодом $LASTEXITCODE" }
Write-Host "Плагин установлен: $dst"

Start-Process $exe
Write-Host "Stream Deck запущен. Действие «Погода» — в категории «Погода»."
