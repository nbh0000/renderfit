import Link from "next/link";

/** 띠에 태울 만큼만 추린 갤러리 항목 */
export interface GalleryMarqueeItem {
  slug: string;
  imageUrl: string;
  roomLabel: string;
  styleLabel: string;
  /** 어떤 결의 디자인인지 한 줄로 (styleBlurb) */
  blurb: string;
  authorName: string;
  viewCount: number;
  likeCount: number;
  width: number;
  height: number;
}

/**
 * 열마다 속도와 시작 높이를 조금씩 다르게 준다.
 *
 * 셋이 똑같이 흐르면 표처럼 보이고, 너무 다르게 흐르면 눈이 어디를 봐야 할지 모른다.
 * 처음에는 속도를 0.88~1.22로 벌리고 카드까지 좌우로 번갈아 붙였는데, 그러니 사진이
 * 제각기 튀어 "멋대로"라는 말을 들었다. 어긋남은 시작 높이로만 주고 속도 차이는
 * 눈치채지 못할 만큼만 남긴다.
 */
const COLUMNS = [
  { speedFactor: 1, headOffset: "0px" },
  { speedFactor: 1.08, headOffset: "4.5rem" },
  { speedFactor: 0.94, headOffset: "9rem" },
];

/**
 * 열 하나가 너무 짧으면 한 바퀴가 금방 돌아 버린다 — 최소 이만큼은 채운다.
 *
 * 다만 목록을 되풀이해 채우는 것은 시안이 정말 모자랄 때뿐이다. 되풀이하면 같은
 * 사진이 한 화면에 두 번 보일 수 있기 때문이다.
 */
const MIN_CARDS = 3;

/** 카드 한 장이 지나가는 데 걸리는 시간(초). 읽을 수 있을 만큼 느리게. */
const SECONDS_PER_CARD = 7.5;

/**
 * 세로로 지나치게 길거나 납작한 사진이 열의 리듬을 깨지 않도록 비율을 가둔다.
 *
 * 인테리어 사진은 거의 다 가로가 길다(4:3, 3:2). 그 사이에 세로 사진 한 장이 끼면
 * 열 하나만 쑥 길어져 흐름이 끊긴다. 그래서 3:2보다 넓지도, 정사각보다 좁지도 않게
 * 가둔다 — 사진마다 높이가 조금씩 다른 정도가 보기 좋고, 그 이상은 산만하다.
 */
function cardRatio(width: number, height: number): number {
  if (!width || !height) return 4 / 3;
  return Math.min(1.5, Math.max(1, width / height));
}

function Card({
  item,
  duplicate,
}: {
  item: GalleryMarqueeItem;
  /** 이음매용 사본 — 링크가 두 벌 생기므로 보조기술과 탭 이동에서는 감춘다 */
  duplicate: boolean;
}) {
  return (
    // 열 너비를 그대로 채운다. 좌우로 번갈아 붙이면 세로선이 사라져 어수선해진다.
    <div className="w-full pb-3 sm:pb-4" aria-hidden={duplicate || undefined}>
      <Link
        href={`/gallery/${encodeURIComponent(item.slug)}`}
        tabIndex={duplicate ? -1 : undefined}
        className="group/card relative block overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken shadow-[0_10px_30px_rgba(27,28,29,0.06)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt={`${item.roomLabel} ${item.styleLabel} 인테리어 시안`}
          loading="lazy"
          decoding="async"
          style={{ aspectRatio: cardRatio(item.width, item.height) }}
          className="w-full object-cover"
        />

        {/* 올려 두는 동안만 어떤 디자인인지, 누가 올려 몇 번 봤는지 알려 준다 */}
        <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-ink/92 via-ink/45 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-visible/card:opacity-100">
          <p className="text-[12.5px] font-medium text-white">
            {item.roomLabel} · {item.styleLabel}
          </p>
          <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-white/75">
            {item.blurb}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/65">
            <span className="truncate">@{item.authorName}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">조회 {item.viewCount.toLocaleString("ko-KR")}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0">♥ {item.likeCount.toLocaleString("ko-KR")}</span>
          </p>
        </div>
      </Link>
    </div>
  );
}

