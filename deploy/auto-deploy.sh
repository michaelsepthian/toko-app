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
compose() { docker compose --env-file .env.docker -f compose.yaml -f compose.nginx.yaml "$@"; }
mkdir -p .deploy
compose config --quiet
# Pull first: a missing image must fail before changing the database.
compose pull api frontend
compose up -d --no-build --wait --wait-timeout 180 postgres
python3 deploy/migrate-pending.py
# Compose recreates only services whose image/configuration changed.
compose up -d --no-build --wait --wait-timeout 180
# Git can replace a bind-mounted file's inode. Recreate Nginx when its tracked
# configuration changes, including the first adoption of a VPS-local config.
nginx_tree=$(git rev-parse HEAD:deploy/nginx)
previous_nginx_tree=$(cat .deploy/nginx-tree 2>/dev/null || true)
if [[ $nginx_tree != "$previous_nginx_tree" ]]; then
  compose up -d --no-build --no-deps --force-recreate --wait --wait-timeout 180 nginx
fi
# Verify the actual frontend/API routes through the proxy before marking success.
python3 - <<'PY'
import time
import urllib.request

for path in ("/", "/api/v1/setup"):
    for attempt in range(12):
        try:
            with urllib.request.urlopen("http://127.0.0.1:18000" + path, timeout=5) as response:
                if response.status != 200:
                    raise RuntimeError(f"Proxy {path}: HTTP {response.status}")
            break
        except (OSError, RuntimeError):
            if attempt == 11:
                raise
            time.sleep(2)
PY
printf '%s\n' "$nginx_tree" > .deploy/nginx-tree
printf '%s\n' "$commit" > .deploy/last-successful-commit
printf 'API_IMAGE=%s\nFRONTEND_IMAGE=%s\n' "$API_IMAGE" "$FRONTEND_IMAGE" > .deploy/images.env
printf 'Deployment berhasil: %s\n' "$commit"
