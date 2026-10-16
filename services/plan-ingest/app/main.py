"""도면 파싱 마이크로서비스.

Next.js API 가 내부에서 호출한다. 바깥으로 열지 않는다 — 인증은 Next.js 쪽이 이미
했고, 이 서비스는 파일을 받아 FloorPlanDoc 을 돌려주는 일만 한다.

기하는 여기서만 만든다. LLM 은 확정된 기하 위에 이름만 붙인다(raster/label.py).
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .dwg import ConversionFailed, ConverterMissing, convert_to_dxf, find_converter
from .dxf_parse import parse_dxf

app = FastAPI(title="renderfit plan-ingest", version="0.2.0")


@app.get("/health")
def health() -> dict[str, object]:
    """살아 있는지와, 어떤 경로를 지금 받을 수 있는지."""
    from .raster_status import raster_status

    return {"ok": True, "dwgConverter": find_converter() is not None, **raster_status()}


@app.post("/parse/dxf")
async def parse_dxf_endpoint(file: UploadFile = File(...)) -> dict[str, object]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    try:
        return parse_dxf(data, source_type="cad")
    except Exception as error:  # noqa: BLE001 — ezdxf 가 형식마다 다른 예외를 던진다
        raise HTTPException(status_code=422, detail=f"DXF 를 읽지 못했습니다: {error}") from error


@app.post("/parse/dwg")
async def parse_dwg_endpoint(file: UploadFile = File(...)) -> dict[str, object]:
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    try:
        dxf = convert_to_dxf(data)
    except ConverterMissing as error:
        # 501 — 서버가 아직 그 일을 할 수 없다는 뜻이고, 무엇을 설치해야 하는지 알려 준다
        raise HTTPException(status_code=501, detail=str(error)) from error
    except ConversionFailed as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    try:
        return parse_dxf(dxf, source_type="cad")
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"DXF 를 읽지 못했습니다: {error}") from error


@app.post("/parse/raster")
async def parse_raster_endpoint(
    file: UploadFile = File(...),
    crop_x: int | None = Form(default=None),
    crop_y: int | None = Form(default=None),
    crop_width: int | None = Form(default=None),
    crop_height: int | None = Form(default=None),
) -> dict[str, object]:
    """스캔·캡처 도면 → FloorPlanDoc.

    **원본 DXF 가 없을 때의 차선책**이다. 결과는 언제나 review.status="auto" 이고,
    조금이라도 의심스러운 것은 전부 flags 로 올라간다.

    crop 은 사용자가 UI 에서 잡아 준 도면 영역이다. 정확도에 가장 크게 영향을 준다 —
    표제란·범례가 함께 들어오면 벡터화 모델이 그 선까지 벽으로 읽는다.
    """
    from .raster_status import raster_error

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="빈 파일입니다.")

    from raster.preprocess import CropRect
    from raster.pipeline import parse_raster
    from raster.vectorize import BackendUnavailable

    crop = None
    if None not in (crop_x, crop_y, crop_width, crop_height):
        crop = CropRect(
            x=int(crop_x), y=int(crop_y), width=int(crop_width), height=int(crop_height)
        )

    try:
        return parse_raster(data, crop)
    except BackendUnavailable as error:
        # 501 — 파일 잘못이 아니라 이 서버가 아직 그 일을 못 한다
        raise HTTPException(status_code=501, detail=raster_error(str(error))) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
