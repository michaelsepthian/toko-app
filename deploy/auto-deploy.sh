#!/usr/bin/env bash
# Invoked by remote-update.sh while holding the deployment lock.
set -euo pipefail
cd -- "$(dirname -- "$0")/.."
commit=${1:?commit wajib diisi}
repository=${2:?nama image repository wajib diisi}
[[ $(git rev-parse HEAD) == "$commit" ]] || { echo 'Checkout tidak sesuai commit deployment' >&2; exit 1; }
[[ -f .env.docker ]] || { echo 'Siapkan .env.docker di VPS terlebih dahulu' >&2; exit 1; }
backend_tree=$(git rev-parse HEAD:backend)
frontend_tree=$(git rev-parse HEAD:frontend)
export API_IMAGE="ghcr.io/${repository}-api:tree-${backend_tree}-amd64"
export FRONTEND_IMAGE="ghcr.io/${repository}-frontend:tree-${frontend_tree}-amd64"
compose() { docker compose --env-file .env.docker -f compose.yaml -f compose.vps.yaml "$@"; }
compose config --quiet
# Pull first: a missing image must fail before changing the database.
compose pull api frontend
compose up -d --no-build --wait --wait-timeout 180 postgres
python3 deploy/migrate-pending.py
# Compose recreates only services whose image/configuration changed.
compose up -d --no-build --wait --wait-timeout 180
printf '%s\n' "$commit" > .deploy/last-successful-commit
printf 'API_IMAGE=%s\nFRONTEND_IMAGE=%s\n' "$API_IMAGE" "$FRONTEND_IMAGE" > .deploy/images.env
printf 'Deployment berhasil: %s\n' "$commit"
