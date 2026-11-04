"""在 VS Code 或启动器中直接运行；无需命令行参数。

更新通道只包含同一 edition 的增量包。完整 ZIP 是首次安装包；更新器不会替换
自身、启动脚本或 Python 运行时。这些引导文件升级时须重新分发完整安装包。
"""

from __future__ import annotations

from hashlib import sha256
from pathlib import Path, PurePosixPath
from urllib.request import Request, urlopen
from zipfile import ZipFile
import json
import os
import shutil
import socket
import sys
import time


ROOT = Path(__file__).resolve().parent
STATE = ROOT / "update_state.json"
WORK = ROOT / ".update-work"
CHANNEL_URL = os.environ.get(
    "DF_UPDATE_INDEX_URL",
    "https://raw.githubusercontent.com/Minecraforever/delta-force-tactical-map/main/updates/stable.json",
)
MAX_INDEX = 2 << 20
MAX_ASSET = 2 << 30
MAX_FRONTEND_FILE = 16 << 20
CHUNK = 4 << 20


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_json(path: Path, data: dict) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def frontend_path(name: str) -> bool:
    if name in {"README.md", "serve.py", "serve_mac.py"}:
        return True
    parts = PurePosixPath(name).parts
    if len(parts) < 2 or parts[0] != "web":
        return False
    suffix = PurePosixPath(name).suffix.lower()
    if len(parts) == 2:
        return suffix in {".html", ".js", ".css"}
    if parts[1] == "vendor":
        return suffix == ".js"
    if parts[1] == "data" and parts[2] not in {"tdm", "vehicle_models"}:
        return suffix in {".json", ".png", ".jpg", ".webp", ".svg"}
    return False


def safe_path(name: str) -> Path:
    item = PurePosixPath(name)
    if (not name or "\\" in name or ":" in name or item.is_absolute()
            or any(part in ("", ".", "..") for part in name.split("/"))):
        raise ValueError(f"不安全的更新路径：{name!r}")
    if not frontend_path(name):
        raise ValueError(f"更新路径不在应用范围内：{name}")
    path = ROOT.joinpath(*item.parts)
    for parent in (path, *path.parents):
        if parent == ROOT.parent:
            break
        if parent.is_symlink():
            raise ValueError(f"更新路径包含符号链接：{name}")
    return path


def digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(CHUNK), b""):
            value.update(block)
    return value.hexdigest()


def download(url: str, target: Path, size: int, expected_hash: str) -> None:
    if not url.startswith(("https://", "http://127.0.0.1:", "http://localhost:")):
        raise ValueError("更新链接必须使用 HTTPS")
    if not 0 <= size < MAX_ASSET or len(expected_hash) != 64:
        raise ValueError("更新包尺寸或哈希无效")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file() and target.stat().st_size == size and digest(target) == expected_hash:
        return
    part = target.with_name(target.name + ".part")
    for attempt in range(3):
        position = part.stat().st_size if part.exists() else 0
        if position > size:
            part.unlink()
            position = 0
        headers = {"User-Agent": "DF-Tactical-Updater/1"}
        if position:
            headers["Range"] = f"bytes={position}-"
        try:
            with urlopen(Request(url, headers=headers), timeout=30) as response:
                append = position and response.status == 206
                with part.open("ab" if append else "wb") as output:
                    while True:
                        block = response.read(CHUNK)
                        if not block:
                            break
                        output.write(block)
                        if output.tell() > size:
                            raise ValueError("更新包超过索引声明的大小")
            if part.stat().st_size == size and digest(part) == expected_hash:
                os.replace(part, target)
                return
        except (OSError, TimeoutError) as error:
            print(f"下载中断（{attempt + 1}/3）：{error}", flush=True)
        time.sleep(attempt + 1)
    raise ValueError(f"更新包下载或 SHA-256 校验失败：{target.name}")


def index_document() -> dict:
    with urlopen(Request(CHANNEL_URL, headers={"User-Agent": "DF-Tactical-Updater/1"}), timeout=8) as response:
        data = response.read(MAX_INDEX + 1)
    if len(data) > MAX_INDEX:
        raise ValueError("更新索引过大")
    document = json.loads(data.decode("utf-8"))
    if document.get("schema") != 1 or not isinstance(document.get("editions"), dict):
        raise ValueError("更新索引结构错误")
    return document


def active_server(marker: str, ports: list[int]) -> bool:
    for port in ports:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.15):
                pass
            url = f"http://127.0.0.1:{port}/__edition.txt"
            with urlopen(url, timeout=0.4) as response:
                if response.read(128).decode("utf-8").strip() != marker:
                    continue
            with urlopen(f"http://127.0.0.1:{port}/__install_root", timeout=0.4) as response:
                remote_root = response.read(4096).decode("utf-8").strip()
            if os.path.normcase(os.path.realpath(remote_root)) == os.path.normcase(os.path.realpath(ROOT)):
                return True
        except (OSError, UnicodeError):
            pass
    return False


