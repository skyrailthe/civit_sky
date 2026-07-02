"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AspectRatio,
  CivitaiModel,
  CivitaiModelType,
  ExtraResource,
  GenerateRequest,
  JobResult,
  JobStatus,
} from "@/lib/types";
import {
  isCompatible,
  incompatibilityReason,
  isSupportedFamily,
} from "@/lib/compatibility";
import { presetFor } from "@/lib/presets";

const RATIOS: AspectRatio[] = ["2:3", "1:1", "3:2"];

// Фильтр поиска по семейству → конкретные baseModels Civitai (для параметра API).
const FAMILY_FILTERS: { label: string; baseModels: string[] }[] = [
  { label: "Все", baseModels: [] },
  { label: "SD 1.5", baseModels: ["SD 1.5", "SD 1.4"] },
  {
    label: "SDXL",
    baseModels: ["SDXL 1.0", "SDXL 0.9", "SDXL Lightning", "SDXL Hyper"],
  },
  { label: "Pony", baseModels: ["Pony"] },
  { label: "Illustrious", baseModels: ["Illustrious", "NoobAI"] },
  { label: "Flux", baseModels: ["Flux.1 D", "Flux.1 S"] },
];

// Первое превью-ИЗОБРАЖЕНИЕ версии (пропускаем video/.mp4, которые <img> не рисует).
function previewImage(v?: CivitaiModel["modelVersions"][number]): string | undefined {
  const imgs = v?.images ?? [];
  const pic = imgs.find(
    (i) => i.type !== "video" && !/\.(mp4|webm)(\?|$)/i.test(i.url)
  );
  return pic?.url;
}

type ModelVersion = CivitaiModel["modelVersions"][number];

