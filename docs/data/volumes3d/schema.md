# volumes3d schema v1

## 文件

- `index.json`：`schemaVersion`, `sourceVersion`, `axis`, `maps`, `totals`, `globalGaps`, `sourceAudit`, `validationSummary`
- `<Map>.json`：`schemaVersion`, `map`, `mapName`, `sourceLevel`, `sourceFile`, `features[]`, `gaps[]`, `counts`, `zRange`, `manifestConsistency`, `coverage`

## 坐标

- 源：UE5，cm，X 前 / Y 右 / Z 上。
- web：`[x, y, z] = [UE.X/100, UE.Z/100, UE.Y/100]`，米。
- `raw` 保留 UE 原始坐标（cm）；`web` 是换算后的 three.js 坐标。

## feature 通用字段

| 字段 | 说明 |
|---|---|
| `type` | `area` 或 `volume` |
| `subtype` | `sector` / `base` / `objective`；`valid_area` / `forbidden_box` / `force_forbidden_box` / `forbidden_area` / `redeploy_forbidden` |
| `label` | 现有 manifest 的标号（A1/B2/S1_Attack…） |
| `status` | `static_verified` / `static_verified_manifest_mismatch` / `static_inferred_extent` / `static_verified_polygon_height_semantics_unknown` |
| `source` | 关卡、actor、component、AreaTexturePath、actorObjectPath |
| `raw` | UE 原始数据（WorldSplinePoint/Box3D/TriangleList/BoxExtent/DetectHeight…） |
| `web` | 换算后的 points/triangles/bbox/zRange/corners |
| `validation` | 源数据交叉验证（area） |
| `notBlackZone` | 明确标记“不是楼顶黑区”的体积 |

## area 的 `raw/web`

- `raw.worldSplinePoint`：`[{X,Y,Z}]` cm，世界坐标。
- `raw.box3D`：`{Min,Max,IsValid}` cm。
- `raw.triangleList`：世界坐标三角形顶点（cm）。
- `raw.detectHeight`：据点 actor 的 `DetectHeight`（cm），可能为空。
- `web.heightM`：`DetectHeight/100` 米；网页据此画高度带/屋顶黑格。
- `web.points`：`[[x,y,z]]` m。
- `web.triangles`：`[[x,y,z]]` m。
- `web.bbox`：`x/z/height`，米；`height` 来自 `WorldSplinePoint.Z`。
- `validation.worldPointTransformMaxErrorCm`：`WorldSplinePoint` 与 `SplineCurves.local + transform` 的最大误差；用于证明世界坐标语义。

## volume 的 `raw/web`

- `raw.boxExtent`：UE cm。
- `raw.serializedRelativeLocation/Rotation/Scale3D`：原始序列化值（若存在）。
- `raw.worldCenterCm`：应用 actor/component transform 后的世界中心。
- `raw.corners`：8 个 UE 世界角点 cm。
- `web.center/halfExtents/corners/zRange`：米。
- `extentSource`：`serialized` 或 `default_100cm_inferred`。
- `containsAreaPoints`：该盒是否包含本图所有已验证区域点。
- `heightSemantics`：`BP_ForbiddenArea` 的高度语义说明（不生成高度带）。

## 黑区（已从网页下掉）

- 反编译追踪：倒计时触发源是 `ADFMQuestGamingArea::CheckWorldLocationInsideSpline2D` / `GetPlayersOutsideSpline2D`；玩家离开当前激活的 spline 安全区后，`UDFMQuestGamingAreaPlayerComponent::StartCountdown` 开始倒计时。
- 属性：`bIsOutGamingArea`、`OutGamingAreaWouldSuicide`、`PunishCountdownSeconds`、`CountdownSeconds`；激活走 `GamingAreaStageSetting` / `SetGamingAreaActivate`。
- 静态包没有 `ADFMQuestGamingArea` / `BP_GamingAreaSpline_C` 实例，也没有 GamingArea spline 数据；旧交战区/可玩盒/据点包络实现全部推翻，网页不再显示黑区。
- `index.json.blackZoneCoverage` 只记录 `status=removed_from_ui` 和运行时调用链，供后续接入。

## 状态/缺口约定

- `static_verified`：源组件存在，且与现有 manifest 逐点一致（≤0.12 m）。
- `static_verified_manifest_mismatch`：源组件存在，但与现有 manifest 点位差异 >0.12 m；**网页实验层默认不绘制**，只在状态/图例提示。
- `static_inferred_extent`：`BoxExtent` 未序列化，按 native 100cm + containment 校验推断。
- `gaps`：没有可靠源几何（Skyline 未发布/事件变体、Crest/Mogadishu 事件解锁据点、楼顶黑区静态实例为 0 等）；Suez 已归档，不计入。
