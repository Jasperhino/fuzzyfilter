#!/bin/bash
set -e

# Navigate to monorepo root
cd "$(dirname "$0")/../.."

# Verify we're in the right place
if [ ! -f "package.json" ] || [ ! -f "turbo.json" ]; then
  echo "Error: Could not find package.json or turbo.json. Current directory: $(pwd)"
  exit 1
fi

# Run turbo build
bunx turbo run build --filter=landing
