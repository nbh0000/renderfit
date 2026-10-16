# 도면 파싱 마이크로서비스의 배포 이미지.
#
# ── 왜 따로 배포하나 ──
#
# Next.js 는 Node 로 돌고 이 서비스는 Python 이다. ezdxf·shapely·opencv 가 전부
# Python 생태계라 한 이미지에 억지로 합치지 않고 서비스를 둘로 나눈다.
#
# 이것을 배포하지 않으면 **배포본에서 도면 기능이 통째로 죽는다.** Next.js 는
# PLAN_INGEST_URL 이 없으면 127.0.0.1:8001 로 붙으러 가는데, 컨테이너 안에는 아무것도
# 없어서 DXF 조차 읽히지 않는다. 실제로 그 상태로 있었다.
#
# Railway → New Service → 같은 저장소 → Settings
#   Root Directory : services/plan-ingest
#   Builder        : Dockerfile
#   Dockerfile Path: Dockerfile
# 그리고 Next.js 서비스의 PLAN_INGEST_URL 에 이 서비스의 내부 주소를 넣는다.

FROM python:3.12-slim

# opencv-python-headless 는 화면을 안 쓰지만 libglib 은 필요하다.
# 이것 없이 올리면 import cv2 에서 죽는다 — 빌드는 통과하고 첫 요청에서 터진다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# 의존성을 먼저 깐다 — 코드만 고쳤을 때 이 층을 다시 만들지 않게.
#
# OCR(requirements-ocr.txt)까지 넣는 이유는 **배율** 때문이다. 치수 글자를 못 읽으면
# 픽셀을 mm 로 바꿀 수 없어, 도면을 올릴 때마다 사람이 검수 화면에서 길이를 아는 두
# 점을 찍어야 한다. onnxruntime 이 이미지를 200MB 가량 키우지만, 그 값은 한다.
COPY requirements.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements-ocr.txt

COPY app ./app
COPY raster ./raster

# 루트로 돌리지 않는다. 이 서비스는 사용자가 올린 파일을 받는다.
RUN useradd --create-home --uid 10001 ingest && chown -R ingest:ingest /app
USER ingest

# Railway 가 PORT 를 준다. 로컬에서 그냥 띄우면 8001 이다.
ENV PORT=8001
EXPOSE 8001

# sh -c 를 쓰는 이유는 $PORT 를 껍데기가 풀어 주어야 하기 때문이다.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
