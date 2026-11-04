"""在 VS Code 运行：编辑下方常量，生成两个分支的增量包和待发布索引。

先上传所有 ZIP 至指定 GitHub Release 并核对下载，再将 stable.next.json
发布为仓库 updates/stable.json。发布顺序不能颠倒。
"""

from hashlib import sha256
from pathlib import Path
from pathlib import PurePosixPath
from zipfile import ZipFile, ZIP_DEFLATED
import json


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent if (HERE.parent / "发布版_2026-11-05_自动更新").is_dir() else HERE.parent.parent
PREVIOUS = ROOT / "发布版_2026-11-05_自动更新"
CURRENT = ROOT / "发布版_下一版"  # 改成已验收的新发布目录
FROM_VERSION = "2026.11.05.1"
TO_VERSION = "2026.11.06.1"  # 改成新版本
RELEASE_TAG = "v2026.11.06.1"  # 先创建草稿 Release，上传附件后再公布索引
OUTPUT = ROOT / "更新附件_下一版"
INDEX = ROOT / ".cloud_repo/updates/stable.json"
MAX_RAW_PER_ASSET = 1200 << 20
MAX_FRONTEND_FILE = 16 << 20
EDITIONS = {"full": "三维战术板", "szu": "指挥官三维战术板·深大校队专用版"}


def digest(path: Path) -> str:
    value = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 << 20), b""):
            value.update(block)
    return value.hexdigest()


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


def application_files(folder: Path) -> dict[str, Path]:
    files = {}
    for path in folder.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        name = path.relative_to(folder).as_posix()
        if any(part.startswith(".") for part in Path(name).parts):
            continue
        if frontend_path(name):
            if path.stat().st_size > MAX_FRONTEND_FILE:
                raise ValueError(f"前端单文件超过 16 MiB，请改用完整安装包：{name}")
            files[name] = path
    return files


def make_assets(edition: str, changed: list[tuple[str, Path]]) -> list[dict]:
    groups = []
    current = []
    total = 0
    for name, path in changed:
        size = path.stat().st_size
        if size > MAX_RAW_PER_ASSET:
            raise ValueError(f"单文件超过更新附件预算：{name}")
        if current and total + size > MAX_RAW_PER_ASSET:
            groups.append(current)
            current, total = [], 0
        current.append((name, path))
        total += size
    if current:
        groups.append(current)
    assets = []
    for number, group in enumerate(groups, 1):
        filename = f"df-{edition}-{TO_VERSION}-part{number:02d}.zip"
        archive_path = OUTPUT / filename
        manifest = {"schema": 1, "edition": edition, "from": FROM_VERSION,
                    "to": TO_VERSION, "files": [
                        {"path": name, "size": path.stat().st_size, "sha256": digest(path)}
                        for name, path in group]}
        with ZipFile(archive_path, "w", compression=ZIP_DEFLATED, compresslevel=3, allowZip64=True) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, separators=(",", ":")))
            for name, path in group:
                archive.write(path, "payload/" + name)
        if archive_path.stat().st_size >= 2 << 30:
            raise ValueError(f"GitHub Release 附件超过 2 GiB：{filename}")
        with ZipFile(archive_path) as archive:
            if archive.testzip() is not None:
                raise ValueError(f"附件 CRC 错误：{filename}")
        assets.append({"name": filename,
                       "url": f"https://github.com/Minecraforever/delta-force-tactical-map/releases/download/{RELEASE_TAG}/{filename}",
                       "size": archive_path.stat().st_size, "sha256": digest(archive_path)})
    return assets


def main() -> None:
    if not CURRENT.is_dir():
        raise ValueError(f"先把 CURRENT 指向已验收的发布目录：{CURRENT}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    for edition, dirname in EDITIONS.items():
        old = application_files(PREVIOUS / dirname)
        new = application_files(CURRENT / dirname)
        changed = [(name, path) for name, path in sorted(new.items())
                   if name not in old or path.stat().st_size != old[name].stat().st_size
                   or digest(path) != digest(old[name])]
        deleted = sorted(old.keys() - new.keys())
        if not changed and not deleted:
            raise ValueError(f"{edition} 没有变化，不应增加版本号")
        if not changed:
            raise ValueError(f"{edition} 只有删除项：请附带新版 README 以生成可验证附件")
        assets = make_assets(edition, changed)
        channel = index["editions"][edition]
        if channel["latest"] != FROM_VERSION:
            raise ValueError(f"{edition} 当前通道不是预期的 {FROM_VERSION}")
        channel["patches"].append({"from": FROM_VERSION, "to": TO_VERSION,
                                   "assets": assets, "delete": deleted})
        channel["latest"] = TO_VERSION
        print(edition, "changed", len(changed), "deleted", len(deleted), "assets", len(assets))
    (OUTPUT / "stable.next.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("先上传全部 ZIP，最后发布 stable.next.json 的内容。")


if __name__ == "__main__":
    main()
