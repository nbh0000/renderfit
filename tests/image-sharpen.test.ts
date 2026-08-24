import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

/**
 * 4K로 받은 그림이 뭉개져 보이던 문제.
 *
 * 모델은 4K를 실제로 4K만큼 그려 주지 않는다 — 2400px쯤 그린 뒤 늘려서 4800px로 준다.
 * (보관된 결과를 재 보면 4800px 원본의 또렷함이 37인데, 같은 그림을 2400px로 줄이면
 *  176이 나온다. 화소는 네 배인데 정보는 그대로라는 뜻이다.)
 * 그래서 큰 값을 주고 산 사람이 100%로 열어 보면 창틀도 나뭇결도 뭉개져 있다.
 *
 * 늘리면서 사라진 경계를 되살리는지, 그리고 작은 그림은 건드리지 않는지 본다.
 */

const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

/** 경계가 살아 있는 그림을 만든 뒤, 줄였다 늘려서 "뭉갠" 그림으로 만든다 */
async function blurryImage(size: number): Promise<Buffer> {
  const tile = 40;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="100%" height="100%" fill="#f2efe9"/>
    ${Array.from({ length: Math.floor(size / tile) }, (_, i) =>
      `<rect x="${i * tile}" y="0" width="${tile / 2}" height="${size}" fill="#3a3a38"/>` +
      `<rect x="0" y="${i * tile}" width="${size}" height="${tile / 2}" fill="#8a7f6d" opacity="0.5"/>`
    ).join("")}
  </svg>`;

  const crisp = await sharp(Buffer.from(svg)).png().toBuffer();
  // 4분의 1로 줄였다가 원래 크기로 늘린다 — 모델이 하는 일과 같다.
  return sharp(crisp)
    .resize(Math.round(size / 4))
    .resize(size)
    .png()
    .toBuffer();
}

/** 라플라시안 분산 — 경계가 뚜렷할수록 커진다 */
async function sharpnessOf(input: Buffer): Promise<number> {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const v = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - width] - data[i + width];
      sum += v;
      sumSq += v * v;
      count += 1;
    }
  }

  return sumSq / count - (sum / count) ** 2;
}

async function generateWith(pixels: Buffer, size: number) {
  vi.resetModules();
  const { generateImages } = await import("@/lib/image-api");

  generateContent.mockResolvedValue({
    candidates: [
      { content: { parts: [{ inlineData: { data: pixels.toString("base64"), mimeType: "image/png" } }] } },
    ],
  });

  const [image] = await generateImages({
    prompt: "거실",
    image: { data: "AAAA", mimeType: "image/png" },
    size,
    count: 1,
  });

  return image;
}

beforeEach(() => {
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_IMAGE_MODEL;
});

describe("고해상도 결과 다듬기", () => {
  it("늘려서 받은 4K의 경계를 되살린다", async () => {
    const blurry = await blurryImage(4096);
    const before = await sharpnessOf(blurry);

    const image = await generateWith(blurry, 4096);
    const after = await sharpnessOf(image.data);

    expect(image.width).toBe(4096);
    // 눈에 띄게 또렷해져야 한다. 원본이 이미 또렷했다면 이 배수가 나오지 않는다.
    expect(after).toBeGreaterThan(before * 1.5);
  }, 30_000);

  it("기본 해상도(1024px)는 건드리지 않는다", async () => {
    const plain = await blurryImage(1024);
    const before = await sharpnessOf(plain);

    const image = await generateWith(plain, 1024);
    const after = await sharpnessOf(image.data);

    // webp로 다시 담는 만큼의 차이만 있어야 한다 — 날을 세우지는 않는다.
    expect(after).toBeLessThan(before * 1.2);
  }, 30_000);
});
