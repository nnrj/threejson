# 场景编辑器右侧面板 UI 备忘（非发布承诺）

**状态**：`idea`（待排期）  
**关联页面**：[`scene-editor.html`](../tools/old_version/scene-editor.html)  
**记录日期**：2026-05（对话备忘整理）

本页为产品/交互备忘，**不代表当前里程碑**；实现前需单独评估必要性、可行性与 JSON 写入契约。与 [`docs/zh/scope.md`](../docs/zh/scope.md) 的 Core 承诺区分。

---

## 一、子标签页改名（小改）

| 现状文案 | 目标文案 | 备注 |
|----------|----------|------|
| 场景JSON | **JSON** | 右侧 `rightSubTabSceneJson` 按钮文案；相关菜单「查看场景JSON」等是否一并缩短，实现时统一扫一遍 |
| 对象列表 | **对象** | `rightSubTabObjectList` 按钮文案；面板内卡片标题「对象列表」是否改为「对象」或保留全称，实现时定 |

当前标签顺序（约）：**场景树** → **场景JSON** → **对象列表**。

---

## 二、新增【调度】子标签页（待评估的大改）

### 2.1 位置

- 在 **【对象】** 子标签页 **左侧** 插入新标签 **【调度】**（预期顺序示例：**场景树** → **JSON** → **调度** → **对象**）。
- 需新增 `rightSubTabDeployScheduler`、`rightSubPanelDeployScheduler` 及与现有 `rightSubTabBar` / `initRightDockSubTabs` 同模式的显隐切换逻辑。

### 2.2 作用对象选择

- 提供 **下拉列表**，选择「调度策略应用到哪一层」：
  - **默认**：整个场景。
  - 第一项建议固定为 **`scene`**（表示 `sceneConfig.deployScheduler` 或场景级等价路径），放在列表最前。
  - 其余项：场景中可识别的具体对象（来源待设计：场景树节点、`meshList`、带 `threeJsonId` / `objType` 的 descriptor 等）。
- **下拉容器**：限制 **最大高度** + **纵向滚动**（对象数量可能很多）。

### 2.3 调度策略表单（GUI）

- 针对当前选中的对象，以 **图形控件** 编辑本项目已支持的部署调度配置（非新造字段，对齐运行时）。
- 配置来源参考（实现时以代码与正史文档为准）：
  - 场景级：[`sceneConfig.deployScheduler`](../docs/zh/api.md)（`createJsonScene` / `deployJsonScene` 路径）。
  - 记录级：单条 JSON 上的 `deployScheduler`（如 `mode: "immediate"` 插队）。
- 已知能力方向（摘自 [`docs/zh/api.md`](../docs/zh/api.md)，字段名以实现为准）：
  - `enabled` / `mode`（`immediate` | `scheduled`）
  - `policy`：`frameBudget`（`maxJobsPerFrame`、`maxFrameMs`）| `timeslot`（`fluxMs`、`density`）
  - `maxInFlightAsync`、`retry`（`maxAttempts`、`backoffMs`）
  - 分阶段部署与 `onDeployProgress` 为运行时行为，面板是否暴露只读说明即可
- 低层 API（若面板需校验或预览）：`resolveDeploySchedulerConfig`、`buildDeployJobs` 等（`core/index.js` / `core/runtime/deployScheduler.js`）。

### 2.4 【应用到 JSON】按钮

- 表单项 **下方** 放置 **【应用到 JSON】**。
- 点击后：将当前表单中的调度配置 **写回** 对应目标的 JSON：
  - 选中 `scene` → 更新 `sysConfig.jsonData.sceneConfig.deployScheduler`（及侧栏场景 JSON 文本缓存/脏标记策略需与现有「机位保持 / 渲染 JSON」一致）。
  - 选中具体对象 → 更新该对象在 `worldInfo` 列表或 `objectList` 中对应条目的 `deployScheduler` 字段（**映射规则待设计**）。
- 是否触发「自动渲染」、是否仅改内存不改画布，与 **JSON** 子标签页现有行为对齐，实现时统一。

---

## 三、待日后评估的问题

| 维度 | 问题 |
|------|------|
| **必要性** | 展厅/大场景是否强依赖可视化改 `timeslot`，还是手写 JSON + `roomShow.json` 已够用？ |
| **可行性** | 对象级 `deployScheduler` 与 friendly / canonical 双格式、侧栏 JSON 全量文本是否冲突；选中「场景」vs「单条 record」的 JSON 路径如何稳定定位。 |
| **对象枚举** | 下拉列表数据源：仅顶层 deploy 记录，还是包含 domain 块、实例化 box 等；与场景树选中是否联动。 |
| **默认值** | 未配置时表单展示「继承场景 immediate」还是空白；与 `resolveDeploySchedulerConfig` 合并逻辑一致。 |
| **测试** | 需补充 UI 或集成测试，或至少手工用例：`roomShow.json` 场景级 timeslot + 单条 record 插队 immediate。 |

---

## 四、场景 JSON 全屏编辑模式（待评估）

