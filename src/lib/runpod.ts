import type { GenerateRequest, JobResult, JobStatus } from "./types";
import { buildComfyWorkflow } from "./workflow";

const RUNPOD_API = "https://api.runpod.ai/v2";

function endpoint(): string {
  const id = process.env.RUNPOD_ENDPOINT_ID;
  if (!id) throw new Error("RUNPOD_ENDPOINT_ID is not set");
  return `${RUNPOD_API}/${id}`;
}

function headers(): HeadersInit {
  const key = process.env.RUNPOD_API_KEY;
  if (!key) throw new Error("RUNPOD_API_KEY is not set");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

/**
 * Payload для worker-comfyui: input.workflow = ComfyUI граф в API-формате.
 * Токен Civitai НЕ передаём в JSON — нода AssetDownloader читает его из
 * env воркера ($CIVITAI_TOKEN), см. workflow.ts и README воркера.
 */
export function buildWorkerInput(req: GenerateRequest) {
  return { workflow: buildComfyWorkflow(req) };
}

export async function startJob(req: GenerateRequest): Promise<{ id: string }> {
  const res = await fetch(`${endpoint()}/run`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ input: buildWorkerInput(req) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RunPod run failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return { id: data.id as string };
}

interface ComfyImage {
  filename?: string;
  type?: "base64" | "s3_url";
  data?: string;
}

/** Превращает элемент output.images воркера в src для <img>. */
function imageToSrc(img: ComfyImage | string): string | null {
  if (typeof img === "string") {
    return img.startsWith("data:") || img.startsWith("http")
      ? img
      : `data:image/png;base64,${img}`;
  }
  if (!img?.data) return null;
  if (img.type === "s3_url") return img.data; // уже URL
  return `data:image/png;base64,${img.data}`;
}

export async function getJob(id: string): Promise<JobResult> {
  const res = await fetch(`${endpoint()}/status/${id}`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`RunPod status failed: ${res.status} ${text}`);
  }
  const data = await res.json();

  const status = data.status as JobStatus;
  const result: JobResult = { id, status };

  if (status === "COMPLETED") {
    const out = data.output;
    const raw: (ComfyImage | string)[] = Array.isArray(out?.images)
      ? out.images
      : Array.isArray(out)
        ? out
        : [];
    const srcs = raw
      .map(imageToSrc)
      .filter((s): s is string => Boolean(s));
    result.images = srcs;
    // worker-comfyui может вернуть COMPLETED, но с ошибкой внутри output
    if (srcs.length === 0) {
      const detail = extractError(data);
      result.error = detail
        ? "Воркер вернул ошибку вместо изображения"
        : "Воркер не вернул изображений";
      result.errorDetails = detail ?? JSON.stringify(data.output ?? data);
      console.error(`[runpod ${id}] COMPLETED без изображений:`, result.errorDetails);
    }
  }
  if (status === "FAILED" || status === "TIMED_OUT") {
    const detail = extractError(data);
    result.error = detail
      ? firstLine(detail)
      : status === "TIMED_OUT"
        ? "Задача превысила лимит времени"
        : "Генерация упала на воркере";
    result.errorDetails = detail ?? JSON.stringify(data, null, 2);
    console.error(`[runpod ${id}] ${status}:`, result.errorDetails);
  }
  return result;
}

/** Достаёт человекочитаемую ошибку из всех мест, где RunPod/ComfyUI её прячут. */
function extractError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  // 1. Прямое поле error
  const direct = stringifyMaybe(d.error);
  if (direct) return direct;

  // 2. Внутри output (worker-comfyui кладёт сюда {error, message, ...})
  const out = d.output;
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    const oErr = stringifyMaybe(o.error) ?? stringifyMaybe(o.message);
    if (oErr) return oErr;
    // ComfyUI prompt-validation: node_errors / errors
    if (o.node_errors) return JSON.stringify(o.node_errors);
    if (o.errors) return JSON.stringify(o.errors);
  }

  // 3. Иногда строкой прямо в output
  const outStr = stringifyMaybe(out);
  if (outStr) return outStr;

  return null;
}

function stringifyMaybe(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    try {
      return JSON.stringify(v);
    } catch {
      return null;
    }
  }
  return String(v);
}

function firstLine(s: string): string {
  const line = s.split("\n")[0].trim();
  return line.length > 200 ? line.slice(0, 200) + "…" : line;
}
