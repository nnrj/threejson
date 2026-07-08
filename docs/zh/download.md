[中文](./download.md) | [English](../en/download.md)

# 下载

## 运行时

通过 npm 安装 ThreeJSON：

```bash
npm install threejson
```

在现代 ESM 代码中使用：

```js
import { createJsonScene } from "threejson/core";
```

## 可选资源包

示例资源后续可作为独立包安装：

```bash
npm install @threejson/assets
```

该资源包用于示例、纹理、示例 JSON 场景和本地文档资源。生产应用也可以使用自己的资源流水线，并在 ThreeJSON JSON 字段中指向对应 URL。
