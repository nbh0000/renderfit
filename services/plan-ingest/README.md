# plan-ingest — 도면 파싱 마이크로서비스

기하(벽·문·창·방 폴리곤)를 만드는 곳.
ezdxf·shapely·opencv·벡터화 모델이 전부 Python 생태계라 Node 쪽에 억지로 옮기지 않고
따로 세웠다. Next.js API 가 내부에서 호출한다.

**좌표는 LLM 이 만들지 않는다.** 이 서비스가 LLM 을 부르는 곳은 라벨러(`raster/label.py`)
하나뿐이고, 거기서도 이미 확정된 기하 위에 방 이름과 설비 종류만 붙인다.

세 경로가 어떻게 갈라져 한 문서로 모이는지는 [루트 README 의 흐름도](../../README.md)에 있다.

```
① cad      DXF · DWG      ezdxf 로 좌표를 그대로 읽는다        (DWG 은 ODA 로 DXF 를 거친다)
② cad-pdf  벡터 PDF       아직 없다 — 501                      (DXF 로 옮긴 뒤 ①과 같은 파서)
③ raster   스캔 · 캡처    크롭 → 전처리 → 벡터화 → 치수 OCR    (추정이 섞이므로 검수가 필수)
                                     ↓
                          FloorPlanDoc (mm · 좌하단 원점)
                                     ↓
                     /plan/[jobId]/review — 사람이 확인해야 넘어간다
```

## 띄우기

```bash
cd services/plan-ingest
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Windows
# .venv/bin/python -m pip install -r requirements-dev.txt     # macOS·Linux

.venv/Scripts/python -m uvicorn app.main:app --port 8001
```

Next.js 쪽은 `PLAN_INGEST_URL` 로 주소를 잡는다. 없으면 `http://127.0.0.1:8001`.

**이 서비스가 안 떠 있으면 도면을 하나도 못 읽는다.** Next.js 는 붙지 못한 것을
"offline" 으로 떨구고, 사용자에게는 도면이 안 읽히는 것으로만 보인다. 배포에서도
마찬가지다 — 배포 방법은 루트의 `DEPLOY.md` 3-5 에 있다.

## 시험

```bash
.venv/Scripts/python tests/make_fixtures.py   # 테스트용 DXF 세 장을 만든다
.venv/Scripts/python -m pytest tests -q
```

래스터 시험은 벡터화 모델도 OCR 도 부르지 않는다. 그 자리에 가짜를 끼워 **우리 코드가
좌표를 어떻게 옮기는지**만 정확한 숫자로 본다 — 유료 호출을 검증에 쓰지 않기 위해서다.

## DWG

ezdxf 는 DWG 를 못 읽는다. [ODA File Converter](https://www.opendesign.com/guestfiles/oda_file_converter)
(무료)를 설치하고 PATH 에 넣거나 `ODA_FILE_CONVERTER` 에 실행 파일 경로를 지정한다.
없으면 `/parse/dwg` 가 501 과 함께 무엇을 설치해야 하는지 알려 준다.

`GET /health` 의 `dwgConverter` 로 지금 받을 수 있는지 확인할 수 있다.

## 엔드포인트

| | |
|---|---|
| `GET /health` | 살아 있는지 · DWG 와 래스터를 받을 수 있는지 |
| `POST /parse/dxf` | DXF → FloorPlanDoc |
| `POST /parse/dwg` | DWG → (ODA) → DXF → FloorPlanDoc |
| `POST /parse/raster` | 스캔·캡처 이미지 → FloorPlanDoc (`crop_x`·`crop_y`·`crop_width`·`crop_height` 선택) |

## 래스터 경로 (`raster/`)

**원본 DXF 가 없을 때의 차선책**이다. 자동 완성이 목표가 아니라 **검수 시간을 줄이는
것**이 목표다.

```
preprocess.py       크롭 → 업스케일 → 적응형 이진화
vectorize.py        백엔드 인터페이스와 어댑터
opencv_backend.py   기본 백엔드 — 벽·문·방을 픽셀 좌표로 (외부 호출 없음)
scale_anchor.py     치수 글자를 읽어 픽셀 → mm 배율을 정한다
label.py            확정된 기하 위에 방 이름만 붙인다 (DXF 경로도 공용)
pipeline.py         위를 엮어 FloorPlanDoc 을 만든다
```

세 가지를 지킨다.

- **LLM 은 좌표를 만들지 않는다.** 방 이름과 설비 종류만 붙인다. 프롬프트에도
  "좌표나 치수를 출력하지 마라" 가 박혀 있다.
- **심볼을 인식하려 들지 않는다.** OCR 로 잡힌 라벨 글자 자리에 표준 규격
  플레이스홀더만 놓는다(`fixture_defaults.yaml`). 잘못 알아본 가구를 그리는 것보다
  자리만 잡아 두고 사람이 옮기는 편이 낫다.
- **신뢰도 0.6 미만은 전부 `review.flags` 로 올린다.** 조용히 통과시키면 사용자는
  그것이 측정된 값인 줄 안다.

### 벡터화 백엔드

기본은 **OpenCV(`raster/opencv_backend.py`)** 다. 외부 호출도 키도 없이 그림에서 직접
잰다 — 굵은 획을 벽으로, 벽선이 끊긴 자리를 개구부로, 둘러싸인 흰 영역을 방으로 본다.
`/health` 의 `rasterBackend` 로 지금 무엇이 도는지 볼 수 있다.

잘 읽는 것과 못 읽는 것이 분명하다.

| 잘 읽는다 | 약하다 |
|---|---|
| CAD 에서 내보낸 깨끗한 평면도 (굵은 벽·두 줄 벽 모두) | 손그림·기울어진 사진 |
| 가로·세로 벽, 벽에 난 문·창 자리와 폭 | 문인지 창인지 (**종류는 정하지 않는다** — 검수에서 사람이 고른다) |
| 벽 두께·방 면적 (잰 값이다. 표준 규격으로 되돌리지 않는다) | 짧은 벽 토막 (두께의 6배보다 짧으면 글자 덩어리와 못 가른다) |

`RASTERSCAN_API_KEY` 를 넣으면 상용 백엔드로 갈 수 있게 자리는 있지만, **그 어댑터는
실제 서비스와 맞춰 본 적이 없다** — 주소·인증 헤더·응답 스키마가 전부 미확인이다.
쓰려면 계약한 형태에 맞춰 `RasterScanBackend` 를 다시 써야 한다.

| 없으면 | 어떻게 되나 |
|---|---|
| OCR (`requirements-ocr.txt`) | 배율 confidence 가 0 이 되고, 검수 화면이 사용자에게 두 점을 찍게 한다 |
| opencv (`requirements.txt`) | 래스터 도면을 아예 못 읽는다 (`/health` 의 `raster: false`) |

크롭은 **정확도에 가장 크게 영향을 준다** — 표제란·범례가 함께 들어오면 벡터화 모델이
그 선까지 벽으로 읽는다. 편집기의 "도면 파일 들여오기" 가 사용자에게 받아 넘기고,
서버가 `plan_ingest_jobs.crop` 에 남긴다.

## 레이어 규칙

`app/wall_layer_patterns.yaml` 에 있다. 캐드 레이어 이름은 회사마다 다르므로 코드에
박지 않았다. 새 이름이 나오면 이 파일만 고치면 된다.
