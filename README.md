# Delta Force Tactical Map · 指挥官三维战术板

三角洲行动「全面战场」地图的三维预览与战术参考。页面、地图数据和 three.js 依赖均为静态文件，无需构建服务。

**在线版：<https://minecraforever.github.io/delta-force-tactical-map/>**

## 本地启动

| 平台 | 操作 |
| --- | --- |
| macOS | 双击 `start-mac.command` |
| Windows | 双击 `start-windows.cmd` |

启动器仅在本机 `127.0.0.1` 的 8777–8790 端口提供只读服务，并自动打开 `docs/index.html`。关闭启动窗口即停止服务。也可以用任意静态文件服务器提供仓库根目录，再访问 `/docs/index.html`。由于页面使用 ES 模块和 `fetch`，请勿直接用 `file://` 打开 HTML。

## 数据范围

在线版无法使用中高精度；如需体验，请联系作者获取本地版。在线版包含 12 张地图的低精度场景、地面图、据点与事件数据；完整本地版不属于本仓库。

为符合 GitHub 文件大小限制，5 个超过 50 MiB 的低精度 MFPK 被按原始字节拆为多个不超过 40 MiB 的 `.partNN` 文件，页面加载时按顺序拼接。`MFPK_SPLITS.json` 记录各分块与原包 SHA-256。地图数据来自三角洲行动 WeGame 客户端版本 `1.101.37117.36`。

## 目录

```text
docs/                 GitHub Pages 站点
  index.html          指挥官三维战术板
  map/                地图、低精度 MFPK、事件与贴图
  data/               阶段计划、弹道、固定武器数据
  vendor/             本地 three.js 依赖
start-mac.command     macOS 启动器
start-windows.cmd     Windows 启动器
start-windows.ps1     Windows 本地静态服务
MFPK_SPLITS.json      低精度包分块清单
```

## 版权

本项目与腾讯、TiMi Studio Group 和三角洲行动官方无关。网页代码及启动脚本采用 [MIT 许可证](LICENSE)；游戏模型、贴图、地图与数据不在此许可证范围内，权利归原权利人所有，仅供个人、非商业研究与参考。如权利人要求移除相关内容，请提交 Issue。

作者：Minecraforever · [Bilibili @Minecraforever](https://space.bilibili.com/670174785)
