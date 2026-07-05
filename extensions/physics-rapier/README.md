# Rapier 3D（浏览器）示例插件

可选扩展：**不**被 `threejson` 默认入口加载；页面需 `import` 本目录模块并 `pluginHost.register(...)`。

## 依赖

- [`@dimforge/rapier3d-compat`](https://github.com/dimforge/rapier.js)（Apache-2.0 / MIT 等，以仓库 LICENSE 为准）
- 浏览器需支持 **WebAssembly**；首次 `RAPIER.init()` 会拉取 WASM（由包或 CDN 决定）。

## 演示

- 页面：[`examples/html-demo/track-04-interaction/04-02-plugin-physics.html`](../../examples/html-demo/track-04-interaction/04-02-plugin-physics.html)（简易重力与 Rapier 碰撞；import map 指向 esm.sh；需网络）。

## API

- `createRapierBoxDropPlugin({ mesh, floorMesh?, RAPIER, gravity? })`：单地板 + 单动态体（内部调用 `createRapierScenePlugin`）。
- `createRapierScenePlugin({ entries, RAPIER, gravity? })`：多 `static`/`fixed` collider + 多 `dynamic` 刚体；`entries[].sensor` 可建 sensor collider（无业务回调，仅物理形状）。
- `bootstrapPhysicsRapierFromScene({ scene, sceneJson, pluginHost, RAPIER })`：扫描带 `extensions["physics-rapier"]` 的物体并注册场景插件。
- `bootstrapRapierFirstPersonFromScene({ scene, camera, controls, controlsConfig, pluginHost, RAPIER, ... })`：第一人称 `controls.collision.provider: "rapier"`，CharacterController + 场景 static collider。
- `addStaticCollidersFromScene(world, RAPIER, scene, options?)`：从场景 mesh 批量创建 fixed collider（供上者复用）。

JSON 示例：

- 落体/多刚体：[`04-02-plugin-physics.json`](../../assets/json/tutorial/track-04/04-02-plugin-physics.json)
- 第一人称碰撞：[`04-05-fps-rapier-collision.json`](../../assets/json/tutorial/track-04/04-05-fps-rapier-collision.json) + [`examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html`](../../examples/html-demo/track-04-interaction/04-05-fps-rapier-collision.html)

约定：[`doc/extensions.md`](../../doc/extensions.md)、[`lab/extension-json.md`](../../lab/extension-json.md)。

## 非侵入性

未注册本插件时：无 WASM、无 `World.step`、与纯 ThreeJSON 场景行为一致。
