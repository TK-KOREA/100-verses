"""읽어주기 음원 만들기 (Gemini TTS → m4a + 덩어리 시간표).

구절마다 두 파일을 만든다.
  ref.m4a   "디모데후서 3장 15절"
  text.m4a  본문. 덩어리 사이에 [short pause]를 넣어 합성하고, 소리 없는 곳으로 시간표를 뽑는다.
시간표와 본문 해시는 manifest.json에 적는다. 본문·목소리 설계가 그대로면 다시 만들지 않는다.

  python3 tools/tts/make.py daily [--loop]   → 오늘 무료 한도만큼 1번 구절부터 다섯 목소리를 같이(--loop: 매일 이어서)
  python3 tools/tts/make.py status           → 목소리별로 몇 구절 만들었는지
  python3 tools/tts/make.py sample [--ids 4] [--voices teacher,dad]   → tools/tts/out/samples/
  python3 tools/tts/make.py build --voice teacher [--ids 1-10] [--force] → web/audio/<voice>/

API 키: 환경변수 GEMINI_API_KEY, 없으면 tools/tts/.env (저장소에 올리지 않는다).
"""
from __future__ import annotations

import argparse
import array
import io
import wave
from difflib import SequenceMatcher
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
from voices import COMMON_RULES, VOICES  # noqa: E402

RATE = 24000
# 무료 등급은 모델마다 하루 10번이라 위에서부터 다 쓰면 다음 모델로 간다. 어느 모델로 만들었는지는 manifest에 남는다.
MODELS = [m for m in os.environ.get("TTS_MODELS", "").split(",") if m] or [
    "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts", "gemini-2.5-pro-preview-tts"]
BITRATE = "48k"
# 받아쓰기(모델마다 무료 한도가 따로). lite 모델은 조각마다 따로 답하지 못하고 낱말을 늘어놓아 쓰지 않는다.
HEAR_MODELS = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest"]
PAD = 0.12  # 앞뒤에 남길 쉼(초)
GAP = 0.4  # 덩어리 사이 쉼(초)
PIECE_GAP = 0.25  # 받아쓰기 조각을 나누는 쉼(초)

# ---------- 글 ----------

PUNCT_END = re.compile(r"[,.?!:;”’」』)]$")
# 앞말에 붙어 읽어야 하는 말. 이 말 앞에서는 끊지 않는다.
BOUND = re.compile(r"^(수|것\S*|때\S*|뿐|데\S*|줄|적이|있\S*|없\S*|않\S*|못할\S*|못하\S*|합니다\S*|하십니다\S*|하겠다\S*|하시리라\S*|하되\S*|하며\S*|하고\S*|하게\S*|되고\S*|되게\S*|되어\S*|주고\S*|주시\S*|다니는|계신\S*|분이\S*|분은\S*|분께서\S*|안에\S*|위하여\S*|통하여\S*|따라\S*)$")


def chunks_of(text: str, fixes: dict, vid: int) -> list[str]:
    """본문을 따라 말하기 좋은 덩어리로 나눈다. 손으로 나눈 것(chunks.txt)이 있으면 그것을 쓴다.
    끊는 곳: 쉼표·마침표 뒤, 또는 덩어리가 길어졌을 때(어절 3개 또는 10자). 뒤에 붙는 말 앞에서는 미룬다."""
    if str(vid) in fixes:
        return fixes[str(vid)]
    words = text.replace("\n", " ").split()
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else ""
        n = len("".join(cur))
        if not nxt:
            break
        glued = bool(BOUND.match(nxt)) and not PUNCT_END.search(w)
        if PUNCT_END.search(w) and (n >= 5 or len(out) == 0):
            out.append(" ".join(cur)); cur = []
        elif not glued and (len(cur) >= 3 or n >= 10) and len(cur) < 5:
            out.append(" ".join(cur)); cur = []
        elif len(cur) >= 5:
            out.append(" ".join(cur)); cur = []
    if cur:
        if out and len("".join(cur)) <= 4:
            out[-1] += " " + " ".join(cur)
        else:
            out.append(" ".join(cur))
    return out


def load_chunks(by_id: dict) -> dict:
    """chunks.txt(손으로 나눈 덩어리)를 읽는다. 이은 글이 본문과 다르면 멈춘다."""
    out, bad = {}, []
    path = HERE / "chunks.txt"
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        vid, _, rest = line.partition("|")
        parts = [c.strip() for c in rest.split(" / ") if c.strip()]
        if " ".join(parts) != " ".join(by_id[int(vid)]["text"].split()):
            bad.append(vid)
        out[vid.strip()] = parts
    if bad:
        sys.exit("chunks.txt 덩어리를 이은 글이 본문과 다릅니다: " + ", ".join(bad))
    return out


def spoken_ref(v: dict) -> str:
    if v["verseEnd"] != v["verseStart"]:
        rng = f"{v['verseStart']}절에서 {v['verseEnd']}절"
    else:
        rng = f"{v['verseStart']}절"
    return f"{v['book']} {v['chapter']}장 {rng}"


def prompt_for(p: dict, transcript: str) -> str:
    return (
        "Synthesize speech for the performance defined below.\n"
        "The profile, scene, and notes are direction only. Do NOT speak them.\n"
        "Speak ONLY the lines under #### TRANSCRIPT, in Korean.\n\n"
        "# AUDIO PROFILE\n"
        f"Style: {p['style']}\n"
        f"Voice: {p['voice_desc']}\n\n"
        "# SCENE\n"
        f"{p['scene']}\n\n"
        "### DIRECTOR'S NOTES\n"
        f"Pace: {p['pace']}\n"
        f"Tone: {p['tone']}\n"
        f"Rules: {COMMON_RULES}\n\n"
        "#### TRANSCRIPT\n"
        f"{transcript}\n"
    )


def design_hash(p: dict) -> str:
    s = json.dumps([p, COMMON_RULES, BITRATE, GAP], ensure_ascii=False, sort_keys=True)
    return hashlib.sha1(s.encode()).hexdigest()[:10]


def text_hash(s) -> str:
    return hashlib.sha1(json.dumps(s, ensure_ascii=False).encode()).hexdigest()[:10]

# ---------- Gemini ----------

_client = None
_model = None


