"""DXF 를 읽어 FloorPlanDoc 을 만든다.

── 이 파일의 유일한 약속 ──

**좌표는 도면에 적힌 것을 그대로 옮긴다.** 짐작하지 않고, 보기 좋게 고치지 않고,
없는 것을 만들지 않는다. 면적은 폴리곤 면적으로만 낸다.

── 좌표계 ──

FloorPlanDoc 은 mm, 오른손(x 오른쪽·y 위쪽), 원점은 도면 외곽 좌하단이다.
DXF 도 y 가 위로 커지므로 뒤집을 일은 없고, 원점만 외곽 좌하단으로 옮긴다.
"""

from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Iterable

import io

import ezdxf
import ezdxf.recover
from ezdxf.document import Drawing
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

from .config import Patterns, load_patterns

#: $INSUNITS 코드 → 1단위가 몇 mm 인가.
#: DXF 규격이 정한 표다. 여기 없는 값(천문단위 등)은 도면에 쓰이지 않는다.
_UNIT_MM: dict[int, float] = {
    1: 25.4,        # 인치
    2: 304.8,       # 피트
    4: 1.0,         # 밀리미터
    5: 10.0,        # 센티미터
    6: 1000.0,      # 미터
    8: 0.0254,      # 마이크로인치
    9: 0.0254 * 1000,  # 밀리인치
    10: 914.4,      # 야드
    13: 1e-6,       # 마이크로미터
    14: 0.1,        # 데시미터
}

#: 이보다 짧은 선은 벽으로 보지 않는다 (mm). 해치 조각·모서리 마감이 여기 걸린다.
MIN_WALL_MM = 200.0

#: 두 선이 나란하다고 보는 각도 (도)
PARALLEL_DEG = 4.0

#: 폴리곤이 실이라 하기에 너무 작은 값 (mm²) — 0.5㎡
MIN_ROOM_MM2 = 500_000.0

#: 블록 이름이 의미 없는가. 오토캐드가 익명 블록에 붙이는 이름들이다.
_MEANINGLESS = re.compile(r"^(\*[A-Z]\d+|A\$C[0-9A-F]+|_?ANON.*|BLOCK\d*|\d+)$", re.IGNORECASE)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@dataclass
class Flag:
    target: str
    reason: str


@dataclass
class Segment:
    """벽 후보 선분 하나 (도면 단위)."""

    a: tuple[float, float]
    b: tuple[float, float]
    layer: str

    @property
    def length(self) -> float:
        return math.dist(self.a, self.b)

    @property
    def angle(self) -> float:
        """0~180도. 방향은 무시한다 — 벽에 앞뒤가 없다."""
        deg = math.degrees(math.atan2(self.b[1] - self.a[1], self.b[0] - self.a[0]))
        return deg % 180.0


# ───────────────────────── 단위 ─────────────────────────


def read_units(doc: Drawing) -> tuple[float, float, str]:
    """(1단위가 몇 mm, 신뢰도, 출처).

    $INSUNITS 가 0이거나 없으면 도면에 단위가 안 적혀 있다는 뜻이다. 국내 건축 도면은
    거의 전부 mm 라 mm 로 가정하되 **신뢰도를 낮춰** 검수 화면이 먼저 묻게 한다 —
    여기가 틀리면 3m 짜리 방이 3m 가 아니게 되고, 그 사실을 아무도 눈치채지 못한다.
    """
    try:
        code = int(doc.header.get("$INSUNITS", 0) or 0)
    except (TypeError, ValueError):
        code = 0

    if code in _UNIT_MM:
        return _UNIT_MM[code], 1.0, "dxf-units"
    return 1.0, 0.5, "dxf-units"


# ───────────────────────── 벽 ─────────────────────────


