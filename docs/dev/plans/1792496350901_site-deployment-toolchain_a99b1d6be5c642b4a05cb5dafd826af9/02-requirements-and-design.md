# 范围、设计与验收

## 修改范围

1. 根开发依赖显式固定 `wrangler: 4.151.1`，沿用用户成功部署日志的版本；不作为引擎运行时依赖。
2. 仅放行根 `package-lock.json` 的 Git 忽略，纳入 npm 锁文件，不改变其他独立工程的锁文件策略。
3. 提供官网 `deploy:site` 和只校验、不上传的 `check:site` 脚本，继续使用根 `wrangler.jsonc`；既有 Cloudflare `npx wrangler deploy` 仍有效。
4. 排除 npm/Bun 锁文件和本地验证缓存的静态部署，保留运行所需源码、文档和媒体模块。
5. 补充配置回归测试、CI 的官网 dry-run、中文与英文部署操作说明。

不新增 React 构建，不强制固定旧 Bun 来保留隐式依赖，不修改根静态资源目录、Worker 名或线上权限。优先保留现有锁文件中的无关依赖版本。

## 验收

- 根 Wrangler 为直接开发依赖，锁文件中的根声明与实际解析版本一致。
- npm 锁文件可被 Git 纳入，不能由 `.assetsignore` 上传；Bun 锁文件同样不上传。
- 对照成功/失败日志、Git 变更和 Bun 的隔离安装契约，确认根命令不应借用子应用的工具。
- 干净目录执行锁定安装和 Wrangler 启动验证，不能依赖维护者已有 `node_modules`。
- 官网 dry-run 通过，部署范围回归通过；不执行真实 deploy。
- 确认 `.gitignore` 对其他工程仍保持原策略，core / domains / browser runtime 不改动。
- 记录实际工具版本及测试结果，区分本地验证和云端重试；若隔离安装受到网络或环境限制，明确保留该验证缺口。

## 回滚

撤销本次工具链、文档、测试与根锁文件变更即可；没有线上状态或数据迁移。不要通过回退视频/额度业务修复来解决部署工具缺失。

## 人类评审

- 用户已授权修复；正式合并评审人、日期和结论待维护者补录。
- 本记录不声称已经合并、部署或通过云端验收。

## 验证结果

- 回归测试先红后绿：`siteDeployment.test.mjs` 的四项测试先分别暴露根依赖未声明、
  根锁文件被忽略、Bun 锁文件公开上传及无 dry-run 检查；修改后全部通过。
- `node --test --test-isolation=none tests/siteDeployment.test.mjs tests/appsDeploymentPreviewProtocol.test.mjs tests/architectureDependencies.test.mjs`：
  **28 / 28 通过**。测试只验证本地配置和临时 Git 忽略规则，不调用线上服务。
- Node 24.14.0 / npm 11.9.0：在独立临时目录复制根和工作区依赖清单，执行
  `npm ci --include=dev --ignore-scripts --no-audit --no-fund`，干净安装 **244 个包**成功。
  根锁文件与安装前副本 SHA256 一致，锁文件解析版本为 Wrangler 4.151.1。
  使用 `--ignore-scripts` 是本地验证的安全边界；Cloudflare / GitHub CI 的常规安装不禁用生命周期脚本。
- 在该干净安装目录执行 `npx --offline --yes=false wrangler --version`，成功返回 **4.151.1**；
  不依赖原工作区中仍保留的旧版 Wrangler。
- Windows 根目录 `npm run check:site` 能启动正确 CLI，但进入资源扫描后耗时异常，已主动取消。
  临时依赖树中存在 `node_modules/threejson` 指回项目自身的 Windows Junction；
  Wrangler 4.151.1 在应用 `.assetsignore` 前使用递归 `readdir`，该本地扫描问题与线上找不到命令不同。
- 改用不含 `node_modules` 的完整已跟踪源码快照（复制当前工作区的修改），使用干净安装的
  Wrangler 4.151.1 和同一份根配置执行 `deploy --dry-run`：
  读取 **2,527 个文件条目**，正常输出 `--dry-run: exiting now.`，退出码 **0**。
  CLI 遥测设置为关闭，没有执行正式上传、登录或部署。
- 根锁文件中的非链接外部依赖全部来自 `https://registry.npmjs.org/`，没有本机绝对路径或私有注册源。
- 未重新安装两个 Bun 版本重放，也未在云端 Linux 执行真实部署；Bun 升级时间由用户提供的两次线上日志确认，
  安装布局变化依据 Bun 官方契约与 npm 本地命令解析逻辑。最终云端验收仍需维护者提交后 Push。
- `git diff --check` 通过。未修改 core / domains / 应用运行时，未更改现有 `node_modules`，
  未提交、推送或修改 Cloudflare 控制台。