def load_key() -> None:
    if os.environ.get("GEMINI_API_KEY"):
        return
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, val = line.partition("=")
            if k.strip() == "GEMINI_API_KEY" and val.strip():
                os.environ["GEMINI_API_KEY"] = val.strip().strip('"').strip("'")
    if not os.environ.get("GEMINI_API_KEY"):
        sys.exit("GEMINI_API_KEY가 없습니다. 환경변수나 tools/tts/.env에 넣어 주세요.")


def synth_client():
    global _client
    from google import genai
    if _client is None:
        _client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    return _client


class QuotaDone(Exception):
    """오늘 쓸 수 있는 요청을 다 썼다(무료 등급은 모델마다 하루 10번)."""


_spent = set()  # 오늘 한도를 다 쓴 모델


def _wait_of(msg: str) -> float:
    m = re.search(r"retry in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s", msg)
    if not m:
        return 0.0
    h, mi, se = m.groups()
    return int(h or 0) * 3600 + int(mi or 0) * 60 + float(se)


def call(models: list, fn):
    """모델을 차례로 써 본다. 하루 한도를 다 쓴 모델은 건너뛰고, 분당 한도면 기다렸다 다시 보낸다.
    모두 다 썼으면 QuotaDone. 반환: (결과, 쓴 모델)"""
    last = None
    for model in [m for m in models if m not in _spent]:
        for attempt in range(6):
            try:
                return fn(model), model
            except Exception as e:  # noqa: BLE001
                last = e
                msg = str(e)
                if "404" in msg or "NOT_FOUND" in msg:
                    _spent.add(model)  # 이 모델은 없음
                    break
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    wait = _wait_of(msg)
                    if "PerDay" in msg or wait > 300:
                        _spent.add(model)
                        print(f"  · {model} 오늘 한도 다 씀", flush=True)
                        break
                    time.sleep(min(max(wait, 5), 90) + 1)
                    continue
                time.sleep(2 * (2 ** min(attempt, 4)))
    if all(m in _spent for m in models):
        raise QuotaDone()
    raise RuntimeError(f"요청 실패: {last}")


def synth(prompt: str, voice: str) -> tuple[bytes, str]:
    """PCM s16le 24kHz mono."""
    from google.genai import types

    synth_client()
    cfg = types.GenerateContentConfig(
        response_modalities=["AUDIO"],
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))
        ),
    )

    def go(model):
        r = _client.models.generate_content(model=model, contents=prompt, config=cfg)
        data = r.candidates[0].content.parts[0].inline_data.data
        if not data:
            raise RuntimeError("소리가 비어 있음")
        return data

    return call(MODELS, go)


# ---------- 소리 ----------

def frames_db(pcm: bytes, win: int) -> list[float]:
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) // 2 * 2])
    out = []
    for i in range(0, len(a), win):
        seg = a[i:i + win]
        if not seg:
            break
        ms = sum(x * x for x in seg) / len(seg)
        out.append(-100.0 if ms <= 0 else 10 * __import__("math").log10(ms / (32768.0 ** 2)))
    return out


def silences(pcm: bytes, step=0.01, min_len=0.12):
    """조용한 구간 [(시작, 끝)]. 기준은 말소리 크기에서 30dB 아래."""
    win = int(RATE * step)
    db = frames_db(pcm, win)
    loud = sorted(db)[int(len(db) * 0.9)] if db else -20
    th = max(loud - 30, -55)
    runs, s = [], None
    for i, d in enumerate(db + [0]):
        if d < th:
            if s is None:
                s = i
        elif s is not None:
            if (i - s) * step >= min_len:
                runs.append((s * step, i * step))
            s = None
    # 쉼 가운데 숨소리·딸깍 소리(0.08초 이하)는 쉼으로 본다
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] <= 0.08:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    return merged, len(db) * step


def weight(t: str) -> float:
    """읽는 길이 어림: 한글 한 자 1, 숫자 한 자 1.5(이십팔), 쉼표·마침표 0.5."""
    return sum(1.5 if c.isdigit() else 0.5 if c in ",.?!" else 0 if c.isspace() or c in "“”‘’" else 1 for c in t)


def pick_bounds(inner, lead, tail, weights):
    """덩어리 경계로 쓸 쉼을 고른다. 쉼이 길수록, 글자 수로 어림한 자리에 가까울수록 좋다(DP).
    덩어리는 0.25초보다 짧을 수 없다."""
    need = len(weights) - 1
    if need == 0:
        return [], True
    if len(inner) < need:
        return sorted(sorted(inner, key=lambda r: r[1] - r[0], reverse=True)[:need]), False
    total = sum(weights)
    span = tail - lead
    avg = span / len(weights)
    exp, acc = [], 0.0
    for w in weights[:-1]:
        acc += w
        exp.append(lead + span * acc / total)
    NEG = float("-inf")
    m = len(inner)
    # best[k][j]: k번째 경계에 j번째 쉼을 썼을 때 점수
    best = [[NEG] * m for _ in range(need)]
    back = [[-1] * m for _ in range(need)]
    for k in range(need):
        for j, (a, b) in enumerate(inner):
            mid = (a + b) / 2
            sc = (b - a) - 0.35 * abs(mid - exp[k]) / avg
            if k == 0:
                if a - lead >= 0.25:
                    best[k][j] = sc
                continue
            for i in range(j):
                if best[k - 1][i] > NEG and a - inner[i][1] >= 0.25 and best[k - 1][i] + sc > best[k][j]:
                    best[k][j], back[k][j] = best[k - 1][i] + sc, i
    last = [j for j in range(m) if best[need - 1][j] > NEG and tail - inner[j][1] >= 0.25]
    if not last:
        return sorted(sorted(inner, key=lambda r: r[1] - r[0], reverse=True)[:need]), False
    j = max(last, key=lambda x: best[need - 1][x])
    out = []
    for k in range(need - 1, -1, -1):
        out.append(inner[j])
        j = back[k][j]
    return out[::-1], True


def zc_rate(pcm: bytes, t0: float, t1: float) -> float:
    a = array.array("h")
    a.frombytes(pcm[int(t0 * RATE) * 2:int(t1 * RATE) * 2])
    n = sum(1 for i in range(1, len(a)) if (a[i - 1] < 0) != (a[i] < 0))
    return n / max(1e-6, t1 - t0)


def strip_noise_head(pcm: bytes) -> bytes:
    """3.8 모델은 맨 앞 10ms에도 딸깍 소리가 있다. 바로 뒤가 조용하면 앞 30ms를 비운다."""
    db = frames_db(pcm[:int(RATE * 0.1) * 2], int(RATE * 0.01))
    if len(db) >= 6 and max(db[:2]) > -30 and max(db[3:6]) < -40:
        n = int(RATE * 0.03) * 2
        return bytes(n) + pcm[n:]
    return pcm


