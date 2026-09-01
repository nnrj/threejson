import * as THREE from "three";

const COMPLEX_MESH_TYPES = new Set([
  "buffermesh",
  "editablemesh",
  "parametricsurface",
  "bezierpatch",
  "nurbssurface",
  "lathemesh",
  "loftmesh",
  "sweepmesh",
  "implicitsurface",
  "sdfmesh"
]);

function objTypeOf(object3D) {
  return String(object3D?.userData?.objJson?.objType || "").trim().toLowerCase();
}

function descriptorId(object3D) {
  return String(object3D?.userData?.objJson?.threeJsonId || "").trim();
}

function parseVec3(text) {
  const values = String(text || "").split(/[\s,]+/).filter(Boolean).map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? values : null;
}

function disposeTree(root) {
  root?.traverse?.((object) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((material) => material?.dispose?.());
    else object.material?.dispose?.();
  });
  root?.removeFromParent?.();
}

function buildControlCage(object3D) {
  const topology = object3D?.userData?.objJson?.topology;
  if (!Array.isArray(topology?.vertices) || !Array.isArray(topology?.faces)) return null;
  const group = new THREE.Group();
  group.name = "ThreeJSON editableMesh control cage";
  group.userData.editorOnly = true;
  const index = new Map(topology.vertices.map((vertex, i) => [vertex.id, i]));
  const positions = new Float32Array(topology.vertices.length * 3);
  topology.vertices.forEach((vertex, i) => positions.set(vertex.position, i * 3));
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(
    pointGeometry,
    new THREE.PointsMaterial({ color: 0xffcc33, size: 7, sizeAttenuation: false, depthTest: false })
  );
  points.renderOrder = 10000;
  points.userData.editorOnly = true;
  group.add(points);
  const edgeSet = new Set();
  const linePositions = [];
  for (const face of topology.faces) {
    for (let i = 0; i < face.vertices.length; i += 1) {
      const a = face.vertices[i];
      const b = face.vertices[(i + 1) % face.vertices.length];
      const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      if (edgeSet.has(key) || !index.has(a) || !index.has(b)) continue;
      edgeSet.add(key);
      linePositions.push(...topology.vertices[index.get(a)].position, ...topology.vertices[index.get(b)].position);
    }
  }
  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
  const lines = new THREE.LineSegments(
    lineGeometry,
    new THREE.LineBasicMaterial({ color: 0x55ddff, transparent: true, opacity: 0.9, depthTest: false })
  );
  lines.renderOrder = 9999;
  lines.userData.editorOnly = true;
  group.add(lines);
  object3D.add(group);
  return group;
}

