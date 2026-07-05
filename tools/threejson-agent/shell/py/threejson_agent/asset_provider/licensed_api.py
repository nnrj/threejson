"""Mode A: licensed APIs (Unsplash source-style; Poly Haven HDR not images — extensible)."""
from __future__ import annotations

from typing import Any

import httpx

from .base import AssetProvider


class LicensedApiProvider(AssetProvider):
    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        cfg = self.asset_cfg
        provider = (cfg.get("apiProvider") or "unsplash").lower()
        if provider == "unsplash":
            return self._search_unsplash(query, limit)
        return []

    def _search_unsplash(self, query: str, limit: int) -> list[dict[str, Any]]:
        key = self.asset_cfg.get("unsplashAccessKey") or self.asset_cfg.get("searchApiKey")
        if not key:
            raise ValueError("asset.unsplashAccessKey or asset.searchApiKey required for api mode.")
        url = "https://api.unsplash.com/search/photos"
        params = {"query": query, "per_page": min(limit, 30)}
        headers = {"Authorization": f"Client-ID {key}"}
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
        out = []
        for item in data.get("results") or []:
            urls = item.get("urls") or {}
            link = urls.get("regular") or urls.get("small")
            if not link:
                continue
            out.append(
                {
                    "url": link,
                    "title": item.get("description") or item.get("alt_description") or query,
                    "license": "Unsplash License",
                    "source": "unsplash",
                }
            )
        return out
