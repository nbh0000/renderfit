/**
 * Job System.
 *
 * AI 분석/생성/렌더는 오래 걸리므로 background job으로 처리하고
 * 프론트엔드는 polling으로 상태를 받는다.
 *
 * 현재 구현은 in-process 큐다. REDIS_URL이 설정되면 같은 인터페이스로
 * 분산 큐(BullMQ 등)로 교체할 수 있도록 QueueProvider로 분리해 두었다.
 */

export type JobType =
  | "ANALYZE_IMAGE"
  | "SEGMENT_IMAGE"
  | "ESTIMATE_DEPTH"
  | "GENERATE_INTERIOR"
  | "INPAINT"
  | "RENDER_PREVIEW"
  | "RENDER_FINAL";

export type JobState = "queued" | "processing" | "completed" | "failed";

export interface Job<TResult = unknown> {
  id: string;
  type: JobType;
  projectId: string;
  state: JobState;
  progress: number;
  /** 진행 상황 문구 — UI 로딩 메시지로 그대로 쓴다 */
  message: string;
  result: TResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type JobHandler<TResult> = (update: (progress: number, message: string) => void) => Promise<TResult>;

export interface QueueProvider {
  readonly name: string;
  enqueue<TResult>(input: {
    type: JobType;
    projectId: string;
    handler: JobHandler<TResult>;
  }): Job<TResult>;
  get(id: string): Job | undefined;
  listByProject(projectId: string): Job[];
}

const globalRef = globalThis as unknown as { __jobQueue?: Map<string, Job> };
const jobs: Map<string, Job> = globalRef.__jobQueue ?? (globalRef.__jobQueue = new Map());

const JOB_MESSAGES: Record<JobType, string> = {
  ANALYZE_IMAGE: "공간을 분석하고 있습니다...",
  SEGMENT_IMAGE: "객체를 분리하고 있습니다...",
  ESTIMATE_DEPTH: "깊이를 추정하고 있습니다...",
  GENERATE_INTERIOR: "디자인을 생성하고 있습니다...",
  INPAINT: "선택 영역을 다시 그리고 있습니다...",
  RENDER_PREVIEW: "미리보기를 렌더링하고 있습니다...",
  RENDER_FINAL: "최종 이미지를 렌더링하고 있습니다...",
};

export class InProcessQueue implements QueueProvider {
  readonly name = "in-process";

  enqueue<TResult>(input: {
    type: JobType;
    projectId: string;
    handler: JobHandler<TResult>;
  }): Job<TResult> {
    const job: Job<TResult> = {
      id: `job_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      type: input.type,
      projectId: input.projectId,
      state: "queued",
      progress: 0,
      message: JOB_MESSAGES[input.type],
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    jobs.set(job.id, job as Job);

    const update = (progress: number, message: string) => {
      const current = jobs.get(job.id);
      if (!current) return;
      jobs.set(job.id, {
        ...current,
        progress,
        message,
        state: "processing",
        updatedAt: new Date().toISOString(),
      });
    };

    // 응답을 막지 않고 백그라운드로 실행한다.
    void (async () => {
      update(5, JOB_MESSAGES[input.type]);
      try {
        const result = await input.handler(update);
        const current = jobs.get(job.id);
        jobs.set(job.id, {
          ...(current as Job),
          state: "completed",
          progress: 100,
          message: "완료되었습니다.",
          result: result as unknown,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        const current = jobs.get(job.id);
        jobs.set(job.id, {
          ...(current as Job),
          state: "failed",
          message: "실패했습니다.",
          error: error instanceof Error ? error.message : "알 수 없는 오류",
          updatedAt: new Date().toISOString(),
        });
      }
    })();

    return job;
  }

  get(id: string): Job | undefined {
    return jobs.get(id);
  }

  listByProject(projectId: string): Job[] {
    return [...jobs.values()]
      .filter((job) => job.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

let cached: QueueProvider | null = null;

export function getQueue(): QueueProvider {
  if (cached) return cached;
  // TODO: REDIS_URL이 있으면 BullMQ 기반 RedisQueue로 교체한다.
  cached = new InProcessQueue();
  return cached;
}

export { JOB_MESSAGES };
