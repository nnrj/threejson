# 官网部署工具链修复

- 日期：2026-10-20（Asia/Shanghai）。
- 用户先要求排查官方站构建失败，随后授权修复，并要求解释为何此前 Push 能部署、最近两次失败。
- 失败日志：2026-10-18，Node 24.22.0、Bun 1.4.3，`bun install` 成功，`npx wrangler deploy` 报 `sh: 1: wrangler: not found`。
- 补充的成功日志：2026-10-16，Node 24.22.0、Bun 1.2.15，同样的安装和部署命令成功，运行 Wrangler 4.151.1。
- Git 对照：`9675cf3..4fc2977` 的两次提交没有更改依赖声明、根部署配置或安装配置。根目录未声明 Wrangler，子应用从 7 月起声明 Wrangler；根锁文件从 7 月起未纳入版本控制。
- Bun 官方文档说明：自 1.3.2 起，没有既有锁文件的新工作区默认隔离安装；旧版采用提升安装。云端 Bun 升级暴露了根目录借用子应用可执行文件的隐式依赖。
- 成功日志还显示临时生成的 `/bun.lock` 被上传为公开静态资源，应加入部署排除规则。
- 约束：仅修改本地仓库并做隔离验证；不推送、部署、修改 Cloudflare 设置或使用线上凭据。保留官网根目录静态资源部署，不改引擎和应用运行时。

参考：

- https://bun.sh/docs/pm/isolated-installs
- https://developers.cloudflare.com/workers/wrangler/install-and-update/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
