"""Кастомные ноды Civit Sky для ComfyUI.

CivitskyFluxUNETLoader — скачивает Flux UNET по URL (Civitai/HF) И сразу
загружает его как MODEL. Скачивание и загрузка в ОДНОЙ ноде => зависимость
в графе явная, нет race condition (был у раздельного AssetDownloader +
UNETLoader: загрузчик стартовал до завершения скачивания -> "No outputs").
"""

import os
import subprocess

import folder_paths
import comfy.sd
import comfy.utils


def _resolve_token(token: str) -> str:
    # поддержка "$CIVITAI_TOKEN" — берём значение из окружения воркера
    if token and token.startswith("$"):
        return os.environ.get(token[1:], "")
    return token or ""


def _download(url: str, dest: str, token: str) -> None:
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return  # уже скачан (кеш воркера)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tok = _resolve_token(token)
    # Civitai принимает токен и в query (?token=), и в заголовке — даём оба.
    dl_url = url
    if tok and "token=" not in url:
        sep = "&" if "?" in url else "?"
        dl_url = f"{url}{sep}token={tok}"
    headers = ["--header", f"Authorization: Bearer {tok}"] if tok else []
    cmd = [
        "aria2c",
        "-x", "8", "-s", "8",
        "--continue=true",
        "--max-tries=3",
        "--retry-wait=3",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        "--check-certificate=false",
        "-o", os.path.basename(dest),
        "-d", os.path.dirname(dest),
        *headers,
        dl_url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    ok = os.path.exists(dest) and os.path.getsize(dest) > 0
    if res.returncode != 0 or not ok:
        # полный вывод aria2 (и stdout, и stderr) для точной диагностики
        out = (res.stdout or "") + "\n" + (res.stderr or "")
        raise RuntimeError(
            f"UNET download failed (rc={res.returncode}, exists={os.path.exists(dest)}):\n"
            + out[-1500:]
        )


class CivitskyFluxUNETLoader:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "url": ("STRING", {"default": ""}),
                "filename": ("STRING", {"default": "civitsky_flux.safetensors"}),
                "weight_dtype": (
                    ["default", "fp8_e4m3fn", "fp8_e5m2"],
                    {"default": "fp8_e4m3fn"},
                ),
            },
            "optional": {
                "token": ("STRING", {"default": "$CIVITAI_TOKEN"}),
            },
        }

    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("MODEL",)
    FUNCTION = "load"
    CATEGORY = "CivitSky"

    def load(self, url, filename, weight_dtype, token="$CIVITAI_TOKEN"):
        unet_dir = folder_paths.get_folder_paths("diffusion_models")[0]
        dest = os.path.join(unet_dir, filename)
        _download(url, dest, token)

        # логика стандартного UNETLoader
        model_options = {}
        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = __import__("torch").float8_e4m3fn
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = __import__("torch").float8_e5m2

        sd = comfy.utils.load_torch_file(dest)
        model = comfy.sd.load_diffusion_model_state_dict(
            sd, model_options=model_options
        )
        if model is None:
            raise RuntimeError(
                "Не удалось загрузить UNET (возможно, это полный чекпойнт, а не diffusion-модель)"
            )
        return (model,)


NODE_CLASS_MAPPINGS = {"CivitskyFluxUNETLoader": CivitskyFluxUNETLoader}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CivitskyFluxUNETLoader": "Civit Sky · Flux UNET Loader (URL)"
}
