"""在 VS Code 直接运行：返回 0 表示本安装目录的服务已运行，1 表示没有。"""

from pathlib import Path
from urllib.request import urlopen
import json
import os
import sys


ROOT = Path(__file__).resolve().parent


def main() -> int:
    state = json.loads((ROOT / "update_state.json").read_text(encoding="utf-8"))
    port = 8777 if state["edition"] == "full" else 8787
    marker = (ROOT / "__edition.txt").read_text(encoding="utf-8").strip()
    base = f"http://127.0.0.1:{port}"
    try:
        with urlopen(base + "/__edition.txt", timeout=1) as response:
            if response.read(128).decode("utf-8").strip() != marker:
                return 1
        with urlopen(base + "/__install_root", timeout=1) as response:
            remote = response.read(4096).decode("utf-8").strip()
        return 0 if os.path.normcase(os.path.realpath(remote)) == os.path.normcase(os.path.realpath(ROOT)) else 1
    except (OSError, UnicodeError, ValueError):
        return 1


if __name__ == "__main__":
    sys.exit(main())