function Column({
  cards,
  speedFactor,
  headOffset,
}: {
  cards: GalleryMarqueeItem[];
  speedFactor: number;
  headOffset: string;
}) {
  const seconds = Math.round(Math.max(30, cards.length * SECONDS_PER_CARD) * speedFactor);

  return (
    <div className="min-w-0" style={{ paddingTop: headOffset }}>
      <div
        className="marquee-track group-hover/marquee:[animation-play-state:paused] group-focus-within/marquee:[animation-play-state:paused]"
        style={{ "--marquee-duration": `${seconds}s` } as React.CSSProperties}
      >
        {/* 같은 목록 두 벌 — 위쪽 한 벌이 다 빠지는 순간 아래 벌이 같은 자리에 있다 */}
        {[0, 1].map((copy) => (
          <div key={copy}>
            {cards.map((item, index) => (
              <Card key={`${copy}-${index}-${item.slug}`} item={item} duplicate={copy === 1} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 세 열에 카드를 나눠 담는다.
 *
 * 한 벌의 카드를 카드패 돌리듯 세 열에 한 장씩 번갈아 준다. 그러면 어떤 사진도
 * 두 열에 동시에 들어가지 않는다 — 화면에 같은 거실이 두 번 보이는 일이 없다.
 *
 * 앞에서부터 잘라 열마다 몰아 주는 방식은 쓰지 않는다. 시안이 적을 때 열들이 같은
 * 사진으로 시작해서, 같은 거실이 나란히 세 번 걸린다.
 *
 * 시안이 열 수보다도 적어서 빈 열이 생길 때만 목록을 되풀이해 채운다. 그때는
 * 겹치는 것을 피할 방법이 없고(두 장을 세 열에 나눌 수는 없다), 대신 COLUMNS 의
 * 시작 높이 차이가 같은 사진을 다른 자리에 앉혀 준다.
 */
export function dealColumns(items: GalleryMarqueeItem[], columns: number): GalleryMarqueeItem[][] {
  const dealt: GalleryMarqueeItem[][] = Array.from({ length: columns }, () => []);
  items.forEach((item, index) => dealt[index % columns].push(item));

  return dealt.map((cards, column) => {
    if (cards.length > 0) {
      // 열이 짧으면 흐름이 금방 한 바퀴 돈다. 카드가 정말 모자랄 때만 되풀이한다.
      const filled = [...cards];
      while (filled.length < MIN_CARDS && items.length > 0) {
        filled.push(items[filled.length % items.length]);
      }
      return filled;
    }

    // 시안이 열 수보다 적어 빈 열이 생겼다 — 있는 것으로 채우되 시작을 어긋나게 둔다
    return items.map((_, index) => items[(index + column) % items.length]);
  });
}

/**
 * 메인에 얹는 갤러리 띠.
 *
 * 세 열이 아래에서 위로 흐른다. 시작 높이를 어긋나게 두어 바둑판처럼 보이지 않게
 * 하되, 카드 자체는 열 너비를 그대로 채운다 — 좌우로 번갈아 붙였더니 세로선이
 * 사라져 사진이 제각기 튀어 보였다. 마우스를 올리면 멈춘다.
 */
export function GalleryMarquee({ items }: { items: GalleryMarqueeItem[] }) {
  if (items.length === 0) return null;

  const dealt = dealColumns(items, COLUMNS.length);

  return (
    <div
      className="group/marquee relative h-[440px] overflow-hidden sm:h-[560px]"
      style={{
        maskImage: "linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)",
        WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 9%, #000 91%, transparent)",
      }}
    >
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {COLUMNS.map((column, index) => (
          <div key={index} className={index === 2 ? "hidden lg:block" : undefined}>
            <Column
              cards={dealt[index]}
              speedFactor={column.speedFactor}
              headOffset={column.headOffset}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
