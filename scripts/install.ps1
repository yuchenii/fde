# FDE Installation Script for Windows

param(
    [string]$InstallDir = "$env:LOCALAPPDATA\Programs\FDE",
    [ValidateSet("both", "server", "client", "")]
    [string]$Component = ""
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

# Component selection
if ($Component -eq "") {
    Write-Host "What would you like to install?" -ForegroundColor Cyan
    Write-Host "   1) Both server and client (default)"
    Write-Host "   2) Server only"
    Write-Host "   3) Client only"
    Write-Host ""
    $choice = Read-Host "Enter your choice [1-3]"
    
    switch ($choice) {
        "2" { $Component = "server" }
        "3" { $Component = "client" }
        default { $Component = "both" }
    }
}

$InstallServer = ($Component -eq "both") -or ($Component -eq "server")
$InstallClient = ($Component -eq "both") -or ($Component -eq "client")

if ($InstallServer -and $InstallClient) {
    Write-Host "Installing both server and client" -ForegroundColor Green
} elseif ($InstallServer) {
    Write-Host "Installing server only" -ForegroundColor Green
} else {
    Write-Host "Installing client only" -ForegroundColor Green
}
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
$BASE_URL = "https://github.com/$REPO/releases/download/$LATEST_VERSION"

if ($InstallServer) {
    $SERVER_FILE = "fde-server-$OS-$ARCH.exe"
    $ServerTarget = "$InstallDir\fde-server.exe"
    Write-Host "Downloading $SERVER_FILE..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "$BASE_URL/$SERVER_FILE" -OutFile "$InstallDir\$SERVER_FILE"
    # Remove existing file before rename (Rename-Item -Force doesn't overwrite)
    if (Test-Path $ServerTarget) {
        Remove-Item -Path $ServerTarget -Force
    }
    Rename-Item -Path "$InstallDir\$SERVER_FILE" -NewName "fde-server.exe"
    Write-Host "Server installed" -ForegroundColor Green
}

if ($InstallClient) {
    $CLIENT_FILE = "fde-client-$OS-$ARCH.exe"
    $ClientTarget = "$InstallDir\fde-client.exe"
    Write-Host "Downloading $CLIENT_FILE..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "$BASE_URL/$CLIENT_FILE" -OutFile "$InstallDir\$CLIENT_FILE"
    # Remove existing file before rename (Rename-Item -Force doesn't overwrite)
    if (Test-Path $ClientTarget) {
        Remove-Item -Path $ClientTarget -Force
    }
    Rename-Item -Path "$InstallDir\$CLIENT_FILE" -NewName "fde-client.exe"
    Write-Host "Client installed" -ForegroundColor Green
}

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
if ($InstallServer) {
    Write-Host "   Server: fde-server.exe start -c server.yaml"
}
if ($InstallClient) {
    Write-Host "   Client: fde-client.exe deploy -e prod"
}
Write-Host ""
Write-Host "Welcome to FDE!" -ForegroundColor Green
