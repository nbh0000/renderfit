"""레이어 매칭 규칙을 읽어 온다.

캐드 레이어 이름은 회사마다 다르다. 코드에 박아 두면 새 이름이 나올 때마다 배포해야
하므로 wall_layer_patterns.yaml 로 빼 두고 여기서 읽는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

CONFIG_PATH = Path(__file__).parent / "wall_layer_patterns.yaml"


@dataclass(frozen=True)
class Patterns:
    wall: tuple[str, ...] = ()
    exclude: tuple[str, ...] = ()
    door: tuple[str, ...] = ()
    window: tuple[str, ...] = ()
    thickness_min: float = 50.0
    thickness_max: float = 400.0
    snap_gap: float = 100.0

    def is_wall_layer(self, name: str) -> bool:
        """레이어 이름이 벽인가.

        exclude 를 먼저 본다 — wall 목록이 부분 문자열로 걸리기 때문에
        "A-WALL-PATT"(해치)나 "WALL-DIM"(치수)이 벽으로 잡히면 두께 병합이 어긋난다.
        """
        upper = name.upper()
        if any(bad.upper() in upper for bad in self.exclude):
            return False
        return any(good.upper() in upper for good in self.wall)

    def opening_kind(self, block_name: str) -> str | None:
        """블록 이름이 문인가 창인가. 둘 다 아니면 None (설비로 간다)."""
        upper = block_name.upper()
        # 창을 먼저 본다 — "WINDOW" 안에 "WIN" 이 있고 "DOOR" 와 겹치지 않는다
        if any(word.upper() in upper for word in self.window):
            return "window"
        if any(word.upper() in upper for word in self.door):
            return "door"
        return None


@lru_cache(maxsize=1)
def load_patterns(path: Path | None = None) -> Patterns:
    raw = yaml.safe_load((path or CONFIG_PATH).read_text(encoding="utf-8")) or {}
    thickness = raw.get("thickness") or {}
    snap = raw.get("snap") or {}

    return Patterns(
        wall=tuple(raw.get("wall") or ()),
        exclude=tuple(raw.get("exclude") or ()),
        door=tuple(raw.get("door") or ()),
        window=tuple(raw.get("window") or ()),
        thickness_min=float(thickness.get("min", 50)),
        thickness_max=float(thickness.get("max", 400)),
        snap_gap=float(snap.get("gap", 100)),
    )
