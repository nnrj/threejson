# Three.js 版本兼容（core/compat）

ThreeJSON **core** 针对 peer 主版本 Three.js（当前 **r184**）实现。接入较旧 Three 时，由 `core/compat/` 按 **revision** 做行为适配。

## 版本矩阵（源码：`core/compat/threeRevisionMatrix.js`）

| 类别 | revision | 说明 |
|------|----------|------|
| **native** | `184` | 与 core 1:1，不走 compat |
| **compat** | `179` … `183` | 通过 compat adapter（TransformControls 等） |
| **unsupported** | `≤178` 及其它 | `console.warn`，不保证行为 |

**正式最低支持 revision：r179**（`three >= 0.179.0`）。与依赖 `three-bvh-csg@0.0.18` 的 peer 范围一致。

查询 API（`core/index.js` 导出）：

- `getThreeJsonNativeRevisions()`
- `getThreeJsonCompatRevisions()`
- `getThreeJsonMinSupportedRevision()`
- `getThreeJsonPrimaryRevision()`
- `resolveEffectiveThreeRevision({ three, sceneJsonRoot, sceneConfig, worldInfo })`
- `getThreeRevisionCompatibility(revision)`
- `warnIfUnsupportedThreeRevision(ctx)`（场景加载时自动调用）

## 有效 revision 解析顺序

1. `sceneConfig.threeRevision`（友好 JSON 可写入 sceneConfig）
2. `worldInfo.threeRevision`
3. 运行时 `THREE.REVISION`
4. 缺省 → `THREEJSON_PRIMARY_REVISION`（184），视为 native

若声明 revision 与运行时 `THREE.REVISION` 不一致，会 `console.warn`，**以声明值**选 compat（用于测试）。

## JSON 灯光

在 **native（r184）** 与 **compat（r179–183）** 上，`lightList` / `sceneConfig.lights` 的 `intensity` 应为物理单位，并建议显式标注：

- 平行光：`"unit": "lux"`
- 点光 / 聚光：`"unit": "candela"`

**不会**再对任意小数字自动乘常数。示例页（如 `room-show.html`）直接在 HTML 里写物理强度即可。

## Adapter 分段

`getCompatAdapter(revision)` 按 **有效 revision**（见上文解析顺序）选择 adapter，**与矩阵 tier 无关**：正式矩阵外的 revision（如 r170）在 warn 之后仍会走下列最接近分段，作为 **best-effort**，不视为官方支持。

| revision | 模块 | 差异 |
|----------|------|------|
| ≤154 | `adapters/baseline153.js` | 非物理光；`unit: lux/candela` 向下换算 |
| 155–168 | `adapters/r155lights.js` | 物理光（同 native 解析） |
| 169–183 | `adapters/r169controls.js` | 灯光同 r155；TransformControls 见 `attachTransformControlsHelper` |
| ≥184 | `adapters/latest.js` | 透传 |

## 地板 domain

机房地板请使用 `objType: "floor"`（[`domains/floor`](../domains/floor/index.js)），`material.type` 使用 `"standard"`。不要使用已废弃的 `material.type: "floor"`。

---

## 特殊需求：执意使用 r153–r178（非官方支持）

ThreeJSON **不**在 core 或默认 importmap 中维护 r153–r178 矩阵或 CSG 双版本。若你仍要在 **unsupported** 区间试验（自担风险），常见做法是：

1. **升级 Three.js 到 r179+**（推荐）。
2. 若无法升级 Three，仅在 **宿主工程** 侧调整依赖决议，使 core 内不变的 `import 'three-bvh-csg'` 解析到较旧实现。

### CSG：`three-bvh-csg` overrides

core 固定从裸说明符 `three-bvh-csg` 导入（[`modelHandler.js`](../core/handler/modelHandler.js)、[`holeSceneOps.js`](../core/handler/holeSceneOps.js)）。默认依赖为 **0.0.18**（peer `three >= 0.179`）。在 **r153–r178** 上，可尝试在 **你的项目** 将解析指向 **0.0.17**（peer `three >= 0.151`，需配套较旧的 `three-mesh-bvh`，例如 0.6.x）。

**import map（浏览器 ESM）示例**（将 `0.170.0` 换成你的 Three 版本）：

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.170.0",
    "three/examples/jsm/": "https://esm.sh/three@0.170.0/examples/jsm/",
    "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.6.8?deps=three@0.170.0",
    "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.17?deps=three@0.170.0,three-mesh-bvh@0.6.8"
  }
}
</script>
```

**npm / pnpm overrides 示例**（`package.json`）：

```json
{
  "overrides": {
    "three-bvh-csg": "0.0.17",
    "three-mesh-bvh": "0.6.8"
  }
}
```

说明：

- **不必修改 ThreeJSON 源码**；换的是宿主对 `three-bvh-csg` 的解析结果。
- **不保证** r153–r178 全功能可用（例如 r152 缺少 `OutputPass` 会导致后处理链 import 失败；r151 的 `Texture.colorSpace` 与 today core 不一致等）。
- 若同时使用 **meshBvh 拾取**（`sceneConfig.pick.meshBvh`）与 legacy CSG，可能需在同一页面协调 **两套** `three-mesh-bvh` 版本；建议仅在 unsupported 区间做 PoC，不作为生产默认。
- 官方矩阵与测试仅覆盖 **r179–r184**。

### 其它依赖

- `three`：须满足你选用的 `three-bvh-csg` / `three-mesh-bvh` peer，且满足 core 对 examples/jsm（如 `OutputPass` 自 r153 起）的硬依赖。
- 完整 import map 基线见 [`doc/quick-start.md`](./quick-start.md)。
