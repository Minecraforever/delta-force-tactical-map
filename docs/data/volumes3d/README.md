# 三维体积 / 真高图层（独立数据层）

> 源版本：**1.101.37119.18**（正式服 2026-11-05 全量包）
> 生成：`_dev_tools/build_volumes3d.py`（无 argparse，VS Code 直接运行）
> 生成时间：2026-11-12T00:16:52+08:00
> **不改现有 `web/map/<Map>/manifest.json`，不改默认地图外观。**
> **已归档：Suez（赛季轮换，2026-11-09 移出活跃站点；见 `_backup/suez_archived_20261109/`）。**

## 1. 数据文件

- `index.json`：所有地图的索引、按图统计、缺口、坐标/单位说明。
- `<Map>.json`：每张图的独立三维图层，含 `features`（已验证/警告）和 `gaps`（缺口）。
- `schema.md`：字段/坐标/状态/验证语义。

## 2. 坐标与单位

- 源：UE5 左手坐标，厘米，X 前 / Y 右 / Z 上。
- 网页：`x = UE X / 100`，`y = UE Z / 100`，`z = UE Y / 100`（米，y 向上）。
- `manifest.json` 的 `points` 已经是 `[x,y,z]` 米，不是平面；本图层不重复发明这套坐标，而是把同一个 `WorldSplinePoint` 的完整几何（含 `Box3D`/`TriangleList`）独立导出。
- `WorldSplinePoint` 按世界坐标使用；已用 `SplineCurves.local + actor/component transform` 交叉验证，最大误差见第 5 节。

## 3. 按图统计

| 地图 | 名称 | 源关卡 | 状态 | 区域 已验证/警告/缺口 | 体积 可玩盒/禁区盒/对空/禁止重生 | 区域 Z 范围 (m) |
|---|---|---|---|---:|---:|---:|
| `Collapse` | 余震 | `Collapse_Breakthrough` | static_verified | 25 / 0 / 0 | 1 / 0 / 0 / 1 | 21.1731 … 43.9094 |
| `Colosseum` | 克劳狄斗兽场 | `Colosseum_BreakThrough` | static_verified | 22 / 0 / 0 | 0 / 0 / 0 / 0 | 10.1139 … 45.2452 |
| `Cracked` | 烬区 | `Cracked_Breakthrough` | static_verified | 14 / 0 / 0 | 2 / 0 / 0 / 0 | -15.614 … 3.1972 |
| `Crest` | 刀锋 | `Crest_Breakthrough` | partial | 9 / 0 / 5 | 0 / 0 / 0 / 0 | -66.6727 … -10.7194 |
| `derail` | 断轨 | `Derail_Breakthrough` | partial | 18 / 0 / 0 | 2 / 0 / 0 / 0 | -3.5785 … 56.793 |
| `Fault` | 断层 | `Fault_Breakthrough` | partial | 14 / 0 / 0 | 1 / 0 / 1 / 0 | 57.1852 … 143.6328 |
| `Gibraltar` | 临界点 | `Gibraltar_Breakthrough` | static_verified | 14 / 0 / 0 | 1 / 0 / 0 / 0 | -95.9416 … -76.4829 |
| `Iceland` | 攀升 | `Iceland_Breakthrough` | partial | 22 / 0 / 0 | 1 / 0 / 0 / 0 | -223.564 … 194.2416 |
| `Mogadishu` | 摩格旧城区 | `Mogadishu_Breakthrough` | partial | 22 / 0 / 2 | 1 / 0 / 0 / 0 | 17.5477 … 31.5456 |
| `Monument` | 金字塔 | `Monument_Breakthrough` | partial | 19 / 0 / 0 | 1 / 0 / 0 / 0 | 30.6452 … 110.5404 |
| `NavalBattle` | 风暴眼 | `NavalBattle_Breakthrough` | static_verified | 22 / 0 / 0 | 0 / 0 / 0 / 0 | -98.9483 … -58.8833 |
| `Retrowar` | 堑壕战 | `Retrowar_Breakthrough` | static_verified | 22 / 0 / 0 | 1 / 0 / 0 / 0 | -10.6094 … 50.8749 |
| `Shafted` | 贯穿 | `Shafted_Breakthrough` | static_verified | 13 / 0 / 0 | 0 / 0 / 0 / 0 | -53.5052 … 1.878 |
| `Skyline` | 天际港 | `Dday_Breakthrough` | partial | 11 / 8 / 17 | 2 / 0 / 0 / 1 | -8.0497 … 212.1921 |

