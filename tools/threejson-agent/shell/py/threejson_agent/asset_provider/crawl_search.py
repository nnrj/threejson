"""Mode D (default): search API or HTML search page + image download."""
from __future__ import annotations

import hashlib
import re
from typing import Any
from urllib.parse import quote_plus, urljoin

import httpx

from .base import AssetProvider
from .user_urls import UserUrlProvider


class CrawlSearchProvider(AssetProvider):
    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        cfg = self.asset_cfg
        api_key = cfg.get("searchApiKey")
        if api_key and cfg.get("searchEngine") == "bing":
            return self._bing_search(query, limit, api_key)
        return self._html_search(query, limit)

    def _bing_search(self, query: str, limit: int, key: str) -> list[dict[str, Any]]:
        url = "https://api.bing.microsoft.com/v7.0/images/search"
        headers = {"Ocp-Apim-Subscription-Key": key}
        params = {"q": query, "count": min(limit, 50)}
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
        out = []
        for item in data.get("value") or []:
            link = item.get("contentUrl") or item.get("thumbnailUrl")
            if link:
                out.append(
                    {
                        "url": link,
                        "title": item.get("name") or query,
                        "license": "unknown-crawl",
                        "source": "bing",
                    }
                )
        return out[:limit]

    def _html_search(self, query: str, limit: int) -> list[dict[str, Any]]:
        template = self.asset_cfg.get(
            "htmlSearchTemplate",
            "https://duckduckgo.com/?q={query}&iax=images&ia=images",
        )
        page_url = template.format(query=quote_plus(query))
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            html = client.get(page_url).text
        urls = re.findall(r"https://[^\"'\\s]+\.(?:jpg|jpeg|png|webp)", html, re.I)
        out = []
        for u in urls[:limit]:
            out.append(
                {
                    "url": u,
                    "title": query,
                    "license": "unknown-crawl",
                    "source": "html_search",
                }
            )
        return out

    def download_first(
        self, query: str, project_root, limit: int = 1
    ) -> list[str]:
        items = self.search(query, limit=limit)
        importer = UserUrlProvider(self.setting)
        paths = []
        for item in items:
            paths.append(importer.import_url(item["url"], project_root))
        return paths
