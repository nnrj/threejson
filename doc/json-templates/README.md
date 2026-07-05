# JSON 模板（编辑器/手写场景参考）

这批模板用于快速起步，不与 `scene-editor.html` 内部常量形成业务耦合。

## 文件说明

- `basic-primitives.json`：基础几何体模板（box/sphere/plane/line）。
- `irregular-and-advanced.json`：组合与不规则模板（group/shapePlane/irregularGeometry/tube）。
- `business-domain.json`：业务 domain 模板（wall/glass/floor/door/cabinet）。

## 使用建议

- 模板默认只保留最小必要字段，可按需补充 `material`、`children`、业务扩展字段。
- 建议保留 `threeJsonId`，便于编辑器侧定位与运行时对象变更。
- domain 类型建议配合项目内 `domains/*` 的能力使用，避免直接照抄到不兼容运行时。
