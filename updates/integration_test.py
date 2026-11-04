"""在 VS Code 直接运行：用本地 HTTP 服务测试双分支更新、损坏拒绝与中断恢复。"""

from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading


SOURCE = Path(__file__).resolve().parent / "update_client.py"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def sha(path):
    return sha256(path.read_bytes()).hexdigest()


def make_patch(root, edition, contents):
    path = root / f"{edition}.zip"
    files = [{"path": name, "size": len(data), "sha256": sha256(data).hexdigest()}
             for name, data in contents.items()]
    manifest = {"schema": 1, "edition": edition, "from": "0", "to": "1", "files": files}
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest))
        for name, data in contents.items():
            archive.writestr("payload/" + name, data)
    return path


def install_fixture(root, edition):
    folder = root / edition
    (folder / "web").mkdir(parents=True)
    shutil.copy2(SOURCE, folder / "update_client.py")
    (folder / "web/map.html").write_text("old", encoding="utf-8")
    (folder / "web/remove.json").write_text("obsolete", encoding="utf-8")
    (folder / "__edition.txt").write_text("test-" + edition, encoding="utf-8")
    write_json(folder / "update_state.json", {"edition": edition, "version": "0"})
    return folder


def run_client(folder, url, expected):
    env = os.environ.copy()
    env["DF_UPDATE_INDEX_URL"] = url
    result = subprocess.run([sys.executable, str(folder / "update_client.py")],
                            cwd=folder, env=env, capture_output=True, text=True, timeout=30)
    print(folder.name, result.returncode, result.stdout.strip().splitlines()[-1], flush=True)
    assert result.returncode == expected, result.stdout + result.stderr


def main():
    with tempfile.TemporaryDirectory(prefix="df-update-test-") as temporary:
        root = Path(temporary)
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            patches = {}
            for edition in ("full", "szu"):
                contents = {"web/map.html": ("new-" + edition).encode(),
                            "web/added.json": ("added-" + edition).encode()}
                archive = make_patch(root, edition, contents)
                patches[edition] = {"from": "0", "to": "1", "delete": ["web/remove.json"],
                                    "assets": [{"name": archive.name, "url": base + "/" + archive.name,
                                                "size": archive.stat().st_size, "sha256": sha(archive)}]}
            index = {"schema": 1, "editions": {edition: {"latest": "1", "patches": [patches[edition]]}
                                                for edition in patches}}
            write_json(root / "stable.json", index)
            for edition in ("full", "szu"):
                folder = install_fixture(root, edition)
                run_client(folder, base + "/stable.json", 0)
                assert json.loads((folder / "update_state.json").read_text())["version"] == "1"
                assert (folder / "web/map.html").read_text() == "new-" + edition
                assert (folder / "web/added.json").read_text() == "added-" + edition
                assert not (folder / "web/remove.json").exists()
            bad = install_fixture(root, "bad")
            write_json(bad / "update_state.json", {"edition": "full", "version": "0"})
            broken = json.loads((root / "stable.json").read_text())
            broken["editions"]["full"]["patches"][0]["assets"][0]["sha256"] = "0" * 64
            write_json(root / "broken.json", broken)
            run_client(bad, base + "/broken.json", 2)
            assert (bad / "web/map.html").read_text() == "old"
            assert json.loads((bad / "update_state.json").read_text())["version"] == "0"
            # 模拟崩溃时旧文件已被移入备份，下一次启动须先恢复。
            saved = bad / ".update-work/backup/web/map.html"
            saved.parent.mkdir(parents=True)
            os.replace(bad / "web/map.html", saved)
            write_json(bad / ".update-work/journal.json",
                       {"edition": "full", "from": "0", "to": "1", "targets": [["web/map.html", True]]})
            env = os.environ.copy()
            env["DF_SKIP_UPDATE"] = "1"
            result = subprocess.run([sys.executable, str(bad / "update_client.py")],
                                    cwd=bad, env=env, capture_output=True, text=True, timeout=30)
            assert result.returncode == 0 and (bad / "web/map.html").read_text() == "old"
            assert not (bad / ".update-work/journal.json").exists()
            cross = install_fixture(root, "cross")
            write_json(cross / "update_state.json", {"edition": "full", "version": "0"})
            wrong = json.loads((root / "stable.json").read_text())
            wrong["editions"]["full"]["patches"][0]["assets"] = patches["szu"]["assets"]
            write_json(root / "cross.json", wrong)
            run_client(cross, base + "/cross.json", 2)
            assert (cross / "web/map.html").read_text() == "old"
            traversal = install_fixture(root, "traversal")
            write_json(traversal / "update_state.json", {"edition": "full", "version": "0"})
            attack = make_patch(root, "full", {"web/../escape": b"bad"})
            hostile = json.loads((root / "stable.json").read_text())
            hostile["editions"]["full"]["patches"][0]["assets"] = [
                {"name": attack.name, "url": base + "/" + attack.name,
                 "size": attack.stat().st_size, "sha256": sha(attack)}]
            write_json(root / "traversal.json", hostile)
            run_client(traversal, base + "/traversal.json", 2)
            assert not (root / "escape").exists()
            assert (traversal / "web/map.html").read_text() == "old"
            print("PASS: two editions, hashes, corruption, cross-edition, path traversal, rollback")
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
