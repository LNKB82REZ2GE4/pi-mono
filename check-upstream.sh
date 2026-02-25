#!/usr/bin/env bash
set -euo pipefail

# Check for upstream updates
# Run this periodically to see if there are new commits in the original repo

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Fetching upstream..."
git fetch upstream 2>/dev/null

LOCAL=$(git rev-parse HEAD)
UPSTREAM=$(git rev-parse upstream/main)
BEHIND=$(git rev-list --count HEAD..upstream/main)
AHEAD=$(git rev-list --count upstream/main..HEAD)

echo ""
if [ "$BEHIND" -eq 0 ] && [ "$AHEAD" -eq 0 ]; then
    echo "✓ Your fork is up to date with upstream"
elif [ "$BEHIND" -gt 0 ] && [ "$AHEAD" -eq 0 ]; then
    echo "⬇️  Your fork is $BEHIND commit(s) behind upstream"
    echo ""
    echo "New commits:"
    git log --oneline HEAD..upstream/main
    echo ""
    echo "To merge: git merge upstream/main"
elif [ "$AHEAD" -gt 0 ] && [ "$BEHIND" -eq 0 ]; then
    echo "⬆️  Your fork is $AHEAD commit(s) ahead of upstream (unpushed changes)"
elif [ "$BEHIND" -gt 0 ] && [ "$AHEAD" -gt 0 ]; then
    echo "↔️  Your fork has diverged:"
    echo "    - $BEHIND commit(s) behind upstream"
    echo "    - $AHEAD commit(s) ahead of upstream"
    echo ""
    echo "New upstream commits:"
    git log --oneline HEAD..upstream/main
    echo ""
    echo "To merge: git merge upstream/main (may have conflicts)"
fi
