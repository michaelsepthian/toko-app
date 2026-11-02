#!/usr/bin/env python3
"""Apply explicitly listed migrations once, atomically with their checksum ledger."""
import argparse
import csv
import hashlib
import io
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent


def load_migrations(root):
    directory = root / "database/migrations"
    migrations = []
    for line in (directory / "manifest.txt").read_text().splitlines():
        name = line.strip()
        if not name or name.startswith("#"):
            continue
        if not re.fullmatch(r"[0-9]{8}_[a-z0-9_]+\.sql", name):
            raise ValueError(f"Nama migrasi tidak valid: {name}")
        if any(item[0] == name for item in migrations):
            raise ValueError(f"Migrasi duplikat: {name}")
        raw = (directory / name).read_bytes()
        sql = raw.decode("utf-8").strip()
        # Existing migrations have an outer BEGIN/COMMIT. Remove ONLY that wrapper;
        # the runner supplies a single transaction for SQL plus ledger entries.
        active = [i for i, text in enumerate(sql.splitlines()) if text.strip() and not text.lstrip().startswith("--")]
        lines = sql.splitlines()
        if active and re.fullmatch(r"BEGIN;", lines[active[0]].strip(), re.I):
            if not re.fullmatch(r"COMMIT;", lines[active[-1]].strip(), re.I):
                raise ValueError(f"BEGIN/COMMIT tidak lengkap: {name}")
            lines[active[0]] = lines[active[-1]] = ""
        body = "\n".join(lines)
        # No psql commands, extra transaction control, or nontransactional DDL.
        # BEGIN inside PL/pgSQL has no semicolon and is allowed.
        if re.search(r"(?im)^\s*(?:\\|(?:BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;|(?:VACUUM|CREATE\s+DATABASE|CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY)\b)", body):
            raise ValueError(f"Migrasi wajib SQL transaksional tanpa perintah psql: {name}")
        migrations.append((name, hashlib.sha256(raw).hexdigest(), body))
    return migrations


def pending_migrations(migrations, applied):
    known = {name: checksum for name, checksum, _ in migrations}
    for name, checksum in applied.items():
        if name not in known or known[name] != checksum:
            raise ValueError(f"Migrasi yang sudah diterapkan diubah/dihapus: {name}")
    return [item for item in migrations if item[0] not in applied]


def migration_sql(migrations):
    sql = ["BEGIN;", "SELECT pg_advisory_xact_lock(726519032);", """
CREATE TABLE IF NOT EXISTS public.schema_migrations (
 name text PRIMARY KEY,
 checksum text NOT NULL,
 applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.schema_migrations FROM PUBLIC;
"""]
    # Validate again under the DB lock: another deployment may have just applied it.
    for name, checksum, body in migrations:
        sql.extend([
            f"SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='{name}') AS applied,",
            f"NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE name='{name}' AND checksum <> '{checksum}') AS valid \\gset migration_",
            "\\if :migration_valid", "\\else",
            f"DO $$ BEGIN RAISE EXCEPTION 'Checksum migrasi berubah: {name}'; END $$;",
            "\\endif", "\\if :migration_applied",
            f"\\echo Sudah diterapkan: {name}", "\\else", body,
            f"INSERT INTO public.schema_migrations(name,checksum) VALUES ('{name}','{checksum}');",
            "\\endif",
        ])
    sql.append("COMMIT;")
    return "\n".join(sql) + "\n"


def compose(root):
    env = os.environ.get("COMPOSE_ENV_FILE", str(root / ".env.docker"))
    return ["docker", "compose", "--project-directory", str(root), "--env-file", env,
            "-f", str(root / "compose.yaml")]


def psql(root, sql):
    command = compose(root) + ["exec", "-T", "postgres", "sh", "-c",
        'exec psql -X -q --csv -U postgres -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "SET ROLE toko_app" -f -']
    return subprocess.run(command, input=sql, text=True, capture_output=True, check=True).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true", help="Lihat migrasi pending tanpa perubahan")
    args = parser.parse_args()
    migrations = load_migrations(ROOT)
    exists = psql(ROOT, "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists;")
    applied = {}
    if list(csv.DictReader(io.StringIO(exists)))[0]["exists"] == "t":
        rows = psql(ROOT, "SELECT name,checksum FROM public.schema_migrations ORDER BY applied_at,name;")
        applied = {row["name"]: row["checksum"] for row in csv.DictReader(io.StringIO(rows))}
    pending = pending_migrations(migrations, applied)
    print("Migrasi pending: " + (", ".join(row[0] for row in pending) or "tidak ada"), flush=True)
    if args.plan or not pending:
        return
    backups = ROOT / ".deploy/backups"
    backups.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backups / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".dump")
    command = compose(ROOT) + ["exec", "-T", "postgres", "sh", "-c",
        'exec pg_dump -U postgres -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges']
    with backup.open("xb") as output:
        os.chmod(backup, 0o600)
        subprocess.run(command, stdout=output, check=True)
    print(f"Backup sebelum migrasi: {backup}", flush=True)
    print(psql(ROOT, migration_sql(migrations)), end="")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        print(error.stderr or str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
