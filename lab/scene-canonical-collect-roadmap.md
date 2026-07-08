# Scene 标准 JSON 反扫路线图（正史）

**状态**：`shipped`（C0–C2 已落地）  
**日期**：2026-06-02  
**正史 plan**：[`scene标准json抽取改造_391a7416.plan.md`](../.cursor/plans/scene标准json抽取改造_391a7416.plan.md)（lab 为辅助备忘，**以 plan + 代码为准**）

---

## 1. 背景与目标

历史上 scene→JSON 存在双轨：

| 路径 | 行为 | 问题 |
|------|------|------|
| 编辑器 `collectCurrentWorldInfo` + `buildPersistPayloadWorldInfoPrimary` | `deployRoots` + domain 钩子 + sanitize | 先 friendly 分桶再转 standard |
| core `exportJsonScene` + `defaultCollectWorldInfoFromScene` | `scene.traverse` 直推 `userData.objJson` | 无 sanitize/domain；与编辑器不一致 |

**目标**：单一权威反扫 **`sceneToJson` 族**；保存/快照以标准 JSON `{ threeJsonId, objectList, sceneConfig, assetLibrary?, saveMeta }` 为主；友好 JSON 仍为人读导出视图，经 `sceneToFriendlyJson` 投影，**不**保留独立友好反扫。

---

## 2. API：`sceneToJson` 族

实现：[`core/util/sceneToJson.js`](../core/util/sceneToJson.js)，经 [`core/index.js`](../core/index.js) 导出。

| API | 职责 |
|-----|------|
| `sceneToStandardJson(scene, options?)` | 从 `THREE.Scene` 产出标准根对象（含 `objectList`、运行时 `sceneConfig`） |
| `sceneToStandardJsonSimple(scene, options?)` | 同步版；不将 friendly base 转 standard（编辑器 history 等） |
| `sceneToFriendlyJson(scene, options?)` | `sceneToStandardJson` → `convertStandardJsonToFriendlyJson` |
| `sceneToJson(scene, options?)` | 统一入口；`format: 'standard' \| 'friendly'`（默认 `standard`） |
| `rebuildStandardJson` / `rebuildFriendlyJson` | 首期 **委托 read**（`mode: 'rebuild'` 占位） |
| `collectObjectListFromScene(scene, options?)` | 仅采集 `objectList` 条目 |

**关键 options**：

```text
format: 'standard' | 'friendly'     // sceneToJson 专用
mode: 'read' | 'rebuild'            // 默认 read
scanDepth: 'deployRoots' | 'registryRoots' | 'traverse'  // 默认 deployRoots
basePayload: object                 // merge 基座（编辑器：resolveEditorMergeBase）
merge: boolean                      // 默认 true
embedNative: boolean                // true → sceneToNativeJson 写入 sceneInfoList
runtimeTarget: { scene, camera, ... }
friendlyMap: object                 // sceneToFriendlyJson 投影表
```

---

## 3. read vs rebuild；domain 首期行为

| 模式 | 含义 |
|------|------|
| **read（默认）** | 读 deploy 根描述符；同步 position/rotation/scale/visible；domain 走 `capturePersistDescriptor` |
| **rebuild** | 首期与 read 相同；待 [domain 运行时变更契约](./domain-runtime-mutation-contract-memo.md) 完善后再升级 |

**domain 记录形态（instance-only）**：`{ objType: "domain", domain, handler, …业务字段 }` — 一条 JSON = 一个 deploy 实例；**无** `items[]` bundle wrapper。与 [`portShow.json`](../assets/json/portShow.json) port 多 instance 同形。

---

## 4. 命名对照与 `exportJsonScene` 审计

| 符号 | 关系 |
|------|------|
| `exportJsonScene` | **薄封装** `sceneToJson`；runtime 分支全量转发 `...opts`；**不** deprecated |
| `exportJsonSceneText` | `exportJsonScene` + `JSON.stringify` |
| `sceneToNativeJson`（原 `serializeSceneToJson`） | Three.js `toJSON()` 封装；**orthogonal** 于 `sceneToJson`；用于 `sceneInfoList`/应急 |
| `convertFriendlyJsonToStandardJson` | 纯 JSON 互转（无 scene） |
| `convertStandardJsonToFriendlyJson` | 标准 → 友好（无 scene） |
| ~~`collectCurrentWorldInfo`~~ | **已删**（编辑器） |
| ~~`defaultCollectWorldInfoFromScene`~~ | **已删**（core） |
| `buildPersistPayloadWorldInfoPrimary` | **遗留**于 util（merge 测试）；编辑器不再调用 |

**改造前 `exportJsonScene` 问题**（已修复）：traverse 直推 objJson、默认 `standard` 却 friendly-first、无 sanitize/domain。

---

## 5. 参数归属与 `sceneToNativeJson`

| 参数 | 归属 |
|------|------|
| `format` / `mode` / `scanDepth` / `merge` / `basePayload` | `sceneToJson` 族 |
| `includeSceneInfoList` | `exportJsonScene` → 映射为 `embedNative: true` |
| `includeRuntimeRecords` | `sceneToJson` → `applyRuntimeSceneConfigToPayload` |
| `shouldSkipObject` / `sanitizeUserData` | `sceneToNativeJson` 专用 |
| `friendlyMap` | `sceneToFriendlyJson` / payload-only `exportJsonScene` |