// Чекпойнт поддержан, если ХОТЯ БЫ одна версия — известной поддержанной
// архитектуры (SD1.5/SDXL/Pony/Illustrious/Flux.1). Видео и экзотику скрываем.
function isSupportedCheckpoint(m: CivitaiModel): boolean {
  return (m.modelVersions ?? []).some((v) => isSupportedFamily(v.baseModel));
}

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
  const [tab, setTab] = useState<"checkpoint" | "extra" | "gallery">(
    "checkpoint"
  );
  // отдельная строка поиска для вкладок поиска (у галереи своего поиска нет)
  const [queries, setQueries] = useState<{ checkpoint: string; extra: string }>(
    { checkpoint: "", extra: "" }
  );
  const query = tab === "gallery" ? "" : queries[tab];
  const setQuery = (val: string) =>
    tab !== "gallery" &&
    setQueries((prev) => ({ ...prev, [tab]: val }));
  const [familyFilter, setFamilyFilter] = useState(0); // индекс в FAMILY_FILTERS

  // галерея картинок последней выбранной LoRA
  const [galleryFor, setGalleryFor] = useState<ExtraResource | null>(null);
  const [galleryImages, setGalleryImages] = useState<
    { id: number; url: string; prompt?: string }[]
  >([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [results, setResults] = useState<CivitaiModel[]>([]);
  const [searching, setSearching] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const [checkpoint, setCheckpoint] = useState<PickedCheckpoint | null>(null);
  const [extras, setExtras] = useState<ExtraResource[]>([]);

  const [loraPrompt, setLoraPrompt] = useState(""); // триггер-слова LoRA (авто)
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [ratio, setRatio] = useState<AspectRatio>("2:3");
  const [steps, setSteps] = useState(28);
  const [cfg, setCfg] = useState(6);
  const [seed, setSeed] = useState(""); // пусто = случайный
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [job, setJob] = useState<JobResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // история генераций (картинка + промт), хранится в localStorage
  const [history, setHistory] = useState<
    { id: string; src: string; prompt: string; at: number }[]
  >([]);

  // индикатор прогресса (стоковый воркер не шлёт шаги — оцениваем по времени)
  const [elapsed, setElapsed] = useState(0); // секунды с момента старта
  const startedAtRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        // фильтр по семейству (для обеих вкладок поиска)
        for (const bm of FAMILY_FILTERS[familyFilter].baseModels)
          sp.append("baseModels", bm);
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
    [query, tab, familyFilter]
  );

  // первичная загрузка / смена вкладки или фильтра — всегда с начала
  useEffect(() => {
    if (tab !== "gallery") search(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, familyFilter]);

  // история: загрузка из localStorage при старте
  useEffect(() => {
    try {
      const raw = localStorage.getItem("civitsky_history");
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // добавить результат в историю (храним последние 12, base64 тяжёлый)
  const HISTORY_LIMIT = 12;
  function pushHistory(src: string, promptText: string) {
    setHistory((prev) => {
      const next = [
        { id: `${Date.now()}-${Math.random()}`, src, prompt: promptText, at: Date.now() },
        ...prev,
      ].slice(0, HISTORY_LIMIT);
      try {
        localStorage.setItem("civitsky_history", JSON.stringify(next));
      } catch {
        // переполнение квоты — обрежем ещё сильнее
        try {
          localStorage.setItem(
            "civitsky_history",
            JSON.stringify(next.slice(0, 6))
          );
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }

  // загрузка картинок галереи выбранной LoRA
  useEffect(() => {
    if (!galleryFor) {
      setGalleryImages([]);
      return;
    }
    let cancelled = false;
    setGalleryLoading(true);
    fetch(`/api/civitai/images?modelVersionId=${galleryFor.modelVersionId}&limit=30`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const imgs = (data.items ?? [])
          .filter(
            (i: { type?: string; url: string }) =>
              i.type !== "video" && !/\.(mp4|webm)(\?|$)/i.test(i.url)
          )
          .map((i: { id: number; url: string; meta?: { prompt?: string } }) => ({
            id: i.id,
            url: i.url,
            prompt: i.meta?.prompt,
          }));
        setGalleryImages(imgs);
      })
      .catch(() => !cancelled && setGalleryImages([]))
      .finally(() => !cancelled && setGalleryLoading(false));
    return () => {
      cancelled = true;
    };
  }, [galleryFor]);

  async function copyPromptFromImage(p?: string) {
    if (!p) {
      setError("У этой картинки промт скрыт автором");
      return;
    }
    try {
      await navigator.clipboard.writeText(p);
      setCopied(true);
      setPrompt(p);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setPrompt(p); // хотя бы вставим в поле промта
    }
  }

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
    // подставляем дефолты пресета семейства (steps/CFG)
    const preset = presetFor(v.baseModel);
    setSteps(preset.steps);
    setCfg(preset.cfg);
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
      const added: ExtraResource = {
        modelId: m.id,
        modelVersionId: v.id,
        name: m.name,
        type: m.type,
        baseModel: v.baseModel,
        downloadUrl,
        strength: 1.0,
        trainedWords: words,
      };
      setExtras((prev) => [...prev, added]);
      // авто-вставляем триггер-слова LoRA в промт (юзер может поправить)
      if (words.length > 0) addWordsToPrompt(words);
      // галерея картинок этой LoRA
      setGalleryFor(added);
    }
  }

  function removeExtra(id: number) {
    const removed = extras.find((e) => e.modelVersionId === id);
    setExtras((prev) => prev.filter((e) => e.modelVersionId !== id));
    if (removed?.trainedWords?.length) removeWordsFromPrompt(removed.trainedWords);
  }

  // --- управление триггер-словами LoRA в ОТДЕЛЬНОМ поле LoRA-промта ---

  function addWordsToPrompt(words: string[]) {
    setLoraPrompt((prev) => {
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
    setLoraPrompt((prev) => {
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
    (id: string, promptText: string) => {
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
            if (elapsedTimerRef.current) {
              clearInterval(elapsedTimerRef.current);
              elapsedTimerRef.current = null;
            }
            // ошибка возможна и при COMPLETED (воркер вернул error вместо картинки)
            if (data.error) {
              setError(data.error);
            } else if (data.status !== "COMPLETED") {
              setError(`Задача завершилась: ${data.status}`);
            } else if (data.images?.length) {
              // сохраняем картинки в историю
              for (const src of data.images) pushHistory(src, promptText);
            }
          }
        } catch {
          stopPolling();
          setGenerating(false);
          setError("Потеряна связь с задачей");
        }
      }, 2500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopPolling]
  );

  useEffect(() => stopPolling, [stopPolling]);

  async function generate() {
    if (!checkpoint) {
      setError("Сначала выбери модель (checkpoint)");
      return;
    }
    if (!prompt.trim() && !loraPrompt.trim()) {
      setError("Введи промт");
      return;
    }
    // модели Civitai понимают только английский — блокируем кириллицу
    if (/[а-яё]/i.test(prompt) || /[а-яё]/i.test(negative)) {
      setError(
        "Промт должен быть на английском — модели не понимают русский. Например: 1 man, forest, beard, holding an axe"
      );
      return;
    }
    setError(null);
    setJob(null);
    setGenerating(true);
    // запускаем таймер прогресса
    startedAtRef.current = Date.now();
    setElapsed(0);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    // прокрутим к блоку результата, чтобы он был сразу виден
    requestAnimationFrame(() =>
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    );

    // итоговый промт = триггер-слова LoRA + наш промт
    const fullPrompt = [loraPrompt.trim(), prompt.trim()]
      .filter(Boolean)
      .join(", ");

    const body: GenerateRequest = {
      prompt: fullPrompt,
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
      steps,
      cfgScale: cfg,
      seed: seed.trim() === "" ? undefined : Number(seed),
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
      poll(data.id, fullPrompt);
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
        <aside className="sidebar-sticky">
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
                  <div className="card-meta">
                    {checkpoint.baseModel} · пресет:{" "}
                    {presetFor(checkpoint.baseModel).label}
                  </div>
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

            <div className="label">Промт LoRA (триггер-слова, авто)</div>
            <textarea
              value={loraPrompt}
              onChange={(e) => setLoraPrompt(e.target.value)}
              placeholder="триггер-слова выбранных LoRA…"
              style={{ minHeight: 52 }}
            />

            <div className="label">Промт (только на английском)</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="например: 1 man, forest, beard, holding an axe"
              className={/[а-яё]/i.test(prompt) ? "input-error" : ""}
            />
            {/[а-яё]/i.test(prompt) && (
              <div className="field-hint-error">
                Только английский — модели не понимают русский
              </div>
            )}

            <div className="label">Негативный промт</div>
            <textarea
              value={negative}
              onChange={(e) => setNegative(e.target.value)}
              placeholder="например: blurry, low quality, extra limbs"
              className={/[а-яё]/i.test(negative) ? "input-error" : ""}
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

            <button
              className="advanced-toggle"
              onClick={() => setShowAdvanced((s) => !s)}
              type="button"
            >
              {showAdvanced ? "▾" : "▸"} Параметры генерации
            </button>
            {showAdvanced && (
              <div className="advanced">
                <div className="adv-row">
                  <label>
                    Шаги (steps)
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={steps}
                      onChange={(e) => setSteps(Number(e.target.value) || 1)}
                    />
                  </label>
                  <label>
                    CFG
                    <input
                      type="number"
                      min={1}
                      max={30}
                      step={0.5}
                      value={cfg}
                      onChange={(e) => setCfg(Number(e.target.value) || 1)}
                    />
                  </label>
                </div>
                <label>
                  Seed (пусто = случайный)
                  <div className="row">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={seed}
                      placeholder="случайный"
                      onChange={(e) =>
                        setSeed(e.target.value.replace(/[^0-9]/g, ""))
                      }
                    />
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setSeed("")}
                      title="случайный seed"
                    >
                      🎲
                    </button>
                  </div>
                </label>
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <button
                className="btn"
                onClick={generate}
                disabled={
                  generating ||
                  !checkpoint ||
                  /[а-яё]/i.test(prompt) ||
                  /[а-яё]/i.test(negative)
                }
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

            {(job || generating) && (
              <div ref={resultRef} style={{ marginTop: 16 }}>
                <div className="label">
                  Результат{" "}
                  {job?.status && <span className="muted">· {job.status}</span>}
                </div>
                {generating && !job?.images && (
                  <ProgressIndicator
                    status={job?.status}
                    elapsed={elapsed}
                  />
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

            {history.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div className="label">
                  История{" "}
                  <button
                    className="advanced-toggle"
                    style={{ padding: 0, fontSize: 11 }}
                    onClick={() => {
                      setHistory([]);
                      try {
                        localStorage.removeItem("civitsky_history");
                      } catch {}
                    }}
                  >
                    очистить
                  </button>
                </div>
                <div className="history">
                  {history.map((h) => (
                    <img
                      key={h.id}
                      src={h.src}
                      alt=""
                      title={h.prompt}
                      onClick={() => {
                        setJob({
                          id: h.id,
                          status: "COMPLETED",
                          images: [h.src],
                        });
                        if (h.prompt) setPrompt(h.prompt);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Правая колонка — поиск моделей */}
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
              {galleryFor && (
                <div
                  className={`tab ${tab === "gallery" ? "active" : ""}`}
                  onClick={() => setTab("gallery")}
                  title={`Картинки LoRA: ${galleryFor.name}`}
                >
                  🖼 {galleryFor.name.slice(0, 14)}
                  {galleryFor.name.length > 14 ? "…" : ""}
                </div>
              )}
            </div>

            {tab !== "gallery" && (
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
                <select
                  value={familyFilter}
                  onChange={(e) => setFamilyFilter(Number(e.target.value))}
                  style={{ width: "auto" }}
                  title="Фильтр по семейству"
                >
                  {FAMILY_FILTERS.map((f, i) => (
                    <option key={f.label} value={i}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm"
                  type="submit"
                  disabled={searching}
                >
                  {searching ? <span className="spinner" /> : "Найти"}
                </button>
              </form>
            )}

            {tab === "gallery" && (
              <div>
                <div className="muted" style={{ margin: "8px 0" }}>
                  Картинки пользователей · {galleryFor?.name}
                  {copied && (
                    <span style={{ color: "var(--accent)" }}>
                      {" "}
                      · промт скопирован ✓
                    </span>
                  )}
                </div>
                {galleryLoading && (
                  <div className="row">
                    <span className="spinner" /> загрузка…
                  </div>
                )}
                <div className="grid">
                  {galleryImages.map((g) => (
                    <div
                      key={g.id}
                      className="card"
                      onClick={() => copyPromptFromImage(g.prompt)}
                      title={
                        g.prompt
                          ? "Клик — скопировать промт"
                          : "Промт скрыт автором"
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={g.url} alt="" />
                      <div className="card-body">
                        <div className="card-meta">
                          {g.prompt ? "промт доступен" : "промт скрыт"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {!galleryLoading && galleryImages.length === 0 && (
                  <div className="muted">Нет картинок</div>
                )}
              </div>
            )}

            {tab !== "gallery" && (
            <div className="grid" style={{ marginTop: 12 }}>
              {results.map((m) => {
                // видео-модели наш пайплайн не поддерживает — скрываем
                // скрываем неподдерживаемые архитектуры (видео/Qwen/Chroma/Flux.2/...)
                if (m.type === "Checkpoint" && !isSupportedCheckpoint(m))
                  return null;
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
            )}
            {tab !== "gallery" && results.length === 0 && !searching && (
              <div className="muted" style={{ marginTop: 12 }}>
                Ничего не найдено
              </div>
            )}
            {tab !== "gallery" && hasMore && results.length > 0 && (
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

// Индикатор прогресса без данных от воркера: оцениваем фазу по статусу и времени.
// Стоковый worker-comfyui не стримит шаги, поэтому это оценка, а не точный %.
function ProgressIndicator({
  status,
  elapsed,
}: {
  status?: JobStatus;
  elapsed: number;
}) {
  let phase: string;
  let pct: number;

  if (status === "IN_QUEUE" || !status) {
    phase = "В очереди — ждём свободный воркер…";
    pct = 8;
  } else if (elapsed < 25) {
    // первые ~25с обычно уходят на холодный старт + скачивание модели
    phase = "Подготовка воркера и загрузка модели…";
    pct = 10 + Math.min(40, elapsed * 1.6);
  } else {
    phase = "Генерация изображения…";
    // асимптотически приближаемся к 95%, не достигая 100 до завершения
    pct = Math.min(95, 50 + (elapsed - 25) * 1.5);
  }

  return (
    <div className="progress-box">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: 13 }}>{phase}</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {elapsed}s
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
        Первая генерация на новой модели дольше — скачивается с Civitai.
      </div>
    </div>
  );
}
