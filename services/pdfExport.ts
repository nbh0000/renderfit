import { PDFDocument } from "pdf-lib";

/**
 * 도면을 PDF 한 부로 묶는다.
 *
 * 지금까지 내보내기는 SVG 한 장, DXF 한 개씩이었다. 그런데 실제로 도면을 주고받는
 * 방식은 그렇지 않다 — 시공사에도 집주인에게도 "도면 한 부"를 보낸다. 장마다 흩어진
 * SVG를 받은 사람은 열어 보기도, 인쇄하기도, 카톡으로 넘기기도 번거롭다.
 *
 * 그래서 평면도·입면도·3D를 한 파일에 순서대로 담는다. 받는 사람은 파일 하나만
 * 열면 되고, 그대로 인쇄하면 도면집이 된다.
 *
 * 종이는 A3 가로다. 국내 인테리어 도면이 대부분 A3고, A4로 줄이면 치수 글자가
 * 읽히지 않는다. 프린터가 A4뿐이어도 축소 인쇄로 넘어가므로 A3를 기준으로 둔다.
 */

/** A3 가로 (mm) */
const A3 = { width: 420, height: 297 };

/** 1mm 가 PDF 단위(pt)로 얼마인지 — PDF는 72dpi 기준이다 */
const MM_TO_PT = 72 / 25.4;

/**
 * 그림을 몇 dpi 로 구울지.
 *
 * 우리 도면은 SVG(벡터)지만 PDF에 벡터 그대로 옮기려면 글꼴까지 함께 넣어야 하고,
 * 그러면 한글 글꼴 하나에 파일이 몇 MB씩 불어난다. 대신 넉넉한 해상도로 구워 넣는다.
 * 200dpi 면 A3에 3300px — 치수 글자와 가구 기호가 인쇄물에서 또렷하게 읽힌다.
 */
const DPI = 200;

/** A3 한 장을 이 해상도로 구웠을 때의 픽셀 크기 */
const SHEET_PX = {
  width: Math.round((A3.width / 25.4) * DPI),
  height: Math.round((A3.height / 25.4) * DPI),
};

export interface PdfSheet {
  /** 이 장이 무엇인지 (평면도, 입면도 — 남측 …) */
  title: string;
  /** SVG 원문. 넣으면 이것을 구워서 쓴다 */
  svg?: string;
  /** 이미 만들어진 PNG (3D 캡처처럼 SVG가 아닌 것) */
  png?: Buffer;
}

/**
 * SVG 한 장을 A3 크기 PNG 로 굽는다.
 *
 * 종이에 꽉 채우지 않고 여백을 남긴다 — 도면은 가장자리에 철할 자리가 있어야 하고,
 * 프린터마다 인쇄 못 하는 가장자리(약 5mm)가 있어서 딱 맞추면 치수선이 잘린다.
 */
async function renderSheet(svg: string): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  /** 가장자리 여백 (mm) */
  const margin = 10;
  const inner = {
    width: Math.round(((A3.width - margin * 2) / 25.4) * DPI),
    height: Math.round(((A3.height - margin * 2) / 25.4) * DPI),
  };

  const drawing = await sharp(Buffer.from(svg), { density: DPI })
    .resize(inner.width, inner.height, { fit: "inside", background: "#ffffff" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: SHEET_PX.width,
      height: SHEET_PX.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([{ input: drawing, gravity: "centre" }])
    .png()
    .toBuffer();
}

/** PNG(3D 캡처)를 A3 장에 앉힌다 — 도면과 같은 여백을 쓴다 */
async function placePng(png: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;

  const margin = 10;
  const inner = {
    width: Math.round(((A3.width - margin * 2) / 25.4) * DPI),
    height: Math.round(((A3.height - margin * 2) / 25.4) * DPI),
  };

  const fitted = await sharp(png)
    .resize(inner.width, inner.height, { fit: "inside", background: "#ffffff" })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: SHEET_PX.width,
      height: SHEET_PX.height,
      channels: 3,
      background: "#ffffff",
    },
  })
    .composite([{ input: fitted, gravity: "centre" }])
    .png()
    .toBuffer();
}

/**
 * 여러 장을 한 부로 묶는다.
 *
 * 한 장이라도 구워지지 않으면 그 장만 건너뛰고 나머지를 낸다. 입면도 한 장이
 * 안 된다고 평면도까지 못 받는 것은 곤란하다. 어느 장이 빠졌는지는 함께 돌려준다.
 */
export async function buildPdf(
  sheets: PdfSheet[]
): Promise<{ bytes: Uint8Array; included: string[]; skipped: string[] }> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("도면");
  pdf.setProducer("RENDERFIT");

  const included: string[] = [];
  const skipped: string[] = [];

  for (const sheet of sheets) {
    try {
      const png = sheet.svg
        ? await renderSheet(sheet.svg)
        : sheet.png
          ? await placePng(sheet.png)
          : null;

      if (!png) {
        skipped.push(sheet.title);
        continue;
      }

      const image = await pdf.embedPng(png);
      const page = pdf.addPage([A3.width * MM_TO_PT, A3.height * MM_TO_PT]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: A3.width * MM_TO_PT,
        height: A3.height * MM_TO_PT,
      });

      included.push(sheet.title);
    } catch {
      // 한 장이 실패해도 나머지는 낸다
      skipped.push(sheet.title);
    }
  }

  if (included.length === 0) {
    throw new Error("도면을 한 장도 만들지 못했습니다.");
  }

  return { bytes: await pdf.save(), included, skipped };
}
