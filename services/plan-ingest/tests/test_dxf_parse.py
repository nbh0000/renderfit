"""DXF 파서 검증.

기준은 사양이 정한 그대로다 — **외곽 치수 1% 이내, 방 면적 3% 이내.**

정답은 재서 얻은 값이 아니라 **그려 넣은 값**이다(make_fixtures.py). 8000×6000 으로
그렸으면 정답이 8000×6000 이다. 그래서 오차 기준을 그대로 들이댈 수 있고, 파서가
틀리면 어디서 몇 mm 틀렸는지 바로 드러난다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.dxf_parse import is_dimension_text, normalize_block_name, parse_dxf  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"

#: 사양이 정한 오차
OUTLINE_TOLERANCE = 0.01
AREA_TOLERANCE = 0.03


def load(name: str) -> dict:
    path = FIXTURES / f"{name}.dxf"
    if not path.exists():
        pytest.skip(f"{path} 가 없습니다. python tests/make_fixtures.py 를 먼저 돌리세요.")
    return parse_dxf(path.read_bytes())


def area_of(doc: dict, name: str) -> float:
    """이름으로 방을 찾아 ㎡ 로 돌려준다."""
    for room in doc["rooms"]:
        if room.get("name") == name:
            return room["areaMm2"] / 1_000_000
    raise AssertionError(f"'{name}' 이라는 실이 없습니다: {[r.get('name') for r in doc['rooms']]}")


def close_enough(got: float, want: float, tolerance: float) -> bool:
    return abs(got - want) <= want * tolerance


# ───────────────────────── 주거 ─────────────────────────


class TestResidential:
    """8000 × 6000, 거실 24㎡ · 침실1 16㎡ · 욕실 8㎡."""

    def test_단위를_헤더에서_읽는다(self):
        doc = load("residential")
        assert doc["scale"]["mmPerUnit"] == 1.0
        assert doc["scale"]["confidence"] == 1.0
        assert doc["scale"]["source"] == "dxf-units"

    def test_외곽_치수가_1퍼센트_이내다(self):
        doc = load("residential")
        assert close_enough(doc["bounds"]["w"], 8000, OUTLINE_TOLERANCE)
        assert close_enough(doc["bounds"]["h"], 6000, OUTLINE_TOLERANCE)

    def test_방_면적이_3퍼센트_이내다(self):
        doc = load("residential")
        assert close_enough(area_of(doc, "거실"), 24.0, AREA_TOLERANCE)
        assert close_enough(area_of(doc, "침실1"), 16.0, AREA_TOLERANCE)
        assert close_enough(area_of(doc, "욕실"), 8.0, AREA_TOLERANCE)

    def test_평행선_두_줄이_벽_한_장이_된다(self):
        """선 12줄로 그렸지만 벽은 6장이어야 한다 — 안 그러면 방이 안 잡힌다."""
        doc = load("residential")
        assert len(doc["walls"]) == 6

    def test_외벽_두께를_간격에서_읽는다(self):
        doc = load("residential")
        thicknesses = sorted({round(wall["thickness"]) for wall in doc["walls"]})
        assert 200 in thicknesses  # 외벽
        assert 100 in thicknesses  # 내벽

    def test_문과_창이_벽에_매달린다(self):
        doc = load("residential")
        wall_ids = {wall["id"] for wall in doc["walls"]}
        assert doc["openings"], "문·창을 하나도 못 찾았습니다"
        for opening in doc["openings"]:
            assert opening["wallId"] in wall_ids

    def test_자동_결과는_확정하지_않는다(self):
        doc = load("residential")
        assert doc["review"]["status"] == "auto"


# ───────────────────────── 상업 ─────────────────────────


class TestCommercial:
    """24000 × 12000, 홀 144㎡ · 사무실 48㎡ 셋."""

    def test_외곽_치수(self):
        doc = load("commercial")
        assert close_enough(doc["bounds"]["w"], 24000, OUTLINE_TOLERANCE)
        assert close_enough(doc["bounds"]["h"], 12000, OUTLINE_TOLERANCE)

    def test_방_면적(self):
        doc = load("commercial")
        assert close_enough(area_of(doc, "홀"), 144.0, AREA_TOLERANCE)
        for name in ("사무실1", "사무실2", "사무실3"):
            assert close_enough(area_of(doc, name), 48.0, AREA_TOLERANCE)

    def test_방을_하나도_빠뜨리지_않는다(self):
        doc = load("commercial")
        assert len(doc["rooms"]) == 4

    def test_문창이_아닌_블록은_설비로_간다(self):
        doc = load("commercial")
        desks = [f for f in doc["fixtures"] if "desk" in f["kind"]]
        assert len(desks) == 3
        assert all(f["source"] == "dxf-block" for f in desks)


# ───────────────────────── 레이어가 지저분한 것 ─────────────────────────


class TestMessy:
    """10000 × 8000. 실무에서 보는 것들을 일부러 섞었다."""

    def test_레이어_이름이_제각각이어도_벽으로_본다(self):
        """WALL · 벽체 · 0-WALL 이 섞여 있다."""
        doc = load("messy")
        assert close_enough(doc["bounds"]["w"], 10000, OUTLINE_TOLERANCE)
        assert close_enough(doc["bounds"]["h"], 8000, OUTLINE_TOLERANCE)

    def test_해치와_치수_레이어를_벽으로_보지_않는다(self):
        """A-WALL-PATT · WALL-DIM 이 걸리면 두께 병합이 통째로 어긋난다."""
        doc = load("messy")
        assert len(doc["walls"]) == 5

    def test_60mm_어긋난_모서리를_붙여_방을_닫는다(self):
        """캐드에서 사람이 그린 벽은 모서리가 몇 mm 씩 어긋나 있다."""
        doc = load("messy")
        assert close_enough(area_of(doc, "사무실"), 48.0, AREA_TOLERANCE)

    def test_이름표가_없는_방은_이름을_비우고_지적한다(self):
        """아무거나 골라 붙이면 틀린 채로 확정되고, 틀렸다는 사실조차 안 남는다."""
        doc = load("messy")
        nameless = [room for room in doc["rooms"] if not room.get("name")]

        assert len(nameless) == 1
        assert close_enough(nameless[0]["areaMm2"] / 1e6, 32.0, AREA_TOLERANCE)
        assert any(flag["reason"] == "no-room-name" for flag in doc["review"]["flags"])

    def test_치수_글자를_실명으로_쓰지_않는다(self):
        """오른쪽 방 안에는 '4,000' 이라는 글자만 있다."""
        doc = load("messy")
        assert "4,000" not in {room.get("name") for room in doc["rooms"]}

    def test_익명_블록은_label_을_비우고_지적한다(self):
        doc = load("messy")
        anonymous = [f for f in doc["fixtures"] if "label" not in f]

        assert len(anonymous) == 1
        assert any(
            flag["reason"] == "meaningless-block-name" for flag in doc["review"]["flags"]
        )

    def test_텍스트를_전부_주석으로_담는다(self):
        doc = load("messy")
        texts = {item["text"] for item in doc["annotations"]}
        assert "사무실" in texts
        assert "4,000" in texts


# ───────────────────────── 낱개 규칙 ─────────────────────────


class TestRules:
    @pytest.mark.parametrize(
        "text,expected",
        [
            ("3,600", True),
            ("2400", True),
            ("W=900", True),
            ("1,200 x 2,100", True),
            ("", True),
            ("거실", False),
            ("사무실1", False),
            ("Master Bedroom", False),
        ],
    )
    def test_치수_글자_가리기(self, text: str, expected: bool):
        assert is_dimension_text(text) is expected

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("DESK-1400", "desk-1400"),
            ("Door_900", "door-900"),
            ("  WC BASIN  ", "wc-basin"),
        ],
    )
    def test_블록_이름_다듬기(self, raw: str, expected: str):
        assert normalize_block_name(raw) == expected


# ───────────────────── 실제 캐드 도면처럼 그린 아파트 ─────────────────────
#
# 앞의 세 장은 파서가 읽기 좋게 그린 그림이다 — 벽이 한 줄이고 문 자리에서도 이어져
# 있다. 실제 도면은 벽이 이중선이고 **문·창 자리에서 끊긴다.**
#
# 그 차이가 얼마나 큰지는 실제로 겪었다. 이 도면을 처음 넣었을 때 방이 **0개** 나왔다.
# 벽·개구부·설비는 다 읽었는데 고리가 닫히지 않아 평면이 통째로 비었다.

APARTMENT_ROOMS = {
    "거실": 17.10,
    "안방": 14.04,
    "침실2": 13.50,
    "발코니": 9.38,
    "주방": 8.36,
    "욕실": 7.50,
    "현관": 7.20,
}


def test_apartment_outline_is_exact() -> None:
    doc = load("apartment84")
    assert doc["bounds"]["w"] == pytest.approx(9400, rel=OUTLINE_TOLERANCE)
    assert doc["bounds"]["h"] == pytest.approx(8200, rel=OUTLINE_TOLERANCE)


def test_openings_do_not_break_the_rooms() -> None:
    """문 자리에서 벽이 끊겨도 방은 닫혀야 한다.

    끊긴 자리를 잇지 않으면 이 도면은 방이 0개가 된다.
    """
    doc = load("apartment84")
    assert len(doc["rooms"]) == len(APARTMENT_ROOMS)


def test_apartment_areas_match_the_drawing() -> None:
    doc = load("apartment84")
    actual = {room["name"]: room["areaMm2"] / 1e6 for room in doc["rooms"] if room.get("name")}

    assert set(actual) == set(APARTMENT_ROOMS)
    for name, expected in APARTMENT_ROOMS.items():
        assert actual[name] == pytest.approx(expected, rel=AREA_TOLERANCE), name


def test_door_jambs_are_not_walls() -> None:
    """문틀 마구리(벽 두께만큼 짧은 선)를 벽으로 세지 않는다.

    세어 버리면 문마다 200mm 짜리 벽 토막이 3D 에 혹처럼 붙고, 외곽도 벽 두께의
    절반만큼 커진다.
    """
    doc = load("apartment84")

    # 벽 11 줄이 개구부에서 21 토막으로 갈린다. 마구리까지 세면 40 개가 넘는다.
    assert len(doc["walls"]) == 21
    assert min(
        ((w["a"][0] - w["b"][0]) ** 2 + (w["a"][1] - w["b"][1]) ** 2) ** 0.5
        for w in doc["walls"]
    ) > 400


def test_apartment_fixtures_come_from_block_names() -> None:
    doc = load("apartment84")
    kinds = sorted(item["kind"] for item in doc["fixtures"])

    assert kinds == [
        "basin", "bed-q", "bed-q", "refrigerator", "shoe-cabi",
        "sink-1800", "sofa-3p", "table-d4", "toilet",
    ]


def test_hatch_and_centre_lines_are_not_walls() -> None:
    """해치(A-WALL-PATT)와 중심선(A-GRID)을 벽으로 읽으면 두께 병합이 통째로 어긋난다."""
    doc = load("apartment84")

    # 벽 두께는 외벽 200 · 내벽 100 둘뿐이다. 해치선이 섞이면 엉뚱한 값이 나온다
    assert sorted({round(wall["thickness"]) for wall in doc["walls"]}) == [100, 200]


def test_fixture_sizes_come_from_the_block_geometry() -> None:
    """설비 크기를 블록에서 실제로 재야 한다.

    ezdxf 의 INSERT 에는 bounding_box() 가 없다. 그 AttributeError 가 except 에
    삼켜지면서 **침대도 소파도 냉장고도 전부 300×300** 으로 떨어진 적이 있다.
    예외를 잡아 조용히 기본값으로 가는 코드라 어디에도 티가 나지 않았다.
    """
    doc = load("apartment84")
    sizes = {
        item["kind"]: (round(item["bbox"][2]), round(item["bbox"][3]))
        for item in doc["fixtures"]
    }

    assert sizes["bed-q"] == (1600, 2000)
    assert sizes["sofa-3p"] == (2200, 900)
    assert sizes["sink-1800"] == (1800, 600)
    assert sizes["toilet"] == (400, 700)
    assert sizes["basin"] == (550, 450)