> “区域”= 据点/交战区/基地/据点目标；“体积”= `GamePlayValidAreaActor` / `BP_ForbiddenBox`+`BP_ForceForbiddenBox` / `BP_ForbiddenArea` / `RedeployForbiddenBoxComponent`。

## 4. 缺口（不伪造几何）

### 4.1 全局

- [rooftop_black_zone_not_located] 14 张攻防 persistent 关卡里 BP_ForbiddenBox_C / BP_ForceForbiddenBox_C 的静态实例数为 0；楼顶黑区可能是运行时/子关卡生成，未定位到可靠几何，列为缺口。
- [no_sublevel_dumps] 本版每张攻防图 pak 里只有 1 个 .umap；persistent 的 StreamingLevels 为空，没有可用的子关卡/流送关卡 dump。
- [skyline_partial] Skyline（天际港）manifest 使用 Dday 世界数据，但 36 个区域里只有 11 个能在 Dday_Breakthrough 找到逐点一致的同名组件；其余为缺口/未发布/事件变体，未用近似几何补齐。
- [manifest_event_circle_height_outliers] 旧 manifest 的事件解锁据点圆圈高度异常：Crest A1/B1/B2/C1/C2 为 -37.5…-60.6m、Mogadishu D1/E1 为 399.6m；关卡里没有对应 AreaTexturePath 组件，本图层列为缺口，不导出。

### 4.2 按图

- `Crest` [area_no_source_component] A1 Crest_Breakthrough_Objective_A1_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Crest` [area_no_source_component] B1 Crest_Breakthrough_Objective_B1_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Crest` [area_no_source_component] B2 Crest_Breakthrough_Objective_B2_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Crest` [area_no_source_component] C1 Crest_Breakthrough_Objective_C1_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Crest` [area_no_source_component] C2 Crest_Breakthrough_Objective_C2_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Mogadishu` [area_no_source_component] D1 Mogadishu_Breakthrough_Objective_PointD_Hidden — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Mogadishu` [area_no_source_component] E1 Mogadishu_Breakthrough_Objective_PointE_Hidden — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 C3 Skyline_Breakthrough_Objective_PointC1_2_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 C2 Skyline_Breakthrough_Objective_PointD1_3_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 C1 Skyline_Breakthrough_Objective_PointD1_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 D1 Skyline_Breakthrough_Objective_PointE1_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 D2 Skyline_Breakthrough_Objective_PointE2_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] S3 Dday_Breakthrough_Sector_S3_Event_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S3_Attack Skyline_Breakthrough_Base_S3_Attack_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S3_Defend Skyline_Breakthrough_Base_S3_Defend_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S4_Attack_2 Skyline_Breakthrough_Base_S4_Attack_2_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S4_Defend Skyline_Breakthrough_Base_S4_Defend_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S5_Attack Skyline_Breakthrough_Base_S5_Attack_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S5_Defend Skyline_Breakthrough_Base_S5_Defend_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S3 Skyline_Breakthrough_Sector_S3_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S4 Skyline_Breakthrough_Sector_S4_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] 未发布 S5 Skyline_Breakthrough_Sector_S5_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] S3_Attack Dday_Breakthrough_Base_S3_Attack_Event_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。
- `Skyline` [area_no_source_component] S3_Defend Dday_Breakthrough_Base_S3_Defend_Event_Area — manifest 有该区域，但关卡里没有同名 AreaTexturePath + >=3 个 WorldSplinePoint 的组件；多为事件解锁据点的圆形推断，或源关卡缺失。

## 5. 验证

- JSON 解析：全部文件由本脚本写出后可直接 `json.load`；`verify_volumes3d.py` 会再独立检查。
- 坐标/单位：`web.points[i] == [raw.X/100, raw.Z/100, raw.Y/100]`（脚本断言）。
- `WorldSplinePoint` 世界坐标 ↔ `SplineCurves.local + transform`：最大 0.0251 cm。
- `Box3D` Z ↔ `WorldSplinePoint` Z：最大 0.0 cm。
- `TriangleList` 落在 `Box3D` 外：0 个点。
- 与现有 manifest 逐点误差：最大 36.7413 m（247/255 个区域 ≤0.12 m；8 个 Skyline 警告）。
- 警告对象：
- `Skyline` 全图可玩盒 (valid_area): static_verified；不包含全部区域点
- `Skyline` 对空禁区 (forbidden_area): static_verified_polygon_height_semantics_unknown
- `Skyline` 全图可玩盒 (valid_area): static_inferred_extent
- `Skyline` 全图可玩盒 (valid_area): static_verified；不包含全部区域点
- `Skyline` S0_Attack (base): static_verified_manifest_mismatch
- `Skyline` S1_Attack_Land (base): static_verified_manifest_mismatch
- `Skyline` S1_Attack_Land (base): static_verified_manifest_mismatch
- `Skyline` S2_Defend (base): static_verified_manifest_mismatch
- `Skyline` S3_Attack (base): static_verified_manifest_mismatch
- `Skyline` S3_Defend (base): static_verified_manifest_mismatch
- `Skyline` S1_1 (sector): static_verified_manifest_mismatch
- `Skyline` S2 (sector): static_verified_manifest_mismatch

