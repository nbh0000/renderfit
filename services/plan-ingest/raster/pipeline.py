"""래스터 도면 → FloorPlanDoc.

전처리 → 벡터화 → 치수 앵커 → 라벨 순서로 지나간다. 각 단계는 자기 파일에 있고,
여기서는 **좌표계를 옮기는 일**만 조심하면 된다. 세 가지 좌표계가 나온다.

  1. 전처리 그림 픽셀 — 벡터화 모델이 답하는 좌표. y 는 아래로 커진다.
  2. 원본 이미지 픽셀 — OCR 이 읽는 좌표. y 는 아래로 커진다.
  3. FloorPlanDoc mm — x 오른쪽, **y 위쪽**, 원점은 외곽 좌하단.

1 → 2 는 Prepared.to_source_pixels 가 한다. 2 → 3 은 여기서 한다. 이때 y 를 뒤집는
것을 빠뜨리면 도면이 위아래로 뒤집힌 채 3D 까지 흘러간다.

── 자동으로 확정하지 않는다 ──

벡터화가 낸 벽 중 confidence 가 0.6 미만인 것은 하나도 빠짐없이 review.flags 로
올린다. 낮은 신뢰도를 조용히 통과시키면 사용자는 그것이 측정된 값인 줄 안다.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from typing import Any

import numpy as np

from .label import HallCount, RoomLabel, count_hall_tables, label_room, seeds_from_texts
from .preprocess import (
    LEGIBLE_TEXT_PX,
    CropRect,
    Prepared,
    encode_png,
    glyph_height,
    prepare,
)
from .scale_anchor import OcrEngine, OcrText, align_to_axis, anchor_scale, default_ocr, parse_dimension
from .vectorize import LOW_CONFIDENCE, VectorizeResult, vectorize

#: 개구부를 벽에 붙일 때 이보다 멀면 붙이지 않는다 (원본 픽셀).
#: 멀리 있는 문을 억지로 붙이면 없는 자리에 구멍이 뚫린다.
OPENING_SNAP_PX = 40.0

#: 벽 두께를 못 읽었을 때 (mm). 실측이 아니므로 flag 로 함께 올린다.
FALLBACK_THICKNESS_MM = 100.0


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@dataclass
class Flag:
    target: str
    reason: str


# ───────────────────────── 좌표 ─────────────────────────


@dataclass
class Frame:
    """원본 픽셀 → 도면 mm.

    원점은 도면 외곽 좌하단이다. 원본 픽셀에서 y 가 가장 큰 곳(그림 아래)이 mm 에서
    y=0 이 된다.
    """

    min_x: float
    max_y: float
    mm_per_pixel: float

    def to_mm(self, x: float, y: float) -> list[float]:
        return [
            round((x - self.min_x) * self.mm_per_pixel, 1),
            round((self.max_y - y) * self.mm_per_pixel, 1),
        ]


def _polygon_area(ring: list[list[float]]) -> float:
    """신발끈 공식. 면적은 폴리곤에서만 낸다 — 짐작하지 않는다."""
    total = 0.0
    count = len(ring)
    for index in range(count):
        x1, y1 = ring[index]
        x2, y2 = ring[(index + 1) % count]
        total += x1 * y2 - x2 * y1
    return abs(total) / 2


def _point_in_ring(point: tuple[float, float], ring: list[tuple[float, float]]) -> bool:
    """레이 캐스팅. 방 안에서 읽힌 글자를 고를 때 쓴다."""
    x, y = point
    inside = False
    count = len(ring)
    for index in range(count):
        x1, y1 = ring[index]
        x2, y2 = ring[(index + 1) % count]
        if (y1 > y) != (y2 > y):
            cross = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if cross > x:
                inside = not inside
    return inside


def _nearest_wall(
    center: tuple[float, float],
    walls: list[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[int, float, float] | None:
    """개구부 중심에 가장 가까운 벽. (벽 번호, 벽 시작점에서의 거리, 수직 거리).

    돌려주는 거리는 전부 원본 픽셀이다. mm 로 바꾸는 것은 부르는 쪽 몫이다.
    """
    best: tuple[int, float, float] | None = None
    best_gap = math.inf

    for index, (a, b) in enumerate(walls):
        dx, dy = b[0] - a[0], b[1] - a[1]
        length_sq = dx * dx + dy * dy
        if length_sq <= 1e-9:
            continue

        t = ((center[0] - a[0]) * dx + (center[1] - a[1]) * dy) / length_sq
        t = max(0.0, min(1.0, t))
        foot = (a[0] + dx * t, a[1] + dy * t)
        gap = math.hypot(center[0] - foot[0], center[1] - foot[1])

        if gap < best_gap:
            best_gap = gap
            best = (index, t * math.sqrt(length_sq), gap)

    return best


# ───────────────────────── 조립 ─────────────────────────


def build_doc(
    prepared: Prepared,
    vector: VectorizeResult,
    texts: list[OcrText],
    *,
    labeler: bool = True,
    glyph_px: float | None = None,
) -> dict[str, Any]:
    """확정된 기하와 읽힌 글자로 FloorPlanDoc 을 만든다.

    labeler=False 면 LLM 을 부르지 않는다. 시험할 때 쓰는 길이다 — 검증하겠다고 유료
    호출을 반복하지 않기 위해서다.
    """
    flags: list[Flag] = []

    # ── 0. 이 그림으로 읽을 수 있기는 한가 ──
    #
    # 래스터 경로의 정확도는 알고리즘보다 **입력 해상도**가 먼저 정한다. 치수 글자가
    # 몇 픽셀밖에 안 되면 배율을 정할 수 없고, 배율이 없으면 벽을 잘 찾아도 mm 가
    # 나오지 않는다. 막지는 않는다 — 사용자는 손에 있는 파일을 올릴 뿐이고, 조금이라도
    # 건질 것이 있으면 건지는 편이 낫다. 다만 **왜 결과가 나쁜지는 알려 준다.**
    if glyph_px is not None and glyph_px < LEGIBLE_TEXT_PX:
        flags.append(Flag(target="doc", reason="low-resolution"))

    # ── 1. 벽을 원본 픽셀로 옮기고 축에 맞춘다 ──
    wall_points: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for wall in vector.walls:
        a = prepared.to_source_pixels(*wall.a)
        b = prepared.to_source_pixels(*wall.b)
        # 벡터화 모델이 낸 벽은 1~2도씩 기울어 있다. 정말 사선인 벽은 건드리지 않는다.
        wall_points.append(align_to_axis(a, b))

    if not wall_points:
        flags.append(Flag(target="doc", reason="no-walls"))

    # ── 2. 배율 ──
    xs = [value for a, b in wall_points for value in (a[0], b[0])]
    ys = [value for a, b in wall_points for value in (a[1], b[1])]
    outline = (
        (max(xs) - min(xs)) if xs else float(prepared.crop.width),
        (max(ys) - min(ys)) if ys else float(prepared.crop.height),
    )

    anchor = anchor_scale(texts, outline)
    for reason in anchor.flags:
        flags.append(Flag(target="scale", reason=reason))

    frame = Frame(
        min_x=min(xs) if xs else float(prepared.crop.x),
        max_y=max(ys) if ys else float(prepared.crop.y + prepared.crop.height),
        mm_per_pixel=anchor.mm_per_pixel,
    )

    # ── 3. 벽 ──
    walls: list[dict[str, Any]] = []
    for index, (a, b) in enumerate(wall_points):
        source = vector.walls[index]
        wall_id = _new_id("wall")

        thickness = source.thickness_px * anchor.mm_per_pixel
        if thickness <= 0:
            thickness = FALLBACK_THICKNESS_MM
            flags.append(Flag(target=wall_id, reason="thickness-guessed"))

        walls.append(
            {
                "id": wall_id,
                "a": frame.to_mm(*a),
                "b": frame.to_mm(*b),
                "thickness": round(thickness, 1),
                "confidence": source.confidence,
            }
        )

        # 사양이 정한 것 — 0.6 미만은 하나도 빠짐없이 검수로 올린다
        if source.confidence < LOW_CONFIDENCE:
            flags.append(Flag(target=wall_id, reason="low-confidence-wall"))

    # ── 4. 개구부 ──
    openings: list[dict[str, Any]] = []
    for item in vector.openings:
        center = prepared.to_source_pixels(*item.center)
        found = _nearest_wall(center, wall_points)
        if found is None:
            continue

        index, along_px, gap_px = found
        if gap_px > OPENING_SNAP_PX:
            # 어느 벽에도 못 붙는 개구부는 버린다. 억지로 붙이면 없는 자리에 구멍이 난다.
            flags.append(Flag(target="opening", reason="opening-unattached"))
            continue

        opening_id = _new_id("op")
        width_mm = item.width_px * anchor.mm_per_pixel
        openings.append(
            {
                "id": opening_id,
                "wallId": walls[index]["id"],
                "kind": item.kind,
                "offset": round(along_px * anchor.mm_per_pixel - width_mm / 2, 1),
                "width": round(width_mm, 1),
                "confidence": item.confidence,
            }
        )
        if item.confidence < LOW_CONFIDENCE:
            flags.append(Flag(target=opening_id, reason="low-confidence-opening"))

    # ── 5. 방 ──
    rooms: list[dict[str, Any]] = []
    room_rings: list[list[tuple[float, float]]] = []

    for item in vector.rooms:
        ring_px = [prepared.to_source_pixels(x, y) for x, y in item.polygon]
        ring_mm = [frame.to_mm(x, y) for x, y in ring_px]
        room_rings.append(ring_px)

        room_id = _new_id("room")
        rooms.append(
            {
                "id": room_id,
                "polygon": ring_mm,
                "nameConfidence": 0.0,
                "areaMm2": round(_polygon_area(ring_mm), 1),
            }
        )
        if item.confidence < LOW_CONFIDENCE:
            flags.append(Flag(target=room_id, reason="low-confidence-room"))

    # ── 6. 이름 붙이기 ──
    annotations: list[dict[str, Any]] = [
        {
            "text": item.text,
            "position": frame.to_mm(*item.center),
            "kind": "dimension" if parse_dimension(item.text) is not None else "label",
        }
        for item in texts
    ]

    if labeler:
        _apply_labels(prepared, rooms, room_rings, texts, flags, annotations, frame)
    else:
        for room in rooms:
            flags.append(Flag(target=room["id"], reason="no-room-name"))

    # ── 7. 설비는 글자 자리에만 놓는다 ──
    fixtures: list[dict[str, Any]] = []
    for seed in seeds_from_texts(texts):
        corner = frame.to_mm(seed.center[0], seed.center[1])
        fixture_id = _new_id("fx")
        fixtures.append(
            {
                "id": fixture_id,
                "kind": seed.kind,
                "label": seed.label,
                # bbox 의 (x, y) 는 좌하단이다 — 글자 자리를 가운데로 본다
                "bbox": [
                    round(corner[0] - seed.width_mm / 2, 1),
                    round(corner[1] - seed.depth_mm / 2, 1),
                    seed.width_mm,
                    seed.depth_mm,
                ],
                "rotation": 0,
                "source": "ocr-label",
                "confidence": seed.confidence,
            }
        )
        # 도면에서 잰 크기가 아니라 표준 규격이다. 사용자가 봐야 한다.
        flags.append(Flag(target=fixture_id, reason="fixture-placeholder-size"))

    width_mm = round((max(xs) - min(xs)) * anchor.mm_per_pixel, 1) if xs else 0.0
    height_mm = round((max(ys) - min(ys)) * anchor.mm_per_pixel, 1) if ys else 0.0

    return {
        "id": _new_id("doc"),
        "sourceType": "raster",
        "scale": {
            "mmPerUnit": anchor.mm_per_pixel,
            "confidence": anchor.confidence,
            "source": "dimension-ocr",
        },
        "bounds": {"w": width_mm, "h": height_mm},
        "walls": walls,
        "openings": openings,
        "rooms": rooms,
        "fixtures": fixtures,
        "annotations": annotations,
        # 검수 화면이 원본 그림을 겹쳐 놓을 수 있게 맞물림을 남긴다.
        # 배율을 정한 곳이 여기뿐이라, 여기서 안 남기면 아무도 알 수 없다.
        "underlay": {
            "mmPerPixel": anchor.mm_per_pixel,
            "originPx": [frame.min_x, frame.max_y],
        },
        # 자동 결과는 절대 확정하지 않는다.
        "review": {
            "status": "auto",
            "flags": [{"target": flag.target, "reason": flag.reason} for flag in flags],
        },
    }


def _crop_png(image: np.ndarray, ring_px: list[tuple[float, float]], crop: CropRect) -> bytes | None:
    """방 폴리곤 자리를 원본에서 잘라 낸다 (LLM 에 넣을 그림).

    ring_px 는 원본 이미지 좌표이고 image 는 크롭본이므로, 크롭 원점을 빼서 맞춘다.
    """
    if not ring_px:
        return None

    xs = [x - crop.x for x, _ in ring_px]
    ys = [y - crop.y for _, y in ring_px]

    height, width = image.shape[:2]
    x1 = max(0, int(min(xs)))
    y1 = max(0, int(min(ys)))
    x2 = min(width, int(math.ceil(max(xs))))
    y2 = min(height, int(math.ceil(max(ys))))

    if x2 - x1 < 8 or y2 - y1 < 8:
        return None

    return encode_png(image[y1:y2, x1:x2])


def _apply_labels(
    prepared: Prepared,
    rooms: list[dict[str, Any]],
    room_rings: list[list[tuple[float, float]]],
    texts: list[OcrText],
    flags: list[Flag],
    annotations: list[dict[str, Any]],
    frame: Frame,
) -> None:
    """방마다 이름을 붙인다. 기하는 건드리지 않는다."""
    for index, room in enumerate(rooms):
        ring = room_rings[index]
        # 치수 숫자는 이름이 아니다 — 빼고 넘긴다
        inside = [
            item.text
            for item in texts
            if _point_in_ring(item.center, ring) and parse_dimension(item.text) is None
        ]

        image = _crop_png(prepared.cropped, ring, prepared.crop)
        if image is None:
            flags.append(Flag(target=room["id"], reason="no-room-name"))
            continue

        label: RoomLabel = label_room(image, inside)
        if label.name:
            room["name"] = label.name
            room["nameConfidence"] = label.confidence
        if not label.name or label.confidence < LOW_CONFIDENCE:
            flags.append(Flag(target=room["id"], reason="no-room-name"))

        # 홀이면 테이블 개수만 세어 둔다. **자리는 정하지 않는다** — 배치는 편집기 몫이다.
        if label.kind == "hall":
            count: HallCount = count_hall_tables(image)
            total = count.two_seat + count.four_seat + count.bench
            if total > 0:
                center_x = sum(x for x, _ in ring) / len(ring)
                center_y = sum(y for _, y in ring) / len(ring)
                annotations.append(
                    {
                        "text": (
                            f"테이블 대략 {total}개 (2인 {count.two_seat} · "
                            f"4인 {count.four_seat} · 벤치 {count.bench})"
                        ),
                        "position": frame.to_mm(center_x, center_y),
                        "kind": "other",
                    }
                )
                flags.append(Flag(target=room["id"], reason="tables-not-placed"))


def parse_raster(
    data: bytes,
    crop: CropRect | None = None,
    *,
    ocr: OcrEngine | None = None,
    labeler: bool = True,
) -> dict[str, Any]:
    """업로드한 도면 그림 → FloorPlanDoc.

    crop 은 UI 가 사용자에게 받아 넘긴 도면 영역이다. 없어도 돌아가지만 정확도가 크게
    떨어진다 — 표제란과 범례의 선을 벽으로 읽기 때문이다.
    """
    prepared = prepare(data, crop)

    # 키우기 **전** 그림에서 잰다. 키운 뒤에 재면 커 보이지만 정보는 그대로다.
    glyph_px = glyph_height(prepared.cropped)

    vector = vectorize(prepared.binary)

    # OCR 은 언제나 **원본**을 읽는다. 업스케일한 그림은 글자를 지어낸다.
    engine = ocr if ocr is not None else default_ocr()
    texts = engine.read(data) if engine is not None else []

    return build_doc(prepared, vector, texts, labeler=labeler, glyph_px=glyph_px)
