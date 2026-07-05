import test from "node:test";
import assert from "node:assert/strict";

import { generatedBusinessDomainDescriptors } from "../builtins/builtinDomainManifest.generated.js";
import { createStatBarJson, normalizeStatBarItem } from "../domains/stat/bar/barHandler.js";
import { createStatGridJson } from "../domains/stat/grid/gridHandler.js";
import { createStatLineJson } from "../domains/stat/line/lineHandler.js";
import { createStatPieJson } from "../domains/stat/pie/pieHandler.js";
import { sliceToThetaRanges } from "../domains/stat/statSliceMath.js";
import { createStatRingJson } from "../domains/stat/ring/ringHandler.js";
import { createStatPanelJson } from "../domains/stat/panel/panelHandler.js";
import { mapUtilizationRateToColor, normalizeUtilizationRate, pickSeriesColor } from "../domains/stat/statShared.js";
import {
  buildStatLabelRecord,
  resolveSliceChartLabelOrientation,
  resolveStatLabelMode
} from "../domains/stat/statLabelBuilder.js";

test("stat domains registered in manifest", () => {
  const ids = generatedBusinessDomainDescriptors.map((d) => d.id);
  assert.ok(ids.includes("stat"));
  assert.ok(ids.includes("stat.bar"));
  assert.ok(ids.includes("stat.grid"));
  assert.ok(ids.includes("stat.panel"));
  assert.ok(ids.includes("stat.chart"));
  assert.ok(ids.includes("stat.line"));
  assert.ok(ids.includes("stat.pie"));
  assert.ok(ids.includes("stat.ring"));
});

test("normalizeStatBarItem requires value and max", () => {
  assert.equal(normalizeStatBarItem({ value: 1, max: 2 })?.max, 2);
  assert.equal(normalizeStatBarItem({ used: 3, total: 10 })?.used, 3);
  assert.equal(normalizeStatBarItem({ value: 1 }), null);
});

test("createStatBarJson scales height by utilization", () => {
  const desc = createStatBarJson({
    value: 50,
    max: 100,
    geometry: { height: 100, width: 36, depth: 28 }
  });
  assert.equal(desc.objType, "statBarGroup");
  assert.equal(desc.boxModelList[0].objType, "statBar");
  assert.equal(desc.boxModelList[0].geometry.height, 50);
  assert.ok(desc.boxModelList[0].businessInfo.statLabel);
});

test("createStatBarJson carries labelStyle into businessInfo", () => {
  const desc = createStatBarJson(
    {
      value: 2,
      max: 24
    },
    {
      labelStyle: {
        fontSizePx: 26,
        autoFit: true,
        fitRatio: 0.8
      }
    }
  );
  assert.equal(desc.boxModelList[0].businessInfo.labelStyle.fontSizePx, 26);
  assert.equal(desc.boxModelList[0].businessInfo.labelStyle.fitRatio, 0.8);
});

test("mapUtilizationRateToColor thresholds", () => {
  assert.equal(mapUtilizationRateToColor(0.1), "#78B83E");
  assert.equal(mapUtilizationRateToColor(0.95), "#DC3A2E");
});

test("createStatGridJson returns items and layout options", () => {
  const json = createStatGridJson([{ value: 1, max: 2 }], { columns: 3 });
  assert.equal(json.items.length, 1);
  assert.equal(json.options.columns, 3);
});

test("createStatPanelJson embeds multiline statLabel", () => {
  const json = createStatPanelJson({
    lines: ["A", "B"]
  });
  assert.equal(json.objType, "statPanel");
  assert.match(json.boxModelList[0].businessInfo.statLabel, /A\nB/);
});

test("createStatPanelJson keeps labelStyle configuration", () => {
  const json = createStatPanelJson({
    lines: ["KPI", "2/24"],
    labelStyle: {
      fontSizePx: 24,
      autoFit: true,
      fitRatio: 0.85,
      minFontPx: 16
    }
  });
  assert.equal(json.boxModelList[0].businessInfo.labelStyle.fontSizePx, 24);
  assert.equal(json.boxModelList[0].businessInfo.labelStyle.autoFit, true);
  assert.equal(json.boxModelList[0].businessInfo.labelStyle.minFontPx, 16);
});

test("createStatPanelJson uses vertical board geometry by default", () => {
  const json = createStatPanelJson({});
  const geom = json.boxModelList[0].geometry;
  assert.equal(geom.height, 48);
  assert.equal(geom.depth, 0.8);
  assert.equal(json.boxModelList[0].position.y, 24);
  assert.match(json.boxModelList[0].businessInfo.statLabel, /Stat Panel/);
});

test("normalizeUtilizationRate clamps", () => {
  assert.equal(normalizeUtilizationRate(150, 100), 1);
  assert.equal(normalizeUtilizationRate(-1, 100), 0);
});

test("pickSeriesColor uses override or palette", () => {
  assert.equal(pickSeriesColor(0, "#ff0000"), "#ff0000");
  assert.equal(pickSeriesColor(1), pickSeriesColor(9));
});

test("sliceToThetaRanges allocates full circle", () => {
  const ranges = sliceToThetaRanges([
    { value: 25 },
    { value: 75 }
  ]);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].thetaStart, 0);
  assert.ok(Math.abs(ranges[0].thetaLength - Math.PI / 2) < 1e-6);
  assert.ok(Math.abs(ranges[1].thetaLength - (Math.PI * 3) / 2) < 1e-6);
});

