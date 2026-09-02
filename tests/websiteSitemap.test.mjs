import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the production sitemap exposes canonical, crawlable ThreeJSON entry pages", () => {
  const sitemap = fs.readFileSync(path.join(repoRoot, "sitemap.xml"), "utf8");
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locations.length > 0);
  assert.equal(new Set(locations).size, locations.length, "sitemap URLs must be unique");

  for (const location of locations) {
    const url = new URL(location);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "threejson.org");
    assert.equal(url.hash, "", `fragment routes are not crawlable sitemap documents: ${location}`);
    assert.equal(url.search, "", `sitemap entry should be a canonical document URL: ${location}`);

    let relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    if (relativePath.endsWith("/")) relativePath += "index.html";
    assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), true, `missing sitemap target: ${relativePath}`);
  }
});

test("robots.txt advertises the root sitemap and the website declares the same canonical URL", () => {
  const robots = fs.readFileSync(path.join(repoRoot, "robots.txt"), "utf8");
  const website = fs.readFileSync(path.join(repoRoot, "website", "index.html"), "utf8");
  const redirect = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/threejson\.org\/sitemap\.xml$/m);
  assert.match(website, /<link rel="canonical" href="https:\/\/threejson\.org\/website\/">/);
  assert.match(redirect, /<link rel="canonical" href="https:\/\/threejson\.org\/website\/">/);
});
