#!/usr/bin/env bash
set -euo pipefail

PROJECTS_DIR="${1:-projects}"
TEMPLATE="${2:-docs/index.html}"
OUTPUT="${3:-dist/index.html}"

python3 "$(dirname "$0")/build-dashboard.py" "$PROJECTS_DIR" "$TEMPLATE" "$OUTPUT"
