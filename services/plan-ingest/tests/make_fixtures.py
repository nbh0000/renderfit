"""테스트용 DXF 세 장을 만든다.

── 왜 만들어 쓰나 ──

실무 도면은 저작물이라 가져다 붙일 수 없고, "캐드에서 잰 값"을 기준으로 삼으려면
캐드가 있어야 한다. 대신 **정답을 알고 그린다.** 8000×6000 으로 그렸으면 정답이
8000×6000 이지, 재서 얻은 값이 아니다. 그래서 오차 기준(외곽 1%, 면적 3%)을
그대로 적용할 수 있고, 파서가 틀리면 어디서 틀렸는지 바로 드러난다.

다만 이것으로 검증되는 것은 **파서의 계산**이지 실무 도면의 온갖 변형이 아니다.
진짜 도면이 손에 들어오면 그때 여기 더한다.

실행: python tests/make_fixtures.py
"""

from __future__ import annotations

import math
from pathlib import Path

import ezdxf

OUT = Path(__file__).parent / "fixtures"


def _double_wall(msp, a, b, thickness: float, layer: str) -> None:
    """벽 한 장을 선 두 줄로 그린다 — 실제 캐드 도면이 그렇게 그린다."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1e-9:
        return

    # 중심선에서 두께의 절반만큼 양옆으로 민다
    ox, oy = -dy / length * thickness / 2, dx / length * thickness / 2

    for sign in (1, -1):
        msp.add_line(
            (a[0] + ox * sign, a[1] + oy * sign),
            (b[0] + ox * sign, b[1] + oy * sign),
            dxfattribs={"layer": layer},
        )


def _box(msp, x0, y0, x1, y1, thickness, layer) -> None:
    _double_wall(msp, (x0, y0), (x1, y0), thickness, layer)
    _double_wall(msp, (x1, y0), (x1, y1), thickness, layer)
    _double_wall(msp, (x1, y1), (x0, y1), thickness, layer)
    _double_wall(msp, (x0, y1), (x0, y0), thickness, layer)


def _door_block(doc, name: str = "DOOR-900") -> None:
    block = doc.blocks.new(name=name)
    block.add_line((0, 0), (900, 0))
    block.add_arc((0, 0), 900, 0, 90)


def _window_block(doc, name: str = "WINDOW-1500") -> None:
    block = doc.blocks.new(name=name)
    for offset in (-50, 0, 50):
        block.add_line((0, offset), (1500, offset))


def residential() -> Path:
    """주거 — 8000 × 6000, 방 둘 + 욕실 하나.

    정답:
      외곽 8000 × 6000
      거실  (0..4000) × (0..6000) = 24.0 ㎡
      침실  (4000..8000) × (2000..6000) = 16.0 ㎡
      욕실  (4000..8000) × (0..2000) = 8.0 ㎡
    """
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4  # mm
    msp = doc.modelspace()

    _door_block(doc)
    _window_block(doc)

    _box(msp, 0, 0, 8000, 6000, 200, "A-WALL")
    _double_wall(msp, (4000, 0), (4000, 6000), 100, "A-WALL")
    _double_wall(msp, (4000, 2000), (8000, 2000), 100, "A-WALL")

    msp.add_blockref("DOOR-900", (4000, 3000), dxfattribs={"layer": "A-DOOR"})
    msp.add_blockref("WINDOW-1500", (1200, 0), dxfattribs={"layer": "A-GLAZ"})

    for text, point in (("거실", (2000, 3000)), ("침실1", (6000, 4000)), ("욕실", (6000, 1000))):
        msp.add_text(text, height=250, dxfattribs={"layer": "A-IDEN"}).set_placement(point)

    # 치수 글자 — 실명 후보에서 걸러져야 한다
    msp.add_text("8,000", height=200, dxfattribs={"layer": "A-DIM"}).set_placement((4000, -600))

    msp.add_blockref("DOOR-900", (500, 500), dxfattribs={"layer": "A-FURN"})  # 자리만 채우는 참조

    path = OUT / "residential.dxf"
    doc.saveas(path)
    return path


def commercial() -> Path:
    """상업 — 24000 × 12000, 큰 홀 하나 + 사무실 셋.

    정답:
      외곽 24000 × 12000
      홀    (0..12000) × (0..12000) = 144.0 ㎡
      사무실1 (12000..24000) × (8000..12000) = 48.0 ㎡
      사무실2 (12000..24000) × (4000..8000)  = 48.0 ㎡
      사무실3 (12000..24000) × (0..4000)     = 48.0 ㎡
    """
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()

    _door_block(doc)
    _window_block(doc)

    _box(msp, 0, 0, 24000, 12000, 300, "A-WALL-EXTR")
    _double_wall(msp, (12000, 0), (12000, 12000), 200, "A-WALL-INTR")
    for y in (4000, 8000):
        _double_wall(msp, (12000, y), (24000, y), 100, "A-WALL-INTR")

    for y in (2000, 6000, 10000):
        msp.add_blockref("DOOR-900", (12000, y), dxfattribs={"layer": "A-DOOR"})
    for x in (3000, 8000):
        msp.add_blockref("WINDOW-1500", (x, 0), dxfattribs={"layer": "A-GLAZ"})

    names = (("홀", (6000, 6000)), ("사무실1", (18000, 10000)),
             ("사무실2", (18000, 6000)), ("사무실3", (18000, 2000)))
    for text, point in names:
        msp.add_text(text, height=400, dxfattribs={"layer": "A-IDEN"}).set_placement(point)

    # 설비 블록 — 이름이 뚜렷한 것과 그렇지 않은 것
    doc.blocks.new(name="DESK-1400").add_lwpolyline(
        [(0, 0), (1400, 0), (1400, 700), (0, 700)], close=True
    )
    for x in (14000, 17000, 20000):
        msp.add_blockref("DESK-1400", (x, 10000), dxfattribs={"layer": "I-FURN"})

    path = OUT / "commercial.dxf"
    doc.saveas(path)
    return path


def messy() -> Path:
    """레이어가 지저분한 도면 — 10000 × 8000.

    실무에서 보는 것들을 일부러 섞는다.
      · 벽 레이어 이름이 제각각 (WALL, 벽체, 0-WALL)
      · 벽이 아닌데 이름이 비슷한 레이어 (A-WALL-PATT 해치, WALL-DIM 치수)
      · 익명 블록 이름 (A$C0A1B2)
      · 모서리가 60mm 어긋난 벽 — 스냅으로 닫혀야 한다
      · 실명이 없는 방 하나

    정답:
      외곽 10000 × 8000
      사무실 (0..6000) × (0..8000) = 48.0 ㎡
      창고   (6000..10000) × (0..8000) = 32.0 ㎡  (이름표 없음)
    """
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()

    _door_block(doc)

    # 레이어 이름을 일부러 섞는다
    _double_wall(msp, (0, 0), (10000, 0), 200, "WALL")
    _double_wall(msp, (10000, 0), (10000, 8000), 200, "벽체")
    _double_wall(msp, (10000, 8000), (0, 8000), 200, "0-WALL")
    # 왼쪽 벽은 위쪽 끝이 60mm 모자라다 — 스냅으로 닫혀야 한다
    _double_wall(msp, (0, 0), (0, 7940), 200, "WALL")
    _double_wall(msp, (6000, 0), (6000, 8000), 100, "벽체")

    # 벽이 아닌데 이름이 비슷한 것들 — 걸리면 두께 병합이 어긋난다
    for offset in range(0, 6000, 400):
        msp.add_line((offset, 0), (offset + 300, 300), dxfattribs={"layer": "A-WALL-PATT"})
    msp.add_line((0, -800), (10000, -800), dxfattribs={"layer": "WALL-DIM"})
    msp.add_line((5000, -2000), (5000, 10000), dxfattribs={"layer": "CENTER"})

    msp.add_blockref("DOOR-900", (6000, 4000), dxfattribs={"layer": "A-DOOR"})

    msp.add_text("사무실", height=300, dxfattribs={"layer": "TEXT"}).set_placement((3000, 4000))
    # 오른쪽 방에는 치수 글자만 있다 — 실명 후보가 되면 안 된다
    msp.add_text("4,000", height=200, dxfattribs={"layer": "TEXT"}).set_placement((8000, 4000))

    doc.blocks.new(name="A$C0A1B2").add_circle((0, 0), 200)
    msp.add_blockref("A$C0A1B2", (8000, 6000), dxfattribs={"layer": "I-FURN"})

    path = OUT / "messy.dxf"
    doc.saveas(path)
    return path


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for build in (residential, commercial, messy):
        print("wrote", build())
