"""Refresh the hero database, Fribbels multipliers, and the RTA season model.

The app calls this from the local server. A failed refresh does not replace
catalog.json. Numbers are copied from the public files, not filled in.
"""

from __future__ import annotations

import json
import struct
import zlib
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
SEASON_LABELS = {
    "pvp_rta_ss21": "2026 秋季賽季（Fall 2026），Champion+",
}
KNOWN_PATCH = "8.7 content update on 2026-10-29, plus the 2026-11-05 bugfix patch. The 2026-11-19 balance preview is not applied."
KNOWN_PATCH_ZH = "8.7 內容更新（2026-10-29）加上 2026-11-05 的修正檔。2026-11-19 的平衡預告沒有算進去。"


def build_database(heroes: dict, zh: dict) -> list[dict]:
    rows = []
    for hero in heroes.values():
        skills = {}
        for slot in ("S1", "S2", "S3"):
            skill = (hero.get("skills") or {}).get(slot) or {}
            skills[slot] = {
                "rate": skill.get("rate") or 0,
                "pow": skill.get("pow") or 0,
                "targets": skill.get("targets") or 0,
                "selfHpScaling": skill.get("selfHpScaling") or 0,
                "selfAtkScaling": skill.get("selfAtkScaling") or 0,
                "selfDefScaling": skill.get("selfDefScaling") or 0,
                "selfSpdScaling": skill.get("selfSpdScaling") or 0,
                "penetration": skill.get("penetration") or 0,
                "increasedValue": skill.get("increasedValue") or 0,
            }
        base = ((hero.get("calculatedStatus") or {}).get("lv60SixStarFullyAwakened") or {})
        rows.append({
            "id": hero.get("_id"),
            "code": hero.get("code"),
            "name": hero.get("name"),
            "nameZh": zh.get(hero.get("name"), hero.get("name")),
            "attribute": hero.get("attribute"),
            "skills": skills,
            "baseSpeed": base.get("spd"),
            "baseAttack": base.get("atk"),
            "baseHp": base.get("hp"),
            "baseDefense": base.get("def"),
        })
    rows.sort(key=lambda row: row["code"] or "")
    return rows


def validate_catalog(catalog: dict) -> list[str]:
    problems = []
    provenance = catalog.get("provenance") or {}
    if not provenance.get("fribbelsCommit"):
        problems.append("沒有 Fribbels 版本")
    if not provenance.get("gamePatchAssumed"):
        problems.append("沒有遊戲版本")
    if not provenance.get("rtaSeason") or not provenance.get("rtaSeasonLabel"):
        problems.append("沒有賽季")
    database = catalog.get("database") or []
    if len(database) < 100:
        problems.append(f"英雄資料庫只有 {len(database)} 名")
    codes = {row.get("code") for row in database}
    heroes = catalog.get("heroes") or []
    if len(heroes) < 10:
        problems.append("賽季核心不足 10 名")
    for hero in heroes:
        if hero.get("code") not in codes:
            problems.append(f"{hero.get('code')} 不在英雄資料庫")
        for slot in ("S1", "S2", "S3"):
            skill = (hero.get("skills") or {}).get(slot) or {}
            if not isinstance(skill.get("rate"), (int, float)) or not isinstance(skill.get("pow"), (int, float)):
                problems.append(f"{hero.get('nameZh') or hero.get('code')} {slot} 沒有倍率")
        presence = hero.get("rtaPresence") or {}
        if not isinstance(presence.get("prebans"), int):
            problems.append(f"{hero.get('nameZh')} 沒有賽季預禁數")
        if not (hero.get("rtaGear") or {}).get("setCombos"):
            problems.append(f"{hero.get('nameZh')} 沒有賽季套裝")
        median = ((hero.get("reference") or {}).get("median") or {})
        base = hero.get("base") or {}
        if not isinstance(median.get("speed"), int) and not isinstance(base.get("speed"), int):
            problems.append(f"{hero.get('nameZh')} 沒有速度")
    if not catalog.get("artifactNames"):
        problems.append("沒有神器資料")
    return problems


def version_from(catalog: dict) -> dict:
    provenance = catalog["provenance"]
    patch = provenance.get("gamePatchAssumed")
    return {
        "ok": True,
        "fetchedOn": provenance.get("fetchedOn"),
        "fribbelsCommit": provenance.get("fribbelsCommit"),
        "fribbelsCommitDate": provenance.get("fribbelsCommitDate"),
        "fribbelsCommitMessage": provenance.get("fribbelsCommitMessage"),
        "patch": patch,
        "patchZh": provenance.get("gamePatchAssumedZh") or (KNOWN_PATCH_ZH if patch == KNOWN_PATCH else patch),
        "season": provenance.get("rtaSeason"),
        "seasonLabel": provenance.get("rtaSeasonLabel"),
        "heroCount": len(catalog.get("database") or []),
        "metaCount": len(catalog.get("heroes") or []),
        "artifactCount": len(catalog.get("artifactNames") or {}),
        "portraitCount": len((json.loads((DATA / "portrait-signatures.json").read_text())["portraits"]) if (DATA / "portrait-signatures.json").exists() else []),
    }


