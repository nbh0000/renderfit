import { z } from "zod";

/**
 * FloorPlanDoc — 모든 입력이 수렴하는 하나의 도면 문서.
 *
 * ── 왜 이 스키마가 필요한가 ──
 *
 * 지금까지는 도면 이미지를 비전 모델에 넣어 JSON 을 통째로 받았다. 그 결과가 늘 같은
 * 방식으로 무너졌다 — 방이 빠지고, 면적이 뒤바뀌고, 벽이 끊기고, 설비가 사라졌다.
 * 비전 LLM 은 기하를 **측정하지 못하고 추측한다.** 그 구조를 버린다.
 *
 * 새 원칙은 셋이다.
 *
 *  1. 기하(벽·문·창·방 폴리곤)는 LLM 이 좌표를 만들지 않는다. DXF 파서나 전용 벡터화
 *     모델만 만든다.
 *  2. LLM 은 **이미 확정된 기하 위에** 의미(방 이름, 설비 종류)만 붙인다.
 *  3. 모든 입력이 이 문서 하나로 수렴한다. 편집기와 3D 는 이 스키마만 본다.
 *
 * ── 좌표 약속 ──
 *
 * 단위는 전부 **mm**. 좌표계는 오른손 — x 는 오른쪽, y 는 **위쪽**이 커진다.
 * 원점은 도면 외곽의 **좌하단**이다. 화면 좌표(y 가 아래로 커짐)와 반대이므로,
 * 그리는 쪽에서 뒤집어야지 여기 담을 때 뒤집으면 안 된다.
 *
 * ── 신뢰도 ──
 *
 * 거의 모든 항목이 confidence 를 들고 다닌다. 자동으로 만든 결과는 **절대 확정하지
 * 않기** 때문이다(review.status). 검수 화면이 이 값을 보고 무엇부터 사람 눈에
 * 보여 줄지 정한다.
 */

/** 평면 위의 한 점 (mm) */
export const PointSchema = z.tuple([z.number(), z.number()]);

/** 0~1 신뢰도 */
const Confidence = z.number().min(0).max(1);

/**
 * 벽 한 장.
 *
 * 두께를 가진 선분이다. 폴리곤이 아니라 중심선으로 담는다 — 개구부가 "이 벽의 몇 mm
 * 지점" 으로 붙기 때문이고, 그래야 벽을 옮겨도 문이 따라온다.
 */
export const WallSchema = z.object({
  id: z.string(),
  a: PointSchema,
  b: PointSchema,
  /** mm */
  thickness: z.number(),
  confidence: Confidence,
});

/**
 * 문·창.
 *
 * 자기 좌표를 갖지 않는다. **어느 벽의 시작점에서 몇 mm** 인지로만 적는다.
 * 좌표로 담으면 벽과 따로 놀아 벽을 옮겼을 때 문이 허공에 남는다.
 */
export const OpeningSchema = z.object({
  id: z.string(),
  wallId: z.string(),
  kind: z.enum(["door", "window"]),
  /** 벽 a 에서 개구부 시작까지 (mm) */
  offset: z.number(),
  /** mm */
  width: z.number(),
  /** 여닫이 방향. 미닫이·창에는 없다 */
  swing: z.enum(["in", "out"]).optional(),
  confidence: Confidence,
});

/**
 * 실(방).
 *
 * 이름과 이름 신뢰도를 따로 둔다. 기하는 파서가 확정하고 이름은 LLM 이 붙이므로,
 * "폴리곤은 확실한데 이름은 반신반의" 인 상태가 정상이다. 하나의 confidence 로
 * 뭉뚱그리면 검수 화면이 무엇을 물어야 할지 알 수 없다.
 */
export const RoomSchema = z.object({
  id: z.string(),
  polygon: z.array(PointSchema),
  name: z.string().optional(),
  nameConfidence: Confidence,
  /** mm² */
  areaMm2: z.number(),
});

/** 설비·가구 한 점 */
export const FixtureSchema = z.object({
  id: z.string(),
  /** 종류. 파서가 읽은 블록 이름일 수도, LLM 이 붙인 말일 수도 있다 */
  kind: z.string(),
  label: z.string().optional(),
  /** [x, y, w, h] — (x, y) 는 **좌하단** 모서리다 (y 가 위로 커지므로) */
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  /** 도(degree), 반시계 */
  rotation: z.number(),
  /** 어디서 왔는가 — 검수 화면이 이 값으로 믿을 만한 정도를 가른다 */
  source: z.enum(["dxf-block", "ocr-label", "user"]),
  confidence: Confidence,
});

