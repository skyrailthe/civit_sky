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
    if (srcs.length === 0) {
      result.error = "Воркер не вернул изображений";
    }
  }
  if (status === "FAILED" || status === "TIMED_OUT") {
    result.error =
      typeof data.error === "string"
        ? data.error
        : "Generation failed on worker";
  }
  return result;
}
