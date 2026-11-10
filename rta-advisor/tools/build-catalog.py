#!/usr/bin/env python3
"""Snapshot public Epic Seven data into rta-advisor/data/catalog.json.

Sources (fetched when this script runs):
- Fribbels herodata.json / artifactdata.json at a pinned commit
- Fribbels zh-TW translation.json
- Epic7RTAStats hero pages (Fall 2026 / pvp_rta_ss21 / Champion+)
- Epic7Tools hero pages for skill text, soul burn, and editorial gear notes
- Fribbels Hero Library getBuilds for reference medians

Does not invent skill multipliers. Narrative text is kept only when it was
extracted from Epic7Tools, and Traditional Chinese is a translation of that text.
"""

from __future__ import annotations

import json
import re
import statistics
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FRIBBELS_COMMIT = "cd69229c7c60547e85cb12f3135a724f01516aa0"
HERO_URL = (
    "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
    f"{FRIBBELS_COMMIT}/data/cache/herodata.json"
)
ARTIFACT_URL = (
    "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
    f"{FRIBBELS_COMMIT}/data/cache/artifactdata.json"
)
ZH_URL = (
    "https://raw.githubusercontent.com/fribbels/Fribbels-Epic-7-Optimizer/"
    f"{FRIBBELS_COMMIT}/data/locales/zh-TW/translation.json"
)
BUILDS_URL = "https://krivpfvxi0.execute-api.us-west-2.amazonaws.com/dev/getBuilds"

# Top of Epic7RTAStats /heroes for season pvp_rta_ss21, fetched 2026-11-10.
# Sixteen is enough for a 2-preban 5v5 draft after both sides ban.
CORE = [
    "c2186",
    "c2185",
    "c6005",
    "c2181",
    "c1183",
    "c2131",
    "c5154",
    "c2124",
    "c2076",
    "c1153",
    "c1133",
    "c2007",
    "c2148",
    "c5147",
    "c1117",
    "c5069",
]

SET_ZH = {
    "Speed": "速度",
    "Hit": "命中",
    "Critical": "暴擊",
    "Defense": "防禦",
    "Health": "生命",
    "Attack": "攻擊",
    "Counter": "反擊",
    "Lifesteal": "吸血",
    "Destruction": "破滅",
    "Resist": "抗性",
    "Unity": "連擊",
    "Rage": "憤怒",
    "Immunity": "免疫",
    "Penetration": "穿透",
    "Revenge": "復仇",
    "Injury": "創傷",
    "Protection": "守護",
    "Torrent": "激流",
    "Reversal": "逆轉",
    "Riposte": "還擊",
    "Warfare": "開戰",
    "Pursuit": "追擊",
    "Weakening": "削弱",
    "Fervor": "熱誠",
}

ATTR_ZH = {"fire": "火", "ice": "冰", "wind": "木", "light": "光", "dark": "暗"}
ROLE_ZH = {
    "knight": "騎士",
    "warrior": "戰士",
    "assassin": "刺客",
    "mage": "法師",
    "manauser": "精靈師",
    "ranger": "射手",
}


CACHE = Path("/tmp/rta-advisor-cache")


def fetch(url: str, data: bytes | None = None, timeout: int = 60) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    key = re.sub(r"[^a-zA-Z0-9._-]+", "_", url + (data.decode() if data else ""))[:180]
    cached = CACHE / key
    if cached.exists() and cached.stat().st_size > 0:
        return cached.read_bytes()
    last = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(
                url,
                data=data,
                headers={"User-Agent": "rta-advisor-catalog/1.0"},
            )
            with urllib.request.urlopen(req, timeout=timeout) as res:
                body = res.read()
            cached.write_bytes(body)
            return body
        except Exception as exc:  # noqa: BLE001 - retry then surface
            last = exc
            import time
            time.sleep(1.5 * (attempt + 1))
    raise last


def plain_html(chunk: str) -> str:
    text = unescape(chunk)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s+", "\n", text)
    return text.strip()