/** 도면 위의 글자 (치수·이름표 등) */
export const AnnotationSchema = z.object({
  text: z.string(),
  position: PointSchema,
  kind: z.enum(["dimension", "label", "other"]),
});

/**
 * 검수 상태.
 *
 * 자동으로 만든 결과는 **절대 확정하지 않는다.** status 가 "auto" 인 문서는 사람이
 * 한 번 본 적이 없다는 뜻이고, 그 상태로 도면을 내보내거나 견적을 뽑으면 안 된다.
 * flags 는 검수 화면이 짚어 줄 자리다.
 */
export const ReviewSchema = z.object({
  status: z.enum(["auto", "reviewed", "confirmed"]),
  flags: z.array(
    z.object({
      /** 무엇에 대한 지적인가 — 보통 wall/room/opening/fixture 의 id */
      target: z.string(),
      reason: z.string(),
    })
  ),
});

/**
 * 축척.
 *
 * mmPerUnit 은 "원본 도면의 1단위가 실제 몇 mm 인가" 다. DXF 는 헤더의 단위에서
 * 확실하게 나오고(confidence 1), 래스터는 치수선을 읽어 짐작해야 한다(낮은 confidence).
 * 여기가 틀리면 3m 짜리 방이 30m 가 되므로 출처를 반드시 남긴다.
 */
export const ScaleSchema = z.object({
  mmPerUnit: z.number(),
  confidence: Confidence,
  source: z.enum(["dxf-units", "dimension-ocr", "user"]),
});

/** 도면 외곽 크기 (mm) */
export const BoundsSchema = z.object({
  w: z.number(),
  h: z.number(),
});

/** 어느 경로로 들어온 도면인가 */
export const SourceTypeSchema = z.enum(["cad", "cad-pdf", "raster"]);

/**
 * 원본 그림을 도면 위에 겹쳐 놓기 위한 값.
 *
 * 검수 화면은 사용자가 올린 그림을 반투명으로 깔고 그 위에 우리가 읽은 기하를 그린다.
 * 그러려면 **그림의 픽셀과 도면의 mm 가 어떻게 맞물리는지** 를 알아야 하는데, 그것을
 * 아는 곳은 배율을 정한 파서뿐이다. 여기 담지 않으면 검수 화면이 다시 짐작해야 하고,
 * 겹쳐 놓은 그림이 어긋나면 사람이 무엇을 고쳐야 할지 알 수 없다.
 *
 * 래스터 경로에만 있다. DXF 는 겹쳐 놓을 그림이 없다.
 */
export const UnderlaySchema = z.object({
  /** 원본 이미지 1픽셀이 몇 mm 인가 */
  mmPerPixel: z.number(),
  /** 도면 원점(좌하단)이 원본 이미지의 어느 픽셀인가 — 이미지 좌표라 y 는 아래로 커진다 */
  originPx: PointSchema,
});

export const FloorPlanDocSchema = z.object({
  id: z.string(),
  sourceType: SourceTypeSchema,
  scale: ScaleSchema,
  bounds: BoundsSchema,
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  fixtures: z.array(FixtureSchema),
  annotations: z.array(AnnotationSchema),
  review: ReviewSchema,
  /** 원본 그림을 겹쳐 놓기 위한 값. 래스터 경로에만 있다 */
  underlay: UnderlaySchema.optional(),
});

export type Point = z.infer<typeof PointSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type Fixture = z.infer<typeof FixtureSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Scale = z.infer<typeof ScaleSchema>;
export type Bounds = z.infer<typeof BoundsSchema>;
export type SourceType = z.infer<typeof SourceTypeSchema>;
export type Underlay = z.infer<typeof UnderlaySchema>;
export type FloorPlanDoc = z.infer<typeof FloorPlanDocSchema>;

/** 문서가 스키마에 맞는지 본다. 맞지 않으면 왜 틀렸는지 함께 돌려준다 */
export function parseFloorPlanDoc(
  value: unknown
): { ok: true; doc: FloorPlanDoc } | { ok: false; error: string } {
  const result = FloorPlanDocSchema.safeParse(value);
  if (result.success) return { ok: true, doc: result.data };

  const first = result.error.issues[0];
  return {
    ok: false,
    error: first ? `${first.path.join(".")}: ${first.message}` : "형식이 올바르지 않습니다.",
  };
}
