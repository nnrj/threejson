/**
 * boxModelList preprocessing: aggregate instances and merged geometry descriptors by instanceCode / mergeCode.
 */
import { log } from "../util/logger.js";

/**
 * @param {object} record
 * @returns {object}
 */
function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

/**
 * @returns {{ position: object, rotation: object, scale: object }}
 */
function defaultTransformTriple() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { rotationX: 0, rotationY: 0, rotationZ: 0 },
    scale: { scaleX: 1, scaleY: 1, scaleZ: 1 }
  };
}

/**
 * @param {object|null|undefined} record
 * @returns {{ position: object, rotation: object, scale: object }}
 */
function snapshotTransform(record) {
  const defaults = defaultTransformTriple();
  return {
    position: record?.position ?? defaults.position,
    rotation: record?.rotation ?? defaults.rotation,
    scale: record?.scale ?? defaults.scale
  };
}

/**
 * @param {object|null|undefined} record
 * @returns {{ joins: object[], inters: object[], holes: object[] }}
 */
function snapshotCombine(record) {
  return {
    joins: record?.joins ?? [],
    inters: record?.inters ?? [],
    holes: record?.holes ?? []
  };
}

/**
 * @param {object|null|undefined} box
 * @returns {boolean}
 */
function isPremergedInstanceBox(box) {
  return (
    box?.instance === true &&
    Array.isArray(box.transforms) &&
    box.transforms.length > 0
  );
}

/**
 * @param {object[]} input
 * @returns {object[]}
 */
function coalesceInstances(input) {
  /** @type {object[]} */
  const passthrough = [];
  /** @type {Map<string, { template: object, transforms: object[], combineArr: object[], businessInfoArr: object[] }>} */
  const groups = new Map();

  for (let i = 0; i < input.length; i++) {
    const box = input[i];
    if (!box?.instanceCode || isPremergedInstanceBox(box)) {
      passthrough.push(box);
      continue;
    }
    const code = box.instanceCode;
    let group = groups.get(code);
    if (!group) {
      group = {
        template: cloneRecord(box),
        transforms: [],
        combineArr: [],
        businessInfoArr: []
      };
      groups.set(code, group);
    }
    group.transforms.push(snapshotTransform(box));
    group.combineArr.push(snapshotCombine(box));
    group.businessInfoArr.push(box.businessInfo ?? {});
  }

  /** @type {object[]} */
  const instanceRecords = [];
  for (const group of groups.values()) {
    const record = group.template;
    record.instance = true;
    record.transforms = group.transforms;
    record.combineArr = group.combineArr;
    record.businessInfoArr = group.businessInfoArr;
    instanceRecords.push(record);
  }

  log.debug("[coalesceInstances] groups:", instanceRecords.length);
  return passthrough.concat(instanceRecords);
}

/**
 * @param {object} boxModel
 * @returns {object}
 */
function pickPrimaryMaterialForMergeBox(boxModel) {
  if (boxModel.material) {
    return boxModel.material;
  }
  if (boxModel.materials?.length) {
    let chosen;
    for (let j = 0; j < boxModel.materials.length; j++) {
      const subMaterial = boxModel.materials[j];
      if (subMaterial?.textureUrl) {
        chosen = subMaterial;
        break;
      }
    }
    chosen = chosen?.textureUrl ? chosen : boxModel.materials[0];
    boxModel.material = chosen;
    boxModel.materials = null;
    return chosen;
  }
  return { color: "#fff" };
}

/**
 * @param {string} mergeCode
 * @param {object[]} groupBoxes
 * @returns {object}
 */
function buildMergedBoxModelRecord(mergeCode, groupBoxes) {
  const mergeBoxModel = cloneRecord(groupBoxes[0]);
  const geometryArr = [];
  const materialArr = [];
  const transforms = [];
  const combineArr = [];
  const businessInfoArr = [];
  const mergedPartNames = [];
  const mergedPartCodes = [];

  for (let i = 0; i < groupBoxes.length; i++) {
    const boxModel = groupBoxes[i];
    geometryArr.push(boxModel.geometry ?? { depth: 1, width: 1, height: 1 });
    materialArr.push(pickPrimaryMaterialForMergeBox(boxModel));
    transforms.push(snapshotTransform(boxModel));
    combineArr.push(snapshotCombine(boxModel));
    businessInfoArr.push(boxModel.businessInfo ?? {});
    if (boxModel.name) {
      mergedPartNames.push(boxModel.name);
    }
    if (boxModel.code) {
      mergedPartCodes.push(boxModel.code);
    }
  }

  mergeBoxModel.merge = true;
  mergeBoxModel.mergeCode = mergeCode;
  mergeBoxModel.geometryArr = geometryArr;
  mergeBoxModel.materialArr = materialArr;
  mergeBoxModel.transforms = transforms;
  mergeBoxModel.combineArr = combineArr;
  mergeBoxModel.businessInfoArr = businessInfoArr;
  mergeBoxModel.mergedFragmentCount = groupBoxes.length;
  mergeBoxModel.mergedPartNames = mergedPartNames;
  mergeBoxModel.mergedPartCodes = mergedPartCodes;
  mergeBoxModel.name = mergeBoxModel.name || `merged:${mergeCode}`;
  return mergeBoxModel;
}

/**
 * @param {object[]} input
 * @returns {object[]}
 */
function coalesceMerges(input) {
  if (!input?.length) {
    return input;
  }
  /** @type {Map<string, object[]>} */
  const groups = new Map();
  /** @type {object[]} */
  const nonMerge = [];

  for (let i = 0; i < input.length; i++) {
    const box = input[i];
    if (!box?.mergeCode) {
      nonMerge.push(box);
      continue;
    }
    const key = box.mergeCode;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(box);
  }

  const mergeRecords = [];
  for (const [code, boxes] of groups) {
    mergeRecords.push(buildMergedBoxModelRecord(code, boxes));
  }

  log.debug("[coalesceMerges] mergeRecords:", mergeRecords.length);
  return nonMerge.concat(mergeRecords);
}

/**
 * @param {object[]} boxModelList
 * @returns {object[]}
 */
export function coalesceBoxModelList(boxModelList) {
  if (!Array.isArray(boxModelList) || boxModelList.length <= 0) {
    return Array.isArray(boxModelList) ? boxModelList : [];
  }
  let list;
  try {
    list = cloneRecord(boxModelList);
  } catch (_error) {
    list = boxModelList.slice();
  }
  list = coalesceInstances(list);
  list = coalesceMerges(list);
  return list;
}
