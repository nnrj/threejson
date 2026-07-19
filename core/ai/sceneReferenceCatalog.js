/**
 * Host-driven reference retrieval for the multi-round Agent: when the user's request touches a
 * capability the always-injected prompt catalog (threeJsonCoreSkill.js) only mentions in passing
 * — event mechanism, scripts, business domains, etc. — fetch the matching doc excerpt + example
 * JSON from THIS repo's own `docs/` and `assets/json/demo-show/` (same content the public docs
 * site and GitHub examples are generated from) and hand it to the agent as extra context.
 *
 * Deliberately reads local repo files rather than the live threejson.org site or GitHub: the docs
 * site's `#/docs-index` is a client-side SPA route (fetching it directly returns an empty HTML
 * shell, not the doc text), and neither host has any existing CORS/allowlist handling in this
 * codebase — reading the same content locally is same-origin, synchronous with page load, and
 * cannot fail from network flakiness or rate limits.
 *
 * Environment-agnostic by design (no assumption about how the caller serves the repo): callers
 * supply a `resolveUrl(repoRelativePath) => string` function (ThreeBox uses
 * tools/scene-host/shared/js/sceneHostPaths.js's `resolveSceneHostUrl`); this module never
 * hardcodes a base URL. A caller that doesn't pass `resolveUrl` gets "" back — a silent no-op,
 * not an error — since this is a best-effort enhancement, not a required capability.
 */
import { convertFriendlyJsonToStandardJson } from "../util/util.js";

const MANIFEST_RELATIVE_PATH = "assets/json/demo-show/manifest.json";
const DOC_LOCALE_DIR = { "zh-CN": "docs/zh", "en-US": "docs/en" };
const PUBLIC_REFERENCE_LINKS = {
  docsIndex: "https://threejson.org/",
  githubExamples: "https://github.com/nnrj/threejson/tree/master/assets/json",
  assetsCdnBase: "https://cdn.jsdelivr.net/npm/@threejson/assets@latest/assets/"
};

/** Curated intent-signal id (see sceneCapability.js's INTENT_SIGNALS) -> demo-show manifest
 * section id(s). Only covers topics the baked-in prompt catalog under-specifies (verified against
 * threeJsonCoreSkill.js) — well-covered topics (primitives, materials, basic geometry) are
 * intentionally omitted so retrieval only fires where it actually helps. */
const SIGNAL_TO_SECTIONS = {
  events: ["event-mechanism", "scripts"],
  lifecycle: ["lifecycle", "event-mechanism"],
  css3dPanel: ["info-panels"],
  infoPanel: ["info-panels"],
  sceneText: ["text-3d"],
  external: ["external-resources"],
  audio: ["external-resources"],
  lighting: ["materials-lighting"],
  declarativeAnimation: ["runtime"],
  group: ["composition"],
  instanced: ["object-manager"],
  statDomain: ["business-domains"],
  deviceDomain: ["business-domains"],
  natureDomain: ["business-domains"],
  portDomain: ["business-domains"]
};

const DOMAIN_PREFIX_TO_SECTIONS = [
  ["domain.device.", ["business-domains"]],
  ["domain.stat.", ["business-domains"]],
  ["domain.nature.", ["business-domains"]],
  ["domain.weather.", ["business-domains"]]
];

const SIGNAL_TO_EXAMPLE_IDS = {
  deviceDomain: ["device-cabinet"],
  deviceCabinetDomain: ["device-cabinet"],
  deviceServerDomain: ["device-cabinet"],
  deviceSwitchDomain: ["device-cabinet"],
  deviceUpsDomain: ["device-cabinet"],
  deviceAirConditionerDomain: ["device-cabinet"],
  "domain.device.cabinet": ["device-cabinet"],
  "domain.device.server": ["device-cabinet"],
  "domain.device.switch": ["device-cabinet"],
  "domain.device.ups": ["device-cabinet"],
  "domain.device.airConditioner": ["device-cabinet"],
  statDomain: ["stat-bar"],
  "domain.stat.bar": ["stat-bar"],
  natureDomain: ["nature-sky"],
  "domain.nature.sky": ["nature-sky"],
  portDomain: ["port-dock-crane"],
  "domain.port": ["port-dock-crane"]
};

function resolveSectionsForSignal(signalId) {
  if (SIGNAL_TO_SECTIONS[signalId]) {
    return SIGNAL_TO_SECTIONS[signalId];
  }
  if (signalId === "domain.port") {
    return ["business-domains"];
  }
  if (/^(?:device(?:Cabinet|Server|Switch|Ups|AirConditioner)|stat(?:Bar|Grid|Panel|Chart|Line|Pie|Ring)|nature(?:Sky|Water)|weather(?:Rain|Wind)|nativeThree|sceneHighlight|building)Domain$/.test(signalId)) {
    return ["business-domains"];
  }
  for (const [prefix, sections] of DOMAIN_PREFIX_TO_SECTIONS) {
    if (signalId.startsWith(prefix)) {
      return sections;
    }
  }
  return null;
}

const MAX_SECTIONS_PER_TURN = 2;
const MAX_DOC_CHARS = 2400;
const MAX_EXAMPLE_CHARS = 3000;

