# stat-echarts

在 ThreeJSON 场景的 **CSS3D 面板**上挂载 [ECharts](https://echarts.apache.org/)（optional peer）。

## 依赖

```bash
npm install echarts
```

## 用法

1. 场景 JSON 含 `css3dPanelList`（面板 HTML 内留 `#kpi-chart` 容器）。
2. `domainModelList` 增加 `domain: "stat.chart"` 记录，或在 `onSceneReady` 调用：

```js
import { bootstrapStatChartFromRecord } from "threejson/extensions/stat-echarts/bootstrapFromScene.js";

await bootstrapStatChartFromRecord({
  scene,
  record: {
    options: {
      panelRef: "kpi-chart",
      echartsOption: { xAxis: { type: "category", data: ["A", "B"] }, yAxis: {}, series: [{ type: "bar", data: [12, 20] }] }
    }
  }
});
```

3. 需启用 core CSS3D 第二 pass（`createJsonScene` 默认对 `css3dPanelList` 部署面板；页面需 `bootstrapCss3dFromScene` 若仅用 core 入口）。

教程见 `examples/html-demo/track-06-stat/06-04-stat-chart-echarts.html`。