**native 三类**（正史）：

1. `objType: native` / parseMode → 正常 objectList 导出  
2. **native-scene embed** → **不写回内层**；保留 base `worldInfo.sceneInfoList`  
3. `sceneToNativeJson` = Three `.toJSON()`，与 objectList 主路径正交  

**camaraPosition**：导出不写；机位进 `sceneConfig.camera`；加载旧 friendly 仍可读 legacy 字段。

---

## 6. 现实现归一表

| 现实现 | 归一方式 |
|--------|----------|
| 编辑器 persist / 快照 / 侧栏 JSON | `sceneToJson(scene, buildSceneToJsonOptions())` |
| `exportStandardThreeJson` / `exportFriendlyThreeJson` | `sceneToJson` / `sceneToFriendlyJson` |
| `exportJsonScene`（runtime） | 薄封装 `sceneToJson` |
| `getSceneJsonString`（应急） | `sceneToNativeJson` + `buildRoomSavePayload` → `sceneInfoList` |
| 用户主动保存 | `sysConfig.jsonData =` 整包标准 JSON（方案 B） |

**merge 基座（编辑器）**：`resolveEditorMergeBase()` → **`sysConfig.jsonData` 仅此**（与改造前 worldInfo persist 一致）。`autoSnapshot` / `manualStash` 仅用于退出恢复与手动暂存，**不参与** `sceneToJson` 的 `basePayload`。

---

## 7. `scanDepth` 与还原度

| 值 | 行为 | 默认 |
|----|------|------|
| `deployRoots` | 仅 `scene.children` 一层，跳过 runtime/helper | **是** |
| `registryRoots` | 预留；首期等同 deployRoots | |
| `traverse` | 全树带 objJson 节点 | 调试专用；易重复/壳子混杂 |

**partial merge**：fresh 未扫到的 `threeJsonId` 保留 base 条目（`mergeObjectListByIdentity`）。

---

## 8. 标准 JSON 外形与 `isCanonicalScenePayload`

正史外形见 [standard-json-shape-proposal.md](./standard-json-shape-proposal.md)（**方案 B**：`sceneConfig` + `objectList` 双通道，`jsonOrigin`，`threeJsonId`）。

| 形态 | `isCanonicalScenePayload` | 说明 |
|------|---------------------------|------|
| 纯 `objectList`（无顶层 `sceneConfig`） | `true` | 合法子集（tutorial 全 list 写法） |
| 编辑器保存 / 推荐默认外形 | `false` | 含 `sceneConfig` + `objectList`，**预期** |

- **根级白名单**：`extractRootMetadataFromBase` 保留 `threeJsonId`、`saveMeta`、`assetLibrary`、`extensions` 等  
- **加载合法性**：`isLoadableScenePayload`（`worldInfo` 或 非空 `objectList` 或 `sceneConfig` 主 runtime）  

实现：[`sceneFriendlyNormalizer.js`](../core/handler/sceneFriendlyNormalizer.js)、[`sceneJsonOrigin.js`](../core/util/sceneJsonOrigin.js)。

---

## 9. 实现阶段 C0–C2

| 阶段 | 交付 |
|------|------|
| **C0** | `sceneToJson.js`、`scenePayloadMerge.js`、`sceneRuntimeConfigExport.js`、`sceneExportNode.js`；`exportJsonScene` 薄封装；`sceneToNativeJson` |
| **C1** | 编辑器迁移；删 `collectCurrentWorldInfo`；`persistUserSceneBaseline` 整包写 `jsonData` |
| **C2** | [`tests/sceneToJson.test.mjs`](../tests/sceneToJson.test.mjs)；[`tests/sceneExportHandler.test.mjs`](../tests/sceneExportHandler.test.mjs) 更新 |

---

## 10. 附录

### M2 / sanitize 现状

- **已实现**：[`sanitizeObjectRecordForExport`](../core/util/descriptorExportSanitize.js)（read 路径已接）  
- **未实现**：`toPersistedRecord`（见 [material-descriptor-persisted-vs-runtime.md](./material-descriptor-persisted-vs-runtime.md) M2）  

### threejson-sync 历史

旧 plan 锁定 **2-B**：保存主产物为 worldInfo 列表。本改造 **取代 2-B** 为 objectList 主存（`sceneToStandardJson`）。参见 [`.cursor/plans/threejson-sync-and-scene-tree-prerequisite.plan.md`](../.cursor/plans/threejson-sync-and-scene-tree-prerequisite.plan.md)。

---

## 11. 关联文档

| 文档 | 关系 |
|------|------|
| [standard-json-shape-proposal.md](./standard-json-shape-proposal.md) | **WHAT**：标准 JSON 外形（方案 B、`jsonOrigin`）；D0–D5 已落地 |
| [archive/persist-canonical-json-memo.md](./archive/persist-canonical-json-memo.md) | 演进背景索引（指向本文） |
| [domain-persist-snapshot-memo.md](./domain-persist-snapshot-memo.md) | domain merge / `capturePersistDescriptor` |
| [移除机柜特殊逻辑 §六](../.cursor/plans/移除机柜特殊逻辑_4115e2a4.plan.md) | 机柜 persist 与 objectList 交叉引用 |
| [docs/zh/api.md](../docs/zh/api.md) | 对外 API 说明 |
