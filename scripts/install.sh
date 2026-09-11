#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [--yes] [--bin-dir DIR]

Links the waipoint CLI onto your PATH, then sets up each agent harness it
finds (pi, Claude Code). Every piece is a symlink into this clone, so
`git pull` updates them. Safe to run again.

  --yes          Make the config edits without asking
  --bin-dir DIR  Where to link the CLI (default: ~/.local/bin)

It asks before each config edit and keeps the file's previous version as
<file>.waipoint-bak. Without a terminal and without --yes, it edits no config
file and prints what to add instead.
EOF
}

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$HOME/.local/bin"
YES=false

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) YES=true; shift ;;
    --bin-dir)
      [ $# -ge 2 ] || { echo "Error: --bin-dir needs a directory" >&2; exit 1; }
      BIN_DIR="${2%/}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done
case "$BIN_DIR" in /*) ;; *) BIN_DIR="$PWD/$BIN_DIR" ;; esac

CLI="waipoint"
HOOK_NAME="claude-hook-validate-status.sh"
HOOK_CMD="$REPO_DIR/scripts/$HOOK_NAME"
SETTINGS="$HOME/.claude/settings.json"
CLAUDE_MD="$HOME/.claude/CLAUDE.md"
SECTION="$REPO_DIR/scripts/claude-md-section.md"

# Ask before editing a file the user owns. --yes answers yes; with no terminal
# to ask on, the answer is no and the caller prints the manual step instead.
confirm() {
  $YES && return 0
  [ -t 0 ] || return 1
  local answer
  printf '%s [Y/n] ' "$1"
  read -r answer || return 1
  case "$answer" in ""|[Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

# Keep the version of a file from just before this run changes it.
backup() {
  [ -f "$1" ] && cp -p "$1" "$1.waipoint-bak"
  return 0
}

# Symlink dst -> src. A stale link is repointed; a real file or directory is
# left alone, since it may be the user's own copy.
link() {
  local src="$1" dst="$2" label="$3"
  mkdir -p "$(dirname "$dst")"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "✓ $label already linked: $dst"
  elif [ -e "$dst" ] && ! [ -L "$dst" ]; then
    echo "! $label not linked: $dst exists and is not a symlink. Move it aside and run this again."
  else
    ln -sfn "$src" "$dst"
    echo "✓ $label linked: $dst → $src"
  fi
}

# The CLI directory is not on PATH: offer to add it in the shell's rc file.
add_to_path() {
  local shown line rc="" shell="${SHELL:-}"
  case "$BIN_DIR" in
    "$HOME"/*) shown="\$HOME${BIN_DIR#"$HOME"}" ;;
    *) shown="$BIN_DIR" ;;
  esac
  line="export PATH=\"$shown:\$PATH\""
  case "${shell##*/}" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) if [ "$(uname -s)" = Darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
  esac
  CLI="$BIN_DIR/waipoint"
  if [ -n "$rc" ] && [ -f "$rc" ] && grep -qxF "$line" "$rc"; then
    echo "✓ $rc already puts $BIN_DIR on PATH; new terminals will have it."
  elif [ -n "$rc" ] && confirm "$BIN_DIR is not on your PATH. Add it in $rc?"; then
    backup "$rc"
    printf '\n# Added by the wAIpoint installer\n%s\n' "$line" >> "$rc"
    echo "✓ Put $BIN_DIR on PATH in $rc; new terminals will have it."
  else
    echo "! $BIN_DIR is not on your PATH. Add this line to your shell's startup file:"
    echo "    $line"
  fi
}

# A hook entry is ours when its command ends in the script's name, so a clone
# that moved gets its entry repointed instead of a second one added.
JQ_OURS='def ours: type == "object" and (.command? | type) == "string" and (.command | endswith($name));'

claude_hook() {
  local current="" question tmp note=""
  if [ -f "$SETTINGS" ]; then
    if ! jq empty "$SETTINGS" > /dev/null 2>&1; then
      echo "! $SETTINGS is not valid JSON, so the status hook was not registered. See the README's Claude Code section."
      return 0
    fi
    current=$(jq -r --arg name "/$HOOK_NAME" "$JQ_OURS"'
      [.hooks?.PreToolUse?[]? | objects | .hooks?[]? | select(ours) | .command] | first // empty' "$SETTINGS")
  fi
  if [ "$current" = "$HOOK_CMD" ]; then
    echo "✓ Status hook already registered in $SETTINGS"
    return 0
  fi

  question="Register the wAIpoint status hook in $SETTINGS?"
  [ -n "$current" ] && question="Point the status hook in $SETTINGS at this clone (it runs $current)?"
  if ! confirm "$question"; then
    echo "! Status hook not registered. To add it yourself, merge this into $SETTINGS:"
    echo "    {\"hooks\": {\"PreToolUse\": [{\"matcher\": \"Bash\", \"hooks\": [{\"type\": \"command\", \"command\": \"$HOOK_CMD\"}]}]}}"
    return 0
  fi

  tmp=$(mktemp)
  { if [ -f "$SETTINGS" ]; then cat "$SETTINGS"; else echo '{}'; fi; } \
    | jq --arg name "/$HOOK_NAME" --arg cmd "$HOOK_CMD" "$JQ_OURS"'
      if ([.hooks?.PreToolUse?[]? | objects | .hooks?[]? | select(ours)] | length) > 0
      then .hooks.PreToolUse |= map(if type == "object" and (.hooks? | type) == "array"
                                    then .hooks |= map(if ours then .command = $cmd else . end) else . end)
      else .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [{matcher: "Bash", hooks: [{type: "command", command: $cmd}]}])
      end' > "$tmp"
  mkdir -p "$(dirname "$SETTINGS")"
  if [ -f "$SETTINGS" ]; then
    backup "$SETTINGS"
    note=" (previous version kept as $SETTINGS.waipoint-bak)"
  fi
  # Written in place, so a settings file that is a symlink stays one.
  cat "$tmp" > "$SETTINGS"
  rm -f "$tmp"
  echo "✓ Status hook registered in $SETTINGS$note"
}

