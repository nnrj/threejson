# 需求评估与方案设计（示例）

> **说明**：正式提交可将本文拆为 `02-requirements-assessment.md` 与 `03-solution-design.md` 两个文件；此处合并仅为示范。

## 一、需求评估

### 背景

`examples/` 根目录已有 `vue-app`、`react-app`，但 HTML 教程集中在 `html-demo/` 深层路径，新用户不易发现纯 HTML 集成方式。

### 范围（In scope）

- 新增 `examples/html-app.html` 单页示例
- 加载 `/assets/json/tutorial/track-00/00-03-friendly-full-scene.json`
- 更新 `examples/README.md`（中英）中的入口说明

### 非目标（Out of scope）

- 不修改 `html-demo/` 内既有教程页
- 不引入 Vite / 打包器
- 不复制 vue-app 的 `demo-assets` 目录
- 不新增 `tests/` 用例（纯静态 HTML 入口，手动验收即可）

### 风险

| 风险 | 缓解 |
|------|------|
| 用户从 `examples/` 子路径启动静态服务导致 import map 404 | README 与页面 hint 明确要求**仓库根**启动 |
| 与 `00-03-friendly-full-scene.html` 行为漂移 | 共用同一 JSON 与相同 `createJsonScene` 调用模式 |

### 验收标准

- [ ] 仓库根静态服务下打开 `/examples/html-app.html` 可渲染场景
- [ ] 控制台无模块加载 404
- [ ] `examples/README.md` 列出 `html-app.html` 入口

---

## 二、方案设计

### 页面结构

参照 [`examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html`](../../../../examples/html-demo/track-00-runtime/00-03-friendly-full-scene.html)：

- import map → `/builtins/full.js`、`/core/index.js` 及 CDN 上的 `three` 等
- `import { createJsonScene } from "threejson"`
- `fetch("/assets/json/tutorial/track-00/00-03-friendly-full-scene.json")`
- `window` resize 回调更新画布尺寸

### 文档影响

- `examples/README.md`、`examples/README_EN.md`：在目录说明首条增加 `html-app.html`

### 测试计划

1. Live Server（仓库根）打开 `/examples/html-app.html`
2. 对比同 JSON 的 `00-03-friendly-full-scene.html` 视觉与控制台  
   （本变更无 `tests/*.test.mjs`；若后续改动 `core/` 行为须补单测）

### 回滚

删除 `examples/html-app.html` 并还原 README 相关段落即可，无数据迁移。