def rollback(journal: dict) -> None:
    backup = WORK / "backup"
    for name, had_old in reversed(journal["targets"]):
        path = safe_path(name)
        saved = backup / name
        if saved.is_file():
            path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(saved, path)
        elif not had_old and path.exists():
            path.unlink()
    atomic_json(STATE, {"edition": journal["edition"], "version": journal["from"]})
    (WORK / "journal.json").unlink(missing_ok=True)
    shutil.rmtree(backup, ignore_errors=True)


def recover() -> None:
    journal_path = WORK / "journal.json"
    if journal_path.exists():
        print("发现上次中断的更新，正在恢复旧版本…", flush=True)
        rollback(read_json(journal_path))


def stage_asset(asset: dict, edition: str, source: str, target: str, stage: Path) -> list[str]:
    filename = asset["name"]
    if filename != Path(filename).name or not filename.endswith(".zip"):
        raise ValueError("更新附件名称无效")
    package = WORK / "downloads" / filename
    download(asset["url"], package, asset["size"], asset["sha256"])
    with ZipFile(package) as archive:
        members = archive.namelist()
        if len(members) != len(set(members)) or "manifest.json" not in members:
            raise ValueError("更新附件清单重复或缺失")
        manifest = json.loads(archive.read("manifest.json"))
        if (manifest.get("schema") != 1 or manifest.get("edition") != edition
                or manifest.get("from") != source or manifest.get("to") != target):
            raise ValueError("更新附件与当前版本或分支不匹配")
        files = manifest.get("files")
        if not isinstance(files, list) or not files:
            raise ValueError("更新附件没有文件")
        expected = {"manifest.json"}
        staged = []
        for item in files:
            name = item["path"]
            safe_path(name)
            member = "payload/" + name
            if member in expected:
                raise ValueError("更新附件路径重复")
            expected.add(member)
            info = archive.getinfo(member)
            if (info.is_dir() or (info.external_attr >> 16) & 0o170000 == 0o120000
                    or info.file_size != item["size"] or info.file_size > MAX_FRONTEND_FILE):
                raise ValueError(f"更新附件文件属性错误：{name}")
            destination = stage / name
            if destination.exists():
                raise ValueError(f"跨附件重复路径：{name}")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as input_file, destination.open("wb") as output:
                shutil.copyfileobj(input_file, output, CHUNK)
            if digest(destination) != item["sha256"]:
                raise ValueError(f"更新文件哈希不符：{name}")
            staged.append(name)
        if set(members) != expected:
            raise ValueError("更新附件包含清单外文件")
        return staged


def install_patch(patch: dict, edition: str, current: str) -> str:
    target = patch["to"]
    if patch.get("from") != current or not isinstance(patch.get("assets"), list):
        raise ValueError("更新链不连续")
    stage = WORK / "stage"
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    names = []
    for asset in patch["assets"]:
        names.extend(stage_asset(asset, edition, current, target, stage))
    deletes = patch.get("delete", [])
    if not isinstance(deletes, list):
        raise ValueError("删除清单错误")
    for name in deletes:
        safe_path(name)
    if len(set(names + deletes)) != len(names + deletes):
        raise ValueError("更新目标重复")
    targets = [(name, safe_path(name).exists()) for name in names + deletes]
    backup = WORK / "backup"
    shutil.rmtree(backup, ignore_errors=True)
    backup.mkdir(parents=True)
    journal = {"edition": edition, "from": current, "to": target, "targets": targets}
    atomic_json(WORK / "journal.json", journal)
    try:
        for name, had_old in targets:
            if had_old:
                saved = backup / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                os.replace(safe_path(name), saved)
        for name in names:
            destination = safe_path(name)
            destination.parent.mkdir(parents=True, exist_ok=True)
            os.replace(stage / name, destination)
        atomic_json(STATE, {"edition": edition, "version": target})
        (WORK / "journal.json").unlink()
        shutil.rmtree(backup)
        shutil.rmtree(stage)
    except BaseException:
        rollback(journal)
        raise
    return target


def main() -> int:
    recover()
    state = read_json(STATE)
    edition, current = state["edition"], state["version"]
    if edition not in ("full", "szu"):
        raise ValueError("未知安装分支")
    marker = (ROOT / "__edition.txt").read_text(encoding="utf-8").strip()
    ports = list(range(8777, 8791)) if edition == "full" else list(range(8787, 8798))
    if active_server(marker, ports):
        print("本版服务正在运行，本次跳过更新。", flush=True)
        return 0
    if os.environ.get("DF_SKIP_UPDATE") == "1":
        print("已跳过在线更新检查。", flush=True)
        return 0
    try:
        channel = index_document()["editions"][edition]
        latest = channel["latest"]
        patches = channel["patches"]
        if current == latest:
            print(f"{edition} 已是最新版本 {current}", flush=True)
            return 0
        visited = set()
        while current != latest:
            if current in visited:
                raise ValueError("更新链存在循环")
            visited.add(current)
            patch = next((item for item in patches if item.get("from") == current), None)
            if patch is None:
                raise ValueError(f"没有从 {current} 到 {latest} 的更新路径，请获取完整安装包")
            print(f"正在更新 {edition}：{current} → {patch['to']}", flush=True)
            current = install_patch(patch, edition, current)
        print(f"更新完成：{current}", flush=True)
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f"更新未完成，继续使用已安装版本：{error}", flush=True)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
