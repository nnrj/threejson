# 实施与验证记录

日期：2026-10-16（Asia/Shanghai）。只落实本次架构边界修正，未重新实施或回滚上一轮视觉质量功能。

## 已完成

1. Core 程序化几何取消固定顶点、隐式采样和细分上限；保留客观数值合法性检查。显式 `meshBudget` 前置检查并在输出时复核，调用者预算优先于场景描述符。作者指定的 `maxSegments` 不再被额外截断，误差细分返回收敛状态；worker 往返保留该数据。官方浏览器几何编译器注入可覆盖的保护预算。
2. 场景包收集逻辑改为 `requiredAssets/isAssetRequired/strictAssets`，不识别 ThreeBox 服务 URL。模型获取/必需性策略进入共享宿主，各相关场景、对象及模板导出入口传入策略。
3. Core 仅接受数值预览预算或注入策略，默认未启用时不创建降级状态、不读取设备信息。共享宿主提供设备起始档位、连续帧时间反馈、升降档迟滞和恢复。默认不抽样 Points、不偏移 LOD；这两项单独授权。后处理/DPR 可恢复，正式检查与导出另建完整质量运行时。独立复用卡片默认完整质量，官方 ThreeBox/视频编辑器默认自动；显式 `false` 不被其他默认值覆盖。
4. Core 保留结构化观察、版本绑定、报告与检查/修正流程，使用通用 `qualityProfile`。四档预算、界面语言和报告格式化进入共享 `creationQualityPolicy.js`。未完成请求的图像检查时不会报完成；暂停草稿不被预设意外启动额外付费精修。
5. 更新中英文设计原则与质量契约，澄清宿主显式 API 启用、通用创作配方和运行叠加层，不放宽单向依赖或允许产品特判。同步原生共享源与 host-kit 副本、类型和所有仓内调用点。

## 验证

- 全套 `tests/*.test.mjs`：1,747 通过、1 跳过、0 失败。
- 定向边界/预览/报告/卡片测试：38 通过；静态 AI 验证：3 通过。
- 重建 geometry/modeling worker；检查源代码边界及 `git diff --check` 通过。
- 安装好的 Edge、隔离本机服务器、外网请求拦截：9 组视觉基准通过。7 组场景重开和导出帧平均通道误差为 0；默认不减点、授权采样、恢复完整绘制与输出均通过。
- 视频编辑器浏览器回归通过，含实际场景编辑器往返、JSON/混合视图、撤销重做、窄屏和带音频的真实编码导出；测试主动输入的非法 JSON/时长触发预期错误，无未捕获异常。
- React ThreeBox 与场景编辑器构建通过。Cloud 架构检查通过，使用新离线本地包验证脚本完成 TypeScript 和生产构建。测试目录保留于忽略的 `dist/cloud-local-packages-*`；未替换 Cloud 原安装或修改锁文件。
- 原有 Vite 大 chunk/混合导入警告仍存在，不在此次分层修复中假称完成性能优化。

## 接口迁移与发布

- `resolveCreationQuality/formatQualityReport` 从 `threejson/visual-quality` 移至 `@threejson/host-kit/js/creationQualityPolicy.js`。
- Core `runCreationQualityReview` 接收 `profile`，Core Agent 接收 `qualityProfile`，不再解析四档产品名。官方宿主负责从现有用户设置转换。
- `createJsonScene` 的 `previewPerformance` 接收 `false/"full"/数值预算/策略对象`；官方档位先调用 `createHostPreviewPerformance`，不把 `"auto"/"economy"` 直接传给 Core。
- 本次为 alpha API 修正；发布时同时升级 ThreeJSON、host-kit、media-kit、react-scene-agent 等变更包及消费者。Cloud 本地打包验证不能替代发布新版本和更新真实锁文件。
- 未推送、发布包、部署、迁移数据库或调用付费供应商。本期边界修正不要求另加服务端数据库迁移；前一轮外部模型等功能的迁移要求仍以验收文档为准。

## 仍需现场验证

真实设备帧时间阈值、内存压力和长期播放；真实供应商预算下的画面评审质量；线上资产访问及缓存。桌面模拟窄屏、离线测试和局部采样不能替代这些验证。
