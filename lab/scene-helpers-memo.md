# 场景 Helpers 备忘（非发布承诺）

**状态**：`partial`（v1 grid/axes 单实例已启用；多实例为 `deferred`）

## 当前（v1）

- 配置：`sceneConfig.helpers.grid` / `sceneConfig.helpers.axes`
- 语法糖：`sceneConfig.gridHelper`、`worldInfo.gridHelper`、`sceneConfig.axesHelper`、`worldInfo.axesHelper`（归一化映射；与 `helpers.*` 并存时 **helpers 优先**）
- 运行时：`helperRoot` managed root；`userData.objJson.objType` 为 `gridHelper` / `axesHelper`
- 各 **1 个** grid、1 个 axes

## 多实例（远期）

若需要多层标高网格或多套坐标轴：

- 扩展为 `helpers.grids: []` / `helpers.axesList: []`
- 保留单对象 shorthand（`helpers.grid`）作为 length=1 的兼容写法
- redeploy 仍按 helperRoot clear + mount 循环

## 参考

- 实现：`core/builder/sceneHelperBuilder.js`
- 加载：`core/handler/sceneLoadHandler.js` → `mountSceneHelpers`
