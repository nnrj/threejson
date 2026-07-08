# 场景编辑器 — 事件脚本工作区与目录树 / 多标签（V2 备忘）

**版本**：V2（2026-06-28）  
**状态**：`deferred` — **本期不做**；待 Core 运行时事件机制（[scene-event-mechanism-evaluation.md §10](./scene-event-mechanism-evaluation.md) + 工程讨论稿 `core_event_mechanism_v2_88159f7d.plan.md`，工作区 `.cursor/plans/` 私有）落地后，再单独立项讨论与实现。  
**关联**：

- 事件机制 lab（V2 产品大纲）：[scene-event-mechanism-evaluation.md §10](./scene-event-mechanism-evaluation.md)
- 事件机制 engineering Plan（私有）：`core_event_mechanism_v2_88159f7d.plan.md` — **本期主线**；本文 **不在其 M1–M6 scope 内**
- 编辑器 UI 备忘（V1）：[scene-editor-ui-memo.md](./scene-editor-ui-memo.md) §八（多场景多标签，与本备忘 **不同层级**）
- 编辑器壳：[`scene-editor.html`](../scene-editor.html)、[`tools/scene-host/editor/index.html`](../tools/scene-host/editor/index.html)

本页为 **VB6 式事件脚本编辑体验** 的编辑器壳层备忘，**不代表当前里程碑**；与 [`docs/zh/scope.md`](../docs/zh/scope.md) 的 Core 承诺区分。

---

## 0. 与本期主线的边界

| 本期（事件机制 M1–M6） | 本备忘（deferred） |
|------------------------|-------------------|
| core 事件能力表、Dispatcher、DSL、Timer | 脚本 **目录树**、**多标签** 文档栏 |
| 右侧 **轻量** 事件管理器（事件下拉 + textarea + `lib://` picker） | **脚本工作区**（左树 + 顶 tab + 中央 DSL CodeMirror） |
| assetLibrary **`eventScript`** + 资源库 CRUD | 左栏 AI 合并、配置迁设置 |
| player/editor 预览走 dispatcher | 第三种编辑器视图（3D \| Code(JSON) \| **脚本**） |

**原则**：脚本一多、要 VB6/IDE 级体验时，再开本文工作区；**不阻塞** core 事件机制交付。

---

## 1. 动机

引入 JSON 事件机制后，场景内会有大量 **事件脚本**（内联 `events.*.script`、`scriptUrl`、`lib://` + `assetLibrary.eventScript`）。仅靠在右侧属性区小 textarea 编辑，难以支撑：

- 多对象、多事件并行维护
- 长脚本、定时器编排
- 与 assetLibrary 脚本条目交叉引用

用户期望接近 **VB6**：能列出「哪个对象的哪个事件」，双击打开 **具名 Sub** 式编辑窗，改完保存回 JSON。

同时需与现有 **Code 模式（整份场景 JSON）**、**3D 编辑** 共存，且不重复 lab §八 的 **多场景文件** 多标签（那是对多个 JSON 工程文件的并行打开，成本更高）。

---

## 2. 两种「多标签」勿混淆

| 类型 | 含义 | 成本 | 本文 |
|------|------|------|------|
| **脚本文档 tab** | 同一 scene 内多个 event / 库脚本 buffer | 中 | **本文主角** |
| **场景文件 tab** | 并行打开多个 JSON 场景 | 高 | 见 [scene-editor-ui-memo.md §八](./scene-editor-ui-memo.md)；仍 deferred |

---

## 3. 推荐布局（讨论结论，非承诺）

```text
┌─ 菜单 / 工具栏 ─────────────────────────────────────┐
├─ [文档 Tab 栏]  openDocs > 1 时显示，否则隐藏       │
├──────────┬──────────────────────────┬──────────────┤
│ 脚本树   │  Ups01 · DblClick  (标题) │  右：场景树  │
│ (虚拟)   │  ┌─ CodeMirror (DSL) ─┐  │  属性/事件   │
│          │  └─────────────────────┘  │  资源库      │
│ 3D 主区 或 PiP（脚本焦点时可选）     │              │
└──────────┴──────────────────────────┴──────────────┘
```

### 3.1 第三种视图：「脚本 / 事件」工作区

- 与 **3D 模式**、**Code(JSON) 模式** 并列（三态切换，或脚本为 Code 的 sibling）。
- **中央**：当前打开的脚本文档；标题栏显示 **`{对象 label/refName} · {事件名}`**（VB6 `Form1_DblClick` 心智）。
- **中央左侧**：**脚本目录树**（场景 load 时 **虚拟映射**，见 §4）。
- **标题栏下方 tab**：已打开的 **脚本文档**；**仅 1 个打开时隐藏 tab 栏**。
- **CodeMirror**：语言为 **事件 DSL**（非 JSON）；CM **只作编辑器引擎**，**不**负责文件树与 tab（应用 shell 自管，同 VS Code）。

### 3.2 不建议：仅在 Code(JSON) 模式内嵌树 + CM 管 tab

- Code 模式职责是 **整份场景 JSON**（[`#codeEditorStage`](../scene-editor.html)）；事件脚本是 **patch 片段**，持久化目标不同。
- 编脚本时常需看 **3D**；Code 模式将 3D 收成 PiP，不适合作日常事件编辑主界面。
- CM6 **无**内置工程树/多标签；仍要应用层 layout，绑进 JSON Code 模式职责混乱。