def _explode_polyline(entity: Any) -> Iterable[tuple[tuple[float, float], tuple[float, float]]]:
    points = [(float(p[0]), float(p[1])) for p in entity.get_points("xy")]
    closed = bool(getattr(entity, "closed", False))
    count = len(points)

    for index in range(count - (0 if closed else 1)):
        yield points[index], points[(index + 1) % count]


def collect_wall_segments(doc: Drawing, patterns: Patterns, scale: float) -> list[Segment]:
    """벽 레이어의 LINE·LWPOLYLINE 을 선분으로 편다."""
    out: list[Segment] = []

    for entity in doc.modelspace():
        layer = str(entity.dxf.layer)
        if not patterns.is_wall_layer(layer):
            continue

        kind = entity.dxftype()
        if kind == "LINE":
            pairs = [
                ((float(entity.dxf.start.x), float(entity.dxf.start.y)),
                 (float(entity.dxf.end.x), float(entity.dxf.end.y)))
            ]
        elif kind in ("LWPOLYLINE", "POLYLINE"):
            pairs = list(_explode_polyline(entity))
        else:
            continue

        for a, b in pairs:
            segment = Segment(a=a, b=b, layer=layer)
            if segment.length * scale >= MIN_WALL_MM:
                out.append(segment)

    return out


