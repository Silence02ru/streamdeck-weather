# Собирает файл для релиза dist\com.silence02.openmeteo.streamDeckPlugin
# официальной утилитой Elgato (@elgato/cli). Двойной щелчок по файлу устанавливает плагин.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "com.silence02.openmeteo.sdPlugin"
$dist = Join-Path $root "dist"

# Плагин работает без сборщика, поэтому node_modules кладутся внутрь пакета.
Push-Location $src
try { npm install --omit=dev --no-audit --no-fund } finally { Pop-Location }

New-Item -ItemType Directory -Force $dist | Out-Null
npx -y @elgato/cli@1.10.3 pack $src --output $dist --force --no-update-check
if ($LASTEXITCODE -ne 0) { throw "streamdeck pack завершился с кодом $LASTEXITCODE" }
Write-Host "Готово: $dist"
