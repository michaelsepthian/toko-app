"""Exercise deployment checkout/adoption against disposable real Git repositories."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "remote-update.sh"


class RemoteUpdateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / "source"
        self.server = self.root / "server"
        self.env = os.environ.copy()
        self.env.update(GIT_AUTHOR_NAME="Test", GIT_AUTHOR_EMAIL="test@example.invalid",
                        GIT_COMMITTER_NAME="Test", GIT_COMMITTER_EMAIL="test@example.invalid")
        if not shutil.which("flock"):
            # macOS lacks flock; these tests exercise Git/file handling, not locking.
            binary = self.root / "bin"
            binary.mkdir()
            lock = binary / "flock"
            lock.write_text("#!/bin/sh\nexit 0\n")
            lock.chmod(0o755)
            self.env["PATH"] = str(binary) + os.pathsep + self.env["PATH"]
        self.source.mkdir()
        self.git(self.source, "init", "-b", "master")
        (self.source / ".gitignore").write_text(".deploy/\n.env.docker\n")
        (self.source / "README").write_text("initial")
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "-m", "initial")
        self.git(self.root, "clone", "--bare", str(self.source), "origin.git")
        self.git(self.root, "clone", str(self.root / "origin.git"), "server")
        self.git(self.source, "remote", "add", "origin", str(self.root / "origin.git"))
        (self.source / "deploy/nginx").mkdir(parents=True)
        (self.source / "compose.nginx.yaml").write_text("tracked compose")
        (self.source / "deploy/nginx/default.conf").write_text("tracked nginx")
        (self.source / "deploy/auto-deploy.sh").write_text("#!/bin/bash\nprintf success > .deploy/invoked\n")
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "-m", "track nginx")
        self.commit = self.git(self.source, "rev-parse", "HEAD").strip()
        self.git(self.source, "push", "origin", "master")
        (self.server / "deploy/nginx").mkdir(parents=True)
        (self.server / "compose.nginx.yaml").write_text("legacy compose")
        (self.server / "deploy/nginx/default.conf").write_text("legacy nginx")
        (self.server / ".env.docker").write_text("preserve local settings")

    def git(self, cwd, *arguments):
        return subprocess.run(["git", *arguments], cwd=cwd, env=self.env,
                              check=True, capture_output=True, text=True).stdout

    def deploy(self):
        return subprocess.run(["bash", str(SCRIPT), str(self.server), self.commit, "owner/repo"],
                              env=self.env, capture_output=True, text=True)

    def test_adopts_known_files_and_preserves_env_and_backup(self):
        result = self.deploy()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        backups = list((self.server / ".deploy").glob("nginx-before-tracking-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual((backups[0] / "compose.nginx.yaml").read_text(), "legacy compose")
        self.assertEqual((backups[0] / "deploy/nginx/default.conf").read_text(), "legacy nginx")
        self.assertEqual((self.server / "compose.nginx.yaml").read_text(), "tracked compose")
        self.assertEqual((self.server / ".env.docker").read_text(), "preserve local settings")
        self.assertEqual((self.server / ".deploy/invoked").read_text(), "success")
        # Retry must work without adopting/backing up tracked files again.
        self.assertEqual(self.deploy().returncode, 0)
        self.assertEqual(len(list((self.server / ".deploy").glob("nginx-before-tracking-*"))), 1)

    def test_other_untracked_file_stops_before_moving_any_config(self):
        (self.server / "other.txt").write_text("keep")
        result = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.server / "compose.nginx.yaml").read_text(), "legacy compose")
        self.assertFalse((self.server / ".deploy/invoked").exists())

    def test_tracked_edits_still_stop_deployment(self):
        (self.server / "README").write_text("local edit")
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertEqual((self.server / "README").read_text(), "local edit")
        self.assertEqual((self.server / "deploy/nginx/default.conf").read_text(), "legacy nginx")

    def test_symlink_config_is_not_adopted(self):
        path = self.server / "compose.nginx.yaml"
        path.unlink()
        path.symlink_to(self.server / "README")
        self.assertNotEqual(self.deploy().returncode, 0)
        self.assertTrue(path.is_symlink())
