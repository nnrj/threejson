> **归档**：flat scene graph 已落地；剩余项为历史风险记录。

# 场景图挂载与 `scene.remove` 审计备忘

**状态**：`archived`（2026-05 主问题已修复）  
**日期**：2026-05-29  
**背景**：`room-show.html` 中 `fix: false` 信息面板双击不消失；根因是 `hideAllInfoPanel` 使用 `scene.remove(model)`，而 JSON 部署的面板曾挂在 `overlayRoot` 下。已修复 `hideAllInfoPanel`（`parent.remove`）。**2026-05 后续**：业务对象与 overlay 中间层已取消，统一 flat 挂 `scene` + bucket 分类。

与 [`docs/zh/scope.md`](../docs/zh/scope.md) 无发布承诺；历史 managed roots 设计见 git 历史中的 `sceneLoadHandler.js`。

---

## 场景图约定（2026-05 后）

| 挂载点 | 用途 |
|--------|------|
| `scene` | 全部可注册 `Object3D`（内容、灯光、assist helper、viewmodel pivot 等） |
| 相机子节点 | ambient 音频、`AudioListener` |

分类与批量清理走 **systemBucket / customBucket** 索引，不再依赖 `overlayRoot` / `baseRoot` 等 Group 容器。

`extractModelList` / `scene.traverse` 能遍历整棵子树；**`scene.remove(x)` 仅当 `x.parent === scene` 时有效**。

正确移除模式（项目内已有范例）：

- [`disposeObjectTree`](../core/handler/sceneLoadHandler.js)：`root.parent.remove(root)`
- [`destroyModelByType`](../core/handler/modelHandler.js)：`model.parent.remove(model)`，fallback `scene.remove`
- [`ResourceTracker.dispose`](../core/handler/resourceReclaimer.js)：`resource.parent.remove(resource)`

---

## 已修复（2026-05-29）

| 项 | 说明 |
|----|------|
| `hideAllInfoPanel` | 改为 `parent.remove`；`room-show` 双击空白时也会调用 hide |

---

## 仍存在的同类风险（搁置前记录）

### 高：编辑器删除

- **位置**：[`scene-editor.html`](../scene-editor.html) → `handleDelete` 使用 `scene.remove(row)`
- **原因**：`refreshMeshList` 经 `scene.traverse` 收集 Mesh，对象常在 `overlayRoot` 下
- **建议**（待做）：`disposeObjectTree(row)` 或 `row.parent?.remove(row)`

### 低：碰撞辅助线清理

- **位置**：[`modelHandler.js`](../core/handler/modelHandler.js) → `clearImpactCheck` / `clearImpactBox3` 在 `traverse` 内 `scene.remove(subObj)`
- **现状**：`impactHandler` 用 `scene.add(subBoxHelper)`，当前有效
- **建议**（待做）：改为 `subObj.parent?.remove(subObj)`，避免日后 BoxHelper 挂到模型子树时失效

### 低：挖洞恢复

- **位置**：[`holeSceneOps.js`](../core/handler/holeSceneOps.js) → `resetHoleByOrigin` 中 `scene.remove(holeWall)`；`deployHoleReplacement` 用 `scene.add(holeWall)`，与 remove 一致
- **副作用**：`scene.add(originWall)` 可能把原墙从 `overlayRoot` **提到 scene 根**（reparent），属分层一致性问题，非 remove 静默失败

### 无风险（成对挂 scene 根）

- [`boxEdgeHelper.js`](../core/util/boxEdgeHelper.js)：`scene.add` / `scene.remove` 成对
- [`util.js`](../core/util/util.js) `cloneSceneGraphForNativeExport`：仅摘 `parent === scene` 的直接子节点（有意为之）

---

## 挂载不一致（产品/架构，非单纯 remove bug）

| 现象 | 说明 |
|------|------|
| 信息面板双父级 | JSON 加载 → `overlayRoot`；`room-show` / `port-show` 的 `refreshInfoPanelList`、`objInfoShow` → **`scene` 根** |
| 编辑器 `objInfoShow` | 新物体部署用 `getEditorDeployRoot()`（overlay），临时面板仍 `deployInfoPanel(scene, …)` |
| 展示页双击空白 | 仅 `room-show` 在 `!currObj` 时 `hideAllInfoPanel`；`port-show` / `scene-player` / `scene-editor` 未对齐 |

**搁置范围**：统一 deploy 父节点、编辑器删除、挖洞 reparent、展示页交互对齐——**不在当前里程碑处理**。

---

## 其它说明

- **异步**：`html2canvas-pro` 渲染未完成时 hide，Promise 完成后仍 `add` 面板——与 `parent.remove` 无关的竞态，需单独 token/取消策略时再议。
- **建议工具函数**（将来可选）：`detachObject3D(obj, fallbackRoot)`，全项目 remove 统一入口。

---

## 重新立项条件

- 用户报告「删除/关闭/清理」在 TJZ 或 overlay 场景下仍失效；或
- 统一 `overlayRoot` 为唯一业务父级的产品决策落地时，顺带修编辑器删除与 `objInfoShow` 挂载。
