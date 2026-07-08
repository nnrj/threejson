# 场景编辑器 · AI 生成能力增强备忘（非发布承诺）

**状态**：`partial`（Phase A/B 边界与 Node 套壳已落地；增量 Patch / 流式预览 API 已进 core/ai，编辑器 UI 仍可选接入）  
**原则**：能力先在 [`core/ai/`](../core/ai/) 完善，再由 [`scene-editor.html`](../scene-editor.html) 左侧面板（AI 配置 / AI 生成 / AI 调整等子标签）接入。  
**记录日期**：2026-05（对话备忘整理）

本页**不代表发布承诺**；与 [`docs/zh/scope.md`](../docs/zh/scope.md) 的 Core 承诺区分。

---

## 一、分层职责

| 层 | 职责 |
|----|------|
| **`core/ai`** | 协议、Prompt/Skill、多轮对话、工具调用（含未来的 **agent** 形态）、场景 JSON 校验与纹理管线等 **可复用 API**；浏览器与 Node 共用入口见 [`core/ai/index.js`](../core/ai/index.js)、[`core/ai/README.md`](../core/ai/README.md)。 |
| **`scene-editor.html`** | 凭据 UI、提示词输入、进度与错误展示、生成/调整后 **载入画布**（`ingestScenePayloadFromParsedJson` 等）；**不**在页面内重复实现 LLM HTTP 与 JSON 抽取逻辑。 |

当前页面已用 `createSceneAiClient` 等对接：生成、调整、看图生成、demo 基础场景加载等（见左侧 `leftSubPanelAiConfig` / `AiGenerate` / `AiAdjust`）。

---

## 二、增强方向（备忘，未定型）

以下条目在排期前均需单独评审 **必要性、成本、安全与测试**：

### 2.1 Core 层（优先）

- **Agent / 多步工作流**：[`runSceneAgent`](../core/ai/sceneAgent.js) + [`agentDepth.js`](../core/ai/agentDepth.js) + [`agentTools.js`](../core/ai/agentTools.js)；**默认 `agent.enabled: false`**。外置 [`tools/threejson-agent/`](../tools/threejson-agent/README.md) 使用 `tools/threejson-agent/setting.json`；MCP 使用 `tools/mcp-threejson/setting.json`。
- **Agent 迭代应用到画布（Phase 1）**：`agent.iterativeApply` + [`runEditorAiUpdate`](../tools/common/editor-single/ai/runEditorAiUpdate.js)；详见 [scene-ai-agent-iterative-improvement-memo.md](./scene-ai-agent-iterative-improvement-memo.md)。
- **工具与 ThreeJSON 对齐**：只读查询 schema（`sceneFriendlyMap`、objType 列表）、校验 `parseSceneJsonString`、可选调用 `normalizeScenePayload` 预览 canonical 形态。
- **增量修改**：`updateSceneJsonString(..., { updateMode: "incremental" })`（RFC 6902，`core/ai/scenePatch.js`）；CLI `scene update --update-mode incremental`；**默认仍为 full**。
- **纹理与生成闭环**：强化现有 `planTextures` / `fillTextureUrls` 与场景生成的编排（一键「生成场景 + 补纹理」）。
- **Provider 与可观测性**：流式输出、取消、重试、用量日志；与编辑器凭据存储策略（仅 localStorage）的安全边界。

### 2.2 AI JSON 表达式与引用语法（远期，非数据模型）

**原则（2026-06 评估）**：类 JS 算式仅作 **载入前便利语法**，由 [`sanitizeAiJsonText`](../core/ai/sceneJsonSanitize.js) / `parseSceneJsonString` 归一化为纯数字；**持久化与运行时仍为标准 JSON**。Prompt 继续要求 LLM 输出数字字面量；sanitize 作安全网。

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | 加固 sanitize（字符串感知 Math 替换、数组/嵌套算式折叠、patch 路径、全场景载入入口） | shipped |
| **P1** | 文档声明「AI 载入容忍类 JS 算式，落盘归一化」 | idea |
| **P2** | `${}` 数值表达式 token（仅 ingest，不进持久化） | idea |
| **P3** | 对象属性引用（`name.width` / `@threeJsonId`）— **不进 JSON 本体**；优先 commands / `object.align` 等 editor op | parked |

跨对象尺寸关系：用 **AI 调整 commands** 或未来 **editor 命令**，勿在 worldInfo / RFC6902 内嵌引用。

### 2.4 AI 调整：自动附带上下文（2026-06）

