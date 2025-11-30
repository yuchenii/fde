#!/bin/bash

# 自动安装脚本 - FDE
# 支持 macOS 和 Linux

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                     FDE - 自动安装脚本                       ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# 检测操作系统
OS=$(uname -s | tr '[:upper:]' '[:lower:]') 
ARCH=$(uname -m)

echo -e "${YELLOW}📋 系统信息:${NC}"
echo "   操作系统: $OS"
echo "   架构: $ARCH"
echo ""

# 转换架构名称
case "$ARCH" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ;;
  *)
    echo -e "${RED}❌ 不支持的架构: $ARCH${NC}"
    exit 1
    ;;
esac

# 转换操作系统名称
case "$OS" in
  darwin)
    OS="macos"
    ;;
  linux)
    OS="linux"
    ;;
  *)
    echo -e "${RED}❌ 不支持的操作系统: $OS${NC}"
    echo -e "${YELLOW}💡 Windows 用户请使用 PowerShell 安装脚本${NC}"
    exit 1
    ;;
esac

# GitHub 仓库信息
REPO="yuchenii/fde"  # 替换为实际仓库
INSTALL_DIR="$HOME/.local/bin"

echo -e "${YELLOW}📦 准备下载:${NC}"
echo "   平台: $OS-$ARCH"
echo "   安装目录: $INSTALL_DIR"
echo ""

# 创建安装目录
mkdir -p "$INSTALL_DIR"

# 获取最新版本
echo -e "${YELLOW}🔍 获取最新版本...${NC}"
LATEST_VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_VERSION" ]; then
    echo -e "${RED}❌ 无法获取最新版本${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 最新版本: $LATEST_VERSION${NC}"
echo ""

# 下载文件
SERVER_FILE="fde-server-$OS-$ARCH"
CLIENT_FILE="fde-client-$OS-$ARCH"
BASE_URL="https://github.com/$REPO/releases/download/$LATEST_VERSION"

echo "⬇️  Downloading $SERVER_FILE..."
curl -L -o "$INSTALL_DIR/$SERVER_FILE" "$BASE_URL/$SERVER_FILE" --progress-bar
chmod +x "$INSTALL_DIR/$SERVER_FILE"

echo "⬇️  Downloading $CLIENT_FILE..."
curl -L -o "$INSTALL_DIR/$CLIENT_FILE" "$BASE_URL/$CLIENT_FILE" --progress-bar
chmod +x "$INSTALL_DIR/$CLIENT_FILE"

# 创建符号链接
echo "🔗 Creating aliases..."
ln -sf "$INSTALL_DIR/$SERVER_FILE" "$INSTALL_DIR/fde-server"
ln -sf "$INSTALL_DIR/$CLIENT_FILE" "$INSTALL_DIR/fde-client"

echo ""
echo -e "${GREEN}✅ 安装完成！${NC}"
echo ""
echo -e "${YELLOW}📝 使用说明:${NC}"
echo "   服务端: fde-server -s -c server.yaml"
echo "   客户端: fde-client -s -e prod"
echo ""

# 检查 PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo -e "${YELLOW}⚠️  注意: $INSTALL_DIR 不在 PATH 中${NC}"
    echo ""
    echo "请将以下内容添加到 ~/.bashrc 或 ~/.zshrc:"
    echo "   export PATH=\"\$PATH:$INSTALL_DIR\""
    echo ""
fi

echo -e "${GREEN}🎉 欢迎使用 FDE!${NC}"
