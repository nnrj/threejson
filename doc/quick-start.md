# 快速开始

[中文](./quick-start.md) | [English](./en/quick-start.md)

ThreeJSON 现在明确支持两种并列输入：

- 人类友好 JSON：`sceneConfig + typed lists + friendlyMap`
- 标准 JSON：`objectList + 顶层少量元信息`

完整示例（教程 Track 0）：

- 友好 JSON：[examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html](../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html)
- 标准 JSON：[examples/html-demo/track-00-runtime/00-04-standard-objectlist.html](../examples/html-demo/track-00-runtime/00-04-standard-objectlist.html)

教程总索引：[demo.html](../demo.html) · 课表：[tutorial.md](./tutorial.md)

## 0. 运行

请通过本地静态服务器访问页面，不建议直接用 `file://` 打开。ES Module、纹理、OBJ/GLTF 文件加载通常需要 HTTP 环境。

**在 VS Code / Cursor 中运行 HTML**

1. 使用 **VS Code** 或 **Cursor** 打开本项目根目录。
2. 在扩展市场安装 **Live Server** 插件。
3. 右键需要预览的 `.html` 文件，选择 **Open with Live Server**。
4. 浏览器会通过本地 HTTP 地址打开页面。

**在 WebStorm 中运行 HTML**

1. 使用 **WebStorm** 打开本项目。
2. 在工程视图中右键 `.html` 文件，选择 **运行**。

## 1. 页面骨架

建议参考 `examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html` 或 `00-04-standard-objectlist.html`：

```html
<div id="rootContainer">
  <canvas id="canvasContainer">抱歉，你的浏览器不支持 WebGL。</canvas>
  <div id="loadingMask">3D 场景加载中...</div>
</div>
```

如果页面里会间接使用仍保留裸模块名的文件，可加入 importmap。浏览器会解析**整条依赖链**（含你从 `../core/index.js` 拉起的 core 内部 `import`），因此凡在 core 或其依赖里出现的裸说明符，都应在 import map 中有映射；例如 core 会用到 `three`、`three/examples/jsm/`、`three-mesh-bvh`、`three-bvh-csg`、`@tweenjs/tween.js`、`html2canvas-pro`、`gifuct-js` 等。

**按需说明符**（仅当场景或功能用到时才需映射，未配置时不会拖垮整页加载）：

- **`troika-three-text`** + **`fflate`**：`objType: "text"` 且 `mode: "sdf"`（默认）时懒加载；无 SDF 文字时可不写进 import map。
- **`gifuct-js`**：材质 `textureKind: "gif"` 时懒加载。

若 core 新增裸说明符，请同步补全各裸 ESM 页面的 import map（`node tools/dev/importmap/patch-gifuct-importmap.mjs` 等；Track 7 文字课保留 troika，其余教程页可用 `strip-troika-importmap.mjs` 精简）。

**Three.js 版本**：正式支持 **r179–r184**（推荐示例中的 `0.184.0`）。更低版本见 [`three-compat.md`](./three-compat.md)（含执意使用旧版时的 CSG overrides 说明）。

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.184.0",
    "three/examples/jsm/": "https://esm.sh/three@0.184.0/examples/jsm/",
    "three-mesh-bvh": "https://esm.sh/three-mesh-bvh@0.9.10?deps=three@0.184.0",
    "three-bvh-csg": "https://esm.sh/three-bvh-csg@0.0.18?deps=three@0.184.0,three-mesh-bvh@0.9.10",
    "@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0",
    "html2canvas-pro": "https://esm.sh/html2canvas-pro@2.0.4",
    "gifuct-js": "https://esm.sh/gifuct-js@2.1.2"
  }
}
</script>
```

含 **SDF 场景文字**（`objType: "text"` 默认 `mode: "sdf"`）时，在同一 `imports` 中再增加：

```json
    "fflate": "https://esm.sh/fflate@0.8.3",
    "troika-three-text": "https://esm.sh/troika-three-text@0.52.4?deps=three@0.184.0"
```

## 2. 用统一入口加载 JSON

```js
import { createJsonScene } from "../core/index.js";

const response = await fetch("/assets/json/tutorial/track-00/00-03-friendly-full-scene.json");
const sceneData = await response.json();

sceneData.canvasWidth = window.innerWidth;
sceneData.canvasHeight = window.innerHeight;

const sceneRuntime = await createJsonScene(sceneData, {
  canvas: document.getElementById("canvasContainer"),
  resetScene: true
});