def parse_skills(html: str) -> dict:
    parts = re.split(r'(?=<article class="skw__detail")', html)
    skills = {}
    for part in parts:
        if "skw__detail" not in part[:80]:
            continue
        slot_m = re.search(r'data-skill="(\d)"', part[:240])
        if not slot_m:
            continue
        end = part.find("</article>")
        chunk = part[: end if end > 0 else 8000]
        text = plain_html(chunk)
        name_m = re.match(r"([A-Za-z0-9' :\-]+?)\s+Skill\s+\d", text)
        if not name_m:
            name_m = re.match(r"([A-Za-z0-9' :\-]+?)\s+Passive", text)
        name = name_m.group(1).strip() if name_m else ""
        passive = "Passive" in text[: len(name) + 20]
        # Cooldown sits in the header ("Skill 3 Awakened 5 turns"), not in "for 2 turns".
        cd_m = re.search(r"(?:Skill\s+\d|Awakened)\s+(?:Awakened\s+)?(\d+)\s+turns\b", text)
        soul_m = re.search(r"Acquire\s+(\d+)\s+Soul|\+(\d+)\s+soul", text, re.I)
        soul_gain = int(next(g for g in (soul_m.groups() if soul_m else ()) if g)) if soul_m else 0
        rate_m = re.search(r"Attack rate\s+([0-9.]+)", text)
        pow_m = re.search(r"Power\s+([0-9.]+)", text)
        burn_m = re.search(
            r"Soulburn\s+(\d+)\s+souls?\s+(.+?)(?=Skill Enhance|Attack rate|$)",
            text,
            re.I,
        )
        enh_m = re.search(r"At max\s+(.+?)(?=\+\d|\s+Attack rate|$)", text)
        enh = enh_m.group(1).strip(" ·") if enh_m else ""
        damage_pct = effect_pct = cd_cut = 0
        if enh:
            dm = re.search(r"\+(\d+)%\s+damage dealt", enh)
            em = re.search(r"\+(\d+)%\s+effect chance", enh)
            cm = re.search(r"-(\d+)\s+turn cooldown", enh)
            damage_pct = int(dm.group(1)) / 100 if dm else 0
            effect_pct = int(em.group(1)) / 100 if em else 0
            cd_cut = int(cm.group(1)) if cm else 0
        # Description is the sentence block before soulburn / enhance.
        desc = text
        desc = re.sub(r"^.*?(Skill\s+\d|Passive)\s+", "", desc, count=1)
        desc = re.sub(r"\s*Awakened\s+", " ", desc, count=1)
        desc = re.split(r"\s+Soulburn\s+\d|\s+Skill Enhance\s+", desc, maxsplit=1)[0]
        desc = re.sub(r"^\d+\s+turns\s+", "", desc)
        desc = re.sub(r"^Acquire\s+\d+\s+Soul\s+", "", desc)
        desc = re.sub(r"^Animation\s+.+?\s+Official video\s+", "", desc)
        before = ""
        if "Before awakening" in desc:
            main, before = desc.split("Before awakening", 1)
            desc = main.strip()
            before = before.strip()
        skills[f"S{slot_m.group(1)}"] = {
            "name": name,
            "passive": passive,
            "cooldownShown": int(cd_m.group(1)) if cd_m and not passive else None,
            "soulGain": soul_gain,
            "toolsRate": float(rate_m.group(1)) if rate_m else None,
            "toolsPow": float(pow_m.group(1)) if pow_m else None,
            "soulburnCost": int(burn_m.group(1)) if burn_m else None,
            "soulburnText": burn_m.group(2).strip() if burn_m else None,
            "enhanceSummary": enh or None,
            "enhanceDamagePct": damage_pct,
            "enhanceEffectPct": effect_pct,
            "enhanceCooldownCut": cd_cut,
            "text": desc.strip(),
            "textBeforeAwaken": before or None,
        }
    return skills


DEBUFF_KINDS = {
    "stun": "stun",
    "sleep": "sleep",
    "silence": "silence",
    "provoke": "provoke",
    "fear": "fear",
    "seal": "seal",
    "bind": "bind",
    "block": "block",
    "unable to be buffed": "unbuffable",
    "unable to counterattack": "uncounterable",
    "decreased defense": "defDown",
    "decrease defense": "defDown",
    "decreased attack": "atkDown",
    "decrease attack": "atkDown",
    "decreased hit chance": "hitDown",
    "decreased speed": "spdDown",
}


