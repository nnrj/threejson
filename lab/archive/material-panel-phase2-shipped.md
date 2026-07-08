# 材质面板二期（已归档）

**状态**：`archived`（2026-06 已收尾）  
**正史**：[`docs/zh/json-format.md`](../docs/zh/json-format.md) § `assetLibrary` 与 `lib://`

合并自 `material-panel-phase2-roadmap.md` 与 `material-panel-phase2-closure-and-phase3-prep.md`。

---

## 已拍板

- 右 dock：**对象管理** | **资源管理** | 场景 JSON
- 属性卡标题：**属性 - {name|threeJsonId}**
- `assetKind !== texture`：**仅登记**，deploy 不解析（三期）
- 材质编辑：默认 blur/change → redeploy；**应用到对象**保留；设置可关

## 实现顺序（均已落地）

- [x] PR1：子标签 + 资源管理 CRUD（texture 生效）
- [x] PR2：材质树 + `materialDescriptorWalk` + redeploy 设置
- [x] PR3：`instancedBuilder` + 单测

## 验收要点

| 项 | 验证点 |
|----|--------|
| PR1 | 右 dock 三标签；`assetLibrary` CRUD；非 texture badge |
| PR2 | 属性标题；材质树 + `lib://` 下拉；blur/change redeploy + 应用到对象 |
| PR3 | `createInstanceBox` → `setUserDataObjJson`；instanced 不浅写 `userData.objJson` |

手工 smoke：打开 `scene-editor.html` → 选中六面对象 → 改材质树颜色 → 撤销 → 各面 `textureUrl` 仍在。

## assetKind（本期）

| kind | CRUD | deploy |
|------|------|--------|
| `texture` | 是 | `lib://` |
| 其它 | 是 | 否（UI：未接入运行时） |

## 明确推迟（三期及以后）

| 项 | 说明 |
|----|------|
| 非 `texture` deploy | `materialPreset` / `geometryPreset` 接 registry + builder |
| assetRegistry 方案 C / refCount | [asset-registry-lifecycle-memo.md](../asset-registry-lifecycle-memo.md) |
| 增量 deploy + 改库 UI 告警 | 本期仅文档建议 |
| 材质树每槽 PBR 全字段 | UX 扩展 |
| M1–M3 描述符根治 | [material-descriptor-persisted-vs-runtime.md](../material-descriptor-persisted-vs-runtime.md) |

## 测试

`node --test tests/materialDescriptorWalk.test.mjs tests/resolveTextureSource.test.mjs tests/editorMaterialHistorySnapshot.test.mjs tests/createInstanceBox.test.mjs tests/descriptorExportSanitize.test.mjs`

详见 [`tests/README.md`](../tests/README.md)。
