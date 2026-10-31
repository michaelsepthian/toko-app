#!/bin/sh
# Jalankan SQL pada database Compose lokal sebagai role pemilik tabel aplikasi.
# Tidak membuat akun, tidak mengimpor otomatis saat container mulai.
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compose_env=${COMPOSE_ENV_FILE:-"$project_root/.env.docker"}
sql_file=${1:-supabase/impor_db_final.sql}
case "$sql_file" in
    /*) ;;
    *) sql_file="$project_root/$sql_file" ;;
esac

if [ "$#" -gt 1 ] || [ ! -f "$sql_file" ]; then
    printf '%s\n' 'Pemakaian: ./deploy/migrate.sh [supabase/nama_migrasi.sql]' >&2
    exit 1
fi
if [ ! -f "$compose_env" ]; then
    printf '%s\n' 'File konfigurasi Docker tidak ditemukan. Siapkan .env.docker terlebih dahulu.' >&2
    exit 1
fi

docker compose --project-directory "$project_root" --env-file "$compose_env" \
    -f "$project_root/compose.yaml" exec -T postgres \
    sh -c 'exec psql -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SET ROLE toko_app" -f -' \
    < "$sql_file"

printf '%s\n' 'SQL berhasil dijalankan. Jika mengubah data produk, restart service api agar cache master dibaca ulang, lalu muat ulang data frontend.'
