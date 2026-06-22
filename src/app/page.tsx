"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AspectRatio,
  CivitaiModel,
  CivitaiModelType,
  ExtraResource,
  GenerateRequest,
  JobResult,
} from "@/lib/types";
import { isCompatible, incompatibilityReason } from "@/lib/compatibility";

const RATIOS: AspectRatio[] = ["2:3", "1:1", "3:2"];

// Первое превью-ИЗОБРАЖЕНИЕ версии (пропускаем video/.mp4, которые <img> не рисует).
function previewImage(v?: CivitaiModel["modelVersions"][number]): string | undefined {
  const imgs = v?.images ?? [];
  const pic = imgs.find(
    (i) => i.type !== "video" && !/\.(mp4|webm)(\?|$)/i.test(i.url)
  );
  return pic?.url;
}

type ModelVersion = CivitaiModel["modelVersions"][number];

// Бесплатная и доступная версия: опубликована, Public, не в платном раннем доступе.
function isFreeVersion(ver: ModelVersion): boolean {
  if (ver.status && ver.status !== "Published") return false;
  if (ver.availability && ver.availability !== "Public") return false;
  // платный ранний доступ: дата окончания в будущем
  if (ver.earlyAccessEndsAt) {
    const ends = new Date(ver.earlyAccessEndsAt).getTime();
    if (!Number.isNaN(ends) && ends > Date.now()) return false;
  }
  return true;
}

// Последняя бесплатная версия чекпойнта (версии приходят новейшими первыми).
// Если все платные — берём первую как фолбэк.
function freeCheckpointVersion(m: CivitaiModel): ModelVersion | undefined {
  const versions = m.modelVersions ?? [];
  return versions.find(isFreeVersion) ?? versions[0];
}

// Версия LoRA, совместимая с baseModel чекпойнта И бесплатная.
// У одной LoRA бывает много версий под разные базы (SD1.5/Pony/SDXL/...).
function compatibleVersion(
  m: CivitaiModel,
  ckptBase?: string
): ModelVersion | undefined {
  const versions = m.modelVersions ?? [];
  const compatible = ckptBase
    ? versions.filter((ver) => isCompatible(ckptBase, ver.baseModel))
    : versions;
  // среди совместимых предпочитаем бесплатную; иначе любую совместимую
  return compatible.find(isFreeVersion) ?? compatible[0];
}

interface PickedCheckpoint {
  modelId: number;
  modelVersionId: number;
  name: string;
  baseModel: string;
  downloadUrl: string;
  preview?: string;
  versions: ModelVersion[]; // все версии модели — для выбора в выпадашке
}

