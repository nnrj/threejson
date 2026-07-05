/**
 * Shared deploy path for stat domain group descriptors.
 */
import { deployGroupDescriptor } from "../../core/handler/objectLoadHandler.js";
import { stampStatLabels } from "./statShared.js";

/**
 * @param {import("three").Scene} scene
 * @param {object} groupDesc
 * @returns {import("three").Group|null}
 */
export function deployStatGroup(scene, groupDesc) {
  if (!scene || !groupDesc) {
    return null;
  }
  const group = deployGroupDescriptor(scene, groupDesc);
  if (group) {
    stampStatLabels(group);
  }
  return group;
}