def effects_from_text(text: str) -> list[dict]:
    """Pull only mechanics the sentence states. No guessed magnitudes."""
    if not text:
        return []
    found = []

    def add(entry: dict) -> None:
        key = (entry.get("kind"), entry.get("source"), entry.get("chance"), entry.get("amount"))
        if key not in seen:
            seen.add(key)
            found.append(entry)

    seen = set()
    m = re.search(
        r"Speed of all Heroes except for the caster is limited to a maximum of (\d+)% of the caster's Speed",
        text,
    )
    if m:
        add({"kind": "speedCap", "ratio": int(m.group(1)) / 100, "source": m.group(0)})
    if re.search(r"Combat Readiness increase effects of all Heroes is not applied", text):
        add({
            "kind": "crLockOnCasterTurn",
            "source": "On the caster's turn, Combat Readiness increase effects of all Heroes is not applied.",
        })
    if re.search(r"Speed of the caster is fixed", text):
        add({"kind": "fixOwnSpeed", "source": "Speed of the caster is fixed going forward"})
    if re.search(r"Unaffected by (?:effects that reduce )?Combat Readiness", text):
        add({"kind": "crImmune", "source": "Unaffected by Combat Readiness increase and decrease effects"})
    if re.search(r"cannot trigger a critical hit", text, re.I):
        add({"kind": "cannotCrit", "source": "cannot trigger a critical hit"})
    if re.search(r"always results in a critical hit", text, re.I):
        add({"kind": "alwaysCrit", "source": "always results in a critical hit"})

    m = re.search(r"Decreases the amount of Soul acquired by the enemy by (\d+)%", text)
    if m:
        add({"kind": "soulCut", "ratio": int(m.group(1)) / 100, "source": m.group(0)})
    m = re.search(r"revives? to (\d+)% Health", text, re.I)
    if m:
        add({"kind": "revive", "hpRatio": int(m.group(1)) / 100, "source": m.group(0)})
    if re.search(r"Grants an extra turn", text):
        add({"kind": "extraTurn", "source": "Grants an extra turn"})

    for m in re.finditer(
        r"(?:with |has )?a (\d+)% chance(?: each)? to (?:inflict |decrease )?"
        r"(stun|sleep|silence|provoke|fear|seal|bind|block|unable to be buffed|unable to counterattack|decreased Defense|decrease Defense|decreased Attack|decrease Attack|decreased Hit Chance|decreased Speed)",
        text,
        re.I,
    ):
        kind = DEBUFF_KINDS[m.group(2).lower()]
        turns_m = re.search(r"for (\d+) turn", text[m.start() : m.end() + 48])
        entry = {"kind": kind, "chance": int(m.group(1)) / 100, "source": m.group(0)}
        if turns_m:
            entry["turns"] = int(turns_m.group(1))
        if kind == "defDown":
            val = re.search(r"Decreases Defense by (\d+)%", text)
            if val:
                entry["value"] = int(val.group(1)) / 100
        if kind == "atkDown":
            val = re.search(r"Decreases Attack by (\d+)%", text)
            if val:
                entry["value"] = int(val.group(1)) / 100
        add(entry)

    # "75% chance each to inflict A and B for 2 turns" only tags the first name above.
    if re.search(r"unable to be buffed for (\d+) turn", text, re.I):
        chance_m = re.search(r"(\d+)% chance each to inflict unable to counterattack and unable to be buffed", text, re.I)
        turns_m = re.search(r"unable to be buffed for (\d+) turn", text, re.I)
        if chance_m and turns_m:
            add({
                "kind": "unbuffable",
                "chance": int(chance_m.group(1)) / 100,
                "turns": int(turns_m.group(1)),
                "source": chance_m.group(0),
            })

    m = re.search(r"decreasing buff durations by (\d+) turns", text, re.I)
    if m:
        add({"kind": "cutBuffDuration", "turns": int(m.group(1)), "source": m.group(0)})
    m = re.search(r"dispels (all|two|one) (buffs|debuffs)", text, re.I)
    if m:
        count = {"all": 99, "two": 2, "one": 1}[m.group(1).lower()]
        add({"kind": "dispelBuff" if m.group(2).lower() == "buffs" else "dispelDebuff", "count": count, "source": m.group(0)})
    m = re.search(r"dispelling (two|one) buffs", text, re.I)
    if m:
        add({"kind": "dispelBuff", "count": 2 if m.group(1).lower() == "two" else 1, "source": m.group(0)})
    if re.search(r"Penetrates the target's Defense", text):
        pen = re.search(r"Penetrates the target's Defense by (\d+)%", text)
        entry = {"kind": "penetrate", "source": pen.group(0) if pen else "Penetrates the target's Defense"}
        if pen:
            entry["ratio"] = int(pen.group(1)) / 100
        add(entry)

    for m in re.finditer(
        r"(increases|decreases|decreasing) (?:the )?Combat Readiness(?: of (the caster|all allies|all enemies|the enemy))? by (\d+)%(?!\s+of the amount)",
        text,
        re.I,
    ):
        verb = m.group(1).lower()
        who = (m.group(2) or "").lower()
        add({
            "kind": "crPush" if verb.startswith("increase") else "crPushback",
            "who": who or "the target",
            "amount": int(m.group(3)),
            "atBattleStart": "at the start" in text[max(0, m.start() - 80) : m.start()].lower(),
            "source": m.group(0),
        })
    m = re.search(r"decreasing Combat Readiness by a random amount between (\d+)% and (\d+)%", text, re.I)
    if m:
        add({
            "kind": "crPushback",
            "who": "all enemies",
            "amountMin": int(m.group(1)),
            "amountMax": int(m.group(2)),
            "source": m.group(0),
        })
    if re.search(r"provokes for (\d+) turn", text, re.I):
        tm = re.search(r"provokes for (\d+) turn", text, re.I)
        add({"kind": "provoke", "chance": 1, "turns": int(tm.group(1)), "source": tm.group(0)})
    if re.search(r"inflicting silence for (\d+) turn", text, re.I):
        tm = re.search(r"inflicting silence for (\d+) turn", text, re.I)
        add({"kind": "silence", "chance": 1, "turns": int(tm.group(1)), "source": tm.group(0)})

    if re.search(r"\bbarrier\b", text, re.I):
        add({"kind": "barrier", "source": "barrier", "scaling": "fribbels-option"})
    if re.search(r"skill nullifier", text, re.I):
        add({"kind": "skillNull", "source": "skill nullifier"})
    if re.search(r"fully recover Health|recovers Health|recovering Health", text, re.I):
        full = bool(re.search(r"fully recover Health", text, re.I))
        add({"kind": "heal", "full": full, "source": "recover Health", "scaling": "fribbels-option"})

    if re.search(r"extra attack", text, re.I):
        add({
            "kind": "extraAttack",
            "simulated": False,
            "source": "extra attack",
            "gap": "Fribbels herodata has no separate multiplier for this extra attack, so its damage is not simulated.",
        })
    return found


