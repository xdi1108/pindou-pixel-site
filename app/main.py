from __future__ import annotations

import base64
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .image_tools import generate_project_payload

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="拼豆像素图生成器")


@app.get("/api/presets")
def presets():
    return {
        "boards": [
            {"name": "1块方板", "board_base": 29, "board_cols": 1, "board_rows": 1},
            {"name": "2块横向", "board_base": 29, "board_cols": 2, "board_rows": 1},
            {"name": "2×2 方形", "board_base": 29, "board_cols": 2, "board_rows": 2},
            {"name": "3×2 横幅", "board_base": 29, "board_cols": 3, "board_rows": 2},
            {"name": "4×3 大图", "board_base": 29, "board_cols": 4, "board_rows": 3},
            {"name": "50格大板 1块", "board_base": 50, "board_cols": 1, "board_rows": 1},
        ],
        "note": "本版本不保存登录、项目历史、生成图片或数据库记录。生成结果只保留在当前浏览器页面。",
    }


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/generate")
async def generate(
    image: UploadFile = File(...),
    title: str = Form("拼豆像素图"),
    board_base: int = Form(29),
    board_cols: int = Form(1),
    board_rows: int = Form(1),
    crop_x: Optional[float] = Form(None),
    crop_y: Optional[float] = Form(None),
    crop_w: Optional[float] = Form(None),
    crop_h: Optional[float] = Form(None),
):
    if board_base < 5 or board_base > 80:
        raise HTTPException(status_code=400, detail="单板豆数不合理，建议 5-80")
    if board_cols < 1 or board_cols > 8 or board_rows < 1 or board_rows > 8:
        raise HTTPException(status_code=400, detail="板数建议控制在 1-8 块之间")

    rows = board_base * board_rows
    cols = board_base * board_cols
    if rows * cols > 30000:
        raise HTTPException(status_code=400, detail="尺寸过大，先控制在 30000 颗豆以内")

    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="图片为空")
    if len(raw) > 18 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片过大，建议压缩到 18MB 以内")

    crop = None
    if None not in (crop_x, crop_y, crop_w, crop_h):
        crop = {"x": crop_x, "y": crop_y, "w": crop_w, "h": crop_h}

    try:
        result = generate_project_payload(raw, rows=rows, cols=cols, board_base=board_base, title=title, crop=crop)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"图片处理失败：{exc}") from exc

    return {
        "title": title,
        "rows": rows,
        "cols": cols,
        "board_base": board_base,
        "board_rows": board_rows,
        "board_cols": board_cols,
        "image_base64": base64.b64encode(result["png_bytes"]).decode("ascii"),
        "csv_text": result["csv_text"],
        "counts": result["counts"],
        "colors": result["colors"],
        "crop": result["crop"],
    }


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
