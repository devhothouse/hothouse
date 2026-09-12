#!/bin/sh
# Hothouse launcher wrapper (macOS/Linux) - see scripts/launcher.js
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Hothouse needs Node.js to run, but it is not installed."
  echo ""
  echo "  Please install the current version of Node.js from:"
  echo "    https://nodejs.org/en/download"
  echo "  and then start Hothouse again."
  echo ""
  exit 1
fi
node scripts/launcher.js
