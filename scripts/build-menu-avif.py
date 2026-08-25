#!/usr/bin/env python3
"""Create same-basename AVIF siblings for final menu WebP assets."""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1] / "assets" / "menu"
MAX_BYTES = 25_000
QUALITY_CANDIDATES = (85, 75, 65, 55, 50, 45, 40, 35, 32, 30, 28, 25, 22, 20, 15, 10, 5, 0)


def scaled_size(width: int, height: int, max_side: int) -> tuple[int, int]:
    if max(width, height) <= max_side:
        return width, height
    scale = max_side / max(width, height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def encode_one(source: Path, output: Path, workdir: Path) -> tuple[int, int, tuple[int, int]]:
    image = Image.open(source).convert("RGBA")
    original_size = image.size
    max_sides = [max(original_size)]
    if max(original_size) > 128:
        max_sides += [480, 448, 416, 384, 352, 320, 288, 256]

    best: tuple[bytes, int, tuple[int, int]] | None = None
    for max_side in max_sides:
        size = scaled_size(*original_size, max_side)
        png_path = workdir / f"{source.stem}-{size[0]}x{size[1]}.png"
        candidate_path = workdir / f"{source.stem}-{size[0]}x{size[1]}.avif"
        image.resize(size, Image.Resampling.LANCZOS).save(png_path, format="PNG", optimize=True)

        for quality in QUALITY_CANDIDATES:
            if candidate_path.exists():
                candidate_path.unlink()
            subprocess.run(
                [
                    "avifenc",
                    "-q",
                    str(quality),
                    "--qalpha",
                    "100",
                    "-s",
                    "6",
                    "--ignore-profile",
                    str(png_path),
                    str(candidate_path),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            payload = candidate_path.read_bytes()
            if len(payload) <= MAX_BYTES:
                best = (payload, quality, size)
                break
        if best:
            break

    if not best:
        raise RuntimeError(f"could not encode {source} under {MAX_BYTES} bytes")
    payload, quality, size = best
    output.write_bytes(payload)
    return len(payload), quality, size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--thumbs-512",
        action="store_true",
        help="Rebuild only category-thumb AVIFs from their 512x512 root covers.",
    )
    args = parser.parse_args()

    if not shutil.which("avifenc"):
        raise SystemExit("avifenc is required")
    sources = sorted(p for p in ROOT.rglob("*.webp") if p.is_file() and not p.name.endswith(".old"))
    if args.thumbs_512:
        sources = [p for p in sources if p.parent.name == "category-thumbs"]
    if not sources:
        raise SystemExit("no final WebP menu assets found")

    with tempfile.TemporaryDirectory(prefix="westo-avif-") as temp:
        workdir = Path(temp)
        for source in sources:
            output = source.with_suffix(".avif")
            encode_source = source
            if args.thumbs_512:
                category_id = source.stem.removeprefix("category-")
                root_source = ROOT / f"category-{category_id}.webp"
                if not root_source.exists():
                    raise SystemExit(f"missing 512x512 root cover for {source.name}")
                encode_source = root_source
            size, quality, dimensions = encode_one(encode_source, output, workdir)
            print(f"{output}\t{size}\t{dimensions[0]}x{dimensions[1]}\tq={quality}")


if __name__ == "__main__":
    main()