def strip_noise_tail(pcm: bytes) -> bytes:
    """Gemini 소리 끝에 붙는 치지직(말이 끝나고 쉰 뒤 0.1~0.3초 시끄러운 잡음)을 잘라 낸다.
    잡음은 쉼 바로 뒤에 갑자기 아주 크게(-15dB 넘게, 말소리보다 큼) 영점 교차 초당 4000번 넘게 나온다."""
    for _ in range(3):
        runs, dur = silences(pcm, min_len=0.08)
        if not runs:
            return pcm
        last = runs[-1]
        end = dur if last[1] < dur - 0.02 else last[0]  # 끝 쉼이 있으면 그 앞이 마지막 소리의 끝
        prev = [r for r in runs if r[1] <= end - 0.01]
        if not prev:
            return pcm
        start = prev[-1][1]  # 마지막 소리 덩이의 시작
        if end - start > 0.35 or prev[-1][1] - prev[-1][0] < 0.08:
            return pcm
        seg = frames_db(pcm[int(start * RATE) * 2:int(end * RATE) * 2], int(RATE * 0.01))
        level = sorted(seg)[len(seg) // 2] if seg else -100
        if level < -15 or zc_rate(pcm, start, end) < 4000:
            return pcm
        pcm = pcm[:int(prev[-1][0] * RATE) * 2 + int(0.05 * RATE) * 2]  # 잡음 앞 쉼에서 자른다
    return pcm


def fade(pcm: bytes, fin: float = 0.0, fout: float = 0.0) -> bytes:
    """앞뒤를 짧게 서서히(딸깍 소리 막기)."""
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) // 2 * 2])
    n = len(a)
    k = min(n, int(fin * RATE))
    for i in range(k):
        a[i] = int(a[i] * i / k)
    k = min(n, int(fout * RATE))
    for i in range(k):
        a[n - 1 - i] = int(a[n - 1 - i] * i / k)
    return a.tobytes()


def norm(t: str) -> str:
    """맞춰 보기용: 띄어쓰기와 문장부호를 뺀다."""
    return re.sub(r"[^0-9A-Za-z가-힣]", "", str(t))


def _mapper(blocks):
    """받아쓴 글의 글자 자리 → 본문 글자 자리. 맞는 곳은 그대로, 사이는 비율로."""
    def f(p):
        pa = pb = 0
        for a, b, size in blocks:
            if p < a:
                return b if a == pa else pb + (p - pa) * (b - pb) / (a - pa)
            if p <= a + size:
                return b + (p - a)
            pa, pb = a + size, b + size
        return pb
    return f


def align_bounds(pcm: bytes, lead: float, tail: float, inner: list, units: list):
    """쉼마다 자른 조각을 받아쓰게 하고, 받아쓴 글을 본문과 글자 단위로 맞춰 덩어리 경계를 정한다.
    덩어리가 끝나는 글자 자리에 쉼이 있으면 그 쉼, 쉬지 않고 이어 읽었으면 조각 안을 글자 비율로 나눈다.
    반환: (경계 목록[(a,b)], 글이 맞는지, 정보) — 받아쓰기를 못 했으면 None."""
    inner = [r for r in inner if r[1] - r[0] >= PIECE_GAP]  # 짧은 쉼(어절 사이)은 조각을 나누지 않는다
    pieces = list(zip([lead] + [r[1] for r in inner], [r[0] for r in inner] + [tail]))
    got = hear_pcm([pcm[int(s0 * RATE) * 2:int(s1 * RATE) * 2] for s0, s1 in pieces])
    if got is None or len(got) != len(pieces):
        return None
    T = [norm(g) for g in got]
    C = [norm(u) for u in units]
    sm = SequenceMatcher(None, "".join(T), "".join(C), autojunk=False)
    f = _mapper(sm.get_matching_blocks())
    ends, acc = [], 0
    for t in T:
        acc += len(t)
        ends.append(acc)
    pend = [f(e) for e in ends]  # 조각 끝의 본문 글자 자리
    pstart = [0.0] + pend[:-1]
    targets, acc = [], 0
    for c in C[:-1]:
        acc += len(c)
        targets.append(acc)
    pick, last, approx = [], -1, 0
    for bk in targets:
        cand = range(last + 1, len(pieces) - 1)
        j = min(cand, key=lambda x: abs(pend[x] - bk)) if cand else None
        if j is not None and abs(pend[j] - bk) <= 1.5:
            pick.append(inner[j])
            last = j
            continue
        # 쉬지 않고 이어 읽은 자리
        q = next((x for x in range(max(last + 1, 0), len(pieces)) if pend[x] > bk), len(pieces) - 1)
        s0, s1 = pieces[q]
        r = (bk - pstart[q]) / max(1e-6, pend[q] - pstart[q])
        t = s0 + (s1 - s0) * min(0.95, max(0.05, r))
        pick.append((t, t))
        last = q - 1
        approx += 1
    times = [x for r in pick for x in r]
    if any(b2 < a2 for a2, b2 in zip(times, times[1:])):
        return None
    # 덩어리 길이가 글자 수에 견주어 말이 안 되면(한 글자에 0.04초 미만, 0.8초+1.5초 넘음) 맞춤이 틀린 것
    edges = [lead] + times + [tail]
    for (s0, s1), c in zip(zip(edges[0::2], edges[1::2]), C):
        if s1 - s0 < 0.04 * len(c) or s1 - s0 > 0.8 * len(c) + 1.5:
            return None
    ratio = sm.ratio()
    if ratio < 0.6:  # 받아쓰기가 엉뚱하다(조각과 답이 어긋남). 믿지 않고 다음에 다시 듣는다.
        return None
    return pick, ratio >= 0.9, {"heard": got, "ratio": round(ratio, 3), "approx": approx}


