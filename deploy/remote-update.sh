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
git fetch origin master
if [[ $(git rev-parse origin/master) != "$commit" ]]; then
  echo 'Sudah ada commit master yang lebih baru; deployment lama dilewati.'
  exit 0
fi
# Adopt ONLY the two known, previously untracked Nginx files. Tracked edits and
# every other untracked path still stop deployment. Validate before moving any file.
dirty=$(git status --porcelain --untracked-files=all -- . ":(exclude).deploy")
legacy=()
while IFS= read -r entry; do
  case "$entry" in
    '') ;;
    '?? compose.nginx.yaml'|'?? deploy/nginx/default.conf')
      path=${entry:3}
      [[ -f $path && ! -L $path ]] || { echo "Konfigurasi Nginx bukan file biasa: $path" >&2; exit 1; }
      git cat-file -e "$commit:$path"
      legacy+=("$path")
      ;;
    *) echo "Working tree VPS berisi perubahan lokal; deployment dihentikan: $entry" >&2; exit 1 ;;
  esac
done <<< "$dirty"
if (( ${#legacy[@]} )); then
  backup=".deploy/nginx-before-tracking-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  for path in "${legacy[@]}"; do
    mkdir -p -- "$backup/$(dirname -- "$path")"
    mv -- "$path" "$backup/$path"
  done
  echo "Konfigurasi Nginx VPS lama dicadangkan: $backup"
fi
# This deployment checkout stays detached at the exact requested revision.
git switch --detach "$commit"
bash deploy/auto-deploy.sh "$commit" "$repository"
