/**
 * 全量入口：注册内置 domain 并 re-export core 公共 API。
 * 用法：`import { createJsonScene, door } from "threejson"`（npm 主入口）
 * 仓库内等价：`import { ... } from "./builtins/full.js"`
 */
import "./register.js";
export * from "../core/index.js";

import { businessDomains } from "../core/handler/businessDomainRegistry.js";

function domainNamespace(domainId) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return businessDomains?.[domainId]?.[prop];
      }
    }
  );
}

export const box = domainNamespace("box");
export const device = domainNamespace("device");
export const door = domainNamespace("door");
export const floor = domainNamespace("floor");
export const glass = domainNamespace("glass");
export const nativeThree = domainNamespace("nativeThree");
export const port = domainNamespace("port");
export const wall = domainNamespace("wall");
export const weather = domainNamespace("weather");
export const nature = domainNamespace("nature");
export const sceneHighlight = domainNamespace("sceneHighlight");