def soulburn_effects(text: str | None) -> list[dict]:
    if not text:
        return []
    out = []
    if re.search(r"Ignores Effect Resistance", text, re.I):
        out.append({"kind": "ignoreResistance", "source": text})
    m = re.search(r"(?:Effect Chance|effect chance)[^.]{0,48}?(\d+)%", text, re.I)
    if m and re.search(r"100%|increases to", text, re.I):
        out.append({"kind": "effectChance", "chance": int(m.group(1)) / 100, "source": text})
    m = re.search(r"cooldown is decreased by (\d+) turns", text, re.I)
    if m:
        out.append({"kind": "cooldownCut", "turns": int(m.group(1)), "source": text})
    m = re.search(r"for (\d+) turns", text)
    if m and re.search(r"decreases Defense", text, re.I):
        out.append({"kind": "defDownTurns", "turns": int(m.group(1)), "source": text})
    if not out:
        out.append({
            "kind": "unparsed",
            "simulated": False,
            "source": text,
            "gap": "Soul burn sentence has no number this simulator knows how to apply.",
        })
    return out


def parse_rta_gear(html: str) -> dict:
    def section(label: str) -> str:
        i = html.find(f">{label}</span>")
        if i < 0:
            i = html.find(label)
        return html[i : i + 20000] if i >= 0 else ""

    def rows_from(block: str, stop_label: str | None = None) -> list[dict]:
        if stop_label and stop_label in block:
            block = block.split(stop_label, 1)[0]
        body = block.split("<tbody", 1)[-1]
        body = body.split("</tbody>", 1)[0]
        parsed = []
        for row in re.findall(r"<tr[\s\S]*?</tr>", body):
            names = re.findall(r'alt="([^"]+)"', row)
            nums = re.findall(r">\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|<)", row)
            games = re.findall(r">\s*([0-9,]+)\s*<", row)
            game_n = None
            for g in games:
                n = int(g.replace(",", ""))
                if n > 20:
                    game_n = n
                    break
            if not names or not nums:
                continue
            names = [unescape(n).replace(" picture", "").strip() for n in names]
            parsed.append({
                "names": names,
                "pickRate": float(nums[0]),
                "winRate": float(nums[1]) if len(nums) > 1 else None,
                "games": game_n,
            })
        return parsed

    updated = None
    um = re.search(r"Last Updated:\s*([A-Za-z]+ \d{1,2}, \d{4})", plain_html(html[:8000] + html))
    # The date is in the flight text.
    um = re.search(r"Last Updated:.{0,40}?([A-Z][a-z]+ \d{1,2}, \d{4})", plain_html(html))
    if um:
        updated = um.group(1)
    set_block = section("Set (Agg)")
    # Individual set table is the earlier "Set" header. Take the Set (Agg) one from its header,
    # and the single-set table by finding the header that is exactly Set before Set (Agg).
    single = ""
    idx = html.find(">Set</span>")
    agg = html.find("Set (Agg)")
    if idx >= 0:
        single = html[idx:agg if agg > idx else idx + 12000]
    art = section("Artifact")
    return {
        "updated": updated,
        "setCombos": rows_from(set_block, ">Hero</")[:5],
        "sets": rows_from(single, "Set (Agg)")[:8],
        "artifacts": rows_from(art, ">Set</span>")[:5],
    }