def trim_and_time(pcm: bytes, units: list, ears: bool):
    """앞뒤 쉼을 PAD만 남기고, 덩어리 사이 쉼은 GAP 길이로 맞춘다.
    Gemini는 [short pause]를 1~2초로 길게 쉬어서 그대로 두면 그냥 들을 때 늘어진다.
    따라 말하기 틈은 앱이 덩어리 끝에서 멈춰 준다.
    경계는 받아쓰기로 맞추고(align_bounds), 받아쓰기를 못 하면 쉼 길이와 글자 수로 어림한다(pick_bounds).
    반환: (새 pcm, [[시작,끝]...], 맞는지, 길이, 정보)"""
    pcm = strip_noise_tail(strip_noise_head(pcm))
    runs, dur = silences(pcm)
    lead = runs[0][1] if runs and runs[0][0] <= 0.01 else 0.0
    tail = runs[-1][0] if runs and runs[-1][1] >= dur - 0.02 else dur
    inner = [r for r in runs if r[0] > lead + 0.05 and r[1] < tail - 0.05]
    got = align_bounds(pcm, lead, tail, inner, units) if ears else None
    if got:
        pick, ok, info = got
    else:
        pick, ok = pick_bounds(inner, lead, tail, [weight(u) for u in units])
        info = {"unheard": True}
    edges = [lead] + [x for r in pick for x in r] + [tail]
    speech = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]

    def cut(t0, t1):
        return pcm[int(t0 * RATE) * 2:int(t1 * RATE) * 2]

    def squeeze(t0, t1):
        """덩어리 안쪽의 긴 쉼(쉼표 등)도 GAP으로 줄인다."""
        res, at = bytearray(), t0
        for a2, b2 in runs:
            if a2 >= t0 and b2 <= t1 and b2 - a2 > GAP:
                res += fade(cut(at, a2 + GAP / 2), fout=0.005)
                res += fade(cut(b2 - GAP / 2, b2), fin=0.005)
                at = b2
        res += cut(at, t1)
        return bytes(res)

    out, times = bytearray(), []
    out += cut(max(0.0, lead - PAD), lead)
    t = len(out) / 2 / RATE
    for k, (s0, s1) in enumerate(speech):
        joined = k and pick[k - 1][1] > pick[k - 1][0]  # 쉼을 줄인 자리(이어 읽은 자리는 그대로 잇는다)
        # 쉼을 줄인 자리는 소리가 이어지지 않으므로 앞뒤를 5ms씩 서서히
        seg = fade(squeeze(s0, s1), fin=0.005 if joined else 0.0)
        out += seg
        n = len(seg) / 2 / RATE
        times.append([round(t, 2), round(t + n, 2)])
        t += n
        if k < len(speech) - 1 and pick[k][1] > pick[k][0]:
            g = min(GAP, pick[k][1] - pick[k][0])
            out += fade(cut(s1, s1 + g), fout=0.005)  # 원래 쉼의 앞부분(숨, 잔향)을 남긴다
            t += g
    out += cut(tail, min(dur, tail + PAD))
    return bytes(out), times, ok, round(len(out) / 2 / RATE, 2), info


def split_ref(pcm: bytes, ref: str, chunks: list, ears: bool):
    """[주소, 덩어리...]로 합성된 소리를 주소 파일과 본문 파일로 나눈다."""
    allp, times, ok, _, info = trim_and_time(pcm, [ref] + chunks, ears)
    (rs, re_), (ts, _) = times[0], times[1]
    cut = int(((re_ + ts) / 2) * RATE) * 2  # 주소와 본문 사이 쉼의 가운데
    rp, tp = allp[:int(min(re_ + PAD, ts) * RATE) * 2], allp[cut:]
    off = cut / 2 / RATE
    lead = ts - off
    if lead > PAD:  # 본문 앞 쉼을 PAD로 맞춘다
        drop = int((lead - PAD) * RATE) * 2
        tp, off = tp[drop:], off + drop / 2 / RATE
    tt = [[round(a - off, 2), round(b - off, 2)] for a, b in times[1:]]
    return rp, tp, tt, ok, round(len(rp) / 2 / RATE, 2), round(len(tp) / 2 / RATE, 2), info


def to_m4a(pcm: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = fade(pcm, fin=0.005, fout=0.015)
    with tempfile.NamedTemporaryFile(suffix=".m4a", delete=False) as tf:
        tmp = tf.name
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(RATE), "-ac", "1",
           "-i", "pipe:0", "-c:a", "aac", "-b:a", BITRATE, "-movflags", "+faststart", "-f", "ipod", tmp]
    p = subprocess.run(cmd, input=pcm, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError("ffmpeg: " + p.stderr.decode(errors="replace")[-300:])
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
    return hashlib.sha1(path.read_bytes()).hexdigest()[:8]

# ---------- 만들기 ----------

def hear_pcm(pieces: list):
    """소리 조각들을 Gemini에게 받아쓰게 한다. 한도를 다 썼거나 실패하면 None."""
    key = hashlib.sha1(b"".join(hashlib.sha1(pc).digest() for pc in pieces)).hexdigest()[:16]
    cache = HERE / "out/hearcache" / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    from google.genai import types
    synth_client()
    parts = [f"아래 한국어 음성 조각 {len(pieces)}개를 하나씩 들리는 그대로 받아써 주세요. 고치거나 더하지 말고, 숫자는 숫자로. "
             "조각 하나에 답 하나입니다. 조각 안의 말을 낱말로 나누지 마세요. "
             '[{"n": 1, "text": "..."}, ...] 꼴의 JSON 배열로만 답하세요. 소리가 없으면 text는 빈 문자열.']
    for i, pc in enumerate(pieces):
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(pc)
        parts += [f"조각 {i + 1}:", types.Part.from_bytes(data=buf.getvalue(), mime_type="audio/wav")]
    cfg = types.GenerateContentConfig(response_mime_type="application/json")
    try:
        got, _ = call(HEAR_MODELS, lambda m: json.loads(
            _client.models.generate_content(model=m, contents=parts, config=cfg).text))
    except Exception:  # noqa: BLE001  (QuotaDone 포함: 확인은 다음 날로)
        return None
    try:
        byn = {int(x["n"]): str(x.get("text", "")) for x in got}
        got = [byn[i + 1] for i in range(len(pieces))]
    except Exception:  # noqa: BLE001  (조각 수와 안 맞는 답)
        return None
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(got, ensure_ascii=False))
    return got


