/**
 * 걷기 입력 — 키보드·마우스·손가락이 같은 그릇에 담긴다.
 *
 * 3단계에서는 키보드 boolean 뿐이었다. 터치를 붙이면서 아날로그로 넓혔다. 조이스틱은
 * "살짝 밀면 천천히"가 되어야 해서 -1/0/1 로는 담기지 않는다.
 *
 * 이 객체는 ref 하나로 컨트롤러와 화면 조작부가 함께 쓴다. store 나 context 에 두면
 * 값이 바뀔 때마다 구독자가 리렌더되는데, 이건 매 프레임 바뀌는 값이다 — 그러면
 * 손가락을 움직이는 내내 리액트가 화면을 다시 그린다.
 */
export interface WalkInput {
  /** 이동 방향. x 는 좌(-1)~우(+1), y 는 뒤(-1)~앞(+1) */
  move: { x: number; y: number };
  /** 달리는 중인지 */
  run: boolean;
  /**
   * 위로 뜨는 힘. 0 이면 서 있고, 1 이면 최대로 오른다.
   *
   * 눈높이 걷기만으로는 볼 수 없는 것이 있다 — 우물천장 단, 상부장 위, 붙박이장
   * 윗면. 눈높이에 매여 있으면 도면을 다 확인하지 못한다.
   */
  lift: number;
  /**
   * 아직 시선에 반영하지 않은 회전량 (라디안).
   *
   * 이벤트에서 바로 카메라를 돌리지 않고 여기 쌓아 둔다. 한 프레임에 mousemove 가
   * 여러 번 와도 적용은 한 번이고, 이벤트와 렌더 타이밍이 갈린다.
   */
  look: { x: number; y: number };
  /**
   * 지금 쌓인 시선 입력이 손가락에서 왔는지.
   *
   * 터치는 샘플링이 거칠어 그대로 적용하면 시선이 계단처럼 돈다. 반면 마우스에
   * 같은 스무딩을 넣으면 지연이 생겨 "무겁다"는 느낌이 난다 — 입력 소스로 갈라야 한다.
   */
  lookFromTouch: boolean;
}

export function createWalkInput(): WalkInput {
  return {
    move: { x: 0, y: 0 },
    run: false,
    lift: 0,
    look: { x: 0, y: 0 },
    lookFromTouch: false,
  };
}

/** 손을 뗐을 때 — 이동만 멈춘다. 쌓인 시선은 남은 만큼 흘러 나가야 자연스럽다 */
export function stopMoving(input: WalkInput): void {
  input.move.x = 0;
  input.move.y = 0;
  input.run = false;
  input.lift = 0;
}
