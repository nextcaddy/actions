#!/usr/bin/env bash
set -euo pipefail

# Usage: ./publish v1.1.0 [target-ref]
# Env:   REMOTE=origin (default)
REMOTE="${REMOTE:-origin}"

usage() {
  echo "Usage: $0 vX.Y.Z [commit|branch]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
VERSION_TAG="$1"
TARGET_REF="${2:-HEAD}"

# Validación simple
if [[ ! "$VERSION_TAG" =~ ^v[0-9]+(\.[0-9]+){1,2}(-[A-Za-z0-9._-]+)?$ ]]; then
  echo "❌ Version tag must look like v1.2.3 (got: $VERSION_TAG)" >&2
  exit 2
fi

# MAJOR_TAG correcto (sin 'vv')
major="${VERSION_TAG#v}"          # "1.1.0"
major="${major%%.*}"              # "1"
MAJOR_TAG="v${major}"             # "v1"

echo "==> Remote: ${REMOTE}"
git rev-parse --is-inside-work-tree >/dev/null
git fetch --tags "${REMOTE}"

COMMIT_SHA="$(git rev-parse --verify "${TARGET_REF}")"
echo "==> Tagging commit: ${COMMIT_SHA}"

# Opcional: exigir working tree limpio
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Working tree not clean. Commit/stash changes first." >&2
  exit 1
fi

# (Re)crear tag de versión anotado en el COMMIT
if git rev-parse -q --verify "refs/tags/${VERSION_TAG}" >/dev/null; then
  echo "==> Updating existing ${VERSION_TAG} -> ${COMMIT_SHA}"
  git tag -fa "${VERSION_TAG}" -m "${VERSION_TAG}" "${COMMIT_SHA}"
else
  echo "==> Creating ${VERSION_TAG} at ${COMMIT_SHA}"
  git tag -a "${VERSION_TAG}" -m "${VERSION_TAG}" "${COMMIT_SHA}"
fi

echo "==> Pushing ${VERSION_TAG} (force) to ${REMOTE}"
git push "${REMOTE}" "refs/tags/${VERSION_TAG}" --force

# Mover el tag mayor al **commit** que referencia VERSION_TAG (evitar nested tag)
echo "==> Moving ${MAJOR_TAG} -> ${VERSION_TAG}"
git tag -fa "${MAJOR_TAG}" -m "${MAJOR_TAG} -> ${VERSION_TAG}" "${VERSION_TAG}^{commit}"

echo "==> Pushing ${MAJOR_TAG} (force) to ${REMOTE}"
git push "${REMOTE}" "refs/tags/${MAJOR_TAG}" --force

echo "✅ Done."
printf "   %-8s -> %s\n" "${VERSION_TAG}" "$(git rev-parse --short ${VERSION_TAG})"
printf "   %-8s -> %s\n" "${MAJOR_TAG}"   "$(git rev-parse --short ${MAJOR_TAG})"
