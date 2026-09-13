import * as THREE from "three";
import { prepareBufferMeshDraft } from "../document/bufferMeshDraft.js";
import { describeBufferGeometry } from "../document/geometryDescriptor.js";
import { getObjectByThreeJsonId, registerObject } from "../handler/objectRegistry.js";
import { setUserDataObjJson } from "../handler/objectDescriptorAttach.js";
import { buildBufferMeshGeometry } from "../builder/bufferMeshBuilder.js";
import { buildEditableMeshGeometry } from "../builder/editableMesh/editableMeshBuilder.js";
import {
  buildTopologyIndexes,
  normalizeEditableMeshTopology,
  validateEditableMeshTopology
} from "../builder/editableMesh/editableMeshTopology.js";
import {
  applyEditableMeshOperations,
  invertEditableTopologyDiff
} from "./editableMeshOperations.js";

const bufferDrafts = new WeakMap();

function cloneJson(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizeObjType(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveMesh(ctx, id) {
  const threeJsonId = String(id || "").trim();
  if (!threeJsonId) throw new Error("mesh command requires args.id.");
  const object3D = ctx?.options?.getObjectById ? ctx.options.getObjectById(threeJsonId) : getObjectByThreeJsonId(threeJsonId, ctx?.scene);
  if (!object3D?.isMesh || !object3D.geometry?.isBufferGeometry) throw new Error(`Mesh \"${threeJsonId}\" was not found.`);
  const descriptor = object3D.userData?.objJson;
  if (!descriptor || typeof descriptor !== "object") throw new Error(`Mesh \"${threeJsonId}\" has no ThreeJSON descriptor.`);
  return { threeJsonId, object3D, descriptor };
}

function geometryStats(geometry) {
  const position = geometry.getAttribute("position");
  const indexCount = geometry.index?.count || 0;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  return {
    vertexCount: position?.count || 0,
    triangleCount: (indexCount || position?.count || 0) / 3,
    indexType: geometry.index?.array?.constructor?.name || null,
    indexed: Boolean(geometry.index),
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, {
      itemSize: attribute.itemSize,
      count: attribute.count,
      type: attribute.array?.constructor?.name,
      normalized: attribute.normalized === true
    }])),
    groups: geometry.groups.map((group) => ({ ...group })),
    boundingBox: geometry.boundingBox ? {
      min: geometry.boundingBox.min.toArray(),
      max: geometry.boundingBox.max.toArray()
    } : null
  };
}

function attachCommittedDescriptor(target, descriptor, scene) {
  setUserDataObjJson(target, descriptor);
  registerObject(target, target.userData.objJson, { recursive: false }, scene || target);
}

function swapGeometry(target, nextGeometry) {
  const previous = target.geometry;
  target.geometry = nextGeometry;
  target.geometry.attributes.position.needsUpdate = true;
  if (previous && previous !== nextGeometry) previous.dispose();
}

function recordTransaction(ctx, transaction) {
  const sink = ctx?.options?.recordMeshTransaction || ctx?.runtime?.recordMeshTransaction;
  if (typeof sink === "function") {
    try { sink(transaction); }
    catch (error) { ctx?.options?.onObserverError?.(error); }
  }
}

export function inspectRuntimeMesh(ctx, args = {}) {
  const { threeJsonId, object3D, descriptor } = resolveMesh(ctx, args.id);
  const type = normalizeObjType(descriptor.objType);
  const topology = type === "editablemesh" ? normalizeEditableMeshTopology(descriptor.topology || {}) : null;
  const validation = topology ? validateEditableMeshTopology(topology) : null;
  return {
    threeJsonId,
    objType: descriptor.objType,
    revision: topology?.revision ?? Math.max(0, Math.round(Number(descriptor.meshRevision) || 0)),
    geometry: geometryStats(object3D.geometry),
    controlTopology: topology ? validation.statistics : null,
    parts: validation?.statistics?.parts || [],
    modifiers: cloneJson(Array.isArray(descriptor.modifiers) ? descriptor.modifiers : []),
    materialSlots: Array.isArray(object3D.material) ? object3D.material.length : object3D.material ? 1 : 0
  };
}

function vertexInBounds(vertex, bounds) {
  if (!bounds || typeof bounds !== "object") return true;
  const min = Array.isArray(bounds.min) ? bounds.min : [-Infinity, -Infinity, -Infinity];
  const max = Array.isArray(bounds.max) ? bounds.max : [Infinity, Infinity, Infinity];
  return vertex.position.every((value, index) => value >= Number(min[index] ?? -Infinity) && value <= Number(max[index] ?? Infinity));
}

