# Delta Force Tactical Map · 指挥官三维战术板

在线版：<https://minecraforever.github.io/delta-force-tactical-map/>

在线版仅保留低精度，无法实现中高精度；如需体验，请联系作者获取本地版。

本次从 2026-11-05 最新完整版同步网页功能、低精度地图、地形和事件数据。地图：攀升、烬区、临界点、贯穿、刀锋、堑壕战、断轨、风暴眼、断层、摩格旧城区、天际港。

为符合 GitHub Pages 站点大小限制，按既定顺序移除了克劳狄斗兽场、乌姆斯运河、余震和金字塔。较大的低精度 MFPK 按原有方式分块；新增或更新的大地图包采用 4 MiB 分块，页面按顺序拼接。

macOS 双击 `start-mac.command`；Windows 双击 `start-windows.cmd`。本地静态文件服务器只监听 127.0.0.1。

网页代码与启动脚本采用 MIT 许可证；游戏模型、贴图和地图数据不在此许可证范围内。

## 本地版自动更新

完整版与深大校队专用版的完整安装包见 [Releases](https://github.com/Minecraforever/delta-force-tactical-map/releases)。两个安装包包含同一套启动环境检查和自动更新器，使用 `updates/stable.json` 中相互隔离的 `full`、`szu` 更新通道。首次安装须完整解压；2026-11-05 之前的旧安装包没有更新器，需要先手动换用新版完整包。后续应用文件通过校验后的增量附件更新。Windows 会修复缺失的独立 Python 运行时；Mac 会自动建立独立 Python 环境。离线时继续运行已安装版本。

`updates/build_incremental_release.py` 是在 VS Code 运行的增量制作脚本。先上传并核对所有 Release 附件，最后更新 `updates/stable.json`；完整包、启动器与运行时升级仍需重新发布 ZIP。网页 Pages 版仍只提供低精度地图。
