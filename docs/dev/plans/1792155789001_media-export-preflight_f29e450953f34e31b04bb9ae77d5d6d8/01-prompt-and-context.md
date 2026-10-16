# 导出前检查与安全保存（2026-10-16，Asia/Shanghai）

用户反馈：选择循环配乐补全后，进度走完才报 `Clip "dilation": Timeline target not found: restPhoton`，目标文件仍为 0 字节。要求核查并修复。

代码证据：共享导出窗口先选择目标文件、合成整片旁白，再进入 media-kit 的镜头预检查。用户原始 150 秒样本的 group 同时含空 subScene 和有内容的 children；运行时忽略 children。样本另有 parametricSurface.geometry.func 算术函数，不能通过执行不可信 JavaScript 兼容。

本轮基于 9953678，开始时工作树干净。保留历史草稿，不因 production.paused 禁止合法导出；不调用付费供应商、不部署、不推送。测试必须包含用户原始 fixture，不得只以手工修复副本证明问题解决。

人工评审：待维护者评审；本轮实现与本地验证不代表合入许可。
