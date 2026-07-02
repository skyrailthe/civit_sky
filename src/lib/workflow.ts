import type { GenerateRequest } from "./types";
import { presetFor, dimensionsFor } from "./presets";

/**
 * Сборка ComfyUI workflow (API-формат) под ноды EasyCivitai-XTNodes:
 *  - CivitaiCheckpointLoaderSimple: url -> MODEL, CLIP, VAE
 *  - CivitaiLoraLoader: model, clip, url, strength_model, strength_clip -> MODEL, CLIP
 *
 * Ноды качают модель/LoRA по URL И сразу отдают MODEL/CLIP, поэтому зависимость
 * в графе ЯВНАЯ (LoraLoader принимает model/clip на вход) — нет race condition,
 * который был у раздельной AssetDownloader.
 *
 * Важно: ноды принимают ПЕЙДЖ-URL вида
 *   https://civitai.com/models/<modelId>?modelVersionId=<versionId>
 * а не api/download/... — поэтому в типах храним modelId + modelVersionId.
 *
 * Токен Civitai нода читает из .secrets.toml (генерится в entrypoint.sh воркера
 * из CIVITAI_TOKEN), поэтому в самом workflow токен не передаём.
 */

type Node = { class_type: string; inputs: Record<string, unknown> };
type Workflow = Record<string, Node>;

/** Пейдж-URL Civitai, который понимают ноды XTNodes. */
export function civitaiPageUrl(modelId: number, modelVersionId: number): string {
  return `https://civitai.com/models/${modelId}?modelVersionId=${modelVersionId}`;
}

export function buildComfyWorkflow(req: GenerateRequest): Workflow {
  // пресет по семейству чекпойнта (размер/CFG/шаги/sampler + добавки к промту)
  const preset = presetFor(req.checkpoint.baseModel);
  const dims = dimensionsFor(req.checkpoint.baseModel, req.aspectRatio);
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 32);
  // пользовательские значения имеют приоритет над пресетом
  const steps = req.steps ?? preset.steps;
  const cfg = req.cfgScale ?? preset.cfg;

  // префиксы семейства (Pony/Illustrious требуют quality-теги)
  const positivePrompt = [preset.promptPrefix, req.prompt]
    .filter((s) => s && s.trim())
    .join(", ");
  const negativePrompt = [preset.negativePrefix, req.negativePrompt]
    .filter((s) => s && s.trim())
    .join(", ");

  const wf: Workflow = {};
  let id = 0;
  const nextId = () => String(++id);

  // --- 1. Чекпойнт (качает + отдаёт MODEL/CLIP/VAE) ---

  const ckptId = nextId();
  wf[ckptId] = {
    class_type: "CivitaiCheckpointLoaderSimple",
    inputs: {
      url: civitaiPageUrl(req.checkpoint.modelId, req.checkpoint.modelVersionId),
      // обязательные поля ноды (установленная в образе версия их требует):
      override_trigger_words: "", // не переопределяем триггер-слова
      preview_images: false, // на serverless превью-картинки не нужны
    },
  };

  let modelRef: [string, number] = [ckptId, 0];
  let clipRef: [string, number] = [ckptId, 1];
  const vaeRef: [string, number] = [ckptId, 2];

  // --- 2. Цепочка LoRA (явная зависимость от model/clip) ---

  for (const extra of req.extras) {
    // поддержаны только LoRA-подобные ресурсы
    if (extra.type !== "LORA" && extra.type !== "LoCon") continue;
    const strength = extra.strength ?? 1.0;
    const lid = nextId();
    wf[lid] = {
      class_type: "CivitaiLoraLoader",
      inputs: {
        model: modelRef,
        clip: clipRef,
        url: civitaiPageUrl(extra.modelId, extra.modelVersionId),
        strength_model: strength,
        strength_clip: strength,
        override_trigger_words: "",
        preview_images: false,
      },
    };
    modelRef = [lid, 0];
    clipRef = [lid, 1];
  }

  // --- 3. Промты ---

  const posId = nextId();
  wf[posId] = {
    class_type: "CLIPTextEncode",
    inputs: { text: positivePrompt, clip: clipRef },
  };

  const negId = nextId();
  wf[negId] = {
    class_type: "CLIPTextEncode",
    inputs: { text: negativePrompt, clip: clipRef },
  };

  // --- 4. Латент нужного размера ---

  const latentId = nextId();
  wf[latentId] = {
    class_type: "EmptyLatentImage",
    inputs: { width: dims.width, height: dims.height, batch_size: 1 },
  };

  // --- 5. Сэмплер ---

  const samplerId = nextId();
  wf[samplerId] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps,
      cfg,
      sampler_name: preset.sampler,
      scheduler: preset.scheduler,
      denoise: 1,
      model: modelRef,
      positive: [posId, 0],
      negative: [negId, 0],
      latent_image: [latentId, 0],
    },
  };

  // --- 6. VAE decode + save ---

  const decodeId = nextId();
  wf[decodeId] = {
    class_type: "VAEDecode",
    inputs: { samples: [samplerId, 0], vae: vaeRef },
  };

  const saveId = nextId();
  wf[saveId] = {
    class_type: "SaveImage",
    inputs: { filename_prefix: "civitsky", images: [decodeId, 0] },
  };

  return wf;
}
