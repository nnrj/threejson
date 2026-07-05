# 静态资源（assets）目录与在线托管备忘

状态：**已实发** `@threejson/assets@1.0.0`（npm）+ 运行时默认 jsDelivr CDN（`core/util/assetsBase.js`）。

## 现状

| 层级 | 职责 |
|------|------|
| 仓库 [`assets/`](../assets/) | 开发态源文件；本地 demo 通过 Web 服务器映射 `/assets/...` |
| npm [`@threejson/assets`](https://www.npmjs.com/package/@threejson/assets) | 仅静态文件（`textures/`、`json/`、`model/`、`fonts/`、`audio/`、`img/`）；**不**与 `threejson` 运行时混包 |
| 运行时 [`core/util/assetsBase.js`](../core/util/assetsBase.js) | 默认 CDN 基址、路径重写、`setAssetsBaseUrl` / `sceneConfig.assetsBase` |

- `threejson` 主包 **不含** `assets/` 大体积静态文件。
- 内置 domain 与场景 JSON 中 **`/assets/...` 前缀**在加载时按当前 base 重写；完整 `https://` URL 不变。
- JSON **不必**写死 jsDelivr 完整 URL。

## 默认 CDN（npm 用户）

引擎内置（`ASSETS_PACKAGE_VERSION`，当前 `1.0.0`）：

```
https://cdn.jsdelivr.net/npm/@threejson/assets@1.0.0
```

纹理示例：

```
https://cdn.jsdelivr.net/npm/@threejson/assets@1.0.0/textures/device/cabinet/cabinet_left_door.png
```

**优先级（低 → 高）：** 内置 CDN → `setAssetsBaseUrl()` → `sceneConfig.assetsBase` → `createJsonScene({ assetsBase })`。

文档：[`doc/json-format.md`](../doc/json-format.md#sceneconfigassetsbase-可选静态资源基址)、[`doc/api.md`](../doc/api.md#静态资源coreutilassetsbasejs)、根 [`README.md`](../README.md)。

## 发布

在 [`assets/package.json`](../assets/package.json) 目录：

```bash
npm pack          # 核查 tarball 含静态目录、不含 JS 模块
npm publish --access public
```

`threejson` 升级 `@threejson/assets` 版本时，同步改 `core/util/assetsBase.js` 中的 `ASSETS_PACKAGE_VERSION`。

## jsDelivr 注意事项

- **首发同步**：npm 发布后 jsDelivr 索引可能延迟数分钟；直链暂时失败可稍后重试。
- **包体积**：当前 tarball ~122MB（解压 ~127MB），接近 jsDelivr npm 包 **~100MB** 索引/列表软限制；**单文件**直链（纹理 PNG 等）通常可用，包浏览页可能报 relay / version info 错误，可忽略。
- **单文件上限**：约 **20MB**/文件；超大模型需拆分或自托管。
- **CORS**：jsDelivr 对静态资源一般可直接用于 `TextureLoader`；发布后在浏览器验证典型 URL。
- **备用 CDN**：[`unpkg.com/@threejson/assets@1.0.0/...`](https://unpkg.com/@threejson/assets@1.0.0/)（行为类似，不作默认）。

## 本地 / 克隆仓库

从仓库根起静态服务，demo 传 `assetsBase: "/assets"` 或：

```js
import { setAssetsBaseUrl, LOCAL_ASSETS_BASE } from "threejson/core";
setAssetsBaseUrl(LOCAL_ASSETS_BASE);
```

## 备选托管（未采用为默认）

| 方案 | 适用 |
|------|------|
| jsDelivr `gh/user/repo@tag/assets/...` | npm CDN 受限时的 Release 托管 |
| `npm install @threejson/assets` + 静态映射 | 打包应用、内网 |
| GitHub Pages / Cloudflare Pages | 自托管 |

## 不推荐

GitHub raw、图床、把静态资源打进 `threejson` 主包。
