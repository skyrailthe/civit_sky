import type { AspectRatio, Dimensions } from "./types";
import { baseFamily, type BaseFamily } from "./compatibility";

/**
 * Пресеты генерации по семейству модели.
 *
 * Архитектура (граф нод) у SD1.5/SDXL/Pony/Illustrious общая, но «идеальные»
 * настройки различаются: базовое разрешение, CFG, шаги, sampler, а также
 * рекомендуемые префиксы промта и негатив (Pony/Illustrious требуют своих
 * quality-тегов, иначе результат заметно хуже).
 */

export interface FamilyPreset {
  // базовое разрешение под семейство (короткая сторона × длинная)
  baseSize: number; // квадрат; для форматов масштабируем пропорцию от него
  cfg: number;
  steps: number;
  sampler: string;
  scheduler: string;
  // авто-добавки к промту/негативу (можно отключить в UI)
  promptPrefix?: string;
  negativePrefix?: string;
  label: string;
}

const PRESETS: Record<BaseFamily, FamilyPreset> = {
  sd1: {
    baseSize: 512,
    cfg: 7,
    steps: 25,
    sampler: "euler_ancestral",
    scheduler: "normal",
    negativePrefix: "lowres, bad anatomy, bad hands, worst quality, low quality",
    label: "SD 1.5",
  },
  sdxl: {
    baseSize: 1024,
    cfg: 6,
    steps: 28,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    negativePrefix: "worst quality, low quality, blurry",
    label: "SDXL",
  },
  pony: {
    // Pony / Illustrious / NoobAI — экосистема на базе SDXL, но со своими тегами
    baseSize: 1024,
    cfg: 7,
    steps: 28,
    sampler: "euler_ancestral",
    scheduler: "normal",
    promptPrefix: "score_9, score_8_up, score_7_up",
    negativePrefix:
      "score_6, score_5, score_4, worst quality, low quality, blurry",
    label: "Pony / Illustrious",
  },
  sd2: {
    baseSize: 768,
    cfg: 7,
    steps: 25,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    negativePrefix: "worst quality, low quality",
    label: "SD 2.x",
  },
  sd3: {
    baseSize: 1024,
    cfg: 4.5,
    steps: 28,
    sampler: "dpmpp_2m",
    scheduler: "sgm_uniform",
    label: "SD 3",
  },
  flux: {
    baseSize: 1024,
    cfg: 1,
    steps: 20,
    sampler: "euler",
    scheduler: "simple",
    label: "Flux",
  },
  other: {
    baseSize: 1024,
    cfg: 6,
    steps: 28,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    label: "Универсальный",
  },
};

export function presetFor(baseModel?: string): FamilyPreset {
  return PRESETS[baseFamily(baseModel)];
}

/** Размеры под формат, отмасштабированные от baseSize семейства. */
export function dimensionsFor(
  baseModel: string | undefined,
  ratio: AspectRatio
): Dimensions {
  const base = presetFor(baseModel).baseSize;
  // множители сторон относительно квадрата base (кратно 64 для стабильности)
  const round64 = (n: number) => Math.round(n / 64) * 64;
  switch (ratio) {
    case "1:1":
      return { width: base, height: base };
    case "2:3":
      return { width: round64(base * 0.8125), height: round64(base * 1.1875) };
    case "3:2":
      return { width: round64(base * 1.1875), height: round64(base * 0.8125) };
  }
}
