from __future__ import annotations

import csv
import io
import math
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = Path(__file__).resolve().parent
PALETTE_PATH = BASE_DIR / "palette_221.csv"


def load_palette() -> tuple[list[str], np.ndarray, dict[str, tuple[int, int, int]]]:
    codes: list[str] = []
    colors: list[list[int]] = []
    with PALETTE_PATH.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            codes.append(row["code"])
            colors.append([int(row["r"]), int(row["g"]), int(row["b"])])
    # int32 避免 RGB 距离平方时溢出。
    palette = np.array(colors, dtype=np.int32)
    color_map = {code: tuple(map(int, rgb)) for code, rgb in zip(codes, colors)}
    return codes, palette, color_map


def rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """Convert sRGB array (..., 3), range 0-255, to CIE Lab."""
    rgb_f = rgb.astype(np.float32) / 255.0
    rgb_lin = np.where(rgb_f > 0.04045, ((rgb_f + 0.055) / 1.055) ** 2.4, rgb_f / 12.92)

    r = rgb_lin[..., 0]
    g = rgb_lin[..., 1]
    b = rgb_lin[..., 2]

    # sRGB D65
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041

    # Normalize by D65 white point.
    x = x / 0.95047
    y = y / 1.00000
    z = z / 1.08883

    epsilon = 216 / 24389
    kappa = 24389 / 27

    def f(t: np.ndarray) -> np.ndarray:
        return np.where(t > epsilon, np.cbrt(t), (kappa * t + 16) / 116)

    fx = f(x)
    fy = f(y)
    fz = f(z)

    l = 116 * fy - 16
    a = 500 * (fx - fy)
    bb = 200 * (fy - fz)
    return np.stack([l, a, bb], axis=-1).astype(np.float32)


CODES, PALETTE, COLOR_MAP = load_palette()
PALETTE_LAB = rgb_to_lab(PALETTE)


def sanitize_crop(img: Image.Image, crop: dict[str, float] | None, aspect: float) -> tuple[int, int, int, int]:
    w, h = img.size
    if crop:
        x = max(0, min(float(crop.get("x", 0)), w - 1))
        y = max(0, min(float(crop.get("y", 0)), h - 1))
        cw = max(1, min(float(crop.get("w", w)), w - x))
        ch = max(1, min(float(crop.get("h", h)), h - y))
        return round(x), round(y), round(x + cw), round(y + ch)

    # 自动居中裁切到目标比例。
    img_aspect = w / h
    if img_aspect > aspect:
        ch = h
        cw = int(h * aspect)
    else:
        cw = w
        ch = int(w / aspect)
    x = (w - cw) // 2
    y = (h - ch) // 2
    return x, y, x + cw, y + ch


def composite_to_rgb(raw_bytes: bytes) -> Image.Image:
    """Open image and convert transparent pixels onto white background."""
    img = Image.open(io.BytesIO(raw_bytes))
    img.load()
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        bg.alpha_composite(rgba)
        return bg.convert("RGB")
    return img.convert("RGB")


