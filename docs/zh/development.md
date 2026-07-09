[中文](./development.md) | [English](../en/development.md)

# 开发与工具链

[中文](./development.md) | [English](../en/development.md)

ThreeJSON **本体**（[`core/`](../../core/)、[`domains/`](../../domains/)）是面向浏览器 / 打包器的 **ESM**，**不依赖 Node 运行时**。

在本仓库内开发、跑测试、构建示例与外置工具时，需要 **Node.js 24+**（见根目录 [`.nvmrc`](../../.nvmrc) 与 [`package.json`](../../package.json) 的 `engines`）。

## 环境

```bash
nvm install 24
nvm use          # 读取 .nvmrc
node -v          # v24.x
npm ci
npm test
```

Python 外置 Agent 套壳（可选）：**Python 3.10+**，依赖见 [`tools/threejson-agent/shell/py/requirements.txt`](../../tools/threejson-agent/shell/py/requirements.txt)。

## 分层

| 层级 | Node 要求 | 说明 |
|------|-----------|------|
| `core/`、`domains/` | 否 | 静态服务或打包后在浏览器运行 |
| 根目录 `npm test` | 24+ | Node 跑 `tests/*.test.mjs` |
| `examples/*`（Vite / Electron） | 24+ | 各子目录 `npm install` / `npm run build` |
| `tools/threejson-agent/bridge/` | 24+ | Python CLI spawn Node 加载 `core/ai` |
| `tools/mcp-threejson` | 24+ | Cursor MCP |
| `tools/threejson-agent-desktop` | 24+ | Electron 桌面 |

## AI 凭据

- 浏览器：[`tools/scene-host/editor/index.html`](../../tools/scene-host/editor/index.html) / html-demo → **localStorage**
- CLI / GUI：[`tools/threejson-agent/setting.json`](../../tools/threejson-agent/setting.json)（从 `setting.example.json` 复制）
- MCP：[`tools/mcp-threejson/setting.json`](../../tools/mcp-threejson/setting.json)（独立文件）

## AI 验证

- 自动化（无需 API Key）：`npm test`、`npm run verify:ai-static`
- 手动矩阵：[`tests/ai-manual-verification.md`](../../tests/ai-manual-verification.md)
- 可选 live（需已配置 agent `setting.json`）：`npm run verify:ai-live`

## 同步 / 异步 API 命名约定

新增 public API 按下列四种情形命名：

1. **不需要异步**：仅提供 `abc()`（同步）。
2. **异步有价值且同步也可成立**：提供 `abc()` + `abcAsync()`（同语义，Async 版等待异步部分完成）。
3. **完整能力必须异步，同步只能阉割版**：提供 `abc()`（异步完整）+ `abcSimple()`（同步子集）。
4. **完全只能异步**：仅提供 `abc()`（返回 Promise，不额外加 `Async` 后缀）。

### 为何第 3 类使用 `*Simple` 而非 `*Sync`

第 3 类同步子集统一使用 **`abcSimple()`**，**禁止** public API 使用 `*Sync` 后缀，原因如下：

- **可读性**：`Async` 与 `Sync` 仅差一个字母，后缀并列时极易误读或写错（例如 `createJsonScene` 与 `createJsonSceneSync`）。
- **语义**：子集 API 并非「与 async 版等价的同步实现」，而是**省略或降级**需异步准备的能力；`Simple` 表示简化/子集，比 `Sync` 更准确。
- **发现性**：不宜用 `sync*` / `async*` 前缀统一命名，否则 IDE 补全中同类 API 难以区分完整版与子集版。

示例：`createJsonScene()`（async 完整）+ `createJsonSceneSimple()`（sync 子集）；**不要**新增 `createJsonSceneSync`。

objectMutation 的贴图路径属于第 2 类：同步 API 不阻塞贴图下载，`*Async` API 等待贴图就绪。

## AI 生成代码贡献规范

本开源项目**允许**提交 AI 辅助生成的代码，但开发者须遵守下列规范：

