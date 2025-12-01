# FDE Installation Script for Windows

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\FDE"
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Green
Write-Host "         FDE - Installation Script (Windows)               " -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

# System information
$OS = "windows"
$ARCH = "x64"

Write-Host "System Information:" -ForegroundColor Yellow
Write-Host "   OS: $OS"
Write-Host "   Architecture: $ARCH"
Write-Host ""

# GitHub repository
$REPO = "yuchenii/fde"

Write-Host "Download Settings:" -ForegroundColor Yellow
Write-Host "   Platform: $OS-$ARCH"
Write-Host "   Install Directory: $InstallDir"
Write-Host ""

# Create installation directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Get latest version
Write-Host "Fetching latest version..." -ForegroundColor Yellow
$latestRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO/releases/latest"
$LATEST_VERSION = $latestRelease.tag_name

Write-Host "Latest version: $LATEST_VERSION" -ForegroundColor Green
Write-Host ""

# Download files
$SERVER_FILE = "fde-server-$OS-$ARCH.exe"
$CLIENT_FILE = "fde-client-$OS-$ARCH.exe"
$BASE_URL = "https://github.com/$REPO/releases/download/$LATEST_VERSION"

Write-Host "Downloading $SERVER_FILE..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$BASE_URL/$SERVER_FILE" -OutFile "$InstallDir\$SERVER_FILE"

Write-Host "Downloading $CLIENT_FILE..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$BASE_URL/$CLIENT_FILE" -OutFile "$InstallDir\$CLIENT_FILE"

# Rename to short names
Write-Host "Installing..." -ForegroundColor Yellow
Rename-Item -Path "$InstallDir\$SERVER_FILE" -NewName "fde-server.exe" -Force
Rename-Item -Path "$InstallDir\$CLIENT_FILE" -NewName "fde-client.exe" -Force

# Add to PATH if not present
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    Write-Host "Adding to PATH..." -ForegroundColor Yellow
    [Environment]::SetEnvironmentVariable("Path", "$UserPath;$InstallDir", "User")
    $env:Path += ";$InstallDir" # Update current session's PATH
    Write-Host "Added to PATH (restart terminal for full effect)" -ForegroundColor Green
} else {
    Write-Host "Install directory already in PATH." -ForegroundColor DarkYellow
}

Write-Host "`nInstallation completed!" -ForegroundColor Green
Write-Host "   Location: $InstallDir"
Write-Host "   Server: fde-server.exe -s -c server.yaml"
Write-Host "   Client: fde-client.exe -s -e prod"
Write-Host ""
Write-Host "Welcome to FDE!" -ForegroundColor Green
