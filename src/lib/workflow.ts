import type { GenerateRequest } from "./types";
import { ASPECT_DIMENSIONS } from "./types";

/**
 * Сборка ComfyUI workflow в API-формате под кастомный worker-comfyui
 * с нодой AssetDownloader (https://github.com/ServiceStack/comfy-asset-downloader).
 *
 * Идея:
 *  - На каждый ресурс (чекпойнт + каждая LoRA) добавляем AssetDownloader.
 *    Эта нода — OUTPUT_NODE=True, поэтому ComfyUI выполнит её всегда и
 *    скачает файл в models/checkpoints | models/loras ДО генерации.
 *  - Дальше обычный SDXL txt2img граф ссылается на файлы по имени.
 *  - Токен Civitai подставляем как "$CIVITAI_TOKEN" — нода читает его из
 *    переменной окружения воркера (не светим токен в JSON задачи).
 *
 * Формат: { [nodeId]: { class_type, inputs: {...} } }
 * Связь нод: ["<nodeId>", <outputIndex>].
 */

const CIVITAI_TOKEN_REF = "$CIVITAI_TOKEN";

type Node = { class_type: string; inputs: Record<string, unknown> };
type Workflow = Record<string, Node>;

/** Делает безопасное имя файла из downloadUrl + id версии. */
function fileNameFor(
  modelVersionId: number,
  url: string,
  fallbackExt = "safetensors"
): string {
  // Civitai downloadUrl обычно вида .../api/download/models/<id>
  // расширение не гарантировано — задаём .safetensors по умолчанию.
  const guessExt = /\.(safetensors|ckpt|pt|bin)(\?|$)/i.exec(url)?.[1];
  return `civitsky_${modelVersionId}.${guessExt ?? fallbackExt}`;
}

export function buildComfyWorkflow(req: GenerateRequest): Workflow {
  const dims = ASPECT_DIMENSIONS[req.aspectRatio];
  const seed = req.seed ?? Math.floor(Math.random() * 2 ** 32);
  const steps = req.steps ?? 28;
  const cfg = req.cfgScale ?? 6;

  const wf: Workflow = {};
  let id = 0;
  const nextId = () => String(++id);

  // --- 1. Загрузчики моделей (OUTPUT_NODE, выполняются всегда) ---

  const ckptFile = fileNameFor(
    req.checkpoint.modelVersionId,
    req.checkpoint.downloadUrl
  );
  const dlCkptId = nextId();
  wf[dlCkptId] = {
    class_type: "AssetDownloader",
    inputs: {
      url: req.checkpoint.downloadUrl,
      save_to: "checkpoints",
      filename: ckptFile,
      token: CIVITAI_TOKEN_REF,
    },
  };

  const loraFiles: { file: string; strength: number }[] = [];
  for (const extra of req.extras) {
    // Поддержаны только LoRA-подобные ресурсы. Embeddings (TextualInversion),
    // VAE и пр. сюда не доходят — UI их не показывает, но на всякий случай
    // защищаемся и здесь.
    if (extra.type !== "LORA" && extra.type !== "LoCon") continue;
    const file = fileNameFor(extra.modelVersionId, extra.downloadUrl);
    const dlId = nextId();
    wf[dlId] = {
      class_type: "AssetDownloader",
      inputs: {
        url: extra.downloadUrl,
        save_to: "loras",
        filename: file,
        token: CIVITAI_TOKEN_REF,
      },
    };
    loraFiles.push({ file, strength: extra.strength ?? 1.0 });
  }

  // --- 2. Загрузка чекпойнта ---

  const loaderId = nextId();
  wf[loaderId] = {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: ckptFile },
  };

  // Текущие выходы MODEL / CLIP, которые будем прогонять через LoRA-цепочку.
  let modelRef: [string, number] = [loaderId, 0];
  let clipRef: [string, number] = [loaderId, 1];
  const vaeRef: [string, number] = [loaderId, 2];

  // --- 3. Цепочка LoraLoader ---

  for (const lora of loraFiles) {
    const lid = nextId();
    wf[lid] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.file,
        strength_model: lora.strength,
        strength_clip: lora.strength,
        model: modelRef,
        clip: clipRef,
      },
    };
    modelRef = [lid, 0];
    clipRef = [lid, 1];
  }

  // --- 4. Промты ---

  const posId = nextId();
  wf[posId] = {
    class_type: "CLIPTextEncode",
    inputs: { text: req.prompt, clip: clipRef },
  };

  const negId = nextId();
  wf[negId] = {
    class_type: "CLIPTextEncode",
    inputs: { text: req.negativePrompt ?? "", clip: clipRef },
  };

  // --- 5. Латент нужного размера ---

  const latentId = nextId();
  wf[latentId] = {
    class_type: "EmptyLatentImage",
    inputs: { width: dims.width, height: dims.height, batch_size: 1 },
  };

  // --- 6. Сэмплер ---

  const samplerId = nextId();
  wf[samplerId] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps,
      cfg,
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
      model: modelRef,
      positive: [posId, 0],
      negative: [negId, 0],
      latent_image: [latentId, 0],
    },
  };

  // --- 7. VAE decode + save ---

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
