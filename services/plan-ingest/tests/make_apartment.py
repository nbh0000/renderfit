"""실제 CAD 도면처럼 그린 84㎡ 아파트 평면.

── 시험용 fixture 와 무엇이 다른가 ──

tests/fixtures 의 세 장은 파서가 읽기 좋게 그린 그림이다 — 벽이 중심선 한 줄이고,
문 자리에서도 벽이 이어져 있다. 실제 캐드 도면은 그렇지 않다.

  · 벽은 **이중선**이다. 두께만큼 떨어진 두 줄을 그리고, 그 사이를 벽으로 본다.
  · 문·창 자리에서는 **벽선이 끊긴다.** 문틀이 들어갈 자리를 비워 두기 때문이다.
  · 해치·치수선·중심선·실명 글자가 벽선과 같은 도면에 섞여 있다.
  · 가구와 위생기구는 블록으로 꽂혀 있다.

그래서 이 그림은 파서에게 훨씬 어려운 시험이다. 방이 닫히려면 끊긴 벽 너머로 고리를
이어야 하고, 해치와 치수선을 벽으로 읽지 않아야 한다.

── 정답 ──

전용 77.08㎡ · 외곽 9400 × 8200 (벽 중심선 기준)

    발코니  9.38㎡    거실  17.10㎡    주방   8.36㎡
    안방   14.04㎡    침실2 13.50㎡    욕실   7.20㎡    현관 7.50㎡
"""

from __future__ import annotations

import math
from pathlib import Path

import ezdxf
from ezdxf.enums import TextEntityAlignment

OUT = Path(__file__).parent / "fixtures" / "apartment84.dxf"

#: 벽 중심선 격자 (mm)
X = {"w": 100, "a": 4600, "b": 6800, "c": 7000, "e": 9500}
Y = {"s": 100, "bal": 1500, "mid": 5300, "n": 8300}

EXTERIOR = 200
INTERIOR = 100


def wall(msp, a, b, thickness, openings=()):
    """벽 하나를 이중선으로 그린다. openings 자리에서는 선을 끊는다.

    openings 는 (중심까지의 거리, 폭) 목록이다 — 벽 시작점에서 잰다.
    """
    (x1, y1), (x2, y2) = a, b
    length = math.hypot(x2 - x1, y2 - y1)
    ux, uy = (x2 - x1) / length, (y2 - y1) / length
    nx, ny = -uy, ux  # 법선

    # 끊어야 할 구간을 시작점 기준 거리로 모은다
    cuts = sorted((at - width / 2, at + width / 2) for at, width in openings)

    spans = []
    cursor = 0.0
    for start, end in cuts:
        if start > cursor:
            spans.append((cursor, start))
        cursor = max(cursor, end)
    if cursor < length:
        spans.append((cursor, length))

    for side in (-1, 1):
        ox, oy = nx * thickness / 2 * side, ny * thickness / 2 * side
        for start, end in spans:
            msp.add_lwpolyline(
                [
                    (x1 + ux * start + ox, y1 + uy * start + oy),
                    (x1 + ux * end + ox, y1 + uy * end + oy),
                ],
                dxfattribs={"layer": "A-WALL"},
            )

    # 문틀(끊긴 자리의 마구리)도 실제 도면에는 그어져 있다
    for start, end in cuts:
        for at in (start, end):
            msp.add_lwpolyline(
                [
                    (x1 + ux * at + nx * thickness / 2, y1 + uy * at + ny * thickness / 2),
                    (x1 + ux * at - nx * thickness / 2, y1 + uy * at - ny * thickness / 2),
                ],
                dxfattribs={"layer": "A-WALL"},
            )


def door_block(doc, name: str, width: float) -> None:
    """여닫이문 — 문짝 한 장과 열리는 궤적."""
    block = doc.blocks.new(name=name)
    block.add_lwpolyline([(0, 0), (0, width)], dxfattribs={"layer": "A-DOOR"})
    block.add_arc(center=(0, 0), radius=width, start_angle=0, end_angle=90,
                  dxfattribs={"layer": "A-DOOR"})


def window_block(doc, name: str, width: float, thickness: float) -> None:
    """창호 — 유리선 두 줄."""
    block = doc.blocks.new(name=name)
    for offset in (-thickness / 6, thickness / 6):
        block.add_lwpolyline([(0, offset), (width, offset)], dxfattribs={"layer": "A-WNDW"})


