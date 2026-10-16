"""OpenCV 벡터화 백엔드 검증.

── 정답을 어떻게 아나 ──

도면을 **우리가 그려서** 넣는다. 벽을 어디에 몇 픽셀 굵기로 그렸는지, 문틈을 어디에
얼마나 벌려 두었는지 전부 아는 상태에서 넣으므로, 정답은 재서 얻은 값이 아니라
**넣어 준 값**이다. 20px 로 그린 벽은 20px 로 나와야 하고, 120px 벌려 둔 문틈은
120px 로 나와야 한다.

유료 호출도 모델도 없다 — 전부 opencv 계산이라 이 시험만으로 완전히 검증된다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from raster.opencv_backend import (  # noqa: E402
    CONFIDENCE_AXIS_THICK,
    OpenCvBackend,
)
from raster.vectorize import LOW_CONFIDENCE, default_backends  # noqa: E402

#: 시험용 도면 크기. 전처리가 긴 변을 2000px 까지 키우므로 그 언저리로 둔다.
WIDTH, HEIGHT = 2400, 1600

#: 방 두 칸의 안쪽 경계 (좌상단 x, y / 우하단 x, y)
LEFT, TOP, RIGHT, BOTTOM = 200, 200, 2200, 1400
MIDDLE = 1200
THICKNESS = 20

#: 가운데 벽에 낸 문틈
DOOR_FROM, DOOR_TO = 700, 820


def _blank() -> np.ndarray:
    return np.full((HEIGHT, WIDTH), 255, np.uint8)


def solid_plan() -> np.ndarray:
    """벽을 굵게 칠한 도면. CAD 에서 내보낸 평면도의 가장 흔한 모양이다."""
    image = _blank()

    def wall(x0: int, y0: int, x1: int, y1: int) -> None:
        cv2.rectangle(image, (x0, y0), (x1, y1), 0, -1)

    wall(LEFT, TOP, RIGHT, TOP + THICKNESS)
    wall(LEFT, BOTTOM - THICKNESS, RIGHT, BOTTOM)
    wall(LEFT, TOP, LEFT + THICKNESS, BOTTOM)
    wall(RIGHT - THICKNESS, TOP, RIGHT, BOTTOM)
    wall(MIDDLE, TOP, MIDDLE + THICKNESS, DOOR_FROM)
    wall(MIDDLE, DOOR_TO, MIDDLE + THICKNESS, BOTTOM)

    return image


def double_line_plan() -> np.ndarray:
    """벽을 평행한 두 선으로 그린 도면."""
    image = _blank()

    def horizontal(x0: int, x1: int, y: int) -> None:
        cv2.line(image, (x0, y), (x1, y), 0, 2)
        cv2.line(image, (x0, y + THICKNESS), (x1, y + THICKNESS), 0, 2)

    def vertical(y0: int, y1: int, x: int) -> None:
        cv2.line(image, (x, y0), (x, y1), 0, 2)
        cv2.line(image, (x + THICKNESS, y0), (x + THICKNESS, y1), 0, 2)

    horizontal(LEFT, RIGHT, TOP)
    horizontal(LEFT, RIGHT, BOTTOM - THICKNESS)
    vertical(TOP, BOTTOM, LEFT)
    vertical(TOP, BOTTOM, RIGHT - THICKNESS)
    vertical(TOP, DOOR_FROM, MIDDLE)
    vertical(DOOR_TO, BOTTOM, MIDDLE)

    return image


def _areas(result) -> list[float]:
    return sorted(
        float(cv2.contourArea(np.array(room.polygon, np.float32))) for room in result.rooms
    )


# ───────────────────────── 벽 ─────────────────────────


def test_finds_every_wall_of_a_solid_plan() -> None:
    """외벽 넷과 가운데 벽 하나 — 다섯이다.

    가운데 벽은 문틈에서 끊어 두지 않는다. 문이 난 벽은 문을 품은 한 장의 벽이다.
    """
    result = OpenCvBackend().run(solid_plan())
    assert len(result.walls) == 5


def test_wall_thickness_is_measured_not_guessed() -> None:
    """20px 로 그렸으면 20px 로 나와야 한다. 표준 규격으로 되돌리지 않는다."""
    result = OpenCvBackend().run(solid_plan())
    for wall in result.walls:
        assert wall.thickness_px == pytest.approx(THICKNESS + 1, abs=2)


def test_thin_lines_are_not_walls() -> None:
    """치수선과 글자는 벽이 아니다 — 굵기로 갈린다."""
    image = solid_plan()
    cv2.line(image, (LEFT, 120), (RIGHT, 120), 0, 1)
    cv2.putText(image, "3600", (1100, 100), cv2.FONT_HERSHEY_SIMPLEX, 0.8, 0, 1)

    assert len(OpenCvBackend().run(image).walls) == 5


def test_solid_walls_are_confident_enough_to_pass_review() -> None:
    """굵게 칠한 벽은 자리·굵기가 전부 측정값이라 지적으로 올리지 않는다."""
    result = OpenCvBackend().run(solid_plan())
    assert all(wall.confidence >= LOW_CONFIDENCE for wall in result.walls)
    assert all(wall.confidence == CONFIDENCE_AXIS_THICK for wall in result.walls)


# ───────────────────────── 두 줄로 그린 벽 ─────────────────────────


def test_double_lines_become_one_wall_each() -> None:
    """두 줄로 그린 벽을 둘로 세면 벽이 열 개가 되고 그 사이가 방이 된다."""
    result = OpenCvBackend().run(double_line_plan())
    assert len(result.walls) == 5


def test_double_line_thickness_is_the_gap_between_the_lines() -> None:
    """두 줄의 바깥면 사이 거리가 벽 두께다 — 도면에 그렇게 그려져 있다."""
    result = OpenCvBackend().run(double_line_plan())
    for wall in result.walls:
        assert wall.thickness_px == pytest.approx(THICKNESS + 3, abs=3)


def test_the_same_plan_drawn_two_ways_reads_the_same() -> None:
    """같은 집을 굵게 칠하든 두 줄로 긋든 같은 기하가 나와야 한다.

    이진화가 굵은 벽의 속을 비우므로 두 경우가 사실상 같은 그림이 된다. 둘이
    갈라지면 결과가 도면이 아니라 **그림 그린 방식**에 좌우된다는 뜻이다.
    """
    solid = OpenCvBackend().run(solid_plan())
    double = OpenCvBackend().run(double_line_plan())

    assert len(solid.walls) == len(double.walls)
    assert len(solid.openings) == len(double.openings)
    assert len(solid.rooms) == len(double.rooms)


def test_the_wall_cavity_is_not_a_room() -> None:
    """두 줄 사이의 빈 속은 방이 아니다."""
    result = OpenCvBackend().run(double_line_plan())
    assert len(result.rooms) == 2


# ───────────────────────── 개구부 ─────────────────────────


@pytest.mark.parametrize("plan", [solid_plan, double_line_plan])
def test_a_gap_in_the_wall_becomes_an_opening(plan) -> None:
    result = OpenCvBackend().run(plan())
    assert len(result.openings) == 1


@pytest.mark.parametrize("plan", [solid_plan, double_line_plan])
def test_opening_width_is_the_gap_we_drew(plan) -> None:
    """120px 벌려 두었으면 120px 이다."""
    opening = OpenCvBackend().run(plan()).openings[0]
    assert opening.width_px == pytest.approx(DOOR_TO - DOOR_FROM, abs=5)


@pytest.mark.parametrize("plan", [solid_plan, double_line_plan])
def test_opening_sits_at_the_gap(plan) -> None:
    opening = OpenCvBackend().run(plan()).openings[0]
    assert opening.center[0] == pytest.approx(MIDDLE + THICKNESS / 2, abs=THICKNESS)
    assert opening.center[1] == pytest.approx((DOOR_FROM + DOOR_TO) / 2, abs=8)


@pytest.mark.parametrize("plan", [solid_plan, double_line_plan])
def test_opening_kind_is_never_asserted(plan) -> None:
    """문인지 창인지는 그림에서 잴 수 없다. 전부 검수로 올려 사람이 고른다."""
    opening = OpenCvBackend().run(plan()).openings[0]
    assert opening.confidence < LOW_CONFIDENCE


def test_the_wall_spans_its_doorway() -> None:
    """문이 난 벽은 한 장이어야 한다.

    문틈에서 벽을 둘로 끊어 놓으면 그 문이 붙을 벽이 없어진다. FloorPlanDoc 에서
    개구부는 벽에 속하기 때문이다(wallId + 벽 위의 offset).
    """
    result = OpenCvBackend().run(solid_plan())

    middle = [
        wall
        for wall in result.walls
        if abs(wall.a[0] - wall.b[0]) < 5 and abs(wall.a[0] - (MIDDLE + THICKNESS / 2)) < THICKNESS
    ]
    assert len(middle) == 1

    span = sorted((middle[0].a[1], middle[0].b[1]))
    assert span[0] <= DOOR_FROM and span[1] >= DOOR_TO


def test_the_opening_reaches_the_document_attached_to_a_wall() -> None:
    """벽에 못 붙은 개구부는 pipeline 이 버린다 — 문이 통째로 사라진다.

    실제로 그렇게 사라졌다. 백엔드만 보지 말고 문서까지 내려가 확인한다.
    """
    from raster.pipeline import build_doc
    from raster.preprocess import CropRect, Prepared
    from raster.scale_anchor import OcrText

    image = solid_plan()
    prepared = Prepared(
        binary=image,
        cropped=cv2.cvtColor(image, cv2.COLOR_GRAY2BGR),
        crop=CropRect(0, 0, WIDTH, HEIGHT),
        upscale=1.0,
        upscaler="none",
    )
    texts = [OcrText(text="10,000", box=(1100.0, 100.0, 200.0, 30.0))]

    doc = build_doc(prepared, OpenCvBackend().run(image), texts, labeler=False)

    assert len(doc["openings"]) == 1
    assert doc["openings"][0]["wallId"] in {wall["id"] for wall in doc["walls"]}
    assert not any(flag["reason"] == "opening-unattached" for flag in doc["review"]["flags"])


def test_a_corner_notch_is_not_an_opening() -> None:
    """모서리에서 생기는 자잘한 틈을 문으로 읽으면 없는 자리에 구멍이 난다."""
    image = solid_plan()
    # 벽 끝을 아주 조금(문 폭의 1/20) 지운다
    cv2.rectangle(image, (MIDDLE, 1000), (MIDDLE + THICKNESS, 1006), 255, -1)

    result = OpenCvBackend().run(image)
    assert len(result.openings) == 1


# ───────────────────────── 방 ─────────────────────────


@pytest.mark.parametrize("plan", [solid_plan, double_line_plan])
def test_finds_both_rooms(plan) -> None:
    assert len(OpenCvBackend().run(plan()).rooms) == 2


@pytest.mark.parametrize("plan", [solid_plan, double_line_plan])
def test_room_area_matches_the_drawing(plan) -> None:
    """방 넓이는 폴리곤에서 나온다. 그린 대로 나와야 한다 (1% 안)."""
    inner_height = (BOTTOM - THICKNESS) - (TOP + THICKNESS)
    expected = sorted(
        [
            (MIDDLE - (LEFT + THICKNESS)) * inner_height,
            ((RIGHT - THICKNESS) - (MIDDLE + THICKNESS)) * inner_height,
        ]
    )

    for measured, wanted in zip(_areas(OpenCvBackend().run(plan())), expected):
        assert measured == pytest.approx(wanted, rel=0.01)


def test_outside_the_building_is_not_a_room() -> None:
    """그림 가장자리에 닿는 흰 영역은 건물 바깥이다."""
    result = OpenCvBackend().run(solid_plan())
    total = float(WIDTH * HEIGHT)
    assert all(area < 0.6 * total for area in _areas(result))


def test_rooms_do_not_leak_through_the_doorway() -> None:
    """문틈을 안 메우면 두 방이 한 덩어리가 되어 면적이 두 배로 나온다."""
    result = OpenCvBackend().run(solid_plan())
    biggest = _areas(result)[-1]
    assert biggest < 0.6 * (RIGHT - LEFT) * (BOTTOM - TOP)


def test_a_room_closed_by_a_doorway_is_sent_to_review() -> None:
    """문틈을 이어 붙여 가둔 방은, 그 틈이 정말 문이었는지 사람이 봐야 한다."""
    result = OpenCvBackend().run(solid_plan())
    assert result.rooms
    assert all(room.confidence < LOW_CONFIDENCE for room in result.rooms)


def test_a_room_sealed_by_real_walls_is_not_flagged() -> None:
    """경계가 전부 잰 값인 방까지 지적으로 올리면 지적이 뜻을 잃는다."""
    image = _blank()
    cv2.rectangle(image, (LEFT, TOP), (RIGHT, BOTTOM), 0, THICKNESS)

    result = OpenCvBackend().run(image)
    assert len(result.rooms) == 1
    assert result.rooms[0].confidence >= LOW_CONFIDENCE


# ───────────────────────── 사선 벽 ─────────────────────────


def test_a_slanted_wall_is_not_silently_dropped() -> None:
    """사선 벽을 못 읽고 넘어가면 3D 에서 벽이 통째로 사라진다.

    가로·세로만 뽑고 끝내면 조용히 빠진다. 조용히 빠지는 것이 가장 나쁘다.
    """
    image = solid_plan()
    cv2.line(image, (400, 1300), (1100, 600), 0, THICKNESS)

    result = OpenCvBackend().run(image)

    def slanted(wall) -> bool:
        return abs(wall.a[0] - wall.b[0]) > 50 and abs(wall.a[1] - wall.b[1]) > 50

    assert any(slanted(wall) for wall in result.walls)


def test_a_slanted_wall_is_sent_to_review() -> None:
    """사선은 우리 방식이 가장 약한 곳이다 — 확정하지 않는다."""
    image = solid_plan()
    cv2.line(image, (400, 1300), (1100, 600), 0, THICKNESS)

    result = OpenCvBackend().run(image)
    for wall in result.walls:
        if abs(wall.a[0] - wall.b[0]) > 50 and abs(wall.a[1] - wall.b[1]) > 50:
            assert wall.confidence < LOW_CONFIDENCE


# ───────────────────────── 빈 그림 ─────────────────────────


def test_blank_image_yields_nothing_rather_than_something() -> None:
    """빈 종이에서 벽을 지어내지 않는다."""
    result = OpenCvBackend().run(_blank())
    assert result.walls == []
    assert result.rooms == []
    assert result.openings == []


def test_noise_alone_is_not_a_plan() -> None:
    """얼룩 몇 점을 벽으로 읽으면 사용자는 자기 도면이 이상한 줄 안다."""
    image = _blank()
    rng = np.random.default_rng(20260908)
    for _ in range(300):
        x, y = int(rng.integers(0, WIDTH)), int(rng.integers(0, HEIGHT))
        cv2.circle(image, (x, y), 2, 0, -1)

    assert OpenCvBackend().run(image).walls == []


# ───────────────────────── 그림 한 장 → 문서 ─────────────────────────


def _document(image: np.ndarray) -> dict:
    """전처리부터 문서까지 실제 경로를 그대로 태운다.

    OCR 과 라벨러만 부르지 않는다 — 하나는 무겁고 하나는 유료다. 치수 글자는 넣어 준
    값을 쓰므로 배율의 정답을 우리가 안다: 외곽 2000px 에 10,000mm 이면 5mm/px 다.
    """
    from raster.pipeline import build_doc
    from raster.preprocess import prepare
    from raster.scale_anchor import OcrText
    from raster.vectorize import vectorize

    ok, buffer = cv2.imencode(".png", image)
    assert ok
    prepared = prepare(buffer.tobytes())

    texts = [
        OcrText(text="10,000", box=(1100.0, 100.0, 200.0, 30.0)),
        OcrText(text="6,000", box=(60.0, 800.0, 30.0, 160.0)),
    ]
    return build_doc(prepared, vectorize(prepared.binary), texts, labeler=False)


def test_scale_comes_out_of_the_dimension_text() -> None:
    """외곽 2000px 에 10,000mm 이라고 적혀 있으면 배율은 5mm/px 다."""
    doc = _document(solid_plan())
    assert doc["scale"]["mmPerUnit"] == pytest.approx(5.0, rel=0.01)


def test_room_area_in_millimetres_matches_the_drawing() -> None:
    """면적이 mm 로 바뀌어 나올 때까지 어긋나지 않아야 한다 (2% 안)."""
    doc = _document(solid_plan())

    inner_height = (BOTTOM - THICKNESS) - (TOP + THICKNESS)
    expected = sorted(
        [
            (MIDDLE - (LEFT + THICKNESS)) * inner_height * 25.0,
            ((RIGHT - THICKNESS) - (MIDDLE + THICKNESS)) * inner_height * 25.0,
        ]
    )
    measured = sorted(room["areaMm2"] for room in doc["rooms"])

    assert len(measured) == 2
    for got, wanted in zip(measured, expected):
        assert got == pytest.approx(wanted, rel=0.02)


def test_wall_thickness_in_millimetres_matches_the_drawing() -> None:
    """20px 를 5mm/px 로 재면 100mm 다. 표준 두께로 갈아치우지 않는다."""
    doc = _document(solid_plan())
    for wall in doc["walls"]:
        assert wall["thickness"] == pytest.approx(105.0, rel=0.05)


def test_opening_width_in_millimetres_matches_the_drawing() -> None:
    doc = _document(solid_plan())
    assert len(doc["openings"]) == 1
    assert doc["openings"][0]["width"] == pytest.approx(600.0, rel=0.05)


def test_the_dimension_text_itself_never_becomes_a_wall() -> None:
    """치수 글자가 벽으로 서면 도면 외곽이 밀리고 배율까지 어긋난다."""
    doc = _document(solid_plan())
    assert len(doc["walls"]) == 5


def test_a_raster_document_is_never_confirmed() -> None:
    doc = _document(solid_plan())
    assert doc["review"]["status"] != "confirmed"


# ───────────────────────── 등록 ─────────────────────────


def test_opencv_is_the_default_backend() -> None:
    """키 없이도 래스터 경로가 열려 있어야 한다 — 없으면 501 만 나간다."""
    ready = [backend for backend in default_backends() if backend.available()]
    assert ready
    assert ready[0].name == "opencv"