def finish(pcm: bytes, ref: str, chunks: list, d: Path, model: str, want: dict, ears: bool,
           only_aligned: bool = False):
    rp, tp, times, ok, rdur, tdur, info = split_ref(pcm, ref, chunks, ears)
    if only_aligned and info.get("unheard"):
        return None  # 받아쓰기로 못 맞췄으면 파일을 건드리지 않는다
    hv = to_m4a(rp, d / "ref.m4a") + to_m4a(tp, d / "text.m4a")
    # v: 소리 파일이 바뀌면 바뀌는 표시. 앱이 주소 끝에 붙여 옛 저장본을 쓰지 않게 한다.
    e = {**want, "v": hashlib.sha1(hv.encode()).hexdigest()[:8], "model": model, "ref": ref, "refDur": rdur, "dur": tdur,
         "chunks": [{"t": c, "s": t[0], "e": t[1]} for c, t in zip(chunks, times)]}
    if info.get("unheard"):
        e["unheard"] = True  # 받아쓰기를 못 해 쉼으로 어림했다. 다음 날 받아쓰기로 다시 맞춘다.
        e["check"] = False
    else:
        e["align"] = "text"  # 받아쓰기로 맞춘 경계
        e["check"] = not ok  # 받아쓴 글이 본문과 많이 다르다(잘못 읽었을 수 있다)
        e["heard"] = info["heard"]
        e["match"] = info["ratio"]
        if info["approx"]:
            e["joined"] = info["approx"]  # 쉬지 않고 이어 읽어 글자 비율로 나눈 경계 수
    # 너무 긴 소리(모델이 오래 멈추거나 헛소리를 붙임): 글자당 0.45초, 적어도 20초를 넘으면 다시 만든다
    if tdur > max(20.0, len(norm("".join(chunks))) * 0.45):
        e["check"] = True
        e["long"] = True
    return e


def raw_path(key: str, vid: int) -> Path:
    return HERE / "out/raw" / key / f"{vid:03d}.pcm"


def make_one(v: dict, key: str, out: Path, fixes: dict, entry: dict | None, force: bool, ears: bool) -> dict:
    p = VOICES[key]
    chunks = chunks_of(v["text"], fixes, v["id"])
    ref = spoken_ref(v)
    want = {"design": design_hash(p), "text": text_hash([ref, chunks])}
    d = out / f"{v['id']:03d}"
    if not force and entry and all(entry.get(k) == want[k] for k in want) and (d / "text.m4a").exists():
        return entry
    # 주소와 본문을 한 번에 합성하고(요청 수 절약, 같은 목소리 결) 첫 덩어리를 주소로 잘라 낸다.
    transcript = ref + ". [long pause] " + " [short pause] ".join(chunks)
    e = None
    for attempt in range(2):  # 받아쓰기가 안 맞으면 한 번 더 합성해 본다
        try:
            pcm, model = synth(prompt_for(p, transcript), p["voice"])
        except QuotaDone:
            if e is None:
                raise
            return e  # 다시 만들 한도가 없으면 첫 것을 "확인 필요"로 둔다
        rp = raw_path(key, v["id"])
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_bytes(pcm)
        e = finish(pcm, ref, chunks, d, model, want, ears)
        if not e["check"] or e.get("unheard"):
            break
    return e


def resplit(v: dict, key: str, out: Path, fixes: dict, entry: dict, ears: bool, only_aligned: bool = False):
    """합성은 다시 하지 않고 저장해 둔 소리로 덩어리만 다시 나눈다."""
    chunks = chunks_of(v["text"], fixes, v["id"])
    ref = spoken_ref(v)
    want = {"design": entry["design"], "text": text_hash([ref, chunks])}
    rp = raw_path(key, v["id"])
    d = out / f"{v['id']:03d}"
    if rp.exists():
        pcm = rp.read_bytes()
    else:  # 원본이 없으면 만들어 둔 두 파일을 이어 붙여 쓴다(줄인 쉼도 쉼이라 다시 찾을 수 있다)
        pcm = b"".join(subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(d / n), "-f", "s16le", "-ac", "1",
                                       "-ar", str(RATE), "pipe:1"], capture_output=True).stdout
                       for n in ("ref.m4a", "text.m4a"))
    e = finish(pcm, ref, chunks, d, entry["model"], want, ears, only_aligned)
    if e is not None:
        for k in ("tries",):
            if k in entry:
                e[k] = entry[k]
    return e


def parse_ids(s: str | None, all_ids: list[int]) -> list[int]:
    if not s:
        return all_ids
    out = []
    for part in s.split(","):
        a, _, b = part.partition("-")
        out += list(range(int(a), int(b or a) + 1))
    return out


class Store:
    """목소리마다 manifest.json을 읽고, 구절 하나 만들 때마다 바로 저장한다(중간에 끊겨도 남는다)."""

    def __init__(self, base: Path, sample: bool):
        self.base, self.sample, self.mans = base, sample, {}

    def man(self, key: str) -> dict:
        if key not in self.mans:
            mpath = self.base / key / "manifest.json"
            m = json.loads(mpath.read_text()) if mpath.exists() else {"voice": key, "verses": {}}
            m.update({"voice": key, "name": VOICES[key]["name"], "gemini": VOICES[key]["voice"], "gap": GAP, "rate": RATE})
            self.mans[key] = m
        return self.mans[key]

    def put(self, key: str, i: int, e: dict) -> None:
        heard = e.pop("heard", None)
        m = self.man(key)
        m["verses"][str(i)] = e
        out = self.base / key
        out.mkdir(parents=True, exist_ok=True)
        m["verses"] = dict(sorted(m["verses"].items(), key=lambda kv: int(kv[0])))
        (out / "manifest.json").write_text(json.dumps(m, ensure_ascii=False, separators=(",", ":")))
        if heard is not None:  # 받아쓰기 결과는 앱에 필요 없어 따로 둔다
            hp = HERE / "out/heard" / (key + ("-sample" if self.sample else "") + ".json")
            hp.parent.mkdir(parents=True, exist_ok=True)
            hd = json.loads(hp.read_text()) if hp.exists() else {}
            hd[str(i)] = heard
            hp.write_text(json.dumps(hd, ensure_ascii=False, indent=1))


def line(key: str, i: int, e: dict, t0: float) -> str:
    flag = "  ← 확인 필요" if e.get("check") else ("  (받아쓰기 확인 아직)" if e.get("unheard") else "")
    return f"{key:12s} {i:3d} {e['dur']:5.1f}s {e['model']} {time.time() - t0:4.1f}s{flag}"