**关联**：右侧面板 **JSON** 子标签页（现状 `rightSubPanelSceneJson`、`#rightPanelSceneJsonTextarea`；另有弹层 `#sceneJsonModal` 可作参考）。

### 4.1 动机

- ThreeJSON 的语义是：**场景由 JSON 定义**，画布上的 3D 只是该 JSON 的呈现。
- 在常规布局里用户容易只关注视口，不易体会「改 JSON 即改场景」。
- 全屏 JSON 编辑模式强化 **「先文本、后场景」** 的心智模型，突出 ThreeJSON 以数据驱动场景的能力（产品表述待打磨）。

### 4.2 交互草案

| 元素 | 说明 |
|------|------|
| **进入/退出** | 自 JSON 子标签或菜单进入全屏；`Esc` 或明确按钮退出；与侧栏 JSON 文本双向同步（脏标记、`机位保持` / `自动渲染` 策略与侧栏一致）。 |
| **主区域** | 全屏 **场景 JSON** 输入区；支持 **JSON 语法高亮**（实现选型：CodeMirror / Monaco / Prism 等，注意与现有 `textarea` 的体积与许可）。 |
| **3D 小窗** | 默认将中间 **3D 场景缩为右上角小窗**（画中画），编辑 JSON 时仍可瞥见渲染结果；小窗尺寸/可拖拽/可关闭待设计。 |
| **渲染到场景** | **【渲染 JSON 到画布】**（或等价文案）置于 **右下角** 固定浮层，与全屏编辑区分离，避免与工具栏挤在顶部。 |

### 4.3 待评估

- 与现有 `sceneJsonModal`（查看/复制 JSON）是否合并为同一套全屏组件。
- 自动渲染在全屏下是否默认开启、防抖间隔是否与侧栏共用。
- 性能：大 JSON（如 `roomShow.json`）高亮与全量 `JSON.parse` 校验的卡顿。
- 无障碍：全屏焦点陷阱、屏幕阅读器对高亮编辑器的支持。

---

## 五、场景树子标签：区域高度与属性扩展（待评估）

**关联**：`#rightSubPanelSceneTree` — `#sceneTreeRoot`（场景树）与 `.sceneTreePropCard`（变换 · 名称 · 纹理等）。

### 5.1 布局

- **缩小** 场景树列表区域占用高度（或给树设 `max-height` + 内部滚动，把竖向空间让给下方）。
- **增大** 下方属性区域高度，便于后续增加更多可调字段（不限于当前名称/位姿/纹理 URL）。

### 5.2 属性扩展方向（实现时裁剪）

- 与选中节点 `userData.objJson` 对齐的常用字段：可见性、`objType`、材质摘要、`deployScheduler`（若与 §二 调度面板分工）、业务 `businessInfo` 只读展示等。
- 与 §二 **【调度】** 标签页的关系：避免同一字段两处编辑冲突；或树属性只读、调度页可写。

### 5.3 待评估

- `#rightSubPanelSceneTree` 内 flex 比例（参考已有 `#rightSubPanelSceneTree .sceneTreeCard` / `.sceneTreePropCard` 样式）。
- 属性增多后的分组（折叠面板 / 子 Tab）与「应用到对象」按钮位置。

---

## 六、实现时可顺带处理（非本备忘主范围）

- 右侧面板 **JSON** 工具栏：「机位保持」「自动渲染」已改为同一行（`.rightSceneJsonCheckboxRow`）。
- 勿在页面层重复调用 `coalesceBoxModelList`（`createJsonScene` 归一化已合并）；见 `scene-player` / `scene-editor` 的 `subInit` / `applyJsonToSysConfigLists` 注释。

---

## 七、相关索引

| 资源 | 路径 |
|------|------|
| 部署调度实现 | [`core/runtime/deployScheduler.js`](../core/runtime/deployScheduler.js) |
| API 说明 | [`docs/zh/api.md`](../docs/zh/api.md) § `sceneConfig.deployScheduler` |
| 示例 JSON | [`assets/json/roomShow.json`](../assets/json/roomShow.json)（含 `sceneConfig.deployScheduler`） |
| 左侧 AI 能力增强（core 优先） | [scene-ai-enhancement-memo.md](./scene-ai-enhancement-memo.md) |
| Lab 总索引 | [`lab/README.md`](./README.md) |

---

## 八、已延期到后续评估（2026-06）

- 文件夹打开能力：支持目录树浏览与批量管理场景资源（需评估 File System Access API 兼容性）。
- 左侧栏“文件/工具”竖向切换条：默认显示“工具”，点击“文件”切换为打开文件/目录树视图。
- 多标签编辑：在菜单栏下方增加多标签页，允许并行打开与切换多个 JSON 场景。
- **事件脚本工作区**（目录树 + 脚本文档多标签 + 脚本视图）：见 **[scene-editor-event-script-workspace-v2-memo.md](./scene-editor-event-script-workspace-v2-memo.md)**（`deferred`，依赖事件机制 core 落地后再议；与上条「多场景文件 tab」不同层）。
