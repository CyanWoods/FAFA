#!/usr/bin/env bash
set -euo pipefail

# Usage: ./buildx.sh [platforms] [--no-cache]
# Example: ./buildx.sh
# Example: ./buildx.sh linux/amd64
# Example: ./buildx.sh linux/amd64,linux/arm64 --no-cache
#
# Tags: cyanwoods/fafa:YYYY-MM-DD and cyanwoods/fafa:latest

PLATFORMS="${1:-linux/amd64,linux/arm64}"
NO_CACHE_FLAG="${2:-}"
BUILDER="fafa-buildx"
REPO="cyanwoods/fafa"

if [[ -n "$NO_CACHE_FLAG" && "$NO_CACHE_FLAG" != "--no-cache" ]]; then
    echo "Error: unexpected argument '$NO_CACHE_FLAG' (expected --no-cache)" >&2
    exit 1
fi

NO_CACHE=""
if [[ "$NO_CACHE_FLAG" == "--no-cache" ]]; then
    NO_CACHE="--no-cache"
    echo "Cache disabled"
fi

VERSION="$(date +%Y-%m-%d)"
echo "Version: $VERSION"
echo "Platforms: $PLATFORMS"

# Ensure a dedicated buildx builder exists (docker-container driver supports multi-platform)
if ! docker buildx inspect "$BUILDER" &>/dev/null; then
    echo "Creating buildx builder: $BUILDER"
    docker buildx create --name "$BUILDER" --driver docker-container --bootstrap
fi
docker buildx use "$BUILDER"

echo "==> Building and pushing -> $REPO:$VERSION / $REPO:latest"
docker buildx build \
    --platform "$PLATFORMS" \
    --tag "$REPO:$VERSION" \
    --tag "$REPO:latest" \
    --push \
    ${NO_CACHE:+--no-cache} \
    .

echo "==> Done: $REPO:$VERSION, $REPO:latest"

# Prune builder cache to free disk space
docker buildx prune -f --builder "$BUILDER"
