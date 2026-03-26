#!/bin/bash
# Pre-commit hook: auto-bump patch version in package.json
# Only bumps if files other than package.json are staged

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PKG="$PROJECT_ROOT/package.json"

# Check if any non-package.json files are staged
STAGED=$(git diff --cached --name-only -- ':!package.json')
if [ -z "$STAGED" ]; then
  exit 0
fi

# Read current version
CURRENT=$(node -p "require('$PKG').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH"

# Update package.json in place
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('$PKG', JSON.stringify(pkg, null, 2) + '\n');
"

git add "$PKG"