claude_md() {
  local heading note=""
  heading=$(head -n 1 "$SECTION")
  if [ -f "$CLAUDE_MD" ] && grep -qxF "$heading" "$CLAUDE_MD"; then
    echo "✓ Tracking section already in $CLAUDE_MD"
    return 0
  fi
  if ! confirm "Add the wAIpoint tracking section to $CLAUDE_MD?"; then
    echo "! Tracking section not added. To add it yourself, append $SECTION to $CLAUDE_MD."
    return 0
  fi
  mkdir -p "$(dirname "$CLAUDE_MD")"
  if [ -s "$CLAUDE_MD" ]; then
    backup "$CLAUDE_MD"
    note=" (previous version kept as $CLAUDE_MD.waipoint-bak)"
    # Start the section after one blank line, even if the file lacks a final newline.
    [ -z "$(tail -c 1 "$CLAUDE_MD")" ] || echo >> "$CLAUDE_MD"
    echo >> "$CLAUDE_MD"
  fi
  cat "$SECTION" >> "$CLAUDE_MD"
  echo "✓ Tracking section added to $CLAUDE_MD$note"
}

echo "Installing wAIpoint from: $REPO_DIR"
echo

# --- Preflight ---
missing=""
for tool in gh jq base64; do
  command -v "$tool" > /dev/null 2>&1 || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "Error: missing required tools:$missing" >&2
  echo "Install them (gh: https://cli.github.com), then run this again. Nothing was installed." >&2
  exit 1
fi
command -v python3 > /dev/null 2>&1 || echo "! python3 not found: the dashboard and the Claude Code hook need it."
command -v tar > /dev/null 2>&1 || echo "! tar not found: the dashboard needs it."
gh auth status > /dev/null 2>&1 || echo "! gh is not logged in (or GitHub is unreachable). Run 'gh auth login' before 'waipoint init'."

# --- CLI ---
if ! mkdir -p "$BIN_DIR" 2> /dev/null || ! [ -w "$BIN_DIR" ]; then
  echo "Error: cannot write to $BIN_DIR. Choose a directory you own with --bin-dir." >&2
  exit 1
fi
link "$REPO_DIR/scripts/waipoint" "$BIN_DIR/waipoint" "CLI"
case ":$PATH:" in
  *":$BIN_DIR:"*)
    # An older install (e.g. /usr/local/bin) can come first on PATH.
    found=$(command -v waipoint || true)
    if [ -n "$found" ] && [ "$found" != "$BIN_DIR/waipoint" ] \
      && [ "$(readlink "$found" || true)" != "$REPO_DIR/scripts/waipoint" ]; then
      echo "! $found comes first on your PATH and shadows $BIN_DIR/waipoint. Remove it if it is an old install."
    fi ;;
  *) add_to_path ;;
esac

# --- Agent harnesses ---
pi=false
claude=false
if command -v pi > /dev/null 2>&1 || [ -d "$HOME/.pi" ]; then pi=true; fi
if command -v claude > /dev/null 2>&1 || [ -d "$HOME/.claude" ]; then claude=true; fi

# pi reads skills from ~/.agents/skills, a directory other harnesses share.
if $pi || [ -d "$HOME/.agents" ]; then
  link "$REPO_DIR/skills/waipoint" "$HOME/.agents/skills/waipoint" "Skill (~/.agents)"
fi
if $pi; then
  link "$REPO_DIR/extensions/waipoint.ts" "$HOME/.pi/agent/extensions/waipoint.ts" "pi extension"
fi
if $claude; then
  link "$REPO_DIR/skills/waipoint" "$HOME/.claude/skills/waipoint" "Claude Code skill"
  claude_hook
  claude_md
fi

echo
if $pi || $claude; then
  echo "Restart any running agent sessions so they pick this up."
else
  echo "! No agent harness found (looked for pi and Claude Code). The CLI works without one;"
  echo "  run this again after installing one."
fi
echo "Next: run '$CLI init' to create or connect your data repo."
