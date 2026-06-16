#!/usr/bin/env bash
set -euo pipefail

# Deploy Fleet Performance Dashboard add-in
# Usage: ./deploy.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "=== Step 1: Build ==="
node "$ROOT/build.js"

echo ""
echo "=== Step 2: Git push ==="
cd "$ROOT"
if git diff --quiet docs/ config.json 2>/dev/null; then
    echo "No changes to commit."
else
    git add docs/ config.json
    git commit -m "Deploy: update add-in build"
    git push
    echo "Pushed to GitHub. GitHub Pages will update in ~20s."
fi

echo ""
echo "Done!"
echo "URL: https://niteshmistry-sig.github.io/addin-fleet-performance/index.html"
