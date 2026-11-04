#!/bin/bash
cd "$(dirname "$0")" || exit 1
ROOT="$PWD"
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) UV_ARCHIVE="uv-aarch64-apple-darwin.tar.gz"; UV_SHA="60fbd5c8a1ed681845eea28d9d622fcde03c51e91a43465b64a1e17db1ed3472" ;;
  x86_64) UV_ARCHIVE="uv-x86_64-apple-darwin.tar.gz"; UV_SHA="63ba17fdda55ad1a230d4b37fc6017ffa10c23688c83818bd3bfdf914c652a02" ;;
  *) echo "不支持的 Mac 架构：$ARCH"; read -r -p "按回车键退出…" _; exit 1 ;;
esac
ENV_DIR="$ROOT/.runtime-macos"
PY="$ENV_DIR/venv/bin/python"
if ! "$PY" -c 'import ssl, zipfile; assert __import__("sys").version_info >= (3, 12)' >/dev/null 2>&1; then
  echo "正在创建本项目独立的 macOS Python 环境…"
  ARCHIVE="$ROOT/macos-bootstrap/$UV_ARCHIVE"
  if [ ! -f "$ARCHIVE" ] || [ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" != "$UV_SHA" ]; then
    echo "Mac 环境引导包缺失或校验失败：$ARCHIVE"
    read -r -p "按回车键退出…" _
    exit 1
  fi
  mkdir -p "$ENV_DIR/bootstrap" "$ENV_DIR/cache" "$ENV_DIR/python"
  if ! tar -xzf "$ARCHIVE" -C "$ENV_DIR/bootstrap" --strip-components=1 "${UV_ARCHIVE%.tar.gz}/uv"; then
    echo "Mac 环境引导包解压失败。"
    read -r -p "按回车键退出…" _
    exit 1
  fi
  export UV_CACHE_DIR="$ENV_DIR/cache"
  export UV_PYTHON_INSTALL_DIR="$ENV_DIR/python"
  if ! "$ENV_DIR/bootstrap/uv" venv "$ENV_DIR/venv" --python 3.12; then
    echo "Mac Python 环境创建失败，请检查网络。"
    read -r -p "按回车键退出…" _
    exit 1
  fi
fi
"$PY" update_client.py
if [ "$?" -ne 0 ]; then echo "更新检查未完成，继续启动已安装版本。"; fi
EXISTING_URL="$("$PY" - <<'PY'
from pathlib import Path
from urllib.request import urlopen
import json
import os
import socket
state = json.loads(Path('update_state.json').read_text(encoding='utf-8'))
marker = Path('__edition.txt').read_text(encoding='utf-8').strip()
ports = range(8777, 8791) if state['edition'] == 'full' else range(8787, 8798)
for port in ports:
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=.15):
            pass
        with urlopen(f'http://127.0.0.1:{port}/__edition.txt', timeout=.3) as response:
            if response.read(128).decode().strip() == marker:
                with urlopen(f'http://127.0.0.1:{port}/__install_root', timeout=.3) as root_response:
                    remote = root_response.read(4096).decode().strip()
                if os.path.realpath(remote) == os.path.realpath('.'):
                    print(f'http://127.0.0.1:{port}/web/map.html')
                    break
    except OSError:
        pass
PY
)"
if [ -n "$EXISTING_URL" ]; then
  echo "本版服务已运行：$EXISTING_URL"
  if [ "$DF_NO_BROWSER" != "1" ]; then open "$EXISTING_URL"; fi
  exit 0
fi
"$PY" serve_mac.py
status=$?
if [ "$status" -ne 0 ]; then read -r -p "启动失败。按回车键退出…" _; fi
exit "$status"