/** url -> Promise<string> (resolves to "" on any failure). Shared across calls within a page
 * session so repeated agent rounds/turns don't refetch the same doc/example. */
const textFetchCache = new Map();

function fetchTextCached(url) {
  if (!url) {
    return Promise.resolve("");
  }
  if (textFetchCache.has(url)) {
    return textFetchCache.get(url);
  }
  const promise = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        return "";
      }
      return await res.text();
    } catch (_err) {
      return "";
    }
  })();
  textFetchCache.set(url, promise);
  return promise;
}

let manifestPromiseByUrl = new Map();

function loadManifest(resolveUrl) {
  const url = resolveUrl(MANIFEST_RELATIVE_PATH);
  if (manifestPromiseByUrl.has(url)) {
    return manifestPromiseByUrl.get(url);
  }
  const promise = (async () => {
    const text = await fetchTextCached(url);
    if (!text) {
      return [];
    }
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  })();
  manifestPromiseByUrl.set(url, promise);
  return promise;
}

function truncate(text, maxChars) {
  const s = String(text || "");
  if (s.length <= maxChars) {
    return s;
  }
  return `${s.slice(0, maxChars)}\n...(truncated)`;
}

async function normalizeExampleJsonForAi(text) {
  try {
    const parsed = JSON.parse(String(text || ""));
    const standard = await convertFriendlyJsonToStandardJson(parsed);
    return JSON.stringify(standard, null, 2);
  } catch (_error) {
    return String(text || "");
  }
}

/**
 * @param {Array<{id?: string}>} matchedSignals result of sceneCapability.js's matchIntentSignals
 * @param {{ resolveUrl?: (repoRelativePath: string) => string, locale?: string }} [options]
 * @returns {Promise<string>} formatted reference block, or "" when nothing matched / unavailable
 */
export async function fetchReferenceMaterial(matchedSignals, options = {}) {
  const resolveUrl = typeof options.resolveUrl === "function" ? options.resolveUrl : null;
  if (!resolveUrl || !Array.isArray(matchedSignals) || matchedSignals.length === 0) {
    return "";
  }

  const sectionIds = new Set();
  const preferredExampleIds = new Set();
  for (const signal of matchedSignals) {
    const signalId = String(signal?.id || "").trim();
    const mapped = resolveSectionsForSignal(signalId);
    if (mapped) {
      for (const sectionId of mapped) {
        sectionIds.add(sectionId);
      }
    }
    const examples = SIGNAL_TO_EXAMPLE_IDS[signalId];
    if (examples) {
      for (const exampleId of examples) {
        preferredExampleIds.add(exampleId);
      }
    }
  }
  if (sectionIds.size === 0) {
    return "";
  }

  try {
    const manifest = await loadManifest(resolveUrl);
    const sections = manifest
      .filter((section) => sectionIds.has(section?.section))
      .slice(0, MAX_SECTIONS_PER_TURN);
    if (sections.length === 0) {
      return "";
    }

    const docDir = DOC_LOCALE_DIR[options.locale] || DOC_LOCALE_DIR["en-US"];
    const blocks = [];
    for (const section of sections) {
      const parts = [`### ${section.sectionTitleEn || section.sectionTitle || section.section}`];

      const docLink = Array.isArray(section.docLinks) ? section.docLinks[0] : null;
      if (docLink?.file) {
        const docText = await fetchTextCached(resolveUrl(`${docDir}/${docLink.file}`));
        if (docText) {
          parts.push(`Doc excerpt (${docLink.file}):\n${truncate(docText, MAX_DOC_CHARS)}`);
        }
      }

      const exampleItem = Array.isArray(section.items)
        ? section.items.find(
          (item) => preferredExampleIds.has(item?.id) && typeof item.json === "string" && item.json
        ) || section.items.find((item) => typeof item.json === "string" && item.json)
        : null;
      if (exampleItem) {
        parts.push(
          `Example links: GitHub ${PUBLIC_REFERENCE_LINKS.githubExamples}; CDN ${PUBLIC_REFERENCE_LINKS.assetsCdnBase}${exampleItem.json.replace(/^assets\//, "")}`
        );
        const exampleText = await fetchTextCached(resolveUrl(exampleItem.json));
        if (exampleText) {
          const standardExampleText = await normalizeExampleJsonForAi(exampleText);
          parts.push(`Standard objectList example JSON (${exampleItem.id}):\n${truncate(standardExampleText, MAX_EXAMPLE_CHARS)}`);
        }
      }

      if (parts.length > 1) {
        blocks.push(parts.join("\n\n"));
      }
    }

    if (blocks.length === 0) {
      return "";
    }
    return [
      `Reference material retrieved from this project's own docs/examples for capabilities this request needs. Always author the result as standard sceneConfig + objectList JSON; friendly worldInfo syntax mentioned in prose is compatibility documentation only. Do not copy unrelated fields verbatim. Public docs: ${PUBLIC_REFERENCE_LINKS.docsIndex}`,
      ...blocks
    ].join("\n\n");
  } catch (_err) {
    return "";
  }
}

/** Test-only: clears the module-level fetch/manifest caches between test runs. */
export function _resetSceneReferenceCatalogCacheForTests() {
  textFetchCache.clear();
  manifestPromiseByUrl = new Map();
}
