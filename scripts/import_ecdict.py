#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""
ECDICT 高频子集导入脚本。

下载 ECDICT 数据 → 解压 → 过滤高频子集 → 批量写入 Supabase 的
dict_entries 与 dict_lemma 两张表。

用法：
    uv run scripts/import_ecdict.py            # 完整流程
    uv run scripts/import_ecdict.py --limit 50000   # 只处理前 N 行，用于试跑
    uv run scripts/import_ecdict.py --skip-download # 复用已下载的数据
    uv run scripts/import_ecdict.py --dry-run       # 只统计不写库

⚠️ 过滤规则与词形展开逻辑必须与 TypeScript 版保持一致：
    src/lib/dict/filter.ts   → should_import()
    src/lib/dict/exchange.ts → parse_exchange()
那两个模块有单元测试覆盖；本文件是它们的 Python 镜像。
改动其中任何一侧，都必须同步另一侧，并跑 --self-test 验证。
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import time
from pathlib import Path
from typing import Iterator

import httpx

# 数据源踩坑记录（2026-08-07 实测）：
#   1. 计划原文的 ecdict-csv-28.zip           → 404，该资产不存在
#   2. release 里的 ecdict-stardict-28.zip    → 是 StarDict 二进制格式
#                                               (.dict/.idx/.ifo)，不是 CSV
#   3. 仓库根目录的 ecdict.csv                → ✅ 就是要的 CSV，66MB，无需解压
# 列结构已实测：word,phonetic,definition,translation,pos,collins,oxford,
#              tag,bnc,frq,exchange,detail,audio
ECDICT_URL = (
    "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data"
CSV_PATH = DATA_DIR / "ecdict.csv"

BATCH = 1000
# dict_entries 的列，顺序与建表一致（word_key 是生成列，不写入）
ENTRY_COLUMNS = (
    "word", "phonetic", "translation", "definition", "pos",
    "collins", "oxford", "tag", "bnc", "frq", "exchange",
)

# exchange 字段中，值是 word 变形形式的键
FORM_KEYS = frozenset({"p", "d", "i", "3", "s", "r", "t"})


# ---------------------------------------------------------------- 纯逻辑


def to_int(v: str) -> int:
    """非数字一律按 0 处理。镜像 filter.ts 的 toInt。"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def to_int_or_none(v: str) -> int | None:
    """镜像导入脚本的 toIntOrNull：非数字写 NULL。"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def should_import(row: dict[str, str]) -> bool:
    """
    判断一条 ECDICT 记录是否进入高频子集。
    保留满足任一条件者：进入词频榜、柯林斯星级词、牛津核心词、带考试标签。

    镜像 src/lib/dict/filter.ts 的 shouldImport。
    """
    word = row.get("word") or ""
    if not word.strip():
        return False
    return (
        to_int(row.get("frq") or "") > 0
        or to_int(row.get("bnc") or "") > 0
        or to_int(row.get("collins") or "") > 0
        or to_int(row.get("oxford") or "") > 0
        or (row.get("tag") or "").strip() != ""
    )


def parse_exchange(word: str, exchange: str) -> list[tuple[str, str]]:
    """
    把 exchange 字段展开为 (词形, 原型) 映射对。
    键 `0` 方向相反：此时 word 自身是变形，值才是原型。键 `1` 是说明，忽略。

    镜像 src/lib/dict/exchange.ts 的 parseExchange。
    """
    if not exchange:
        return []
    base = (word or "").strip().lower()
    if not base:
        return []

    out: dict[str, tuple[str, str]] = {}
    for part in exchange.split("/"):
        idx = part.find(":")
        if idx < 0:
            continue
        key = part[:idx].strip()
        val = part[idx + 1:].strip().lower()
        if not val:
            continue

        if key in FORM_KEYS:
            if val != base:
                out[f"{val}|{base}"] = (val, base)
        elif key == "0":
            if val != base:
                out[f"{base}|{val}"] = (base, val)
    return list(out.values())


# ------------------------------------------------------- 与 TS 版一致性自检


SELF_TEST_FILTER = [
    ({"word": "sample", "frq": "1200"}, True, "frq 有排名则导入"),
    ({"word": "sample", "bnc": "800"}, True, "bnc 有排名则导入"),
    ({"word": "sample", "collins": "3"}, True, "柯林斯星级非零则导入"),
    ({"word": "sample", "oxford": "1"}, True, "牛津核心词则导入"),
    ({"word": "sample", "tag": "cet4 ky"}, True, "带考试标签则导入"),
    ({"word": "sample"}, False, "所有指标为空则跳过"),
    ({"word": "sample", "frq": "0", "bnc": "0", "collins": "0", "oxford": "0"},
     False, "所有指标为零则跳过"),
    ({"word": "", "frq": "1200"}, False, "空 word 一律跳过"),
    ({"word": "   ", "frq": "1200"}, False, "纯空白 word 一律跳过"),
    ({"word": "sample", "frq": "NULL", "bnc": "abc"}, False, "非数字字段按 0 处理"),
]

SELF_TEST_EXCHANGE = [
    ("say", "p:said/d:said", [("said", "say")], "去重重复的变形"),
    ("said", "0:say/1:p", [("said", "say")], "键 0 方向相反"),
    ("good", "r:better/t:best",
     [("better", "good"), ("best", "good")], "比较级与最高级"),
    ("Say", "p:Said", [("said", "say")], "统一小写"),
    ("cut", "p:cut/d:cut", [], "跳过与原词相同的映射"),
    ("word", "", [], "空 exchange"),
    ("say", "garbage/p:said", [("said", "say")], "忽略没有冒号的片段"),
    ("say", "p:/d:said", [("said", "say")], "忽略值为空的片段"),
    ("say", "z:whatever", [], "忽略未知的键"),
]


def run_self_test() -> bool:
    """验证 Python 实现与 TypeScript 版单元测试的用例一致。"""
    failures = []

    for row, expected, name in SELF_TEST_FILTER:
        full = {k: "" for k in
                ("word", "phonetic", "definition", "translation", "pos",
                 "collins", "oxford", "tag", "bnc", "frq", "exchange")}
        full.update(row)
        got = should_import(full)
        if got != expected:
            failures.append(f"  should_import / {name}: 期望 {expected}，实得 {got}")

    for word, exch, expected, name in SELF_TEST_EXCHANGE:
        got = sorted(parse_exchange(word, exch))
        if got != sorted(expected):
            failures.append(f"  parse_exchange / {name}: 期望 {expected}，实得 {got}")

    if failures:
        print("❌ 自检失败，Python 实现与 TS 版行为不一致：", file=sys.stderr)
        print("\n".join(failures), file=sys.stderr)
        return False

    print(f"✅ 自检通过（{len(SELF_TEST_FILTER)} 条过滤用例 + "
          f"{len(SELF_TEST_EXCHANGE)} 条词形用例，与 TS 单元测试同源）")
    return True


# ---------------------------------------------------------------- 下载解压


EXPECTED_HEADER = (
    "word,phonetic,definition,translation,pos,collins,oxford,"
    "tag,bnc,frq,exchange,detail,audio"
)


def is_valid_csv(path: Path) -> bool:
    """
    校验是不是完整的 ECDICT CSV。
    只看文件大小会把中断的半截下载当成有效缓存 —— 实际踩过这个坑，
    所以同时校验表头与结尾是否是完整的一行。
    """
    if not path.exists() or path.stat().st_size < 10_000_000:
        return False
    with open(path, "rb") as f:
        if not f.readline().decode("utf-8", "replace").strip().startswith("word,phonetic"):
            return False
        f.seek(max(0, path.stat().st_size - 2))
        return f.read().endswith(b"\n")


def download() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if is_valid_csv(CSV_PATH):
        print(f"已存在完整的 {CSV_PATH.name}"
              f"（{CSV_PATH.stat().st_size / 1e6:.1f} MB），跳过下载")
        return
    if CSV_PATH.exists():
        print(f"⚠️ {CSV_PATH.name} 不完整（可能是中断的下载），删除重下")
        CSV_PATH.unlink()

    print(f"下载 {ECDICT_URL}")
    tmp = CSV_PATH.with_suffix(".csv.part")
    with httpx.stream("GET", ECDICT_URL, follow_redirects=True, timeout=120) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        done = 0
        last = 0.0
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 16):
                f.write(chunk)
                done += len(chunk)
                now = time.time()
                if now - last > 2:
                    pct = f"{done / total * 100:5.1f}%" if total else "  ?  "
                    print(f"\r  {pct}  {done / 1e6:7.1f} MB", end="", flush=True)
                    last = now
    # 下载完整才改名，避免半截文件被下次运行当成有效缓存
    tmp.rename(CSV_PATH)
    print(f"\r  100.0%  {done / 1e6:7.1f} MB  下载完成")


