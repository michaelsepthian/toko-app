import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "migrate-pending.py"
spec = importlib.util.spec_from_file_location("migrations", SCRIPT)
migrations = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migrations)


class MigrationTests(unittest.TestCase):
    def fixture(self, content="BEGIN;\nSELECT 1;\nCOMMIT;", manifest="20261102_example.sql\n"):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        directory = root / "database/migrations"
        directory.mkdir(parents=True)
        (directory / "manifest.txt").write_text(manifest)
        (directory / "20261102_example.sql").write_text(content)
        return root

    def test_actual_manifest_and_sql_wrappers(self):
        rows = migrations.load_migrations(SCRIPT.parents[1])
        self.assertGreaterEqual(len(rows), 2)
        sql = migrations.migration_sql(rows)
        self.assertEqual(sql.splitlines().count("BEGIN;"), 1)
        self.assertEqual(sql.splitlines().count("COMMIT;"), 1)
        self.assertIn("pg_advisory_xact_lock", sql)
        self.assertIn("schema_migrations(name,checksum)", sql)

    def test_first_run_and_retry(self):
        rows = migrations.load_migrations(self.fixture())
        self.assertEqual(migrations.pending_migrations(rows, {}), rows)
        self.assertEqual(migrations.pending_migrations(rows, {rows[0][0]: rows[0][1]}), [])

    def test_modified_or_removed_applied_migration_fails(self):
        rows = migrations.load_migrations(self.fixture())
        for applied in [{rows[0][0]: "wrong"}, {"20260101_missing.sql": "hash"}]:
            with self.assertRaises(ValueError):
                migrations.pending_migrations(rows, applied)

    def test_manifest_rejects_traversal_and_duplicates(self):
        for manifest in ["../private.sql", "20261102_example.sql\n20261102_example.sql"]:
            with self.assertRaises(ValueError):
                migrations.load_migrations(self.fixture(manifest=manifest))

    def test_unwrapped_plpgsql_supported(self):
        rows = migrations.load_migrations(self.fixture("DO $$\nBEGIN\n PERFORM 1;\nEND;\n$$;"))
        self.assertIn("END;", rows[0][2])

    def test_rejects_incomplete_wrapper_and_psql_commands(self):
        for sql in ["BEGIN;\nSELECT 1;", "\\i /tmp/untracked.sql", "VACUUM public.produk;"]:
            with self.assertRaises(ValueError):
                migrations.load_migrations(self.fixture(sql))


if __name__ == "__main__":
    unittest.main()
