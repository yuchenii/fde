#!/bin/bash

# FDE Installation Script
# Supports macOS and Linux

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}            FDE - Installation Script                      ${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]') 
ARCH=$(uname -m)

echo -e "${YELLOW}System Information:${NC}"
echo "   OS: $OS"
echo "   Architecture: $ARCH"
echo ""

# Convert architecture names
case "$ARCH" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo -e "${RED}Unsupported architecture: $ARCH${NC}"
    exit 1
    ;;
esac

# Convert OS names
case "$OS" in
  darwin)
    OS="macos"
    ;;
  linux)
    OS="linux"
    ;;
  *)
    echo -e "${RED}Unsupported OS: $OS${NC}"
    echo -e "${YELLOW}Windows users please use the PowerShell install script${NC}"
    exit 1
    ;;
esac

# GitHub repository
REPO="yuchenii/fde"
INSTALL_DIR="$HOME/.local/bin"

echo -e "${YELLOW}Download Settings:${NC}"
echo "   Platform: $OS-$ARCH"
echo "   Install Directory: $INSTALL_DIR"
echo ""

# Create installation directory
mkdir -p "$INSTALL_DIR"

# Get latest version
echo -e "${YELLOW}Fetching latest version...${NC}"
LATEST_VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_VERSION" ]; then
    echo -e "${RED}Failed to get latest version${NC}"
    exit 1
fi

echo -e "${GREEN}Latest version: $LATEST_VERSION${NC}"
echo ""

# Download files
SERVER_FILE="fde-server-$OS-$ARCH"
CLIENT_FILE="fde-client-$OS-$ARCH"
BASE_URL="https://github.com/$REPO/releases/download/$LATEST_VERSION"

echo "Downloading $SERVER_FILE..."
curl -L -o "$INSTALL_DIR/$SERVER_FILE" "$BASE_URL/$SERVER_FILE" --progress-bar

echo "Downloading $CLIENT_FILE..."
curl -L -o "$INSTALL_DIR/$CLIENT_FILE" "$BASE_URL/$CLIENT_FILE" --progress-bar

# Set executable permissions
chmod +x "$INSTALL_DIR/$SERVER_FILE"
chmod +x "$INSTALL_DIR/$CLIENT_FILE"

# Rename to short names
echo "Installing..."
mv "$INSTALL_DIR/$SERVER_FILE" "$INSTALL_DIR/fde-server"
mv "$INSTALL_DIR/$CLIENT_FILE" "$INSTALL_DIR/fde-client"

echo ""
echo -e "${GREEN}Installation completed!${NC}"
echo ""
echo -e "${YELLOW}Usage:${NC}"
echo "   Server: fde-server -s -c server.yaml"
echo "   Client: fde-client -s -e prod"
echo ""

# Check PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}Note: $INSTALL_DIR is not in PATH${NC}"
    echo ""
    echo "Please add the following to ~/.bashrc or ~/.zshrc:"
    echo "   export PATH=\"\$PATH:$INSTALL_DIR\""
    echo ""
fi

echo -e "${GREEN}Welcome to FDE!${NC}"
