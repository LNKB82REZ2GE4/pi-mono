#!/usr/bin/env bash
set -euo pipefail

# Install pi globally from this repo
# This replaces the globally installed version
# Run this ONLY when you want to "release" your changes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building pi..."
cd "$SCRIPT_DIR"
npm run build

echo ""
echo "Installing pi globally..."
cd packages/coding-agent
npm link

echo ""
echo "✓ Done! The 'pi' command now uses your local build."
echo "  Run 'pi --version' to verify."
