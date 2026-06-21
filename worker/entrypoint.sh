#!/usr/bin/env bash
# Генерируем .secrets.toml для ноды EasyCivitai-XTNodes из CIVITAI_TOKEN.
# Нода ищет файл в своём project_root (директория узла в custom_nodes).
set -e

NODE_DIR="/comfyui/custom_nodes/ComfyUI-EasyCivitai-XTNodes"

if [ -n "${CIVITAI_TOKEN}" ]; then
  printf '[civitai]\ntoken = "%s"\n' "${CIVITAI_TOKEN}" > "${NODE_DIR}/.secrets.toml"
  echo "[civitsky] .secrets.toml created for EasyCivitai-XTNodes"
else
  # Без токена публичные модели всё равно качаются; гейтнутые/NSFW — нет.
  printf '[civitai]\ntoken = ""\n' > "${NODE_DIR}/.secrets.toml"
  echo "[civitsky] WARNING: CIVITAI_TOKEN is empty — gated models will fail to download"
fi

# Передаём управление штатному старту воркера (/start.sh).
exec "$@"