1. **文档同步**：修改代码必须同步更新 `docs/` 等项目文档（API、JSON 契约、示例说明、工具链 README 等），不得只改实现不留文档。
2. **方案先行**：修改代码前必须先有**方案文档**，且方案须经**人类评审**（记录评审人、日期与结论）；未经评审不得合入。
3. **提交附带方案**：提交代码时，应在 [`docs/dev/plans/`](dev/plans/) 目录中附带与该次变更相关的方案材料。
4. **方案目录命名**：可在 `plans/` 下为当次提交创建子目录，命名格式为：

   ```text
   {Unix毫秒时间戳}_{简要描述}_{32位十六进制UUID}
   ```

   示例：`1782301810000_examples-html-app-entry_f8e3b2a14c5d6789e0f1a2b3c4d5e6f7`

   - **时间戳**：Unix **timestamp**（毫秒，自 1970-01-01 UTC 起算），如 `1782301810000` 对应 `2026-06-24 19:50:10`（UTC+8）；目录内文档应注明所用时区以便对照
   - **简要描述**：英文小写与连字符，或简短中文；避免空格与特殊字符
   - **UUID**：128 位 UUID 的 32 位十六进制表示（无连字符），用于避免目录名冲突

5. **方案文档组成**：每个方案子目录应至少包含下列三类文档（可拆为多个 `.md` 文件，见 [`docs/dev/plans/README.md`](dev/plans/README.md)）：
   - **提示词文档**：核心提示词摘要，以及人类与 AI 的会话历史摘要（目标、约束、关键决策、未采纳方案）
   - **需求评估文档**：背景、范围、非目标、风险、验收标准
   - **方案设计文档**：架构/接口/数据流、影响面、测试与回滚计划

6. **测试**：如有必要，应在 [`tests/`](../../tests/) 目录下补充可自动运行的测试用例（如 `*.test.mjs`），并在方案文档中说明覆盖范围；纯 UI / 静态示例等无法单测的变更须在验收标准中写明手动验证步骤。

完整说明与示例见 **[`docs/dev/plans/README.md`](dev/plans/README.md)**。

## 语言与文档策略

| 层级 | 策略 |
|------|------|
| **文档 `docs/`** | 对外契约以 `docs/` + [`docs/en/`](en/) 双轨为准；新文档尽量同步英文 |
| **代码注释** | 新代码与公开 API **英文**；`core/`、`domains/` 存量中文注释 **分批英文化**（允许删除无效注释、补缺失说明；触达文件时继续迁移） |
| **[`demo.html`](../../examples/html-demo/demo.html)** | 单页运行时 i18n；`navigator.language` → `zh-CN` / `en-US`，无法识别时回退 `en-US`；中文 UI「相关文档」指向 `docs/*.md`；英文 UI 指向 `docs/en/*.md`（无英文镜像的文档仍链中文，如 `event-mechanism.md`） |
| **`html-demo` 教程页** | 正文 UI 保持中文 |
| **`tools/scene-host` 编辑器 / 播放器** | 应用层 i18n（补遗漏）；设置可覆盖语言；默认跟随浏览器，回退 `en-US` |
| **旧版归档 `tools/old_version/scene-editor.html` / `scene-player.html`**（已退役，只读对照） | **不做 UI i18n**（只读归档，不再新增功能） |
| **`room-show.html` / `port-show.html`** | **暂不做 UI i18n**（业务参考页） |
| **`core` / `domains` / `extensions`** | **禁止引入 UI i18n 运行时**（无 `t()`/locale 文件）；注释/JSDoc 与运行时诊断串（`Error` / `console.*`）使用 **英文**；场景 JSON 展示 `name`/`label` 可保留中文；`sceneCapability` 双语正则、`textureUtils` CJK 测字、`brandName` 历史键保留 |

关键概念的中英名与定义见 **[术语对照表](./glossary.md)**（与上表策略互补，不是 UI 文案表）。

---

## English summary

- **Runtime library** (`core/`, `domains/`): browser ESM, no Node required.
- **Repo tooling** (tests, examples, agent bridges, MCP): **Node.js 24+** (`.nvmrc`, `engines` in root `package.json`).
- AI credentials: editor localStorage; agent and MCP each use their own `setting.json`.
- Verification: see [`tests/ai-manual-verification.md`](../../tests/ai-manual-verification.md).