def verify_header() -> None:
    with open(CSV_PATH, "r", encoding="utf-8") as f:
        header = f.readline().strip()
    if header != EXPECTED_HEADER:
        print(f"⚠️ 表头与预期不符\n  预期: {EXPECTED_HEADER}\n  实得: {header}")
        missing = {"word", "translation", "exchange", "frq", "bnc",
                   "collins", "oxford", "tag"} - set(header.split(","))
        if missing:
            raise SystemExit(f"❌ 缺少必需列: {sorted(missing)}")
        print("  必需列齐全，继续。")
    else:
        print(f"✅ 表头符合预期（{CSV_PATH.stat().st_size / 1e6:.1f} MB）")


# ---------------------------------------------------------------- 写库


class Supabase:
    def __init__(self) -> None:
        env = self._load_env()
        self.url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1"
        key = env["SUPABASE_SERVICE_ROLE_KEY"]
        self.client = httpx.Client(
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            timeout=120,
        )

    @staticmethod
    def _load_env() -> dict[str, str]:
        path = REPO_ROOT / ".env.local"
        if not path.exists():
            raise SystemExit("❌ 找不到 .env.local")
        env: dict[str, str] = {}
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
        for required in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"):
            if not env.get(required):
                raise SystemExit(f"❌ .env.local 缺少 {required}")
        return env

    def _post(self, table: str, rows: list[dict], *, on_conflict: str | None = None) -> None:
        params = {}
        headers = {}
        if on_conflict:
            params["on_conflict"] = on_conflict
            headers["Prefer"] = "return=minimal,resolution=merge-duplicates"
        for attempt in range(5):
            try:
                r = self.client.post(
                    f"{self.url}/{table}", json=rows, params=params, headers=headers
                )
                if r.status_code < 300:
                    return
                # 5xx / 429 重试，4xx 直接失败
                if r.status_code < 500 and r.status_code != 429:
                    raise SystemExit(
                        f"❌ 写入 {table} 失败 HTTP {r.status_code}: {r.text[:500]}"
                    )
                print(f"\n  ⚠️ {table} HTTP {r.status_code}，{2 ** attempt}s 后重试")
            except httpx.RequestError as e:
                print(f"\n  ⚠️ {table} 网络错误 {e!r}，{2 ** attempt}s 后重试")
            time.sleep(2 ** attempt)
        raise SystemExit(f"❌ 写入 {table} 连续 5 次失败，中止")

    def insert_entries(self, rows: list[dict]) -> None:
        self._post("dict_entries", rows)

    def upsert_lemmas(self, rows: list[dict]) -> None:
        self._post("dict_lemma", rows, on_conflict="form,lemma")

    def count(self, table: str) -> int:
        r = self.client.get(
            f"{self.url}/{table}",
            params={"select": "*", "limit": 1},
            headers={"Prefer": "count=exact", "Range": "0-0"},
        )
        rng = r.headers.get("content-range", "")
        return int(rng.split("/")[-1]) if "/" in rng else -1


