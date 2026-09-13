import test from "node:test";
import assert from "node:assert/strict";
import { createContributorsLoader, FALLBACK_CONTRIBUTORS } from "../website/js/contributors.js";

function contributor(login, contributions = 1) {
  return {
    login,
    avatar_url: `https://avatars.githubusercontent.com/u/${contributions}?v=4`,
    html_url: `https://github.com/${login}`,
    contributions
  };
}

function response(items, { status = 200, next = false } = {}) {
  return new Response(JSON.stringify(items), {
    status,
    headers: next ? { Link: '<https://api.github.com/repos/nnrj/threejson/contributors?per_page=100&page=2>; rel="next"' } : {}
  });
}

test("contributors are fetched only on demand, with no credentials or per-user requests", async () => {
  const requests = [];
  const load = createContributorsLoader({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response([contributor("nnrj", 165), contributor("new-contributor")]);
    }
  });
  assert.equal(requests.length, 0);
  const result = await load();
  assert.equal(result.source, "github");
  assert.deepEqual(result.contributors.map((item) => item.login), ["nnrj", "new-contributor"]);
  assert.equal(result.contributors[1].name, "new-contributor");
  assert.equal(result.contributors[1].profileUrl, "https://github.com/new-contributor");
  assert.equal(result.contributors[1].avatarUrl, "https://avatars.githubusercontent.com/u/1?v=4");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.github.com/repos/nnrj/threejson/contributors?per_page=100&page=1");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.referrerPolicy, "no-referrer");
  assert.deepEqual(requests[0].options.headers, { Accept: "application/vnd.github+json" });
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test("all contributor pages are loaded, preserving order and deduplicating accounts", async () => {
  const urls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => contributor(`user-${index}`, 100 - index));
  const load = createContributorsLoader({
    fetchImpl: async (url) => {
      urls.push(url);
      return urls.length === 1
        ? response(firstPage, { next: true })
        : response([contributor("USER-0"), contributor("user-100"), contributor("example-app[bot]"), { name: "Anonymous" }]);
    }
  });
  const result = await load();
  assert.equal(result.source, "github");
  assert.equal(result.contributors.length, 102);
  assert.equal(result.contributors[0].login, "user-0");
  assert.equal(result.contributors[100].login, "user-100");
  assert.equal(result.contributors[101].login, "example-app[bot]");
  assert.equal(urls.length, 2);
  assert.match(urls[1], /\?per_page=100&page=2$/);
});

test("pagination never follows an arbitrary URL from the Link header", async () => {
  const urls = [];
  const load = createContributorsLoader({
    fetchImpl: async (url) => {
      urls.push(url);
      if (urls.length === 1) {
        return new Response(JSON.stringify([contributor("first")]), {
          headers: { Link: '<https://unrelated.example/collect>; rel="next"' }
        });
      }
      return response([contributor("second")]);
    }
  });
  assert.equal((await load()).contributors.length, 2);
  assert.equal(urls[1], "https://api.github.com/repos/nnrj/threejson/contributors?per_page=100&page=2");
});

test("concurrent route/language renders share a request and successful lists expire", async () => {
  let calls = 0;
  let time = 0;
  let resolveFetch;
  const load = createContributorsLoader({
    now: () => time,
    cacheTtlMs: 100,
    fetchImpl: () => {
      calls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    }
  });
  const first = load();
  const concurrent = load();
  assert.equal(first, concurrent);
  assert.equal(calls, 1);
  resolveFetch(response([contributor("first")]));
  const initial = await first;
  time = 99;
  assert.deepEqual(await load(), initial);
  assert.equal(calls, 1);
  time = 100;
  const refreshed = load();
  assert.equal(calls, 2);
  resolveFetch(response([contributor("first"), contributor("new-contributor")]));
  assert.equal((await refreshed).contributors.length, 2);
});

const failures = [
  ["network failure", async () => { throw new TypeError("Failed to fetch"); }],
  ["rate limit", async () => response({ message: "API rate limit exceeded" }, { status: 403 })],
  ["HTTP 429", async () => response({}, { status: 429 })],
  ["server failure", async () => response({}, { status: 502 })],
  ["empty response", async () => new Response(null, { status: 204 })],
  ["malformed JSON", async () => new Response("not JSON")],
  ["unexpected schema", async () => response({ contributors: [] })],
  ["empty list", async () => response([])],
  ["no valid profiles", async () => response([null, { login: "<script>" }, { name: "Anonymous" }])]
];

for (const [name, fetchImpl] of failures) {
  test(`${name} uses the original static fallback list`, async () => {
    const result = await createContributorsLoader({ fetchImpl })();
    assert.equal(result.source, "fallback");
    assert.equal(result.contributors, FALLBACK_CONTRIBUTORS);
    assert.equal(result.contributors[0].login, "nnrj");
    assert.equal(result.contributors[0].profileUrl, "https://github.com/nnrj");
    assert.equal(result.contributors[0].maintainer, true);
  });
}

test("a failing later page falls back atomically instead of showing an incomplete list", async () => {
  let calls = 0;
  const load = createContributorsLoader({
    fetchImpl: async () => ++calls === 1
      ? response([contributor("partial")], { next: true })
      : response({}, { status: 503 })
  });
  assert.equal((await load()).contributors, FALLBACK_CONTRIBUTORS);
  assert.equal(calls, 2);
});

test("a hanging request is aborted and the static list remains usable", async () => {
  let signal;
  const load = createContributorsLoader({
    timeoutMs: 10,
    fetchImpl: (_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  });
  assert.equal((await load()).source, "fallback");
  assert.equal(signal.aborted, true);
});

test("failures are not cached and expired data does not replace the requested static fallback", async () => {
  let fail = true;
  let time = 0;
  const load = createContributorsLoader({
    now: () => time,
    cacheTtlMs: 100,
    fetchImpl: async () => {
      if (fail) throw new Error("offline");
      return response([contributor("online-contributor")]);
    }
  });
  assert.equal((await load()).source, "fallback");
  fail = false;
  assert.equal((await load()).source, "github");
  time = 100;
  fail = true;
  assert.equal((await load()).contributors, FALLBACK_CONTRIBUTORS);
});

test("unsafe profile/avatar URLs fall back to GitHub and display names remain plain text data", async () => {
  const load = createContributorsLoader({
    fetchImpl: async () => response([{
      ...contributor("safe-user"),
      name: '<img src=x onerror="alert(1)">',
      html_url: "javascript:alert(1)",
      avatar_url: "https://avatars.githubusercontent.com.unrelated.example/avatar.png",
      contributions: "1<script>"
    }, {
      ...contributor("second-user"),
      html_url: "https://user:password@github.com/second-user",
      avatar_url: "http://avatars.githubusercontent.com/u/2"
    }])
  });
  const { contributors } = await load();
  assert.equal(contributors[0].profileUrl, "https://github.com/safe-user");
  assert.equal(contributors[0].avatarUrl, "https://github.com/safe-user.png?size=144");
  assert.equal(contributors[0].name, '<img src=x onerror="alert(1)">');
  assert.equal(contributors[0].contributions, null);
  assert.equal(contributors[1].profileUrl, "https://github.com/second-user");
  assert.equal(contributors[1].avatarUrl, "https://github.com/second-user.png?size=144");
});
