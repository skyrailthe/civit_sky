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

interface PickedCheckpoint {
  modelVersionId: number;
  name: string;
  baseModel: string;
  downloadUrl: string;
  preview?: string;
}

export default function Home() {
  const [tab, setTab] = useState<"checkpoint" | "extra">("checkpoint");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CivitaiModel[]>([]);
  const [searching, setSearching] = useState(false);

  const [checkpoint, setCheckpoint] = useState<PickedCheckpoint | null>(null);
  const [extras, setExtras] = useState<ExtraResource[]>([]);

  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("2:3");

  const [job, setJob] = useState<JobResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const search = useCallback(async () => {
    setSearching(true);
    setError(null);
    try {
      // доп. источники: пока только LoRA (embeddings/TextualInversion не поддержаны)
      const types: CivitaiModelType[] =
        tab === "checkpoint" ? ["Checkpoint"] : ["LORA", "LoCon"];
      const sp = new URLSearchParams();
      if (query) sp.set("query", query);
      for (const t of types) sp.append("types", t);
      sp.set("limit", "24");
      const res = await fetch(`/api/civitai/search?${sp.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Поиск не удался");
      setResults(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка поиска");
    } finally {
      setSearching(false);
    }
  }, [query, tab]);

  // первичная загрузка популярных моделей
  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function pickModel(m: CivitaiModel) {
    const v = m.modelVersions?.[0];
    if (!v) return;
    const file = v.files?.find((f) => f.primary) ?? v.files?.[0];
    const downloadUrl = file?.downloadUrl ?? v.downloadUrl ?? "";
    const preview = v.images?.[0]?.url;

    if (m.type === "Checkpoint") {
      setCheckpoint({
        modelVersionId: v.id,
        name: m.name,
        baseModel: v.baseModel,
        downloadUrl,
        preview,
      });
      // при смене модели выкидываем доп. источники, которые стали несовместимы
      setExtras((prev) => {
        const kept = prev.filter((e) => isCompatible(v.baseModel, e.baseModel));
        if (kept.length !== prev.length) {
          setError(
            "Несовместимые доп. источники убраны после смены модели"
          );
        }
        return kept;
      });
    } else {
      // нельзя добавить доп. источник без выбранной модели
      if (!checkpoint) {
        setError("Сначала выбери модель (checkpoint)");
        return;
      }
      // блокируем несовместимое с текущим чекпойнтом
      const reason = incompatibilityReason(checkpoint.baseModel, v.baseModel);
      if (reason) {
        setError(reason);
        return;
      }
      // не добавляем дубликаты
      if (extras.some((e) => e.modelVersionId === v.id)) return;
      setError(null);
      setExtras((prev) => [
        ...prev,
        {
          modelVersionId: v.id,
          name: m.name,
          type: m.type,
          baseModel: v.baseModel,
          downloadUrl,
          strength: 1.0,
          trainedWords: v.trainedWords,
        },
      ]);
    }
  }

  function removeExtra(id: number) {
    setExtras((prev) => prev.filter((e) => e.modelVersionId !== id));
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
            if (data.status !== "COMPLETED") {
              setError(data.error || `Задача завершилась: ${data.status}`);
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

    const body: GenerateRequest = {
      prompt,
      negativePrompt: negative,
      aspectRatio: ratio,
      checkpoint: {
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
                <div>
                  <div style={{ fontSize: 14 }}>{checkpoint.name}</div>
                  <div className="card-meta">{checkpoint.baseModel}</div>
                </div>
              </div>
            ) : (
              <div className="muted">не выбрана</div>
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
              <div style={{ color: "#ff6b6b", fontSize: 13, marginTop: 10 }}>
                {error}
              </div>
            )}
          </div>
        </aside>

        {/* Правая колонка — поиск моделей + результат */}
        <main>
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
                search();
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
                const v = m.modelVersions?.[0];
                const img = v?.images?.[0]?.url;
                const selected =
                  m.type === "Checkpoint"
                    ? checkpoint?.modelVersionId === v?.id
                    : extras.some((e) => e.modelVersionId === v?.id);
                // несовместимость считаем только для доп. источников при выбранной модели
                const incompatible =
                  m.type !== "Checkpoint" &&
                  !!checkpoint &&
                  !isCompatible(checkpoint.baseModel, v?.baseModel);
                return (
                  <div
                    key={m.id}
                    className={`card ${selected ? "selected" : ""} ${
                      incompatible ? "incompatible" : ""
                    }`}
                    onClick={() => !incompatible && pickModel(m)}
                    title={
                      incompatible
                        ? `Несовместимо с ${checkpoint?.baseModel}`
                        : undefined
                    }
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img} alt={m.name} />
                    ) : (
                      <div style={{ aspectRatio: "3/4", background: "#000" }} />
                    )}
                    <div className="card-body">
                      <div className="card-title">{m.name}</div>
                      <div className="card-meta">
                        {m.type} · {v?.baseModel}
                        {incompatible && (
                          <span className="badge-incompat">несовместимо</span>
                        )}
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
          </div>

          {(job || generating) && (
            <div className="panel">
              <div className="label">
                Результат{" "}
                {job?.status && (
                  <span className="muted">· {job.status}</span>
                )}
              </div>
              {generating && !job?.images && (
                <div className="row">
                  <span className="spinner" /> ждём воркер…
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
        </main>
      </div>
    </div>
  );
}
