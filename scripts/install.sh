#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "Installing wAIpoint from: $REPO_DIR"
echo

# --- CLI ---
CLI_SRC="$REPO_DIR/scripts/waipoint"
CLI_DST="/usr/local/bin/waipoint"

if [ -L "$CLI_DST" ] && [ "$(readlink "$CLI_DST")" = "$CLI_SRC" ]; then
  echo "✓ CLI already linked: $CLI_DST → $CLI_SRC"
else
  echo "→ Linking CLI: $CLI_DST → $CLI_SRC"
  sudo mkdir -p /usr/local/bin
  sudo ln -sf "$CLI_SRC" "$CLI_DST"
  echo "  ✓ done"
fi

# --- Skill (shared across harnesses) ---
SKILL_SRC="$REPO_DIR/skills/waipoint"
SKILL_DST="$HOME/.agents/skills/waipoint"

mkdir -p "$HOME/.agents/skills"
if [ -L "$SKILL_DST" ] && [ "$(readlink "$SKILL_DST")" = "$SKILL_SRC" ]; then
  echo "✓ Skill already linked: $SKILL_DST → $SKILL_SRC"
else
  echo "→ Linking skill: $SKILL_DST → $SKILL_SRC"
  ln -sfn "$SKILL_SRC" "$SKILL_DST"
  echo "  ✓ done"
fi

# --- Pi extension ---
EXT_SRC="$REPO_DIR/extensions/waipoint.ts"
EXT_DIR="$HOME/.pi/agent/extensions"
EXT_DST="$EXT_DIR/waipoint.ts"

mkdir -p "$EXT_DIR"
if [ -L "$EXT_DST" ] && [ "$(readlink "$EXT_DST")" = "$EXT_SRC" ]; then
  echo "✓ Pi extension already linked: $EXT_DST → $EXT_SRC"
else
  echo "→ Linking pi extension: $EXT_DST → $EXT_SRC"
  ln -sf "$EXT_SRC" "$EXT_DST"
  echo "  ✓ done"
fi

echo
echo "Installed:"
echo "  CLI:        $CLI_DST → $CLI_SRC"
echo "  Skill:      $SKILL_DST → $SKILL_SRC"
echo "  Extension:  $EXT_DST → $EXT_SRC"
echo
echo "Requirements:"
echo "  • gh (GitHub CLI) must be authenticated"
echo "  • pi (for extension features)"
echo
echo "Then point the CLI at your data repo:"
echo "  mkdir -p ~/.config/waipoint && echo 'repo=<owner>/<data-repo>' > ~/.config/waipoint/config"
