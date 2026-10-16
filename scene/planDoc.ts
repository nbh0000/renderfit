import type { FloorPlanDoc, Fixture, Opening, SourceType, Wall } from "@renderfit/plan-schema";
import type { Annotation, RoomArea, Scene, SceneObject, WallSegment } from "@/scene/types";
import { ensureRoom, polygonArea } from "@/scene/geometry";
import { planCenter } from "@/scene/placement";
import { createSceneObject } from "@/scene/engine/SceneEngine";

/**
 * 편집기의 Scene ↔ FloorPlanDoc.
 *
 * ── 왜 어댑터인가 ──
 *
 * 편집기와 3D 는 Scene 을 본다. 그 코드는 이미 잘 돌고 있으므로 건드리지 않는다.
 * 새로 들어오는 도면(DXF·PDF·래스터)은 전부 FloorPlanDoc 으로 수렴하므로, 둘 사이를
 * 오가는 통로만 만든다.
 *
 * ── 되돌려도 화면이 같아야 한다 ──
 *
 * FloorPlanDoc 은 **기하와 의미만** 담는다. Scene 에는 그 밖에도 화면을 만드는 값이
 * 잔뜩 있다 — 개구부 높이·창대높이, 벽 높이, 재질, 조명, 카메라, 가구의 3D 변환.
 * 문서에 그것들을 욱여넣으면 스키마가 Scene 의 복사본이 되고, 그러면 어댑터를 둘
 * 이유가 없어진다.
 *
 * 그래서 되돌릴 때 **원본 Scene 을 바탕으로 깔고** 문서가 담은 것만 얹는다.
 * `toScene(doc, base)` 의 base 가 그 바탕이다. 문서에 없는 값은 base 에서 그대로
 * 온다 — 그래서 갔다 오면 화면이 같다.
 *
 * ── 좌표 ──
 *
 * Scene 의 평면 좌표는 이미 mm 이고, x 오른쪽·y 위쪽, 원점은 좌하단이다.
 * FloorPlanDoc 의 약속과 같으므로 **변환하지 않는다.** 여기서 뒤집으면 두 좌표계가
 * 생기고, 그 순간부터 어느 쪽이 맞는지 아무도 모르게 된다.
 */

/** 자동으로 만든 것이 아니라 이미 사람이 만지던 장면이라 확실하다고 본다 */
const CERTAIN = 1;

export interface ToDocOptions {
  /** 어느 경로로 들어온 도면인가. 기존 Scene 은 그림에서 온 것이라 raster 가 기본이다 */
  sourceType?: SourceType;
  /** 검수 상태. 기존 Scene 은 사람이 편집기에서 만지던 것이므로 confirmed 가 기본이다 */
  review?: FloorPlanDoc["review"];
  scale?: FloorPlanDoc["scale"];
}

/** Scene 개구부 종류 → 문서 종류. 문서는 문과 창 둘만 안다 */
function openingKind(type: string): Opening["kind"] {
  return type === "window" ? "window" : "door";
}

function toDocWall(wall: WallSegment): Wall {
  return {
    id: wall.id,
    a: [wall.start[0], wall.start[1]],
    b: [wall.end[0], wall.end[1]],
    thickness: wall.thickness,
    confidence: CERTAIN,
  };
}

function toDocOpenings(wall: WallSegment): Opening[] {
  return (wall.openings ?? []).map((opening) => ({
    id: opening.id,
    wallId: wall.id,
    kind: openingKind(opening.type),
    offset: opening.offset,
    width: opening.width,
    ...(opening.swing === "in" || opening.swing === "out" ? { swing: opening.swing } : {}),
    confidence: CERTAIN,
  }));
}

function toDocRoom(area: RoomArea) {
  return {
    id: area.id,
    polygon: area.points.map(([x, y]) => [x, y] as [number, number]),
    ...(area.name ? { name: area.name } : {}),
    nameConfidence: CERTAIN,
    areaMm2: polygonArea(area.points),
  };
}

