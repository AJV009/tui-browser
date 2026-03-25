#!/bin/bash
# One-time build script for vscode-icons-js browser bundle
set -e
cd "$(dirname "$0")/.."

npm install --no-save esbuild

# Create entry point in project dir so esbuild can resolve node_modules
cat > .vscode-icons-entry.js << 'ENTRY'
const { getIconForFile, getIconForFolder, getIconForOpenFolder } = require('vscode-icons-js');
window.getIconForFile = getIconForFile;
window.getIconForFolder = getIconForFolder;
window.getIconForOpenFolder = getIconForOpenFolder;
ENTRY

mkdir -p public/vendor
npx esbuild .vscode-icons-entry.js \
  --bundle \
  --format=iife \
  --platform=browser \
  --minify \
  --outfile=public/vendor/vscode-icons.js

rm .vscode-icons-entry.js
echo "Built: public/vendor/vscode-icons.js ($(wc -c < public/vendor/vscode-icons.js) bytes)"
