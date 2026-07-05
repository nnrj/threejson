# sysConfig 与 sceneConfig 配置归属评估

**状态**：`shipped`（2026-06 实施）  
**宿主文档**：[`doc/tools.md`](../doc/tools.md)  
**远期备忘**：[`sysconfig-sceneconfig-settings-memo.md`](./sysconfig-sceneconfig-settings-memo.md)

## 1. 结论

| 概念 | 层级 | JSON/core 契约 | core 读页面 `sysConfig` |
|------|------|----------------|-------------------------|
| `sceneConfig` | `payload.sceneConfig`（或标准 JSON 等价 runtime） | 是 | 经 normalize → createJsonScene |
| `sysConfig` | HTML 工具页内联对象 | 否 | 否 |
| `sysConfig.jsonData` | 内存场景包 | 与 JSON 同构 | 间接传入 core |

可通用配置：**`sceneConfig` 为超集**；`sysConfig` 为**可镜像子集 + 工具专有字段**。合并优先级：JSON 显式字段 → sysConfig/settings 兜底 → options/引擎默认。

## 2. 标准 JSON 与友好 JSON

二者 runtime **等价**（归一化后同一内部模型）：

| 形态 | sceneConfig |
|------|-------------|
| 友好 JSON | 通常有顶层 `sceneConfig` + `worldInfo.*List` |
| 标准方案 B | `sceneConfig` + `objectList`（编辑器保存默认） |
| 标准全 list | runtime 在 `objectList` 内 `objType: scene/camera/...` |

`isCanonicalScenePayload` 仅指**最窄**纯 `objectList` 子集。

## 3. 已迁移的遗留字段（无兼容期）

自 `worldInfo` 迁入 `sceneConfig`（仓库内 JSON 已批量迁移，脚本见 [`tools/dev/migrate/migrate-worldinfo-runtime-to-sceneconfig.mjs`](../tools/dev/migrate/migrate-worldinfo-runtime-to-sceneconfig.mjs)）：

| 原字段 | 新位置 |
|--------|--------|
| `worldInfo.sceneAutoRotate` | `sceneConfig.controls.autoRotate` |
| `worldInfo.gridShow` | `sceneConfig.helpers.grid.visible` |
| `worldInfo.axesShow` | `sceneConfig.helpers.axes.visible` |

已删除 `applyWorldHintsToSysConfig`。

## 4. 字段对照（摘要）

### 4.1 应经 sceneConfig + sysConfig 兜底

| sysConfig 镜像 | sceneConfig 路径 |
|----------------|------------------|
| `antialias`, `ratioRate` | `renderer.*` |
| `fps`, `lowFps`, `autoResize`, `firstAutoResize`, `renderMode` | `renderLoop.*` |
| `sceneAutoRotate` | `controls.autoRotate` |
| `canvasWidth`, `canvasHeight` | 顶层或 `sceneConfig` |
| `gridShow`, `axesShow` | `helpers.grid/axes.visible`（JSON 缺省时兜底） |

### 4.2 仅 sysConfig（工具专有）

`jsonData`, `sceneLocked`, `dragLocked`, `meshObjects`, `meshList`, `initFlags`, `callFlags`, `progressFlag`, `clickHighLightFlag`, `optimizeJson`, …

### 4.3 文档曾误写

- `sysConfig.pickMeshBvh`：未实现；仅用 `sceneConfig.pick.meshBvh`。

## 5. settings A/B/C

见 [`doc/tools.md`](../doc/tools.md)。不为每字段加「覆盖 JSON」复选框。

## 6. 风险与冒烟

实施时注意 JSON 与代码**同批**迁移。冒烟：编辑器/播放器载入 `portShow.json` / `roomShow.json`；`00-04-standard-objectlist.json`（canonical）；scene-manage 修改 helpers 后保存再载入。

## 7. A/B/C 审计结论（2026-06 回填）

关联落地记录：[`scene-json-residue-audit.md`](./scene-json-residue-audit.md)。

### 7.1 已确认并完成的处置

| 议题 | 结论 | 归属 |
|------|------|------|
| `worldInfo.returnButtonShow/blockInfoPanel/floorElevation/floorHeight` | 已从 JSON 与 scene-manage 写入路径移除 | C 类或非场景字段，不应持久化 |
| `worldInfo.camaraPosition/cameraPosition/camera` | 改为输入语法糖，预解析 lift 到 `sceneConfig.camera`，持久化不回写 worldInfo | A 类内容，容器统一 `sceneConfig` |
| `worldInfo.controls/orbitControls` | 改为输入语法糖，预解析 lift 到 `sceneConfig.controls`，持久化不回写 worldInfo | A 类内容，容器统一 `sceneConfig` |
| `worldInfo.gridShow/axesShow/sceneAutoRotate` | 不恢复 worldInfo 布尔语法糖，统一使用 `sceneConfig.helpers.*` 与 `sceneConfig.controls.autoRotate` | A 类内容，仅保留 `sceneConfig` 持久化 |

### 7.2 保持不变的核心判断

- 首期 P2 把 `sceneAutoRotate`、`gridShow/axesShow` 迁入 `sceneConfig` **不是误迁**，属于 A 类修正。
- `sysConfig` 仍是工具页会话态，承担 C 类参数；不作为 core 契约。

### 7.3 仍待讨论（不在本次 P0 范围）

- `sceneAutoRotate` 的多通道重叠（JSON A 类与 options/settings B 类）如何进一步收敛。
- `canvasWidth/height` 的 A（初始 hint）与 C（运行时 resize）边界在文档中的统一措辞。
- `room-show/port-show` 与 editor/player 合并契约的对齐方式。

## 8. 参考

- [`lab/standard-json-shape-proposal.md`](./standard-json-shape-proposal.md)
- [`lab/scene-canonical-collect-roadmap.md`](./scene-canonical-collect-roadmap.md)（背景见 [archive/persist-canonical-json-memo.md](./archive/persist-canonical-json-memo.md)）
- [`doc/json-format.md`](../doc/json-format.md) — `renderLoop.renderMode`、`helpers`