def parse_editorial(html: str) -> dict:
    text = plain_html(html)
    # Recommended set block is the game's journal sets, not the ladder.
    sets = re.findall(r"(Speed|Hit|Critical|Defense|Health|Attack|Counter|Lifesteal|Destruction|Resist|Unity|Rage|Immunity|Penetration|Revenge|Injury|Protection|Torrent|Reversal|Riposte|Warfare|Pursuit|Weakening|Fervor) Set", text)
    # Keep the first pair after "Recommended Set".
    rec = []
    i = text.find("Recommended Set")
    if i >= 0:
        rec = re.findall(
            r"(Speed|Hit|Critical|Defense|Health|Attack|Counter|Lifesteal|Destruction|Resist|Unity|Rage|Immunity|Penetration|Revenge|Injury|Protection|Torrent|Reversal|Riposte|Warfare|Pursuit|Weakening|Fervor) Set",
            text[i : i + 400],
        )
    sub_start = text.find("Substat")
    priority = []
    avoid = []
    mains_sentence = None
    if sub_start >= 0:
        window = text[sub_start : sub_start + 900]
        # Numbered priorities are short stat names on their own.
        for m in re.finditer(
            r"\b(\d)\s+(Health %|Defense %|Attack %|Speed|Critical Hit Chance|Critical Hit Damage|Effectiveness|Effect Resistance|Health|Defense|Attack)\b",
            window,
        ):
            priority.append(m.group(2))
        avoid_m = re.search(r"No use here\s+(.+?)\s+(?:In PvP|Skill order|Crit Damage on)", window)
        if avoid_m:
            avoid = re.findall(
                r"Health %|Defense %|Attack %|Speed|Critical Hit Chance|Critical Hit Damage|Effectiveness|Effect Resistance|Attack|Health|Defense",
                avoid_m.group(1),
            )
        sent = re.search(
            r"((?:Crit Damage|Health %|Speed|Defense %|Attack %)[^.]{0,80}(?:necklace|ring|boots)[^.]*)",
            text[sub_start : sub_start + 1400],
            re.I,
        )
        if sent:
            mains_sentence = sent.group(1).strip()
    return {
        "gameSets": rec[:4],
        "substatPriority": priority,
        "substatAvoid": avoid,
        "mainsSentence": mains_sentence,
    }


