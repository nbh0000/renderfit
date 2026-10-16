"""DWG → DXF 변환 래퍼.

ezdxf 는 DWG 를 읽지 못한다. DWG 는 비공개 형식이라 공개 파서가 없다시피 하고,
있는 것도 버전마다 깨진다. 대신 ODA File Converter(무료 CLI)를 부른다 — Open Design
Alliance 가 배포하는 공식 변환기라 버전 호환이 가장 넓다.

컨버터가 없으면 **조용히 넘어가지 않는다.** 없는 줄 모르고 빈 도면을 돌려주면
사용자는 자기 도면이 이상한 줄 안다. 무엇을 설치해야 하는지까지 말해 준다.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


class ConverterMissing(RuntimeError):
    """ODA File Converter 를 찾지 못했다."""


class ConversionFailed(RuntimeError):
    """컨버터는 있는데 변환이 실패했다."""


#: 설치하면 대개 여기 있다. PATH 에 안 잡히는 일이 흔해서 직접 뒤진다.
_CANDIDATES = (
    r"C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe",
    r"C:\Program Files\ODA\ODAFileConverter 25.4.0\ODAFileConverter.exe",
    "/usr/bin/ODAFileConverter",
    "/opt/oda/ODAFileConverter",
    "/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter",
)


def find_converter() -> str | None:
    """컨버터 경로. 못 찾으면 None."""
    override = os.environ.get("ODA_FILE_CONVERTER")
    if override and Path(override).exists():
        return override

    on_path = shutil.which("ODAFileConverter")
    if on_path:
        return on_path

    for candidate in _CANDIDATES:
        if Path(candidate).exists():
            return candidate

    return None


def convert_to_dxf(dwg_bytes: bytes, *, timeout: float = 120.0) -> bytes:
    """DWG 바이트를 DXF 바이트로 바꾼다.

    ODA File Converter 는 파일 하나가 아니라 **폴더 단위**로 돈다. 그래서 임시 폴더
    둘을 만들어 하나에 넣고 다른 하나에서 꺼낸다.

    인자는 순서가 정해져 있다:
        입력폴더 출력폴더 출력버전 출력형식 재귀 감사 [필터]
    """
    converter = find_converter()
    if converter is None:
        raise ConverterMissing(
            "ODA File Converter 를 찾지 못했습니다. DWG 는 이 변환기 없이 읽을 수 없습니다. "
            "https://www.opendesign.com/guestfiles/oda_file_converter 에서 내려받아 설치한 뒤, "
            "PATH 에 넣거나 ODA_FILE_CONVERTER 환경변수에 실행 파일 경로를 지정해 주세요."
        )

    with tempfile.TemporaryDirectory() as work:
        source = Path(work) / "in"
        target = Path(work) / "out"
        source.mkdir()
        target.mkdir()
        (source / "plan.dwg").write_bytes(dwg_bytes)

        command = [
            converter,
            str(source),
            str(target),
            "ACAD2018",  # 출력 버전
            "DXF",       # 출력 형식
            "0",         # 하위 폴더까지 훑지 않는다
            "1",         # 변환 뒤 검사(audit)
            "*.dwg",
        ]

        try:
            result = subprocess.run(
                command,
                capture_output=True,
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise ConversionFailed(f"변환이 {timeout:.0f}초를 넘겼습니다.") from error

        produced = sorted(target.glob("*.dxf"))
        if not produced:
            detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
            raise ConversionFailed(
                "DWG 를 DXF 로 바꾸지 못했습니다."
                + (f" 컨버터가 남긴 말: {detail[:300]}" if detail else "")
            )

        return produced[0].read_bytes()