export default function Home() {
  const [tab, setTab] = useState<"checkpoint" | "extra">("checkpoint");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CivitaiModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [checkpoint, setCheckpoint] = useState<PickedCheckpoint | null>(null);
  const [extras, setExtras] = useState<ExtraResource[]>([]);

  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("2:3");

  const [job, setJob] = useState<JobResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // nextCursor=null — новый поиск (заменяем); строка — подгрузка (добавляем).
  // Civitai пагинирует курсором: page игнорируется, нужен metadata.nextCursor.
  const search = useCallback(
    async (nextCursor: string | null = null) => {
      if (nextCursor === null) setSearching(true);
      else setLoadingMore(true);
      setError(null);
      try {
        // доп. источники: пока только LoRA (embeddings/TextualInversion не поддержаны)
        const types: CivitaiModelType[] =
          tab === "checkpoint" ? ["Checkpoint"] : ["LORA", "LoCon"];
        const sp = new URLSearchParams();
        if (query) sp.set("query", query);
        for (const t of types) sp.append("types", t);
        sp.set("limit", "24");
        if (nextCursor) sp.set("cursor", nextCursor);
        const res = await fetch(`/api/civitai/search?${sp.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Поиск не удался");
        const items: CivitaiModel[] = data.items ?? [];
        setResults((prev) => {
          if (nextCursor === null) return items;
          // дедуп по id на случай пересечений между страницами
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...items.filter((m) => !seen.has(m.id))];
        });
        const nc: string | undefined = data.metadata?.nextCursor;
        setCursor(nc ?? null);
        setHasMore(Boolean(nc));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка поиска");
      } finally {
        setSearching(false);
        setLoadingMore(false);
      }
    },
    [query, tab]
  );

  // первичная загрузка / смена вкладки — всегда с начала
  useEffect(() => {
    search(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // применяет выбранную версию чекпойнта + чистит несовместимые доп. источники
  function applyCheckpointVersion(
    m: CivitaiModel,
    v: ModelVersion,
    allVersions: ModelVersion[]
  ) {
    const file = v.files?.find((f) => f.primary) ?? v.files?.[0];
    const downloadUrl = file?.downloadUrl ?? v.downloadUrl ?? "";
    setCheckpoint({
      modelId: m.id,
      modelVersionId: v.id,
      name: m.name,
      baseModel: v.baseModel,
      downloadUrl,
      preview: previewImage(v) ?? previewImage(allVersions[0]),
      versions: allVersions,
    });
    // выкидываем доп. источники, которые стали несовместимы с новой базой
    setExtras((prev) => {
      const kept = prev.filter((e) => isCompatible(v.baseModel, e.baseModel));
      const dropped = prev.filter((e) => !isCompatible(v.baseModel, e.baseModel));
      if (dropped.length > 0) {
        setError("Несовместимые доп. источники убраны после смены версии");
        for (const d of dropped) {
          if (d.trainedWords?.length) removeWordsFromPrompt(d.trainedWords);
        }
      }
      return kept;
    });
  }

  // смена версии уже выбранного чекпойнта из выпадашки
  function changeCheckpointVersion(versionId: number) {
    if (!checkpoint) return;
    const v = checkpoint.versions.find((x) => x.id === versionId);
    if (!v) return;
    const file = v.files?.find((f) => f.primary) ?? v.files?.[0];
    const downloadUrl = file?.downloadUrl ?? v.downloadUrl ?? "";
    setCheckpoint({
      ...checkpoint,
      modelVersionId: v.id,
      baseModel: v.baseModel,
      downloadUrl,
      preview: previewImage(v) ?? checkpoint.preview,
    });
    setExtras((prev) => {
      const kept = prev.filter((e) => isCompatible(v.baseModel, e.baseModel));
      const dropped = prev.filter((e) => !isCompatible(v.baseModel, e.baseModel));
      if (dropped.length > 0) {
        setError("Несовместимые доп. источники убраны после смены версии");
        for (const d of dropped) {
          if (d.trainedWords?.length) removeWordsFromPrompt(d.trainedWords);
        }
      }
      return kept;
    });
  }

  function pickModel(m: CivitaiModel) {
    if (m.type === "Checkpoint") {
      const versions = m.modelVersions ?? [];
      const v = freeCheckpointVersion(m);
      if (!v) return;
      applyCheckpointVersion(m, v, versions);
    } else {
      // нельзя добавить доп. источник без выбранной модели
      if (!checkpoint) {
        setError("Сначала выбери модель (checkpoint)");
        return;
      }
      // подбираем версию LoRA, совместимую с чекпойнтом (а не modelVersions[0])
      const v = compatibleVersion(m, checkpoint.baseModel);
      if (!v) {
        setError("У этой LoRA нет версии под выбранную модель");
        return;
      }
      const file = v.files?.find((f) => f.primary) ?? v.files?.[0];
      const downloadUrl = file?.downloadUrl ?? v.downloadUrl ?? "";
      // не добавляем дубликаты
      if (extras.some((e) => e.modelVersionId === v.id)) return;
      setError(null);
      const words = v.trainedWords ?? [];
      setExtras((prev) => [
        ...prev,
        {
          modelId: m.id,
          modelVersionId: v.id,
          name: m.name,
          type: m.type,
          baseModel: v.baseModel,
          downloadUrl,
          strength: 1.0,
          trainedWords: words,
        },
      ]);
      // авто-вставляем триггер-слова LoRA в промт (юзер может поправить)
      if (words.length > 0) addWordsToPrompt(words);
    }
  }

  function removeExtra(id: number) {
    const removed = extras.find((e) => e.modelVersionId === id);
    setExtras((prev) => prev.filter((e) => e.modelVersionId !== id));
    if (removed?.trainedWords?.length) removeWordsFromPrompt(removed.trainedWords);
  }

  // --- управление триггер-словами LoRA в промте ---

  function addWordsToPrompt(words: string[]) {
    setPrompt((prev) => {
      const existing = prev.trim();
      // не дублируем уже присутствующие слова
      const toAdd = words.filter(
        (w) => w.trim() && !existing.toLowerCase().includes(w.trim().toLowerCase())
      );
      if (toAdd.length === 0) return prev;
      const joined = toAdd.join(", ");
      return existing ? `${existing}, ${joined}` : joined;
    });
  }

  function removeWordsFromPrompt(words: string[]) {
    setPrompt((prev) => {
      let text = prev;
      for (const w of words) {
        const word = w.trim();
        if (!word) continue;
        // убираем слово вместе с окружающими запятыми/пробелами
        const re = new RegExp(
          `\\s*,?\\s*${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?`,
          "gi"
        );
        text = text.replace(re, ", ");
      }
      // чистим лишние запятые/пробелы
      return text
        .replace(/\s*,\s*,+/g, ", ")
        .replace(/^\s*,\s*/, "")
        .replace(/\s*,\s*$/, "")
        .trim();
    });
  }

  function setStrength(id: number, strength: number) {
    setExtras((prev) =>
      prev.map((e) => (e.modelVersionId === id ? { ...e, strength } : e))
    );
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(
    (id: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${id}`);
          const data: JobResult = await res.json();
          setJob(data);
          if (
            ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(
              data.status
            )
          ) {
            stopPolling();
            setGenerating(false);
            // ошибка возможна и при COMPLETED (воркер вернул error вместо картинки)
            if (data.error) {
              setError(data.error);
            } else if (data.status !== "COMPLETED") {
              setError(`Задача завершилась: ${data.status}`);
            }
          }
        } catch {
          stopPolling();
          setGenerating(false);
          setError("Потеряна связь с задачей");
        }
      }, 2500);
    },
    [stopPolling]
  );

  useEffect(() => stopPolling, [stopPolling]);

  async function generate() {
    if (!checkpoint) {
      setError("Сначала выбери модель (checkpoint)");
      return;
    }
    if (!prompt.trim()) {
      setError("Введи промт");
      return;
    }
    setError(null);
    setJob(null);
    setGenerating(true);
    // прокрутим к блоку результата, чтобы он был сразу виден
    requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );

    const body: GenerateRequest = {
      prompt,
      negativePrompt: negative,
      aspectRatio: ratio,
      checkpoint: {
        modelId: checkpoint.modelId,
        modelVersionId: checkpoint.modelVersionId,
        name: checkpoint.name,
        baseModel: checkpoint.baseModel,
        downloadUrl: checkpoint.downloadUrl,
      },
      extras,
    };

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось запустить");
      setJob({ id: data.id, status: "IN_QUEUE" });
      poll(data.id);
    } catch (e) {
      setGenerating(false);
      setError(e instanceof Error ? e.message : "Ошибка генерации");
    }
  }

  return (
    <div className="container">
      <header className="header">
        <div className="logo">
          Civit<span>Sky</span>
        </div>
        <span className="muted">модели Civitai · генерация на RunPod</span>
      </header>

      <div className="layout">
        {/* Левая колонка — настройки */}
        <aside>
          <div className="panel">
            <div className="label">Выбранная модель</div>
            {checkpoint ? (
              <div className="row">
                {checkpoint.preview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={checkpoint.preview}
                    alt=""
                    width={48}
                    height={64}
                    style={{ borderRadius: 6, objectFit: "cover" }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14 }}>{checkpoint.name}</div>
                  <div className="card-meta">{checkpoint.baseModel}</div>
                </div>
              </div>
            ) : (
              <div className="muted">не выбрана</div>
            )}

            {checkpoint && checkpoint.versions.length > 1 && (
              <>
                <div className="label">Версия модели</div>
                <select
                  value={checkpoint.modelVersionId}
                  onChange={(e) =>
                    changeCheckpointVersion(Number(e.target.value))
                  }
                >
                  {checkpoint.versions.map((ver) => {
                    const free = isFreeVersion(ver);
                    return (
                      <option key={ver.id} value={ver.id}>
                        {ver.name} · {ver.baseModel}
                        {free ? "" : " (платно/ранний доступ)"}
                      </option>
                    );
                  })}
                </select>
              </>
            )}

            <div className="label">Доп. источники (LoRA / embeddings)</div>
            {extras.length === 0 && <div className="muted">нет</div>}
            {extras.map((e) => (
              <div key={e.modelVersionId} className="chip">
                {e.name}
                <input
                  type="text"
                  inputMode="decimal"
                  value={e.strength ?? 1}
                  onChange={(ev) =>
                    setStrength(e.modelVersionId, Number(ev.target.value) || 0)
                  }
                  style={{ width: 48, padding: "2px 6px", fontSize: 12 }}
                  title="вес"
                />
                <button onClick={() => removeExtra(e.modelVersionId)}>✕</button>
              </div>
            ))}

            <div className="label">Промт</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="что нарисовать…"
            />

            <div className="label">Негативный промт</div>
            <textarea
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="чего избегать…"
            />

            <div className="label">Формат</div>
            <div className="ratios">
              {RATIOS.map((r) => (
                <div
                  key={r}
                  className={`ratio ${ratio === r ? "active" : ""}`}
                  onClick={() => setRatio(r)}
                >
                  {r}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                className="btn"
                onClick={generate}
                disabled={generating || !checkpoint}
              >
                {generating ? "Генерация…" : "Сгенерировать"}
              </button>
            </div>

            {error && (
              <div style={{ marginTop: 10 }}>
                <div style={{ color: "#ff6b6b", fontSize: 13 }}>{error}</div>
                {job?.errorDetails && (
                  <details style={{ marginTop: 6 }}>
                    <summary
                      style={{
                        cursor: "pointer",
                        fontSize: 12,
                        color: "var(--muted)",
                      }}
                    >
                      Подробности ошибки воркера
                    </summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontSize: 11,
                        color: "var(--muted)",
                        background: "var(--panel-2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 8,
                        marginTop: 6,
                        maxHeight: 220,
                        overflow: "auto",
                      }}
                    >
                      {job.errorDetails}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Правая колонка — результат сверху + поиск моделей */}
        <main>
          {(job || generating) && (
            <div className="panel result-panel" ref={resultRef}>
              <div className="label">
                Результат{" "}
                {job?.status && <span className="muted">· {job.status}</span>}
              </div>
              {generating && !job?.images && (
                <div className="row">
                  <span className="spinner" /> ждём воркер… (первый раз дольше —
                  качаются модели)
                </div>
              )}
              {job?.images && (
                <div className="result">
                  {job.images.map((src, i) => (
                    // src уже готов (data: или http) — формирует runpod.ts
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={src} alt={`result ${i}`} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="panel">
            <div className="tabs">
              <div
                className={`tab ${tab === "checkpoint" ? "active" : ""}`}
                onClick={() => setTab("checkpoint")}
              >
                Модели
              </div>
              <div
                className={`tab ${tab === "extra" ? "active" : ""}`}
                onClick={() => setTab("extra")}
              >
                Доп. источники
              </div>
            </div>

            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                search(null);
              }}
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  tab === "checkpoint" ? "поиск модели…" : "поиск LoRA…"
                }
              />
              <button className="btn btn-sm" type="submit" disabled={searching}>
                {searching ? <span className="spinner" /> : "Найти"}
              </button>
            </form>

            <div className="grid" style={{ marginTop: 12 }}>
              {results.map((m) => {
                // для LoRA — совместимую версию; для чекпойнта — последнюю бесплатную
                const v =
                  m.type === "Checkpoint"
                    ? freeCheckpointVersion(m)
                    : compatibleVersion(m, checkpoint?.baseModel);
                // LoRA без совместимой версии не показываем вовсе
                if (m.type !== "Checkpoint" && checkpoint && !v) return null;
                // превью берём из совместимой версии, с фолбэком на первую
                const img = previewImage(v) ?? previewImage(m.modelVersions?.[0]);
                const selected =
                  m.type === "Checkpoint"
                    ? checkpoint?.modelVersionId === v?.id
                    : extras.some((e) => e.modelVersionId === v?.id);
                return (
                  <div
                    key={m.id}
                    className={`card ${selected ? "selected" : ""}`}
                    onClick={() => pickModel(m)}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={m.name} />
                    ) : (
                      <div className="no-preview">нет превью</div>
                    )}
                    <div className="card-body">
                      <div className="card-title">{m.name}</div>
                      <div className="card-meta">
                        {m.type} · {v?.baseModel}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {results.length === 0 && !searching && (
              <div className="muted" style={{ marginTop: 12 }}>
                Ничего не найдено
              </div>
            )}
            {hasMore && results.length > 0 && (
              <div style={{ marginTop: 16, textAlign: "center" }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => cursor && search(cursor)}
                  disabled={loadingMore || !cursor}
                >
                  {loadingMore ? <span className="spinner" /> : "Загрузить ещё"}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