def median(values: list[float]) -> int:
    return int(round(statistics.median(values)))


def main() -> None:
    print("fetch fribbels")
    heroes = json.loads(fetch(HERO_URL))
    artifacts = json.loads(fetch(ARTIFACT_URL))
    zh = json.loads(fetch(ZH_URL))
    by_code = {h["code"]: h for h in heroes.values()}
    art_by_code = {a["code"]: name for name, a in artifacts.items()}

    catalog_heroes = []
    for code in CORE:
        hero = by_code[code]
        name = hero["name"]
        slug = hero["_id"]
        print("hero", name)
        tools_html = fetch(f"https://epic7tools.dev/heroes/{slug}/").decode("utf-8", "replace")
        rta_html = fetch(f"https://www.epic7rtastats.com/heroes/{code}").decode("utf-8", "replace")
        rows = []
        try:
            builds_raw = json.loads(fetch(BUILDS_URL, data=name.encode()))
            rows = builds_raw.get("data") or []
        except Exception as exc:  # noqa: BLE001
            print("builds failed", name, exc)
            previous = DATA / "catalog.json"
            if previous.exists():
                old = json.loads(previous.read_text())
                prev = next((h for h in old.get("heroes", []) if h["code"] == code), None)
                if prev and prev.get("reference"):
                    rows = []
                    # Reuse the previous median by synthesizing nothing; filled below from prev.
                    hero["_previousReference"] = prev["reference"]
        skills_txt = parse_skills(tools_html)
        gear = parse_rta_gear(rta_html)
        editorial = parse_editorial(tools_html)
        base = hero["calculatedStatus"]["lv60SixStarFullyAwakened"]
        skills_out = {}
        gaps = []
        for slot in ("S1", "S2", "S3"):
            fb = hero["skills"].get(slot, {})
            tx = skills_txt.get(slot, {})
            if tx.get("toolsRate") is not None and fb.get("rate") is not None:
                if abs(tx["toolsRate"] - fb["rate"]) > 0.001:
                    gaps.append(
                        f"{slot} attack rate mismatch: Fribbels {fb.get('rate')} vs Epic7Tools {tx['toolsRate']}. Using Fribbels."
                    )
            if tx.get("toolsPow") is not None and fb.get("pow") not in (None, 0):
                if abs(tx["toolsPow"] - fb["pow"]) > 0.001:
                    gaps.append(
                        f"{slot} power mismatch: Fribbels {fb.get('pow')} vs Epic7Tools {tx['toolsPow']}. Using Fribbels."
                    )
            text = tx.get("text") or ""
            effects = effects_from_text(text)
            burn = soulburn_effects(tx.get("soulburnText"))
            if any(e.get("kind") == "extraAttack" for e in effects):
                gaps.append(f"{name} {slot} extra attack is not damaged in the sim: no separate Fribbels multiplier.")
            if any(e.get("kind") == "unparsed" for e in burn):
                gaps.append(f"{name} {slot} soul burn text was stored but not fully simulated.")
            option_rows = []
            for opt in fb.get("options") or []:
                option_rows.append({k: v for k, v in opt.items() if v not in (None, "", [], {})})
            skills_out[slot] = {
                "name": tx.get("name") or slot,
                "passive": bool(tx.get("passive")) if tx else (not fb.get("rate") and not fb.get("targets") and not option_rows),
                "rate": fb.get("rate") or 0,
                "pow": fb.get("pow") if fb.get("pow") not in (None,) else 0,
                "targets": fb.get("targets") or 0,
                "selfHpScaling": fb.get("selfHpScaling") or 0,
                "selfAtkScaling": fb.get("selfAtkScaling") or 0,
                "selfDefScaling": fb.get("selfDefScaling") or 0,
                "selfSpdScaling": fb.get("selfSpdScaling") or 0,
                "penetration": fb.get("penetration") or 0,
                "increasedValue": fb.get("increasedValue") or 0,
                "cdmgIncrease": fb.get("cdmgIncrease") or 0,
                "note": fb.get("note") or "",
                "options": option_rows,
                "cooldownShown": tx.get("cooldownShown"),
                "soulGain": tx.get("soulGain") or 0,
                "soulburnCost": tx.get("soulburnCost"),
                "soulburnText": tx.get("soulburnText"),
                "soulburnEffects": burn,
                "enhanceSummary": tx.get("enhanceSummary"),
                "enhanceDamagePct": tx.get("enhanceDamagePct") or 0,
                "enhanceEffectPct": tx.get("enhanceEffectPct") or 0,
                "enhanceCooldownCut": tx.get("enhanceCooldownCut") or 0,
                "text": text,
                "textBeforeAwaken": tx.get("textBeforeAwaken"),
                "effects": effects,
                "fribbelsOnly": not bool(tx),
            }
            if not tx:
                gaps.append(f"{name} {slot} has Fribbels multipliers but no Epic7Tools text, so effects were not added.")

        dates = [r.get("createDate") for r in rows if r.get("createDate")]
        ref = hero.pop("_previousReference", None)
        if rows:
            ref = {
                "n": len(rows),
                "dateMin": min(dates) if dates else None,
                "dateMax": max(dates) if dates else None,
                "median": {
                    "attack": median([r["atk"] for r in rows]),
                    "hp": median([r["hp"] for r in rows]),
                    "defense": median([r["def"] for r in rows]),
                    "speed": median([r["spd"] for r in rows]),
                    "crit": median([r["chc"] for r in rows]),
                    "critDamage": median([r["chd"] for r in rows]),
                    "effectiveness": median([r["eff"] for r in rows]),
                    "effectResistance": median([r["efr"] for r in rows]),
                },
            }
        else:
            if ref:
                gaps.append(f"Fribbels getBuilds failed for {name} on this run; kept the median from the previous successful fetch.")
            else:
                gaps.append(f"No Fribbels Hero Library builds returned for {name}.")

        catalog_heroes.append({
            "id": slug,
            "code": code,
            "name": name,
            "nameZh": zh.get(name, name),
            "attribute": hero["attribute"],
            "attributeZh": ATTR_ZH.get(hero["attribute"], hero["attribute"]),
            "role": hero["role"],
            "roleZh": ROLE_ZH.get(hero["role"], hero["role"]),
            "base": {
                "attack": base["atk"],
                "hp": base["hp"],
                "defense": base["def"],
                "speed": base["spd"],
                "crit": round(base["chc"] * 100),
                "critDamage": round(base["chd"] * 100),
                "effectiveness": round(base["eff"] * 100),
                "effectResistance": round(base["efr"] * 100),
            },
            "imprint": hero.get("self_devotion") or {},
            "skills": skills_out,
            "rtaGear": gear,
            "editorialGear": editorial,
            "reference": ref,
            "rtaPresence": (json.loads((DATA / "rta-presence.json").read_text()).get(code) if (DATA / "rta-presence.json").exists() else None),
            "gaps": gaps,
            "sources": {
                "multipliers": f"https://github.com/fribbels/Fribbels-Epic-7-Optimizer/blob/{FRIBBELS_COMMIT}/data/cache/herodata.json",
                "skillText": f"https://epic7tools.dev/heroes/{slug}/",
                "rtaGear": f"https://www.epic7rtastats.com/heroes/{code}",
                "referenceBuilds": BUILDS_URL,
            },
        })

    catalog = {
        "provenance": {
            "fetchedOn": "2026-11-10",
            "fribbelsCommit": FRIBBELS_COMMIT,
            "fribbelsCommitDate": "2026-11-07",
            "gamePatchAssumed": "8.7 content update on 2026-10-29, plus the 2026-11-05 bugfix patch. The 2026-11-19 balance preview is not applied.",
            "rtaSeason": "pvp_rta_ss21",
            "rtaSeasonLabel": "2026 秋季賽季（Fall 2026），Champion+",
            "damageFormula": "Fribbels StatCalculator.getSkillValue at the same commit: ((atk * rate + hp/atk/def/spd scalings) * 1.871 * pow * (1+increasedValue) * hit) / (def * (1-pen) / 300 + 1). The extra dmgUpMod = 1 + selfSpdScaling * spd term in that function is not applied, because selfSpdScaling is already inside the flat scaling and would be counted twice.",
            "element": "Advantage multiplies damage by 1.1 (comment in Fribbels damageCalc.js). Disadvantage uses the miss hit type 0.75 and cannot crit or land the skill's debuff; the 50% glance chance is the long-standing attribute rule that selects that hit type.",
            "resist": "Debuff resist chance is max(15%, effect resistance - effectiveness), capped at 100%. Proc chance in the skill text is rolled first.",
            "draft": {
                "lookedUp": "2026-11-10",
                "championPrebans": 2,
                "belowChampionPrebans": 1,
                "pickPattern": [1, 2, 2, 2, 2, 1],
                "protectedPick": 3,
                "postban": 1,
                "battleSize": 4,
                "notes": "Prebans are secret and remove the hero for both sides. Each player's own third pick cannot be post-banned. Confirmed against the live Champion+ description on Hideout's RTA draft page (season 21 data through 27 Oct 2026) and the 8 Nov 2026 STOVE thread that still asks to remove the existing third-pick protection. The 5 Nov 2026 patch notes do not change draft rules.",
                "sources": [
                    "https://www.hideoutgacha.com/games/epic-seven/rta-live",
                    "https://page.onstove.com/epicSeven/global/view/14272349",
                    "https://epic7db.com/news/115-thu-patch-information",
                ],
            },
            "accountImport": {
                "method": "Fribbels Epic 7 Optimizer gear.txt or Save-all JSON",
                "schema": "https://github.com/fribbels/Fribbels-Epic-7-Optimizer/blob/cd69229c7c60547e85cb12f3135a724f01516aa0/app/js/lib/importer.js",
                "notDone": "This app does not capture game traffic. The user exports the file in Fribbels, then loads it here.",
            },
        },
        "setZh": SET_ZH,
        "artifactNames": {code: {"name": name, "nameZh": zh.get(name, name)} for code, name in art_by_code.items()},
        "heroes": catalog_heroes,
    }
    DATA.mkdir(parents=True, exist_ok=True)
    out = DATA / "catalog.json"
    out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2))
    print("wrote", out, "heroes", len(catalog_heroes))

    sample_heroes = []
    for hero in catalog_heroes:
        ref = (hero.get("reference") or {}).get("median")
        top = (hero["rtaGear"].get("setCombos") or [{}])[0]
        art = (hero["rtaGear"].get("artifacts") or [{}])[0]
        art_name = (art.get("names") or [None])[0]
        sample_heroes.append({
            "name": hero["name"],
            "sample": True,
            "speed": ref["speed"] if ref else hero["base"]["speed"],
            "attack": ref["attack"] if ref else hero["base"]["attack"],
            "hp": ref["hp"] if ref else hero["base"]["hp"],
            "defense": ref["defense"] if ref else hero["base"]["defense"],
            "crit": ref["crit"] if ref else hero["base"]["crit"],
            "critDamage": ref["critDamage"] if ref else hero["base"]["critDamage"],
            "effectiveness": ref["effectiveness"] if ref else hero["base"]["effectiveness"],
            "effectResistance": ref["effectResistance"] if ref else hero["base"]["effectResistance"],
            "artifact": art_name,
            "artifactLimitBreak": None,
            "imprint": None,
            "awakening": 6,
            "skillEnhance": {"s1": None, "s2": None, "s3": None},
            "sets": top.get("names") or [],
            "note": "範例面板是 Fribbels Hero Library 公開提交配裝的中位數，不是你的角色。套裝與神器是 Epic7RTAStats 該英雄最常見的組合，用來示範裝備對照。",
        })
    sample = {
        "label": "範例名單",
        "warning": "這不是你的帳號。面板數字來自 Fribbels Hero Library 的提交配裝中位數；技能強化等級該資料沒有，程式預設不套用強化加成，除非你勾選假設滿強化。",
        "heroes": sample_heroes,
    }
    (DATA / "sample-roster.json").write_text(json.dumps(sample, ensure_ascii=False, indent=2))
    print("wrote sample", len(sample_heroes))


if __name__ == "__main__":
    main()
