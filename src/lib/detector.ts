// Lazily loads COCO-SSD (YOLO-style object detector) in the browser.
type Model = { detect: (el: HTMLVideoElement | HTMLCanvasElement) => Promise<{ class: string; score: number; bbox: number[] }[]> };
let modelPromise: Promise<Model> | null = null;

export function loadDetector(): Promise<Model> {
  if (!modelPromise) {
    modelPromise = (async () => {
      await import("@tensorflow/tfjs");
      const coco = await import("@tensorflow-models/coco-ssd");
      return (await coco.load({ base: "lite_mobilenet_v2" })) as unknown as Model;
    })();
  }
  return modelPromise;
}

export interface Detection { person: number; toothbrush: number }

export async function detect(el: HTMLVideoElement | HTMLCanvasElement): Promise<Detection> {
  const model = await loadDetector();
  const preds = await model.detect(el);
  const best = (c: string) => Math.max(0, ...preds.filter((p) => p.class === c).map((p) => p.score));
  return { person: best("person"), toothbrush: best("toothbrush") };
}

export const isVerified = (d: Detection) => d.person >= 0.5 && d.toothbrush >= 0.35;
