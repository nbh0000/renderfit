import type { Scene } from "@/scene/types";
import type {
  GenerationProvider,
  RenderOptions,
  RenderResult,
  RenderingProvider,
} from "./types";
import { STYLE_PRESET_MAP } from "@/models/styles";
import { summarizeScene } from "@/scene/serialization";

/**
 * 실사 렌더링 provider.
 *
 * 3D 뷰포트를 캡처한 이미지를 그대로 생성 모델에 넣어 "사진"으로 바꾼다.
 * 구조(벽·창문·가구 배치·카메라)는 캡처 이미지가 이미 확정하고 있으므로,
 * 프롬프트는 그 구조를 절대 바꾸지 말라고 못박고 재질·조명·질감만 사실적으로 올린다.
 */
export class GeminiRenderingProvider implements RenderingProvider {
  readonly name = "gemini-render";

  constructor(
    private generation: GenerationProvider,
    private fallback: RenderingProvider
  ) {}

  private buildPrompt(scene: Scene, quality: "preview" | "final"): string {
    const style = STYLE_PRESET_MAP[scene.styleId ?? "modern"];

    return [
      "This image is a 3D viewport screenshot of an interior scene.",
      "Convert it into a photorealistic interior photograph.",
      "Keep the exact camera angle, perspective, room proportions, and the position, size and orientation of every piece of furniture.",
      "Do not add, remove, or move any object. Do not change the wall, window or door layout.",
      "Replace the flat 3D materials with realistic ones: correct wood grain, fabric weave, stone veining, metal reflections.",
      "Add realistic global illumination, soft contact shadows, subtle ambient occlusion and natural light falloff from the window.",
      style ? `Overall style: ${style.promptFragment}` : "",
      `Scene contents: ${summarizeScene(scene)}`,
      quality === "final"
        ? "Render at high fidelity, magazine-quality interior photography, sharp focus, natural white balance."
        : "Quick preview quality is acceptable but keep the geometry faithful.",
      "No text, no watermarks, no dimension annotations.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async render(
    scene: Scene,
    quality: "preview" | "final",
    options?: RenderOptions
  ): Promise<RenderResult> {
    const viewport = options?.viewportImage;

    // 캡처 이미지가 없으면 실사 변환의 기준이 없으므로 mock 렌더로 넘긴다.
    if (!viewport?.url) {
      return quality === "final"
        ? this.fallback.finalRender(scene, options)
        : this.fallback.preview(scene, options);
    }

    const started = Date.now();

    try {
      const result = await this.generation.generate({
        image: viewport,
        prompt: options?.prompt
          ? `${this.buildPrompt(scene, quality)}\n${options.prompt}`
          : this.buildPrompt(scene, quality),
        styleId: scene.styleId,
        size: quality === "final" ? 2048 : 1024,
        settings: { render: quality, objects: scene.objects.length },
      });

      return {
        imageUrl: result.imageUrl,
        quality,
        durationMs: Date.now() - started,
        provider: this.name,
      };
    } catch (error) {
      // 생성이 실패해도 렌더 버튼이 죽으면 안 된다 — 기존 렌더로 폴백한다.
      console.warn("[render] 실사 변환 실패, 기본 렌더로 대체합니다:", error);
      return quality === "final"
        ? this.fallback.finalRender(scene, options)
        : this.fallback.preview(scene, options);
    }
  }

  preview(scene: Scene, options?: RenderOptions): Promise<RenderResult> {
    return this.render(scene, "preview", options);
  }

  finalRender(scene: Scene, options?: RenderOptions): Promise<RenderResult> {
    return this.render(scene, "final", options);
  }
}
