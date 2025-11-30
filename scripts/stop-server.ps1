# Stop fde-server daemon (PowerShell)

$PID_FILE = ".\fde-server.pid"

# Check if PID file exists
if (-Not (Test-Path $PID_FILE)) {
    Write-Host "❌ PID file not found: $PID_FILE" -ForegroundColor Red
    Write-Host "💡 Server may not be running in daemon mode" -ForegroundColor Yellow
    exit 1
}

# Read PID
$PID = Get-Content $PID_FILE

if ([string]::IsNullOrWhiteSpace($PID)) {
    Write-Host "❌ PID file is empty" -ForegroundColor Red
    exit 1
}

# Check if process is running
$Process = Get-Process -Id $PID -ErrorAction SilentlyContinue

if (-Not $Process) {
    Write-Host "⚠️  Process $PID is not running" -ForegroundColor Yellow
    Remove-Item $PID_FILE
    exit 1
}

# Stop the process
Write-Host "🛑 Stopping server (PID: $PID)..." -ForegroundColor Cyan
Stop-Process -Id $PID -Force

# Wait for process to stop
Start-Sleep -Seconds 1

# Verify process stopped
$Process = Get-Process -Id $PID -ErrorAction SilentlyContinue
if ($Process) {
    Write-Host "⚠️  Process did not stop, forcing..." -ForegroundColor Yellow
    Stop-Process -Id $PID -Force
}

Remove-Item $PID_FILE
Write-Host "✅ Server stopped successfully" -ForegroundColor Green
