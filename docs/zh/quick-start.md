[中文](./quick-start.md) | [English](../en/quick-start.md)

# ThreeJSON 快速入门

ThreeJSON 是一个 JSON 驱动的 Three.js 场景运行时。你把场景、相机、灯光、物体、材质、交互等写成 JSON，ThreeJSON 负责把它们部署到 Three.js 场景中。

本文只解决一个问题：如何在自己的项目里跑起第一个 ThreeJSON 场景。API 细节见 [API 文档](./api.md)，JSON 字段见 [JSON 配置](./json-format.md)。

## 1. 安装或引入

### npm 项目

```bash
npm install threejson three
```

ThreeJSON 的核心依赖是 `three`。部分能力会按需使用额外依赖：

```bash
npm install @tweenjs/tween.js html2canvas-pro fflate gifuct-js three-bvh-csg troika-three-text
```

这些包不是每个最小场景都必须用到。使用动画、截图、压缩包、GIF 纹理、CSG、文本等能力时再安装即可。

如果你的 JSON 会引用项目自带资源，可以安装可选资源包：

```bash
npm install @threejson/assets
```

ThreeJSON 默认也能通过 CDN 访问 `@threejson/assets`，但生产项目建议把资源托管到自己的 `public/assets` 或 CDN，并通过 `assetsBase` 指定。

### CDN / 原生 HTML

没有构建工具时，用浏览器原生 ES Module 和 import map：

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.184.0",
    "threejson": "https://esm.sh/threejson@0.1.0-alpha.4",
    "threejson/core": "https://esm.sh/threejson@0.1.0-alpha.4/core"
  }
}
</script>
```

不要在业务项目中引用仓库内部路径，例如 `../core/index.js`。用户侧应使用 `threejson`、`threejson/core` 这样的公开入口。

> 注意：浏览器模块、纹理、模型通常不能可靠地通过 `file://` 加载。请用本地 HTTP 服务打开页面，例如 Vite、Live Server、`npx serve`。

## 2. 最小 JSON

下面是一个完整可运行的 ThreeJSON 场景。它包含深色背景、相机、控制器、灯光和一个蓝色盒子。

```js
const sceneJson = {
  version: "next",
  name: "hello-threejson",
  sceneConfig: {
    scene: { background: "#11151b" },
    camera: {
      fov: 55,
      near: 0.1,
      far: 200,
      position: { x: 10, y: 8, z: 12 }
    },
    controls: {
      enableDamping: true,
      target: { x: 0, y: 1.5, z: 0 }
    },
    renderer: {
      antialias: true,
      ratioRate: 1
    },
    lights: [
      { type: "ambient", color: "#ffffff", intensity: 0.8 },
      {
        type: "directional",
        color: "#ffffff",
        intensity: 1.2,
        position: { x: 10, y: 16, z: 12 }
      }
    ],
    renderLoop: {
      autoResize: true,
      firstAutoResize: true
    }
  },
  worldInfo: {
    boxModelList: [
      {
        threeJsonId: "box-1",
        name: "Box",
        objType: "box",
        geometry: { width: 3, height: 3, depth: 3 },
        position: { x: 0, y: 1.5, z: 0 },
        material: { type: "standard", color: "#5470c6" }
      }
    ]
  }
};
```

`worldInfo` 是面向人类的友好 JSON 写法，适合手写示例。程序或 AI 生成推荐使用结构统一的标准 `objectList`；ThreeJSON 加载时会归一化这两种格式。

## 3. 原生 HTML

创建 `index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ThreeJSON Demo</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
    #stage { width: 100vw; height: 100vh; display: block; background: #11151b; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.184.0",
      "threejson": "https://esm.sh/threejson@0.1.0-alpha.4"
    }
  }
  </script>
</head>
<body>
  <canvas id="stage"></canvas>

  <script type="module">
    import { createJsonScene } from "threejson";

    const sceneJson = {
      version: "next",
      sceneConfig: {
        scene: { background: "#11151b" },
        camera: { fov: 55, near: 0.1, far: 200, position: { x: 10, y: 8, z: 12 } },
        controls: { enableDamping: true, target: { x: 0, y: 1.5, z: 0 } },
        renderer: { antialias: true },
        lights: [
          { type: "ambient", color: "#ffffff", intensity: 0.8 },
          { type: "directional", color: "#ffffff", intensity: 1.2, position: { x: 10, y: 16, z: 12 } }
        ],
        renderLoop: { autoResize: true, firstAutoResize: true }
      },
      worldInfo: {
        boxModelList: [
          {
            threeJsonId: "box-1",
            objType: "box",
            geometry: { width: 3, height: 3, depth: 3 },
            position: { x: 0, y: 1.5, z: 0 },
            material: { type: "standard", color: "#5470c6" }
          }
        ]
      }
    };

    const runtime = await createJsonScene(sceneJson, {
      canvas: document.querySelector("#stage"),
      resetScene: true,
      assetsBaseMode: "cdn-first"
    });

    runtime.start();
    window.addEventListener("beforeunload", () => runtime.dispose());
  </script>
</body>
</html>
```

启动一个静态服务：

```bash
npx serve .
```

然后在浏览器打开命令行输出的地址。

## 4. React

> 仓库内已经内置了可直接运行的 Vue / React 示例工程：`examples/vue-app`、`examples/react-app`。它们是各自独立的 Vite 项目，需要在终端进入子目录安装依赖并启动开发服务器；ThreeJSON Demo 首页中央的 iframe 无法嵌套运行独立 Vite 应用，所以这两个示例不会出现在 iframe 预览里：
>
> ```bash
> cd examples/vue-app && npm i && npm run dev
> cd examples/react-app && npm i && npm run dev
> ```

