"""Asset search/import providers (crawl default; switchable api/user/allowlist)."""
from __future__ import annotations

from typing import Any

from .allowlist import AllowlistProvider
from .crawl_search import CrawlSearchProvider
from .licensed_api import LicensedApiProvider
from .user_urls import UserUrlProvider

PROVIDERS = {
    "crawl": CrawlSearchProvider,
    "api": LicensedApiProvider,
    "user": UserUrlProvider,
    "allowlist": AllowlistProvider,
}


def get_provider(mode: str, setting: dict[str, Any]):
    key = (mode or setting.get("asset", {}).get("mode", "crawl")).lower()
    cls = PROVIDERS.get(key, CrawlSearchProvider)
    return cls(setting)


COMPLIANCE_NOTICE = (
    "Asset crawl/search may violate third-party Terms of Service or copyright. "
    "You are solely responsible for compliance, robots.txt, and licensing. "
    "Prefer asset.mode=api for production."
)
