import type { CivitaiModel, CivitaiModelType } from "./types";

const CIVITAI_API = "https://civitai.com/api/v1";

function authHeaders(): HeadersInit {
  const token = process.env.CIVITAI_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface SearchParams {
  query?: string;
  types?: CivitaiModelType[];
  baseModels?: string[];
  limit?: number;
  cursor?: string; // Civitai пагинирует курсором, а не page (page игнорируется)
  nsfw?: boolean;
  sort?: "Highest Rated" | "Most Downloaded" | "Newest";
}

export interface SearchResult {
  items: CivitaiModel[];
  metadata: {
    nextCursor?: string;
    nextPage?: string;
    totalItems?: number;
    currentPage?: number;
    pageSize?: number;
  };
}

export async function searchModels(params: SearchParams): Promise<SearchResult> {
  const sp = new URLSearchParams();
  if (params.query) sp.set("query", params.query);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.sort) sp.set("sort", params.sort);
  if (typeof params.nsfw === "boolean") sp.set("nsfw", String(params.nsfw));
  for (const t of params.types ?? []) sp.append("types", t);
  for (const b of params.baseModels ?? []) sp.append("baseModels", b);

  const res = await fetch(`${CIVITAI_API}/models?${sp.toString()}`, {
    headers: authHeaders(),
    // кэшируем поиск ненадолго
    next: { revalidate: 60 },
  });

  if (!res.ok) {
    throw new Error(`Civitai search failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as SearchResult;
}

export async function getModel(id: number): Promise<CivitaiModel> {
  const res = await fetch(`${CIVITAI_API}/models/${id}`, {
    headers: authHeaders(),
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Civitai getModel failed: ${res.status}`);
  }
  return (await res.json()) as CivitaiModel;
}

export async function getModelVersion(versionId: number) {
  const res = await fetch(`${CIVITAI_API}/model-versions/${versionId}`, {
    headers: authHeaders(),
    next: { revalidate: 300 },
  });
  if (!res.ok) {
    throw new Error(`Civitai getModelVersion failed: ${res.status}`);
  }
  return await res.json();
}

// --- Поиск картинок (галерея / референсы) ---

export interface CivitaiImage {
  id: number;
  url: string;
  width: number;
  height: number;
  type?: "image" | "video";
  nsfwLevel?: string;
  meta?: { prompt?: string; negativePrompt?: string } | null;
}

export interface ImagesResult {
  items: CivitaiImage[];
  metadata: { nextCursor?: string };
}

export interface ImagesParams {
  modelVersionId?: number; // картинки конкретной версии модели/LoRA
  username?: string;
  limit?: number;
  cursor?: string;
  nsfw?: boolean;
  sort?: "Most Reactions" | "Most Comments" | "Newest";
}

export async function searchImages(params: ImagesParams): Promise<ImagesResult> {
  const sp = new URLSearchParams();
  if (params.modelVersionId)
    sp.set("modelVersionId", String(params.modelVersionId));
  if (params.username) sp.set("username", params.username);
  sp.set("limit", String(params.limit ?? 30));
  if (params.cursor) sp.set("cursor", params.cursor);
  if (params.sort) sp.set("sort", params.sort);
  sp.set("nsfw", String(params.nsfw ?? true));

  const res = await fetch(`${CIVITAI_API}/images?${sp.toString()}`, {
    headers: authHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) {
    throw new Error(`Civitai images failed: ${res.status}`);
  }
  return (await res.json()) as ImagesResult;
}