/**
 * 가구를 설비 항목으로 옮긴다.
 *
 * bbox 의 (x, y) 는 **좌하단** 모서리다. y 가 위로 커지는 좌표계에서 "왼쪽 위" 를
 * 쓰면 h 를 더할지 뺄지가 자리마다 갈린다.
 */
function toDocFixture(object: SceneObject, room: Scene["room"]): Fixture {
  const { cx, cy } = planCenter(object.screen, object.depth, room);
  const width = object.dimensions.width * object.transform.scale[0];
  const depth = object.dimensions.depth * object.transform.scale[2];

  return {
    id: object.id,
    kind: object.type,
    ...(object.name ? { label: object.name } : {}),
    bbox: [cx - width / 2, cy - depth / 2, width, depth],
    rotation: object.screen.rotation,
    source: "user",
    confidence: CERTAIN,
  };
}

/** Scene 주석 종류 → 문서 종류 */
function annotationKind(type: Annotation["type"]): "dimension" | "label" | "other" {
  if (type === "dimension") return "dimension";
  if (type === "text") return "label";
  return "other";
}

/** 편집기 Scene 을 문서로 옮긴다 */
export function toFloorPlanDoc(scene: Scene, options: ToDocOptions = {}): FloorPlanDoc {
  const room = ensureRoom(scene.room);
  const walls = room.walls ?? [];

  return {
    id: scene.sceneId,
    sourceType: options.sourceType ?? "raster",
    /*
     * Scene 의 좌표는 이미 mm 다. 그래서 1단위가 1mm 이고, 그 사실은 도면에서 읽어 낸
     * 것이 아니라 우리 약속이라 출처가 "user" 다.
     */
    scale: options.scale ?? { mmPerUnit: 1, confidence: CERTAIN, source: "user" },
    bounds: { w: room.dimensions.width, h: room.dimensions.length },
    walls: walls.map(toDocWall),
    openings: walls.flatMap(toDocOpenings),
    rooms: (room.areas ?? []).map(toDocRoom),
    fixtures: (scene.objects ?? [])
      /* 벽·바닥·천장은 기하지 설비가 아니다 */
      .filter((object) => !["wall", "floor", "ceiling"].includes(object.type))
      .map((object) => toDocFixture(object, room)),
    annotations: (room.annotations ?? [])
      .filter((annotation) => annotation.points.length > 0)
      .map((annotation) => ({
        text: annotation.text ?? "",
        position: [annotation.points[0][0], annotation.points[0][1]] as [number, number],
        kind: annotationKind(annotation.type),
      })),
    review: options.review ?? { status: "confirmed", flags: [] },
  };
}


/**
 * 블록 이름을 Scene 이 아는 종류로 옮긴다.
 *
 * DXF 블록 이름은 무엇이든 될 수 있다("DESK-1400", "WC-BASIN", "가구-01"). Scene 은
 * 정해진 종류만 알고, 종류에 따라 평면 기호와 3D 모양이 갈린다. 못 알아보는 것은
 * **custom** 으로 두고 이름을 살린다 — 억지로 가장 비슷한 것에 밀어 넣으면 도면에
 * 없는 소파가 생긴다.
 */
const FIXTURE_TYPES: [RegExp, SceneObject["type"]][] = [
  [/sofa|couch|소파/i, "sofa"],
  [/chair|stool|의자/i, "chair"],
  [/desk|table|식탁|책상|테이블/i, "table"],
  [/bed|침대/i, "bed"],
  [/cabinet|shelf|closet|wardrobe|장|수납/i, "cabinet"],
  [/lamp|light|조명|등/i, "lamp"],
  [/plant|tree|화분/i, "plant"],
  [/rug|carpet|러그/i, "rug"],
  [/tv|television/i, "tv"],
  [/fridge|washer|sink|basin|toilet|bath|wc|냉장고|세탁기|싱크|변기|세면|욕조/i, "appliance"],
];

