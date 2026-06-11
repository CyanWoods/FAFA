#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK="$REPO_ROOT/.git/hooks/pre-commit"

cat > "$HOOK" << 'EOF'
#!/usr/bin/env bash
set -e
PYTHON="$(command -v python3 || command -v python)"
"$PYTHON" scripts/quality.py check
EOF

chmod +x "$HOOK"
echo "Pre-commit hook installed at $HOOK"
