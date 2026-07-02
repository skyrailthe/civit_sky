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

# Наша нода CivitskyFluxUNETLoader: качает Flux UNET по URL И сразу грузит как
# MODEL (атомарно). Явная зависимость в графе → нет race (был у раздельного
# AssetDownloader + UNETLoader: "No outputs" при первом скачивании).
COPY worker/civitsky_nodes /comfyui/custom_nodes/civitsky_nodes

# Запекаем текст-энкодеры и VAE для Flux (их нельзя получить из fp8-UNET).
# t5xxl_fp8 (~5ГБ) + clip_l + Flux ae.vae — грузятся один раз при сборке.
RUN mkdir -p /comfyui/models/text_encoders /comfyui/models/vae \
    && aria2c -x8 -s8 -o /comfyui/models/text_encoders/t5xxl_fp8_e4m3fn.safetensors \
       "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp8_e4m3fn.safetensors" \
    && aria2c -x8 -s8 -o /comfyui/models/text_encoders/clip_l.safetensors \
       "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors" \
    && aria2c -x8 -s8 -o /comfyui/models/vae/flux_ae.safetensors \
       "https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors"

# Нода читает токен Civitai из .secrets.toml ([civitai] token=...), а не из env.
# Чтобы не запекать токен в образ, генерируем этот файл при старте контейнера
# из переменной окружения CIVITAI_TOKEN (задаётся в Environment Variables эндпоинта).
# ВАЖНО: путь к entrypoint.sh — относительно build context. На RunPod build
# context = корень репо, поэтому путь "worker/entrypoint.sh".
COPY worker/entrypoint.sh /civitsky-entrypoint.sh
RUN chmod +x /civitsky-entrypoint.sh

ENTRYPOINT ["/civitsky-entrypoint.sh"]
CMD ["/start.sh"]