function fixtureType(kind: string, label?: string): SceneObject["type"] {
  const text = `${kind} ${label ?? ""}`;
  for (const [pattern, type] of FIXTURE_TYPES) {
    if (pattern.test(text)) return type;
  }
  return "custom";
}

/**
 * 도면에서 알 수 없는 높이 (mm).
 *
 * 평면도는 위에서 내려다본 그림이라 높이가 없다. 종류별로 흔한 값을 쓰되, 이것은
 * **도면에서 읽은 값이 아니라 우리가 채운 값**이다. 3D 를 세우려면 있어야 한다.
 */
const FIXTURE_HEIGHT: Partial<Record<SceneObject["type"], number>> = {
  sofa: 800,
  chair: 850,
  table: 750,
  bed: 500,
  cabinet: 800,
  lamp: 1500,
  plant: 900,
  rug: 20,
  tv: 700,
  appliance: 900,
};

/**
 * 문서를 Scene 으로 되돌린다.
 *
 * base 는 바탕이다. 문서가 담지 않는 값(개구부 높이·창대높이, 벽 높이·이름, 재질,
 * 조명, 카메라, 가구의 3D 변환)은 전부 여기서 온다. 같은 id 를 찾아 그 위에 문서의
 * 기하만 얹으므로, 갔다 온 Scene 은 화면이 원래와 같다.
 *
 * 문서에만 있고 base 에 없는 것(새로 들여온 도면)은 여기서 만든다. 문서가 모르는
 * 값(높이·재질)은 종류별 기본값으로 채우되, 그것이 **도면에서 읽은 값이 아니라는
 * 사실**은 남는다 — 설비의 confidence 와 review.flags 가 그 자리다.
 */
