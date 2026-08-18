export type RoomId =
  | "living-room"
  | "bedroom"
  | "studio"
  | "kitchen"
  | "kids-room"
  | "home-office"
  | "bathroom"
  | "entrance"
  | "balcony"
  | "dressing-room"
  | "cafe"
  | "retail";

export interface Room {
  id: RoomId;
  label: string;
  /** 프롬프트에 삽입되는 공간 설명. 한국 주거 맥락을 담는다. */
  promptFragment: string;
  /** SEO 갤러리 slug 조각 (Phase 5에서 사용) */
  slug: string;
}

export const ROOMS: Room[] = [
  {
    id: "living-room",
    label: "아파트 거실",
    promptFragment: "한국 아파트의 거실. 발코니 확장형 통창과 우물천장이 있는 직사각형 평면.",
    slug: "아파트-거실",
  },
  {
    id: "bedroom",
    label: "침실",
    promptFragment: "한국 아파트의 안방 침실. 붙박이장과 단창이 있는 아늑한 크기의 방.",
    slug: "침실",
  },
  {
    id: "studio",
    label: "원룸(스튜디오)",
    promptFragment: "취침, 식사, 작업 구역이 한 공간에 있는 한국식 원룸.",
    slug: "원룸",
  },
  {
    id: "kitchen",
    label: "주방",
    promptFragment: "한국 아파트의 주방. 일자형 또는 ㄱ자형 상·하부장과 아일랜드 혹은 식탁 공간.",
    slug: "주방",
  },
  {
    id: "kids-room",
    label: "아이방",
    promptFragment: "어린이용 가구와 놀이·학습 공간이 함께 있는 아이방.",
    slug: "아이방",
  },
  {
    id: "home-office",
    label: "서재/홈오피스",
    promptFragment: "책상, 책장, 작업 조명이 있는 서재 겸 홈오피스.",
    slug: "서재",
  },
  {
    id: "bathroom",
    label: "욕실",
    promptFragment: "한국 아파트의 욕실. 건식 세면대, 변기, 샤워부스 또는 욕조가 있는 소형 공간.",
    slug: "욕실",
  },
  {
    id: "entrance",
    label: "현관",
    promptFragment: "신발장과 중문이 있는 한국 아파트의 현관.",
    slug: "현관",
  },
  {
    id: "balcony",
    label: "베란다/발코니",
    promptFragment: "세탁 공간 또는 홈카페로 쓰이는 한국 아파트의 발코니.",
    slug: "베란다",
  },
  {
    id: "dressing-room",
    label: "드레스룸",
    promptFragment: "시스템 행거와 서랍장이 있는 드레스룸.",
    slug: "드레스룸",
  },
  {
    id: "cafe",
    label: "상업공간(카페)",
    promptFragment: "바 카운터, 좌석, 메뉴 사인이 있는 소규모 카페 인테리어.",
    slug: "카페",
  },
  {
    id: "retail",
    label: "상업공간(매장)",
    promptFragment: "진열 집기와 계산대가 있는 소규모 리테일 매장 인테리어.",
    slug: "매장",
  },
];

export const ROOM_MAP: Record<RoomId, Room> = Object.fromEntries(
  ROOMS.map((r) => [r.id, r])
) as Record<RoomId, Room>;

export function getRoom(id: string): Room | undefined {
  return ROOM_MAP[id as RoomId];
}
