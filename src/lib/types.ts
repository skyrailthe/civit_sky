// Общие типы домена

export type AspectRatio = "1:1" | "2:3" | "3:2";

export interface Dimensions {
  width: number;
  height: number;
}

// SDXL-дружелюбные разрешения под каждый формат
export const ASPECT_DIMENSIONS: Record<AspectRatio, Dimensions> = {
  "1:1": { width: 1024, height: 1024 },
  "2:3": { width: 832, height: 1216 },
  "3:2": { width: 1216, height: 832 },
};

// --- Civitai ---

export interface CivitaiFile {
  id: number;
  name: string;
  sizeKB: number;
  type: string; // "Model" | "VAE" | ...
  downloadUrl: string;
  primary?: boolean;
}

export interface CivitaiModelVersion {
  id: number;
  name: string;
  baseModel: string; // "SDXL 1.0", "Pony", "Illustrious", "SD 1.5", "Flux.1 D"...
  availability?: string; // "Public" = бесплатно; "EarlyAccess"/иное — может быть платно
  earlyAccessEndsAt?: string; // если задано и в будущем — версия в платном раннем доступе
  status?: string; // "Published" — опубликована
  downloadUrl?: string;
  files: CivitaiFile[];
  images: {
    url: string;
    type?: "image" | "video";
    width: number;
    height: number;
    nsfwLevel?: number;
  }[];
  trainedWords?: string[];
}

export type CivitaiModelType =
  | "Checkpoint"
  | "LORA"
  | "LoCon"
  | "TextualInversion"
  | "VAE"
  | "Hypernetwork";

export interface CivitaiModel {
  id: number;
  name: string;
  type: CivitaiModelType;
  nsfw: boolean;
  creator?: { username: string };
  modelVersions: CivitaiModelVersion[];
}

// --- Запрос на генерацию (то, что шлёт фронт) ---

export interface ExtraResource {
  // дополнительный источник (LoRA / embedding / VAE)
  modelId: number; // id модели Civitai — нужен для пейдж-URL ноды загрузки
  modelVersionId: number;
  name: string;
  type: CivitaiModelType;
  baseModel: string; // нужен для проверки совместимости с чекпойнтом
  downloadUrl: string;
  strength?: number; // вес для LoRA, по умолчанию 1.0
  trainedWords?: string[];
}

export interface GenerateRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: AspectRatio;
  // основной чекпойнт
  checkpoint: {
    modelId: number;
    modelVersionId: number;
    name: string;
    baseModel: string;
    downloadUrl: string;
  };
  extras: ExtraResource[];
  steps?: number;
  cfgScale?: number;
  seed?: number;
}

// --- Ответ задачи ---

export type JobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export interface JobResult {
  id: string;
  status: JobStatus;
  images?: string[]; // base64 data URLs или внешние URL
  error?: string; // короткое сообщение для UI
  errorDetails?: string; // полный текст/стектрейс воркера (для отладки)
}
