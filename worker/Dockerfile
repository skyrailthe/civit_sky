# Кастомный ComfyUI-воркер для Civit Sky.
# База: официальный runpod worker-comfyui (ComfyUI + RunPod handler), "base"
# вариант без запечённых моделей — всё качаем с Civitai на лету.
FROM runpod/worker-comfyui:5.8.6-base

# Нода XTNodes качает файлы через aria2c — ставим его в образ.
RUN apt-get update \
    && apt-get install -y --no-install-recommends aria2 \
    && rm -rf /var/lib/apt/lists/*

# Нода EasyCivitai-XTNodes: качает чекпойнт/LoRA по URL И сразу отдаёт MODEL/CLIP.
# Это даёт ЯВНУЮ зависимость в графе (LoraLoader принимает model/clip на вход),
# поэтому нет race condition «нода загрузки vs загрузчик» (был у AssetDownloader).
RUN cd /comfyui/custom_nodes \
    && git clone https://github.com/X-T-E-R/ComfyUI-EasyCivitai-XTNodes.git \
    && if [ -f ComfyUI-EasyCivitai-XTNodes/requirements.txt ]; then \
         pip install --no-cache-dir -r ComfyUI-EasyCivitai-XTNodes/requirements.txt; \
       fi

# Нода читает токен Civitai из .secrets.toml ([civitai] token=...), а не из env.
# Чтобы не запекать токен в образ, генерируем этот файл при старте контейнера
# из переменной окружения CIVITAI_TOKEN (задаётся в Environment Variables эндпоинта).
# ВАЖНО: путь к entrypoint.sh — относительно build context. На RunPod build
# context = корень репо, поэтому путь "worker/entrypoint.sh".
COPY worker/entrypoint.sh /civitsky-entrypoint.sh
RUN chmod +x /civitsky-entrypoint.sh

ENTRYPOINT ["/civitsky-entrypoint.sh"]
CMD ["/start.sh"]
