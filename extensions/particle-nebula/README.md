# particle-nebula（适配器骨架）

第三方粒子库的 **adapter 示例**：演示如何通过 `registerParticleEmitterProvider` 接管 `objType: "particleEmitter"` 的 `provider` 字段，**不**进入 core 默认 bundle。

## 用法

页面 importmap 已映射 `threejson/extensions/*` 后：

```js
import { createJsonScene } from "threejson/core";
await import("threejson/extensions/particle-nebula");
```

推荐先加载 `threejson/core`，再注册 extension（与仓库其它 extension demo 一致）。`tests/module-import-order.test.mjs` 仍覆盖「extension 先于 core」历史顺序以防回退。

JSON：

```json
{
  "objType": "particleEmitter",
  "provider": "nebula",
  "simulation": "cpu",
  "count": 2000,
  "material": { "color": "#88ccff", "size": 2 }
}
```

## 行为（当前 stub）

- 注册 `provider: "nebula"` → 本适配器略调 `material.size/opacity` 后委托 **core** `deployParticleEmitterCore`
- 未 import 本扩展时，`provider: "nebula"` 会 `console.warn` 并 **回退 core**

## 接入真实库

在 `deployNebulaParticleEmitter` 内替换为第三方 API（如 nebula.js），保持 `(record, scene, ctx) => Object3D|null` 签名即可。勿在 core 中 import 该 npm 包。

## 相关 API

- `registerParticleEmitterProvider(id, deployer)` — `threejson/core`
- `deployParticleEmitterCore(record, scene, ctx)` — 跳过 provider 分发的 core 实现
