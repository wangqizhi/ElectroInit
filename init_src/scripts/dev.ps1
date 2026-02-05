$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$frontend = Join-Path $root "src\frontend"
$env:ELECTRON_DEV_URL = "http://localhost:5173"
Write-Host "Starting Vite dev server..."
$vite = Start-Process -PassThru -NoNewWindow -WorkingDirectory $frontend -FilePath "cmd.exe" -ArgumentList "/c","npm","run","dev"
Start-Sleep -Seconds 2
Write-Host "Starting Electron..."
Set-Location $root
try {
  npx electron .
} finally {
  if ($vite -and -not $vite.HasExited) {
    Write-Host "Stopping Vite dev server..."
    taskkill /T /F /PID $vite.Id 2>$null
  }
}