### 3.3 右侧轻量入口（本期 M5 仍做）

- Plan §3.5：事件选择器 + 小 textarea + 「从资源库选择」。
- 本文工作区：**「在外部打开」/ 双击树** → 打开中央 DSL tab（渐进增强）。

---

## 4. 脚本目录树（虚拟，非必须真实文件系统）

场景 load / JSON 变更后，扫描生成树（示例结构）：

```text
Scripts/
├── assetLibrary/
│   ├── script-ups-panel-toggle    (eventScript · lib://)
│   └── script-door-hover          (eventScript · inline source)
└── objects/
    ├── UPS-01/
    │   ├── DblClick.script        (inline)
    │   └── PointerEnter.script    (scriptUrl → ./scripts/...)
    └── Door-Main/
        └── DblClick.script        (lib://script-door-toggle)
```

**节点 → 持久化映射**：

| 树节点 | 写回位置 |
|--------|----------|
| `objects/{host}/ {event}.script` | 对应 record 的 `events.{event}.script` 或 `.scriptUrl` |
| `assetLibrary/{id}` | `assetLibrary[]` 中 `assetKind: "eventScript"` 条目 |

双击节点 → 打开文档 tab；保存 → **patch** `jsonData`（`markSceneNeedsReserialize`、undo 与属性面板一致）。

**可选（远期）**：[`scene-editor-ui-memo.md §八](./scene-editor-ui-memo.md) 的文件夹 / File System Access API，与虚拟树并存。

---

## 5. 左侧面板调整（讨论方向，可与工作区分期）

当前左栏 [`leftSubTabBar`](../tools/scene-host/editor/index.html)：**组件 | AI配置 | AI生成 | AI调整 | 看图生成**（5 tab）。

**讨论方向**：

| 变更 | 说明 |
|------|------|
| **AI 配置 → 设置** | Provider / API Key / Agent 等迁入编辑器 **设置**（低频） |
| **AI 三 tab 合并 → 「AI」单 tab** | 生成、调整、看图生成同一面板内分区或子 tab |
| **可选「脚本」tab** | 精简脚本列表，点击跳到中央工作区 tab（完整树在工作区左侧） |

腾出横向 tab 位；**完整目录树不建议只挤在左 flyout 工具栏**，宽度不足。

---

## 6. 与 Code(JSON) 模式的分工

| 模式 | 编辑对象 | 语言 | 树 |
|------|----------|------|-----|
| **3D** | 场景物体 | — | 右侧场景树 |
| **Code** | 整份 `jsonData` | JSON | 可选 JSON 符号（远期）；**不做**事件脚本树 |
| **脚本工作区** | 单条 event / eventScript | DSL | **脚本虚拟树** |

JSON Code 模式中可 **跳转**：光标在 `events.dblclick` → 命令「在脚本工作区打开」（打开对应 tab）。

---

## 7. 保存 / undo / 脏状态

- 每个脚本文档 tab 持有 **binding 指针**（`threeJsonId` + `eventName` 或 `assetLibrary` index/id）。
- 保存：写回 inline `script` 或 `scriptUrl` / 库条目 `source`；**导出仍原样**（URL/`lib://` 不回填，见事件 Plan §3.2.1–§3.2.2）。
- 关闭 tab 前未保存：与 Code 模式相同 **脏确认**。
- undo：优先 **单字段 patch** 级；多 tab 并行编辑时以 **document id** 区分 undo 栈（立项时与现有 editor history 对齐）。

---

## 8. 实施分期（deferred，依赖事件机制）

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **E1** | 虚拟脚本树数据模型 + 扫描 API（editor 模块，读 `jsonData`） | core M2+ `events` schema |
| **E2** | 脚本文档 tab 栏 + 单 CM(DSL) buffer + 标题 `对象·事件` | core M3 DSL 语法高亮可选 |
| **E3** | 脚本工作区 layout（左树 + 中编辑 + 右栏保留） | E1+E2 |
| **E4** | 左侧 AI 合并 + 配置迁设置 | 独立 UI，可与 E3 并行 |
| **E5** | 右侧「在外部打开」、树双击 ↔ tab 联动 | core M5 轻量事件管理器 |
| **E6** | `.tjz` / 在线脚本 URL 在树中显示与打开 | core scriptUrl / lib:// |

**不纳入 E 阶段**：lab §八 **多场景文件 tab**（独立立项）。

---

## 9. 非目标

- 本期 **不** 为多场景并行打开做 tab（§八 仍 deferred）。
- **不** 要求 CodeMirror 插件提供文件树/标签页。
- **不** 在 core 事件机制未就绪前实现完整工作区（避免无 DSL、无 binding 的空壳 UI）。
- **不** 替代右侧 M5 轻量事件管理器（两者互补）。

---

## 10. 索引

| 资源 | 路径 |
|------|------|
| 本期主线 Plan | `core_event_mechanism_v2_88159f7d.plan.md`（`.cursor/plans/` 私有） |
| 事件 lab §10 | [scene-event-mechanism-evaluation.md §10](./scene-event-mechanism-evaluation.md) |
| 编辑器 UI V1 | [scene-editor-ui-memo.md](./scene-editor-ui-memo.md) |
| 左栏 AI | [scene-ai-enhancement-memo.md](./scene-ai-enhancement-memo.md) |
| assetLibrary 面板 | [tools/scene-host/editor/js/assetLibraryPanel.js](../tools/scene-host/editor/js/assetLibraryPanel.js) |