def status(store: Store, ids: list) -> None:
    total = len(ids)
    print("\n목소리별 진행")
    for key in VOICES:
        vs = store.man(key)["verses"]
        done = [i for i in ids if str(i) in vs]
        chk = [i for i in done if vs[str(i)].get("check")]
        unh = [i for i in done if vs[str(i)].get("unheard")]
        models = sorted({vs[str(i)]["model"] for i in done})
        nxt = next((i for i in ids if str(i) not in vs), None)
        print(f"  {VOICES[key]['name']:10s} {len(done):3d}/{total}" + (f"  다음 {nxt}번" if nxt else "  다 만듦")
              + (f"  확인 필요 {chk}" if chk else "") + (f"  받아쓰기 아직 {len(unh)}" if unh else "")
              + (f"  모델 {', '.join(models)}" if models else ""))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["batch", "all", "daily", "sample", "build", "resplit", "verify", "status", "chunks"],
                    help="all: 유료 키로 남은 것을 한 번에(다른 모델로 만든 것·확인 필요도 다시). "
                         "daily: 오늘 한도만큼 1번 구절부터 다섯 목소리를 같이 만든다")
    ap.add_argument("--workers", type=int, default=4, help="all: 동시에 만들 수")
    ap.add_argument("--voice", help="build/resplit: 목소리 하나")
    ap.add_argument("--voices", help="sample/resplit: 쉼표로 여럿 (기본 전부)")
    ap.add_argument("--ids", help="예: 8 또는 1-10,15")
    ap.add_argument("--samples", action="store_true", help="resplit: 시험 음원 폴더에서")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-ears", action="store_true", help="받아쓰기 확인을 건너뜀")
    ap.add_argument("--publish", action="store_true", help="daily: 한 번 만들 때마다 web/audio만 커밋하고 push해 운영에 반영")
    ap.add_argument("--loop", action="store_true", help="daily: 한도를 다 쓰면 다음 한도(태평양 자정)까지 기다렸다가 이어서, 다 만들 때까지")
    a = ap.parse_args()

    data = json.loads((ROOT / "web/data/verses.json").read_text())
    by_id = {v["id"]: v for v in data["verses"]}
    all_ids = list(by_id)
    fixes = load_chunks(by_id)

    if a.cmd == "chunks":  # 합성 없이 덩어리 나누기만 본다
        for i in parse_ids(a.ids, all_ids):
            mark = "" if str(i) in fixes else "  (자동)"
            print(i, " / ".join(chunks_of(by_id[i]["text"], fixes, i)) + mark)
        return

    sample = a.cmd == "sample" or a.samples
    store = Store(HERE / "out/samples" if sample else ROOT / "web/audio", sample)
    if a.cmd == "status":
        return status(store, all_ids)

    load_key()
    if a.cmd == "all":
        return build_all(a, store, by_id, all_ids, fixes)
    if a.cmd == "batch":
        return build_batch(a, store, by_id, all_ids, fixes)
    if a.cmd in ("sample", "verify", "daily") or (a.cmd == "resplit" and not a.voice):
        keys = a.voices.split(",") if a.voices else list(VOICES)
    elif a.voice in VOICES:
        keys = [a.voice]
    else:
        sys.exit("--voice: " + ", ".join(VOICES))
    ids = parse_ids(a.ids or ("8" if sample else None), all_ids)
    ears = not a.no_ears

    # 할 일: daily는 구절 순서(1번부터)로 다섯 목소리를 같이 만든다. 아이들이 앞 구절부터 외우기 때문이다.
    if a.cmd == "daily":
        jobs = [(k, i) for i in ids for k in keys]
    else:
        jobs = [(k, i) for k in keys for i in ids]

    def one_pass() -> int:
        made = 0
        _spent.clear()  # 새 날이면 한도가 다시 생긴다
        try:
            if a.cmd in ("daily", "verify"):
                # 1) 받아쓰기로 경계를 맞추지 않은 것을 다시 맞춘다(합성 한도는 안 쓴다)
                for k, i in jobs:
                    e = store.man(k)["verses"].get(str(i))
                    if e and e.get("align") != "text":
                        t0 = time.time()
                        e = resplit(by_id[i], k, store.base / k, fixes, e, True, only_aligned=True)
                        if e is not None:
                            store.put(k, i, e)
                            print(line(k, i, e, t0) + "  (받아쓰기로 다시 맞춤)", flush=True)
                if a.cmd == "verify":
                    return 0
                # 2) "확인 필요"(잘못 읽었거나 너무 긴 것)를 다시 만든다. 구절마다 두 번까지.
                for k, i in jobs:
                    old = store.man(k)["verses"].get(str(i))
                    # 받아쓰기로 맞춰 본 뒤에도 "확인 필요"인 것만(쉼으로 어림한 옛 표시는 믿지 않는다)
                    if old and old.get("check") and (old.get("align") == "text" or old.get("long")) \
                            and old.get("tries", 0) < 2:
                        t0 = time.time()
                        e = make_one(by_id[i], k, store.base / k, fixes, old, True, ears)
                        e["tries"] = old.get("tries", 0) + 1
                        store.put(k, i, e)
                        made += 1
                        print(line(k, i, e, t0) + "  (다시 만듦)", flush=True)
            for k, i in jobs:
                t0 = time.time()
                old = store.man(k)["verses"].get(str(i))
                if a.cmd == "resplit":
                    if not old:
                        continue
                    e = resplit(by_id[i], k, store.base / k, fixes, old, ears)
                else:
                    e = make_one(by_id[i], k, store.base / k, fixes, old, a.force, ears)
                    if e is old:
                        continue
                    made += 1
                store.put(k, i, e)
                print(line(k, i, e, t0), flush=True)
        except QuotaDone:
            print(f"\n오늘 쓸 수 있는 합성 한도를 다 썼어요. 이번에 {made}개 만들었습니다.", flush=True)
        return made

    def left() -> bool:
        """아직 만들 것(또는 받아쓰기 확인을 못 한 것)이 있는가."""
        for k, i in jobs:
            e = store.man(k)["verses"].get(str(i))
            if not e or e.get("unheard"):
                return True
        return False

    while True:
        print(f"── {time.strftime('%Y-%m-%d %H:%M')} 시작", flush=True)
        one_pass()
        if a.cmd in ("daily", "build", "verify"):
            status(store, all_ids)
        if a.publish and not sample:
            publish(store, all_ids)
        if not a.loop or not left():
            if a.loop:
                print("다 만들었어요. 끝냅니다.", flush=True)
            return
        wake = next_reset()
        print(f"다음 한도는 {wake.strftime('%m-%d %H:%M')}(한국 시간)에 생겨요. 그때까지 기다립니다.", flush=True)
        # 맥이 잠자는 동안에는 time.sleep이 멈출 수 있어 벽시계로 1분마다 본다.
        while datetime.now(KST) < wake:
            time.sleep(60)


