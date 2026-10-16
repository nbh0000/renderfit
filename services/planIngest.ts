/**
 * 들여온 파일을 어느 경로로 보낼지 가른다.
 *
 * ── 왜 갈라야 하나 ──
 *
 * 기하를 만드는 방법이 입력마다 다르다. DXF 는 벽 선분이 좌표로 적혀 있어 파서가
 * 그대로 읽으면 되고, 벡터 PDF 는 DXF 로 옮긴 뒤 같은 파서를 태우고, 스캔 이미지는
 * 벡터화 모델을 거쳐야 한다. **LLM 이 좌표를 지어내는 길은 어디에도 없다.**
 *
 * ── 확장자만 믿지 않는다 ──
 *
 * 사람은 파일 이름을 아무렇게나 바꾼다. png 를 dxf 로 고쳐 올리면 CAD 파서가 열다
 * 죽는다. 그래서 **매직바이트가 확장자를 이긴다.** 확장자는 매직바이트로 가리지
 * 못했을 때만 본다.
 *
 * 여기에는 AI 호출도 네트워크도 없다. 전부 vitest 로 검증된다.
 */

export type IngestRoute = "cad" | "cad-pdf" | "raster";
export type PlanFormat = "dxf" | "dwg" | "pdf" | "png" | "jpeg";

export interface Classification {
  route: IngestRoute;
  format: PlanFormat;
  /** 왜 그렇게 갈랐는지 — 잡 레코드와 로그에 그대로 남긴다 */
  reason: string;
}

/** 앞부분을 이만큼만 읽어 본다 — 매직바이트는 맨 앞에 있다 */
const HEAD = 4096;

/**
 * PDF 안에서 글꼴 사전을 찾아볼 범위 (바이트).
 *
 * 글꼴 사전은 객체 헤더에 있어 대개 압축되지 않는다. 스캔 PDF 는 페이지가 이미지
 * 하나라 글꼴이 없다. 파일 전체를 훑으면 큰 도면에서 느려지므로 앞쪽만 본다.
 */
const PDF_SCAN = 512 * 1024;

const ascii = (bytes: Uint8Array, from: number, length: number): string => {
  let out = "";
  const end = Math.min(bytes.length, from + length);
  for (let i = from; i < end; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
};

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, index) => bytes[index] === byte);

/** 확장자 (점 없이, 소문자) */
export function extensionOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at < 0 ? "" : name.slice(at + 1).toLowerCase();
}

/**
 * PDF 에 벡터 글자가 들어 있는가.
 *
 * 글꼴 사전이 있으면 글자가 도형이 아니라 문자로 들어 있다는 뜻이고, 그러면 치수와
 * 실명을 **읽는 것이 아니라 꺼내 올 수 있다.** 없으면 페이지가 그림 한 장이라
 * 스캔으로 본다.
 *
 * 완벽한 판정은 아니다 — 표지에만 글꼴이 있고 도면은 스캔인 PDF 가 있을 수 있다.
 * 그때는 CAD 경로가 아무것도 못 찾고 래스터로 물러나면 된다. 반대로 벡터 PDF 를
 * 스캔으로 오해하면 있는 좌표를 버리고 추측하게 되므로, 의심스러우면 벡터로 본다.
 */
export function pdfHasVectorText(bytes: Uint8Array): boolean {
  const head = ascii(bytes, 0, Math.min(bytes.length, PDF_SCAN));
  return head.includes("/Font") || head.includes("/Type0") || head.includes("/TrueType");
}

/** 매직바이트로 형식을 가린다. 못 가리면 null */
function formatFromBytes(bytes: Uint8Array): PlanFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 5) === "%PDF-") return "pdf";

  /* DWG 는 버전 표시로 시작한다 — AC1012 ~ AC1032 */
  const tag = ascii(bytes, 0, 6);
  if (/^AC10\d\d$/.test(tag)) return "dwg";

  /* 이진 DXF 는 표시 문자열이 앞에 붙는다 */
  if (ascii(bytes, 0, 18) === "AutoCAD Binary DXF") return "dxf";

  /*
   * 텍스트 DXF 는 표시가 없다. 그룹코드 0 뒤에 SECTION 이 오고 곧이어 HEADER 나
   * ENTITIES 가 나오는 구조라, 앞부분에 그 낱말이 함께 있으면 DXF 로 본다.
   */
  const head = ascii(bytes, 0, HEAD);
  if (head.includes("SECTION") && (head.includes("HEADER") || head.includes("ENTITIES"))) {
    return "dxf";
  }

  return null;
}

/** 확장자로 형식을 짐작한다 */
function formatFromName(name: string): PlanFormat | null {
  const extension = extensionOf(name);
  if (extension === "dxf") return "dxf";
  if (extension === "dwg") return "dwg";
  if (extension === "pdf") return "pdf";
  if (extension === "png") return "png";
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  return null;
}

/**
 * 파일을 보고 경로를 정한다.
 *
 * 가리지 못하면 error 를 돌려준다. 모르는 파일을 래스터로 떠넘기면 벡터화 모델이
 * 엉뚱한 것을 읽고, 사용자는 왜 이상한 도면이 나왔는지 알 수 없다.
 */
export function classifyPlanFile(input: {
  name: string;
  bytes: Uint8Array;
}): Classification | { error: string } {
  if (input.bytes.length === 0) return { error: "빈 파일입니다." };

  const byBytes = formatFromBytes(input.bytes);
  const byName = formatFromName(input.name);
  const format = byBytes ?? byName;

  if (!format) {
    return {
      error: `무슨 파일인지 알 수 없습니다 (${extensionOf(input.name) || "확장자 없음"}). ` +
        "DXF·DWG·PDF·PNG·JPG 를 받습니다.",
    };
  }

  /** 확장자와 내용이 다르면 내용을 따랐다는 사실을 남긴다 */
  const mismatch =
    byBytes && byName && byBytes !== byName
      ? ` (확장자는 ${byName} 이지만 내용은 ${byBytes} 입니다 — 내용을 따릅니다)`
      : "";

  const how = byBytes ? "매직바이트" : "확장자";

  if (format === "dxf" || format === "dwg") {
    return { route: "cad", format, reason: `${how}로 ${format} 로 봤습니다${mismatch}` };
  }

  if (format === "pdf") {
    if (pdfHasVectorText(input.bytes)) {
      return {
        route: "cad-pdf",
        format,
        reason: `${how}로 PDF 로 봤고 글꼴이 들어 있어 벡터로 봅니다${mismatch}`,
      };
    }
    return {
      route: "raster",
      format,
      reason: `${how}로 PDF 로 봤지만 글꼴이 없어 스캔으로 봅니다${mismatch}`,
    };
  }

  return { route: "raster", format, reason: `${how}로 ${format} 로 봤습니다${mismatch}` };
}