sceneRuntime.start();
```

推荐优先使用 `createJsonScene()`。它会：

- 根据 runtime 配置创建 scene / camera / renderer / controls / lights / renderLoop
- 识别输入是友好 JSON 还是标准 JSON
- 先统一归一到标准 `objectList`
- 再按 `objType` 分阶段部署对象

### Vue、React（Vite）

通过 npm 安装时包名为 **`threejson`**，并安装 [`package.json`](../package.json) 中 `peerDependencies` 所列版本（`three`、`@tweenjs/tween.js`、`html2canvas-pro` 等）。Vite 会从 `node_modules` 解析裸模块名，无需 import map。

仓库内提供最小可运行示例（在对应子目录执行 `npm install` 与 `npm run dev`）：

- [`examples/vue-app`](../examples/vue-app)
- [`examples/react-app`](../examples/react-app)

要点：

- **Vue**：在 `onMounted` 中取 `canvas` 引用并 `await createJsonScene(..., { canvas })` 后 `start()`；在 `onBeforeUnmount` 中调用返回值的 `stop()` 与 `dispose()`。
- **React**：用 `useRef` 持有 canvas；在 `useEffect` 中异步初始化；在 effect 清理函数中 `stop()` / `dispose()`。若开启 **StrictMode**，开发环境下 effect 会执行两次，异步完成时需用「已卸载」标志避免对已释放实例重复操作（示例见 `react-app/src/App.tsx`）。
- **资源路径**：可将场景 JSON 放在应用的 `public/`（示例中 `public/demo-assets/scene/` 与 `public/demo-assets/textures/`，JSON 内使用以 `/` 开头的站点根路径如 `/demo-assets/...`）；`vite.config.ts` 中的 `server.fs.allow` 仍用于解析已链接到仓库根的 `threejson` 包，与演示资源是否放在 `public/` 无关。

### 静态资源与 CDN（npm）

通过 **`npm install threejson`** 使用时，内置 domain 与场景 JSON 中的 `/assets/textures/...` 等路径**默认**解析到 jsDelivr [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets)（版本见 `ASSETS_PACKAGE_VERSION`）。一般**无需**单独安装资源包。

本地开发或自托管时覆盖基址：

```js
import { createJsonScene, LOCAL_ASSETS_BASE, setAssetsBaseUrl } from "threejson";

setAssetsBaseUrl(LOCAL_ASSETS_BASE);

await createJsonScene(sceneData, {
  canvas,
  assetsBase: "/assets",
  resetScene: true
});
```

亦可在 JSON 中写 `sceneConfig.assetsBase`。详见 [`api.md` 静态资源](./api.md#静态资源coreutilassetsbasejs)、[`json-format.md` 的 sceneConfig.assetsBase](./json-format.md#sceneconfigassetsbase-可选静态资源基址)。

克隆本仓库跑 HTML demo 时，页面已传 `assetsBase: "/assets"`，需从**仓库根**起静态服务。

## 3. 友好 JSON 最小示例

```json
{
  "name": "friendly-scene",
  "friendlyMap": {
    "glassList": {
      "objType": "glass",
      "defaults": {
        "material": {
          "type": "standard",
          "transparent": true,
          "opacity": 0.35
        }
      }
    }
  },
  "sceneConfig": {
    "scene": { "background": "#222222" },
    "camera": { "fov": 60, "position": { "x": 180, "y": 120, "z": 220 } },
    "renderer": { "antialias": true },
    "controls": { "enableDamping": true, "target": { "x": 0, "y": 30, "z": 0 } },
    "lights": [
      { "type": "ambient", "color": "#ffffff", "intensity": 0.45 }
    ],
    "renderLoop": { "autoResize": true, "firstAutoResize": true }
  },
  "worldInfo": {
    "boxModelList": [
      {
        "name": "main-box",
        "objType": "box",
        "geometry": { "width": 80, "height": 80, "depth": 80 },
        "position": { "x": -60, "y": 40, "z": 0 },
        "material": { "type": "standard", "color": "#409eff" }
      }
    ],
    "glassList": [
      {
        "name": "glass-box",
        "geometry": { "width": 70, "height": 100, "depth": 70 },
        "position": { "x": 60, "y": 50, "z": 0 },
        "material": { "color": "#67c23a" }
      }
    ],
    "infoPanelList": [
      {
        "text": "hello friendly json",
        "type": "text",
        "panelBoxType": "sprite"
      }
    ]
  }
}
```

要点：

- `sceneConfig` 负责 runtime
- `worldInfo.*List` 负责按认知分组内容对象
- `friendlyMap` 可把自定义列表映射到标准 `objType`，并声明默认字段
- 固定语义列表里的单条记录通常可省略 `objType`

## 4. 标准 JSON 最小示例

```json
{
  "name": "standard-scene",
  "canvasWidth": 1920,
  "canvasHeight": 1080,
  "objectList": [
    { "objType": "scene", "background": "#222222" },
    { "objType": "camera", "fov": 60, "position": { "x": 180, "y": 120, "z": 220 } },
    { "objType": "renderer", "antialias": true },
    { "objType": "controls", "enableDamping": true, "target": { "x": 0, "y": 30, "z": 0 } },
    { "objType": "light", "type": "ambient", "color": "#ffffff", "intensity": 0.45 },
    { "objType": "renderLoop", "autoResize": true, "firstAutoResize": true },
    {
      "name": "main-box",
      "objType": "box",
      "geometry": { "width": 80, "height": 80, "depth": 80 },
      "position": { "x": 0, "y": 40, "z": 0 },
      "material": { "type": "standard", "color": "#409eff" }
    }
  ]
}
```

标准 JSON 更适合：

- 程序生成或 AI 生成
- 做内部 IR / 调试对照
- 希望所有记录都统一走单列表与 `objType` 分发

## 5. 尺寸变化与清理

```js
window.addEventListener("resize", () => {
  sceneRuntime.resize({
    width: window.innerWidth,
    height: window.innerHeight
  });
});

window.addEventListener("beforeunload", () => {
  sceneRuntime.dispose();
});
```

## 6. 该选哪种 JSON

- 人类手改、业务分组阅读优先：选友好 JSON
- 程序输出、AI 输出、标准化对接优先：选标准 JSON
- 无论输入哪种，底层都会先统一为标准 `objectList` 再解析
