# 提示词与上下文（示例）

> **说明**：本文件为 `docs/dev/plans` 的格式示例，对应虚构提交「在 examples 根目录增加 html-app.html」。  
> **时间戳**：`1782301810000`（Unix 毫秒，对应 `2026-06-24 19:50:10` UTC+8）  
> **关联变更**：`examples/html-app.html`、`examples/README.md`

## 核心提示词摘要

- 在 `examples/` 根目录提供与 `vue-app` / `react-app` 并列的**纯 HTML** 入口，避免用户进入 examples 后找不到无构建示例。
- 基于 `html-demo/track-00-runtime/00-01-minimal-mesh.html` 复制并调整路径。
- 场景数据使用仓库内 tutorial JSON（最终定为 `00-03-friendly-full-scene.json`）。
- 从**仓库根**静态服务访问；import map 与 `html-demo` 约定一致。

## 人类与 AI 会话摘要

| 阶段 | 摘要 |
|------|------|
| 目标 | 降低 examples 发现成本；不新增构建链 |
| 约束 | 不改动 `core/` 行为；路径须适配仓库根静态服务 |
| 关键决策 | ① 文件命名为 `html-app.html`；② 场景改为 `00-03-friendly-full-scene.json`（较 vue-app demo 更贴合 tutorial 资产）；③ 放弃 vue-app `demo-assets` 路径改写逻辑 |
| 未采纳 | 在 examples 下复制整套 `demo-assets`（避免与 vue-app 重复维护） |
| 文档 | 同步更新 `examples/README.md` / `README_EN.md` |

## 评审记录（示例）

| 字段 | 内容 |
|------|------|
| 评审人 | （示例）维护者 A |
| 日期 | 2026-06-24 |
| 结论 | 通过 |
| 备注 | 入口页保持与 `00-03-friendly-full-scene.html` 行为一致即可 |