以 Vite React 为例：

```bash
npm create vite@latest threejson-react -- --template react
cd threejson-react
npm install
npm install threejson three
npm run dev
```

组件代码：

```jsx
import { useEffect, useRef } from "react";
import { createJsonScene } from "threejson";

const sceneJson = {
  version: "next",
  sceneConfig: {
    scene: { background: "#11151b" },
    camera: { position: { x: 10, y: 8, z: 12 }, fov: 55, near: 0.1, far: 200 },
    controls: { enableDamping: true, target: { x: 0, y: 1.5, z: 0 } },
    lights: [{ type: "ambient", intensity: 1 }],
    renderLoop: { autoResize: true, firstAutoResize: true }
  },
  worldInfo: {
    boxModelList: [
      {
        threeJsonId: "box-1",
        objType: "box",
        geometry: { width: 3, height: 3, depth: 3 },
        position: { y: 1.5 },
        material: { type: "standard", color: "#5470c6" }
      }
    ]
  }
};

export default function ThreeJsonCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    let runtime;
    let disposed = false;

    createJsonScene(sceneJson, {
      canvas: canvasRef.current,
      resetScene: true,
      assetsBaseMode: "cdn-first"
    }).then((nextRuntime) => {
      if (disposed) {
        nextRuntime.dispose();
        return;
      }
      runtime = nextRuntime;
      runtime.start();
    });

    return () => {
      disposed = true;
      runtime?.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block" }} />;
}
```

## 5. Vue

以 Vite Vue 为例：

```bash
npm create vite@latest threejson-vue -- --template vue
cd threejson-vue
npm install
npm install threejson three
npm run dev
```

组件代码：

```vue
<template>
  <canvas ref="canvasRef" class="stage"></canvas>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { createJsonScene } from "threejson";

const canvasRef = ref(null);
let runtime = null;

const sceneJson = {
  version: "next",
  sceneConfig: {
    scene: { background: "#11151b" },
    camera: { position: { x: 10, y: 8, z: 12 }, fov: 55, near: 0.1, far: 200 },
    controls: { enableDamping: true, target: { x: 0, y: 1.5, z: 0 } },
    lights: [{ type: "ambient", intensity: 1 }],
    renderLoop: { autoResize: true, firstAutoResize: true }
  },
  worldInfo: {
    sphereModelList: [
      {
        threeJsonId: "sphere-1",
        objType: "sphere",
        geometry: { radius: 2, widthSegments: 32, heightSegments: 16 },
        position: { y: 2 },
        material: { type: "standard", color: "#73c0de" }
      }
    ]
  }
};

onMounted(async () => {
  runtime = await createJsonScene(sceneJson, {
    canvas: canvasRef.value,
    resetScene: true,
    assetsBaseMode: "cdn-first"
  });
  runtime.start();
});

onBeforeUnmount(() => {
  runtime?.dispose();
});
</script>

<style scoped>
.stage {
  width: 100vw;
  height: 100vh;
  display: block;
  background: #11151b;
}
</style>
```

## 6. Electron

Electron 中 ThreeJSON 运行在 renderer 进程，写法与普通浏览器项目一致。推荐使用 Vite 或其它前端构建工具管理 renderer。

安装：

```bash
npm install threejson three
```

renderer 侧：

```js
import { createJsonScene } from "threejson";

const runtime = await createJsonScene(sceneJson, {
  canvas: document.querySelector("#stage"),
  resetScene: true,
  assetsBaseMode: "cdn-first"
});

runtime.start();
window.addEventListener("beforeunload", () => runtime.dispose());
```

Electron 项目需要特别注意资源路径：

- 开发环境建议让 renderer 走 Vite dev server，不要直接用 `file://` 调试模块和纹理。
- 生产环境可以把资源放入应用包内，再用自定义协议或构建工具生成的 public 路径访问。
- JSON 内的资源路径应写成应用可访问的公开 URL，例如 `/assets/textures/xxx.webp` 或 CDN URL，不要写仓库里的本机绝对路径。

## 7. 资源路径

ThreeJSON 会把 `/assets/...`、`assets/...` 等公共资源路径解析到当前资源基址。常用配置：

```js
await createJsonScene(sceneJson, {
  canvas,
  assetsBase: "https://cdn.jsdelivr.net/npm/@threejson/assets@1.0.0",
  assetsBaseMode: "cdn-first"
});
```

也可以全局设置：

```js
import { setAssetsBaseUrl, setAssetsBaseMode } from "threejson/core";

setAssetsBaseUrl("/assets");
setAssetsBaseMode("base-first");
```

路径建议：

- 自己项目的资源：放到 `public/assets`，JSON 写 `/assets/...`。
- ThreeJSON 示例资源：可使用 `@threejson/assets` CDN。
- GitHub Pages：不要写站点根绝对路径，项目页通常不是部署在域名根目录。
- 本地开发：用 HTTP 服务打开页面，避免 `file://` 的跨源和模块解析问题。

## 8. 下一步

- 阅读 [JSON 配置](./json-format.md)，了解 `sceneConfig`、`worldInfo`、`objectList` 和常见对象字段。
- 阅读 [API 文档](./api.md)，了解运行时、对象增量更新、导出、事件和资源路径 API。
- 打开官网示例页，用左侧 JSON 修改右侧场景，理解 JSON 驱动的工作方式。
