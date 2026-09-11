#!/usr/bin/env bash
# PreToolUse hook for Claude Code: validates --status values on waipoint commands.
# Reads tool input JSON from stdin. Exits 2 to block invalid status values.
set -euo pipefail

input=$(cat)
tool=$(echo "$input" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

[ "$tool" = "Bash" ] || exit 0

command=$(echo "$input" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('tool_input', {}).get('command', ''))
" 2>/dev/null) || exit 0

# Only check waipoint update commands
echo "$command" | grep -qE '\bwaipoint\s+update-(task|wp|project)\b' || exit 0

# Extract subcommand and --status value
subcommand=$(echo "$command" | grep -oE 'update-(task|wp|project)' | head -1)
status=$(echo "$command" | grep -oE '\-\-status\s+\S+' | head -1 | awk '{print $2}' | tr -d "'" | tr -d '"')

[ -n "$status" ] || exit 0

case "$subcommand" in
  update-task)
    case "$status" in open|current|done|dropped) exit 0 ;; esac
    valid="open, current, done, dropped"
    ;;
  update-wp)
    case "$status" in planned|in-progress|blocked|done) exit 0 ;; esac
    valid="planned, in-progress, blocked, done"
    ;;
  update-project)
    case "$status" in active|paused|completed|archived) exit 0 ;; esac
    valid="active, paused, completed, archived"
    ;;
  *) exit 0 ;;
esac

echo "Invalid status \"$status\" for waipoint $subcommand. Valid values: $valid" >&2
exit 2
