"""치수 앵커 — 픽셀을 mm 로 바꾸는 단 하나의 근거.

── 왜 여기가 중요한가 ──

벡터화 모델은 픽셀 좌표만 준다. 그것을 mm 로 바꾸는 배율이 틀리면 도면 전체가 통째로
틀린다. 3m 짜리 방이 30m 가 되고, 그 사실을 아무도 눈치채지 못한다.

그래서 배율은 **도면에 적힌 치수 글자**에서만 얻는다. 짐작하지 않는다. 못 읽으면
confidence 를 0 으로 두고 검수 화면이 사용자에게 두 점을 찍게 한다 — 모르는 것을
아는 척하는 것보다 물어보는 편이 낫다.

── OCR 은 원본을 본다 ──

전처리한 그림이 아니라 **크롭 전 원본**을 읽는다. 업스케일(특히 Real-ESRGAN)은 선을
또렷하게 해 주지만 글자는 지어낸다. 치수 숫자를 지어내면 배율이 통째로 틀어진다.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Protocol

#: 가로·세로에서 얻은 배율이 이만큼 넘게 다르면 뭔가 잘못됐다.
#: 사양이 정한 값이다.
SCALE_MISMATCH = 0.03

#: 도면 치수로 말이 되는 범위 (mm). 방 하나부터 큰 건물 한 층까지.
PLAUSIBLE_MM = (500.0, 300_000.0)

#: 이만큼은 읽어야 "가장 긴 것이 외곽 치수" 라는 가정이 선다.
#:
#: 하나만 읽고 그것을 외곽으로 삼으면 11m 짜리 집이 2m 가 된다. 둘이면 서로 대 볼
#: 수 있고(가로·세로가 어긋나면 scale-mismatch 로 잡힌다), 그것만으로도 충분히 다르다.
MIN_DIMENSIONS = 2

#: 벽이 이 각도 안에 있으면 축에 맞춘다 (도). 사양이 정한 값이다.
AXIS_SNAP_DEG = 3.0


@dataclass(frozen=True)
class OcrText:
    """OCR 이 읽은 글자 한 덩어리 (원본 이미지 픽셀 좌표)."""

    text: str
    #: 글자 상자 [x, y, w, h]
    box: tuple[float, float, float, float]

    @property
    def center(self) -> tuple[float, float]:
        x, y, w, h = self.box
        return (x + w / 2, y + h / 2)

    @property
    def horizontal(self) -> bool:
        """가로로 쓴 글자인가 — 세로 치수는 대개 90도 돌아가 있다."""
        _, _, w, h = self.box
        return w >= h


class OcrEngine(Protocol):
    def read(self, image_bytes: bytes) -> list[OcrText]: ...


#: 치수 숫자. "14,845" · "17169" · "11,653" 처럼 콤마가 있거나 없다.
#: 소수점은 m 단위 도면(2.45)에서 나오므로 함께 받는다.
_NUMBER = re.compile(r"^\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(mm|m|MM|M)?\s*$")


def parse_dimension(text: str) -> float | None:
    """치수 글자 → mm. 치수가 아니면 None.

    콤마는 천 단위 구분이다. "14,845" 는 14845mm 지 14.845 가 아니다 — 여기서 헷갈리면
    도면이 1000배 작아진다.

    단위가 안 붙은 숫자는 mm 로 본다. 국내 건축 도면의 관행이고, 소수점이 있으면
    (2.45 처럼) m 로 적은 것이라 1000을 곱한다.
    """
    match = _NUMBER.match(text)
    if not match:
        return None

    body, unit = match.group(1), (match.group(2) or "").lower()
    value = float(body.replace(",", ""))

    if unit == "m":
        value *= 1000.0
    elif not unit and "." in body:
        # 소수점이 있으면 m 로 적은 것이다. mm 를 소수로 적는 도면은 없다.
        value *= 1000.0

    if not (PLAUSIBLE_MM[0] <= value <= PLAUSIBLE_MM[1]):
        return None
    return value


@dataclass
class Anchor:
    """배율과, 그것을 어떻게 얻었는지."""

    mm_per_pixel: float
    confidence: float
    #: 가로 치수에서 얻은 값 / 세로 치수에서 얻은 값 (없으면 None)
    from_width: float | None = None
    from_height: float | None = None
    flags: list[str] = field(default_factory=list)
    #: 배율의 근거가 된 치수 (mm)
    used_width_mm: float | None = None
    used_height_mm: float | None = None


def anchor_scale(
    texts: list[OcrText],
    outline_px: tuple[float, float],
) -> Anchor:
    """치수 글자와 벡터화된 외곽 크기로 mm/px 를 구한다.

    가장 긴 가로 치수를 도면 가로 전체로, 가장 긴 세로 치수를 세로 전체로 본다.
    실제 도면은 외곽 치수를 가장 크게 적으므로 대개 맞고, 틀리면 가로·세로에서 나온
    배율이 어긋나 flag 로 잡힌다.

    치수를 하나도 못 읽으면 confidence 0 이다. 그때는 배율을 쓰면 안 되고, 검수 화면이
    사용자에게 두 점을 찍게 해야 한다.
    """
    width_px, height_px = outline_px
    flags: list[str] = []

    horizontal: list[float] = []
    vertical: list[float] = []

    for item in texts:
        value = parse_dimension(item.text)
        if value is None:
            continue
        (horizontal if item.horizontal else vertical).append(value)

    #
    # ── 숫자 하나를 외곽 치수로 믿지 않는다 ──
    #
    # 우리는 "가장 긴 치수가 외곽 치수다" 라고 본다. 그 가정은 치수를 여러 개 읽었을
    # 때만 말이 된다. 실제로 저해상도 도면에서 OCR 이 구석의 2150 하나만 읽어 왔는데,
    # 그것을 외곽으로 삼으면 11m 짜리 집이 2m 가 된다 — 그런데 화면에는 아무 문제 없이
    # 뜬다. 틀린 줄 모르는 것이 가장 나쁘다.
    #
    # 그래서 몇 개 못 읽었으면 배율을 내되 신뢰도를 낮추고 지적을 남긴다.
    found = len(horizontal) + len(vertical)

    used_w = max(horizontal) if horizontal else None
    used_h = max(vertical) if vertical else None

    from_width = used_w / width_px if used_w and width_px > 0 else None
    from_height = used_h / height_px if used_h and height_px > 0 else None

    candidates = [value for value in (from_width, from_height) if value and value > 0]

    if not candidates:
        return Anchor(
            mm_per_pixel=1.0,
            confidence=0.0,
            flags=["no-dimension-text"],
        )

    if from_width and from_height:
        spread = abs(from_width - from_height) / max(from_width, from_height)
        if spread >= SCALE_MISMATCH:
            flags.append("scale-mismatch")

        # 어긋나도 평균을 쓴다 — 한쪽만 고르면 그 쪽이 틀렸을 때 손쓸 수가 없다.
        # 어긋났다는 사실은 flag 로 남으므로 검수 화면이 먼저 묻는다.
        mm_per_pixel = (from_width + from_height) / 2
        confidence = 0.5 if "scale-mismatch" in flags else 0.9
    else:
        mm_per_pixel = candidates[0]
        # 한 축만 맞춰 봤으면 반쯤만 믿는다
        confidence = 0.6
        flags.append("scale-one-axis")

    if found < MIN_DIMENSIONS:
        flags.append("few-dimension-text")
        confidence = min(confidence, 0.3)

    return Anchor(
        mm_per_pixel=mm_per_pixel,
        confidence=confidence,
        from_width=from_width,
        from_height=from_height,
        flags=flags,
        used_width_mm=used_w,
        used_height_mm=used_h,
    )


# ───────────────────────── 벽 정리 ─────────────────────────


def align_to_axis(
    a: tuple[float, float], b: tuple[float, float], tolerance_deg: float = AXIS_SNAP_DEG
) -> tuple[tuple[float, float], tuple[float, float]]:
    """거의 수평·수직인 벽을 정확히 맞춘다.

    벡터화 모델이 낸 벽은 1~2도씩 기울어 있다. 그대로 두면 방이 안 닫히고, 3D 에서
    벽이 비스듬히 서고, 치수가 실제보다 길게 나온다.

    **정말 사선인 벽은 건드리지 않는다.** 도면에 비스듬히 그려진 벽을 억지로 펴면
    그건 더 이상 그 도면이 아니다.
    """
    dx, dy = b[0] - a[0], b[1] - a[1]
    if abs(dx) < 1e-9 and abs(dy) < 1e-9:
        return a, b

    angle = math.degrees(math.atan2(dy, dx)) % 180.0
    off_horizontal = min(angle, 180.0 - angle)
    off_vertical = abs(angle - 90.0)

    if off_horizontal <= tolerance_deg:
        mid = (a[1] + b[1]) / 2
        return (a[0], mid), (b[0], mid)

    if off_vertical <= tolerance_deg:
        mid = (a[0] + b[0]) / 2
        return (mid, a[1]), (mid, b[1])

    return a, b


def snap_to_ticks(value: float, ticks: list[float], tolerance: float) -> float:
    """치수선에서 얻은 눈금이 가까이 있으면 그 자리로 붙인다.

    치수선의 눈금은 도면에 실제로 그어진 선이다. 벡터화가 낸 벽 끝점보다 이쪽이
    정확하므로, 가까우면 눈금을 따른다. 눈금이 없으면 아무 일도 하지 않는다 —
    없는 자리에 붙이는 것은 도면을 고치는 일이다.
    """
    if not ticks or tolerance <= 0:
        return value

    best = value
    best_gap = tolerance + 1

    for tick in ticks:
        gap = abs(tick - value)
        if gap <= tolerance and gap < best_gap:
            best = tick
            best_gap = gap

    return best


# ───────────────────────── OCR 백엔드 ─────────────────────────


class RapidOcr:
    """RapidOCR 백엔드.

    onnxruntime 만 있으면 도는 가벼운 OCR 이다(약 15MB). 처음에는 PaddleOCR 를 두었는데
    paddlepaddle 이 수백 MB 라 배포가 무거워진다 — 도면에서 읽어야 하는 것은 치수 숫자와
    짧은 실명뿐이라 이 정도로 충분하다.

    안 깔려 있으면 available() 이 False 이고, 그때는 배율 confidence 가 0 이 되어 검수
    화면이 사용자에게 두 점을 찍게 한다. 사양이 정한 폴백이다.

    설치: pip install -r requirements-ocr.txt
    """

    name = "rapidocr"

    def __init__(self) -> None:
        self._engine = None

    def available(self) -> bool:
        try:
            import rapidocr_onnxruntime  # noqa: F401

            return True
        except Exception:  # noqa: BLE001
            return False

    def read(self, image_bytes: bytes) -> list[OcrText]:
        import cv2
        import numpy as np
        from rapidocr_onnxruntime import RapidOCR

        if self._engine is None:
            self._engine = RapidOCR()

        array = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if array is None:
            return []

        result, _ = self._engine(array)

        out: list[OcrText] = []
        for box, text, _score in result or []:
            xs = [float(point[0]) for point in box]
            ys = [float(point[1]) for point in box]
            out.append(
                OcrText(
                    text=str(text),
                    box=(min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)),
                )
            )

        return out


def default_ocr() -> OcrEngine | None:
    """쓸 수 있는 OCR. 없으면 None — 부르는 쪽이 confidence 0 으로 간다."""
    engine = RapidOcr()
    return engine if engine.available() else None