def build_all(a, store: "Store", by_id: dict, all_ids: list, fixes: dict) -> None:
    """유료 키로 한 번에: 없는 것은 만들고, 맨 앞 모델(3.8)이 아닌 것·확인 필요·너무 긴 것은 다시 만들고,
    받아쓰기로 맞추지 않은 것은 원본으로 다시 맞춘다. 10구절마다 운영에 반영한다."""
    import threading
    from concurrent.futures import ThreadPoolExecutor

    best = MODELS[0]
    keys = a.voices.split(",") if a.voices else list(VOICES)
    ids = parse_ids(a.ids, all_ids)
    lock = threading.Lock()
    stop = threading.Event()
    counts = {"made": 0, "aligned": 0, "fail": 0}
    for k in keys:
        store.man(k)  # 여러 일꾼이 동시에 만들지 않게 미리 읽어 둔다

    def work(k, i):
        if stop.is_set():
            return
        t0 = time.time()
        old = store.man(k)["verses"].get(str(i))
        try:
            redo = old and old.get("model") == best and (old.get("check") or old.get("long"))
            if redo and old.get("tries", 0) >= 2:
                return  # 두 번 다시 만들어도 안 맞으면 사람이 듣고 정한다
            if not old or old.get("model") != best or redo:
                e = make_one(by_id[i], k, store.base / k, fixes, old, True, True)
                if redo:
                    e["tries"] = old.get("tries", 0) + 1
                kind = "made"
            elif old.get("align") != "text":
                e = resplit(by_id[i], k, store.base / k, fixes, old, True, only_aligned=True)
                kind = "aligned"
                if e is None:
                    return
            else:
                return
        except QuotaDone:
            stop.set()
            return
        except Exception as ex:  # noqa: BLE001
            with lock:
                counts["fail"] += 1
                print(f"{k:12s} {i:3d} 실패: {str(ex)[:160]}", flush=True)
            return
        with lock:
            store.put(k, i, e)
            counts[kind] += 1
            print(line(k, i, e, t0) + ("  (다시 맞춤)" if kind == "aligned" else ""), flush=True)

    def left() -> bool:
        for k in keys:
            for i in ids:
                e = store.man(k)["verses"].get(str(i))
                if not e or e.get("model") != best or (e.get("check") and e.get("tries", 0) < 2) \
                        or e.get("align") != "text":
                    return True
        return False

    while True:
        print(f"── {time.strftime('%Y-%m-%d %H:%M')} 시작", flush=True)
        stop.clear()
        _spent.clear()
        for start in range(0, len(ids), 10):
            batch = [(k, i) for i in ids[start:start + 10] for k in keys]
            with ThreadPoolExecutor(max_workers=a.workers) as ex:
                list(ex.map(lambda job: work(*job), batch))
            if a.publish:
                publish(store, all_ids)
            if stop.is_set():
                print("오늘 합성 한도를 다 썼어요(3.8 TTS는 유료 1단계도 하루 100번).", flush=True)
                break
        print(f"\n지금까지 만든 것 {counts['made']}, 다시 맞춘 것 {counts['aligned']}, 실패 {counts['fail']}", flush=True)
        status(store, all_ids)
        if not a.loop or not left():
            return
        wake = next_reset()
        print(f"다음 한도는 {wake.strftime('%m-%d %H:%M')}(한국 시간)에 생겨요. 그때까지 기다립니다.", flush=True)
        while datetime.now(KST) < wake:
            time.sleep(60)


BATCH_SIZE = 20  # 작업 하나에 넣는 요청 수(결과가 작업 안에 그대로 돌아온다)
BATCH_FILE = HERE / "out/batches.json"  # 보낸 작업과 그 안의 (목소리, 구절). 끊겨도 결과를 이어 받는다.


def needs_synth(e: dict | None, best: str) -> bool:
    if not e or e.get("model") != best:
        return True
    return bool(e.get("check") or e.get("long")) and e.get("tries", 0) < 2


