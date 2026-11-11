#!/usr/bin/env bash
# Isolated CI database. No published ports or production credentials.
set -euo pipefail
cd -- "$(dirname -- "$0")/../.."
container="toko-migration-test-${RANDOM}-$$"
temporary=$(mktemp -d)
cleanup() { docker compose -f "$temporary/compose.yaml" down -v >/dev/null 2>&1 || true; rm -rf -- "$temporary"; }
trap cleanup EXIT
cat > "$temporary/compose.yaml" <<YAML
name: $container
services:
  postgres:
    image: postgres:17-alpine
    container_name: $container
    environment:
      POSTGRES_PASSWORD: test-only
      POSTGRES_DB: toko_test
YAML
touch "$temporary/.env.docker"
docker compose -f "$temporary/compose.yaml" up -d >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d toko_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
[[ $ready == true ]] || { echo 'PostgreSQL test tidak siap' >&2; exit 1; }
psql() { docker exec -i "$container" psql -X -U postgres -d toko_test -v ON_ERROR_STOP=1 "$@"; }
# Match deploy/postgres/01-init.sh: database ownership allows trusted extensions.
psql -c 'CREATE ROLE toko_app; ALTER DATABASE toko_test OWNER TO toko_app; GRANT USAGE, CREATE ON SCHEMA public TO toko_app;' >/dev/null
psql -c 'SET ROLE toko_app' -f - < database/schema.sql >/dev/null
python3 - "$temporary" <<'PY'
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("migrations", "deploy/migrate-pending.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
rows = m.load_migrations(Path.cwd())
target = Path(sys.argv[1])
(target / "expected-count").write_text(str(len(rows)))
(target / "good.sql").write_text(m.migration_sql(rows))
(target / "bad.sql").write_text(m.migration_sql(rows + [
    ("20261103_failure.sql", "a" * 64, "CREATE TABLE public.should_rollback(id bigint); SELECT 1/0;")]))
(target / "changed.sql").write_text(m.migration_sql([
    (rows[0][0], "b" * 64, rows[0][2])]))
PY
psql -c 'SET ROLE toko_app' -f - < "$temporary/good.sql" >/dev/null
psql -c 'SET ROLE toko_app' -f - < "$temporary/good.sql" >/dev/null
[[ $(psql -Atc 'SELECT count(*) FROM public.schema_migrations') == "$(cat "$temporary/expected-count")" ]]
if psql -c 'SET ROLE toko_app' -f - < "$temporary/bad.sql"; then echo 'Migrasi gagal diterima!' >&2; exit 1; fi
[[ $(psql -Atc "SELECT to_regclass('public.should_rollback') IS NULL") == t ]]
[[ $(psql -Atc 'SELECT count(*) FROM public.schema_migrations') == "$(cat "$temporary/expected-count")" ]]
if psql -c 'SET ROLE toko_app' -f - < "$temporary/changed.sql"; then echo 'Checksum berubah diterima!' >&2; exit 1; fi
# Exercise the actual Compose/CSV/backup runner against this isolated project.
psql -c 'DROP TABLE public.schema_migrations;' >/dev/null
python3 - "$temporary" <<'PYRUNNER'
import importlib.util
from pathlib import Path
import shutil
import sys
spec = importlib.util.spec_from_file_location("migrations", "deploy/migrate-pending.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
root = Path(sys.argv[1])
shutil.copytree("database/migrations", root / "database/migrations")
m.ROOT = root
sys.argv = ["migrate-pending.py"]
m.main()
m.main()  # no second backup when no migrations remain
assert len(list((root / ".deploy/backups").glob("*.dump"))) == 1
sys.argv = ["migrate-pending.py", "--plan"]
m.main()
PYRUNNER
echo 'PostgreSQL: repeat, rollback, checksum, Compose runner, dan backup lulus.' 
