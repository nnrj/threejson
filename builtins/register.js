/**
 * 注册仓库内置 business domains（及 weather/door 等 objType 扩展，在各自 index 模块加载时注册）。
 * 进阶（配合 `threejson/core`）：`import "threejson/builtins/register"`。默认应用请 `import from "threejson"`（已含注册）。
 */
import { initBusinessDomains } from "../core/handler/businessDomainRegistry.js";
import { generatedBusinessDomainDescriptors } from "./builtinDomainManifest.generated.js";
import { userDomainDescriptors } from "./userDomainDescriptors.js";

/**
 * @param {import("../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor[]} generated
 * @param {import("../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor[]} user
 */
function mergeDomainDescriptors(generated, user) {
  /** @type {Map<string, import("../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor>} */
  const byId = new Map();
  for (const d of generated) {
    if (d?.id) {
      byId.set(d.id, d);
    }
  }
  for (const d of user) {
    if (d?.id) {
      byId.set(d.id, d);
    }
  }
  const generatedIds = new Set(generated.map((d) => d?.id).filter(Boolean));
  /** @type {import("../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor[]} */
  const out = [];
  for (const d of generated) {
    if (d?.id && byId.has(d.id)) {
      out.push(byId.get(d.id));
    }
  }
  for (const d of user) {
    if (d?.id && !generatedIds.has(d.id)) {
      out.push(d);
    }
  }
  return out;
}

/**
 * 注册全部内置 domain（可重复调用以强制重载清单）。
 */
export function registerBuiltinDomains() {
  const merged = mergeDomainDescriptors(
    generatedBusinessDomainDescriptors,
    userDomainDescriptors
  );
  initBusinessDomains(merged);
}

registerBuiltinDomains();
