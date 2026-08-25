#!/usr/bin/env python3
"""Remove the temporary chroma-key background and encode a menu asset as WebP."""

from __future__ import annotations

import argparse
from collections import deque
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image


MAX_BYTES = 50_000


def border_connected(mask: np.ndarray) -> np.ndarray:
    """Return only mask pixels connected to an image border (8-neighbour flood fill)."""
    height, width = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    queue: deque[tuple[int, int]] = deque()
    for x in range(width):
        if mask[0, x]:
            seen[0, x] = True
            queue.append((0, x))
        if mask[height - 1, x] and not seen[height - 1, x]:
            seen[height - 1, x] = True
            queue.append((height - 1, x))
    for y in range(height):
        if mask[y, 0] and not seen[y, 0]:
            seen[y, 0] = True
            queue.append((y, 0))
        if mask[y, width - 1] and not seen[y, width - 1]:
            seen[y, width - 1] = True
            queue.append((y, width - 1))

    while queue:
        y, x = queue.popleft()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if not (dx or dy):
                    continue
                ny, nx = y + dy, x + dx
                if 0 <= ny < height and 0 <= nx < width and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
    return seen


def remove_background(image: Image.Image, key_color: str = "magenta") -> Image.Image:
    rgba = image.convert("RGBA")
    arr = np.asarray(rgba).copy()
    rgb = arr[:, :, :3].astype(np.int16)

    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    if key_color == "cyan":
        magenta = (r < 135) & (g > 155) & (b > 155) & (np.abs(g - b) < 105)
    elif key_color == "blue":
        magenta = (r < 135) & (g < 135) & (b > 155)
    else:
        # ImageGen's extraction-aid background is magenta, but it can vary slightly.
        magenta = (r > 155) & (b > 155) & (g < 135) & (np.abs(r - b) < 105)
    alpha = arr[:, :, 3].copy()

    if np.all(alpha >= 250):
        background = border_connected(magenta)

        # Defensive fallback for an accidental baked checkerboard/white background.
        if int(background.sum()) < int(arr.shape[0] * arr.shape[1] * 0.03):
            bright_neutral = (r > 224) & (g > 224) & (b > 224) & ((np.max(rgb, axis=2) - np.min(rgb, axis=2)) < 18)
            background = border_connected(bright_neutral)
        alpha[background] = 0

    # Remove key-colored pixels everywhere, including enclosed holes and glass/handle interiors.
    # Real food colors in this menu are not close to the highly saturated extraction key.
    alpha[magenta] = 0

    # Soften chroma-key pixels immediately touching the subject, removing colored fringes.
    expanded = magenta.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            source_y = slice(max(0, dy), min(arr.shape[0], arr.shape[0] + dy))
            source_x = slice(max(0, dx), min(arr.shape[1], arr.shape[1] + dx))
            target_y = slice(max(0, -dy), min(arr.shape[0], arr.shape[0] - dy))
            target_x = slice(max(0, -dx), min(arr.shape[1], arr.shape[1] - dx))
            expanded[target_y, target_x] |= magenta[source_y, source_x]
    if key_color == "blue":
        fringe = expanded & ~magenta & (b > 100) & (r < 190) & (g < 190)
    else:
        fringe = expanded & ~magenta & (r > 130) & (b > 130) & (g < 170)
    alpha[fringe] = np.minimum(alpha[fringe], 80)

    arr[:, :, 3] = alpha
    # Do not let hidden magenta RGB values bleed back in during resize/WebP interpolation.
    arr[magenta | fringe, :3] = 0
    arr[alpha == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def fit_square(image: Image.Image, size: int) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("generated image has no visible subject")
    left, top, right, bottom = bbox
    pad = max(8, round(max(right - left, bottom - top) * 0.035))
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(image.width, right + pad)
    bottom = min(image.height, bottom + pad)
    cropped = image.crop((left, top, right, bottom))
    inner = round(size * 0.94)
    scale = min(inner / cropped.width, inner / cropped.height)
    new_size = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    cropped = cropped.resize(new_size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(cropped, ((size - cropped.width) // 2, (size - cropped.height) // 2), cropped)
    return canvas


def encode_under_limit(image: Image.Image, output: Path) -> tuple[int, int, int]:
    best: tuple[bytes, int, int] | None = None
    for size in (512, 480, 448, 416, 384, 352, 320, 288, 256):
        canvas = fit_square(image, size)
        for quality in range(90, 19, -2):
            buffer = BytesIO()
            canvas.save(buffer, format="WEBP", quality=quality, method=6)
            payload = buffer.getvalue()
            if len(payload) <= MAX_BYTES:
                best = (payload, size, quality)
                break
        if best:
            break
    if not best:
        raise ValueError("could not encode image under 50 KB")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(best[0])
    return len(best[0]), best[1], best[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--key", choices=("magenta", "cyan", "blue"), default="magenta")
    args = parser.parse_args()
    image = remove_background(Image.open(args.source), args.key)
    size, width, quality = encode_under_limit(image, args.output)
    print(f"{args.output}\t{size}\t{width}x{width}\tq={quality}")


if __name__ == "__main__":
    main()
