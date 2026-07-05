# 业务域持久化快照（索引备忘）

**状态**：`shipped`（P1+P2 已落地；采集入口已随 `sceneToJson` 迁移）  
**日期**：2026-06-05（2026-06-28 更新采集路径说明）

将各业务域的「画布采集」与「存量合并」从 `core/util/util.js` 下沉到域模块，core 只保留通用列表/分块合并。

**正史**：[`scene-canonical-collect-roadmap.md`](./scene-canonical-collect-roadmap.md) — 编辑器保存与 `sceneToJson` 反扫。

---

## 核心模块

| 文件 | 职责 |
|------|------|
| [`core/util/persistListMerge.js`](../core/util/persistListMerge.js) | `descriptorListMergeKey`、`mergeWorldInfoModelListByIdentity`、`mergeModelListItemsByIdentity` |
| [`core/util/persistWorldInfoMerge.js`](../core/util/persistWorldInfoMerge.js) | `mergeDomainModelList`：按 `domain` 分块，委托各域 `api.mergePersistDescriptor` |
| [`core/handler/businessDomainRegistry.js`](../core/handler/businessDomainRegistry.js) | `resolveDomainIdForSceneDeployRoot`：deploy 根 `objJson` → domain id |
| [`core/util/sceneToJson.js`](../core/util/sceneToJson.js) | 标准 JSON 反扫；域 `capturePersistDescriptor` 在 collect 路径调用 |
| [`core/util/util.js`](../core/util/util.js) | `buildPersistPayloadWorldInfoPrimary`（friendly 合并遗留）；重导出 merge 工具 |

---

## 域扩展契约（`domains/*/index.js`）

| api 钩子 | 用途 |
|----------|------|
| `legacyBoxObjTypes` | legacy `objType` → domain 映射（mesh 部署与持久化解析） |
| `matchesSceneDeployRootObjJson(objJson)` | 可选；deploy 根形态匹配（如 group 包裹 `cabinetInfo`） |
| `capturePersistDescriptor(object3D)` | 反扫时采集单条 domain 记录（运行态 → descriptor） |
| `mergePersistDescriptor(base, fresh)` | 单条 item 合并（避免画布壳覆盖快照业务字段） |

**参考实现**：[`domains/cabinet/cabinetPersist.js`](../domains/cabinet/cabinetPersist.js)、[`domains/cabinet/index.js`](../domains/cabinet/index.js)

---

## 采集路径（当前）

1. **标准 JSON 保存 / 导出**：`sceneToJson` / `exportJsonScene` → 遍历 deploy 根 → 域 `capturePersistDescriptor`（若提供）→ `objectList` / `domainModelList` 块。
2. **Friendly 合并**（导入 / 增量合并场景）：`buildPersistPayloadWorldInfoPrimary` → `mergeDomainModelList` + `mergeWorldInfoModelListByIdentity`。

~~`collectCurrentWorldInfo`~~ 已删除；见 [archive/persist-canonical-json-memo.md](./archive/persist-canonical-json-memo.md)。

---

## 测试

- [`tests/persistPayloadWorldInfoPrimary.test.mjs`](../tests/persistPayloadWorldInfoPrimary.test.mjs) — worldInfo 合并（含机柜门体保留）
- [`tests/cabinetPersistMerge.test.mjs`](../tests/cabinetPersistMerge.test.mjs) — 机柜 capture/merge 单元
- [`tests/sceneToJson.test.mjs`](../tests/sceneToJson.test.mjs) — 标准反扫往返

运行：`node --test tests/persistPayloadWorldInfoPrimary.test.mjs tests/cabinetPersistMerge.test.mjs tests/sceneToJson.test.mjs`