## 6. 网页实验层

- 入口：`web/map.html` 左侧“攻防阶段”第二行“**据点体积**”（正式功能，与边界投射同组）。
- **默认关闭**；仅胜者为王/攻防显示；`?vol3d=1` 可用于本地截图/测试。
- 2026-11-11 起只绘制**当前阶段据点**的原始轮廓点序（仅去重 <0.35m，洋红 LineLoop 线框）、`DetectHeight` 高度带和每个原始点的上/下定点；交战区/基地/静态体积不再进入此层。
- 打开后加载 `web/data/volumes3d/<Map>.json`，只绘制 `subtype=objective` 且属于当前 `stageFilter` 的据点。
- 底部 spline 中间点不画；开启体积时隐藏原地图据点虚线边界，避免叠线。
- 交战区/基地/`valid_area`/`forbidden_area`/`redeploy_forbidden` 不再进入此层。
- `static_verified_manifest_mismatch` 不画，只在图例/状态里提示。
- 关闭后立即移除，并恢复原据点边界。

## 6.1 黑区：已下掉，等待 GamingArea spline

- 反编译追踪：倒计时触发源是 `ADFMQuestGamingArea::CheckWorldLocationInsideSpline2D` / `GetPlayersOutsideSpline2D`，玩家**离开**当前激活的 spline 安全区后 `UDFMQuestGamingAreaPlayerComponent::StartCountdown`。
- 属性：`bIsOutGamingArea`、`OutGamingAreaWouldSuicide`、`PunishCountdownSeconds`、`CountdownSeconds`、`CountdownEndTicks`；激活走 `GamingAreaStageSetting` / `SetGamingAreaActivate`。
- 静态包没有 `ADFMQuestGamingArea` / `BP_GamingAreaSpline_C` 实例，也没有 GamingArea spline 数据；`GamePlayValidAreaActor` 是 OpenWorld 流送盒（`GetGameplayOBBs`），不是安全区。
- 因此网页黑区层已下掉，不再用交战区/据点/可玩盒包络冒充；等拿到运行时 GamingArea spline 再接入。

## 6.2 据点高度带（DetectHeight）

- 据点的 `BP_BattleSectorAnchor.DetectHeight`（cm）作为垂直高度带上限：底为 `web.zRange[0]`，顶为 `web.zRange[0] + heightM`。
- 例：Mogadishu B1 `DetectHeight=1050cm=10.5m`，二楼在高度带内；Cracked C1 6.75m、C2 8m。
- 网页在左侧“攻防阶段”→“据点体积”中把据点画成线框（上下环 + 每个点竖边 + 每个点上/下定点）；去掉半透明面/圆柱，避免缩小时摩尔纹；状态栏显示当前阶段高度带数量（Mogadishu B 阶段为 3 个）。
- 该语义来自原始字段和楼层现象推断，未在游戏内逐点验证；不代表整栋建筑都是可占点体积。
- `BP_ForbiddenArea` 的 `DetectHeight` 垂直语义未确认；`RedeployForbiddenBox` 只影响重生；两者都不当作黑区。

## 7. 回滚

- `map.html` 备份：`_backup/volumes3d_20261109/map.html.bak_volumes3d_20261109`
- 删除/改名：`web/data/volumes3d/`（新增目录，删掉即回到无实验层）
- 原 `manifest.json` 未改；基线哈希：`_backup/volumes3d_20261109/baseline_sha256.json`

## 8. 限制

- 只覆盖 **1.101.37119.18 攻防/胜者为王 persistent 关卡**；本版每图只有 1 个 `.umap`，`StreamingLevels` 为空，没有子关卡/流送关卡 dump。
- 未做游戏内行为验证；`GamePlayValidAreaActor` 是“全图可玩盒”，**不是楼顶黑区**；`RedeployForbiddenBox` 只影响重生；`BP_ForbiddenArea` 的 `DetectHeight` 垂直语义未确认，未生成高度带。
- 楼顶黑区：14 张攻防 persistent 里 `BP_ForbiddenBox_C`/`BP_ForceForbiddenBox_C` 静态实例为 0，未定位到可靠几何，列为缺口。