export function getRuntimeMeshTopology(ctx, args = {}) {
  const { threeJsonId, descriptor } = resolveMesh(ctx, args.id);
  if (normalizeObjType(descriptor.objType) !== "editablemesh") throw new Error("mesh.getTopology requires objType editableMesh.");
  const topology = normalizeEditableMeshTopology(descriptor.topology || {});
  const ids = new Set((args.vertexIds || []).map(String));
  let vertices = topology.vertices.filter((vertex) =>
    (ids.size === 0 || ids.has(vertex.id)) && vertexInBounds(vertex, args.bounds)
  );
  let faces = topology.faces.filter((face) => {
    if (args.part != null && face.part !== args.part) return false;
    if (Array.isArray(args.faceIds) && args.faceIds.length > 0 && !args.faceIds.map(String).includes(face.id)) return false;
    return ids.size === 0 || face.vertices.some((id) => ids.has(id));
  });
  if (faces.length > 0 && ids.size === 0 && !args.bounds) {
    const referenced = new Set(faces.flatMap((face) => face.vertices));
    vertices = topology.vertices.filter((vertex) => referenced.has(vertex.id));
  }
  const page = Math.max(1, Math.round(Number(args.page) || 1));
  const pageSize = Math.max(1, Math.round(Number(args.pageSize) || 250));
  const vertexStart = (page - 1) * pageSize;
  const faceStart = (page - 1) * pageSize;
  return {
    threeJsonId,
    revision: topology.revision,
    page,
    pageSize,
    totals: { vertices: vertices.length, faces: faces.length },
    vertices: cloneJson(vertices.slice(vertexStart, vertexStart + pageSize)),
    faces: cloneJson(faces.slice(faceStart, faceStart + pageSize)),
    edges: args.includeEdges === false ? undefined : cloneJson(topology.edges),
    hasMore: vertexStart + pageSize < vertices.length || faceStart + pageSize < faces.length
  };
}

export function validateRuntimeMesh(ctx, args = {}) {
  const { threeJsonId, object3D, descriptor } = resolveMesh(ctx, args.id);
  if (normalizeObjType(descriptor.objType) === "editablemesh") {
    return {
      threeJsonId,
      revision: Number(descriptor.topology?.revision) || 0,
      ...validateEditableMeshTopology(descriptor.topology || {}, {
        checkSelfIntersectionRisk: args.checkSelfIntersectionRisk === true
      })
    };
  }
  const stats = geometryStats(object3D.geometry);
  const errors = [];
  const position = object3D.geometry.getAttribute("position");
  if (!position || position.itemSize !== 3) errors.push({ code: "E_BUFFER_MESH_POSITION", message: "Position attribute is missing or not itemSize 3." });
  if (object3D.geometry.index) {
    for (let i = 0; i < object3D.geometry.index.count; i += 1) {
      const index = object3D.geometry.index.getX(i);
      if (index < 0 || index >= position.count) {
        errors.push({ code: "E_BUFFER_MESH_INDEX_OUT_OF_RANGE", indexPosition: i, value: index, message: "Index is outside the position attribute." });
        break;
      }
    }
  }
  return { threeJsonId, ok: errors.length === 0, errors, warnings: [], statistics: stats };
}

function canPatchEditablePositionsDirectly(descriptor, operations) {
  return (!Array.isArray(descriptor.modifiers) || descriptor.modifiers.every((modifier) => modifier?.enabled === false || /^uv/i.test(String(modifier?.type || ""))))
    && operations.length > 0
    && operations.every((operation) => String(operation?.type || operation?.op || "") === "setVertex");
}

export function editRuntimeMesh(ctx, args = {}) {
  const resolved = resolveMesh(ctx, args.id);
  const { object3D, descriptor, threeJsonId } = resolved;
  if (normalizeObjType(descriptor.objType) !== "editablemesh") throw new Error("mesh.edit requires objType editableMesh.");
  const revision = Math.max(0, Math.round(Number(descriptor.topology?.revision) || 0));
  if (args.baseRevision != null && Number(args.baseRevision) !== revision) {
    const error = new Error(`Mesh revision conflict: expected ${args.baseRevision}, current ${revision}.`);
    error.code = "E_MESH_REVISION_CONFLICT";
    throw error;
  }
  const operations = Array.isArray(args.operations) ? args.operations : [];
  if (operations.length === 0) throw new Error("mesh.edit requires a non-empty operations array.");
  const result = applyEditableMeshOperations(descriptor, operations);
  const built = buildEditableMeshGeometry(result.record, {
    meshBudget: ctx?.options?.meshBudget
  });
  if (!built.geometry) {
    const error = new Error(built.error || "Failed to evaluate edited mesh.");
    error.code = built.code;
    throw error;
  }

  let strategy = "atomic-geometry-swap";
  if (canPatchEditablePositionsDirectly(descriptor, operations)) {
    const position = object3D.geometry.getAttribute("position");
    const topology = normalizeEditableMeshTopology(result.record.topology);
    if (position?.count === topology.vertices.length) {
      const originalIndexes = buildTopologyIndexes(normalizeEditableMeshTopology(descriptor.topology));
      position.clearUpdateRanges?.();
      for (const change of result.diff.vertices.changed || []) {
        const index = originalIndexes.vertexById.get(change.after.id)?.index;
        if (!Number.isInteger(index)) continue;
        position.setXYZ(index, ...change.after.position);
        position.addUpdateRange?.(index * position.itemSize, position.itemSize);
      }
      if ((result.diff.vertices.changed || []).length > 0) position.needsUpdate = true;
      object3D.geometry.computeVertexNormals();
      object3D.geometry.computeBoundingBox();
      object3D.geometry.computeBoundingSphere();
      built.geometry.dispose();
      strategy = "position-range-update";
    } else {
      swapGeometry(object3D, built.geometry);
    }
  } else {
    swapGeometry(object3D, built.geometry);
  }
  attachCommittedDescriptor(object3D, result.record, ctx.scene);
  object3D.userData.threeJsonMeshStats = built.stats;
  const inverseDiff = invertEditableTopologyDiff(result.diff);
  const transaction = {
    kind: "mesh.edit",
    threeJsonId,
    fromRevision: revision,
    toRevision: result.topology.revision,
    diff: result.diff,
    undo: { op: "mesh.edit", args: { id: threeJsonId, baseRevision: result.topology.revision, operations: [{ type: "applyDiff", diff: inverseDiff }] } }
  };
  recordTransaction(ctx, transaction);
  return {
    threeJsonId,
    revision: result.topology.revision,
    strategy,
    diff: result.diff,
    undo: transaction.undo,
    statistics: built.stats,
    warnings: result.validation.warnings
  };
}

