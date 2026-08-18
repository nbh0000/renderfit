export type StyleId =
  | "modern"
  | "nordic"
  | "minimal"
  | "hotel"
  | "cafe"
  | "newlywed"
  | "midcentury"
  | "natural-wood"
  | "white-wood"
  | "industrial"
  | "french"
  | "zen"
  | "kids"
  | "classic"
  | "luxury"
  | "custom";

export interface Style {
  id: StyleId;
  label: string;
  /** 프롬프트에 병합되는 스타일 묘사 */
  promptFragment: string;
  /** 썸네일 (현재는 플레이스홀더 SVG 라우트) */
  thumbnail: string;
  /** 플레이스홀더 썸네일과 선택 UI에 쓰이는 대표 색 */
  tone: string;
  /** 참고 이미지 업로드가 필요한 스타일인지 */
  requiresReference?: boolean;
}

const thumb = (id: StyleId) => `/api/placeholder/style/${id}`;

export const STYLES: Style[] = [
  {
    id: "modern",
    label: "모던",
    promptFragment:
      "모던 스타일: 직선적인 가구, 무광 화이트와 차콜 그레이 위주의 절제된 팔레트, 장식 최소화, 간접 조명.",
    thumbnail: thumb("modern"),
    tone: "#8A8A87",
  },
  {
    id: "nordic",
    label: "북유럽",
    promptFragment:
      "북유럽 스칸디나비안 스타일: 밝은 자작나무·오크 원목, 화이트 벽, 라이트 그레이 패브릭, 니트와 린넨 텍스처, 그린 식물 포인트.",
    thumbnail: thumb("nordic"),
    tone: "#D9CBB6",
  },
  {
    id: "minimal",
    label: "미니멀",
    promptFragment:
      "미니멀 스타일: 필요한 가구만 남긴 여백 중심 구성, 톤온톤 뉴트럴 컬러, 손잡이 없는 매입형 수납, 소품 최소화.",
    thumbnail: thumb("minimal"),
    tone: "#EAE7E1",
  },
  {
    id: "hotel",
    label: "호텔식",
    promptFragment:
      "호텔식 스타일: 5성급 호텔 객실 같은 정돈감, 다크 월넛 우드와 딥 그레이 패브릭, 헤드보드와 간접 조명, 대칭 배치.",
    thumbnail: thumb("hotel"),
    tone: "#4E463E",
  },
  {
    id: "cafe",
    label: "카페풍",
    promptFragment:
      "카페풍 스타일: 원목 테이블과 빈티지 체어, 노출 조명, 라탄과 세라믹 소품, 따뜻한 주광 조명.",
    thumbnail: thumb("cafe"),
    tone: "#B08055",
  },
  {
    id: "newlywed",
    label: "신혼집",
    promptFragment:
      "신혼집 스타일: 밝고 화사한 화이트·아이보리 베이스, 부드러운 곡선 패브릭 소파, 파스텔 포인트 소품, 생활감 있는 정돈된 연출.",
    thumbnail: thumb("newlywed"),
    tone: "#EFD9D3",
  },
  {
    id: "midcentury",
    label: "미드센추리",
    promptFragment:
      "미드센추리 모던 스타일: 테이퍼드 원목 다리 가구, 머스터드·올리브·러스트 컬러, 기하학 패턴 러그, 1950-60년대 디자인 가구.",
    thumbnail: thumb("midcentury"),
    tone: "#C0803A",
  },
  {
    id: "natural-wood",
    label: "내추럴 우드",
    promptFragment:
      "내추럴 우드 스타일: 무절 오크와 애쉬 원목 가구, 리넨 패브릭, 흙빛 뉴트럴 팔레트, 자연 소재 위주 마감.",
    thumbnail: thumb("natural-wood"),
    tone: "#A9814F",
  },
  {
    id: "white-wood",
    label: "화이트&우드",
    promptFragment:
      "화이트앤우드 스타일: 화이트 벽·도장과 라이트 오크 우드의 2색 구성, 밝고 청량한 조도, 깔끔한 라인.",
    thumbnail: thumb("white-wood"),
    tone: "#E4D7C4",
  },
  {
    id: "industrial",
    label: "인더스트리얼",
    promptFragment:
      "인더스트리얼 스타일: 노출 콘크리트와 벽돌, 블랙 스틸 프레임, 빈티지 가죽 소파, 노출 배관과 에디슨 전구.",
    thumbnail: thumb("industrial"),
    tone: "#6B6560",
  },
  {
    id: "french",
    label: "프렌치",
    promptFragment:
      "프렌치 스타일: 몰딩 벽과 헤링본 마루, 아이보리·세이지 컬러, 곡선 프레임 가구, 크리스탈 또는 황동 조명.",
    thumbnail: thumb("french"),
    tone: "#CFCBB4",
  },
  {
    id: "zen",
    label: "젠(Zen)",
    promptFragment:
      "젠 스타일: 낮은 좌식 가구, 라이스페이퍼 조명, 스톤과 우드의 무채색 조합, 절제된 여백과 정적인 분위기.",
    thumbnail: thumb("zen"),
    tone: "#9A9384",
  },
  {
    id: "kids",
    label: "키즈",
    promptFragment:
      "키즈 스타일: 라운드 모서리의 낮은 가구, 부드러운 파스텔 컬러, 놀이 매트와 수납 바구니, 안전한 소재 위주.",
    thumbnail: thumb("kids"),
    tone: "#9EC6D6",
  },
  {
    id: "classic",
    label: "클래식",
    promptFragment:
      "클래식 스타일: 웨인스코팅 벽면, 다크 우드 가구, 벨벳 패브릭, 대칭 구성과 장식 몰딩.",
    thumbnail: thumb("classic"),
    tone: "#5B4638",
  },
  {
    id: "luxury",
    label: "럭셔리",
    promptFragment:
      "럭셔리 스타일: 대리석과 황동 마감, 벨벳·실크 패브릭, 조각적인 디자이너 조명, 깊이 있는 다크 톤 포인트.",
    thumbnail: thumb("luxury"),
    tone: "#3E3B39",
  },
  {
    id: "custom",
    label: "커스텀(참고 이미지)",
    promptFragment:
      "업로드된 참고 이미지의 컬러 팔레트, 마감재, 가구 형태, 분위기를 최대한 그대로 따른다.",
    thumbnail: thumb("custom"),
    tone: "#C0674A",
    requiresReference: true,
  },
];

export const STYLE_MAP: Record<StyleId, Style> = Object.fromEntries(
  STYLES.map((s) => [s.id, s])
) as Record<StyleId, Style>;

export function getStyle(id: string): Style | undefined {
  return STYLE_MAP[id as StyleId];
}
