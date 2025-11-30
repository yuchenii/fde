# 自动安装脚本 - FDE (Windows)

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\FDE"
)

$ErrorActionPreference = "Stop"

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                   FDE - 自动安装脚本 (Windows)               ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""

# 系统信息
$OS = "windows"
$ARCH = "x64"

Write-Host "📋 系统信息:" -ForegroundColor Yellow
Write-Host "   操作系统: $OS"
Write-Host "   架构: $ARCH"
Write-Host ""

# GitHub 仓库信息
$REPO = "yuchenii/fde"  # 替换为实际仓库

Write-Host "📦 准备下载:" -ForegroundColor Yellow
Write-Host "   平台: $OS-$ARCH"
Write-Host "   安装目录: $InstallDir"
Write-Host ""

# 创建安装目录
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# 获取最新版本
Write-Host "🔍 获取最新版本..." -ForegroundColor Yellow
$latestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
$LATEST_VERSION = $latestRelease.tag_name

Write-Host "✅ 最新版本: $LATEST_VERSION" -ForegroundColor Green
Write-Host ""

# 下载文件
$SERVER_FILE = "fde-server-$OS-$ARCH.exe"
$CLIENT_FILE = "fde-client-$OS-$ARCH.exe"
$BASE_URL = "https://github.com/$REPO/releases/download/$LATEST_VERSION"

Write-Host "⬇️  Downloading $SERVER_FILE..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$BASE_URL/$SERVER_FILE" -OutFile "$InstallDir\$SERVER_FILE"

Write-Host "⬇️  Downloading $CLIENT_FILE..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$BASE_URL/$CLIENT_FILE" -OutFile "$InstallDir\$CLIENT_FILE"

# 重命名为简短名称
Write-Host "📋 Installing..." -ForegroundColor Yellow
Rename-Item -Path "$InstallDir\$SERVER_FILE" -NewName "fde-server.exe" -Force
Rename-Item -Path "$InstallDir\$CLIENT_FILE" -NewName "fde-client.exe" -Force

# Add to PATH if not present
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host "➕ Adding to PATH..." -ForegroundColor Yellow
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir" # Update current session's PATH
    Write-Host "✅ Added to PATH (restart terminal for full effect)" -ForegroundColor Green
} else {
    Write-Host "ℹ️ Install directory already in PATH." -ForegroundColor DarkYellow
}

Write-Host "`n✅ Installation completed!" -ForegroundColor Green
Write-Host "   Location: $InstallDir"
Write-Host "   Server: fde-server.exe -s -c server.yaml"
Write-Host "   Client: fde-client.exe -s -e prod"
Write-Host ""
Write-Host "🎉 欢迎使用 FDE!" -ForegroundColor Green
