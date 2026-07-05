# fps-walk（第一人称漫游扩展）

可选扩展：在 core 已提供 `controls.type: "firstPerson"` 的前提下，用 **`floorMeshRef`** 将脚点贴到指定地板 mesh 的 AABB 顶面（比默认全场景射线更贴合业务地板命名）。

## 启用

场景级 `sceneConfig.extensions` 或 `worldInfo.extensions`（标准 JSON 可在顶层写 `extensions`，见 `assets/json/tutorial/track-04/04-04-fps-player-rig.json`）：

```json
"extensions": {
  "fps-walk": {
    "enabled": true,
    "floorMeshRef": "floor",
    "floorSnap": true
  }
}
```

地板物体须带 `refName: "floor"`（或与 `floorMeshRef` 一致）。

## 宿主集成

推荐使用统一入口（按 `controls.collision.provider` 与扩展配置自动选择 fps-walk 或 Rapier）：

```javascript
import { createJsonScene } from "threejson/core";
import { createPluginHost } from "threejson/core"; // 或 core/plugin/pluginHost.js
import { bootstrapFirstPersonExtensionsFromScene } from "../extensions/fps-walk/bootstrapFirstPersonExtensions.js";

const pluginHost = createPluginHost();
const RAPIER = (await import("@dimforge/rapier3d-compat")).default; // 仅 collision.provider === "rapier" 时需要

const rt = await createJsonScene(payload, {
  canvas,
  pluginHost,
  async onSceneReady(ctx) {
    await bootstrapFirstPersonExtensionsFromScene({ ...ctx, pluginHost, RAPIER });
  }
});
rt.start();
```

仅贴地、无 Rapier 时可省略 `RAPIER` / `pluginHost`（或只配 `extensions["fps-walk"]`）。

## 与 physics-rapier

`collision.provider: "rapier"` 的完整胶囊同步仍由 `extensions/physics-rapier` 承担；本扩展仅处理 **贴地** 增强。二者可并存时由宿主决定注册顺序（后注册的 provider 覆盖 `setCollisionProvider`）。

## 示例页

- [`examples/html-demo/track-04-interaction/04-03-fps-walk.html`](../../examples/html-demo/track-04-interaction/04-03-fps-walk.html) — 仅 core firstPerson
- [`examples/html-demo/track-04-interaction/04-04-fps-player-rig.html`](../../examples/html-demo/track-04-interaction/04-04-fps-player-rig.html) — Player Rig
- [`examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html`](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html) — Rapier 碰撞（`04-05`）
