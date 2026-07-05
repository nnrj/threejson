# ThreeJSON AI 手动验证方案

本文件是 **人工签收矩阵**；能自动跑的部分见 [`ai-verification.automated.mjs`](./ai-verification.automated.mjs) 与 [`npm run verify:ai-static`](#自动化前置)。需要 **真实 LLM 调用** 的可选 live 脚本：[`npm run verify:ai-live`](#可选-live-自动化)。

夹具目录：[`fixtures/ai-test/`](./fixtures/ai-test/)。

---

## 0. 自动化 vs 手动

| 类型 | 命令 / 入口 | 覆盖 |
|------|-------------|------|
| **自动（无 API Key）** | `npm test` | core 解析、patch、validate、stream/abort mock |
| **自动（无 API Key）** | `npm run verify:ai-static` | 夹具校验、bridge 语法、Python config 单测 |
| **自动（需 Key）** | `npm run verify:ai-live` | CLI 最短 generate + texture plan（读 agent `setting.json`） |
| **手动·浏览器** | 05-01、scene-editor、目视 3D | 渲染、机位、侧栏 UX |
| **手动·MCP** | Cursor + `tools/mcp-threejson` | 工具调用与 Cursor 集成 |
| **手动·Electron** | `tools/threejson-agent-desktop` | 桌面壳 + 编辑器同源 |

---

## 1. 环境检查（实施前勾选）

- [ ] **Node.js 24+**：`nvm use` → `node -v`（见 [`.nvmrc`](../.nvmrc)）
- [ ] **Python 3.10+**：`pip install -r tools/threejson-agent/shell/py/requirements.txt`（live 验证与 `verify:ai-static` 内 Python 单测需要）
- [ ] **静态服务**（浏览器项）：仓库根 `python -m http.server 8080` → `http://localhost:8080/demo.html`
- [ ] **Agent 凭据**：[`tools/threejson-agent/setting.json`](../tools/threejson-agent/setting.json)（从 `setting.example.json` 复制，`llm.apiKey` 已填）
- [ ] **MCP 凭据**（可选）：[`tools/mcp-threejson/setting.json`](../tools/mcp-threejson/setting.json)（与 agent **独立**）
- [ ] 跑通自动化：`npm test && npm run verify:ai-static`

工作目录约定：

- **CLI**：`cd tools/threejson-agent/shell/py`
- **夹具相对路径**：`../../../tests/fixtures/ai-test/...`
- **输出目录**：`../../../tests/fixtures/ai-test/out/`（已 gitignore）

---

## 2. 分层职责

| 层 | 路径 | 职责 |
|----|------|------|
| L0 Core | [`core/ai/`](../core/ai/) | 生成/更新/Agent/纹理规划填充/校验 |
| L1 Node 桥 | [`tools/threejson-agent/bridge/`](../tools/threejson-agent/bridge/) | stdin JSON → `core/ai` |
| L2 外置产品 | Python CLI / Gradio | spawn bridge；读 agent `setting.json` |
| L3 集成 | MCP、05-01、scene-editor、Desktop | 各入口 UX 与凭据隔离 |

---

## 3. 用例矩阵

字段：**ID | 能力 | 入口 | 先决条件 | 通过标准 | 失败时查**

### 会话 1 · CLI / Core / 脚本（无浏览器）

| ID | 能力 | 入口 | 先决条件 | 通过标准 | 失败时查 |
|----|------|------|----------|----------|----------|
| **A0** | 自动化静态 | `npm test && npm run verify:ai-static` | Node 24 | 全部 exit 0 | 见终端用例名 |
| **C1** | validate 负例 | 自动：`ai-verification.automated` | 无 | `invalid-scene.json` → `ok: false` | `agentTools.js` |
| **C2** | 单次生成 | 见下方 CLI | Key、Node 24 | 输出合法 JSON；`boxModelList` 等可解析 | bridge stderr、Key、baseUrl |
| **C3** | 全量 update | CLI `scene update` | C2 或夹具 base | 保留 sceneConfig；对象按 prompt 变化 | prompt、全量模式 |
| **C4** | 增量 update | `--update-mode incremental` | base 夹具 | Patch 应用成功或返回合法全量 JSON | `scenePatch.js`、模型是否遵守 patch |
| **C5** | texture plan | `texture plan -i scene-with-texture-slots.json` | Key | stdout JSON 含 `tasks` 数组 | 空 slot 是否被识别 |
| **C6** | texture fill | `texture fill` + hint | Key、Node | `textureUrl` 被写入或 dry-run 有规划 | `texture-fill.mjs`、`llm.apiKey` / `llm.imageModel` |
| **C7** | Agent 多步 | `scene generate --agent --depth medium` | Key | stderr 多步进度；`agentUsed: true` | `sceneAgent.js`、depth |
| **C8** | run 编排 | `run --prompt ... --agent --fill-textures` | Key | 生成 + 可选纹理闭环 | CLI `run`、texture 配置 |
| **C9** | 流式 CLI | `scene generate --stream --stream-preview` | Key | stderr 有增量 delta | bridge `streamPreview` |
| **C10** | 脚本直连 | `node examples/script/ai-update-scene.mjs` | 参数/env Key | 写文件或 stdout JSON | 脚本 `--help` |
| **C17** | 能力 spot·css3d | CLI `scene generate --no-agent` prompt 含「可点击控制台/表单」 | Key | JSON 含 `css3dPanelList` 或 `objType css3dPanel`（非仅 infoPanel） | `threeJsonCoreSkill.js`、`sceneCapability.js` |
| **C18** | 能力 spot·粒子 | CLI generate prompt「粒子尘/星尘」 | Key | JSON 含 `objType particleEmitter`（非仅 box） | 同上 |
| **C19** | 命令 spot·改色 | editer AI 调整「把选中物体改成蓝色」 | localStorage Key | 命令含 `material.patch` 或 `object.patch`；画布变色 | `sceneCommandSkill.js`、`runEditorAiUpdate.js` |
| **M1** | MCP generate | Cursor 调 `threejson_generate` | MCP setting | 返回场景 JSON | `doc/mcp-cursor.md` |
| **M2** | MCP update | `threejson_update` + `updateMode` | 已有 JSON | 增量/全量符合参数 | `server.mjs` |
| **L1** | Live 自动 | `npm run verify:ai-live` | agent setting | 脚本报告 PASS | Key、网络、Node 24 |

**C2–C9 CLI 示例**（在 `tools/threejson-agent/shell/py` 下）：

```bash
mkdir -p ../../../tests/fixtures/ai-test/out

python -m threejson_agent --config ../../setting.json scene generate \
  --prompt "一个带红色立方体的最小园区场景" --no-agent \
  -o ../../../tests/fixtures/ai-test/out/out-generate.json

python -m threejson_agent --config ../../setting.json scene update \
  --prompt "把红色立方体改成绿色" --no-agent \
  -i ../../../tests/fixtures/ai-test/base-scene-friendly.json \
  -o ../../../tests/fixtures/ai-test/out/out-update-full.json

python -m threejson_agent --config ../../setting.json scene update \
  --prompt "仅把 ai-test-box-a 改成紫色" --no-agent \
  --update-mode incremental \
  -i ../../../tests/fixtures/ai-test/base-scene-friendly.json \
  -o ../../../tests/fixtures/ai-test/out/out-update-incr.json

python -m threejson_agent --config ../../setting.json texture plan \
  -i ../../../tests/fixtures/ai-test/scene-with-texture-slots.json

python -m threejson_agent --config ../../setting.json texture fill \
  -i ../../../tests/fixtures/ai-test/scene-with-texture-slots.json \
  --hint "wood floor and concrete wall" \
  -o ../../../tests/fixtures/ai-test/out/out-filled.json

python -m threejson_agent --config ../../setting.json scene generate \
  --prompt "小型仓库场景" --agent --depth medium --stream --stream-preview \
  -o ../../../tests/fixtures/ai-test/out/out-agent.json
```

### 会话 2 · 浏览器 + 3D（需目视）

| ID | 能力 | 入口 | 先决条件 | 通过标准 | 失败时查 |
|----|------|------|----------|----------|----------|
| **C11** | 教程 AI 全流程 | [`05-01-ai-scene.html`](../examples/html-demo/track-05-tooling/05-01-ai-scene.html) | 静态服务、页内 Key | 生成后 canvas 有物体；调整有效 | importmap、`core/ai` |
| **C12** | 看图生成 | 05-01 看图 Tab | 多模态模型 Key（如 gpt-4o-mini） | 参考图影响布局/物体 | 勿用纯文本模型（如 deepseek-chat） |
| **C13** | 机位保持 | 05-01 调整后 | 同页 | 相机/controls 未异常重置 | `createJsonScene` 重载逻辑 |
| **C14** | 编辑器生成 | [`scene-editor.html`](../scene-editor.html) 左栏 AI | localStorage Key | 场景载入画布 | 浏览器 Network |
| **C15** | 增量+流式+中止 | editer 勾选增量/流式/中止 | 同页 | 增量仅改部分；流式有字；中止不 toast 报错 | Phase E 控件 |
| **C16** | 纹理 sink | editer 纹理目录/ZIP + 自定义网关 | 用户授权目录；`llm.baseUrl` 与 chat 一致 | Network 请求 host 为自定义网关（非 `api.openai.com`）；fill 后材质可见；无 CORS 时仍载入场景 + warning | `browserTextureSink`、关「完成后填充纹理」或 CLI |
| **P1** | 05-01 签收 | 上列 C11–C13 | — | 目视通过 | — |
| **P2** | editer 签收 | 上列 C14–C16 | — | 目视通过 | — |

### 会话 3 · 边缘（可选）

| ID | 能力 | 入口 | 先决条件 | 通过标准 | 失败时查 |
|----|------|------|----------|----------|----------|
| **A5** | asset search | `python -m threejson_agent asset search --query "wood texture"` | Key/网络 | 返回候选列表 | `asset.mjs`、Python 回退 |
| **A6** | asset download_first | `run` 带 asset 相关 flags | 同 CLI README | 先搜后下或文档行为 | Node asset 桥 |
| **P3** | Desktop | `tools/threejson-agent-desktop` | Electron 构建 | 内嵌 editor 与 C14 等价 | desktop README |
| **PR** | Provider 矩阵 | 改 setting provider 各跑 C2 一行 | 各平台 Key | 请求 URL 无 404 | [`setting.example.json`](../tools/threejson-agent/setting.example.json) `_providerBaseUrlHints` |

---

## 4. 三阶段执行顺序

1. **会话 1**：A0 → L1（可选 live）→ C2–C10 → M1–M2  
2. **会话 2**：C11–C16（P1、P2 目视签收）  
3. **会话 3**：A5–A6、P3、Provider 矩阵  

---

## 5. 签收记录

| 日期 | 测试人 | Provider | ID | Pass / Fail / Skip | 备注 |
|------|--------|----------|-----|-------------------|------|
| | | | A0 | | |
| | | | C17 | | css3dPanel capability spot |
| | | | C18 | | particleEmitter capability spot |
| | | | C19 | | command material.patch spot |

---

## 6. 排错索引

| 现象 | 排查 |
|------|------|
| `AI request failed (404)` | `llm.baseUrl` 根 URL 是否与 provider 匹配（见 setting example 提示） |
| 非 JSON / 解析失败 | 模型输出；`extractJsonText`；换 `--no-agent` 对比 |
| 看图失败 | 模型是否支持 vision；API Key |
| 纹理全跳过 | 空 `textureUrl` slot；`llm.apiKey`；`texture fill` hint |
| 浏览器纹理 CORS / Failed to fetch | 网关未对 `/images/generations` 返回 CORS；场景应仍载入（warning）；改用 CLI/MCP 或关闭纹理填充 |
| 纹理 401 | Key 或 `llm.imageModel` 与网关不匹配 |
| Agent 无多步 | `--agent`、`agent.enabled`、depth |
| 增量 patch 失败 | 模型是否输出 RFC6902；改全量对比 |
| MCP 找不到仓库 | `THREEJSON_ROOT`、MCP `setting.json` 路径 |
| CLI bridge 失败 | `node -v` 是否 24+；`node --check tools/threejson-agent/bridge/*.mjs` |
| 教程页 404 | 静态服务必须从**仓库根**起；importmap 路径 |

---

## 7. 相关文档

- [`core/ai/README.md`](../core/ai/README.md)
- [`core/ai/SKILL.md`](../core/ai/SKILL.md)
- [`lab/archive/ai-skill-gap-matrix.md`](../lab/archive/ai-skill-gap-matrix.md)
- [`doc/development.md`](../doc/development.md)
- [`tools/threejson-agent/README.md`](../tools/threejson-agent/README.md)
- [`doc/mcp-cursor.md`](../doc/mcp-cursor.md)
