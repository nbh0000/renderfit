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
 * 열마다 속도와 시작 높이를 다르게 준다.
 * 같은 속도로 나란히 흐르면 표처럼 보여서, 어긋나게 두어야 흐름이 살아난다.
 */
const COLUMNS = [
  { speedFactor: 1, headOffset: "0px" },
  { speedFactor: 1.22, headOffset: "3.5rem" },
  { speedFactor: 0.88, headOffset: "1.5rem" },
];

/** 열 하나가 너무 짧으면 한 바퀴가 금방 돌아 버린다 — 최소 이만큼은 채운다 */
const MIN_CARDS = 9;

/** 카드 한 장이 지나가는 데 걸리는 시간(초). 읽을 수 있을 만큼 느리게. */
const SECONDS_PER_CARD = 7.5;

/** 세로로 지나치게 길거나 납작한 사진이 열의 리듬을 깨지 않도록 비율을 가둔다 */
function cardRatio(width: number, height: number): number {
  if (!width || !height) return 4 / 3;
  return Math.min(1.45, Math.max(0.68, width / height));
}

function Card({
  item,
  index,
  duplicate,
}: {
  item: GalleryMarqueeItem;
  index: number;
  /** 이음매용 사본 — 링크가 두 벌 생기므로 보조기술과 탭 이동에서는 감춘다 */
  duplicate: boolean;
}) {
  return (
    <div
      className={`w-[88%] pb-3 sm:pb-4 ${index % 2 === 0 ? "mr-auto" : "ml-auto"}`}
      aria-hidden={duplicate || undefined}
    >
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
              <Card
                key={`${copy}-${index}-${item.slug}`}
                item={item}
                index={index}
                duplicate={copy === 1}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 메인에 얹는 갤러리 띠.
 *
 * 바둑판 대신 열을 어긋나게 세우고 카드를 좌우로 번갈아 붙여 지그재그를 만든다.
 * 세 열이 저마다 다른 속도로 아래에서 위로 흐르고, 마우스를 올리면 멈춘다.
 */
export function GalleryMarquee({ items }: { items: GalleryMarqueeItem[] }) {
  if (items.length === 0) return null;

  const filled = [...items];
  while (filled.length < MIN_CARDS) filled.push(...items);

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
              cards={filled.filter((_, i) => i % COLUMNS.length === index)}
              speedFactor={column.speedFactor}
              headOffset={column.headOffset}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
