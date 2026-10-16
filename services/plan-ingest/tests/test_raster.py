"""래스터 경로 검증.

── 무엇을 시험하고 무엇을 시험하지 않나 ──

벡터화 모델(RasterScan)과 OCR(PaddleOCR)은 **부르지 않는다.** 유료이거나 무겁고,
그것이 잘 도는지는 우리가 고칠 수 있는 일이 아니다. 대신 그 자리에 가짜를 끼워
**우리 코드가 좌표를 어떻게 옮기는지**를 정확한 숫자로 검증한다.

정답은 재서 얻은 값이 아니라 **넣어 준 값**이다. 1000px 짜리 외곽에 "10,000" 이라고
적어 두었으면 배율은 정확히 10mm/px 여야 하고, 방 면적은 정확히 80㎡ 여야 한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from raster.label import load_fixture_defaults, seed_from_label  # noqa: E402
from raster.pipeline import build_doc  # noqa: E402
from raster.preprocess import (  # noqa: E402
    CropRect,
    Prepared,
    binarize,
    glyph_height,
    prepare,
)
from raster.scale_anchor import (  # noqa: E402
    OcrText,
    align_to_axis,
    anchor_scale,
    parse_dimension,
    snap_to_ticks,
)
from raster.vectorize import (  # noqa: E402
    BackendUnavailable,
    PixelOpening,
    PixelRoom,
    PixelWall,
    VectorizeResult,
    parse_rasterscan,
    vectorize,
)


# ───────────────────────── 치수 글자 ─────────────────────────


def test_comma_is_thousands_not_decimal() -> None:
    """콤마를 소수점으로 읽으면 도면이 1000배 작아진다."""
    assert parse_dimension("14,845") == 14845.0
    assert parse_dimension("17,169") == 17169.0


def test_plain_number_is_millimetres() -> None:
    assert parse_dimension("3600") == 3600.0
    assert parse_dimension("3600mm") == 3600.0


def test_decimal_point_means_metres() -> None:
    """mm 를 소수로 적는 도면은 없다. 2.45 는 2450mm 다."""
    assert parse_dimension("2.45") == 2450.0
    assert parse_dimension("2.45m") == 2450.0


def test_implausible_values_are_rejected() -> None:
    assert parse_dimension("12") is None          # 12mm 짜리 치수는 없다
    assert parse_dimension("999999999") is None   # 1km 짜리 방도 없다
    assert parse_dimension("주방") is None
    assert parse_dimension("") is None


# ───────────────────────── 배율 ─────────────────────────


def horizontal(text: str) -> OcrText:
    return OcrText(text=text, box=(0.0, 0.0, 100.0, 20.0))


def vertical(text: str) -> OcrText:
    return OcrText(text=text, box=(0.0, 0.0, 20.0, 100.0))


def test_scale_from_both_axes() -> None:
    anchor = anchor_scale([horizontal("10,000"), vertical("8,000")], (1000.0, 800.0))

    assert anchor.mm_per_pixel == pytest.approx(10.0)
    assert anchor.confidence == pytest.approx(0.9)
    assert anchor.flags == []


def test_scale_mismatch_is_flagged() -> None:
    """가로·세로가 어긋나면 둘 중 하나가 외곽 치수가 아니라는 뜻이다."""
    anchor = anchor_scale([horizontal("10,000"), vertical("8,000")], (1000.0, 1000.0))

    assert "scale-mismatch" in anchor.flags
    assert anchor.confidence < 0.6


def test_scale_with_one_axis_only() -> None:
    """세로 치수를 못 읽었을 때. 가로만 둘 읽었으므로 배율 자체는 낸다."""
    anchor = anchor_scale([horizontal("10,000"), horizontal("4,000")], (1000.0, 800.0))

    assert anchor.mm_per_pixel == pytest.approx(10.0)
    assert "scale-one-axis" in anchor.flags
    assert anchor.confidence == pytest.approx(0.6)


def test_no_dimension_text_means_zero_confidence() -> None:
    """못 읽었으면 짐작하지 않는다 — 검수 화면이 사용자에게 두 점을 찍게 한다."""
    anchor = anchor_scale([horizontal("주방"), horizontal("창고")], (1000.0, 800.0))

    assert anchor.confidence == 0.0
    assert anchor.flags == ["no-dimension-text"]


# ───────────────────────── 벽 정리 ─────────────────────────


def test_near_horizontal_wall_is_levelled() -> None:
    a, b = align_to_axis((0.0, 100.0), (1000.0, 108.0))  # 약 0.46도
    assert a[1] == pytest.approx(104.0)
    assert b[1] == pytest.approx(104.0)


def test_near_vertical_wall_is_plumbed() -> None:
    a, b = align_to_axis((100.0, 0.0), (106.0, 1000.0))
    assert a[0] == pytest.approx(103.0)
    assert b[0] == pytest.approx(103.0)


def test_genuine_diagonal_is_left_alone() -> None:
    """도면에 비스듬히 그려진 벽을 억지로 펴면 그건 더 이상 그 도면이 아니다."""
    a, b = align_to_axis((0.0, 0.0), (1000.0, 1000.0))
    assert (a, b) == ((0.0, 0.0), (1000.0, 1000.0))


def test_snap_to_ticks_only_when_close() -> None:
    assert snap_to_ticks(103.0, [100.0, 500.0], tolerance=10.0) == 100.0
    assert snap_to_ticks(103.0, [100.0, 500.0], tolerance=2.0) == 103.0
    assert snap_to_ticks(103.0, [], tolerance=10.0) == 103.0


# ───────────────────────── 벡터화 응답 ─────────────────────────


def test_parse_rasterscan_accepts_shape_variants() -> None:
    result = parse_rasterscan(
        {
            "walls": [
                {"start": [0, 0], "end": [100, 0], "thickness": 8, "confidence": 0.9},
                {"a": {"x": 0, "y": 0}, "b": {"x": 0, "y": 80}, "thickness": 8},
            ],
            "doors": [{"center": [50, 0], "width": 20, "score": 0.7}],
            "rooms": [{"polygon": [[0, 0], [100, 0], [100, 80], [0, 80]]}],
        }
    )

    assert len(result.walls) == 2
    assert result.walls[0].confidence == pytest.approx(0.9)
    # 신뢰도를 안 준 항목은 낮게 잡아 검수로 올린다
    assert result.walls[1].confidence == pytest.approx(0.5)
    assert result.openings[0].kind == "door"
    assert result.openings[0].confidence == pytest.approx(0.7)
    assert len(result.rooms[0].polygon) == 4
    assert result.backend == "rasterscan"


def test_parse_rasterscan_drops_unreadable_items() -> None:
    result = parse_rasterscan({"walls": [{"start": [0, 0]}], "rooms": [{"polygon": [[0, 0]]}]})
    assert result.walls == []
    assert result.rooms == []


def test_vectorize_raises_when_nothing_available() -> None:
    """빈 결과를 돌려주면 사용자는 자기 도면에 벽이 없는 줄 안다."""

    class Nothing:
        name = "nothing"

        def available(self) -> bool:
            return False

        def run(self, image):  # noqa: ANN001, ARG002
            raise AssertionError("불러서는 안 된다")

    with pytest.raises(BackendUnavailable):
        vectorize(np.zeros((4, 4), dtype=np.uint8), [Nothing()])


# ───────────────────────── 설비 기본값 ─────────────────────────


def test_known_label_becomes_placeholder() -> None:
    seed = seed_from_label("냉장고", (10.0, 20.0))
    assert seed is not None
    assert (seed.kind, seed.width_mm, seed.depth_mm) == ("refrigerator", 900.0, 700.0)
    # 도면에서 잰 값이 아니므로 낮다
    assert seed.confidence < 0.6


def test_english_alias_maps_to_same_item() -> None:
    seed = seed_from_label("REFRIGERATOR", (0.0, 0.0))
    assert seed is not None and seed.kind == "refrigerator"


def test_unknown_label_makes_nothing() -> None:
    """모르는 글자에 아무 크기나 붙이면 도면에 없는 가구가 생긴다."""
    assert seed_from_label("A-101", (0.0, 0.0)) is None
    assert seed_from_label("4,000", (0.0, 0.0)) is None
    assert seed_from_label("", (0.0, 0.0)) is None


def test_fixture_defaults_are_all_plausible() -> None:
    items = load_fixture_defaults()["items"]
    for name, spec in items.items():
        assert 200 <= spec["width"] <= 3000, name
        assert 200 <= spec["depth"] <= 2000, name


# ───────────────────────── 전처리 ─────────────────────────


def sample_image(width: int = 400, height: int = 300) -> bytes:
    import cv2

    image = np.full((height, width, 3), 255, dtype=np.uint8)
    cv2.rectangle(image, (50, 50), (width - 50, height - 50), (0, 0, 0), 3)
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    return buffer.tobytes()


def test_prepare_upscales_small_captures() -> None:
    prepared = prepare(sample_image())

    assert max(prepared.binary.shape[:2]) >= 2000
    assert prepared.upscale > 1.0


def test_to_source_pixels_undoes_crop_and_upscale() -> None:
    prepared = prepare(sample_image(), CropRect(40, 30, 200, 150))

    x, y = prepared.to_source_pixels(0.0, 0.0)
    assert (x, y) == (40.0, 30.0)

    x, y = prepared.to_source_pixels(prepared.upscale * 100, prepared.upscale * 50)
    assert (x, y) == pytest.approx((140.0, 80.0))


def test_crop_is_clamped_to_the_image() -> None:
    prepared = prepare(sample_image(400, 300), CropRect(-10, -10, 9999, 9999))
    assert (prepared.crop.x, prepared.crop.y) == (0, 0)
    assert (prepared.crop.width, prepared.crop.height) == (400, 300)


def test_binarize_keeps_faint_lines() -> None:
    """전역 문턱값이면 어두운 구석의 벽선이 통째로 사라진다."""
    gray = np.full((200, 200), 200, dtype=np.uint8)
    gray[:, :100] = 90            # 왼쪽 절반이 그늘졌다
    gray[100, :] = gray[100, :] - 60   # 그 위를 가로지르는 옅은 선

    binary = binarize(gray)
    assert binary[100, 20] == 0    # 그늘진 쪽 선도 남아 있다
    assert binary[100, 180] == 0


def test_binarize_keeps_one_pixel_lines() -> None:
    """캡처 도면의 벽이 1픽셀이다. 흐리게 걸렀더니 그게 통째로 지워졌다."""
    gray = np.full((200, 200), 235, dtype=np.uint8)
    gray[100, :] = 40

    assert binarize(gray)[100, 100] == 0


# ───────────────────────── 조립 ─────────────────────────

#: 10m × 8m 건물을 1000 × 800px 로 그린 셈이다. 배율은 정확히 10mm/px 여야 한다.
CORNERS = [(100.0, 900.0), (1100.0, 900.0), (1100.0, 100.0), (100.0, 100.0)]


def fake_prepared() -> Prepared:
    """전처리를 거치지 않고 좌표만 그대로 통과시키는 Prepared."""
    return Prepared(
        binary=np.zeros((1000, 1200), dtype=np.uint8),
        cropped=np.full((1000, 1200, 3), 255, dtype=np.uint8),
        crop=CropRect(0, 0, 1200, 1000),
        upscale=1.0,
        upscaler="none",
    )


def fake_vector(wall_confidence: float = 0.9) -> VectorizeResult:
    walls = []
    for index in range(4):
        a = CORNERS[index]
        b = CORNERS[(index + 1) % 4]
        walls.append(PixelWall(a=a, b=b, thickness_px=10.0, confidence=wall_confidence))

    return VectorizeResult(
        walls=walls,
        openings=[PixelOpening(kind="door", center=(600.0, 900.0), width_px=90.0, confidence=0.8)],
        rooms=[PixelRoom(polygon=list(CORNERS), confidence=0.9)],
        backend="fake",
    )


def fake_texts() -> list[OcrText]:
    return [
        OcrText(text="10,000", box=(500.0, 950.0, 100.0, 20.0)),
        OcrText(text="8,000", box=(40.0, 400.0, 20.0, 100.0)),
        OcrText(text="냉장고", box=(500.0, 300.0, 60.0, 20.0)),
    ]


def build(**kwargs) -> dict:
    return build_doc(fake_prepared(), fake_vector(**kwargs), fake_texts(), labeler=False)


def test_origin_is_bottom_left_and_y_points_up() -> None:
    """여기서 y 를 안 뒤집으면 도면이 위아래로 뒤집힌 채 3D 까지 흘러간다."""
    doc = build()
    points = [tuple(wall["a"]) for wall in doc["walls"]]

    assert (0.0, 0.0) in points          # 원본에서 가장 왼쪽·가장 아래
    assert (10000.0, 8000.0) in points   # 오른쪽 위


def test_bounds_come_from_the_dimension_text() -> None:
    doc = build()
    assert doc["bounds"] == {"w": 10000.0, "h": 8000.0}
    assert doc["scale"]["mmPerUnit"] == pytest.approx(10.0)
    assert doc["scale"]["source"] == "dimension-ocr"


def test_room_area_is_the_polygon_area() -> None:
    """면적은 폴리곤에서만 낸다 — 10m × 8m = 80㎡."""
    doc = build()
    assert doc["rooms"][0]["areaMm2"] == pytest.approx(80_000_000.0)


def test_wall_thickness_uses_the_same_scale() -> None:
    doc = build()
    assert doc["walls"][0]["thickness"] == pytest.approx(100.0)


def test_opening_is_placed_along_its_wall() -> None:
    doc = build()
    opening = doc["openings"][0]

    bottom = next(w for w in doc["walls"] if w["a"][1] == 0.0 and w["b"][1] == 0.0)
    assert opening["wallId"] == bottom["id"]
    assert opening["width"] == pytest.approx(900.0)
    # 벽 시작점에서 5m 되는 곳이 문 가운데다
    assert opening["offset"] + opening["width"] / 2 == pytest.approx(5000.0, abs=1.0)


def test_low_confidence_walls_all_reach_review() -> None:
    """사양이 정한 것 — 0.6 미만은 하나도 빠짐없이 올라간다."""
    doc = build(wall_confidence=0.4)
    flagged = {f["target"] for f in doc["review"]["flags"] if f["reason"] == "low-confidence-wall"}

    assert flagged == {wall["id"] for wall in doc["walls"]}


def test_confident_walls_are_not_flagged() -> None:
    doc = build(wall_confidence=0.9)
    assert not [f for f in doc["review"]["flags"] if f["reason"] == "low-confidence-wall"]


def test_result_is_never_confirmed_automatically() -> None:
    assert build()["review"]["status"] == "auto"


def test_label_text_becomes_a_placeholder_fixture() -> None:
    doc = build()
    fixture = next(f for f in doc["fixtures"] if f["kind"] == "refrigerator")

    assert fixture["source"] == "ocr-label"
    assert fixture["bbox"][2:] == [900.0, 700.0]
    # 글자 자리가 가운데다: (530, 310)px → (4300, 5900)mm
    assert fixture["bbox"][0] == pytest.approx(4300.0 - 450.0)
    assert fixture["bbox"][1] == pytest.approx(5900.0 - 350.0)
    # 표준 규격이라는 사실을 검수 화면이 알아야 한다
    assert any(
        f["target"] == fixture["id"] and f["reason"] == "fixture-placeholder-size"
        for f in doc["review"]["flags"]
    )


def test_dimension_text_is_not_a_fixture() -> None:
    doc = build()
    assert len(doc["fixtures"]) == 1


def test_dimension_text_is_marked_as_dimension() -> None:
    doc = build()
    kinds = {item["text"]: item["kind"] for item in doc["annotations"]}

    assert kinds["10,000"] == "dimension"
    assert kinds["냉장고"] == "label"


def test_document_has_every_required_field() -> None:
    doc = build()
    assert set(doc) == {
        "id",
        "sourceType",
        "scale",
        "bounds",
        "walls",
        "openings",
        "rooms",
        "fixtures",
        "annotations",
        "review",
        "underlay",
    }
    assert doc["sourceType"] == "raster"


def test_underlay_maps_the_original_image_onto_the_plan() -> None:
    """검수 화면이 원본 그림을 겹쳐 놓으려면 맞물림을 알아야 한다."""
    doc = build()
    underlay = doc["underlay"]

    assert underlay["mmPerPixel"] == pytest.approx(10.0)
    # 도면 원점(좌하단)은 원본에서 가장 왼쪽·가장 아래 픽셀이다
    assert underlay["originPx"] == [100.0, 900.0]


# ───────────────────────── 해상도 ─────────────────────────


def test_glyph_height_measures_the_text() -> None:
    """도면에 적힌 글자가 몇 픽셀인지 잰다 — 정확도를 먼저 정하는 값이다."""
    import cv2

    image = np.full((300, 400, 3), 255, dtype=np.uint8)
    for index in range(30):
        cv2.putText(
            image, "4440", (10 + (index % 6) * 60, 30 + (index // 6) * 50),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1
        )

    height = glyph_height(image)
    assert height is not None
    # 0.5 배 폰트의 숫자 높이는 10px 안팎이다
    assert 6 <= height <= 16


def test_glyph_height_is_none_when_there_is_no_text() -> None:
    """선만 있는 그림에서 글자 높이를 지어내지 않는다."""
    assert glyph_height(np.full((200, 200, 3), 255, dtype=np.uint8)) is None


def test_low_resolution_is_flagged_not_blocked() -> None:
    """작은 그림도 받되, **왜 결과가 나쁜지** 알려 준다.

    사용자는 손에 있는 파일을 올릴 뿐이다. 막아 버리면 아무것도 못 하고, 조용히
    통과시키면 왜 엉망인지 알 수 없다.
    """
    doc = build_doc(fake_prepared(), fake_vector(), fake_texts(), labeler=False, glyph_px=3)
    reasons = [flag["reason"] for flag in doc["review"]["flags"]]

    assert "low-resolution" in reasons
    # 막지 않는다 — 읽은 것은 그대로 들어 있다
    assert doc["walls"] and doc["rooms"]


def test_legible_drawing_is_not_flagged() -> None:
    doc = build_doc(fake_prepared(), fake_vector(), fake_texts(), labeler=False, glyph_px=18)
    assert "low-resolution" not in [flag["reason"] for flag in doc["review"]["flags"]]


def test_one_number_is_not_an_outline_dimension() -> None:
    """숫자 하나를 외곽 치수로 믿으면 11m 짜리 집이 2m 가 된다.

    저해상도 도면에서 실제로 그랬다 — OCR 이 구석의 2150 하나만 읽어 왔는데, 그것을
    외곽으로 삼으면 배율이 5배 틀리고도 화면에는 멀쩡하게 뜬다.
    """
    anchor = anchor_scale([horizontal("2150")], (1000.0, 800.0))

    assert "few-dimension-text" in anchor.flags
    assert anchor.confidence <= 0.3


def test_enough_dimensions_are_trusted() -> None:
    anchor = anchor_scale(
        [horizontal("10,000"), horizontal("4,000"), vertical("8,000"), vertical("3,000")],
        (1000.0, 800.0),
    )

    assert "few-dimension-text" not in anchor.flags
    assert anchor.confidence == pytest.approx(0.9)
