#!/usr/bin/env bash
# Sent over SSH; arguments never contain credentials.
set -euo pipefail
app_path=${1:?path project wajib diisi}
commit=${2:?commit wajib diisi}
repository=${3:?image repository wajib diisi}
[[ $app_path =~ ^/[a-zA-Z0-9_./-]+$ && $commit =~ ^[a-f0-9]{40}$ && $repository =~ ^[a-z0-9_.-]+/[a-z0-9_.-]+$ ]] || exit 1
cd -- "$app_path"
mkdir -p .deploy
exec 9>.deploy/deploy.lock
flock -w 1800 9
[[ -z $(git status --porcelain --untracked-files=normal -- . ":(exclude).deploy") ]] || { echo 'Working tree VPS berisi perubahan lokal; deployment dihentikan.' >&2; exit 1; }
git fetch origin master
if [[ $(git rev-parse origin/master) != "$commit" ]]; then
  echo 'Sudah ada commit master yang lebih baru; deployment lama dilewati.'
  exit 0
fi
# This deployment checkout stays detached at the exact requested revision.
git switch --detach "$commit"
bash deploy/auto-deploy.sh "$commit" "$repository"
