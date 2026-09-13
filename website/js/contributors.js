const CONTRIBUTORS_API = "https://api.github.com/repos/nnrj/threejson/contributors";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

// Keep the original static list available even when GitHub is unreachable or rate-limited.
export const FALLBACK_CONTRIBUTORS = Object.freeze([
  Object.freeze({
    login: "nnrj",
    name: "nnrj",
    avatarUrl: "https://github.com/nnrj.png",
    profileUrl: "https://github.com/nnrj",
    contributions: null,
    maintainer: true
  })
]);

function githubUrl(value, origins, fallback) {
  try {
    const url = new URL(value);
    if (origins.includes(url.origin) && !url.username && !url.password) return url.href;
  } catch {
    // Missing or malformed URLs must not become executable/external card links.
  }
  return fallback;
}

function normalizeContributor(item) {
  const login = item?.login;
  // Anonymous commits have no GitHub profile to link to. GitHub App bots are supported.
  if (typeof login !== "string" || !/^[a-z\d-]+(?:\[bot\])?$/i.test(login)) return null;
  const profileUrl = `https://github.com/${encodeURIComponent(login)}`;
  return {
    login,
    // The contributors endpoint normally returns login, not the user's display name.
    // Do not spend one additional API request per contributor just to fetch a name.
    name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : login,
    avatarUrl: githubUrl(item.avatar_url, ["https://avatars.githubusercontent.com", "https://github.com"], `${profileUrl}.png?size=144`),
    profileUrl: githubUrl(item.html_url, ["https://github.com"], profileUrl),
    contributions: Number.isSafeInteger(item.contributions) && item.contributions >= 0 ? item.contributions : null
  };
}

async function fetchContributors(fetchImpl, timeoutMs) {
  const controller = new AbortController();
  // One deadline covers all pages, including reading their response bodies.
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const contributors = new Map();
    for (let page = 1; ; page += 1) {
      const response = await fetchImpl(`${CONTRIBUTORS_API}?per_page=100&page=${page}`, {
        headers: { Accept: "application/vnd.github+json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GitHub contributors request failed: HTTP ${response.status}`);
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error("Invalid GitHub contributors response");
      for (const item of items) {
        const contributor = normalizeContributor(item);
        if (contributor && !contributors.has(contributor.login.toLowerCase())) {
          contributors.set(contributor.login.toLowerCase(), contributor);
        }
      }
      // CORS exposes Link. Construct the next URL ourselves rather than following an arbitrary URL.
      if (!/;\s*rel="next"/.test(response.headers.get("Link") || "")) break;
    }
    if (!contributors.size) throw new Error("GitHub returned no contributor profiles");
    return [...contributors.values()];
  } finally {
    clearTimeout(timeout);
  }
}

export function createContributorsLoader({
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  cacheTtlMs = CACHE_TTL_MS,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  return function load() {
    if (cached && now() < expiresAt) return Promise.resolve({ contributors: cached, source: "github" });
    if (pending) return pending;
    pending = fetchContributors(fetchImpl, timeoutMs)
      .then((contributors) => {
        cached = contributors;
        expiresAt = now() + cacheTtlMs;
        return { contributors, source: "github" };
      })
      .catch(() => ({ contributors: FALLBACK_CONTRIBUTORS, source: "fallback" }))
      .finally(() => { pending = null; });
    return pending;
  };
}

// Creating the loader does not fetch anything; only visiting the contributors route does.
export const loadContributors = createContributorsLoader();
