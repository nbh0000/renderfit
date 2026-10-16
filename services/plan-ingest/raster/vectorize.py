"""벡터화 어댑터 — 인터페이스 하나에 백엔드 둘.

── 이 단계의 좌표는 아직 mm 가 아니다 ──

어떤 백엔드를 쓰든 결과는 **전처리한 그림의 픽셀 좌표**로 나온다. mm 로 바꾸는 일은
scale_anchor.py 가 원본의 치수 글자를 읽어 따로 한다. 여기서 섞으면 어느 좌표계인지
아무도 모르게 된다.

── LLM 은 여기 없다 ──

기하는 벡터화 모델만 만든다. LLM 은 확정된 기하 위에 이름을 붙일 뿐이다(label.py).
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

#: 이 아래로 떨어지는 벽은 전부 검수로 올린다.
#: 사양이 정한 값이다 — 조용히 틀린 값을 내보내지 않는다.
LOW_CONFIDENCE = 0.6


@dataclass
class PixelWall:
    """전처리 그림의 픽셀 좌표로 표현한 벽."""

    a: tuple[float, float]
    b: tuple[float, float]
    thickness_px: float
    confidence: float


@dataclass
class PixelOpening:
    kind: str  # "door" | "window"
    center: tuple[float, float]
    width_px: float
    confidence: float


@dataclass
class PixelRoom:
    polygon: list[tuple[float, float]]
    confidence: float


@dataclass
class VectorizeResult:
    walls: list[PixelWall] = field(default_factory=list)
    openings: list[PixelOpening] = field(default_factory=list)
    rooms: list[PixelRoom] = field(default_factory=list)
    #: 어느 백엔드가 만들었나 — 결과를 의심할 때 첫 번째로 볼 값
    backend: str = "unknown"


class VectorizeBackend(Protocol):
    """백엔드는 이 모양만 맞추면 된다."""

    name: str

    def available(self) -> bool: ...

    def run(self, image: np.ndarray) -> VectorizeResult: ...


class BackendUnavailable(RuntimeError):
    """백엔드를 쓸 수 없다 (키가 없거나 컨테이너가 안 떠 있다)."""


# ───────────────────────── RasterScan ─────────────────────────


class RasterScanBackend:
    """RasterScan API (raster-to-vector-base64).

    ── 주의: 실제 서비스와 맞춰 본 적이 없다 ──

    아래 주소·인증 헤더·응답 스키마는 **확인되지 않았다.** 실제 RasterScan 은
    RapidAPI 를 거치는 클라우드와 온프렘 Docker(포트 8888, `/plan_recognition_on_base64`,
    머신 활성화 필요)로 제공되고, 여기 적힌 `api.rasterscan.com` 은 응답하지 않는다.
    쓰려면 계약한 형태에 맞춰 이 클래스를 다시 써야 한다. 기본 경로는 OpenCV 다.

    그림을 base64 로 올리면 벽·문·방을 픽셀 좌표로 돌려준다.

    응답 모양이 바뀔 수 있으므로 **모르는 필드는 조용히 넘긴다.** 우리가 쓰는 것만
    꺼내고, 못 꺼낸 것은 신뢰도를 낮춰 검수로 올린다 — 없는 값을 지어내지 않는다.
    """

    name = "rasterscan"

    def __init__(self, api_key: str | None = None, endpoint: str | None = None) -> None:
        self._key = api_key or os.environ.get("RASTERSCAN_API_KEY")
        self._endpoint = endpoint or os.environ.get(
            "RASTERSCAN_URL", "https://api.rasterscan.com/v1/raster-to-vector-base64"
        )

    def available(self) -> bool:
        return bool(self._key)

    def run(self, image: np.ndarray) -> VectorizeResult:
        if not self.available():
            raise BackendUnavailable(
                "RASTERSCAN_API_KEY 가 없습니다. 래스터 도면을 벡터로 바꾸려면 키가 필요합니다."
            )

        import cv2
        import requests  # type: ignore[import-untyped]

        ok, buffer = cv2.imencode(".png", image)
        if not ok:
            raise RuntimeError("보낼 그림을 굽지 못했습니다.")

        response = requests.post(
            self._endpoint,
            headers={"Authorization": f"Bearer {self._key}", "Content-Type": "application/json"},
            json={"image": base64.b64encode(buffer.tobytes()).decode("ascii")},
            timeout=180,
        )
        response.raise_for_status()
        return parse_rasterscan(response.json())


def _point(value: object) -> tuple[float, float] | None:
    """[x, y] 또는 {"x":…, "y":…} 를 받아 준다."""
    if isinstance(value, (list, tuple)) and len(value) >= 2:
        try:
            return float(value[0]), float(value[1])
        except (TypeError, ValueError):
            return None
    if isinstance(value, dict) and "x" in value and "y" in value:
        try:
            return float(value["x"]), float(value["y"])
        except (TypeError, ValueError):
            return None
    return None


def parse_rasterscan(payload: dict) -> VectorizeResult:
    """RasterScan 응답 → 픽셀 좌표 결과.

    응답을 그대로 믿지 않는다. 좌표를 못 읽은 항목은 버리고, 신뢰도를 안 준 항목은
    낮게 잡아 검수로 올린다.
    """
    result = VectorizeResult(backend="rasterscan")

    for raw in payload.get("walls") or []:
        a = _point(raw.get("start") or raw.get("a") or raw.get("from"))
        b = _point(raw.get("end") or raw.get("b") or raw.get("to"))
        if a is None or b is None:
            continue

        try:
            thickness = float(raw.get("thickness", 0) or 0)
        except (TypeError, ValueError):
            thickness = 0.0

        result.walls.append(
            PixelWall(
                a=a,
                b=b,
                thickness_px=thickness,
                # 신뢰도를 안 주면 "확실하지 않다"로 본다 — 검수로 올라간다
                confidence=_confidence(raw, default=0.5),
            )
        )

    for raw in payload.get("doors") or []:
        center = _point(raw.get("center") or raw.get("position"))
        if center is None:
            continue
        result.openings.append(
            PixelOpening(
                kind="window" if str(raw.get("type", "")).lower() == "window" else "door",
                center=center,
                width_px=float(raw.get("width", 0) or 0),
                confidence=_confidence(raw, default=0.5),
            )
        )

    for raw in payload.get("windows") or []:
        center = _point(raw.get("center") or raw.get("position"))
        if center is None:
            continue
        result.openings.append(
            PixelOpening(
                kind="window",
                center=center,
                width_px=float(raw.get("width", 0) or 0),
                confidence=_confidence(raw, default=0.5),
            )
        )

    for raw in payload.get("rooms") or []:
        points = [p for p in (_point(item) for item in raw.get("polygon") or []) if p]
        if len(points) < 3:
            continue
        result.rooms.append(PixelRoom(polygon=points, confidence=_confidence(raw, default=0.5)))

    return result


def _confidence(raw: dict, *, default: float) -> float:
    for key in ("confidence", "score", "probability"):
        if key in raw:
            try:
                return max(0.0, min(1.0, float(raw[key])))
            except (TypeError, ValueError):
                continue
    return default


# ───────────────────────── 오픈소스 폴백 ─────────────────────────


class OpenSourceBackend:
    """CubiCasa5k / FloorplanTransformation 폴백.

    TODO(페이즈 2b): 별도 Docker 컨테이너로 띄우고 HTTP 로 부른다.
      · 모델 가중치가 수백 MB 라 이 서비스 이미지에 넣지 않는다
      · torch 를 여기 깔면 컨테이너가 몇 배로 무거워진다
      · 컨테이너 주소는 env `VECTORIZE_OSS_URL`

    인터페이스는 지금 맞춰 둔다 — 나중에 붙일 때 부르는 쪽을 고치지 않아도 되게.
    """

    name = "opensource"

    def __init__(self, endpoint: str | None = None) -> None:
        self._endpoint = endpoint or os.environ.get("VECTORIZE_OSS_URL")

    def available(self) -> bool:
        # 아직 컨테이너가 없다. 있다고 답하면 부르는 쪽이 기다리다 죽는다.
        return False

    def run(self, image: np.ndarray) -> VectorizeResult:  # noqa: ARG002
        raise BackendUnavailable(
            "오픈소스 벡터화 백엔드는 아직 만들지 않았습니다 (페이즈 2b). "
            "지금은 RASTERSCAN_API_KEY 를 설정해 주세요."
        )


def default_backends() -> list[VectorizeBackend]:
    """쓸 수 있는 백엔드를 우선순위대로.

    OpenCV 가 먼저인 이유는 **그것만 실제로 확인된 경로**이기 때문이다. RasterScan
    어댑터는 실제 서비스의 주소·인증·응답 모양과 맞춰 본 적이 없다(아래 주의 참고).
    키가 꽂혀 있다는 이유로 확인된 길을 두고 확인 안 된 길로 가면 안 된다.
    """
    from .opencv_backend import OpenCvBackend

    return [OpenCvBackend(), RasterScanBackend(), OpenSourceBackend()]


def vectorize(image: np.ndarray, backends: list[VectorizeBackend] | None = None) -> VectorizeResult:
    """쓸 수 있는 첫 백엔드로 벡터화한다.

    하나도 못 쓰면 예외를 던진다 — 빈 결과를 돌려주면 "벽이 없는 도면"으로 보이고,
    사용자는 자기 도면이 이상한 줄 안다.
    """
    tried: list[str] = []

    for backend in backends or default_backends():
        if not backend.available():
            tried.append(backend.name)
            continue
        return backend.run(image)

    raise BackendUnavailable(
        "쓸 수 있는 벡터화 백엔드가 없습니다 (" + ", ".join(tried) + "). "
        "RASTERSCAN_API_KEY 를 설정하거나 오픈소스 컨테이너를 띄워 주세요."
    )
