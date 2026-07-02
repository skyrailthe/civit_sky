// Проверка совместимости доп. ресурсов (LoRA / embeddings) с чекпойнтом.
//
// Civitai в поле baseModel хранит конкретные значения ("SD 1.5", "SDXL 1.0",
// "Pony", "Illustrious", "Flux.1 D" и т.д.). Для совместимости важна не точная
// строка, а АРХИТЕКТУРНОЕ СЕМЕЙСТВО: LoRA, обученная на SDXL-архитектуре
// (включая Pony/Illustrious/NoobAI — это дообучения SDXL), работает с любым
// SDXL-чекпойнтом, но НЕ работает с SD 1.5 / Flux / SD3.

export type BaseFamily =
  | "sd1"
  | "sd2"
  | "sdxl"
  | "sd3"
  | "flux"
  | "pony" // подсемейство SDXL, но веса часто несовместимы с обычным SDXL
  | "other";

/**
 * Нормализует строку baseModel из Civitai в семейство.
 * Pony/Illustrious/NoobAI выделяем отдельно: технически это SDXL-архитектура,
 * но LoRA на них часто плохо переносятся на ванильный SDXL и наоборот.
 */
export function baseFamily(baseModel?: string): BaseFamily {
  const b = (baseModel ?? "").toLowerCase();

  if (b.includes("pony")) return "pony";
  if (b.includes("illustrious") || b.includes("noobai")) return "pony"; // та же экосистема
  if (b.includes("flux")) return "flux";
  if (b.includes("sd 3") || b.includes("sd3") || b.includes("stable diffusion 3"))
    return "sd3";
  if (b.includes("sdxl") || b.includes("xl")) return "sdxl";
  if (b.includes("sd 2") || b.includes("2.0") || b.includes("2.1")) return "sd2";
  if (b.includes("sd 1") || b.includes("1.5")) return "sd1";
  return "other";
}

/**
 * Совместима ли LoRA/embedding (extraBase) с выбранным чекпойнтом (ckptBase).
 *
 * Правила:
 *  - Точное совпадение семейства → совместимо.
 *  - Pony/Illustrious/NoobAI считаем взаимно совместимыми внутри "pony".
 *  - Разные семейства → НЕ совместимо.
 *  - Неизвестная архитектура ресурса ("other": Anima, ZImageBase, LTXV,
 *    Wan и т.п.) → НЕ совместимо. Такие LoRA раньше проскакивали и портили
 *    композицию (дубли/двоение), т.к. их веса не подходят к SDXL/Pony/SD1.5.
 *    Если у чекпойнта база неизвестна — сравнить не с чем, разрешаем.
 */
export function isCompatible(
  ckptBase: string | undefined,
  extraBase: string | undefined
): boolean {
  const c = baseFamily(ckptBase);
  const e = baseFamily(extraBase);
  // база чекпойнта неизвестна — сравнивать не с чем, не блокируем
  if (c === "other") return true;
  // ресурс неизвестной архитектуры к известной модели — блокируем
  if (e === "other") return false;
  return c === e;
}

/** Человекочитаемая причина несовместимости — для подсказки в UI. */
export function incompatibilityReason(
  ckptBase: string | undefined,
  extraBase: string | undefined
): string | null {
  if (isCompatible(ckptBase, extraBase)) return null;
  return `Несовместимо: модель — ${baseFamily(
    ckptBase
  ).toUpperCase()}, ресурс — ${baseFamily(extraBase).toUpperCase()}`;
}
