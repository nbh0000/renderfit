/**
 * 플레이스홀더 SVG 생성기.
 * 실제 이미지가 붙기 전까지 스타일 썸네일 / mock 생성 결과 / 히어로 이미지를 대신한다.
 * TODO: 실제 레퍼런스 이미지가 확보되면 이 라우트 사용처를 정적 이미지로 교체.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 문자열 → 0~1 사이 안정적인 의사난수 */
function seeded(seed: string, index = 0): number {
  let h = 2166136261 ^ index;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function mix(hex: string, target: string, ratio: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(target);
  const c = (a: number, b: number) =>
    Math.round(a + (b - a) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

export interface RoomSceneOptions {
  width: number;
  height: number;
  tone: string;
  seed: string;
  caption?: string;
  subCaption?: string;
}

/** 실내 공간을 단순 도형으로 암시하는 플레이스홀더 */
export function roomSceneSvg({
  width,
  height,
  tone,
  seed,
  caption,
  subCaption,
}: RoomSceneOptions): string {
  const wall = mix(tone, "#ffffff", 0.62);
  const wallShade = mix(tone, "#ffffff", 0.48);
  const floor = mix(tone, "#3a2f26", 0.3);
  const object = mix(tone, "#26231f", 0.18);
  const objectSoft = mix(tone, "#ffffff", 0.3);
  const light = mix(tone, "#ffffff", 0.86);

  const horizon = Math.round(height * 0.66);
  const winW = Math.round(width * (0.22 + seeded(seed, 1) * 0.1));
  const winX = Math.round(width * (0.08 + seeded(seed, 2) * 0.12));
  const winY = Math.round(height * 0.14);
  const winH = Math.round(height * 0.36);

  const sofaW = Math.round(width * (0.34 + seeded(seed, 3) * 0.1));
  const sofaX = Math.round(width * (0.12 + seeded(seed, 4) * 0.14));
  const sofaH = Math.round(height * 0.16);
  const sofaY = horizon - Math.round(sofaH * 0.55);

  const tableW = Math.round(width * 0.18);
  const tableX = sofaX + sofaW + Math.round(width * 0.04);
  const tableY = horizon + Math.round(height * 0.03);

  const lampX = Math.round(width * (0.72 + seeded(seed, 5) * 0.12));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(caption ?? "placeholder")}">
  <rect width="${width}" height="${height}" fill="${wall}"/>
  <rect x="0" y="0" width="${Math.round(width * 0.18)}" height="${horizon}" fill="${wallShade}"/>
  <rect x="0" y="${horizon}" width="${width}" height="${height - horizon}" fill="${floor}"/>
  <rect x="0" y="${horizon}" width="${width}" height="2" fill="${mix(floor, "#000000", 0.15)}" opacity="0.35"/>

  <rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" fill="${light}"/>
  <rect x="${winX}" y="${winY}" width="${winW}" height="${winH}" fill="none" stroke="${object}" stroke-width="3" opacity="0.5"/>
  <line x1="${winX + winW / 2}" y1="${winY}" x2="${winX + winW / 2}" y2="${winY + winH}" stroke="${object}" stroke-width="3" opacity="0.35"/>

  <rect x="${sofaX}" y="${sofaY}" width="${sofaW}" height="${sofaH}" rx="${Math.round(sofaH * 0.18)}" fill="${object}" opacity="0.72"/>
  <rect x="${sofaX + Math.round(sofaW * 0.08)}" y="${sofaY - Math.round(sofaH * 0.28)}" width="${Math.round(sofaW * 0.24)}" height="${Math.round(sofaH * 0.36)}" rx="6" fill="${objectSoft}" opacity="0.85"/>

  <rect x="${tableX}" y="${tableY}" width="${tableW}" height="${Math.round(height * 0.035)}" rx="4" fill="${object}" opacity="0.5"/>

  <line x1="${lampX}" y1="${Math.round(height * 0.18)}" x2="${lampX}" y2="${horizon - Math.round(height * 0.02)}" stroke="${object}" stroke-width="3" opacity="0.5"/>
  <circle cx="${lampX}" cy="${Math.round(height * 0.2)}" r="${Math.round(height * 0.045)}" fill="${light}" stroke="${object}" stroke-opacity="0.4" stroke-width="2"/>

  <ellipse cx="${Math.round(width * 0.42)}" cy="${horizon + Math.round(height * 0.14)}" rx="${Math.round(width * 0.3)}" ry="${Math.round(height * 0.06)}" fill="${mix(floor, "#ffffff", 0.2)}" opacity="0.5"/>
  ${
    caption
      ? `<g>
    <rect x="0" y="${height - Math.round(height * 0.14)}" width="${width}" height="${Math.round(height * 0.14)}" fill="#26231f" opacity="0.55"/>
    <text x="${Math.round(width * 0.04)}" y="${height - Math.round(height * 0.06)}" fill="#ffffff" font-family="Pretendard, sans-serif" font-size="${Math.round(height * 0.05)}" font-weight="600">${escapeXml(caption)}</text>
    ${
      subCaption
        ? `<text x="${Math.round(width * 0.04)}" y="${height - Math.round(height * 0.02)}" fill="#ffffff" fill-opacity="0.75" font-family="Pretendard, sans-serif" font-size="${Math.round(height * 0.034)}">${escapeXml(subCaption)}</text>`
        : ""
    }
  </g>`
      : ""
  }
</svg>`;
}

/** 스타일 선택용 정사각 썸네일 */
export function styleThumbSvg(label: string, tone: string): string {
  const size = 240;
  const wall = mix(tone, "#ffffff", 0.66);
  const floor = mix(tone, "#3a2f26", 0.32);
  const object = mix(tone, "#26231f", 0.2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeXml(label)}">
  <rect width="${size}" height="${size}" fill="${wall}"/>
  <rect x="0" y="${size * 0.68}" width="${size}" height="${size * 0.32}" fill="${floor}"/>
  <rect x="${size * 0.12}" y="${size * 0.2}" width="${size * 0.3}" height="${size * 0.4}" fill="${mix(tone, "#ffffff", 0.88)}" stroke="${object}" stroke-opacity="0.4" stroke-width="3"/>
  <rect x="${size * 0.5}" y="${size * 0.52}" width="${size * 0.36}" height="${size * 0.16}" rx="8" fill="${object}" opacity="0.72"/>
  <circle cx="${size * 0.68}" cy="${size * 0.26}" r="${size * 0.07}" fill="${mix(tone, "#ffffff", 0.9)}" stroke="${object}" stroke-opacity="0.35" stroke-width="3"/>
</svg>`;
}
