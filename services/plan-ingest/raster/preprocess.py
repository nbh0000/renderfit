"""래스터 도면 전처리.

── 이 경로가 무엇인가 ──

**원본 DXF 가 없을 때의 차선책**이다. 자동 완성이 목표가 아니라 **검수 시간을 줄이는
것**이 목표다. 그래서 여기서 하는 일은 벡터화 모델이 잘 읽을 수 있게 그림을 다듬는
것뿐이고, 틀릴 만한 곳은 전부 지적(flag)으로 남겨 사람이 보게 한다.

── 크롭이 가장 중요하다 ──

정확도에 가장 크게 영향을 주는 것은 알고리즘이 아니라 **어디를 도면으로 볼 것인가**다.
표제란·범례·여백·다른 도면이 함께 들어오면 벡터화 모델이 그 선까지 벽으로 읽는다.
그래서 사용자가 직접 도면 영역을 잡게 하고, 그 사각형을 잡에 저장해 둔다 — 다시
돌릴 때 같은 자리에서 시작하려면 남아 있어야 한다.

── 치수선·해치는 지우지 않는다 ──

벡터화 모델이 대부분 무시한다. 지우려다 벽선까지 갉아먹는 쪽이 훨씬 나쁘다.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import cv2
import numpy as np

#: 벡터화 모델에 넣기 전 긴 변을 이만큼까지 키운다.
#:
#: 모델이 벽선을 집으려면 선이 몇 픽셀은 되어야 한다. 캡처본은 벽이 1~2px 라
#: 키우지 않으면 선이 끊긴 것으로 읽힌다. 늘린다고 없던 정보가 생기지는 않지만,
#: 있는 선을 모델이 볼 수 있게는 해 준다.
TARGET_LONG_EDGE = 2000

#: 이보다 크면 더 키우지 않는다 — 메모리와 시간만 먹는다
MAX_LONG_EDGE = 4000


@dataclass(frozen=True)
class CropRect:
    """도면 영역 (원본 이미지의 픽셀 좌표, 왼쪽 위 기준).

    UI 가 잡아 준 값을 그대로 담는다. 비율이 아니라 픽셀인 이유는, 원본을 다시 읽을 때
    같은 자리가 나와야 하기 때문이다 — 비율로 두면 어느 크기 기준인지 또 정해야 한다.
    """

    x: int
    y: int
    width: int
    height: int

    def clamp(self, image_width: int, image_height: int) -> "CropRect":
        x = max(0, min(self.x, image_width - 1))
        y = max(0, min(self.y, image_height - 1))
        return CropRect(
            x=x,
            y=y,
            width=max(1, min(self.width, image_width - x)),
            height=max(1, min(self.height, image_height - y)),
        )


@dataclass(frozen=True)
class Prepared:
    """전처리를 마친 그림과, 원본으로 되돌아가는 데 필요한 값들."""

    #: 벡터화 모델에 넣을 그림 (이진화, 흰 바탕에 검은 선)
    binary: np.ndarray
    #: 크롭만 하고 키우기 전의 그림 (OCR·검수 화면이 본다)
    cropped: np.ndarray
    #: 크롭 사각형 (원본 픽셀)
    crop: CropRect
    #: 크롭본을 몇 배로 키웠나 — 벡터화 좌표를 원본 좌표로 되돌릴 때 쓴다
    upscale: float
    #: 업스케일에 무엇을 썼나
    upscaler: str

    def to_source_pixels(self, x: float, y: float) -> tuple[float, float]:
        """전처리한 그림의 좌표 → **원본 이미지**의 좌표.

        벡터화 모델은 우리가 넣어 준 그림 기준으로 답한다. 그것을 원본 좌표로 되돌려
        놓지 않으면 치수 OCR(원본에서 읽는다)과 자리가 안 맞는다.
        """
        return (
            self.crop.x + x / self.upscale,
            self.crop.y + y / self.upscale,
        )


def decode(data: bytes) -> np.ndarray:
    """바이트 → BGR 이미지."""
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("이미지를 읽지 못했습니다. PNG·JPG 인지 확인해 주세요.")
    return image


def encode_png(image: np.ndarray) -> bytes:
    ok, buffer = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("PNG 로 굽지 못했습니다.")
    return buffer.tobytes()


def _upscale(image: np.ndarray, factor: float) -> tuple[np.ndarray, str]:
    """크게 키운다.

    Real-ESRGAN 이 있으면 그것을 쓰고, 없으면 Lanczos 로 간다. Real-ESRGAN 은 선을
    또렷하게 살려 주지만 **글자는 지어낸다** — 그래서 벡터화용 그림에만 쓰고, 치수를
    읽는 OCR 은 언제나 원본을 본다(scale_anchor.py).
    """
    height, width = image.shape[:2]
    size = (int(round(width * factor)), int(round(height * factor)))

    try:
        from .esrgan import upscale as esrgan_upscale  # type: ignore

        return esrgan_upscale(image, factor), "real-esrgan"
    except Exception:  # noqa: BLE001 — 없으면 없는 대로 간다
        return cv2.resize(image, size, interpolation=cv2.INTER_LANCZOS4), "lanczos"


def binarize(gray: np.ndarray) -> np.ndarray:
    """적응형 이진화.

    도면 캡처는 밝기가 고르지 않다 — 스캔 그림자, JPEG 얼룩, 화면 캡처의 감마.
    전역 문턱값으로 자르면 어두운 구석의 벽선이 통째로 사라진다. 주변을 보고 자르는
    적응형이라야 옅은 선도 남는다.

    블록 크기는 홀수여야 하고, 벽선 굵기의 몇 배는 되어야 한다.

    ── 흐리게 하지 않는다 ──

    처음에는 JPEG 얼룩을 지우려고 medianBlur(3) 을 먼저 걸었다. 그런데 3×3 중앙값은
    **1픽셀 굵기의 선을 통째로 지운다** — 이웃 아홉 칸 중 어두운 칸이 셋뿐이라
    중앙값이 밝은 쪽으로 간다. 캡처 도면의 벽이 바로 그 1픽셀이다. 얼룩은 벡터화
    모델이 무시하지만 지워진 벽은 아무도 되살리지 못하므로, 흐리게 하지 않는다.
    """
    return cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=10,
    )


def prepare(data: bytes, crop: CropRect | None = None) -> Prepared:
    """업로드한 그림을 벡터화에 넣을 수 있게 다듬는다.

    crop 이 없으면 그림 전체를 도면으로 본다. 그래도 돌아가지만 정확도는 크게 떨어진다 —
    표제란과 범례의 선을 벽으로 읽기 때문이다. UI 가 크롭을 받아 넘기는 것이 정상 경로다.
    """
    image = decode(data)
    height, width = image.shape[:2]

    rect = (crop or CropRect(0, 0, width, height)).clamp(width, height)
    cropped = image[rect.y : rect.y + rect.height, rect.x : rect.x + rect.width]

    long_edge = max(cropped.shape[:2])
    if long_edge <= 0:
        raise ValueError("크롭 영역이 비었습니다.")

    factor = 1.0
    upscaler = "none"
    if long_edge < TARGET_LONG_EDGE:
        factor = min(TARGET_LONG_EDGE / long_edge, MAX_LONG_EDGE / long_edge)
        cropped_big, upscaler = _upscale(cropped, factor)
    else:
        cropped_big = cropped

    gray = cv2.cvtColor(cropped_big, cv2.COLOR_BGR2GRAY)

    return Prepared(
        binary=binarize(gray),
        cropped=cropped,
        crop=rect,
        upscale=factor,
        upscaler=upscaler,
    )


#: 글자가 이보다 작으면 치수를 읽을 수 없다 (원본 픽셀).
#:
#: 실제로 재 본 값이다. 사용자가 올린 A1 도면 캡처(645×456)에서 치수 글자 높이가
#: 4~5px 이었고, OCR 은 체인 숫자를 **하나도** 읽지 못했다. 그림틀 이름표처럼 큰
#: 글자 몇 개만 걸렸다. 반대로 16px 이상이면 안정적으로 읽힌다.
LEGIBLE_TEXT_PX = 10


def glyph_height(image: np.ndarray) -> float | None:
    """도면에 적힌 **글자의 대표 높이** (원본 픽셀).

    ── 왜 재나 ──

    래스터 경로의 정확도는 알고리즘보다 **입력 해상도**가 먼저 정한다. 치수 글자를
    못 읽으면 배율을 정할 수 없고, 배율이 없으면 벽을 아무리 잘 찾아도 mm 가 나오지
    않는다. 그런데 그림을 키우면 화면상으로는 커 보이므로, 사용자도 우리도 왜 결과가
    엉망인지 알기 어렵다. 그래서 **키우기 전 원본에서** 재어 숫자로 남긴다.

    ── 어떻게 재나 ──

    글자 한 획씩 떨어져 있는 덩어리(연결 요소) 중 **글자만 한 것**의 높이를 모아
    중앙값을 낸다. 벽선·치수선은 길어서 걸러지고, 점·노이즈는 너무 작아 걸러진다.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    ink = (gray < 160).astype(np.uint8)
    if ink.sum() == 0:
        return None

    count, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)

    heights = [
        int(stats[index, cv2.CC_STAT_HEIGHT])
        for index in range(1, count)
        # 글자 한 자 크기 — 너무 길거나(선) 너무 작은(노이즈) 것은 뺀다
        if 2 <= stats[index, cv2.CC_STAT_HEIGHT] <= 40
        and 1 <= stats[index, cv2.CC_STAT_WIDTH] <= 40
        and stats[index, cv2.CC_STAT_AREA] >= 3
    ]

    if len(heights) < 20:
        return None

    heights.sort()
    return float(heights[len(heights) // 2])