def _perpendicular_gap(one: Segment, two: Segment) -> float | None:
    """나란한 두 선분 사이의 수직 거리. 나란하지 않으면 None."""
    diff = abs(one.angle - two.angle)
    diff = min(diff, 180.0 - diff)
    if diff > PARALLEL_DEG:
        return None

    dx = one.b[0] - one.a[0]
    dy = one.b[1] - one.a[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return None

    # two 의 중점을 one 의 직선에 내려 찍는다
    mid = ((two.a[0] + two.b[0]) / 2, (two.a[1] + two.b[1]) / 2)
    return abs((mid[0] - one.a[0]) * dy - (mid[1] - one.a[1]) * dx) / length


def _overlap_ratio(one: Segment, two: Segment) -> float:
    """one 의 방향으로 봤을 때 두 선분이 겹치는 비율."""
    dx = one.b[0] - one.a[0]
    dy = one.b[1] - one.a[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return 0.0

    def along(point: tuple[float, float]) -> float:
        return ((point[0] - one.a[0]) * dx + (point[1] - one.a[1]) * dy) / length

    a0, a1 = 0.0, length
    b0, b1 = sorted((along(two.a), along(two.b)))
    overlap = max(0.0, min(a1, b1) - max(a0, b0))
    return overlap / length


def merge_parallel_walls(
    segments: list[Segment], patterns: Patterns, scale: float
) -> tuple[list[dict[str, Any]], list[Flag]]:
    """평행선 쌍을 두께 있는 벽 하나로 병합한다.

    캐드 도면의 벽은 선 두 줄로 그린다. 그 둘을 그대로 두면 벽이 두 겹이 되고 방을
    잡을 수도 없다. 간격이 벽 두께 범위(설정 파일)에 들면 한 쌍으로 보고 **가운데
    선**을 벽 중심선으로 삼는다.

    짝을 못 찾은 선은 버리지 않는다 — 한 줄로 그린 칸막이일 수도 있다. 그때는
    두께를 알 수 없으므로 기본값을 쓰고 신뢰도를 낮춘다.
    """
    walls: list[dict[str, Any]] = []
    flags: list[Flag] = []
    used: set[int] = set()

    order = sorted(range(len(segments)), key=lambda i: -segments[i].length)

    for i in order:
        if i in used:
            continue

        base = segments[i]
        partner: int | None = None
        partner_gap = 0.0

        for j in order:
            if j == i or j in used:
                continue

            gap = _perpendicular_gap(base, segments[j])
            if gap is None:
                continue

            gap_mm = gap * scale
            if not (patterns.thickness_min <= gap_mm <= patterns.thickness_max):
                continue
            if _overlap_ratio(base, segments[j]) < 0.5:
                continue

            partner = j
            partner_gap = gap_mm
            break

        if partner is None:
            #
            # ── 문틀 마구리는 벽이 아니다 ──
            #
            # 실제 도면은 문·창 자리에서 벽선을 끊고, 그 끝을 마구리 선으로 막는다.
            # 그 선은 길이가 딱 벽 두께만큼이라 짝이 없는 벽처럼 보인다. 그대로 두면
            # 문마다 200mm 짜리 벽 토막이 생겨 3D 에 혹처럼 붙고, 도면 외곽도 벽
            # 두께의 절반만큼 커진다.
            #
            # 짝 없는 선은 벽 두께보다 확실히 길 때만 칸막이로 본다.
            if base.length * scale <= patterns.thickness_max * 1.5:
                used.add(i)
                continue

            # 한 줄짜리 벽. 두께를 모르므로 얇은 칸막이로 보고 신뢰도를 낮춘다.
            walls.append(
                {
                    "a": base.a,
                    "b": base.b,
                    "thickness": patterns.thickness_min,
                    "confidence": 0.6,
                    "layer": base.layer,
                }
            )
            used.add(i)
            continue

        mate = segments[partner]
        used.update({i, partner})

        # 가운데 선 — 두 선분의 끝점을 짝지어 평균낸다
        if math.dist(base.a, mate.a) <= math.dist(base.a, mate.b):
            near, far = mate.a, mate.b
        else:
            near, far = mate.b, mate.a

        walls.append(
            {
                "a": ((base.a[0] + near[0]) / 2, (base.a[1] + near[1]) / 2),
                "b": ((base.b[0] + far[0]) / 2, (base.b[1] + far[1]) / 2),
                "thickness": partner_gap,
                "confidence": 1.0,
                "layer": base.layer,
            }
        )

    if not walls:
        flags.append(Flag(target="walls", reason="no-wall-layer"))

    return walls, flags


# ───────────────────────── 문·창 ─────────────────────────


def _nearest_wall(
    walls: list[dict[str, Any]], point: tuple[float, float]
) -> tuple[int, float, float] | None:
    """(벽 번호, 벽 시작점에서의 거리, 벽까지의 수직 거리)."""
    best: tuple[int, float, float] | None = None

    for index, wall in enumerate(walls):
        ax, ay = wall["a"]
        bx, by = wall["b"]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue

        t = ((point[0] - ax) * dx + (point[1] - ay) * dy) / (length * length)
        t = max(0.0, min(1.0, t))
        nx, ny = ax + dx * t, ay + dy * t
        distance = math.dist(point, (nx, ny))

        if best is None or distance < best[2]:
            best = (index, t * length, distance)

    return best


def collect_openings(
    doc: Drawing, patterns: Patterns, walls: list[dict[str, Any]], scale: float
) -> tuple[list[dict[str, Any]], list[Any], list[Flag]]:
    """문·창 INSERT 를 찾아 가장 가까운 벽에 매단다.

    돌려주는 것은 (개구부, 설비로 넘길 INSERT, 지적)이다. 문·창이 아닌 INSERT 는
    여기서 가려 두었다가 설비로 보낸다 — 두 번 훑을 이유가 없다.
    """
    openings: list[dict[str, Any]] = []
    others: list[Any] = []
    flags: list[Flag] = []

    for entity in doc.modelspace():
        if entity.dxftype() != "INSERT":
            continue

        name = str(entity.dxf.name)
        kind = patterns.opening_kind(name)
        if kind is None:
            others.append(entity)
            continue

        point = (float(entity.dxf.insert.x), float(entity.dxf.insert.y))
        hit = _nearest_wall(walls, point)

        if hit is None or hit[2] * scale > 1500.0:
            flags.append(Flag(target=name, reason="opening-without-wall"))
            continue

        index, along, _ = hit

        # 폭은 블록의 실제 크기에서 온다. 못 재면 표준 폭으로 두고 신뢰도를 낮춘다.
        width_mm, sure = _block_width(entity, scale)

        openings.append(
            {
                "wall_index": index,
                "kind": kind,
                "offset": max(0.0, along * scale - width_mm / 2),
                "width": width_mm,
                "confidence": 0.9 if sure else 0.6,
            }
        )

    return openings, others, flags


def _block_width(entity: Any, scale: float) -> tuple[float, bool]:
    """블록이 차지하는 폭 (mm) 과, 실제로 쟀는지 여부."""
    try:
        box = entity.bounding_box()
        if box is not None and box.has_data:
            size = box.size
            width = max(float(size.x), float(size.y)) * scale
            if width > 100.0:
                return width, True
    except Exception:  # noqa: BLE001 — ezdxf 가 블록마다 다른 예외를 던진다
        pass

    return 900.0, False


def collect_arc_doors(
    doc: Drawing, patterns: Patterns, walls: list[dict[str, Any]], scale: float
) -> list[dict[str, Any]]:
    """블록 없이 호(ARC)로만 그린 문.

    오래된 도면이나 손으로 그린 것은 문을 블록으로 넣지 않고 호와 선으로 직접 그린다.
    호의 반지름이 문 폭이고, 중심이 경첩이다 — 그 자리가 벽 위에 있으면 문으로 본다.
    """
    found: list[dict[str, Any]] = []

    for entity in doc.modelspace():
        if entity.dxftype() != "ARC":
            continue

        radius_mm = float(entity.dxf.radius) * scale
        if not (600.0 <= radius_mm <= 1500.0):
            continue

        # 사분원에 가까워야 문이다. 반원·완전한 원은 다른 기호다.
        sweep = (float(entity.dxf.end_angle) - float(entity.dxf.start_angle)) % 360.0
        if not (60.0 <= sweep <= 120.0):
            continue

        center = (float(entity.dxf.center.x), float(entity.dxf.center.y))
        hit = _nearest_wall(walls, center)
        if hit is None or hit[2] * scale > 300.0:
            continue

        index, along, _ = hit
        found.append(
            {
                "wall_index": index,
                "kind": "door",
                "offset": max(0.0, along * scale),
                "width": radius_mm,
                # 블록으로 확정된 문보다 낮게 둔다 — 호 하나로 짐작한 것이다
                "confidence": 0.7,
            }
        )

    return found


# ───────────────────────── 방 ─────────────────────────


#: 문·창이 뚫려 있어도 방 경계로는 이어 보는 최대 폭 (mm).
#:
#: 국내 도면에서 가장 넓은 개구부가 거실 3연동 중문·전면 창호로 2,400 안팎이다.
#: 이보다 넓게 잡으면 정말로 트인 공간까지 벽으로 막아 버린다.
OPENING_BRIDGE_MM = 2500.0


def _bridge_openings(
    segments: list[tuple[tuple[float, float], tuple[float, float]]], limit: float
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """끊긴 벽을 방 경계로만 이어 준다.

    ── 왜 필요한가 ──

    실제 캐드 도면은 **문·창 자리에서 벽선을 끊는다.** 문틀이 들어갈 자리를 비워 두기
    때문이다. 그런데 방을 찾는 일은 고리를 따라 도는 일이라, 900mm 짜리 문 구멍 하나면
    그 방은 영영 닫히지 않는다. 실제로 84㎡ 아파트 도면 한 장에서 방이 **0개** 나왔다.

    ── 언제만 잇는가 ──

    두 토막이 **같은 직선 위에** 있고, 마주 보는 끝 사이가 개구부 폭만큼일 때만 잇는다.
    한 벽에 구멍이 난 것이지 서로 다른 벽이 아니라는 뜻이다. 나란하기만 하고 선이
    어긋나 있으면(다른 벽) 잇지 않는다.

    이어 붙인 선은 **방을 닫는 데만 쓰고 벽으로 내보내지 않는다.** 도면에 없는 벽을
    만들면 3D 에 없어야 할 칸막이가 선다.
    """
    bridges: list[tuple[tuple[float, float], tuple[float, float]]] = []

    for i in range(len(segments)):
        a1, a2 = segments[i]
        ax, ay = a2[0] - a1[0], a2[1] - a1[1]
        a_len = math.hypot(ax, ay)
        if a_len < 1e-9:
            continue

        for j in range(i + 1, len(segments)):
            b1, b2 = segments[j]
            bx, by = b2[0] - b1[0], b2[1] - b1[1]
            b_len = math.hypot(bx, by)
            if b_len < 1e-9:
                continue

            # 같은 방향인가 (약 1도 안쪽)
            if abs(ax * by - ay * bx) / (a_len * b_len) > 0.02:
                continue

            # 같은 직선 위인가 — a 의 선에서 b 의 끝점까지 수직으로 얼마나 떨어졌나
            offset = abs(ax * (b1[1] - a1[1]) - ay * (b1[0] - a1[0])) / a_len
            if offset > limit * 0.02:
                continue

            # 마주 보는 끝 사이가 개구부 폭인가
            distance, near_a, near_b = min(
                ((math.dist(p, q), p, q) for p in (a1, a2) for q in (b1, b2)),
                key=lambda item: item[0],
            )
            if 1e-9 < distance <= limit:
                bridges.append((near_a, near_b))

    return bridges


def build_rooms(
    walls: list[dict[str, Any]], patterns: Patterns, scale: float
) -> tuple[list[Polygon], list[Flag]]:
    """벽 중심선으로 방 폴리곤을 만든다.

    끝점이 snap.gap 안에서 어긋난 벽은 붙여 닫는다 — 캐드에서 사람이 그린 벽은 모서리가
    몇 mm 씩 어긋나 있는 일이 흔하고, 그대로 두면 방이 하나도 안 닫힌다.

    문·창 자리에서 끊긴 벽도 방 경계로는 이어 본다(_bridge_openings). 그러지 않으면
    실제 도면에서 방이 하나도 나오지 않는다.

    그래도 안 닫히면 **벽만 돌려주고 지적을 남긴다.** 없는 방을 지어내지 않는다.
    """
    if not walls:
        return [], [Flag(target="walls", reason="no-walls")]

    gap = patterns.snap_gap / scale

    # 가까운 끝점을 한 자리로 모은다
    anchors: list[tuple[float, float]] = []

    def snap(point: tuple[float, float]) -> tuple[float, float]:
        for anchor in anchors:
            if math.dist(anchor, point) <= gap:
                return anchor
        anchors.append(point)
        return point

    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for wall in walls:
        a = snap(tuple(wall["a"]))
        b = snap(tuple(wall["b"]))
        if math.dist(a, b) > 1e-9:
            segments.append((a, b))

    if not segments:
        return [], [Flag(target="walls", reason="no-walls")]

    lines = [LineString([a, b]) for a, b in segments]
    lines.extend(
        LineString([a, b])
        for a, b in _bridge_openings(segments, OPENING_BRIDGE_MM / scale)
    )

    merged = unary_union(lines)
    polygons = [p for p in polygonize(merged) if p.is_valid]

    kept = [p for p in polygons if p.area * scale * scale >= MIN_ROOM_MM2]

    if not kept:
        return [], [Flag(target="rooms", reason="unclosed-walls")]

    return kept, []


# ───────────────────────── 글자 ─────────────────────────


def collect_annotations(doc: Drawing, scale: float) -> list[dict[str, Any]]:
    """TEXT·MTEXT·DIMENSION 을 전부 옮긴다."""
    out: list[dict[str, Any]] = []

    for entity in doc.modelspace():
        kind = entity.dxftype()

        if kind == "TEXT":
            text = str(entity.dxf.text)
            position = (float(entity.dxf.insert.x), float(entity.dxf.insert.y))
            label = "label"
        elif kind == "MTEXT":
            text = str(entity.plain_text())
            position = (float(entity.dxf.insert.x), float(entity.dxf.insert.y))
            label = "label"
        elif kind == "DIMENSION":
            text = str(getattr(entity.dxf, "text", "") or "")
            point = getattr(entity.dxf, "defpoint", None)
            position = (float(point.x), float(point.y)) if point is not None else (0.0, 0.0)
            label = "dimension"
        else:
            continue

        cleaned = text.strip()
        if not cleaned and label != "dimension":
            continue

        out.append({"text": cleaned, "position": position, "kind": label})

    return out


#: 실명이 아니라 치수로 보이는 글자. "3,600", "2400", "W=900" 같은 것들.
_LOOKS_NUMERIC = re.compile(r"^[\d\s,.\-x×X*/=Ø∅@Wwhd()mM]+$")


def is_dimension_text(text: str) -> bool:
    """숫자와 기호뿐인 글자는 실명이 아니다."""
    stripped = text.strip()
    if not stripped:
        return True
    return bool(_LOOKS_NUMERIC.match(stripped))


def name_rooms(
    polygons: list[Polygon], annotations: list[dict[str, Any]]
) -> tuple[list[str | None], list[Flag]]:
    """방 폴리곤 안에 든 글자로 이름을 붙인다.

    후보가 **하나면** 그대로 쓴다. 여럿이거나 없으면 이름을 비우고 지적을 남긴다 —
    페이즈 2의 LLM 라벨러가 그때 고른다. 여기서 아무거나 고르면 그 방은 이름이 틀린
    채로 확정돼 버리고, 틀렸다는 사실조차 남지 않는다.
    """
    names: list[str | None] = []
    flags: list[Flag] = []

    for index, polygon in enumerate(polygons):
        candidates = [
            item["text"]
            for item in annotations
            if item["kind"] != "dimension"
            and not is_dimension_text(item["text"])
            and polygon.contains(Point(item["position"]))
        ]

        if len(candidates) == 1:
            names.append(candidates[0])
            continue

        names.append(None)
        flags.append(
            Flag(
                target=f"room[{index}]",
                reason="ambiguous-room-name" if candidates else "no-room-name",
            )
        )

    return names, flags


# ───────────────────────── 설비 ─────────────────────────


def normalize_block_name(name: str) -> str:
    """블록 이름을 종류로 쓸 만한 꼴로 다듬는다."""
    cleaned = re.sub(r"[_\-\s]+", "-", name.strip()).strip("-")
    return cleaned.lower()


def _insert_extents(entity: Any) -> tuple[float, float, float, float] | None:
    """블록이 실제로 차지하는 자리 (x, y, 폭, 깊이).

    ── 한 번 크게 틀렸던 곳 ──

    처음에는 `entity.bounding_box()` 를 불렀는데 ezdxf 의 INSERT 에는 그런 메서드가
    없다. AttributeError 가 except 에 삼켜져 **모든 설비가 기본값 300×300 으로**
    떨어졌다. 침대도 소파도 냉장고도 전부 30cm 짜리 정사각형이 됐는데, 예외를 잡아
    조용히 기본값으로 가는 코드라 아무 데도 티가 나지 않았다.

    ── 왜 두 번 재나 ──

    폭과 깊이는 **블록 정의**에서 잰다. 회전한 블록의 외접 사각형을 그대로 쓰면
    45도 돌아간 침대가 2.5m 짜리 정사각형이 되는데, 우리는 회전을 따로 담으므로
    돌리기 전 크기가 맞다.

    자리는 **배치된 결과**에서 잰다. 회전해도 외접 사각형의 한가운데는 실제 한가운데와
    같으므로, 거기서 폭·깊이의 절반씩 물러난 자리가 좌하단이다.
    """
    import ezdxf.bbox

    try:
        placed = ezdxf.bbox.extents([entity])
        if not placed.has_data:
            return None

        block = entity.doc.blocks.get(str(entity.dxf.name)) if entity.doc else None
        local = ezdxf.bbox.extents(block) if block is not None else None

        if local is not None and local.has_data:
            w = float(local.size.x) * abs(float(entity.dxf.xscale or 1))
            h = float(local.size.y) * abs(float(entity.dxf.yscale or 1))
        else:
            w = float(placed.size.x)
            h = float(placed.size.y)

        if w <= 0 or h <= 0:
            return None

        cx = (float(placed.extmin.x) + float(placed.extmax.x)) / 2
        cy = (float(placed.extmin.y) + float(placed.extmax.y)) / 2
        return cx - w / 2, cy - h / 2, w, h
    except Exception:  # noqa: BLE001 — 못 재면 부르는 쪽이 기본값으로 간다
        return None


def collect_fixtures(
    inserts: list[Any], scale: float
) -> tuple[list[dict[str, Any]], list[Flag]]:
    """문·창이 아닌 INSERT 를 설비로 옮긴다."""
    out: list[dict[str, Any]] = []
    flags: list[Flag] = []

    for entity in inserts:
        name = str(entity.dxf.name)
        meaningless = bool(_MEANINGLESS.match(name))

        measured = _insert_extents(entity)

        if measured is not None:
            x, y, w, h = measured
        else:
            # 크기를 못 재면 삽입점에 최소 크기로 둔다 — 자리는 맞고 크기만 모른다
            x = float(entity.dxf.insert.x)
            y = float(entity.dxf.insert.y)
            w = h = 300.0 / scale

        fixture = {
            "id": _new_id("fx"),
            "kind": normalize_block_name(name),
            "bbox": (x, y, w, h),
            "rotation": float(getattr(entity.dxf, "rotation", 0.0) or 0.0),
            "source": "dxf-block",
            "confidence": 0.5 if meaningless else 0.9,
        }

        if not meaningless:
            fixture["label"] = name

        out.append(fixture)

        if meaningless:
            flags.append(Flag(target=fixture["id"], reason="meaningless-block-name"))

    return out, flags


# ───────────────────────── 조립 ─────────────────────────


def parse_dxf(data: bytes, *, source_type: str = "cad") -> dict[str, Any]:
    """DXF 바이트 → FloorPlanDoc (dict).

    돌려주는 dict 는 packages/plan-schema 의 FloorPlanDoc 과 같은 모양이다.
    """
    patterns = load_patterns()

    # 바이트에서 바로 읽는다.
    #
    # 처음에는 utf-8 로 풀어 텍스트 스트림으로 넘겼는데, errors="ignore" 가 인코딩이
    # 다른 바이트를 조용히 버리면서 그룹코드가 한 칸씩 밀렸다. 그러면 파일이 깨진 줄도
    # 모른 채 엉뚱한 헤더 값을 읽는다 — 단위가 mm 인 도면을 m 로 읽어 1000배가 됐다.
    #
    # recover.read 는 인코딩을 스스로 가리고, 실무에서 흔한 살짝 깨진 파일도 고쳐 읽는다.
    doc, auditor = ezdxf.recover.read(io.BytesIO(data))
    if auditor.has_errors:
        # 고쳐서 읽었다는 사실은 남긴다 — 결과가 이상할 때 짚을 자리다
        print(f"[dxf] 복구해서 읽었습니다: {len(auditor.errors)}건")

    scale, scale_confidence, scale_source = read_units(doc)
    flags: list[Flag] = []

    segments = collect_wall_segments(doc, patterns, scale)
    raw_walls, wall_flags = merge_parallel_walls(segments, patterns, scale)
    flags.extend(wall_flags)

    openings_raw, other_inserts, opening_flags = collect_openings(doc, patterns, raw_walls, scale)
    flags.extend(opening_flags)
    openings_raw.extend(collect_arc_doors(doc, patterns, raw_walls, scale))

    polygons, room_flags = build_rooms(raw_walls, patterns, scale)
    flags.extend(room_flags)

    annotations = collect_annotations(doc, scale)
    names, name_flags = name_rooms(polygons, annotations)
    flags.extend(name_flags)

    fixtures_raw, fixture_flags = collect_fixtures(other_inserts, scale)
    flags.extend(fixture_flags)

    # ── 원점을 도면 외곽 좌하단으로 옮긴다 ──
    xs: list[float] = []
    ys: list[float] = []
    for wall in raw_walls:
        xs.extend([wall["a"][0], wall["b"][0]])
        ys.extend([wall["a"][1], wall["b"][1]])
    for polygon in polygons:
        minx, miny, maxx, maxy = polygon.bounds
        xs.extend([minx, maxx])
        ys.extend([miny, maxy])

    origin_x = min(xs) if xs else 0.0
    origin_y = min(ys) if ys else 0.0

    def to_mm(point: Iterable[float]) -> list[float]:
        x, y = point
        return [round((x - origin_x) * scale, 1), round((y - origin_y) * scale, 1)]

    wall_ids = [_new_id("wall") for _ in raw_walls]

    walls = [
        {
            "id": wall_ids[index],
            "a": to_mm(wall["a"]),
            "b": to_mm(wall["b"]),
            "thickness": round(wall["thickness"], 1),
            "confidence": wall["confidence"],
        }
        for index, wall in enumerate(raw_walls)
    ]

    openings = [
        {
            "id": _new_id("op"),
            "wallId": wall_ids[item["wall_index"]],
            "kind": item["kind"],
            "offset": round(item["offset"], 1),
            "width": round(item["width"], 1),
            "confidence": item["confidence"],
        }
        for item in openings_raw
        if 0 <= item["wall_index"] < len(wall_ids)
    ]

    rooms = []
    for index, polygon in enumerate(polygons):
        ring = [to_mm(point) for point in polygon.exterior.coords[:-1]]
        room: dict[str, Any] = {
            "id": _new_id("room"),
            "polygon": ring,
            "nameConfidence": 0.0,
            # 면적은 폴리곤에서만 낸다. 짐작하지 않는다.
            "areaMm2": round(polygon.area * scale * scale, 1),
        }
        if names[index]:
            room["name"] = names[index]
            room["nameConfidence"] = 0.8
        rooms.append(room)

    fixtures = []
    for item in fixtures_raw:
        x, y, w, h = item["bbox"]
        moved = to_mm((x, y))
        fixture = {
            "id": item["id"],
            "kind": item["kind"],
            "bbox": [moved[0], moved[1], round(w * scale, 1), round(h * scale, 1)],
            "rotation": item["rotation"],
            "source": item["source"],
            "confidence": item["confidence"],
        }
        if "label" in item:
            fixture["label"] = item["label"]
        fixtures.append(fixture)

    width = round((max(xs) - min(xs)) * scale, 1) if xs else 0.0
    height = round((max(ys) - min(ys)) * scale, 1) if ys else 0.0

    return {
        "id": _new_id("doc"),
        "sourceType": source_type,
        "scale": {
            "mmPerUnit": scale,
            "confidence": scale_confidence,
            "source": scale_source,
        },
        "bounds": {"w": width, "h": height},
        "walls": walls,
        "openings": openings,
        "rooms": rooms,
        "fixtures": fixtures,
        "annotations": [
            {"text": item["text"], "position": to_mm(item["position"]), "kind": item["kind"]}
            for item in annotations
        ],
        # 자동 결과는 절대 확정하지 않는다.
        "review": {
            "status": "auto",
            "flags": [{"target": flag.target, "reason": flag.reason} for flag in flags],
        },
    }
