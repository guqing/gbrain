#!/usr/bin/env sh
# exo install script
# Usage: curl -fsSL https://raw.githubusercontent.com/guqing/gbrain/main/install.sh | sh

set -e

REPO="guqing/gbrain"
BIN_NAME="exo"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect OS and arch
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)
    case "$ARCH" in
      x86_64)  ASSET="exo-linux-x64" ;;
      aarch64) ASSET="exo-linux-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  Darwin*)
    case "$ARCH" in
      x86_64)  ASSET="exo-darwin-x64" ;;
      arm64)   ASSET="exo-darwin-arm64" ;;
      *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    echo "For Windows, download exo-windows-x64.exe from https://github.com/$REPO/releases/latest" >&2
    exit 1
    ;;
esac

# Get latest release tag
echo "Fetching latest release..."
TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
if [ -z "$TAG" ]; then
  echo "Failed to fetch latest release tag" >&2
  exit 1
fi

URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
TMP="$(mktemp)"

echo "Downloading exo $TAG ($ASSET)..."
curl -fsSL "$URL" -o "$TMP"
chmod +x "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP" "$INSTALL_DIR/$BIN_NAME"
else
  echo "Installing to $INSTALL_DIR (may require sudo)..."
  sudo mv "$TMP" "$INSTALL_DIR/$BIN_NAME"
fi

echo ""
echo "✓ exo $TAG installed to $INSTALL_DIR/$BIN_NAME"
echo ""
echo "Run: exo --help"
