/**
 * Minimal third-party / local domain starter.
 * After adding under repo domains/, run: npm run generate:business-domain-manifest
 */

/** @type {import("../../../core/handler/businessDomainRegistry.js").BusinessDomainDescriptor} */
const demoDomain = {
  id: "demo",
  defaultHandler: "noop",
  domainHandlers: {
    noop() {
      /* placeholder */
    }
  },
  api: {}
};

export default demoDomain;