# ---------------------------------------------------------------- 主流程


def iter_rows(limit: int | None) -> Iterator[dict[str, str]]:
    csv.field_size_limit(1 << 24)
    with open(CSV_PATH, "r", encoding="utf-8", newline="") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if limit is not None and i >= limit:
                return
            yield row


def main() -> None:
    ap = argparse.ArgumentParser(description="导入 ECDICT 高频子集到 Supabase")
    ap.add_argument("--limit", type=int, help="只处理前 N 行，用于试跑")
    ap.add_argument("--skip-download", action="store_true", help="复用已下载数据")
    ap.add_argument("--dry-run", action="store_true", help="只统计，不写库")
    ap.add_argument("--self-test", action="store_true", help="只跑逻辑一致性自检")
    args = ap.parse_args()

    if not run_self_test():
        sys.exit(1)
    if args.self_test:
        return

    if not args.skip_download:
        download()
    verify_header()

    db = None if args.dry_run else Supabase()
    if db:
        before_e, before_l = db.count("dict_entries"), db.count("dict_lemma")
        print(f"导入前：dict_entries={before_e}  dict_lemma={before_l}")
        if before_e > 0:
            print("⚠️ dict_entries 非空。重复导入会产生重复词条。")
            print("   如需重来，先在 SQL Editor 执行： truncate dict_entries, dict_lemma;")
            sys.exit(1)

    total = kept = 0
    entry_batch: list[dict] = []
    lemma_batch: dict[str, dict] = {}
    t0 = time.time()

    def flush_entries() -> None:
        nonlocal entry_batch
        if entry_batch and db:
            db.insert_entries(entry_batch)
        entry_batch = []

    def flush_lemmas() -> None:
        nonlocal lemma_batch
        if lemma_batch and db:
            db.upsert_lemmas(list(lemma_batch.values()))
        lemma_batch = {}

    for row in iter_rows(args.limit):
        total += 1
        if not should_import(row):
            continue
        kept += 1

        entry_batch.append({
            "word": (row.get("word") or "").strip(),
            "phonetic": row.get("phonetic") or None,
            "translation": row.get("translation") or None,
            "definition": row.get("definition") or None,
            "pos": row.get("pos") or None,
            "collins": to_int_or_none(row.get("collins") or ""),
            "oxford": to_int_or_none(row.get("oxford") or ""),
            "tag": row.get("tag") or None,
            "bnc": to_int_or_none(row.get("bnc") or ""),
            "frq": to_int_or_none(row.get("frq") or ""),
            "exchange": row.get("exchange") or None,
        })

        for form, lemma in parse_exchange(
            row.get("word") or "", row.get("exchange") or ""
        ):
            lemma_batch[f"{form}|{lemma}"] = {"form": form, "lemma": lemma}

        if len(entry_batch) >= BATCH:
            flush_entries()
        if len(lemma_batch) >= BATCH:
            flush_lemmas()

        if kept % 5000 == 0:
            el = time.time() - t0
            print(f"\r  扫描 {total:>7}  导入 {kept:>6}  "
                  f"{kept / el:5.0f} 条/秒  {el:5.0f}s", end="", flush=True)

    flush_entries()
    flush_lemmas()

    el = time.time() - t0
    print(f"\r{' ' * 70}\r", end="")
    print("─" * 46)
    print(f"扫描总行数: {total}")
    print(f"导入条数:   {kept}")
    if total:
        print(f"过滤比例:   {(1 - kept / total) * 100:.1f}%")
    print(f"耗时:       {el:.0f}s")

    if db:
        print("─" * 46)
        print(f"导入后：dict_entries={db.count('dict_entries')}  "
              f"dict_lemma={db.count('dict_lemma')}")
    elif args.dry_run:
        print("（dry-run，未写库）")


if __name__ == "__main__":
    main()
