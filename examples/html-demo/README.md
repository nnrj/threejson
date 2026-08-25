# html-demo 导入说明

[中文](./README.md)

在**仓库根目录**启动静态 HTTP 服务后打开本目录下页面（勿用 `file://`）。

## 标准 import map（大多数 demo）

与 npm 包名一致，在页面 `<script type="importmap">` 中增加：

```html
<script type="importmap">
{
  "imports": {
    "threejson/runtime": "/core/runtime.js",
    "three": "https://esm.sh/three@0.184.0",
    "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
    "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0"
  }
}
</script>
```

模块脚本示例：

```js
// 普通 JSON 场景：最小运行时，不引入 AI、编辑器、归档或业务 domain 聚合面
import { createJsonScene } from "threejson/runtime";

// 需要 door / cabinet 等内置业务 domain 时，再映射并导入聚合入口
import { createJsonScene, door } from "threejson";
```

| import map 键 | 物理文件 | npm |
|---------------|----------|-----|
| `threejson/runtime` | `/core/runtime.js` | `threejson/runtime` |
| `threejson` | `/builtins/full.js` | `threejson` |
| `threejson/core` | `/core/index.js` | `threejson/core` |

路径以**站点根**为准（与 `/assets/...` 相同）。

表中的 `threejson` 与 `threejson/core` 是兼容聚合入口，不属于最小 import map。可选能力也只在实际使用时增加映射：

| 场景能力 | import map 依赖 |
|---|---|
| `.tjz` 归档 | `fflate` |
| GIF 纹理 | `gifuct-js` |
| HTML `infoPanel` | `html2canvas-pro` |
| CSG（`joins` / `inters` / `holes`） | `three-bvh-csg` + `three-mesh-bvh` |
| SDF 场景文字 | `troika-three-text` |

普通 JSON 场景不需要加载 `.tjz` 压缩实现，也不需要在 import map 中配置 `fflate`。
只有页面显式调用归档 API 时，才增加独立入口和依赖：

```html
<script type="importmap">
{
  "imports": {
    "threejson/archive": "/core/archive/index.js",
    "fflate": "https://esm.sh/fflate@0.8.3"
  }
}
</script>
```

```js
import { packTjzArchive, parseTjzArchiveForScene } from "threejson/archive";
```

为兼容已有代码，`threejson` 与 `threejson/core` 仍提供同名归档 API，但会在首次调用时
动态加载压缩模块；裸 ESM 页面实际调用这些兼容 API 时同样需要映射 `fflate`。

## 拆开导入（教学页）

[`track-00-runtime/00-05-import-paths.html`](./track-00-runtime/00-05-import-paths.html) 演示相对路径，**不**使用上表中的 `threejson` 别名：

```js
import { createJsonScene } from "../../../core/index.js";
import "../../../builtins/register.js";
// 命令式 API 还可：import { openOrCloseDoor } from "../../../domains/door/index.js";
```

- `builtins/register.js`：注册全部内置 domain（JSON 里 `domainModelList`、`wind` 等需要）。
- 不建议新增 `domains/index.js` 扁平 `export *`：多域 API 存在同名（如 `addToScene`），请用 `door.*` 简写（`threejson`）或 `businessDomains.door.*` 或单域文件。

## 目录与 catalog

教程索引由根目录 [`demo.html`](../../examples/html-demo/demo.html) 按语言加载一份完整 catalog（经 [`demo-i18n.js`](./demo-i18n.js)）：

- [`demo-catalog.zh.json`](./demo-catalog.zh.json) — 中文（含 path、docLinks、标题说明等全部字段）
- [`demo-catalog.en.json`](./demo-catalog.en.json) — 英文（结构须与中文版一致，文案为英文）

维护后运行 `npm run validate:demo-catalog` 校验两份 catalog 的结构字段一致（`docLinks.href` 允许 zh/en 不同）。新增 `docs/*.md` 链接后，可运行 `node tools/dev/build/localize-demo-catalog-en-doc-hrefs.mjs` 刷新英文 catalog 的 `docs/en/` 路径。

- Track 0–7 对应 `track-00-runtime/` … `track-07-text/`

## tutorial 尺度约定

html-demo 教程 JSON（[`assets/json/tutorial/`](../../assets/json/tutorial/)）**实践中**多数按 **约 1 世界单位 ≈ 1 米** 编写，便于与 room-show 等业务场景对齐。**这是 demo 惯例，不是 ThreeJSON 引擎的全局规定**——引擎契约仍为「单位由调用者场景约定决定」（见 [`docs/zh/json-format.md`](../../docs/zh/json-format.md)）。

| 建议 | 说明 |
|------|------|
| infoPanel 世界宽 | 约 **12–20**（勿把 `panelWidth` 当贴图像素宽；纹理 canvas 默认 `max(100, panelWidth)`） |
| css3dPanel | `width` / `height` 为 **DOM 像素**；`panelWidth` 为 **世界宽**（如 t04-06 约 3、t04-07 约 12） |
| 取整 | 缩放后 world 坐标、geometry 尺寸尽量用 **整数** |

**例外（数值 intentionally 保持较大或非米制）**：

- [`02-05-scene-background.json`](../../assets/json/tutorial/track-02/02-05-scene-background.json) — 太阳系教学比例（见该 JSON 根级 `remark`）
- [`02-01-heatmap-wind.json`](../../assets/json/tutorial/track-02/02-01-heatmap-wind.json)、[`02-09-particle-emitter-gpu.json`](../../assets/json/tutorial/track-02/02-09-particle-emitter-gpu.json)、[`02-10-particle-v2-sources.json`](../../assets/json/tutorial/track-02/02-10-particle-v2-sources.json) — 大场景粒子 / 热力 / Particle V2
- [`04-03-fps-walk.json`](../../assets/json/tutorial/track-04/04-03-fps-walk.json)、[`04-04-fps-player-rig.json`](../../assets/json/tutorial/track-04/04-04-fps-player-rig.json)、[`04-05-fps-rapier-collision.json`](../../assets/json/tutorial/track-04/04-05-fps-rapier-collision.json) — FPS 漫游尺度
- [`roomShow.json`](../../assets/json/roomShow.json)、[`portShow.json`](../../assets/json/portShow.json) 及对应业务页 — 不随 tutorial 批量缩放

## 资源回收示例

- [`track-00-runtime/00-06-resource-reclaimer.html`](./track-00-runtime/00-06-resource-reclaimer.html)
  - 展示“零接入也可运行”：仅 `createJsonScene` + `runtime.dispose()` 即可。
  - 展示“可选手动回收”：按 `threeJsonId` 调用 `disposeByThreeJsonId(...)` 删除对象。