test("createStatLineJson builds Line2 group with markers", () => {
  const groups = createStatLineJson({
    options: { showDropLines: true, showMarkers: true },
    series: [
      {
        name: "a",
        points: [
          { x: 0, y: 10, z: 0, label: "P0" },
          { x: 10, y: 20, z: 0 }
        ]
      }
    ]
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].objType, "statLineGroup");
  assert.ok(groups[0].subScene.some((child) => child.objType === "line" && !child.topology));
  assert.ok(groups[0].subScene.some((child) => child.objType === "sphere"));
  assert.ok(groups[0].subScene.some((child) => child.businessInfo?.statLabel === "P0"));
});

test("createStatPieJson builds cylinder slices with labels", () => {
  const desc = createStatPieJson({
    options: { radius: 30, height: 12 },
    slices: [
      { value: 40, label: "A" },
      { value: 60, label: "B" }
    ]
  });
  assert.equal(desc.objType, "statPieGroup");
  const cylinders = desc.subScene.filter((child) => child.objType === "cylinder");
  assert.equal(cylinders.length, 2);
  assert.ok(cylinders[0].geometry.thetaLength > 0);
  assert.ok(desc.subScene.some((child) => child.businessInfo?.statLabel === "A"));
});

test("createStatPieJson positions flat sdf labels on slice top", () => {
  const desc = createStatPieJson({
    options: {
      height: 16,
      labelStyle: { labelMode: "sdf", fontSize: 3 }
    },
    slices: [{ value: 100, label: "A" }]
  });
  const label = desc.subScene.find((child) => child.objType === "text");
  assert.ok(label);
  assert.ok(label.position.y >= 16 && label.position.y <= 16.05);
  assert.equal(label.billboard, false);
  assert.equal(label.rotation.rotationX, -Math.PI / 2);
});

test("createStatPieJson supports upright labelOrientation", () => {
  const desc = createStatPieJson({
    options: {
      height: 16,
      labelStyle: { labelMode: "sdf", fontSize: 3, labelOrientation: "upright" }
    },
    slices: [{ value: 100, label: "A" }]
  });
  const label = desc.subScene.find((child) => child.objType === "text");
  assert.ok(label);
  assert.ok(label.position.y >= 16 + 1.5 + 0.8);
  assert.equal(label.billboard, true);
  assert.equal(label.rotation, undefined);
});

test("createStatRingJson builds CSG holes per slice", () => {
  const desc = createStatRingJson({
    options: { outerRadius: 40, innerRadius: 20, height: 10 },
    slices: [{ value: 50 }, { value: 50 }]
  });
  assert.equal(desc.objType, "statRingGroup");
  const slices = desc.subScene.filter((child) => child.objType === "cylinder");
  assert.equal(slices.length, 2);
  assert.equal(slices[0].holes?.length, 1);
  assert.equal(slices[0].holes[0].geometry.radiusTop, 20);
  assert.equal(slices[0].position.y, 5);
  assert.equal(slices[0].holes[0].position.y, 5);
  assert.ok(slices[0].holes[0].geometry.height >= 10);
});

test("resolveStatLabelMode supports sdf texture mesh and box", () => {
  assert.equal(resolveStatLabelMode({ labelMode: "sdf" }), "sdf");
  assert.equal(resolveStatLabelMode({ labelMode: "texture" }), "texture");
  assert.equal(resolveStatLabelMode({ labelMode: "mesh" }), "mesh");
  assert.equal(resolveStatLabelMode({ labelMode: "box" }), "box");
  assert.equal(resolveStatLabelMode({}, { labelMode: "sdf" }), "sdf");
});

test("buildStatLabelRecord emits objType text for sdf mode", () => {
  const record = buildStatLabelRecord({
    name: "lbl",
    content: "Q1",
    position: { x: 0, y: 5, z: 0 },
    statKind: "stat.line",
    labelStyle: { labelMode: "sdf", fontSize: 0.8 }
  });
  assert.equal(record.objType, "text");
  assert.equal(record.mode, "sdf");
  assert.equal(record.content, "Q1");
  assert.equal(record.billboard, true);
});

test("buildStatLabelRecord disables billboard for pie labels by default", () => {
  const record = buildStatLabelRecord({
    name: "lbl-d",
    content: "D",
    position: { x: 1, y: 20, z: 0 },
    statKind: "stat.pie",
    labelStyle: { labelMode: "sdf", fontSize: 3 }
  });
  assert.equal(record.billboard, false);
  assert.equal(record.rotation.rotationX, -Math.PI / 2);
});

test("resolveSliceChartLabelOrientation defaults flat and accepts upright", () => {
  assert.equal(resolveSliceChartLabelOrientation({}, {}), "flat");
  assert.equal(resolveSliceChartLabelOrientation({ labelOrientation: "upright" }, {}), "upright");
  assert.equal(
    resolveSliceChartLabelOrientation({}, {}, { labelOrientation: "vertical" }),
    "upright"
  );
});

test("createStatLineJson uses 3D text labels when labelMode is sdf", () => {
  const groups = createStatLineJson({
    options: { labelStyle: { labelMode: "sdf" } },
    series: [
      {
        name: "a",
        points: [
          { x: 0, y: 10, z: 0, label: "P0" },
          { x: 10, y: 20, z: 0 }
        ]
      }
    ]
  });
  assert.ok(groups[0].subScene.some((child) => child.objType === "text" && child.mode === "sdf"));
});

test("createStatBarJson adds text subScene when labelMode is mesh", () => {
  const desc = createStatBarJson(
    { value: 50, max: 100 },
    {
      labelStyle: {
        labelMode: "mesh",
        mesh: { fontJsonUrl: "/assets/fonts/helvetiker_bold.typeface.json" }
      }
    }
  );
  assert.equal(desc.boxModelList[0].businessInfo?.statLabel, undefined);
  assert.ok(desc.subScene?.some((child) => child.objType === "text" && child.mode === "mesh"));
});