def box_block(doc, name: str, width: float, depth: float) -> None:
    """가구·위생기구 — 네모 하나면 충분하다. 우리는 블록 이름만 읽는다."""
    block = doc.blocks.new(name=name)
    block.add_lwpolyline(
        [(0, 0), (width, 0), (width, depth), (0, depth), (0, 0)],
        dxfattribs={"layer": "A-FURN"},
    )


def main() -> None:
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    msp = doc.modelspace()

    for name, color in [
        ("A-WALL", 7), ("A-WALL-PATT", 8), ("A-DOOR", 3), ("A-WNDW", 4),
        ("A-TEXT", 2), ("A-DIMS", 1), ("A-FURN", 5), ("A-GRID", 8),
    ]:
        doc.layers.add(name, color=color)

    # ── 벽 ──
    #
    # 외벽 200 · 내벽 100. 문·창 자리는 끊는다.

    # 남 외벽 — 발코니 창 두 짝
    wall(msp, (X["w"], Y["s"]), (X["e"], Y["s"]), EXTERIOR,
         openings=[(1500, 1800), (4000, 1800)])
    # 동 외벽 — 안방 창
    wall(msp, (X["e"], Y["s"]), (X["e"], Y["n"]), EXTERIOR, openings=[(2500, 1500)])
    # 북 외벽 — 현관문과 침실2 창
    wall(msp, (X["e"], Y["n"]), (X["w"], Y["n"]), EXTERIOR,
         openings=[(3700, 1000), (7500, 1500)])
    # 서 외벽
    wall(msp, (X["w"], Y["n"]), (X["w"], Y["s"]), EXTERIOR)

    # 발코니 ↔ 거실 (거실 쪽 큰 창호)
    wall(msp, (X["w"], Y["bal"]), (X["b"], Y["bal"]), INTERIOR, openings=[(2300, 2100)])
    # 안방 ↔ 거실·주방
    wall(msp, (X["b"], Y["s"]), (X["b"], Y["mid"]), INTERIOR, openings=[(3100, 900)])
    # 아래층 ↔ 위층
    wall(msp, (X["w"], Y["mid"]), (X["e"], Y["mid"]), INTERIOR,
         openings=[(1900, 900), (5400, 900)])
    # 거실 ↔ 주방
    wall(msp, (X["a"], Y["bal"]), (X["a"], Y["mid"]), INTERIOR, openings=[(1900, 1200)])
    # 침실2 ↔ 현관
    wall(msp, (X["a"], Y["mid"]), (X["a"], Y["n"]), INTERIOR)
    # 현관 ↔ 욕실
    wall(msp, (X["c"], Y["mid"]), (X["c"], Y["n"]), INTERIOR, openings=[(1300, 800)])

    # ── 문·창 ──
    door_block(doc, "DOOR_900", 900)
    door_block(doc, "DOOR_800", 800)
    door_block(doc, "DOOR_1000", 1000)
    window_block(doc, "WIN_1800", 1800, EXTERIOR)
    window_block(doc, "WIN_1500", 1500, EXTERIOR)
    window_block(doc, "WIN_2100", 2100, INTERIOR)

    inserts = [
        # 남 외벽 창 둘
        ("WIN_1800", (X["w"] + 600, Y["s"]), 0),
        ("WIN_1800", (X["w"] + 3100, Y["s"]), 0),
        # 동 외벽 — 안방 창
        ("WIN_1500", (X["e"], Y["s"] + 1750), 90),
        # 북 외벽 — 현관문, 침실2 창
        ("DOOR_1000", (X["e"] - 3200, Y["n"]), 180),
        ("WIN_1500", (X["e"] - 8250, Y["n"]), 180),
        # 발코니 ↔ 거실 창호
        ("WIN_2100", (X["w"] + 1250, Y["bal"]), 0),
        # 안방 문
        ("DOOR_900", (X["b"], Y["s"] + 2650), 90),
        # 침실2 문 · 주방 ↔ 현관 문
        ("DOOR_900", (X["w"] + 1450, Y["mid"]), 0),
        ("DOOR_900", (X["w"] + 4950, Y["mid"]), 0),
        # 욕실 문
        ("DOOR_800", (X["c"], Y["mid"] + 900), 90),
    ]
    for name, point, angle in inserts:
        layer = "A-WNDW" if name.startswith("WIN") else "A-DOOR"
        msp.add_blockref(name, point, dxfattribs={"layer": layer, "rotation": angle})

    # ── 가구·위생기구 ──
    for name, width, depth in [
        ("BED_Q", 1600, 2000), ("SOFA_3P", 2200, 900), ("TABLE_D4", 1200, 800),
        ("SINK_1800", 1800, 600), ("TOILET", 400, 700), ("BASIN", 550, 450),
        ("SHOE_CABI", 900, 350), ("REFRIGERATOR", 900, 700),
    ]:
        box_block(doc, name, width, depth)

    for name, point in [
        ("BED_Q", (X["b"] + 400, Y["s"] + 2600)),      # 안방
        ("BED_Q", (X["w"] + 400, Y["mid"] + 700)),     # 침실2
        ("SOFA_3P", (X["w"] + 900, Y["bal"] + 300)),   # 거실
        ("TABLE_D4", (X["a"] + 400, Y["bal"] + 1800)), # 주방
        ("SINK_1800", (X["a"] + 200, Y["mid"] - 700)), # 주방
        ("REFRIGERATOR", (X["a"] + 200, Y["bal"] + 300)),
        ("TOILET", (X["c"] + 300, Y["n"] - 900)),      # 욕실
        ("BASIN", (X["c"] + 1000, Y["n"] - 600)),
        ("SHOE_CABI", (X["a"] + 300, Y["n"] - 450)),   # 현관
    ]:
        msp.add_blockref(name, point, dxfattribs={"layer": "A-FURN"})

    # ── 실명 ──
    rooms = [
        ("발코니", (3400, 800)),
        ("거실", (2350, 3400)),
        ("주방", (5700, 3400)),
        ("안방", (8150, 2700)),
        ("침실2", (2350, 6800)),
        ("현관", (5800, 6800)),
        ("욕실", (8250, 6800)),
    ]
    for name, (x, y) in rooms:
        msp.add_text(
            name, height=250, dxfattribs={"layer": "A-TEXT"}
        ).set_placement((x, y), align=TextEntityAlignment.MIDDLE_CENTER)

    # ── 해치 (벽으로 읽으면 안 되는 것) ──
    hatch = msp.add_hatch(color=8, dxfattribs={"layer": "A-WALL-PATT"})
    hatch.paths.add_polyline_path(
        [(X["w"], Y["s"]), (X["b"], Y["s"]), (X["b"], Y["bal"]), (X["w"], Y["bal"])],
        is_closed=True,
    )
    hatch.set_pattern_fill("ANSI31", scale=40)

    # ── 중심선 (역시 벽이 아니다) ──
    for x in (X["a"], X["b"]):
        msp.add_lwpolyline(
            [(x, Y["s"] - 800), (x, Y["n"] + 800)],
            dxfattribs={"layer": "A-GRID", "linetype": "CENTER"},
        )

    # ── 치수 ──
    for start, end, y in [
        ((X["w"], Y["s"]), (X["a"], Y["s"]), -900),
        ((X["a"], Y["s"]), (X["b"], Y["s"]), -900),
        ((X["b"], Y["s"]), (X["e"], Y["s"]), -900),
        ((X["w"], Y["s"]), (X["e"], Y["s"]), -1800),
    ]:
        msp.add_linear_dim(
            base=(0, y), p1=start, p2=end, dxfattribs={"layer": "A-DIMS"}
        ).render()

    for start, end, x in [
        ((X["w"], Y["s"]), (X["w"], Y["bal"]), -900),
        ((X["w"], Y["bal"]), (X["w"], Y["mid"]), -900),
        ((X["w"], Y["mid"]), (X["w"], Y["n"]), -900),
        ((X["w"], Y["s"]), (X["w"], Y["n"]), -1800),
    ]:
        msp.add_linear_dim(
            base=(x, 0), p1=start, p2=end, angle=90, dxfattribs={"layer": "A-DIMS"}
        ).render()

    doc.saveas(OUT)
    print(f"만들었습니다: {OUT}")


if __name__ == "__main__":
    main()
