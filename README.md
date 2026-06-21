# Civit Sky

Клон Civitai для генерации изображений: выбираешь модель и доп. источники
(LoRA / embeddings) прямо из Civitai, задаёшь промт и формат — генерация
запускается на **RunPod Serverless**.

## Стек

- **Next.js 15** (App Router) — фронт + API routes в одном проекте
- **Civitai API** — каталог моделей и LoRA, скачивание файлов
- **RunPod Serverless** — воркер с ComfyUI делает саму генерацию
- Деплой на **Render.com** (Web Service, Node)

## Архитектура

```
Браузер ──> Next.js API routes ──> Civitai API   (каталог + downloadUrl)
                              └──> RunPod /run    (запуск задачи)
Браузер <── /api/jobs/:id (polling) <── RunPod /status/:id
```

Воркер скачивает checkpoint и LoRA по URL с Civitai в момент задачи —
ничего не запекаем в образ.

## Форматы → разрешения (SDXL)

| Формат | Размер     |
| ------ | ---------- |
| 1:1    | 1024×1024  |
| 2:3    | 832×1216   |
| 3:2    | 1216×832   |

Маппинг — в [`src/lib/types.ts`](src/lib/types.ts) (`ASPECT_DIMENSIONS`).

## Запуск локально

```bash
npm install
cp .env.example .env.local   # заполни токены
npm run dev
```

Открой http://localhost:3000

### Переменные окружения

| Переменная           | Зачем                                                |
| -------------------- | ---------------------------------------------------- |
| `CIVITAI_API_TOKEN`  | поиск/скачивание моделей (часть требует авторизацию) |
| `RUNPOD_API_KEY`     | доступ к RunPod API                                  |
| `RUNPOD_ENDPOINT_ID` | id твоего Serverless endpoint                        |

## RunPod воркер

Нужен Serverless endpoint с ComfyUI-воркером, который принимает `input`
формата из [`buildWorkerInput`](src/lib/runpod.ts) (checkpoint + extras
с URL, prompt, width/height, steps и т.д.) и возвращает `output.images`
(base64 или URL). Удобная база — `runpod-worker-comfy`. Формат `input`
и парсинг `output` — это место подгонки под конкретный воркер.

## Деплой на Render

1. Push в GitHub-репозиторий.
2. Render → New → **Web Service** → подключить репо.
3. Build command: `npm install && npm run build`
4. Start command: `npm run start` (использует `$PORT` от Render).
5. Прописать env: `CIVITAI_API_TOKEN`, `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`.

> На free-плане сервис засыпает; фоновых воркеров нет — поэтому статус
> задачи опрашивается с фронта через `/api/jobs/:id`, отдельный процесс
> не нужен.