def build_batch(a, store: "Store", by_id: dict, all_ids: list, fixes: dict) -> None:
    """Batch API로 한 번에 만든다. 대화형 하루 한도(3.8 TTS 100번)와 따로 세고 값은 절반.
    결과는 보통 몇 분 안에(길면 24시간) 온다. 받은 소리는 make_one과 똑같이 다듬고 받아쓰기로 맞춘다."""
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from google.genai import types

    best = MODELS[0]
    keys = a.voices.split(",") if a.voices else list(VOICES)
    ids = parse_ids(a.ids, all_ids)
    for k in keys:
        store.man(k)
    synth_client()
    lock = threading.Lock()
    counts = {"made": 0, "check": 0, "fail": 0}
    pending = json.loads(BATCH_FILE.read_text()) if BATCH_FILE.exists() else {}

    def save_pending():
        BATCH_FILE.parent.mkdir(parents=True, exist_ok=True)
        BATCH_FILE.write_text(json.dumps(pending, ensure_ascii=False, indent=1))

    def request(k, i):
        p = VOICES[k]
        v = by_id[i]
        chunks = chunks_of(v["text"], fixes, i)
        transcript = spoken_ref(v) + ". [long pause] " + " [short pause] ".join(chunks)
        return {
            "contents": [{"role": "user", "parts": [{"text": prompt_for(p, transcript)}]}],
            "config": {"response_modalities": ["AUDIO"],
                       "speech_config": {"voice_config": {"prebuilt_voice_config": {"voice_name": p["voice"]}}}},
        }

    def submit(jobs):
        for n in range(0, len(jobs), BATCH_SIZE):
            part = jobs[n:n + BATCH_SIZE]
            try:
                job = _client.batches.create(model=best, src=[request(k, i) for k, i in part],
                                             config={"display_name": f"verse-tts-{time.strftime('%m%d-%H%M')}-{n // BATCH_SIZE}"})
            except Exception as ex:  # noqa: BLE001
                if "429" in str(ex) or "RESOURCE_EXHAUSTED" in str(ex):
                    # 한꺼번에 둘 수 있는 작업 수를 넘었다. 보낸 것을 받은 뒤 다음 회차에 나머지를 보낸다.
                    print(f"작업 한도에 닿아 {len(jobs) - n}개는 다음 회차에 보냅니다.", flush=True)
                    return
                raise
            pending[job.name] = [[k, i] for k, i in part]
            save_pending()
            print(f"작업 보냄 {job.name.split('/')[-1][:10]}… {len(part)}개", flush=True)

    def take(k, i, data):
        """받은 소리 하나를 다듬어 저장한다."""
        t0 = time.time()
        if data[:4] == b"RIFF":
            data = data[44:]
        v = by_id[i]
        p = VOICES[k]
        chunks = chunks_of(v["text"], fixes, i)
        ref = spoken_ref(v)
        want = {"design": design_hash(p), "text": text_hash([ref, chunks])}
        rp = raw_path(k, i)
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_bytes(data)
        old = store.man(k)["verses"].get(str(i))
        e = finish(data, ref, chunks, store.base / k / f"{i:03d}", best, want, True)
        if old and old.get("model") == best and (old.get("check") or old.get("long")):
            e["tries"] = old.get("tries", 0) + 1
        with lock:
            store.put(k, i, e)
            counts["made"] += 1
            counts["check"] += 1 if e.get("check") else 0
            print(line(k, i, e, t0), flush=True)

    def collect():
        """보낸 작업이 다 끝날 때까지 기다리며, 끝난 작업의 결과를 처리한다."""
        while pending:
            for name in list(pending):
                job = _client.batches.get(name=name)
                state = str(job.state)
                if not any(x in state for x in ("SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED")):
                    continue
                items = pending[name]
                if "SUCCEEDED" in state:
                    resps = job.dest.inlined_responses or []
                    work = []
                    for (k, i), r in zip(items, resps):
                        try:
                            if r.error:
                                raise RuntimeError(str(r.error))
                            work.append((k, i, r.response.candidates[0].content.parts[0].inline_data.data))
                        except Exception as ex:  # noqa: BLE001
                            counts["fail"] += 1
                            print(f"{k:12s} {i:3d} 실패: {str(ex)[:120]}", flush=True)
                    with ThreadPoolExecutor(max_workers=a.workers) as ex:
                        list(ex.map(lambda w: take(*w), work))
                else:
                    counts["fail"] += len(items)
                    print(f"작업 {name.split('/')[-1][:10]}… {state}", flush=True)
                del pending[name]
                save_pending()
                if a.publish:
                    publish(store, all_ids)
            if pending:
                time.sleep(30)

    print(f"── {time.strftime('%Y-%m-%d %H:%M')} 시작 (Batch API, {best})", flush=True)
    collect()  # 지난번에 보내 두고 못 받은 작업부터
    for rnd in range(8):  # 한도로 못 보낸 것, 받아쓰기가 안 맞은 것(두 번까지)을 이어 보낸다
        busy = {(k, i) for items in pending.values() for k, i in items}
        jobs = [(k, i) for i in ids for k in keys
                if (k, i) not in busy and needs_synth(store.man(k)["verses"].get(str(i)), best)]
        if not jobs:
            break
        print(f"{rnd + 1}회차: {len(jobs)}개 보냄", flush=True)
        submit(jobs)
        collect()
    # 3.8로 만들었지만 받아쓰기로 아직 못 맞춘 것
    for k in keys:
        for i in ids:
            e = store.man(k)["verses"].get(str(i))
            if e and e.get("model") == best and e.get("align") != "text":
                e2 = resplit(by_id[i], k, store.base / k, fixes, e, True, only_aligned=True)
                if e2 is not None:
                    store.put(k, i, e2)
                    print(line(k, i, e2, time.time()) + "  (다시 맞춤)", flush=True)
    if a.publish:
        publish(store, all_ids)
    print(f"\n만든 것 {counts['made']}(확인 필요 {counts['check']}), 실패 {counts['fail']}", flush=True)
    status(store, all_ids)


KST = ZoneInfo("Asia/Seoul")


def git(*args) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True)


AUDIO_SUBJECT = "들어 보기 음원 더하기"


def publish(store: Store, ids: list) -> None:
    """새로 만든 음원(web/audio)만 커밋하고 push한다. 다른 파일은 건드리지 않는다.
    GitHub Pages가 main을 그대로 올리므로 push하면 운영에 반영된다.
    main이 아닌 가지에 있거나, 아직 안 올린 다른 커밋이 있으면 손대지 않는다."""
    branch = git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if branch != "main":
        print(f"지금 가지가 {branch}라 운영 반영을 건너뜁니다(main에서만 합니다).", flush=True)
        return
    git("fetch", "-q", "origin", "main")
    if git("status", "--porcelain", "--", "web/audio").stdout.strip():
        counts = ", ".join(f"{VOICES[k]['name']} {sum(1 for i in ids if str(i) in store.man(k)['verses'])}" for k in VOICES)
        msg = (f"{AUDIO_SUBJECT} ({time.strftime('%Y-%m-%d')})\n\n지금까지 만든 구절: {counts}\n\n"
               "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>")
        git("add", "--", "web/audio")
        c = git("commit", "-q", "-m", msg, "--", "web/audio")
        if c.returncode != 0:
            print("커밋 실패: " + (c.stderr or c.stdout).strip()[-300:], flush=True)
            return
    ahead = [x for x in git("log", "origin/main..HEAD", "--format=%s").stdout.splitlines() if x]
    if not ahead:
        print("운영에 반영할 새 음원이 없어요.", flush=True)
        return
    if any(not x.startswith(AUDIO_SUBJECT) for x in ahead):
        print("아직 올리지 않은 다른 커밋이 있어 push를 건너뜁니다(음원 커밋은 남겨 둡니다).", flush=True)
        return
    p = None
    for attempt in range(2):
        p = git("push", "-q", "origin", "main")
        if p.returncode == 0:
            print("운영에 반영했어요: " + git("log", "--oneline", "-1").stdout.strip(), flush=True)
            return
        # 다른 곳에서 먼저 push했으면 받아서 위에 올린 뒤 다시 보낸다.
        git("pull", "-q", "--rebase", "--autostash", "origin", "main")
    print("push 실패(다음 번에 다시 해 봅니다): " + p.stderr.strip()[-300:], flush=True)


def next_reset() -> datetime:
    """무료 한도가 다시 생기는 때: 미국 태평양 시간 자정 + 5분(서머타임 자동 반영)."""
    la = ZoneInfo("America/Los_Angeles")
    now = datetime.now(la)
    nxt = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
    if now < now.replace(hour=0, minute=5, second=0, microsecond=0):
        nxt = now.replace(hour=0, minute=5, second=0, microsecond=0)
    return nxt.astimezone(KST)


if __name__ == "__main__":
    main()
