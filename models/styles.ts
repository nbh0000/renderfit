/**
 * Editor용 스타일 프리셋.
 * 기존 config/styles.ts(생성 스튜디오용 16종)와 별개로, Scene 생성/스타일 트랜스퍼에 쓰는
 * 프리셋을 정의한다. promptFragment는 생성 provider에 그대로 전달된다.
 */
export interface StylePreset {
  id: string;
  label: string;
  /** 자연어 명령 매칭용 별칭 */
  aliases: string[];
  promptFragment: string;
  /** 미리보기 스와치 */
  palette: [string, string, string];
  /** 이 스타일이 선호하는 기본 재질 */
  defaultMaterials: { wall: string; floor: string; upholstery: string };
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "modern",
    label: "Modern",
    aliases: ["모던", "modern"],
    promptFragment:
      "modern style: clean straight lines, matte white and charcoal palette, minimal ornament, indirect lighting",
    palette: ["#f4f2ef", "#8a8a87", "#2f2d2b"],
    defaultMaterials: { wall: "mat_white_paint", floor: "mat_light_oak", upholstery: "mat_grey_fabric" },
  },
  {
    id: "minimal",
    label: "Minimal",
    aliases: ["미니멀", "minimal"],
    promptFragment:
      "minimal style: only essential furniture, generous negative space, tone-on-tone neutrals, handleless storage",
    palette: ["#eae7e1", "#d6cfc4", "#8b857d"],
    defaultMaterials: { wall: "mat_white_paint", floor: "mat_light_oak", upholstery: "mat_linen" },
  },
  {
    id: "japandi",
    label: "Japandi",
    aliases: ["재팬디", "japandi", "젠", "zen"],
    promptFragment:
      "japandi style: japanese-scandinavian hybrid, low profile furniture, warm oak and paper lighting, muted earthy palette, calm empty space",
    palette: ["#e7e0d3", "#c9a173", "#5c554b"],
    defaultMaterials: { wall: "mat_warm_ivory", floor: "mat_oak", upholstery: "mat_linen" },
  },
  {
    id: "scandinavian",
    label: "Scandinavian",
    aliases: ["북유럽", "스칸디나비안", "scandinavian", "nordic"],
    promptFragment:
      "scandinavian style: bright birch and oak wood, white walls, light grey textiles, knit and linen textures, green plant accents",
    palette: ["#f4f2ef", "#d9cbb6", "#5c7a52"],
    defaultMaterials: { wall: "mat_white_paint", floor: "mat_light_oak", upholstery: "mat_grey_fabric" },
  },
  {
    id: "luxury",
    label: "Luxury",
    aliases: ["럭셔리", "luxury", "고급"],
    promptFragment:
      "luxury style: marble and brass finishes, velvet and silk textiles, sculptural designer lighting, deep tonal accents",
    palette: ["#eceae6", "#b08d4e", "#3e3b39"],
    defaultMaterials: { wall: "mat_marble", floor: "mat_marble", upholstery: "mat_leather_brown" },
  },
  {
    id: "warm",
    label: "Warm",
    aliases: ["따뜻한", "warm", "웜"],
    promptFragment:
      "warm style: warm ivory and terracotta palette, soft diffused lighting, layered textiles, cozy atmosphere",
    palette: ["#efe4d3", "#bf6242", "#8d6a4f"],
    defaultMaterials: { wall: "mat_warm_ivory", floor: "mat_oak", upholstery: "mat_beige_fabric" },
  },
  {
    id: "industrial",
    label: "Industrial",
    aliases: ["인더스트리얼", "industrial"],
    promptFragment:
      "industrial style: exposed concrete and brick, black steel frames, vintage leather, exposed pipes and edison bulbs",
    palette: ["#b4b1ac", "#2f2d2b", "#6d4a33"],
    defaultMaterials: { wall: "mat_concrete", floor: "mat_concrete", upholstery: "mat_leather_brown" },
  },
  {
    id: "natural",
    label: "Natural",
    aliases: ["내추럴", "natural", "자연"],
    promptFragment:
      "natural style: unfinished oak and ash wood, linen textiles, earthy neutral palette, natural material finishes",
    palette: ["#dcc19a", "#e7e0d3", "#8d8983"],
    defaultMaterials: { wall: "mat_soft_greige", floor: "mat_oak", upholstery: "mat_linen" },
  },
  {
    id: "contemporary",
    label: "Contemporary",
    aliases: ["컨템포러리", "contemporary"],
    promptFragment:
      "contemporary style: current design language, mixed materials, sculptural furniture, balanced neutral base with one bold accent",
    palette: ["#ded7cd", "#31415c", "#c0803a"],
    defaultMaterials: { wall: "mat_soft_greige", floor: "mat_walnut", upholstery: "mat_grey_fabric" },
  },
];

export const STYLE_PRESET_MAP: Record<string, StylePreset> = Object.fromEntries(
  STYLE_PRESETS.map((s) => [s.id, s])
);

export function findStyleByText(text: string): StylePreset | undefined {
  const normalized = text.toLowerCase();
  return STYLE_PRESETS.find((style) =>
    [style.id, style.label.toLowerCase(), ...style.aliases].some((alias) =>
      normalized.includes(alias.toLowerCase())
    )
  );
}