export function toScene(doc: FloorPlanDoc, base: Scene): Scene {
  const room = ensureRoom(base.room);
  const baseWalls = new Map((room.walls ?? []).map((wall) => [wall.id, wall]));
  const baseAreas = new Map((room.areas ?? []).map((area) => [area.id, area]));

  /** 개구부는 벽을 건너 옮겨 다닐 수 있으므로 벽과 상관없이 id 로 찾는다 */
  const baseOpenings = new Map(
    (room.walls ?? []).flatMap((wall) => (wall.openings ?? []).map((item) => [item.id, item]))
  );

  const openingsByWall = new Map<string, typeof doc.openings>();
  for (const opening of doc.openings) {
    const list = openingsByWall.get(opening.wallId);
    if (list) list.push(opening);
    else openingsByWall.set(opening.wallId, [opening]);
  }

  const walls: WallSegment[] = doc.walls.map((wall) => {
    const previous = baseWalls.get(wall.id);

    return {
      /* 문서가 모르는 값은 바탕에서 온다 */
      ...(previous ?? {
        id: wall.id,
        name: "벽",
        height: room.dimensions.height,
        openings: [],
      }),
      id: wall.id,
      start: [wall.a[0], wall.a[1]],
      end: [wall.b[0], wall.b[1]],
      thickness: wall.thickness,
      openings: (openingsByWall.get(wall.id) ?? []).map((opening) => {
        const before = baseOpenings.get(opening.id);

        return {
          ...(before ?? {
            id: opening.id,
            name: opening.kind === "window" ? "창" : "문",
            height: opening.kind === "window" ? 1200 : 2100,
            sillHeight: opening.kind === "window" ? 900 : 0,
          }),
          id: opening.id,
          type: opening.kind,
          offset: opening.offset,
          width: opening.width,
          ...(opening.swing ? { swing: opening.swing } : {}),
        };
      }),
    };
  });

  const areas: RoomArea[] = doc.rooms.map((item) => {
    const previous = baseAreas.get(item.id);

    return {
      ...(previous ?? { id: item.id, name: item.name ?? "실", points: [] }),
      id: item.id,
      name: item.name ?? previous?.name ?? "실",
      points: item.polygon.map(([x, y]) => [x, y] as [number, number]),
    };
  });

  /*
   * 가구는 바탕에 있는 것만 자리를 고쳐 돌려놓는다.
   *
   * 문서의 설비 항목은 자리와 종류만 안다. 재질·치수·3D 변환·표시 여부는 Scene 의
   * 값이라 그대로 두어야 화면이 같다.
   */
  const placed = new Map(doc.fixtures.map((fixture) => [fixture.id, fixture]));

  /*
   * 문서에만 있는 설비를 새로 세운다.
   *
   * DXF 블록은 전부 여기로 들어온다. 안 만들면 도면에 그려져 있던 책상·위생기구가
   * 편집기에서 통째로 사라지고, 사용자는 파서가 못 읽은 것인지 우리가 버린 것인지
   * 알 수 없다.
   */
  const known = new Set((base.objects ?? []).map((object) => object.id));
  const roomWidthMm = doc.bounds.w || room.dimensions.width;
  const roomLengthMm = doc.bounds.h || room.dimensions.length;

  const added: SceneObject[] = doc.fixtures
    .filter((fixture) => !known.has(fixture.id))
    .map((fixture, index) => {
      const [x, y, w, h] = fixture.bbox;
      const type = fixtureType(fixture.kind, fixture.label);
      const height = FIXTURE_HEIGHT[type] ?? 800;

      return createSceneObject(
        {
          id: fixture.id,
          type,
          name: fixture.label ?? fixture.kind,
          category: type,
          dimensions: { width: w, height, depth: h },
          screen: {
            x: roomWidthMm > 0 ? x / roomWidthMm : 0,
            y: 0.5,
            width: roomWidthMm > 0 ? w / roomWidthMm : 0.1,
            height: 0.2,
            rotation: fixture.rotation,
          },
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          depth: roomLengthMm > 0 ? (y + h / 2) / roomLengthMm : 0.5,
          confidence: fixture.confidence,
          source: "vision_model",
          mask: null,
          metadata: { fixtureKind: fixture.kind, fixtureSource: fixture.source },
        },
        (base.objects ?? []).length + index
      );
    });

  /*
   * 지난번에 들여온 설비는 걷어낸다.
   *
   * 도면을 다시 들여오면 설비 id 가 새로 붙는다. 그대로 두면 예전 것과 새 것이 함께
   * 남아, 같은 침대가 두 개씩 쌓인다. 사용자가 손으로 놓은 가구는 건드리지 않는다 —
   * 걷어내는 것은 **도면에서 온 것**(metadata.fixtureSource)뿐이다.
   */
  const objects = (base.objects ?? [])
    .filter(
      (object) =>
        placed.has(object.id) || object.metadata?.fixtureSource === undefined
    )
    .map((object) => {
      const fixture = placed.get(object.id);
      if (!fixture) return object;

      const cx = fixture.bbox[0] + fixture.bbox[2] / 2;
      const cy = fixture.bbox[1] + fixture.bbox[3] / 2;

      const roomWidth = doc.bounds.w || room.dimensions.width;
      const roomLength = doc.bounds.h || room.dimensions.length;

      /*
       * planCenter 를 거꾸로 푼다.
       *
       *   cx = (screen.x + screen.width / 2) × 방 폭
       *
       * 여기서 screen.width 는 **방 폭 대비 비율**이지 물체의 mm 폭이 아니다.
       * 물체의 mm 폭(dimensions × scale)으로 풀면 큰 방일수록 자리가 밀린다.
       */
      return {
        ...object,
        screen: {
          ...object.screen,
          x: roomWidth > 0 ? cx / roomWidth - object.screen.width / 2 : object.screen.x,
          rotation: fixture.rotation,
        },
        depth: roomLength > 0 ? cy / roomLength : object.depth,
      };
    });

  return {
    ...base,
    room: {
      ...room,
      dimensions: { ...room.dimensions, width: doc.bounds.w, length: doc.bounds.h },
      walls,
      areas,
    },
    objects: [...objects, ...added],
  };
}