export function createSceneTreeEditableMeshPanel(host) {
  const dom = {
    section: document.getElementById("sceneTreePropMeshSection"),
    stats: document.getElementById("sceneTreeMeshStats"),
    diagnostics: document.getElementById("sceneTreeMeshDiagnostics"),
    part: document.getElementById("sceneTreeMeshPart"),
    elementMode: document.getElementById("sceneTreeMeshElementMode"),
    vertex: document.getElementById("sceneTreeMeshVertex"),
    vertexPosition: document.getElementById("sceneTreeMeshVertexPosition"),
    edge: document.getElementById("sceneTreeMeshEdge"),
    edgeCrease: document.getElementById("sceneTreeMeshEdgeCrease"),
    face: document.getElementById("sceneTreeMeshFace"),
    morphTarget: document.getElementById("sceneTreeMeshMorphTarget"),
    morphValue: document.getElementById("sceneTreeMeshMorphValue"),
    moveVertex: document.getElementById("sceneTreeMeshMoveVertexBtn"),
    gizmo: document.getElementById("sceneTreeMeshGizmoBtn"),
    setCrease: document.getElementById("sceneTreeMeshSetCreaseBtn"),
    assignPart: document.getElementById("sceneTreeMeshAssignPartBtn"),
    cage: document.getElementById("sceneTreeMeshControlCageBtn"),
    validate: document.getElementById("sceneTreeMeshValidateBtn"),
    extrude: document.getElementById("sceneTreeMeshExtrudeBtn"),
    inset: document.getElementById("sceneTreeMeshInsetBtn"),
    bevel: document.getElementById("sceneTreeMeshBevelBtn"),
    bridge: document.getElementById("sceneTreeMeshBridgeBtn"),
    loopCut: document.getElementById("sceneTreeMeshLoopCutBtn"),
    mirror: document.getElementById("sceneTreeMeshMirrorBtn"),
    subdivide: document.getElementById("sceneTreeMeshSubdivideBtn"),
    smooth: document.getElementById("sceneTreeMeshSmoothBtn"),
    applyMorph: document.getElementById("sceneTreeMeshApplyMorphBtn"),
    bake: document.getElementById("sceneTreeMeshBakeBtn"),
    modifiers: document.getElementById("sceneTreeMeshModifiers"),
    applyModifiers: document.getElementById("sceneTreeMeshApplyModifiersBtn")
  };
  let current = null;
  let cage = null;
  let vertexHandle = null;
  let hiddenSurfaceMaterials = null;

  function restoreSubdivisionSurface() {
    if (!hiddenSurfaceMaterials) return;
    for (const [material, visible] of hiddenSurfaceMaterials) {
      if (material) material.visible = visible;
    }
    hiddenSurfaceMaterials = null;
  }

  function hideSubdivisionSurface() {
    restoreSubdivisionSurface();
    const materials = Array.isArray(current?.material) ? current.material : [current?.material];
    hiddenSurfaceMaterials = new Map();
    for (const material of materials) {
      if (!material) continue;
      hiddenSurfaceMaterials.set(material, material.visible);
      material.visible = false;
    }
  }

  function clearTransient() {
    restoreSubdivisionSurface();
    if (vertexHandle) {
      const handle = vertexHandle;
      vertexHandle = null;
      disposeTree(handle);
    }
    if (cage) {
      disposeTree(cage);
      cage = null;
    }
  }

  function option(select, value, label = value) {
    const el = document.createElement("option");
    el.value = value;
    el.textContent = label;
    select.appendChild(el);
  }

  function selectedVertex() {
    const topology = current?.userData?.objJson?.topology;
    return topology?.vertices?.find((vertex) => vertex.id === dom.vertex?.value) || null;
  }

  function selectedFace() {
    const topology = current?.userData?.objJson?.topology;
    return topology?.faces?.find((face) => face.id === dom.face?.value) || null;
  }

  function topologyEdges(topology = current?.userData?.objJson?.topology) {
    const map = new Map();
    const keyOf = (a, b) => a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    for (const edge of topology?.edges || []) {
      if (!Array.isArray(edge?.vertices) || edge.vertices.length < 2) continue;
      const [a, b] = edge.vertices.map(String);
      map.set(keyOf(a, b), { vertices: [a, b], crease: Number(edge.crease) || 0 });
    }
    for (const face of topology?.faces || []) {
      for (let index = 0; index < face.vertices.length; index += 1) {
        const a = String(face.vertices[index]);
        const b = String(face.vertices[(index + 1) % face.vertices.length]);
        const key = keyOf(a, b);
        if (!map.has(key)) map.set(key, { vertices: [a, b], crease: 0 });
      }
    }
    return [...map.entries()].map(([key, edge]) => ({ key, ...edge }));
  }

  function selectedEdge() {
    return topologyEdges().find((edge) => edge.key === dom.edge?.value) || null;
  }

  function selectedControlVertexIds() {
    const topology = current?.userData?.objJson?.topology;
    if (!topology) return [];
    const mode = dom.elementMode?.value || "vertex";
    if (mode === "edge") return selectedEdge()?.vertices || [];
    if (mode === "face") return selectedFace()?.vertices?.slice() || [];
    if (mode === "part") {
      const part = dom.part?.value;
      if (!part) return [];
      return [...new Set((topology.faces || [])
        .filter((face) => face.part === part)
        .flatMap((face) => face.vertices))];
    }
    const vertex = selectedVertex();
    return vertex ? [vertex.id] : [];
  }

  function updateEdgeCreaseInput() {
    const edge = selectedEdge();
    if (dom.edgeCrease) dom.edgeCrease.value = edge ? String(edge.crease) : "0";
  }

  function morphTargets(object3D = current) {
    if (!Array.isArray(object3D?.morphTargetInfluences)) return [];
    const names = new Map(Object.entries(object3D.morphTargetDictionary || {}).map(([name, index]) => [Number(index), name]));
    return object3D.morphTargetInfluences.map((value, index) => ({
      index,
      name: names.get(index) || String(index),
      value: Number(value) || 0
    }));
  }

  function updateMorphValueInput() {
    const target = morphTargets().find((entry) => String(entry.index) === dom.morphTarget?.value);
    if (dom.morphValue) dom.morphValue.value = target ? String(target.value) : "0";
  }

  function updateVertexPositionInput() {
    const vertex = selectedVertex();
    if (dom.vertexPosition) dom.vertexPosition.value = vertex ? vertex.position.join(", ") : "";
  }

  function refreshControlCage() {
    if (!cage || !current) return;
    disposeTree(cage);
    cage = buildControlCage(current);
    hideSubdivisionSurface();
  }

  async function runMeshEdit(operations, label) {
    const descriptor = current?.userData?.objJson;
    const id = descriptorId(current);
    if (!id || objTypeOf(current) !== "editablemesh") return false;
    const command = {
      op: "mesh.edit",
      args: {
        id,
        baseRevision: Number(descriptor.topology?.revision) || 0,
        operations
      }
    };
    const batch = await host.getCommandLayer().runBatch([command], { label });
    if (batch?.ok === false) {
      host.showMessage(batch.results?.find((entry) => entry?.ok === false)?.error || `${label}失败`, "error");
      return false;
    }
    host.markSceneDirty?.();
    sync(current, { preserveCage: true });
    refreshControlCage();
    host.getSceneTree()?.render?.();
    host.showMessage(label, "success");
    return true;
  }

  async function runFaceOperation(type, valueName, fallback) {
    const face = selectedFace();
    if (!face) return;
    const raw = window.prompt(`${valueName}：`, String(fallback));
    if (raw == null) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      host.showMessage(`${valueName}必须是数字。`, "warning");
      return;
    }
    const operation = { type, faceIds: [face.id] };
    if (type === "extrudeFaces") operation.distance = value;
    else operation.factor = value;
    await runMeshEdit([operation], `${valueName}已应用`);
  }

  function sync(object3D, options = {}) {
    const previous = current;
    const type = objTypeOf(object3D);
    const isMesh = object3D?.isMesh && COMPLEX_MESH_TYPES.has(type);
    if (!isMesh) {
      if (dom.section) dom.section.hidden = true;
      current = null;
      clearTransient();
      return;
    }
    if (previous !== object3D && options.preserveCage !== true) clearTransient();
    current = object3D;
    if (dom.section) dom.section.hidden = false;
    const descriptor = object3D.userData.objJson;
    const positionCount = object3D.geometry?.getAttribute("position")?.count || 0;
    const triangleCount = (object3D.geometry?.index?.count || positionCount) / 3;
    const topology = descriptor.topology || {};
    if (dom.stats) {
      dom.stats.textContent = type === "editablemesh"
        ? `控制顶点 ${topology.vertices?.length || 0} · 控制面 ${topology.faces?.length || 0} · 运行时顶点 ${positionCount} · 三角面 ${Math.round(triangleCount)} · revision ${Number(topology.revision) || 0}`
        : `运行时顶点 ${positionCount} · 三角面 ${Math.round(triangleCount)} · revision ${Number(descriptor.meshRevision) || 0}`;
    }
    for (const control of [
      dom.part, dom.elementMode, dom.vertex, dom.vertexPosition, dom.edge, dom.edgeCrease, dom.face,
      dom.moveVertex, dom.gizmo, dom.setCrease, dom.assignPart, dom.extrude, dom.inset, dom.bevel,
      dom.bridge, dom.loopCut, dom.mirror, dom.subdivide, dom.smooth, dom.modifiers,
      dom.applyModifiers, dom.bake
    ]) {
      if (control) control.disabled = type !== "editablemesh";
    }
    if (dom.cage) dom.cage.disabled = type !== "editablemesh";
    if (dom.validate) dom.validate.disabled = false;
    if (dom.diagnostics) dom.diagnostics.textContent = "";
    const previousMorph = dom.morphTarget?.value;
    if (dom.morphTarget) dom.morphTarget.innerHTML = "";
    const targets = morphTargets(object3D);
    for (const target of targets) option(dom.morphTarget, String(target.index), `${target.name} · ${target.index}`);
    if (targets.some((target) => String(target.index) === previousMorph)) dom.morphTarget.value = previousMorph;
    if (dom.morphTarget) dom.morphTarget.disabled = targets.length === 0;
    if (dom.morphValue) dom.morphValue.disabled = targets.length === 0;
    if (dom.applyMorph) dom.applyMorph.disabled = targets.length === 0;
    updateMorphValueInput();
    if (type !== "editablemesh") {
      clearTransient();
      if (dom.cage) dom.cage.textContent = "查看控制网格";
      return;
    }
    const previousVertex = dom.vertex?.value;
    const previousEdge = dom.edge?.value;
    const previousFace = dom.face?.value;
    const previousPart = dom.part?.value;
    for (const select of [dom.part, dom.vertex, dom.edge, dom.face]) if (select) select.innerHTML = "";
    const parts = [...new Set((topology.faces || []).map((face) => face.part).filter(Boolean))];
    option(dom.part, "", "全部部件");
    for (const part of parts) option(dom.part, part);
    for (const vertex of topology.vertices || []) option(dom.vertex, vertex.id);
    for (const edge of topologyEdges(topology)) option(dom.edge, edge.key, `${edge.vertices[0]} ↔ ${edge.vertices[1]}`);
    for (const face of topology.faces || []) option(dom.face, face.id, `${face.id}${face.part ? ` · ${face.part}` : ""}`);
    if (parts.includes(previousPart)) dom.part.value = previousPart;
    if ((topology.vertices || []).some((vertex) => vertex.id === previousVertex)) dom.vertex.value = previousVertex;
    if (topologyEdges(topology).some((edge) => edge.key === previousEdge)) dom.edge.value = previousEdge;
    if ((topology.faces || []).some((face) => face.id === previousFace)) dom.face.value = previousFace;
    updateVertexPositionInput();
    updateEdgeCreaseInput();
    if (dom.modifiers) dom.modifiers.value = JSON.stringify(descriptor.modifiers || [], null, 2);
  }

  dom.vertex?.addEventListener("change", updateVertexPositionInput);
  dom.edge?.addEventListener("change", updateEdgeCreaseInput);
  dom.morphTarget?.addEventListener("change", updateMorphValueInput);
  dom.part?.addEventListener("change", () => {
    const part = dom.part.value;
    const topology = current?.userData?.objJson?.topology;
    const face = (topology?.faces || []).find((item) => !part || item.part === part);
    if (face && dom.face) dom.face.value = face.id;
  });
  dom.moveVertex?.addEventListener("click", () => {
    const vertex = selectedVertex();
    const position = parseVec3(dom.vertexPosition?.value);
    if (!vertex || !position) {
      host.showMessage("请选择顶点并输入三个有效坐标。", "warning");
      return;
    }
    void runMeshEdit([{ type: "setVertex", id: vertex.id, position }], `已移动控制顶点 ${vertex.id}`);
  });
  dom.gizmo?.addEventListener("click", () => {
    const topology = current?.userData?.objJson?.topology;
    const vertexIds = selectedControlVertexIds();
    const vertexById = new Map((topology?.vertices || []).map((vertex) => [vertex.id, vertex]));
    const vertices = vertexIds.map((id) => vertexById.get(id)).filter(Boolean);
    if (!vertices.length || !current) {
      host.showMessage("请选择要用坐标轴编辑的顶点、边、面或语义部件。", "warning");
      return;
    }
    if (vertexHandle) disposeTree(vertexHandle);
    const geometry = new THREE.SphereGeometry(Math.max(0.02, current.geometry.boundingSphere?.radius * 0.02 || 0.05), 12, 8);
    const material = new THREE.MeshBasicMaterial({ color: 0xffaa00, depthTest: false });
    const handle = new THREE.Mesh(geometry, material);
    const center = vertices.reduce((sum, vertex) => sum.add(new THREE.Vector3(...vertex.position)), new THREE.Vector3())
      .multiplyScalar(1 / vertices.length);
    const sourcePositions = new Map(vertices.map((vertex) => [vertex.id, new THREE.Vector3(...vertex.position)]));
    handle.position.copy(center);
    handle.renderOrder = 10001;
    handle.userData.editorOnly = true;
    current.add(handle);
    vertexHandle = handle;
    host.getEditorInteraction()?.attachMeshElementTransform?.(handle, {
      onCommitTransform: async (transform) => {
        const operations = vertices.map((vertex) => {
          const position = sourcePositions.get(vertex.id).clone()
            .sub(center)
            .multiply(transform.scale)
            .applyQuaternion(transform.quaternion)
            .add(transform.position);
          return { type: "setVertex", id: vertex.id, position: position.toArray() };
        });
        const ok = await runMeshEdit(operations, `已变换 ${operations.length} 个控制顶点`);
        if (!ok) {
          handle.position.copy(center);
          handle.quaternion.identity();
          handle.scale.set(1, 1, 1);
        } else {
          queueMicrotask(() => host.getEditorInteraction()?.detachGizmo?.());
        }
      },
      onDetach: (target) => {
        if (vertexHandle === target) vertexHandle = null;
        disposeTree(target);
      }
    });
  });
  dom.setCrease?.addEventListener("click", () => {
    const edge = selectedEdge();
    const crease = Number(dom.edgeCrease?.value);
    if (!edge || !Number.isFinite(crease) || crease < 0 || crease > 1) {
      host.showMessage("请选择控制边，并输入 0 到 1 之间的折痕值。", "warning");
      return;
    }
    void runMeshEdit([
      { type: "setEdgeCrease", vertices: edge.vertices, crease }
    ], `已设置边折痕 ${edge.vertices.join(" / ")}`);
  });
  dom.assignPart?.addEventListener("click", () => {
    const face = selectedFace();
    if (!face) return;
    const part = window.prompt("语义部件名称（可留空清除）：", face.part || "");
    if (part == null) return;
    void runMeshEdit([{ type: "assignPart", faceIds: [face.id], part }], `已设置面 ${face.id} 的语义部件`);
  });
  dom.cage?.addEventListener("click", () => {
    if (cage) {
      restoreSubdivisionSurface();
      disposeTree(cage);
      cage = null;
      dom.cage.textContent = "查看控制网格";
    } else if (current && objTypeOf(current) === "editablemesh") {
      cage = buildControlCage(current);
      hideSubdivisionSurface();
      dom.cage.textContent = "查看细分结果";
    }
  });
  dom.validate?.addEventListener("click", async () => {
    const id = descriptorId(current);
    if (!id) return;
    const batch = await host.getCommandLayer().runBatch([{
      op: "mesh.validate",
      args: { id, checkSelfIntersectionRisk: objTypeOf(current) === "editablemesh" }
    }], { label: "拓扑诊断" });
    const data = batch?.results?.[0]?.data;
    if (dom.diagnostics) {
      const errors = data?.errors?.length || 0;
      const warnings = data?.warnings?.length || 0;
      const firstIssue = [...(data?.errors || []), ...(data?.warnings || [])][0];
      dom.diagnostics.textContent = data?.ok
        ? `拓扑有效（${warnings} 条提示）${firstIssue?.message ? `：${firstIssue.message}` : ""}`
        : `发现 ${errors} 个错误、${warnings} 条提示：${firstIssue?.message || ""}`;
      const faceId = firstIssue?.faceId || firstIssue?.faceIds?.[0];
      if (faceId && dom.face && [...dom.face.options].some((entry) => entry.value === faceId)) {
        dom.face.value = faceId;
        const face = selectedFace();
        if (face?.part && dom.part && [...dom.part.options].some((entry) => entry.value === face.part)) {
          dom.part.value = face.part;
        }
      }
    }
  });
  dom.extrude?.addEventListener("click", () => void runFaceOperation("extrudeFaces", "拉伸距离", 0.2));
  dom.inset?.addEventListener("click", () => void runFaceOperation("insetFaces", "内插比例", 0.15));
  dom.bevel?.addEventListener("click", () => {
    const edge = selectedEdge();
    if (!edge) {
      void runFaceOperation("bevelEdges", "面边界倒角比例", 0.08);
      return;
    }
    const raw = window.prompt("所选边倒角比例：", "0.08");
    if (raw == null) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) {
      host.showMessage("倒角比例必须是数字。", "warning");
      return;
    }
    void runMeshEdit([{ type: "bevelEdges", edges: [edge.vertices], amount }], "已对所选控制边创建倒角");
  });
  dom.bridge?.addEventListener("click", () => {
    const first = window.prompt("第一条边环的顶点 ID（按顺序，以逗号分隔）：", "");
    if (first == null) return;
    const second = window.prompt("第二条边环的顶点 ID（数量相同、按对应顺序，以逗号分隔）：", "");
    if (second == null) return;
    const loopA = first.split(/[\s,]+/).filter(Boolean);
    const loopB = second.split(/[\s,]+/).filter(Boolean);
    if (loopA.length < 2 || loopA.length !== loopB.length) {
      host.showMessage("两条边环必须包含相同数量且不少于两个顶点。", "warning");
      return;
    }
    void runMeshEdit([{ type: "bridgeLoops", loopA, loopB }], "已桥接两条控制边环");
  });
  dom.loopCut?.addEventListener("click", () => void runFaceOperation("loopCut", "环切位置", 0.5));
  dom.mirror?.addEventListener("click", () => {
    const axis = String(window.prompt("镜像轴 x / y / z：", "x") || "").toLowerCase();
    if (!["x", "y", "z"].includes(axis)) return;
    void runMeshEdit([{ type: "mirror", axis, merge: true }], `已沿 ${axis.toUpperCase()} 轴镜像`);
  });
  dom.subdivide?.addEventListener("click", () => {
    const levels = Number(window.prompt("Catmull–Clark 细分级别：", "1"));
    if (!Number.isSafeInteger(levels) || levels < 1) return;
    void runMeshEdit([{
      type: "setModifier",
      id: "editor-subdivision",
      modifier: { id: "editor-subdivision", type: "catmullClark", levels }
    }], `已设置 ${levels} 级细分曲面`);
  });
  dom.smooth?.addEventListener("click", () => {
    const factor = Number(window.prompt("平滑强度（0–1）：", "0.35"));
    if (!Number.isFinite(factor) || factor < 0 || factor > 1) return;
    void runMeshEdit([{
      type: "setModifier",
      id: "editor-smooth",
      modifier: { id: "editor-smooth", type: "smooth", iterations: 1, factor }
    }], "已更新控制网格平滑 Modifier");
  });
  dom.applyMorph?.addEventListener("click", async () => {
    const id = descriptorId(current);
    const target = Number(dom.morphTarget?.value);
    const value = Number(dom.morphValue?.value);
    if (!id || !Number.isSafeInteger(target) || !Number.isFinite(value)) return;
    const batch = await host.getCommandLayer().runBatch([
      { op: "morph.set", args: { id, target, value } }
    ], { label: "调整 Morph Target" });
    if (batch?.ok === false) host.showMessage(batch.results?.[0]?.error || "Morph 调整失败。", "error");
    else {
      host.markSceneDirty?.();
      sync(current, { preserveCage: true });
      host.showMessage("Morph Target 已更新。", "success");
    }
  });
  dom.applyModifiers?.addEventListener("click", async () => {
    if (!descriptorId(current)) return;
    let modifiers;
    try {
      modifiers = JSON.parse(dom.modifiers.value || "[]");
      if (!Array.isArray(modifiers)) throw new Error("Modifiers 必须是数组。");
    } catch (error) {
      host.showMessage(`Modifiers JSON 无效：${error?.message || error}`, "error");
      return;
    }
    await runMeshEdit([{ type: "setModifiers", modifiers }], "已更新网格 Modifier");
  });
  dom.bake?.addEventListener("click", async () => {
    const id = descriptorId(current);
    if (!id || !window.confirm("Bake 后控制拓扑和 Modifier 将转换为完整 BufferMesh。是否继续？")) return;
    const batch = await host.getCommandLayer().runBatch([{ op: "mesh.bake", args: { id } }], { label: "Bake 可编辑网格" });
    if (batch?.ok === false) host.showMessage(batch.results?.[0]?.error || "Bake 失败。", "error");
    else {
      host.getSceneTree()?.setSelectionByThreeJsonId?.(id);
      sync(host.getSelectedObject());
      host.showMessage("已 Bake 为 BufferMesh。", "success");
    }
  });

  return { sync, clear: clearTransient };
}
