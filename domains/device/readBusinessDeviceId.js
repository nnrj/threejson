/**
 * Read business alarm binding ID from scene object (businessInfo.deviceId).
 * Supports groupInfo.businessInfo fallback (in-cabinet devices, etc.).
 * @param {import("three").Object3D|object|null|undefined} model
 * @returns {string|number|null}
 */
export function readBusinessDeviceId(model) {
  const objJson = model?.userData?.objJson;
  if (!objJson || typeof objJson !== "object") {
    return null;
  }
  const biz = objJson.businessInfo;
  if (biz && biz.deviceId != null && String(biz.deviceId).trim() !== "") {
    return biz.deviceId;
  }
  const groupBiz = objJson.groupInfo?.businessInfo;
  if (groupBiz && groupBiz.deviceId != null && String(groupBiz.deviceId).trim() !== "") {
    return groupBiz.deviceId;
  }
  return null;
}
