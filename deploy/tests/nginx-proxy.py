#!/usr/bin/env python3
"""Verify Nginx routing and service DNS after container replacement, in isolation."""
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
prefix = "toko-proxy-test-" + uuid.uuid4().hex[:10]
containers = []


def docker(*args):
    result = subprocess.run(["docker", *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f"Docker gagal ({result.returncode}): docker {' '.join(args)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def start(name, *args):
    identifier = prefix + "-" + name
    # docker run can create a container before failing to start it. Include the
    # name in cleanup even on failure so CI does not leave partial test resources.
    containers.append(identifier)
    docker("run", "-d", "--name", identifier, *args)
    return identifier


def expect(url, value):
    for attempt in range(25):
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                actual = response.read().decode()
            if actual == value:
                return
        except OSError:
            pass
        time.sleep(1)
    raise AssertionError(f"Route did not return {value}: {url}")


try:
    docker("network", "create", prefix)
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)

        def upstream(name, alias, port, version):
            conf = root / (name + ".conf")
            conf.write_text(f"server {{ listen {port}; location / {{ return 200 '{version}:$request_uri'; }} }}\n")
            return start(name, "--network", prefix, "--network-alias", alias,
                         "-v", f"{conf}:/etc/nginx/conf.d/default.conf:ro", "nginx:stable")

        api = upstream("api1", "api", 8080, "api-v1")
        frontend = upstream("frontend1", "frontend", 3000, "frontend-v1")
        proxy = start("proxy", "--network", prefix, "-p", "127.0.0.1::80", "-v",
                      f"{ROOT / 'deploy/nginx/default.conf'}:/etc/nginx/conf.d/default.conf:ro", "nginx:stable")
        docker("exec", proxy, "nginx", "-t")
        address = docker("port", proxy, "80/tcp").splitlines()[0]
        base = "http://" + address
        expect(base + "/api/v1/setup?probe=1", "api-v1:/api/v1/setup?probe=1")
        expect(base + "/?probe=1", "frontend-v1:/?probe=1")
        for alias, old, port in (("api", api, 8080), ("frontend", frontend, 3000)):
            old_ip = docker("inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", old)
            # Keep the old address allocated until Docker assigns a different
            # dynamic IP to its replacement. No static IP/subnet support needed.
            new = upstream(alias + "2", alias, port, alias + "-v2")
            new_ip = docker("inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", new)
            assert new_ip != old_ip
            docker("rm", "-f", old)
            containers.remove(old)
            path = "/api/v1/setup?probe=1" if alias == "api" else "/?probe=1"
            expect(base + path, alias + "-v2:" + path)
        print("Nginx: routes, query strings, dan DNS setelah penggantian API/frontend lulus.")
finally:
    for name in reversed(containers):
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    subprocess.run(["docker", "network", "rm", prefix], capture_output=True)