编辑器 [`onAiUpdateClick`](../scene-editor.html) 读取 **nested canonical**（`getScenePayloadJsonTextForPersistence()`）；Code/侧栏展示仍用 `getScenePayloadJsonTextForPersistViewEdit()`（subSceneList 等展示 layout）。**写入 LLM user message 的范围** 因输出模式而异：

| 输出模式 | 默认附带 | 「附带空间摘要」 | 「附带完整 JSON」 |
|----------|----------|------------------|-------------------|
| **命令 / 自动** | `Scene objects`（`scene.list`：id/名称/类型）、当前选中项 descriptor | 勾选后以 **Object spatial summary** + **Scene scale profile** 等**替代**薄 objectList（[`sceneSpatialContext.js`](../tools/common/editor-single/ai/sceneSpatialContext.js)） | 勾选后附加完整场景 JSON（可与空间摘要并存；侧栏提示摘要为可选补充） |
| **JSON 全量 / 增量** | 始终完整当前场景 JSON | **无关** | **无关** |

空间摘要数据结构示例：`geometrySummary`（如 `box 30×40×20`）、`footprint`、参考锚点与 Placement hints（缺省建议，**用户 modification request 优先**）。

**单轮命令**：禁止 `object.get` / `scene.list`；可输出变更命令、`camera.fit`（仅视角）、空脚本（用户要求不修改）。  
**Agent 多轮**：中间轮可 `object.get`；末轮须变更命令、视角调整或 JSON。  
**用户提示词优先**：尺度匹配、放置提示等为缺省；与用户明确意图冲突时遵循用户原文。

### 2.3 编辑器左侧面板（Phase E 部分完成）

- **已完成**：AI 配置「启用 Agent」「思考深度」「迭代应用到画布」+ `onProgress`（含 `stage_preview` / `commands_applied`）；AI 调整接阶段 auto-load；**增量更新**、**流式预览**、**中止**（均默认关）。
- **待做**：生成路径分步 preview（Phase 2）、步骤列表 UI、与全屏 JSON 联动。
- 与右侧 **JSON** 子标签 / 未来 **全屏 JSON 模式**（见 [scene-editor-ui-memo.md §四](./scene-editor-ui-memo.md#四场景-json-全屏编辑模式待评估)）联动：生成结果写入侧栏或全屏编辑器而非仅静默换场景。
- 错误与校验失败时展示 `extractJsonText` / 校验器返回的定位信息。

---

## 三、待评估问题

| 维度 | 问题 |
|------|------|
| **必要性** | 现有「提示词 → 全量 JSON → 载入」是否满足多数用户；agent 复杂度是否值得维护。 |
| **可行性** | 浏览器内 agent 循环的延迟与 API 费用；大场景 JSON 上下文窗口限制。 |
| **安全** | API Key 仅存本地；agent 工具是否允许写文件、请求任意 URL。 |
| **测试** | `core/ai` 单元测试 + 可选 mock LLM；编辑器 E2E 仅保留 smoke。 |
| **文档** | [`core/ai/SKILL.md`](../core/ai/SKILL.md)、[`docs/zh/api.md`](../docs/zh/api.md) 与示例页 — **2026-06 AI Skill 对齐已落地**；见 [archive/ai-skill-gap-matrix.md](./archive/ai-skill-gap-matrix.md)。 |

---

## 四、相关索引

| 资源 | 路径 |
|------|------|
| AI 模块 README | [`core/ai/README.md`](../core/ai/README.md) |
| 场景生成服务 | [`core/ai/sceneAiService.js`](../core/ai/sceneAiService.js) |
| Skill / 系统提示 | [`core/ai/threeJsonCoreSkill.js`](../core/ai/threeJsonCoreSkill.js) |
| AI JSON sanitize（载入安全网） | [`core/ai/sceneJsonSanitize.js`](../core/ai/sceneJsonSanitize.js) |
| 编辑器右栏 UI 备忘 | [scene-editor-ui-memo.md](./scene-editor-ui-memo.md) |
| 外置 Agent README | [`tools/threejson-agent/README.md`](../tools/threejson-agent/README.md) |
| setting 示例（参考 schema） | [`examples/script/setting.example.json`](../examples/script/setting.example.json) |
| agent 配置示例 | [`tools/threejson-agent/setting.example.json`](../tools/threejson-agent/setting.example.json) |
| MCP 配置示例 | [`tools/mcp-threejson/setting.example.json`](../tools/mcp-threejson/setting.example.json) |
| Lab 总索引 | [README.md](./README.md) |
