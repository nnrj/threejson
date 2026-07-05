/**
 * stat.line: Line2 polyline groups with optional drop lines and markers.
 */
import { clonePlainObject, pickSeriesColor } from "./statShared.js";
import { buildStatLabelRecord, resolveStatLabelMode, usesStatTextLabel } from "./statLabelBuilder.js";

/**
 * @param {object} series
 * @param {object} [options]
 * @returns {object}
 */
export function buildStatLineGroupJson(series = {}, options = {}) {
  const baseY = Number(options.baseY) || 0;
  const linewidth = Number(options.linewidth) || 2.5;
  const showDropLines = options.showDropLines !== false;
  const showMarkers = options.showMarkers !== false;
  const markerRadius = Number(options.markerRadius) || 1.2;
  const labelStyle =
    options.labelStyle && typeof options.labelStyle === "object" ? options.labelStyle : undefined;
  const statKind = options.statKind || "stat.line";
  const seriesIndex = Number(options.seriesIndex) || 0;
  const seriesName = series.name || `statLine-${seriesIndex + 1}`;
  const color = pickSeriesColor(seriesIndex, series.color);
  const rawPoints = Array.isArray(series.points) ? series.points : [];
  /** @type {object[]} */
  const subScene = [];

  if (rawPoints.length >= 2) {
    subScene.push({
      name: `${seriesName}-line`,
      objType: "line",
      points: rawPoints.map((point) => ({
        x: Number(point?.x) || 0,
        y: Number(point?.y) ?? baseY,
        z: Number(point?.z) || 0
      })),
      material: {
        color,
        linewidth,
        transparent: true,
        opacity: series.opacity ?? options.lineOpacity ?? 0.95
      }
    });
  }

  for (let i = 0; i < rawPoints.length; i++) {
    const point = rawPoints[i];
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) ?? baseY;
    const z = Number(point?.z) || 0;

    if (showDropLines) {
      subScene.push({
        name: `${seriesName}-drop-${i}`,
        objType: "line",
        topology: "lineSegments",
        points: [
          { x, y: baseY, z },
          { x, y, z }
        ],
        material: {
          color,
          opacity: options.dropLineOpacity ?? 0.35,
          transparent: true
        }
      });
    }

    if (showMarkers) {
      subScene.push({
        name: `${seriesName}-marker-${i}`,
        objType: "sphere",
        geometry: { radius: markerRadius },
        position: { x, y, z },
        material: {
          color,
          transparent: true,
          opacity: options.markerOpacity ?? 0.92
        }
      });
    }

    const pointLabel = point?.label;
    if (typeof pointLabel === "string" && pointLabel.trim()) {
      const labelWidth = Number(options.labelWidth) || 10;
      const labelHeight = Number(options.labelHeight) || 6;
      const labelGap = Number(options.labelGap) || 0.8;
      const pointLabelStyle =
        point.labelStyle && typeof point.labelStyle === "object" ? point.labelStyle : labelStyle;
      const labelMode = resolveStatLabelMode(pointLabelStyle, options, point);
      const labelY = usesStatTextLabel(labelMode)
        ? y + markerRadius + labelGap
        : y + markerRadius + labelGap + labelHeight / 2;
      subScene.push(
        buildStatLabelRecord({
          name: `${seriesName}-label-${i}`,
          content: pointLabel.trim(),
          position: { x, y: labelY, z },
          statKind,
          labelStyle: pointLabelStyle,
          options,
          item: point,
          color,
          geometry: { width: labelWidth, height: labelHeight, depth: 0.25 }
        })
      );
    }
  }

  return {
    name: seriesName,
    objType: options.groupObjType || "statLineGroup",
    position: clonePlainObject(series.position || { x: 0, y: 0, z: 0 }),
    rotation: clonePlainObject(
      series.rotation || { rotationX: 0, rotationY: 0, rotationZ: 0 }
    ),
    scale: clonePlainObject(series.scale || { scaleX: 1, scaleY: 1, scaleZ: 1 }),
    subScene
  };
}

/**
 * @param {object} record
 * @returns {object[]}
 */
export function buildStatLineGroupsJson(record = {}) {
  const options = record?.options && typeof record.options === "object" ? record.options : {};
  const seriesList = Array.isArray(record.series) ? record.series : [];
  return seriesList.map((series, index) =>
    buildStatLineGroupJson(series, { ...options, seriesIndex: index })
  );
}
