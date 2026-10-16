"""골든 파일을 다시 만든다.

파서를 고친 뒤 **결과가 좋아진 것을 눈으로 확인했을 때만** 돌린다. 시험이 빨개졌다고
습관적으로 돌리면 골든이 시험을 따라다니게 되고, 그때부터 이 시험은 아무것도 지키지
않는다.

    .venv/Scripts/python tests/make_fixtures.py   # DXF 세 장
    .venv/Scripts/python tests/make_golden.py     # 골든 세 장
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.dxf_parse import parse_dxf  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
GOLDEN = Path(__file__).parent / "golden"

#: 파일마다 새로 만들어지는 값. 골든에 담으면 매번 달라져 비교할 수 없다.
VOLATILE = ("id",)


def strip_ids(value: object) -> object:
    """id 를 걷어낸다 — uuid 라서 돌릴 때마다 다르다."""
    if isinstance(value, dict):
        return {
            key: strip_ids(item)
            for key, item in value.items()
            if key not in VOLATILE and not key.endswith("Id")
        }
    if isinstance(value, list):
        return [strip_ids(item) for item in value]
    return value


def main() -> None:
    GOLDEN.mkdir(exist_ok=True)

    for path in sorted(FIXTURES.glob("*.dxf")):
        doc = parse_dxf(path.read_bytes(), source_type="cad")
        out = GOLDEN / f"{path.stem}.json"
        out.write_text(
            json.dumps(strip_ids(doc), ensure_ascii=False, indent=1, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        rooms = ", ".join(
            f"{room.get('name') or '이름없음'} {room['areaMm2'] / 1e6:.2f}㎡" for room in doc["rooms"]
        )
        print(f"{path.stem}: 외곽 {doc['bounds']['w']:.0f}×{doc['bounds']['h']:.0f} · {rooms}")


if __name__ == "__main__":
    main()
