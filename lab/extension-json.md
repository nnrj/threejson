# Extension JSON 约定（草案）

**状态**：`idea`（容器形状备忘；正式接入见 [`docs/zh/extensions.md`](../docs/zh/extensions.md)）

正式接入说明见 **[docs/zh/extensions.md](../docs/zh/extensions.md)**。本文保留容器形状与字段合并规则摘要。

core **不**解析具体插件字段语义；只约定容器形状，并由 `extensions/<id>/` 文档说明各键含义。

## 场景级

`sceneConfig.extensions["<extensionId>"]` — 全局参数（如启用、重力）。

友好 JSON 也可写 `worldInfo.extensions`，归一化时合并进 `sceneConfig.extensions`（`worldInfo` 优先，同 id 下 `sceneConfig` 覆盖）。

## 物体级

在同一条 `boxModelList[]` / `objectList[]` 记录上：

```json
"extensions": {
  "physics-rapier": { "rigidBody": "dynamic", "collider": { "type": "box" } }
}
```

绑定关系隐含：配置在该物体 JSON 上即作用于该物体。

## 宿主职责

1. `import` 扩展包（如 Rapier WASM）。
2. `createJsonScene(..., { onSceneReady })` 中取得 `scene` / `sceneJson` / `pluginHost`。
3. 调用扩展 bootstrap，例如 `bootstrapPhysicsRapierFromScene(ctx)`。

示例 JSON：[`assets/json/tutorial/track-04/04-02-plugin-physics.json`](../assets/json/tutorial/track-04/04-02-plugin-physics.json)。

第三方 extension 是否需与 domain 对称的标准接入（CLI / manifest）：**本期不做**；应用内复制示例或自写 bootstrap 已可行，见 [third-party-extension-adoption-memo.md](./third-party-extension-adoption-memo.md)。

## 参考实现

| 扩展 id | bootstrap | README |
|---------|-----------|--------|
| `physics-rapier` | `extensions/physics-rapier/bootstrapFromScene.js`（多刚体 + 可选 sensor collider） | [README](../extensions/physics-rapier/README.md) |

编辑器可选：`sceneConfig.pick.meshBvh` 启用 BVH 拾取（见 [`docs/zh/tools.md`](../docs/zh/tools.md) 中 settings 与 JSON 合并说明）。
