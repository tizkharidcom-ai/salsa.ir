#!/usr/bin/env python3
"""Import the public Jan Majnoon menu and localize its media for Westo.

The script preserves non-menu DB state and operational item fields for shared
IDs, stages every image before changing JSON, and writes a recoverable backup
under /private/tmp.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from typing import Any
import urllib.request

from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "server/data/db.json"
SEED_PATH = ROOT / "server/data/menu-seed.json"
SYNC_PATH = ROOT / "server/data/topmenu-sync.json"
ASSET_DIR = ROOT / "assets/menu"
DEFAULT_API = "https://www.topmenumarket.com/api/v2/providers/430/menu"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="Use an already captured API response")
    parser.add_argument("--api", default=DEFAULT_API, help="TopMenu API endpoint")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent media downloads")
    parser.add_argument("--dry-run", action="store_true", help="Validate and summarize only")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def fetch_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "WestoMenuSync/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def plain_text(raw: Any) -> str:
    text = re.sub(r"<[^>]*>", " ", str(raw or ""))
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def flatten_menu(payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    roots = payload.get("data")
    if not isinstance(roots, list) or not roots:
        raise ValueError("TopMenu response has no data categories")

    categories: list[dict[str, Any]] = []
    rows: list[dict[str, Any]] = []
    for root in roots:
        root_id = int(root["id"])
        categories.append(root)
        for item in root.get("items") or []:
            rows.append({"category": root, "subcategory": None, "item": item})
        for subcategory in root.get("subCategories") or []:
            for item in subcategory.get("items") or []:
                rows.append({"category": root, "subcategory": subcategory, "item": item})

    ids = [int(row["item"]["id"]) for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError("TopMenu response contains duplicate item IDs")
    if len({int(category["id"]) for category in categories}) != len(categories):
        raise ValueError("TopMenu response contains duplicate category IDs")
    return categories, rows


def media_url(item: dict[str, Any]) -> str:
    thumbnail = item.get("thumbnail") or {}
    if thumbnail.get("url"):
        return str(thumbnail["url"])
    album = item.get("album") or []
    return str(album[0].get("url") or "") if album else ""


def save_webp(raw: bytes, destination: Path) -> None:
    with Image.open(io.BytesIO(raw)) as opened:
        opened.seek(0)
        image = ImageOps.exif_transpose(opened).convert("RGBA")
        image.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
        destination.parent.mkdir(parents=True, exist_ok=True)
        image.save(destination, "WEBP", quality=88, method=6, exact=True)
    with Image.open(destination) as check:
        if check.width < 16 or check.height < 16:
            raise ValueError(f"Implausible image dimensions for {destination.name}")


def stage_remote(url: str, destination: Path) -> None:
    error: Exception | None = None
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "WestoMenuSync/1.0"})
            with urllib.request.urlopen(request, timeout=35) as response:
                save_webp(response.read(), destination)
            return
        except Exception as current:
            error = current
            time.sleep(0.35 * (attempt + 1))
    raise RuntimeError(f"Failed media {url}: {error}")


def stage_local(source: Path, destination: Path) -> None:
    if not source.exists():
        raise FileNotFoundError(f"No source image for {destination.name}: {source}")
    with source.open("rb") as handle:
        save_webp(handle.read(), destination)


def write_json_atomic(path: Path, data: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(temporary, path)


def main() -> int:
    args = parse_args()
    payload = load_json(args.json) if args.json else fetch_json(args.api)
    categories_raw, rows = flatten_menu(payload)
    available_count = sum(row["item"].get("available") is not False for row in rows)
    nested_count = sum(bool(row["subcategory"]) for row in rows)
    summary = {
        "categories": len(categories_raw),
        "totalItems": len(rows),
        "availableItems": available_count,
        "nestedItems": nested_count,
    }
    if args.dry_run:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    db = load_json(DB_PATH)
    seed = load_json(SEED_PATH)
    old_items = {int(item["id"]): item for item in db.get("menuItems") or []}
    old_categories = {int(category["id"]): category for category in db.get("menuCategories") or []}
    stage_root = Path(tempfile.mkdtemp(prefix="westo-topmenu-media-", dir="/private/tmp"))

    try:
        item_jobs: list[tuple[str, Path, Path]] = []
        for row in rows:
            item = row["item"]
            item_id = int(item["id"])
            destination = stage_root / f"{item_id}.webp"
            url = media_url(item)
            fallback = ASSET_DIR / f"{item_id}.webp"
            item_jobs.append((url, fallback, destination))

        def run_item_job(job: tuple[str, Path, Path]) -> None:
            url, fallback, destination = job
            if url:
                stage_remote(url, destination)
            else:
                stage_local(fallback, destination)

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = [pool.submit(run_item_job, job) for job in item_jobs]
            for future in concurrent.futures.as_completed(futures):
                future.result()

        first_item_by_category: dict[int, int] = {}
        for row in rows:
            category_id = int(row["category"]["id"])
            first_item_by_category.setdefault(category_id, int(row["item"]["id"]))

        category_jobs: list[tuple[str, Path, Path]] = []
        for category in categories_raw:
            category_id = int(category["id"])
            destination = stage_root / f"category-{category_id}.webp"
            thumbnail = category.get("thumbnail") or {}
            url = str(thumbnail.get("url") or "")
            fallback_id = first_item_by_category.get(category_id)
            fallback = stage_root / f"{fallback_id}.webp" if fallback_id else Path()
            category_jobs.append((url, fallback, destination))

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = []
            for url, fallback, destination in category_jobs:
                if url:
                    futures.append(pool.submit(stage_remote, url, destination))
                else:
                    futures.append(pool.submit(stage_local, fallback, destination))
            for future in concurrent.futures.as_completed(futures):
                future.result()

        now_ms = int(time.time() * 1000)
        categories: list[dict[str, Any]] = []
        for category in categories_raw:
            category_id = int(category["id"])
            previous = old_categories.get(category_id, {})
            title = plain_text(category.get("title"))
            description = plain_text(category.get("description"))
            categories.append(
                {
                    "id": category_id,
                    "title": title,
                    "name1": title,
                    "name2": "",
                    "shortDesc": description or str(previous.get("shortDesc") or ""),
                    "longDesc": description or str(previous.get("longDesc") or ""),
                    "hiddenOnSite": False,
                    "coverImg": f"assets/menu/category-{category_id}.webp",
                    "sourceLevel": category.get("level"),
                }
            )

        items: list[dict[str, Any]] = []
        counts: dict[str, int] = {str(category["id"]): 0 for category in categories_raw}
        for row in rows:
            source = row["item"]
            item_id = int(source["id"])
            category_id = int(row["category"]["id"])
            previous = old_items.get(item_id, {})
            name = plain_text(source.get("title"))
            description = plain_text((source.get("details") or {}).get("description"))
            same_name = str(previous.get("name") or "") == name
            same_desc = str(previous.get("desc") or "") == description
            price_rial = int(float(source.get("price") or 0))
            item: dict[str, Any] = {
                "id": item_id,
                "categoryId": category_id,
                "name": name,
                "en": plain_text(source.get("english_title")),
                "desc": description,
                "price": price_rial // 10,
                "available": source.get("available") is not False,
                "featured": bool(source.get("featured")),
                "img": f"assets/menu/{item_id}.webp",
                "allergens": list(previous.get("allergens") or []),
                "dayparts": list(previous.get("dayparts") or ["all"]),
                "stock": previous.get("stock"),
                "lowStockAt": previous.get("lowStockAt", 5),
                "descEn": str(previous.get("descEn") or "") if same_desc else "",
                "ar": str(previous.get("ar") or "") if same_name else "",
                "descAr": str(previous.get("descAr") or "") if same_desc else "",
                "sourceLevel": source.get("level"),
                "sourceDiscount": source.get("discount") or 0,
                "updatedAt": now_ms,
            }
            subcategory = row["subcategory"]
            if subcategory:
                item["subcategoryId"] = int(subcategory["id"])
                item["subcategoryTitle"] = plain_text(subcategory.get("title"))
            items.append(item)
            if item["available"]:
                counts[str(category_id)] += 1

        products = [
            {
                "id": index + 1,
                "menuCategoryId": category["id"],
                "name1": category["title"],
                "name2": "",
                "title": category["title"],
                "shortDesc": category["shortDesc"],
                "longDesc": category["longDesc"],
                "coverImg": category["coverImg"],
            }
            for index, category in enumerate(categories)
        ]

        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = Path("/private/tmp") / f"westo-topmenu-backup-{stamp}"
        backup_dir.mkdir(parents=True, exist_ok=False)
        shutil.copy2(DB_PATH, backup_dir / "db.json")
        shutil.copy2(SEED_PATH, backup_dir / "menu-seed.json")

        ASSET_DIR.mkdir(parents=True, exist_ok=True)
        for staged in stage_root.glob("*.webp"):
            os.replace(staged, ASSET_DIR / staged.name)

        db["menuCategories"] = categories
        db["menuItems"] = items
        db["products"] = products
        db["menuRevision"] = now_ms
        seed["categories"] = categories
        seed["items"] = items
        sync = {
            "providerId": 430,
            "source": args.api,
            "syncedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
            **summary,
            "categoryCounts": counts,
            "backup": str(backup_dir),
        }
        write_json_atomic(DB_PATH, db)
        write_json_atomic(SEED_PATH, seed)
        write_json_atomic(SYNC_PATH, sync)
        print(json.dumps(sync, ensure_ascii=False, indent=2))
        return 0
    finally:
        shutil.rmtree(stage_root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
