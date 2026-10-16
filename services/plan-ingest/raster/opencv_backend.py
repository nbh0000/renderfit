"""OpenCV 벡터화 백엔드 — 외부 서비스 없이 도면 그림에서 기하를 잰다.

── 왜 직접 만드나 ──

래스터 경로는 벡터화 백엔드가 하나도 없어 501 만 내고 있었다. 붙어 있던 상용 API
어댑터는 실제 서비스의 주소·인증·응답 모양과 맞지 않아 키를 넣어도 동작하지 않는다.
그래서 **의존성 없이 우리가 통제할 수 있는 백엔드**를 기본으로 둔다. opencv 는 이미
전처리가 쓰고 있으므로 새로 까는 것이 없고, 호출 비용도 0 이며, 결과가 나쁘면 우리가
고칠 수 있다.

── 무엇을 노리나 ──

사용자가 올리는 그림의 대부분은 **CAD 에서 내보낸 깨끗한 평면도**다. 이런 도면에서
벽은 다른 선보다 굵고, 방은 그 벽으로 둘러싸인 흰 영역이며, 개구부는 벽선이 끊긴
자리다. 전부 픽셀에서 **잴 수 있는** 것들이다. 짐작이 들어가는 곳은 없다.

손그림·기울어진 사진처럼 이 전제가 깨지는 그림은 잘 못 읽는다. 그때는 조용히 그럴싸한
답을 내는 대신 신뢰도를 낮춰 전부 검수로 올린다 — 사양이 정한 0.6 미만이면 벽 하나하나가
지적으로 올라간다.

── 세 가지를 지킨다 ──

* **없는 것을 만들지 않는다.** 벽 두께는 잰 값이고, 개구부 폭은 끊긴 자리의 길이이며,
  방 면적은 폴리곤에서 나온다. 표준 규격으로 되돌리거나 반올림하지 않는다.
* **못 읽은 것을 읽은 척하지 않는다.** 확신이 없는 것은 낮은 신뢰도로 올려 사람이 본다.
* **의미를 지어내지 않는다.** 개구부가 문인지 창인지는 여기서 정하지 않는다.
  자리와 폭만 재고 종류는 검수에서 사람이 고른다.

좌표는 **전처리한 그림의 픽셀**이다 (y 는 아래로 커진다). mm 로 바꾸는 일은
scale_anchor.py 와 pipeline.py 가 한다 — 여기서 섞으면 어느 좌표계인지 알 수 없게 된다.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .vectorize import PixelOpening, PixelRoom, PixelWall, VectorizeResult

#: 벽으로 볼 최소 길이 — 그림 긴 변의 이 비율.
#:
#: 글자 획과 가구 기호를 걸러내는 값이다. 2000px 도면에서 80px, 즉 8m 도면이면
#: 30cm 남짓이다. 이보다 짧은 벽은 실제로도 거의 없다.
MIN_RUN_FRACTION = 0.04

#: 벽 길이의 하한 (픽셀). 아주 작은 그림에서 위 비율이 무의미해지는 것을 막는다.
MIN_RUN_PX = 24

#: 벽은 두께의 이 배수보다 길어야 한다.
#:
#: 길이만으로는 못 거르는 것이 있다. 닫힘으로 벽 속을 메울 때 **치수 글자도 함께
#: 뭉쳐** 덩어리가 되는데, "10,000" 같은 글자는 제법 길어서 길이 문턱을 넘는다.
#: 실제로 그 덩어리가 벽으로 서서 도면 외곽이 넓어졌고, 그 바람에 배율이 6% 어긋났다.
#:
#: 벽은 두께보다 훨씬 길다 — 3m 벽에 150mm 두께면 20배다. 글자 덩어리는 4배 언저리다.
#: 이 값이 크면 짧은 벽 토막을 잃고, 작으면 글자가 벽이 된다. 6 이면 1.2m 벽까지 남는다.
WALL_MIN_ASPECT = 6.0

#: 다른 벽에 닿지 않은 채 이 길이를 넘지 못하면 벽으로 보지 않는다 (긴 변의 비율).
#:
#: 길이와 두께만으로는 뭉쳐진 치수 글자를 못 가른다. "10,000" 처럼 여섯 자 짜리
#: 글자는 높이의 6~7배라, 짧은 벽을 살리려고 문턱을 낮추면 그대로 통과한다.
#:
#: 그래서 **구조**를 본다. 도면의 벽은 거의 언제나 다른 벽과 만난다 — 모서리에서,
#: T 자로. 치수 글자 덩어리는 혼자 떠 있다. 다만 혼자라고 무조건 버리지는 않는다.
#: 아일랜드 가벽처럼 정말 홀로 선 벽이 있고, 벽을 조용히 빠뜨리는 것이 가장 나쁘다.
#: 그런 벽은 대개 길다. 그래서 **혼자이면서 짧은 것**만 버린다.
ISOLATED_MAX_LENGTH_FRACTION = 0.25

#: 사선 벽은 이 배수를 넘어야 한다 — 가로·세로보다 엄하게 본다.
#:
#: 사선은 우리가 가진 단서가 가장 적은 곳이다. 뭉쳐진 글자 덩어리를 가로지르는 선은
#: 길이 대 두께가 6배 언저리까지 나와서 같은 문턱으로는 걸러지지 않는다. 실제로
#: 치수 글자 "6,000" 을 가로지르는 사선이 벽으로 서서 도면 왼쪽 끝이 밀렸고,
#: 그 바람에 배율이 6% 어긋났다. 뜻있는 사선 벽은 대개 길다.
DIAGONAL_MIN_ASPECT = 10.0

#: 이 반지름 이상이면 "속이 있는 획" 으로 본다 (픽셀). 아래 비율의 하한이다.
THICK_MODE_MIN_HALF = 2.0

#: 벽으로 볼 획의 최소 반두께 = 그림 긴 변의 이 비율.
#:
#: 절대값으로 잡으면 안 된다. 펜으로 그은 선은 도면이 크든 작든 1~3px 이지만,
#: 칠한 벽은 도면과 함께 커진다 — 15m 짜리 도면을 2000px 로 보면 100mm 벽이 13px 다.
#: 그래서 **그림 크기에 견주어** 판단해야 3px 짜리 펜선을 굵은 벽으로 잘못 세지 않는다.
#: 실제로 절대값 4px 로 잡았다가 두 줄로 그린 벽이 굵은 벽으로 갈라졌다.
WALL_MIN_HALF_FRACTION = 0.0025

#: 잉크의 이만큼이 "속이 있는 획" 이어야 굵은 선 도면으로 본다.
#:
#: 굵기 하나만 보면 안 된다. 얇은 선으로 그린 도면도 **선이 교차하는 자리**에서는
#: 국소적으로 굵어져서, 상위 백분위를 쓰면 두 줄로 그린 벽을 굵은 벽으로 잘못 본다.
#: 실제로 그렇게 잘못 갈라져 벽이 두 개씩 서고 방이 하나로 뭉쳤다. 교차점은 잉크의
#: 아주 일부이므로, **얼마나 많은 잉크가 굵은가**를 함께 보면 갈라지지 않는다.
THICK_MODE_MIN_SHARE = 0.2

#: 이보다 얇으면 벽 두께를 잰 것으로 치지 않는다 (픽셀).
#:
#: 한 줄로 그린 벽에서 선 굵기는 벽 두께가 아니라 **펜 굵기**다. 그것을 두께로
#: 내보내면 3px 짜리 벽이 서고, 사용자는 그것을 잰 값인 줄 안다.
MEASURED_THICKNESS_MIN_PX = 4.0

#: 굵은 선 도면에서 벽만 남기는 열림 반지름 = 벽 반두께의 이 비율.
#:
#: 1.0 으로 잡으면 벽 자신도 깎여 끊긴다. 0.55 면 벽은 남고 치수선·해치·글자는
#: 사라진다 — 그것들은 벽의 절반 굵기도 안 되기 때문이다.
OPEN_RADIUS_RATIO = 0.55

#: 두 줄로 그린 벽을 한 벽으로 묶을 때, 두 줄 사이의 최대 간격 = 그림 긴 변의 이 비율.
#:
#: 2000px 도면에서 50px. 국내 주거의 벽은 100~200mm 이고 도면 폭이 10m 안팎이므로
#: 벽 두께는 긴 변의 2% 를 넘지 않는다.
PAIR_MAX_GAP_FRACTION = 0.025

#: 벽선이 끊긴 자리를 개구부로 볼 범위 (벽 두께의 배수).
#:
#: 문은 보통 벽 두께의 4~8배, 넓은 개구부나 창은 그 이상이다. 아래로는 코너에서
#: 생기는 자잘한 틈을, 위로는 "그냥 벽이 없는 곳"을 걸러낸다.
OPENING_MIN_RATIO = 1.5
OPENING_MAX_RATIO = 22.0

#: 개구부 폭의 절대 하한·상한 (픽셀). 벽 두께를 못 잰 도면에서 쓰인다.
OPENING_MIN_PX = 6.0
OPENING_MAX_PX_FRACTION = 0.35

#: 방으로 볼 최소 넓이 — 도면 영역의 이 비율.
#:
#: 85㎡ 아파트의 1.5㎡ 짜리 욕실이 1.8%, 0.5㎡ 붙박이장이 0.6% 다. 노이즈 얼룩은
#: 0.01% 도 안 된다. 0.1% 면 진짜 방은 남기고 얼룩만 버린다.
MIN_ROOM_AREA_FRACTION = 0.001

#: 방으로 보려면 안에 이만큼의 원이 들어가야 한다 (벽 반두께의 배수).
#:
#: 벽을 두 줄로 그린 도면에서 **두 줄 사이의 빈 속**이 방으로 잡히는 것을 막는다.
#: 그 속은 벽 두께만 하지만 진짜 방은 훨씬 넓다.
MIN_ROOM_INRADIUS_RATIO = 3.0

#: 벽 속을 메울 때 쓰는 닫힘 반지름 = 그림 긴 변의 이 비율.
#:
#: 전처리의 적응형 이진화는 **굵게 칠한 벽의 속을 비운다.** 넓고 고른 검은 면 안쪽은
#: 주변 평균도 검으므로 문턱을 넘어 흰색으로 뒤집히기 때문이다. 그래서 21px 짜리
#: 벽이 윤곽선 두 줄로 들어온다. 그 상태로는 "굵은 획" 이라는 단서가 사라져 치수선을
#: 걸러낼 수 없다.
#:
#: 처음에는 "갇힌 빈 자리를 찾아 메우는" 방식으로 짰는데, **문이 난 벽에서 깨졌다** —
#: 벽 속이 문틈을 통해 방과 이어져 있어 갇힌 자리가 아니기 때문이다. 그래서 갇혔는지
#: 따지지 않고 **좁은 틈을 닫는다.**
#:
#: 이 반지름의 두 배보다 좁은 틈이 메워진다. 0.005 면 2400px 도면에서 24px —
#: 벽 속(두께 20px 안팎)은 메워지고, 문틈(900mm 는 보통 150px 이상)은 남는다.
#:
#: 넉넉하게 잡으면 안 된다. 0.01(48px)로 두었더니 도면 옆에 적힌 치수 글자가 **31px
#: 떨어진 벽에 들러붙어** 한 덩어리가 되었고, 그 덩어리가 벽으로 서서 도면 외곽이
#: 밀리고 배율이 7% 어긋났다. 벽 속을 메울 만큼만 잡는다.
#:
#: 벽이 이보다 두꺼운 도면에서는 속이 안 메워지는데, 그때는 두 줄 짝짓기
#: (_pair_double_lines)가 받아 준다 — 그쪽 한계가 이보다 넉넉하다.
CLOSE_RADIUS_FRACTION = 0.005

#: 방 폴리곤을 단순화하는 정도 — 둘레의 이 비율.
#:
#: 계단처럼 우툴두툴한 픽셀 경계를 곧은 변으로 편다. 크게 잡으면 방 모서리가
#: 잘려 면적이 달라지므로 작게 둔다.
ROOM_EPSILON_RATIO = 0.008

#: 축에 맞은 벽의 신뢰도. 굵기·길이·자리가 전부 측정값이라 높게 준다.
CONFIDENCE_AXIS_THICK = 0.82
#: 굵기를 못 재고 길이만 본 벽 (한 줄로 그린 도면). 전부 검수로 올라간다.
CONFIDENCE_AXIS_THIN = 0.45
#: 축에서 벗어난 벽. 우리 방식이 가장 약한 곳이라 전부 검수로 올린다.
CONFIDENCE_DIAGONAL = 0.4
#: 진짜 벽으로만 둘러싸인 방. 경계가 전부 측정값이라 지적으로 올리지 않는다.
CONFIDENCE_ROOM_SEALED = 0.72

#: 문틈을 이어 붙여 가둔 방. 그 틈이 정말 문이었는지, 틈을 잘못 이어 두 방을 하나로
#: 묶지는 않았는지 사람이 봐야 한다 — 그래서 이것만 검수로 올린다.
#:
#: 모든 방을 다 올리지는 않는다. 매번 전부 지적으로 뜨면 지적이 뜻을 잃고, 정작
#: 봐야 할 것을 지나치게 된다. 래스터 결과 전체는 어차피 검수를 지나야 확정된다.
CONFIDENCE_ROOM_BRIDGED = 0.5
#: 개구부. 자리와 폭은 잰 값이지만 **종류는 우리가 모른다** — 전부 검수로 올린다.
CONFIDENCE_OPENING = 0.45


@dataclass
class _Run:
    """축에 맞은 벽 한 줄 (전처리 그림 픽셀).

    horizontal 이면 (x0, x1) 이 길이 방향이고 center 가 y 다. 세로면 반대다.
    """

    horizontal: bool
    start: float
    end: float
    center: float
    thickness: float
    #: 두께가 **벽을 잰 값**인가. 한 줄로 그린 벽에서는 펜 굵기일 뿐이라 False 다.
    measured: bool = True

    @property
    def length(self) -> float:
        return self.end - self.start

    def to_wall(self, confidence: float) -> PixelWall:
        if self.horizontal:
            a = (self.start, self.center)
            b = (self.end, self.center)
        else:
            a = (self.center, self.start)
            b = (self.center, self.end)
        return PixelWall(
            a=a,
            b=b,
            # 못 잰 두께는 0 으로 넘긴다 — pipeline 이 지적으로 올리고 기본값을 쓴다.
            thickness_px=self.thickness if self.measured else 0.0,
            confidence=confidence,
        )


def _disk(radius: int) -> np.ndarray:
    size = max(1, 2 * int(radius) + 1)
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))


def _ink(binary: np.ndarray) -> np.ndarray:
    """이진화 결과에서 잉크(검은 획)만 1 로.

    prepare() 는 흰 바탕(255)에 검은 선(0)을 돌려준다.
    """
    if binary.ndim == 3:
        binary = cv2.cvtColor(binary, cv2.COLOR_BGR2GRAY)
    return (binary < 128).astype(np.uint8)


def _solidify(ink: np.ndarray, long_edge: float) -> np.ndarray:
    """비워진 벽 속을 도로 메운다.

    전처리의 적응형 이진화는 넓은 검은 면의 **안쪽을 흰색으로 뒤집는다.** 그래서 굵게
    칠한 벽이 윤곽선 두 줄로 들어오고, "굵은 획" 이라는 단서가 사라져 치수선·글자를
    굵기로 걸러낼 수 없게 된다.

    닫힘(close)으로 좁은 틈만 메운다. 방은 훨씬 넓어 그대로 남고, 문틈도 벽 두께보다
    훨씬 넓어 살아남는다 — 문이 메워지면 방 둘이 하나로 붙는다.
    """
    radius = max(2, int(round(CLOSE_RADIUS_FRACTION * long_edge)))
    return cv2.morphologyEx(ink, cv2.MORPH_CLOSE, _disk(radius))


def _stroke_profile(ink: np.ndarray, long_edge: float) -> tuple[bool, float]:
    """이 도면이 벽을 굵게 칠했나, 그렇다면 반두께는 얼마인가 (픽셀).

    거리 변환은 각 잉크 픽셀에서 바탕까지의 거리를 준다. 획 한가운데의 값이 곧
    반두께다. 여기서 두 가지를 함께 본다.

    * **얼마나 많은 잉크가 굵은가** — 얇은 선 도면도 교차점에서는 굵어지므로,
      굵기만 보면 갈라지지 않는다. 교차점은 잉크의 일부일 뿐이다.
    * **굵은 잉크의 대표 두께** — 중앙값을 쓴다. 몇 군데 뭉친 자리에 끌려가지 않고,
      작게 잡히는 쪽이라 벽을 깎아 없앨 위험이 적다.
    """
    if not ink.any():
        return False, 0.0

    floor = max(THICK_MODE_MIN_HALF, WALL_MIN_HALF_FRACTION * long_edge)

    distance = cv2.distanceTransform(ink, cv2.DIST_L2, 5)
    deep = distance >= floor

    total = float(ink.sum())
    if total <= 0 or float(deep.sum()) / total < THICK_MODE_MIN_SHARE:
        return False, 0.0

    return True, float(np.median(distance[deep]))


def _runs_along(mask: np.ndarray, *, horizontal: bool, min_length: float) -> list[_Run]:
    """한 방향으로 길게 이어진 덩어리를 뽑는다.

    길이 방향으로만 긴 커널로 열면(open) 그 방향으로 min_length 만큼 이어지지 않는
    획은 전부 사라진다. 남은 덩어리 하나가 벽 한 줄이고, 덩어리의 짧은 변이 곧
    **잰 두께**다 — 짐작한 값이 아니다.
    """
    length = max(3, int(round(min_length)))
    kernel = np.ones((1, length), np.uint8) if horizontal else np.ones((length, 1), np.uint8)
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    count, _, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)

    runs: list[_Run] = []
    for index in range(1, count):
        x = float(stats[index, cv2.CC_STAT_LEFT])
        y = float(stats[index, cv2.CC_STAT_TOP])
        width = float(stats[index, cv2.CC_STAT_WIDTH])
        height = float(stats[index, cv2.CC_STAT_HEIGHT])

        if horizontal:
            if width < min_length:
                continue
            runs.append(
                _Run(True, start=x, end=x + width, center=y + height / 2, thickness=height)
            )
        else:
            if height < min_length:
                continue
            runs.append(
                _Run(False, start=y, end=y + height, center=x + width / 2, thickness=width)
            )

    return runs


def _pair_double_lines(runs: list[_Run], max_gap: float) -> list[_Run]:
    """두 줄로 그린 벽을 한 벽으로 묶는다.

    벽을 굵은 획이 아니라 **평행한 두 선**으로 그린 도면이 많다. 그대로 두면 벽이
    두 개씩 생기고 그 사이의 빈 속이 방으로 잡힌다. 겹치는 구간이 있고 간격이 벽
    두께만 한 두 줄은 한 벽으로 보고, **두 줄의 바깥면 사이 거리를 두께로 잰다.**

    간격을 두께로 삼는 것은 짐작이 아니다 — 도면에 그렇게 그려져 있다.
    """
    remaining = sorted(runs, key=lambda run: (round(run.center, 1), run.start))
    used: set[int] = set()
    merged: list[_Run] = []

    for i, first in enumerate(remaining):
        if i in used:
            continue

        partner_index: int | None = None
        best_gap = max_gap

        for j in range(i + 1, len(remaining)):
            if j in used:
                continue
            second = remaining[j]

            gap = second.center - first.center
            if gap <= 0 or gap > best_gap:
                continue

            # 길이 방향으로 실제로 겹쳐야 같은 벽이다. 스치기만 하는 것은 남남이다.
            overlap = min(first.end, second.end) - max(first.start, second.start)
            if overlap < 0.5 * min(first.length, second.length):
                continue

            best_gap = gap
            partner_index = j

        if partner_index is None:
            # 짝이 없다. 이 선 하나가 벽 전체인지, 짝을 못 찾은 것인지 알 수 없으므로
            # 펜 굵기를 벽 두께라고 내보내지 않는다.
            merged.append(
                _Run(
                    horizontal=first.horizontal,
                    start=first.start,
                    end=first.end,
                    center=first.center,
                    thickness=first.thickness,
                    # 펜 굵기보다 확실히 두꺼우면 그 자체가 벽 몸통이다.
                    measured=first.thickness >= MEASURED_THICKNESS_MIN_PX,
                )
            )
            continue

        second = remaining[partner_index]
        used.add(partner_index)

        outer = (second.center + second.thickness / 2) - (first.center - first.thickness / 2)
        merged.append(
            _Run(
                horizontal=first.horizontal,
                start=min(first.start, second.start),
                end=max(first.end, second.end),
                center=(first.center + second.center) / 2,
                thickness=outer,
            )
        )

    return merged


def _touching(first: _Run, second: _Run, slack: float) -> bool:
    """두 벽이 만나는가 (모서리·T 자·같은 선 위의 이음)."""
    if first.horizontal == second.horizontal:
        if abs(first.center - second.center) > slack:
            return False
        return second.start - slack <= first.end and first.start - slack <= second.end

    across, along = (first, second) if first.horizontal else (second, first)
    return (
        across.start - slack <= along.center <= across.end + slack
        and along.start - slack <= across.center <= along.end + slack
    )


def _drop_lonely_runs(runs: list[_Run], *, slack: float, min_length: float) -> list[_Run]:
    """다른 벽에 닿지 않은 짧은 덩어리를 버린다.

    뭉쳐진 치수 글자가 여기서 걸린다. 정말 홀로 선 긴 벽은 남겨 둔다 — 벽을 조용히
    빠뜨리는 것이 잘못 세우는 것보다 나쁘기 때문이다.
    """
    kept: list[_Run] = []
    for index, run in enumerate(runs):
        if run.length >= min_length:
            kept.append(run)
            continue
        if any(
            _touching(run, other, slack) for other_index, other in enumerate(runs)
            if other_index != index
        ):
            kept.append(run)

    return kept


def _openings_from_gaps(
    runs: list[_Run],
    *,
    tolerance: float,
    max_width: float,
    typical_thickness: float,
) -> tuple[list[_Run], list[PixelOpening], list[tuple[_Run, float, float]]]:
    """같은 선 위에서 벽이 끊긴 자리를 개구부로 재고, **벽은 도로 이어 붙인다.**

    한 직선 위에 벽 조각이 둘로 나뉘어 있다면 그 사이는 도면에 그려진 빈 자리다.
    문이든 창이든, 자리와 폭은 재면 나온다. 종류는 여기서 정하지 않는다.

    ── 왜 끊긴 벽을 도로 잇나 ──

    FloorPlanDoc 에서 개구부는 **벽에 속한다**(wallId 와 벽 위의 offset 으로 적힌다).
    문틈에서 벽을 둘로 끊어 놓으면 그 문이 붙을 벽이 없어진다. 실제로 그렇게 두었더니
    개구부가 어느 벽에도 못 붙어 pipeline 이 전부 버렸다("opening-unattached").
    문이 난 벽은 **문을 품은 한 장의 벽**이다 — 그렇게 이어서 내보낸다.

    함께 돌려주는 목록은 그 자리가 우리가 이은 곳임을 남긴다. 거기 닿은 방만 검수로
    올리기 위해서다.
    """
    merged: list[_Run] = []
    openings: list[PixelOpening] = []
    bridges: list[tuple[_Run, float, float]] = []

    lines: dict[tuple[bool, int], list[_Run]] = {}
    for run in runs:
        key = (run.horizontal, int(round(run.center / max(tolerance, 1.0))))
        lines.setdefault(key, []).append(run)

    for group in lines.values():
        group.sort(key=lambda run: run.start)

        current = group[0]
        for nxt in group[1:]:
            gap = nxt.start - current.end

            thickness = max(current.thickness, nxt.thickness, typical_thickness)
            low = max(OPENING_MIN_PX, OPENING_MIN_RATIO * thickness)

            high = max_width
            # 두께의 배수로 자르는 것은 **두께를 실제로 쟀을 때만** 뜻이 있다.
            # 한 줄로 그린 도면에서 펜 굵기의 22배로 자르면 멀쩡한 문이 잘려 나간다.
            if thickness >= MEASURED_THICKNESS_MIN_PX:
                high = min(high, OPENING_MAX_RATIO * thickness)

            if gap < low or gap > high:
                # 개구부로 볼 수 없는 간격이다. 이어 붙이지 않고 남남으로 둔다.
                merged.append(current)
                current = nxt
                continue

            middle = (current.end + nxt.start) / 2
            center = (middle, current.center) if current.horizontal else (current.center, middle)

            openings.append(
                PixelOpening(
                    # 문인지 창인지는 그림에서 재서 알 수 없다. 검수에서 사람이 고른다.
                    kind="door",
                    center=center,
                    width_px=gap,
                    confidence=CONFIDENCE_OPENING,
                )
            )
            bridges.append((current, current.end, nxt.start))

            current = _Run(
                horizontal=current.horizontal,
                start=current.start,
                end=nxt.end,
                center=(current.center + nxt.center) / 2,
                thickness=max(current.thickness, nxt.thickness),
                measured=current.measured or nxt.measured,
            )

        merged.append(current)

    return merged, openings, bridges


def _barrier(
    shape: tuple[int, int], runs: list[_Run], bridges: list
) -> tuple[np.ndarray, np.ndarray]:
    """방을 가두는 울타리와, 그중 **우리가 메운 자리**.

    방 영역을 찾을 때만 쓰는 그림이다. 여기 그린 것이 벽으로 나가지는 않는다.
    메운 자리를 따로 돌려주는 이유는, 그 자리에 닿은 방만 검수로 올리기 위해서다.
    """
    canvas = np.zeros(shape, np.uint8)
    filled = np.zeros(shape, np.uint8)

    for run in runs:
        half = max(1.0, run.thickness / 2)
        if run.horizontal:
            top, bottom = run.center - half, run.center + half
            cv2.rectangle(canvas, (int(run.start), int(top)), (int(run.end), int(bottom)), 1, -1)
        else:
            left, right = run.center - half, run.center + half
            cv2.rectangle(canvas, (int(left), int(run.start)), (int(right), int(run.end)), 1, -1)

    for run, start, end in bridges:
        half = max(1.0, run.thickness / 2)
        if run.horizontal:
            corners = (
                (int(start), int(run.center - half)),
                (int(end), int(run.center + half)),
            )
        else:
            corners = (
                (int(run.center - half), int(start)),
                (int(run.center + half), int(end)),
            )
        cv2.rectangle(canvas, corners[0], corners[1], 1, -1)
        cv2.rectangle(filled, corners[0], corners[1], 1, -1)

    return canvas, filled


def _rooms(barrier: np.ndarray, filled: np.ndarray, half: float) -> list[PixelRoom]:
    """울타리로 둘러싸인 흰 영역을 방으로 본다.

    그림 가장자리에 닿는 영역은 건물 **바깥**이므로 뺀다. 너무 작거나 너무 좁은
    영역도 뺀다 — 좁은 것은 두 줄로 그린 벽의 빈 속일 때가 많다.
    """
    height, width = barrier.shape[:2]
    free = (barrier == 0).astype(np.uint8)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(free, connectivity=4)

    total = float(height * width)
    min_area = MIN_ROOM_AREA_FRACTION * total
    min_inradius = max(4.0, MIN_ROOM_INRADIUS_RATIO * max(half, 1.0))

    rooms: list[PixelRoom] = []
    for index in range(1, count):
        left = int(stats[index, cv2.CC_STAT_LEFT])
        top = int(stats[index, cv2.CC_STAT_TOP])
        box_w = int(stats[index, cv2.CC_STAT_WIDTH])
        box_h = int(stats[index, cv2.CC_STAT_HEIGHT])
        area = float(stats[index, cv2.CC_STAT_AREA])

        # 그림 가장자리에 닿으면 건물 바깥이다
        if left == 0 or top == 0 or left + box_w >= width or top + box_h >= height:
            continue
        if area < min_area:
            continue

        region = (labels == index).astype(np.uint8)

        # 안에 이만한 원이 안 들어가면 방이 아니라 틈이다
        inradius = float(cv2.distanceTransform(region, cv2.DIST_L2, 5).max())
        if inradius < min_inradius:
            continue

        contours, _ = cv2.findContours(region, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue

        outline = max(contours, key=cv2.contourArea)
        epsilon = ROOM_EPSILON_RATIO * cv2.arcLength(outline, True)
        polygon = cv2.approxPolyDP(outline, epsilon, True)
        if len(polygon) < 3:
            continue

        # 우리가 메운 자리에 닿아 있으면, 그 방의 경계 일부는 잰 것이 아니라 이은 것이다.
        touches_bridge = bool((cv2.dilate(region, _disk(2)) & filled).any())

        rooms.append(
            PixelRoom(
                polygon=[(float(point[0][0]), float(point[0][1])) for point in polygon],
                confidence=(
                    CONFIDENCE_ROOM_BRIDGED if touches_bridge else CONFIDENCE_ROOM_SEALED
                ),
            )
        )

    return rooms


def _thickness_along(distance: np.ndarray, a: tuple[float, float], b: tuple[float, float]) -> float:
    """선분을 따라간 잉크의 두께 (픽셀).

    거리 변환 값을 선분 위에서 훑어 중앙값을 낸다. 끝점 근처는 다른 획과 만나 부풀기
    쉬우므로 가운데만 본다.
    """
    height, width = distance.shape[:2]
    length = max(2, int(round(np.hypot(b[0] - a[0], b[1] - a[1]))))

    values: list[float] = []
    for step in range(length + 1):
        t = 0.15 + 0.7 * (step / length)
        x = int(round(a[0] + (b[0] - a[0]) * t))
        y = int(round(a[1] + (b[1] - a[1]) * t))
        if 0 <= x < width and 0 <= y < height:
            values.append(float(distance[y, x]))

    if not values:
        return 0.0
    return 2.0 * float(np.median(values))


def _diagonal_walls(
    residual: np.ndarray, *, min_length: float, thickness: float
) -> list[PixelWall]:
    """축에서 벗어난 벽.

    가로·세로로 뽑고 남은 잉크에서만 찾는다. 사선 벽은 드물지만, 있는데 못 읽으면
    3D 에서 벽이 통째로 사라진다 — 조용히 빠뜨리는 것이 가장 나쁘다. 대신 우리
    방식이 가장 약한 곳이므로 신뢰도를 낮춰 전부 검수로 올린다.

    여기서도 **두께를 재서** 가른다. 닫힘으로 뭉쳐진 치수 글자에서 Hough 가 사선을
    찾아내는데, 그것을 벽으로 세우면 도면 외곽이 넓어져 배율까지 어긋난다. 벽은
    두께보다 훨씬 길다는 규칙을 여기에도 그대로 적용한다.
    """
    if not residual.any():
        return []

    segments = cv2.HoughLinesP(
        residual * 255,
        rho=1,
        theta=np.pi / 180,
        threshold=int(max(30, min_length / 2)),
        minLineLength=int(min_length),
        maxLineGap=int(max(3, thickness)),
    )
    if segments is None or len(segments) == 0:
        return []

    # HoughLinesP 의 반환 모양은 opencv 판마다 다르다 — 4.x 는 (N, 1, 4), 5.x 는 (N, 4).
    # 한쪽만 가정하면 다른 판에서 500 이 난다.
    segments = np.asarray(segments).reshape(-1, 4)

    distance = cv2.distanceTransform(residual, cv2.DIST_L2, 5)

    walls: list[PixelWall] = []
    for x1, y1, x2, y2 in segments:
        angle = abs(np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1)))) % 180
        # 가로·세로는 이미 잡았다. 여기서 또 잡으면 벽이 겹쳐 두 번 선다.
        if angle < 12 or angle > 168 or abs(angle - 90) < 12:
            continue

        a = (float(x1), float(y1))
        b = (float(x2), float(y2))
        span = float(np.hypot(b[0] - a[0], b[1] - a[1]))
        measured = _thickness_along(distance, a, b)

        # 두께보다 충분히 길지 않으면 벽이 아니라 뭉쳐진 글자·기호다
        if span < DIAGONAL_MIN_ASPECT * max(measured, 1.0):
            continue

        walls.append(
            PixelWall(
                a=a,
                b=b,
                thickness_px=measured if measured >= MEASURED_THICKNESS_MIN_PX else 0.0,
                confidence=CONFIDENCE_DIAGONAL,
            )
        )

    return walls


class OpenCvBackend:
    """기본 백엔드 — 외부 호출 없이 그림에서 직접 잰다."""

    name = "opencv"

    def available(self) -> bool:
        # opencv 와 numpy 는 이 서비스의 필수 의존성이다. 여기까지 import 가 됐으면 쓸 수 있다.
        return True

    def run(self, image: np.ndarray) -> VectorizeResult:
        result = VectorizeResult(backend=self.name)

        ink = _ink(image)
        if not ink.any():
            return result

        height, width = ink.shape[:2]
        long_edge = float(max(height, width))
        min_length = max(MIN_RUN_PX, MIN_RUN_FRACTION * long_edge)

        # 이진화가 비워 놓은 벽 속을 먼저 메운다. 이것을 건너뛰면 굵은 벽이 윤곽선
        # 두 줄로 보여, 굵기로 치수선을 걸러내는 길이 통째로 막힌다.
        ink = _solidify(ink, long_edge)

        thick, half = _stroke_profile(ink, long_edge)

        if thick:
            # 굵은 획만 남긴다 — 치수선·해치·글자는 벽의 절반 굵기도 안 된다.
            radius = max(1, int(round(OPEN_RADIUS_RATIO * half)))
            candidate = cv2.morphologyEx(ink, cv2.MORPH_OPEN, _disk(radius))
        else:
            # 한 줄로 그린 도면. 굵기로는 못 가르므로 길이로만 거른다.
            candidate = ink

        if not candidate.any():
            return result

        runs = _runs_along(candidate, horizontal=True, min_length=min_length)
        runs += _runs_along(candidate, horizontal=False, min_length=min_length)

        if not thick:
            runs = _pair_double_lines(runs, max_gap=PAIR_MAX_GAP_FRACTION * long_edge)

        # 두께에 견주어 짧은 덩어리는 벽이 아니다 (뭉쳐진 글자·기호).
        runs = [
            run for run in runs if run.length >= WALL_MIN_ASPECT * max(run.thickness, 1.0)
        ]

        if not runs:
            return result

        # 대표 두께는 **잰 벽**에서만 낸다. 못 잰 것까지 섞으면 펜 굵기가 끼어든다.
        measured = [run.thickness for run in runs if run.measured]
        typical = float(np.median(measured)) if measured else max(2.0 * half, 2.0)

        runs = _drop_lonely_runs(
            runs,
            slack=max(4.0, typical),
            min_length=ISOLATED_MAX_LENGTH_FRACTION * long_edge,
        )
        if not runs:
            return result

        runs, openings, bridges = _openings_from_gaps(
            runs,
            tolerance=max(2.0, typical),
            max_width=OPENING_MAX_PX_FRACTION * long_edge,
            typical_thickness=typical,
        )

        confidence = CONFIDENCE_AXIS_THICK if thick else CONFIDENCE_AXIS_THIN
        result.walls = [run.to_wall(confidence) for run in runs]
        result.openings = openings

        barrier, filled = _barrier((height, width), runs, bridges)
        result.rooms = _rooms(barrier, filled, typical / 2)

        residual = cv2.subtract(candidate, cv2.dilate(barrier, _disk(1)))
        result.walls += _diagonal_walls(
            residual, min_length=min_length, thickness=max(typical, 2.0)
        )

        return result