def write_version(catalog: dict) -> None:
    payload = version_from(catalog)
    (DATA / "version.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def parse_rta_list(text: str) -> list[dict]:
    marker = text.find('{"data":[')
    if marker < 0:
        raise ValueError("Epic7RTAStats 沒有回傳英雄榜")
    start = text.find("[", marker)
    depth = 0
    for index in range(start, len(text)):
        char = text[index]
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                rows = json.loads(text[start : index + 1])
                if not rows or "hero_code" not in rows[0]:
                    raise ValueError("英雄榜格式對不上")
                return rows
    raise ValueError("英雄榜沒有收完")


def presence_from(row: dict) -> dict:
    return {
        "season": row["season_code"],
        "wins": row["total_wins"],
        "losses": row["total_losses"],
        "bans": row["total_bans"],
        "prebans": row["total_prebans"],
        "games": row["total_games"],
        "source": "https://www.epic7rtastats.com/heroes",
    }


def paeth(left: int, up: int, upper_left: int) -> int:
    estimate = left + up - upper_left
    if abs(estimate - left) <= abs(estimate - up) and abs(estimate - left) <= abs(estimate - upper_left):
        return left
    if abs(estimate - up) <= abs(estimate - upper_left):
        return up
    return upper_left


def decode_png(data: bytes) -> tuple[int, int, list[tuple[int, int, int]]]:
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是 PNG")
    pos = 8
    width = height = color = None
    palette = b""
    idat = b""
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        kind = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", chunk[:10])
            if depth != 8 or color not in (2, 3, 6):
                raise ValueError(f"不支援的 PNG 格式 {depth}/{color}")
        elif kind == b"PLTE":
            palette = chunk
        elif kind == b"IDAT":
            idat += chunk
        elif kind == b"IEND":
            break
    raw = zlib.decompress(idat)
    channels = {2: 3, 3: 1, 6: 4}[color]
    stride = width * channels
    rows = []
    cursor = 0
    previous = bytearray(stride)
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        row = bytearray(raw[cursor : cursor + stride])
        cursor += stride
        for x in range(stride):
            left = row[x - channels] if x >= channels else 0
            up = previous[x]
            upper_left = previous[x - channels] if x >= channels else 0
            if filter_type == 0:
                extra = 0
            elif filter_type == 1:
                extra = left
            elif filter_type == 2:
                extra = up
            elif filter_type == 3:
                extra = (left + up) // 2
            elif filter_type == 4:
                extra = paeth(left, up, upper_left)
            else:
                raise ValueError(f"PNG filter {filter_type}")
            row[x] = (row[x] + extra) & 255
        previous = row
        rows.append(row)
    pixels = []
    for row in rows:
        for x in range(width):
            if color == 3:
                index = row[x]
                pixels.append(tuple(palette[index * 3 : index * 3 + 3]))
            elif color == 2:
                pixels.append(tuple(row[x * 3 : x * 3 + 3]))
            else:
                pixels.append(tuple(row[x * 4 : x * 4 + 3]))
    return width, height, pixels


def signature(width: int, height: int, pixels: list[tuple[int, int, int]]) -> list[int]:
    cells = []
    for gy in range(8):
        for gx in range(8):
            x0 = gx * width // 8
            x1 = max(x0 + 1, (gx + 1) * width // 8)
            y0 = gy * height // 8
            y1 = max(y0 + 1, (gy + 1) * height // 8)
            red = green = blue = count = 0
            for y in range(y0, y1):
                for x in range(x0, x1):
                    pixel = pixels[y * width + x]
                    red += pixel[0]
                    green += pixel[1]
                    blue += pixel[2]
                    count += 1
            cells.extend([round(red / count), round(green / count), round(blue / count)])
    return cells


def center(values: list[int]) -> list[float]:
    means = [
        sum(values[index] for index in range(channel, len(values), 3)) / 64
        for channel in range(3)
    ]
    return [values[index] - means[index % 3] for index in range(len(values))]


def centered_distance(left: list[int], right: list[int]) -> float:
    a = center(left)
    b = center(right)
    return sum((a[i] - b[i]) ** 2 for i in range(len(a))) ** 0.5


def write_signatures(catalog: dict, commit: str, fetch, fresh: bool = False) -> dict:
    portraits = []
    missing = []
    for hero in catalog["heroes"]:
        url = (
            "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
            f"{commit}/data/cachedimages/{hero['code']}_s.png"
        )
        try:
            width, height, pixels = decode_png(fetch(url, fresh=fresh, timeout=30))
        except Exception as exc:  # noqa: BLE001
            missing.append({"code": hero["code"], "error": str(exc)})
            continue
        portraits.append({
            "id": hero["id"],
            "code": hero["code"],
            "nameZh": hero["nameZh"],
            "source": url,
            "rgb": signature(width, height, pixels),
        })
    distances = []
    for index, left in enumerate(portraits):
        for right in portraits[index + 1 :]:
            distances.append(centered_distance(left["rgb"], right["rgb"]))
    nearest = min(distances) if distances else 0
    payload = {
        "commit": commit,
        "grid": 8,
        "emptyStdevBelow": 18,
        "maxDistance": round(nearest * 0.45, 4) if nearest else 0,
        "nearestOther": round(nearest, 4),
        "missing": missing,
        "portraits": portraits,
    }
    (DATA / "portrait-signatures.json").write_text(json.dumps(payload, ensure_ascii=False))
    return payload


def attach_database(fetch, hero_url: str, artifact_url: str, zh_url: str, fresh_files: bool = False) -> None:
    """Add the full Fribbels hero database onto the current catalog without refetching ladder pages."""
    catalog = json.loads((DATA / "catalog.json").read_text())
    heroes = json.loads(fetch(hero_url, fresh=fresh_files))
    artifacts = json.loads(fetch(artifact_url, fresh=fresh_files))
    zh = json.loads(fetch(zh_url, fresh=fresh_files))
    catalog["database"] = build_database(heroes, zh)
    catalog["artifactNames"] = {
        art["code"]: {"name": name, "nameZh": zh.get(name, name)}
        for name, art in artifacts.items()
    }
    provenance = catalog["provenance"]
    provenance.setdefault("fribbelsCommitMessage", "Update E7 hero and artifact data for 291fabdab9f046be8fb6870bddf5bed0 (#264)")
    provenance.setdefault("gamePatchAssumedZh", KNOWN_PATCH_ZH if provenance.get("gamePatchAssumed") == KNOWN_PATCH else provenance.get("gamePatchAssumed"))
    problems = validate_catalog(catalog)
    if problems:
        raise SystemExit("catalog refused: " + "; ".join(problems[:8]))
    (DATA / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2))
    write_signatures(catalog, provenance["fribbelsCommit"], fetch, fresh=fresh_files)
    write_version(catalog)


def refresh_all(mod) -> None:
    commit_body = json.loads(mod.fetch(
        "https://api.github.com/repos/fribbels/Fribbels-Epic-7-Optimizer/commits?path=data/cache/herodata.json&per_page=1",
        fresh=True,
        timeout=30,
    ))
    commit = commit_body[0]
    sha = commit["sha"]
    date = commit["commit"]["committer"]["date"][:10]
    message = commit["commit"]["message"].split("\n", 1)[0]
    mod.FRIBBELS_COMMIT = sha
    mod.HERO_URL = (
        "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
        f"{sha}/data/cache/herodata.json"
    )
    mod.ARTIFACT_URL = (
        "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
        f"{sha}/data/cache/artifactdata.json"
    )
    mod.ZH_URL = (
        "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
        f"{sha}/data/locales/zh-TW/translation.json"
    )
    ladder_text = mod.fetch(
        "https://www.epic7rtastats.com/heroes?_rsc=1",
        fresh=True,
        timeout=40,
        headers={"RSC": "1"},
    ).decode("utf-8", "replace")
    rows = parse_rta_list(ladder_text)
    season = rows[0]["season_code"]
    label = SEASON_LABELS.get(season, f"賽季代號 {season}（Epic7RTAStats，Champion+ 榜）")
    ranked = sorted(rows, key=lambda row: row["total_prebans"], reverse=True)
    core = [row["hero_code"] for row in ranked[:16]]
    presence = {row["hero_code"]: presence_from(row) for row in ranked if row["hero_code"] in set(core)}
    (DATA / "rta-presence.json").write_text(json.dumps(
        {code: presence[code] for code in core},
        ensure_ascii=False,
        indent=2,
    ))
    patch = look_up_patch()
    print("refresh", sha, season, "core", ",".join(core))
    mod.main(
        fresh=True,
        commit=sha,
        commit_date=date,
        commit_message=message,
        reuse_reference=True,
        core_codes=core,
        presence_by_code=presence,
        season_code=season,
        season_label=label,
        patch_text=patch,
    )


def look_up_patch() -> str | None:
    """Return a patch title copied from a public note, or None to keep the previous sentence."""
    import urllib.request
    try:
        req = urllib.request.Request(
            "https://epic7db.com/news",
            headers={"User-Agent": "rta-advisor-catalog/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as res:
            text = res.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        print("patch page skipped", exc)
        return None
    import re
    match = re.search(r"(\d+\.\d+[^<]{0,80}20\d\d[^<]{0,40})", text)
    if not match:
        print("patch page had no dated version line; keeping the previous patch sentence")
        return None
    return match.group(1).strip()


def utc_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")
