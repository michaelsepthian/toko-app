#!/bin/sh
# Entry point PostgreSQL menjalankan script ini hanya saat volume masih kosong.
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=ON_ERROR_STOP=1 --set=app_password="$APP_DB_PASSWORD" <<'SQL'
CREATE ROLE toko_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
ALTER DATABASE :"DBNAME" OWNER TO toko_app;
GRANT USAGE, CREATE ON SCHEMA public TO toko_app;
SET ROLE toko_app;
\i /schema/schema.sql
\i /schema/tanggal_pendapatan.sql
SQL
