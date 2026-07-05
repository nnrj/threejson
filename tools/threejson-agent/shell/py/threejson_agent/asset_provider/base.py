from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class AssetProvider(ABC):
    def __init__(self, setting: dict[str, Any]):
        self.setting = setting
        self.asset_cfg = setting.get("asset", {})

    @abstractmethod
    def search(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        """Return [{url, title, license, source}, ...]"""

    def import_to_project(
        self,
        item: dict[str, Any],
        project_root,
        subdir: str = "assets/textures/imported",
    ) -> str:
        raise NotImplementedError
