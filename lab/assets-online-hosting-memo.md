# 静态资源（assets）目录与在线托管备忘

状态：`idea` → 近期可执行 **仓库内重命名 + 路径统一**；**npm/CDN 实发** 随首版发布里程碑。

## 现状

- 仓库根目录 [`assets/`](../assets/)：纹理、JSON 场景、OBJ 等；体量大，**不**打入 `threejson` 运行时 npm 包。
- 内置 domain 默认值多为站点根路径，例如 `/assets/textures/cabinet/...`（见 `domains/cabinet`、`domains/weather`、`domains/port`）。
- `core` 已支持 `textureUrl` / `modelPath` 的 **https** 与相对路径。

## 在线托管选型（评估结论）

### 首选：独立 npm 包 `@threejson/assets` + jsDelivr

- URL 示例：`https://cdn.jsdelivr.net/npm/@threejson/assets@1.2.3/textures/device/cabinet/cabinet_left_door.png`
- [jsDelivr](https://github.com/jsdelivr/jsdelivr)：开源 MIT、面向 OSS、npm 版本可锁定；删除版本仍有永久缓存。
- 备用：unpkg、StaticDelivr（同类）。
- 发布前对典型纹理 URL 在浏览器中验证 **CORS**（`TextureLoader`）。

### 备选

| 方案 | 适用 |
|------|------|
| jsDelivr `gh/user/repo@tag/path` | 大文件、Release + Git LFS；路径绑 tag |
| GitHub Pages | 小流量静态站；需自行维护 |
| Cloudflare Pages 等 | 自托管补充，非「开源 CDN」本体 |

### 不推荐作主方案

GitHub raw、图床、IPFS 网关、把静态资源打进 `threejson` 主包。

## 仓库目录：`assets/` 还是 `assets/`？

**建议：直接重命名 `assets/` → `assets/`，不用长期别名。**

| 做法 | 评价 |
|------|------|
| **重命名为 `assets/`** | 与将来 `@threejson/assets` npm 包名一致；单一事实来源；项目未发布，无历史包袱。 |
| 保留 `assets/` + 别名 | 易与 npm 包名混淆；Windows 下 symlink 麻烦；多一层心智负担。 |

重命名后全仓机械替换：

- 路径前缀 `/assets/` → `/assets/`
- 文案与文档中的 `` `assets/` `` 目录指称
- 脚本默认值（如 `examples/script/*`、`tools/*` 中的 `./assets/json/...`）

约 **100+** 处引用（含 JSON 场景），以批量替换 + `npm test` 为主。

## 与 `@threejson/assets` 的关系

| 层级 | 职责 |
|------|------|
| **仓库 `assets/`** | 开发态源文件；本地 demo 通过 Web 服务器映射 `/assets/...` |
| **npm `@threejson/assets`** | 仅含静态文件；发布时从 `assets/` 打 tarball；**不**与 `threejson` 运行时混包 |
| **domain 默认 URL** | 通过共享常量拼接基址（见下） |

不完全等同：npm 包是 **发布产物**；仓库目录是 **源码树**。重命名后二者目录结构应对齐（`textures/`、`json/`、`models/` 等子路径保持不变）。

## 改造衔接（分阶段）

### 阶段 A — 与 domain 解耦同期（推荐本次做）

1. `git mv resources assets`（或等价重命名）。
2. 全仓 `/assets/` → `/assets/`（及相对路径 `assets/`）。
3. 新增共享模块，例如 `assets/defaults.js` 或 `domains/shared/assetsBase.js`：
   - `export const DEFAULT_ASSETS_BASE = '/assets';`（本地 demo）
   - domain 内 `textureUrl: \`${DEFAULT_ASSETS_BASE}/textures/...\``
4. **本次不把默认值改成 CDN https**（尚未实发 `@threejson/assets`）。

### 阶段 B — 首版 npm 发布时

1. 新增 `assets/package.json`（`name: @threejson/assets`）或独立仓库/workspaces 包。
2. `prepublishOnly` 仅打静态资源包；**仍不向 registry 实发** 直至发布里程碑。
3. 文档与 domain 默认基址增加 **可配置**：
   - `DEFAULT_ASSETS_BASE = 'https://cdn.jsdelivr.net/npm/@threejson/assets@x.y.z'`
   - 或运行时 `setAssetsBaseUrl(url)`（若后续需要）

### 阶段 C — 可选

- 场景 JSON 内历史路径批量迁移（若 JSON 内写死 `/assets/`）。
- 私有化部署文档：用户自建静态站覆盖 `ASSETS_BASE`。

## 能否一次取代 `assets/`？

- **仓库内**：重命名 + 路径替换即可 **完全取代** 目录名 `resources`。
- **运行时默认**：阶段 A 用 `/assets/...` 即可在 clone 仓库 + 静态服务下与今日等价。
- **npm 安装用户无本地 assets**：需阶段 B 的 CDN 基址或用户自备静态资源；与「不将 assets 打入 threejson 主包」一致。

若阶段 A 改动量阻碍 domain 解耦主线，可 **仅** 在 domain 解耦 PR 中完成 `assetsBase` 常量提取，重命名顺延半周；当前评估为 **可同期**，以机械替换为主。

## 退出条件

- 内置 domain 默认 URL 不再出现 `/assets/`。
- `@threejson/assets` 发布且文档给出锁定版本的 CDN 基址示例。
- CI 可选：校验 `domains/` 下无硬编码 `/assets/`。