function prepareRuntimeBufferEdit(ctx, args, operation) {
  const resolved = resolveMesh(ctx, args.id);
  const prepared = prepareBufferMeshDraft(resolved.descriptor, bufferDrafts.get(resolved.object3D), operation, args);
  if (prepared.draft) bufferDrafts.set(resolved.object3D, prepared.draft);
  else bufferDrafts.delete(resolved.object3D);
  return prepared.data;
}

export const appendRuntimeMeshAttribute = (ctx, args = {}) => prepareRuntimeBufferEdit(ctx, args, "appendAttribute");
export const setRuntimeMeshAttributeRange = (ctx, args = {}) => prepareRuntimeBufferEdit(ctx, args, "setAttributeRange");
export const appendRuntimeMeshIndices = (ctx, args = {}) => prepareRuntimeBufferEdit(ctx, args, "appendIndices");
export const setRuntimeMeshIndexRange = (ctx, args = {}) => prepareRuntimeBufferEdit(ctx, args, "setIndexRange");
export const cancelRuntimeMeshBuffer = (ctx, args = {}) => prepareRuntimeBufferEdit(ctx, args, "cancel");

export function commitRuntimeMeshBuffer(ctx, args = {}) {
  const resolved = resolveMesh(ctx, args.id);
  const previous = bufferDrafts.get(resolved.object3D);
  const { descriptor, data } = prepareBufferMeshDraft(resolved.descriptor, previous, "commit", args);
  const built = buildBufferMeshGeometry(descriptor, { meshBudget: ctx?.options?.meshBudget, resolveBufferReference: ctx?.options?.resolveBufferReference });
  if (!built.geometry) {
    const error = new Error(built.error || "Buffer transaction failed validation.");
    error.code = built.code;
    throw error;
  }
  swapGeometry(resolved.object3D, built.geometry);
  attachCommittedDescriptor(resolved.object3D, descriptor, ctx.scene);
  resolved.object3D.userData.threeJsonMeshStats = built.stats;
  bufferDrafts.delete(resolved.object3D);
  recordTransaction(ctx, { kind: "mesh.buffer.commit", threeJsonId: resolved.threeJsonId, fromRevision: previous.baseRevision, toRevision: descriptor.meshRevision, changed: data.changed });
  return { ...data, statistics: built.stats };
}

export function bakeRuntimeEditableMesh(ctx, args = {}) {
  const resolved = resolveMesh(ctx, args.id);
  if (normalizeObjType(resolved.descriptor.objType) !== "editablemesh") throw new Error("mesh.bake requires objType editableMesh.");
  const geometry = resolved.object3D.geometry;
  const descriptor = {
    ...cloneJson(resolved.descriptor),
    objType: "bufferMesh",
    geometry: describeBufferGeometry(geometry),
    meshRevision: Math.max(0, Math.round(Number(resolved.descriptor.topology?.revision) || 0)) + 1
  };
  delete descriptor.topology;
  delete descriptor.modifiers;
  attachCommittedDescriptor(resolved.object3D, descriptor, ctx.scene);
  return { threeJsonId: resolved.threeJsonId, revision: descriptor.meshRevision, descriptor: args.includeDescriptor === false ? undefined : descriptor, statistics: geometryStats(geometry) };
}

export async function renderRuntimeMeshViews(ctx, args = {}) {
  const resolved = resolveMesh(ctx, args.id);
  const renderer = ctx?.options?.renderMeshViews || ctx?.runtime?.renderMeshViews;
  if (typeof renderer !== "function") throw new Error("mesh.renderViews requires a host-provided renderMeshViews callback.");
  return renderer({ object3D: resolved.object3D, descriptor: resolved.descriptor, views: args.views || ["front", "right", "back", "top", "perspective"], size: args.size });
}
