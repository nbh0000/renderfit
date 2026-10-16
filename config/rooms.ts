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
  /**
   * 프롬프트에 삽입되는 공간 설명 — **용도만 적는다.**
   *
   * 생김새(창, 천장, 평면 형태, 붙박이)를 여기에 적으면 안 된다. 예전에는
   * "발코니 확장형 통창과 우물천장이 있는 직사각형 평면" 처럼 적어 두었는데,
   * 같은 프롬프트에 든 구조 보존 지시와 정면으로 부딪혔다. 모델은 "바꾸지 마라"
   * 보다 "이렇게 생겼다" 를 따르기 때문에, 업소용 주방 사진을 넣어도 통창과
   * 우물천장이 있는 아파트 거실이 나왔다.
   *
   * 공간의 생김새는 오직 입력 사진에서 온다.
   */
  promptFragment: string;
  /** SEO 갤러리 slug 조각 (Phase 5에서 사용) */
  slug: string;
}

export const ROOMS: Room[] = [
  {
    id: "living-room",
    label: "아파트 거실",
    promptFragment: "가족이 모여 쉬고 손님을 맞는 거실.",
    slug: "아파트-거실",
  },
  {
    id: "bedroom",
    label: "침실",
    promptFragment: "잠자고 쉬는 침실.",
    slug: "침실",
  },
  {
    id: "studio",
    label: "원룸(스튜디오)",
    promptFragment: "취침·식사·작업이 한 공간에서 이루어지는 원룸.",
    slug: "원룸",
  },
  {
    id: "kitchen",
    label: "주방",
    promptFragment: "조리와 설거지, 식사 준비가 이루어지는 주방.",
    slug: "주방",
  },
  {
    id: "kids-room",
    label: "아이방",
    promptFragment: "아이가 자고 놀고 공부하는 방.",
    slug: "아이방",
  },
  {
    id: "home-office",
    label: "서재/홈오피스",
    promptFragment: "일하고 공부하는 서재 겸 홈오피스.",
    slug: "서재",
  },
  {
    id: "bathroom",
    label: "욕실",
    promptFragment: "씻고 몸단장하는 욕실.",
    slug: "욕실",
  },
  {
    id: "entrance",
    label: "현관",
    promptFragment: "드나들며 신발을 신고 벗는 현관.",
    slug: "현관",
  },
  {
    id: "balcony",
    label: "베란다/발코니",
    promptFragment: "빨래·수납·휴식에 쓰이는 베란다/발코니.",
    slug: "베란다",
  },
  {
    id: "dressing-room",
    label: "드레스룸",
    promptFragment: "옷과 잡화를 보관하고 갈아입는 드레스룸.",
    slug: "드레스룸",
  },
  {
    id: "cafe",
    label: "상업공간(카페)",
    promptFragment: "손님이 머무르며 음료를 마시는 소규모 카페.",
    slug: "카페",
  },
  {
    id: "retail",
    label: "상업공간(매장)",
    promptFragment: "상품을 진열해 파는 소규모 리테일 매장.",
    slug: "매장",
  },
];

export const ROOM_MAP: Record<RoomId, Room> = Object.fromEntries(
  ROOMS.map((r) => [r.id, r])
) as Record<RoomId, Room>;

export function getRoom(id: string): Room | undefined {
  return ROOM_MAP[id as RoomId];
}
