import { getDomain } from "../handler/businessDomainRegistry.js";
import { sanitizePlainData } from "../handler/sceneJsonHandler.js";
import {
  mergeModelListItemsByIdentity,
  mergeWorldInfoModelListByIdentity
} from "./persistListMerge.js";

/**
 * @param {string} domainId
 * @param {unknown} baseItems
 * @param {unknown} freshItems
 * @returns {object[]}
 */
function mergeDomainBlockItems(domainId, baseItems, freshItems) {
  const domain = getDomain(domainId);
  const mergeHook = domain?.api?.mergePersistDescriptor;
  const keyFn = domain?.api?.persistMergeKey;
  if (typeof mergeHook !== "function") {
    return mergeWorldInfoModelListByIdentity(baseItems, freshItems);
  }
  return mergeModelListItemsByIdentity(
    baseItems,
    freshItems,
    (base, fresh) => mergeHook(base, fresh),
    typeof keyFn === "function" ? keyFn : undefined
  );
}

/**
 * Merge `worldInfo.domainModelList`: blocks by `domain`; when fresh is empty, keep base intact.
 *
 * @param {unknown} baseList
 * @param {unknown} freshList
 * @returns {object[]}
 */
export function mergeDomainModelList(baseList, freshList) {
  const base = Array.isArray(baseList) ? baseList : [];
  const fresh = Array.isArray(freshList) ? freshList : [];
  if (!fresh.length) {
    return sanitizePlainData(base) || [];
  }
  const domainIds = new Set();
  for (let i = 0; i < base.length; i += 1) {
    const block = base[i];
    if (block && typeof block === "object" && block.domain) {
      domainIds.add(String(block.domain).trim());
    }
  }
  for (let i = 0; i < fresh.length; i += 1) {
    const block = fresh[i];
    if (block && typeof block === "object" && block.domain) {
      domainIds.add(String(block.domain).trim());
    }
  }
  const out = sanitizePlainData(base) || [];
  const arr = [...out];
  for (const domainId of domainIds) {
    if (!domainId) {
      continue;
    }
    const idx = arr.findIndex((d) => d && typeof d === "object" && d.domain === domainId);
    const baseBlock = idx >= 0 ? arr[idx] : null;
    const freshBlock = fresh.find((d) => d && typeof d === "object" && d.domain === domainId) || null;
    if (!freshBlock) {
      if (idx < 0) {
        continue;
      }
      continue;
    }
    let fc = sanitizePlainData(freshBlock) || {};
    if (
      baseBlock &&
      typeof baseBlock === "object" &&
      Array.isArray(baseBlock.items) &&
      (!Array.isArray(fc.items) || !fc.items.length)
    ) {
      fc = { ...fc, items: sanitizePlainData(baseBlock.items) };
    } else if (baseBlock && typeof baseBlock === "object" && Array.isArray(baseBlock.items)) {
      fc = {
        ...fc,
        items: mergeDomainBlockItems(
          domainId,
          baseBlock.items,
          Array.isArray(fc.items) ? fc.items : []
        )
      };
    }
    if (idx >= 0) {
      arr[idx] = fc;
    } else {
      arr.push(fc);
    }
  }
  return sanitizePlainData(arr) || [];
}

