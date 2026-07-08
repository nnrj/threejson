# 纹理采样编辑器 backlog — Lab 备忘

| 字段 | 值 |
|------|-----|
| 状态 | `parked`（本期不做，**非发布承诺**） |
| 记录日期 | 2026-06 |
| 正史 plan | [纹理采样自由配置_17ce372e.plan.md](../.cursor/plans/纹理采样自由配置_17ce372e.plan.md) |
| 用户文档 | [docs/zh/json-format.md](../docs/zh/json-format.md)（采样字段节）、[docs/zh/api.md](../docs/zh/api.md)（`textureSampling.js`） |

与 [`docs/zh/scope.md`](../docs/zh/scope.md) 的 Core 承诺区分：下文「未做」项仅指**编辑器 UI**，不代表 runtime / JSON 能力缺失。

---

## 背景

纹理采样方案采用 **A → G → S → C** merge 链（代码 preset、场景 `textureDefaults`、档位 `textureQuality`、显式字段），opt-out 为 `textureQuality: 0` 或 `textureSampling: false`。

v1 实现已覆盖 **core、加载路径、runtime 热更新、材质槽编辑器、场景默认档、文档与 t02-11 demo**。本备忘记录 **刻意不做或执行阶段未落地** 的编辑器面，避免误读为「被阻塞」或「API 未实现」。

---

## v1 已落地（索引）

| 层 | 说明 |
|----|------|
| Core | [`core/util/textureSampling.js`](../core/util/textureSampling.js)：`parseTextureQuality`、`resolveTextureProps`、`applyTexturePropsFromRecord`、`syncTexturePropsToMap`、`configureTextureDefaultsForDeploy` |
| 加载 | `loadTextureFromMaterialJson`、`textureUtils`、`gif`、`infoPanelBuilder` 统一走新 API |
| Runtime | [`objectMutation`](../core/runtime/objectMutation/index.js) 采样 patch；[`infoPanelRuntime`](../core/handler/infoPanelRuntime.js) partial keys |
| 编辑器 · 材质槽 | S 下拉 +「高级设置」Modal +「当前生效」摘要：host [`sceneTreeMaterialTree.js`](../tools/scene-host/editor/js/sceneTreeMaterialTree.js) + [`scene-editor.html`](../scene-editor.html) 内联镜像 |
| 编辑器 · 场景档 | `sceneConfig.textureQuality`：[`sceneManagePanel.js`](../tools/scene-host/editor/js/sceneManagePanel.js) / scene-editor 场景管理区 |
| Demo | [`02-11-texture-sampling-toggle`](../assets/json/tutorial/track-02/02-11-texture-sampling-toggle.json) + html-demo catalog |
| 测试 | [`tests/textureSampling.test.mjs`](../tests/textureSampling.test.mjs)、runtime mutation 采样热更新用例 |

---

## 本期不做（backlog 主项）

### 1. G 层 `sceneConfig.textureDefaults` 编辑器 UI

**Plan 结论**：§5.0.2 明确「**首版不做 UI**」；G 为专家级逐字段全局 patch（如 `imageMap.anisotropy: 8`）。

| 项 | 说明 |
|----|------|
| Runtime | ✅ deploy 时读 `textureDefaults`，merge 链已通 |
| 仓库 JSON | 当前 **无** demo/tutorial 使用 `textureDefaults` |
| 与 S 关系 | 已有 `sceneConfig.textureQuality` 下拉，覆盖「全场景默认画质」的常见需求 |
| 替代 | Code 模式 / 场景 JSON 手写；见 json-format 示例 |

**不做原因**：受众小、与 S 重叠度高；JSON 即可。**无技术阻塞。**

### 2. infoPanel 属性块采样 UI

**Plan 要求**：[`sceneTreePanel.js`](../tools/scene-host/editor/js/sceneTreePanel.js) 的 infoPanel 块与材质槽「同等 UI」（S 下拉 + 高级 Modal + 摘要，profile 为 `ui`）。

| 项 | 说明 |
|----|------|
| Runtime | ✅ `infoPanelBuilder` + `infoPanelRuntime` 已支持 `textureQuality` 及 C 字段热更新 |
| 编辑器 | ❌ 属性面板无采样控件 |
| 替代 | 改 `objJson.infoPanel.*` 于 JSON / Code 模式 |
| ROI | infoPanel 走 `ui` 路径（Canvas/文字），采样差异通常不如 `imageMap` 贴图明显 |

**未做原因**：v1 排期优先材质槽（主编辑路径）；**无技术阻塞**，仅为编辑器体验补齐。

---

## 可选 polish（一并备忘，非必须）

| 项 | 说明 |
|----|------|
| 场景「应用到画布」与 deploy 纹理上下文 | 改 `sceneConfig.textureQuality` 后，已加载贴图 merge 生效是否需显式 `configureTextureDefaultsForDeploy` + 轻量 refresh（免全量 redeploy） |
| infoPanel runtime 采样 partial 测试 | Plan 标 optional |
| t02-11 infoPanel 同屏对比 | Plan 场景设计为 optional；当前 demo 仅 imageMap 平面 |

---

## 已有替代路径（作者 / 集成方）

1. **JSON**：`material.textureQuality` / `infoPanel.textureQuality` / `sceneConfig.textureQuality` / C 显式字段 / G `textureDefaults`
2. **编辑器 Code 模式**：改场景 JSON 文本
3. **Runtime**：`applyObjectChange(id, "material.textureQuality", tier, { createMissing: true })` 等（见 t02-11）

用户不感知 A/G/S/C 分层；缺 UI 不等于缺能力。

---

## 何时再立项（退出条件）

满足 **其一** 可考虑排 editor UI 期：

- 编辑器用户**频繁**改 infoPanel 采样，且明确拒绝 JSON/Code 模式
- 新增 tutorial/demo **专门**教 infoPanel 采样或 G 全局 patch
- 产品要求 host 与 `scene-editor.html` 在「所有纹理配置面」UI **完全对称**

**G 层 UI** 单独触发：仓库内出现稳定使用的 `textureDefaults` JSON，且必须在 GUI 调参（非一次性脚本）。

---

## 若实现时的落点（未来参考）

复用现有模块（infoPanel 用 profile `"ui"`）：

- [`sceneTreeTextureSamplingHelpers.js`](../tools/scene-host/editor/js/sceneTreeTextureSamplingHelpers.js)
- [`sceneTreeTextureSamplingModal.js`](../tools/scene-host/editor/js/sceneTreeTextureSamplingModal.js)
- CSS / Modal DOM 模式：[`#textureSamplingAdvancedModal`](../tools/scene-host/editor/_shell-body.html)

| 待做项 | Host | scene-editor.html |
|--------|------|-------------------|
| infoPanel S + Modal | `sceneTreePanel.js` infoPanel 属性块 | 内联镜像，**不 import** host |
| G `textureDefaults` | 场景管理 panel 子区或高级 JSON 区 | 同上 |

host 与 `scene-editor.html` **双份并行**维护（与 v1 材质树一致）。

---

## 关联 lab / 文档

- 材质面板二期收尾：[archive/material-panel-phase2-shipped.md](./archive/material-panel-phase2-shipped.md)
- 场景编辑器右栏 UI 总备忘：[scene-editor-ui-memo.md](./scene-editor-ui-memo.md)
