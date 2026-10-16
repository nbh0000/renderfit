"""래스터 경로를 지금 쓸 수 있는지.

/health 가 이것을 함께 알려 준다. 벡터화 백엔드나 OCR 이 없으면 래스터 도면은 못
읽는데, 그 사실을 올려 보내야 Next.js 쪽이 사용자에게 "지금은 DXF 를 올려 주세요"
라고 말할 수 있다. 조용히 빈 도면을 돌려주면 사용자는 자기 도면이 이상한 줄 안다.
"""

from __future__ import annotations


def raster_status() -> dict[str, object]:
    try:
        from raster.scale_anchor import default_ocr
        from raster.vectorize import default_backends
    except Exception:  # noqa: BLE001 — opencv 가 안 깔린 환경도 있다
        return {"raster": False, "rasterOcr": False, "rasterBackend": None}

    ready = next((backend for backend in default_backends() if backend.available()), None)

    return {
        "raster": ready is not None,
        "rasterOcr": default_ocr() is not None,
        "rasterBackend": ready.name if ready else None,
    }


def raster_error(message: str) -> str:
    """무엇이 없어서 못 하는지까지 알려 준다."""
    status = raster_status()
    if not status["rasterOcr"]:
        message += (
            " OCR 도 없습니다 — 치수 글자를 못 읽으면 배율을 정할 수 없어 "
            "검수 화면에서 두 점을 직접 찍어야 합니다 (pip install -r requirements-ocr.txt)."
        )
    return message
