"""골든 비교 — 파서가 조용히 나빠지지 않게.

── 왜 골든인가 ──

단위 시험은 "이 함수가 이렇게 동작하는가" 를 본다. 그런데 도면 파서에서 정말 무서운
것은 함수 하나가 틀리는 것이 아니라 **전체 결과가 조금씩 밀리는 것**이다. 벽 병합
기준을 10mm 바꿨더니 방 하나가 사라지는 식으로.

그래서 fixture 마다 한 번 확인한 결과(FloorPlanDoc)를 통째로 박아 두고, 돌릴 때마다
그것과 대 본다. CI 가 이 시험을 돌리므로, 결과가 달라지면 머지 전에 드러난다.

── 오차 ──

사양이 정한 값이다.

  · 외곽 2%  — 도면 전체 크기
  · 방 면적 3%
  · 방 개수는 **정확히** 같아야 한다 (방이 사라지는 것이 가장 흔한 고장이다)

숫자를 완전히 똑같이 맞추라고 하지 않는 이유는, 부동소수점 반올림이나 셰이플리 버전
차이로 마지막 자리가 흔들릴 수 있기 때문이다. 방 개수만은 오차를 두지 않는다.

── 골든이 틀렸을 때 ──

`tests/make_golden.py` 로 다시 만든다. 단, **결과가 좋아진 것을 눈으로 확인했을
때만** 돌린다. 빨개질 때마다 습관적으로 다시 만들면 골든이 시험을 따라다니게 되고,
그때부터 이 시험은 아무것도 지키지 않는다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.dxf_parse import parse_dxf  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN = Path(__file__).parent / "golden"

#: 사양이 정한 오차
OUTLINE_TOLERANCE = 0.02
AREA_TOLERANCE = 0.03

NAMES = sorted(path.stem for path in FIXTURES.glob("*.dxf"))


def load(name: str) -> tuple[dict, dict]:
    golden_path = GOLDEN / f"{name}.json"
    assert golden_path.exists(), (
        f"골든 파일이 없습니다: {golden_path}. tests/make_golden.py 로 만들어 주세요."
    )

    doc = parse_dxf((FIXTURES / f"{name}.dxf").read_bytes(), source_type="cad")
    return doc, json.loads(golden_path.read_text(encoding="utf-8"))


def within(actual: float, expected: float, tolerance: float) -> bool:
    if expected == 0:
        return abs(actual) <= tolerance
    return abs(actual - expected) / abs(expected) <= tolerance


@pytest.mark.parametrize("name", NAMES)
def test_outline_matches_golden(name: str) -> None:
    doc, golden = load(name)

    for axis in ("w", "h"):
        assert within(doc["bounds"][axis], golden["bounds"][axis], OUTLINE_TOLERANCE), (
            f"{name} 외곽 {axis}: {doc['bounds'][axis]} (골든 {golden['bounds'][axis]})"
        )


@pytest.mark.parametrize("name", NAMES)
def test_room_count_matches_golden(name: str) -> None:
    """방 개수는 오차를 두지 않는다 — 방이 사라지는 것이 가장 흔한 고장이다."""
    doc, golden = load(name)

    assert len(doc["rooms"]) == len(golden["rooms"]), (
        f"{name}: 방 {len(doc['rooms'])}개 (골든 {len(golden['rooms'])}개)"
    )


@pytest.mark.parametrize("name", NAMES)
def test_room_areas_match_golden(name: str) -> None:
    doc, golden = load(name)

    # 방 순서는 폴리곤을 만드는 순서라 바뀔 수 있다. 넓이로 줄 세워 짝을 맞춘다.
    ours = sorted(room["areaMm2"] for room in doc["rooms"])
    theirs = sorted(room["areaMm2"] for room in golden["rooms"])

    for actual, expected in zip(ours, theirs):
        assert within(actual, expected, AREA_TOLERANCE), (
            f"{name} 방 면적: {actual / 1e6:.2f}㎡ (골든 {expected / 1e6:.2f}㎡)"
        )


@pytest.mark.parametrize("name", NAMES)
def test_room_names_match_golden(name: str) -> None:
    """이름은 LLM 이 아니라 도면 글자에서 온다 — 흔들리면 안 된다."""
    doc, golden = load(name)

    ours = sorted(room.get("name") or "" for room in doc["rooms"])
    theirs = sorted(room.get("name") or "" for room in golden["rooms"])

    assert ours == theirs, f"{name}: 실명 {ours} (골든 {theirs})"


@pytest.mark.parametrize("name", NAMES)
def test_openings_and_fixtures_do_not_vanish(name: str) -> None:
    """문·창·설비가 통째로 사라지는 고장을 잡는다.

    개수를 딱 맞추라고 하지는 않는다 — 하나가 늘거나 주는 것보다, **전부 없어지는
    것**이 실제로 일어난 고장이었다.
    """
    doc, golden = load(name)

    for key in ("openings", "fixtures"):
        if golden[key]:
            assert doc[key], f"{name}: {key} 가 전부 사라졌습니다 (골든 {len(golden[key])}개)"


@pytest.mark.parametrize("name", NAMES)
def test_never_confirmed_automatically(name: str) -> None:
    """자동 결과는 절대 확정하지 않는다. 골든에도 그 사실이 박혀 있어야 한다."""
    doc, golden = load(name)

    assert doc["review"]["status"] == "auto"
    assert golden["review"]["status"] == "auto"
