"""LLM 라벨러 — 확정된 기하 위에 이름만 붙인다. DXF 경로도 함께 쓴다.

── LLM 이 여기서 하는 일과 하지 않는 일 ──

하는 일: 방 크롭 그림과 그 안에서 읽힌 글자를 보고 **이 방이 무엇인지** 판단한다.
하지 않는 일: 좌표·치수·면적을 만든다. 그건 이미 확정돼 있고, LLM 이 손댈 수 없다.

프롬프트에 그 사실을 못박는다. 그러지 않으면 모델이 묻지도 않은 좌표를 답에 끼워
넣고, 그것이 어딘가로 흘러 들어간다.

── 설비는 인식하지 않는다 ──

도면의 기호를 알아보려 들지 않는다. 벡터화 모델도 잘 못하고, 틀리면 없는 가구가
생긴다. 대신 **OCR 로 잡힌 라벨 글자 자리에** 그 종류의 표준 크기로 자리만 잡아
둔다(fixture_defaults.yaml). 사용자가 검수 화면에서 옮기거나 지우면 된다.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

DEFAULTS_PATH = Path(__file__).parent / "fixture_defaults.yaml"

#: 방 종류. 편집기·3D 가 아는 값과 맞춰 둔다.
ROOM_KINDS = (
    "hall",
    "kitchen",
    "restroom",
    "entrance",
    "storage",
    "office",
    "bedroom",
    "living",
    "corridor",
    "stair",
    "balcony",
    "other",
)


@dataclass
class RoomLabel:
    name: str | None
    kind: str
    confidence: float


@dataclass
class FixtureSeed:
    """OCR 라벨 자리에 놓을 플레이스홀더."""

    kind: str
    label: str
    #: 원본 이미지 픽셀 좌표의 중심
    center: tuple[float, float]
    width_mm: float
    depth_mm: float
    #: 도면에서 잰 값이 아니라 표준 규격이라 낮다
    confidence: float = 0.4


@dataclass
class HallCount:
    """홀에 테이블이 대략 몇 개, 어떤 종류인지.

    배치는 편집기 몫이다 — 여기서 자리를 정하면 그건 좌표를 지어내는 일이다.
    """

    two_seat: int = 0
    four_seat: int = 0
    bench: int = 0
    note: str = ""


# ───────────────────────── 설비 기본값 ─────────────────────────


@lru_cache(maxsize=1)
def load_fixture_defaults(path: Path | None = None) -> dict[str, Any]:
    return yaml.safe_load((path or DEFAULTS_PATH).read_text(encoding="utf-8")) or {}


def seed_from_label(text: str, center: tuple[float, float]) -> FixtureSeed | None:
    """라벨 글자 하나 → 플레이스홀더. 아는 낱말이 아니면 None.

    모르는 글자에 아무 크기나 붙이면 도면에 없는 가구가 생긴다. 실명·치수·주기도 전부
    글자라, 아는 것만 골라야 한다.
    """
    config = load_fixture_defaults()
    items: dict[str, Any] = config.get("items") or {}
    aliases: dict[str, str] = config.get("aliases") or {}
    defaults: dict[str, Any] = config.get("defaults") or {}

    cleaned = re.sub(r"[\s\-_()]+", "", text.strip()).lower()
    if not cleaned:
        return None

    # 영문 별칭을 한국어 항목으로 돌린다
    for alias, target in aliases.items():
        if alias.lower() == cleaned:
            cleaned = re.sub(r"[\s\-_()]+", "", target).lower()
            break

    for name, spec in items.items():
        key = re.sub(r"[\s\-_()]+", "", name).lower()
        if key and key in cleaned:
            return FixtureSeed(
                kind=str(spec.get("kind") or name),
                label=name,
                center=center,
                width_mm=float(spec.get("width", defaults.get("width", 600))),
                depth_mm=float(spec.get("depth", defaults.get("depth", 600))),
            )

    return None


def seeds_from_texts(texts: list[Any]) -> list[FixtureSeed]:
    """OCR 결과 전체에서 아는 라벨만 골라 플레이스홀더로."""
    out: list[FixtureSeed] = []

    for item in texts:
        seed = seed_from_label(item.text, item.center)
        if seed is not None:
            out.append(seed)

    return out


# ───────────────────────── LLM ─────────────────────────

_ROOM_PROMPT = "\n".join(
    [
        "이 그림은 건축 평면도에서 **방 하나만** 잘라 낸 것이다.",
        "이 방이 무엇인지 판단해라.",
        "",
        "■ 답할 것",
        '  { "name": "도면에 적힌 실 이름 또는 네가 판단한 이름", '
        '"kind": "위 목록 중 하나", "confidence": 0~1 }',
        f"  kind 는 다음 중 하나다: {', '.join(ROOM_KINDS)}",
        "",
        "■ 절대 하지 마라",
        "  · **좌표나 치수를 출력하지 마라.** 넓이도, 벽 위치도, 문 자리도 답하지 마라.",
        "    그 값들은 이미 도면에서 측정해 확정돼 있다. 네가 짐작한 숫자가 섞이면",
        "    그 도면은 못 쓰게 된다.",
        "  · 그림에 없는 것을 지어내지 마라. 모르겠으면 confidence 를 낮게 적어라.",
        "",
        "■ 판단하는 법",
        "  · 그림 안에 적힌 글자가 있으면 그것이 가장 확실하다. 그대로 쓴다.",
        "  · 글자가 없으면 그려진 기호로 본다 — 변기·세면대가 있으면 restroom,",
        "    싱크대·레인지가 있으면 kitchen, 테이블이 늘어서 있으면 hall.",
        "  · 아무 근거도 없으면 kind 를 other 로 두고 confidence 를 0.3 아래로 적어라.",
        "",
        "JSON 만 답한다. 다른 말을 붙이지 마라.",
    ]
)


def _room_prompt(ocr_texts: list[str]) -> str:
    if not ocr_texts:
        return _ROOM_PROMPT
    return _ROOM_PROMPT + "\n\n■ 이 방 안에서 읽힌 글자\n  " + " / ".join(ocr_texts[:20])


_HALL_PROMPT = "\n".join(
    [
        "이 그림은 식당·카페의 **홀** 부분이다. 테이블이 대략 몇 개인지 센다.",
        "",
        '  { "two_seat": 정수, "four_seat": 정수, "bench": 정수, "note": "짧은 설명" }',
        "",
        "■ 절대 하지 마라",
        "  · **좌표나 치수를 출력하지 마라.** 어디에 놓였는지는 묻지 않았다.",
        "    배치는 편집기가 한다. 너는 개수와 종류만 센다.",
        "",
        "세다 애매하면 적게 센다 — 없는 테이블을 만드는 것보다 낫다.",
        "JSON 만 답한다.",
    ]
)


class LabelUnavailable(RuntimeError):
    """LLM 라벨러를 쓸 수 없다."""


def _call_gemini(prompt: str, image_png: bytes, schema: dict[str, Any]) -> dict[str, Any]:
    """Gemini 한 번. 키가 없으면 예외."""
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise LabelUnavailable("GEMINI_API_KEY 가 없습니다.")

    import base64

    import requests  # type: ignore[import-untyped]

    model = os.environ.get("LABEL_MODEL", "gemini-3.5-flash")
    response = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
        json={
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/png",
                                "data": base64.b64encode(image_png).decode("ascii"),
                            }
                        },
                    ],
                }
            ],
            "generationConfig": {
                # 같은 그림에는 같은 답이 나와야 한다
                "temperature": 0,
                "topP": 1,
                "responseMimeType": "application/json",
                "responseSchema": schema,
            },
        },
        timeout=90,
    )
    response.raise_for_status()

    payload = response.json()
    text = payload["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(text)


_ROOM_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "kind": {"type": "string", "enum": list(ROOM_KINDS)},
        "confidence": {"type": "number"},
    },
    "required": ["name", "kind", "confidence"],
}

_HALL_SCHEMA = {
    "type": "object",
    "properties": {
        "two_seat": {"type": "integer"},
        "four_seat": {"type": "integer"},
        "bench": {"type": "integer"},
        "note": {"type": "string"},
    },
    "required": ["two_seat", "four_seat", "bench", "note"],
}


def label_room(image_png: bytes, ocr_texts: list[str]) -> RoomLabel:
    """방 하나에 이름을 붙인다.

    ── 글자가 하나면 LLM 을 부르지 않는다 ──

    도면에 "주방" 이라고 적혀 있는데 모델에게 물어볼 이유가 없다. 돈이 들고, 틀릴
    여지만 생긴다. 애매할 때만 부른다.
    """
    clear = [text for text in ocr_texts if text.strip()]
    if len(clear) == 1:
        return RoomLabel(name=clear[0].strip(), kind=_guess_kind(clear[0]), confidence=0.9)

    try:
        raw = _call_gemini(_room_prompt(clear), image_png, _ROOM_SCHEMA)
    except Exception:  # noqa: BLE001 — 라벨을 못 붙여도 기하는 살아 있어야 한다
        return RoomLabel(name=None, kind="other", confidence=0.0)

    kind = str(raw.get("kind", "other"))
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence", 0))))
    except (TypeError, ValueError):
        confidence = 0.0

    name = str(raw.get("name", "")).strip() or None

    return RoomLabel(
        name=name,
        kind=kind if kind in ROOM_KINDS else "other",
        confidence=confidence,
    )


#: 글자에서 곧바로 알 수 있는 종류. LLM 을 부르지 않아도 되는 경우다.
_KIND_WORDS: tuple[tuple[str, str], ...] = (
    ("주방", "kitchen"),
    ("조리", "kitchen"),
    ("kitchen", "kitchen"),
    ("화장실", "restroom"),
    ("욕실", "restroom"),
    ("변소", "restroom"),
    ("restroom", "restroom"),
    ("wc", "restroom"),
    ("현관", "entrance"),
    ("출입", "entrance"),
    ("entrance", "entrance"),
    ("홀", "hall"),
    ("hall", "hall"),
    ("객석", "hall"),
    ("창고", "storage"),
    ("수장", "storage"),
    ("storage", "storage"),
    ("사무", "office"),
    ("office", "office"),
    ("침실", "bedroom"),
    ("안방", "bedroom"),
    ("거실", "living"),
    ("복도", "corridor"),
    ("계단", "stair"),
    ("발코니", "balcony"),
    ("베란다", "balcony"),
)


def _guess_kind(name: str) -> str:
    lowered = name.lower()
    for word, kind in _KIND_WORDS:
        if word in lowered:
            return kind
    return "other"


def count_hall_tables(image_png: bytes) -> HallCount:
    """홀에 테이블이 몇 개인지만 센다. 자리는 묻지 않는다."""
    try:
        raw = _call_gemini(_HALL_PROMPT, image_png, _HALL_SCHEMA)
    except Exception:  # noqa: BLE001
        return HallCount(note="세지 못했습니다")

    def count(key: str) -> int:
        try:
            return max(0, int(raw.get(key, 0)))
        except (TypeError, ValueError):
            return 0

    return HallCount(
        two_seat=count("two_seat"),
        four_seat=count("four_seat"),
        bench=count("bench"),
        note=str(raw.get("note", "")).strip(),
    )