def map_to_palette(img: Image.Image, cols: int, rows: int) -> tuple[list[list[str]], Image.Image, dict[str, int]]:
    # BOX 用区域平均值缩小照片，比 NEAREST 更接近最终拼豆效果。
    small = img.resize((cols, rows), Image.Resampling.BOX).convert("RGB")
    arr_rgb = np.array(small, dtype=np.uint8)

    # Lab 空间最近色匹配，比直接 RGB 距离更接近人眼观感。
    arr_lab = rgb_to_lab(arr_rgb)
    diff = arr_lab[:, :, None, :] - PALETTE_LAB[None, None, :, :]
    dist = np.sum(diff * diff, axis=3)
    idx = np.argmin(dist, axis=2)

    matrix = [[CODES[int(idx[y, x])] for x in range(cols)] for y in range(rows)]
    mapped_arr = PALETTE[idx].astype(np.uint8)
    mapped_img = Image.fromarray(mapped_arr, "RGB")
    counts = Counter(code for row in matrix for code in row)
    return matrix, mapped_img, dict(sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def get_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def luminance(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b


def draw_pattern(
    matrix: list[list[str]],
    counts: dict[str, int],
    board_base: int,
    title: str,
    cell_size: int = 24,
) -> Image.Image:
    rows = len(matrix)
    cols = len(matrix[0]) if rows else 0
    margin = 42
    header_h = 96
    legend_item_w = 102
    legend_item_h = 36
    used_codes = list(counts.keys())
    legend_cols = max(1, min(8, max(1, cols * cell_size // legend_item_w)))
    legend_rows = math.ceil(len(used_codes) / legend_cols)
    legend_h = 30 + legend_rows * legend_item_h + 22

    width = margin * 2 + cols * cell_size
    height = header_h + rows * cell_size + legend_h + margin
    out = Image.new("RGB", (width, height), (248, 250, 252))
    draw = ImageDraw.Draw(out)
    font_title = get_font(28)
    font_meta = get_font(16)
    font_code = get_font(max(9, min(14, cell_size // 2)))
    font_legend = get_font(14)

    # 顶部信息
    draw.rounded_rectangle([20, 18, width - 20, 82], radius=20, fill=(255, 255, 255), outline=(226, 232, 240))
    draw.text((margin, 26), title or "拼豆像素图", fill=(15, 23, 42), font=font_title)
    draw.text(
        (margin, 61),
        f"尺寸：{cols} × {rows}  |  单板：{board_base} × {board_base}  |  用色：{len(used_codes)}种  |  总豆数：{rows * cols}",
        fill=(71, 85, 105),
        font=font_meta,
    )

    ox, oy = margin, header_h
    for y, row in enumerate(matrix):
        for x, code in enumerate(row):
            rgb = COLOR_MAP.get(code, (255, 255, 255))
            x0, y0 = ox + x * cell_size, oy + y * cell_size
            x1, y1 = x0 + cell_size, y0 + cell_size
            draw.rectangle([x0, y0, x1, y1], fill=rgb)
            text_fill = (255, 255, 255) if luminance(rgb) < 135 else (15, 23, 42)
            bbox = draw.textbbox((0, 0), code, font=font_code)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            draw.text((x0 + (cell_size - tw) / 2, y0 + (cell_size - th) / 2 - 1), code, fill=text_fill, font=font_code)

    # 细格线 / 10格线 / 拼豆板边界线
    fine = (226, 232, 240)
    major10 = (148, 163, 184)
    board_line = (17, 24, 39)
    for x in range(cols + 1):
        color = board_line if x % board_base == 0 else (major10 if x % 10 == 0 else fine)
        width_line = 3 if x % board_base == 0 else (2 if x % 10 == 0 else 1)
        draw.line([(ox + x * cell_size, oy), (ox + x * cell_size, oy + rows * cell_size)], fill=color, width=width_line)
    for y in range(rows + 1):
        color = board_line if y % board_base == 0 else (major10 if y % 10 == 0 else fine)
        width_line = 3 if y % board_base == 0 else (2 if y % 10 == 0 else 1)
        draw.line([(ox, oy + y * cell_size), (ox + cols * cell_size, oy + y * cell_size)], fill=color, width=width_line)

    # 坐标标识：每10格显示一次。
    for x in range(0, cols + 1, 10):
        draw.text((ox + x * cell_size + 2, oy - 20), str(x), fill=(100, 116, 139), font=font_legend)
    for y in range(0, rows + 1, 10):
        draw.text((ox - 34, oy + y * cell_size - 7), str(y), fill=(100, 116, 139), font=font_legend)

    # 图例
    ly = oy + rows * cell_size + 26
    draw.text((margin, ly), "用色统计", fill=(15, 23, 42), font=font_meta)
    ly += 30
    for i, code in enumerate(used_codes):
        lx = margin + (i % legend_cols) * legend_item_w
        yy = ly + (i // legend_cols) * legend_item_h
        rgb = COLOR_MAP[code]
        draw.rounded_rectangle([lx, yy, lx + 28, yy + 28], radius=6, fill=rgb, outline=(203, 213, 225))
        draw.text((lx + 36, yy + 1), code, fill=(15, 23, 42), font=font_legend)
        draw.text((lx + 36, yy + 16), f"×{counts[code]}", fill=(71, 85, 105), font=font_legend)

    return out


def matrix_to_csv_text(matrix: list[list[str]]) -> str:
    buf = io.StringIO(newline="")
    writer = csv.writer(buf)
    writer.writerows(matrix)
    return buf.getvalue()


def generate_project_payload(
    raw_bytes: bytes,
    rows: int,
    cols: int,
    board_base: int,
    title: str,
    crop: dict[str, float] | None = None,
) -> dict[str, Any]:
    img = composite_to_rgb(raw_bytes)
    left, top, right, bottom = sanitize_crop(img, crop, cols / rows)
    cropped = img.crop((left, top, right, bottom))

    matrix, _, counts = map_to_palette(cropped, cols, rows)
    pattern = draw_pattern(matrix, counts, board_base=board_base, title=title, cell_size=24)

    out_buf = io.BytesIO()
    pattern.save(out_buf, format="PNG", optimize=True)

    return {
        "png_bytes": out_buf.getvalue(),
        "csv_text": matrix_to_csv_text(matrix),
        "counts": counts,
        "colors": {code: "#%02X%02X%02X" % COLOR_MAP[code] for code in counts.keys()},
        "rows": rows,
        "cols": cols,
        "crop": {"x": left, "y": top, "w": right - left, "h": bottom - top},
    }
