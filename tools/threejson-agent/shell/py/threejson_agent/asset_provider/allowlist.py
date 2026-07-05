"""Mode C: allowlisted domains with simple HTML image extraction."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx

from .base import AssetProvider


class AllowlistProvider(AssetProvider):
    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        domains = self.asset_cfg.get("allowlistDomains") or []
        if not domains:
            raise ValueError("asset.allowlistDomains required for allowlist mode.")
        template = self.asset_cfg.get("searchUrlTemplate") or "https://{domain}/search?q={query}"
        results: list[dict[str, Any]] = []
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            for domain in domains[:3]:
                url = template.format(domain=domain, query=query)
                try:
                    html = client.get(url).text
                except Exception:
                    continue
                for img in _extract_img_urls(html, url)[:limit]:
                    results.append(
                        {
                            "url": img,
                            "title": query,
                            "license": "unknown-allowlist",
                            "source": domain,
                        }
                    )
                    if len(results) >= limit:
                        return results
        return results


def _extract_img_urls(html: str, base: str) -> list[str]:
    found = re.findall(r"""<img[^>]+src=["']([^"']+)["']""", html, re.I)
    out = []
    for src in found:
        if src.startswith("data:"):
            continue
        full = urljoin(base, src)
        if _looks_like_image_url(full):
            out.append(full)
    return out


def _looks_like_image_url(url: str) -> bool:
    p = urlparse(url).path.lower()
    return any(p.endswith(ext) for ext in (".png", ".jpg", ".jpeg", ".webp", ".gif"))
