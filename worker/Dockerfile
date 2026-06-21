# Кастомный ComfyUI-воркер для Civit Sky.
# Берём официальный runpod worker-comfyui (базовый образ с ComfyUI + handler)
# и добавляем ноду AssetDownloader, чтобы качать модели/LoRA с Civitai по URL.
#
# Базовые теги: см. https://github.com/runpod-workers/worker-comfyui
# Берём "base" вариант — без запечённых моделей, всё качаем на лету.
FROM runpod/worker-comfyui:5.8.6-base

# Кастомная нода загрузки ассетов по URL (Civitai / HuggingFace / прямые ссылки)
# Нода — OUTPUT_NODE, поэтому выполняется всегда и кладёт файл в models/<save_to>.
RUN cd /comfyui/custom_nodes \
    && git clone https://github.com/ServiceStack/comfy-asset-downloader.git \
    && if [ -f comfy-asset-downloader/requirements.txt ]; then \
         pip install --no-cache-dir -r comfy-asset-downloader/requirements.txt; \
       fi

# CIVITAI_TOKEN пробрасывается в Environment Variables эндпоинта в RunPod,
# а в workflow токен указывается как "$CIVITAI_TOKEN" — нода подставит значение.
