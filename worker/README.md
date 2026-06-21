# Civit Sky — кастомный ComfyUI воркер

Воркер для RunPod Serverless, который **качает модели и LoRA с Civitai по URL
прямо во время задачи** и генерит картинку. Это то, что делает приложение
настоящим клоном Civitai (любая модель, а не одна запечённая).

## Как это работает

1. Next.js собирает ComfyUI workflow (см. `src/lib/workflow.ts`):
   - `AssetDownloader` ноды (OUTPUT_NODE) качают checkpoint в `models/checkpoints`
     и каждую LoRA в `models/loras`.
   - Обычный SDXL txt2img граф ссылается на скачанные файлы по имени.
2. Воркер выполняет граф: сначала отрабатывают загрузчики, потом генерация.
3. Возвращает `output.images[]` (base64).

Токен Civitai в workflow указан как `"$CIVITAI_TOKEN"` — нода читает его из
переменной окружения воркера, поэтому токен **не уходит в теле задачи**.

## Сборка и публикация образа

Нужен Docker Hub аккаунт (или другой registry).

```bash
cd worker
docker build -t <твой_логин>/civitsky-comfyui:latest .
docker push <твой_логин>/civitsky-comfyui:latest
```

> Сборка на amd64 обязательна (RunPod GPU = x86). На Apple Silicon:
> `docker build --platform linux/amd64 ...`

## Создание Serverless endpoint в RunPod

1. RunPod → Serverless → **New Endpoint** → **Custom deployment / Import image**.
2. Image: `<твой_логин>/civitsky-comfyui:latest`.
3. GPU: 24 GB (RTX 4090 / A5000) для SDXL/Pony/Illustrious.
4. **Container Disk: 25–40 GB** — модели качаются в контейнер (6+ ГБ каждая).
5. Min Workers = 0, Max = 1.
6. **Environment Variables** → добавить:
   - `CIVITAI_TOKEN` = твой токен Civitai (тот же, что в `.env.local`).
7. Deploy. Скопировать **Endpoint ID** в `.env.local` приложения как
   `RUNPOD_ENDPOINT_ID`.

## Проверка

В RunPod у endpoint есть вкладка **Requests** → можно отправить тестовый
`input.workflow`. Либо просто запусти приложение и нажми «Сгенерировать».

## Важно про холодный старт

Первая генерация на новой модели будет дольше: воркер качает чекпойнт
(6+ ГБ). Повторные задачи на том же воркере используют уже скачанный файл,
пока воркер не уснул. Это плата за «любую модель с Civitai».
