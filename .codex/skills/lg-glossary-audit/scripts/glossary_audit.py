#!/usr/bin/env python3
from __future__ import annotations

import argparse
import bisect
import copy
import hashlib
import json
import sqlite3
import sys
import tempfile
import uuid
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any


INSPECTION_FORMAT = "linguagacha-storage-inspection/v1"
REPORT_FORMAT = "linguagacha-glossary-audit-report/v2"
PLAN_FORMAT = "linguagacha-glossary-audit-plan/v2"
REFERENCE_SCHEMA_VERSION = 2
RULE_TYPE = "glossary"
REVISION_KEYS = (
    "quality_rule_revision.glossary",
    "quality_rule_revision.text_preserve",
    "quality_rule_revision.pre_replacement",
    "quality_rule_revision.post_replacement",
)
ALLOWED_INFOS = {
    "男性角色",
    "女性角色",
    "未知性别角色",
    "地名",
    "家族",
    "组织",
    "特殊物品",
    "特殊技能",
    "特殊生物",
    "其他",
}
REFERENCE_COLUMNS = {
    "items": {"id", "data"},
    "rules": {"id", "type", "data"},
    "meta": {"key", "value"},
}
SNAPSHOT_KEYS = (
    "schema_version",
    "storage_schema_sha256",
    "glossary_revision",
    "quality_revisions_sha256",
    "glossary_sha256",
    "item_corpus_sha256",
    "other_rules_sha256",
    "item_count",
    "glossary_count",
)
ENTRY_FIELDS = {"src", "dst", "info", "regex", "case_sensitive", "entry_id"}
UPDATE_FIELDS = {"src", "dst", "info", "case_sensitive"}


class AuditError(RuntimeError):
    pass


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def value_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def parse_json(value: Any, label: str) -> Any:
    try:
        return json.loads(str(value))
    except (TypeError, ValueError) as error:
        raise AuditError(f"{label} 不是合法 JSON：{error}") from error


def load_json_file(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise AuditError(f"无法读取 {path}：{error}") from error
    except ValueError as error:
        raise AuditError(f"{path} 不是合法 JSON：{error}") from error


def write_json_file(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def print_json(value: Any, *, file: Any = sys.stdout) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2), file=file)


def connect_readonly(project_path: Path) -> sqlite3.Connection:
    if not project_path.is_file():
        raise AuditError(f"项目文件不存在：{project_path}")
    connection = sqlite3.connect(
        f"{project_path.resolve().as_uri()}?mode=ro",
        uri=True,
        timeout=5,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA busy_timeout=5000")
    return connection


def connect_writable(project_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(project_path), timeout=5, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=5000")
    return connection


def read_meta_json(
    connection: sqlite3.Connection,
    key: str,
    default: Any = None,
) -> Any:
    row = connection.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return default if row is None else parse_json(row["value"], f"meta.{key}")


def read_non_negative_int(value: Any, label: str) -> int:
    if isinstance(value, bool):
        raise AuditError(f"{label} 不是非负整数")
    try:
        number = int(value)
    except (TypeError, ValueError) as error:
        raise AuditError(f"{label} 不是非负整数") from error
    if number < 0:
        raise AuditError(f"{label} 不是非负整数")
    return number


def quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def read_table_details(
    connection: sqlite3.Connection,
    table: str,
) -> list[dict[str, Any]]:
    return [
        {
            "name": str(row["name"]),
            "type": str(row["type"] or ""),
            "not_null": bool(row["notnull"]),
            "default": row["dflt_value"],
            "primary_key": int(row["pk"]),
        }
        for row in connection.execute(
            f"PRAGMA table_info({quote_identifier(table)})"
        ).fetchall()
    ]


def inspect_storage(connection: sqlite3.Connection) -> dict[str, Any]:
    table_names = [
        str(row["name"])
        for row in connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            ORDER BY name
            """
        ).fetchall()
    ]
    actual_by_lower = {name.lower(): name for name in table_names}
    details_by_table = {
        name: read_table_details(connection, name) for name in table_names
    }
    columns_by_table = {
        name: [str(column["name"]) for column in details]
        for name, details in details_by_table.items()
    }
    differences: list[str] = []

    def has_fields(table: str) -> bool:
        actual = actual_by_lower.get(table)
        if actual is None:
            differences.append(f"缺少参考表 {table}")
            return False
        actual_columns = {
            str(column["name"]).lower() for column in details_by_table[actual]
        }
        missing = sorted(REFERENCE_COLUMNS[table] - actual_columns)
        if missing:
            differences.append(f"{actual} 缺少参考字段：{', '.join(missing)}")
            return False
        return True

    items_fields = has_fields("items")
    rules_fields = has_fields("rules")
    meta_fields = has_fields("meta")

    sampled_item_rows = 0
    read_items = items_fields
    if items_fields:
        actual = actual_by_lower["items"]
        rows = connection.execute(
            f"SELECT id, data FROM {quote_identifier(actual)} ORDER BY id LIMIT 3"
        ).fetchall()
        sampled_item_rows = len(rows)
        sampled_ids: set[int] = set()
        for row in rows:
            try:
                item_id = read_non_negative_int(row["id"], f"{actual}.id")
                if item_id == 0 or item_id in sampled_ids:
                    raise AuditError(f"{actual}.id 样本不是唯一正整数")
                sampled_ids.add(item_id)
                payload = parse_json(row["data"], f"{actual}[{row['id']}].data")
            except AuditError as error:
                differences.append(str(error))
                read_items = False
                break
            if not isinstance(payload, dict) or not isinstance(payload.get("src"), str):
                differences.append(
                    f"{actual}[{row['id']}].data 不符合含字符串 src 的 JSON 对象形状"
                )
                read_items = False
                break

    glossary_rows: int | str = 0
    read_glossary = rules_fields
    if rules_fields:
        actual = actual_by_lower["rules"]
        rows = connection.execute(
            f"""
            SELECT id, data
            FROM {quote_identifier(actual)}
            WHERE type = ?
            ORDER BY id
            LIMIT 2
            """,
            (RULE_TYPE,),
        ).fetchall()
        glossary_rows = "至少 2" if len(rows) == 2 else len(rows)
        if len(rows) != 1:
            differences.append(
                f"{actual} 中 glossary 规则必须恰好一条，浅探发现 {glossary_rows} 条"
            )
            read_glossary = False
        else:
            try:
                rule_id = read_non_negative_int(
                    rows[0]["id"],
                    f"{actual}.glossary.id",
                )
                if rule_id == 0:
                    raise AuditError(f"{actual}.glossary.id 必须为正整数")
                glossary = parse_json(rows[0]["data"], f"{actual}.glossary.data")
            except AuditError as error:
                differences.append(str(error))
                read_glossary = False
            else:
                if not isinstance(glossary, list):
                    differences.append(f"{actual}.glossary.data 不是 JSON 数组")
                    read_glossary = False

    schema_version: Any = None
    revisions: dict[str, int] = {}
    write_revision = meta_fields
    if meta_fields:
        actual = actual_by_lower["meta"]

        def read_unique_meta(key: str) -> tuple[bool, Any]:
            rows = connection.execute(
                f"SELECT value FROM {quote_identifier(actual)} WHERE key = ? LIMIT 2",
                (key,),
            ).fetchall()
            if len(rows) > 1:
                differences.append(f"{actual}.{key} 存在重复行")
                return False, None
            if not rows:
                return False, None
            try:
                return True, parse_json(rows[0]["value"], f"{actual}.{key}")
            except AuditError as error:
                differences.append(str(error))
                return False, None

        schema_exists, schema_version = read_unique_meta("schema_version")
        if not schema_exists:
            differences.append("schema_version 缺失或无法解析；仅作为参考，不阻断字段兼容")
        elif schema_version != REFERENCE_SCHEMA_VERSION:
            differences.append(
                f"schema_version={schema_version!r}，参考值为 {REFERENCE_SCHEMA_VERSION}"
            )

        for key in REVISION_KEYS:
            exists, value = read_unique_meta(key)
            if not exists:
                if key == "quality_rule_revision.glossary":
                    differences.append(f"缺少写入所需修订键 {key}")
                    write_revision = False
                else:
                    revisions[key] = 0
                continue
            try:
                revisions[key] = read_non_negative_int(value, key)
            except AuditError as error:
                differences.append(str(error))
                write_revision = False
    else:
        write_revision = False

    read_capable = read_items and read_glossary
    apply_capable = read_capable and write_revision
    if not read_capable:
        status = "ambiguous"
        next_action = "ask_before_deep_readonly_exploration"
    elif not apply_capable:
        status = "read_only"
        next_action = "continue_audit_but_block_apply"
    elif schema_version == REFERENCE_SCHEMA_VERSION:
        status = "exact"
        next_action = "continue"
    else:
        status = "compatible"
        next_action = "continue"

    schema_signature = {
        table: details_by_table[actual_by_lower[table]]
        for table in REFERENCE_COLUMNS
        if table in actual_by_lower
    }
    return {
        "format": INSPECTION_FORMAT,
        "status": status,
        "schema_version": schema_version,
        "reference_schema_version": REFERENCE_SCHEMA_VERSION,
        "storage_schema_sha256": value_sha256(schema_signature),
        "capabilities": {
            "read_items": read_items,
            "read_glossary": read_glossary,
            "write_glossary": read_glossary,
            "write_revision": write_revision,
            "apply": apply_capable,
        },
        "evidence": {
            "sampled_item_rows": sampled_item_rows,
            "glossary_rows": glossary_rows,
            "resolved_revision_keys": sorted(revisions),
        },
        "tables": columns_by_table,
        "differences": differences,
        "next_action": next_action,
    }


def require_read_capability(inspection: dict[str, Any]) -> None:
    if inspection["status"] == "ambiguous":
        raise AuditError(
            "浅度探测无法唯一确认术语与原文结构；请先向用户展示 inspect 差异，"
            "取得同意后再做深度只读探索。"
            f"差异={canonical_json(inspection['differences'])}"
        )


def require_write_capability(inspection: dict[str, Any]) -> None:
    if not inspection["capabilities"]["apply"]:
        raise AuditError(
            "当前字段能力仅支持只读审校，不能自动写入。"
            f"差异={canonical_json(inspection['differences'])}"
        )


def assert_integrity(connection: sqlite3.Connection, label: str) -> None:
    rows = connection.execute("PRAGMA integrity_check").fetchall()
    results = [str(row[0]) for row in rows]
    if results != ["ok"]:
        raise AuditError(f"{label}完整性检查失败：{'；'.join(results)}")


def assert_quick_integrity(connection: sqlite3.Connection, label: str) -> None:
    rows = connection.execute("PRAGMA quick_check").fetchall()
    results = [str(row[0]) for row in rows]
    if results != ["ok"]:
        raise AuditError(f"{label}快速完整性检查失败：{'；'.join(results)}")


def read_items(connection: sqlite3.Connection) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen_ids: set[int] = set()
    for row in connection.execute("SELECT id, data FROM items ORDER BY id").fetchall():
        item_id = read_non_negative_int(row["id"], "items.id")
        if item_id == 0 or item_id in seen_ids:
            raise AuditError(f"items.id 必须为唯一正整数，发现 {item_id}")
        seen_ids.add(item_id)
        payload = parse_json(row["data"], f"items[{item_id}].data")
        if not isinstance(payload, dict):
            raise AuditError(f"items[{item_id}].data 不是 JSON 对象")
        src = payload.get("src")
        if not isinstance(src, str):
            raise AuditError(f"items[{item_id}].src 不是字符串")
        items.append(
            {
                "item_id": item_id,
                "src": src,
                "file_path": str(payload.get("file_path") or ""),
                "row": payload.get("row_number", payload.get("row")),
            }
        )
    return items


def read_glossary_record(connection: sqlite3.Connection) -> dict[str, Any]:
    rows = connection.execute(
        "SELECT id, data FROM rules WHERE type = ? ORDER BY id",
        (RULE_TYPE,),
    ).fetchall()
    if len(rows) != 1:
        raise AuditError(f"glossary 规则行必须恰好一条，当前为 {len(rows)} 条")
    glossary = parse_json(rows[0]["data"], "rules.glossary.data")
    if not isinstance(glossary, list):
        raise AuditError("rules.glossary.data 不是 JSON 数组")
    rule_id = read_non_negative_int(rows[0]["id"], "rules.glossary.id")
    if rule_id == 0:
        raise AuditError("rules.glossary.id 必须为正整数")
    return {"rule_id": rule_id, "glossary": glossary}


def read_glossary(connection: sqlite3.Connection) -> list[Any]:
    return read_glossary_record(connection)["glossary"]


def build_item_corpus_sha256(items: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for item in items:
        digest.update(
            canonical_json([item["item_id"], item["src"]]).encode("utf-8")
        )
        digest.update(b"\n")
    return digest.hexdigest()


def build_other_rules_sha256(connection: sqlite3.Connection) -> str:
    rows = [
        [str(row["type"]), str(row["data"])]
        for row in connection.execute(
            "SELECT type, data FROM rules WHERE type <> ? ORDER BY id",
            (RULE_TYPE,),
        ).fetchall()
    ]
    return value_sha256(rows)


def read_quality_revisions(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        key: read_non_negative_int(read_meta_json(connection, key, 0), key)
        for key in REVISION_KEYS
    }


def read_state(connection: sqlite3.Connection) -> dict[str, Any]:
    inspection = inspect_storage(connection)
    require_read_capability(inspection)
    glossary_record = read_glossary_record(connection)
    glossary = glossary_record["glossary"]
    items = read_items(connection)
    revisions = (
        read_quality_revisions(connection)
        if inspection["capabilities"]["write_revision"]
        else {}
    )
    snapshot = {
        "schema_version": inspection["schema_version"],
        "storage_schema_sha256": inspection["storage_schema_sha256"],
        "glossary_revision": revisions.get("quality_rule_revision.glossary"),
        "quality_revisions_sha256": value_sha256(revisions) if revisions else None,
        "glossary_sha256": value_sha256(glossary),
        "item_corpus_sha256": build_item_corpus_sha256(items),
        "other_rules_sha256": build_other_rules_sha256(connection),
        "item_count": len(items),
        "glossary_count": len(glossary),
    }
    return {
        "snapshot": snapshot,
        "glossary": glossary,
        "glossary_rule_id": glossary_record["rule_id"],
        "items": items,
        "revisions": revisions,
        "storage": inspection,
    }


class CorpusIndex:
    def __init__(self, items: list[dict[str, Any]]) -> None:
        self.items = items
        self.starts: list[int] = []
        parts: list[str] = []
        offset = 0
        for item in items:
            src = str(item["src"])
            if "\0" in src:
                raise AuditError(f"items[{item['item_id']}].src 含 NUL，无法建立语料索引")
            self.starts.append(offset)
            parts.append(src)
            offset += len(src) + 1
        self.text = "\0".join(parts)

    def locate(self, term: str, limit: int) -> dict[str, Any]:
        if term == "":
            return {"occurrence_count": 0, "distinct_source_count": 0, "sources": []}
        if "\0" in term:
            raise AuditError("术语含 NUL，无法检索")

        groups: dict[str, dict[str, Any]] = {}
        distinct_sources: set[str] = set()
        occurrence_count = 0
        search_from = 0
        while True:
            found = self.text.find(term, search_from)
            if found < 0:
                break
            occurrence_count += 1
            item_index = bisect.bisect_right(self.starts, found) - 1
            if item_index >= 0:
                item = self.items[item_index]
                local_start = found - self.starts[item_index]
                item_text = str(item["src"])
                if local_start + len(term) <= len(item_text):
                    distinct_sources.add(item_text)
                    group = groups.get(item_text)
                    if group is not None or limit == 0 or len(groups) < limit:
                        if group is None:
                            group = {
                                "text": item_text,
                                "item_ids": [],
                                "locations": [],
                                "positions": [],
                                "occurrence_count": 0,
                            }
                            groups[item_text] = group
                        group["occurrence_count"] += 1
                        if item["item_id"] not in group["item_ids"]:
                            group["item_ids"].append(item["item_id"])
                            group["locations"].append(
                                {
                                    "item_id": item["item_id"],
                                    "file_path": item["file_path"],
                                    "row": item["row"],
                                }
                            )
                        if local_start not in group["positions"]:
                            group["positions"].append(local_start)
            search_from = found + 1

        return {
            "occurrence_count": occurrence_count,
            "distinct_source_count": len(distinct_sources),
            "sources": list(groups.values()),
        }


def collect_entry_issues(
    glossary: list[Any],
    corpus: CorpusIndex,
    sample_limit: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    issues: list[dict[str, Any]] = []
    entries: list[dict[str, Any]] = []
    seen_srcs: dict[str, int] = {}
    seen_ids: dict[str, int] = {}

    for index, raw_entry in enumerate(glossary):
        if not isinstance(raw_entry, dict):
            issues.append({"kind": "malformed_entry", "index": index})
            entries.append({"index": index, "entry": raw_entry})
            continue

        entry = copy.deepcopy(raw_entry)
        src = entry.get("src")
        dst = entry.get("dst")
        info = entry.get("info")
        entry_id = entry.get("entry_id")
        entry_issues: list[str] = []

        if not isinstance(src, str) or src == "":
            entry_issues.append("empty_or_invalid_src")
            src_text = ""
        else:
            src_text = src
            if src.strip() != src:
                entry_issues.append("src_has_outer_whitespace")
            if src in seen_srcs:
                entry_issues.append("duplicate_src")
            else:
                seen_srcs[src] = index

        if not isinstance(dst, str) or dst.strip() == "":
            entry_issues.append("empty_or_invalid_dst")
        if info not in ALLOWED_INFOS:
            entry_issues.append("invalid_info")
        if entry.get("regex") is not False:
            entry_issues.append("regex_not_false")
        if not isinstance(entry.get("case_sensitive"), bool):
            entry_issues.append("invalid_case_sensitive")
        if entry_id is None or str(entry_id).strip() == "":
            entry_issues.append("missing_entry_id")
        elif not isinstance(entry_id, str):
            entry_issues.append("invalid_entry_id")
        elif entry_id in seen_ids:
            entry_issues.append("duplicate_entry_id")
        else:
            seen_ids[entry_id] = index

        locations = corpus.locate(src_text, sample_limit)
        if src_text != "" and locations["occurrence_count"] == 0:
            entry_issues.append("zero_occurrence")

        for kind in entry_issues:
            issues.append({"kind": kind, "index": index, "src": src_text})
        entries.append(
            {
                "index": index,
                "entry": entry,
                "occurrence_count": locations["occurrence_count"],
                "sample_sources": locations["sources"],
                "issues": entry_issues,
            }
        )

    return entries, issues


def build_containment_groups(srcs: list[str]) -> list[dict[str, Any]]:
    unique_srcs = sorted(set(srcs), key=lambda value: (len(value), value))
    groups: list[dict[str, Any]] = []
    for root in unique_srcs:
        members = [value for value in unique_srcs if value != root and root in value]
        if members:
            groups.append({"root": root, "members": members})
    return groups


def build_shared_prefix_groups(srcs: list[str]) -> list[dict[str, Any]]:
    prefix_members: dict[str, set[str]] = {}
    for src in set(srcs):
        for length in range(2, len(src) + 1):
            prefix_members.setdefault(src[:length], set()).add(src)

    candidates: list[tuple[str, tuple[str, ...]]] = []
    for prefix, members in prefix_members.items():
        if len(members) < 2:
            continue
        next_characters = {
            member[len(prefix) : len(prefix) + 1] for member in members
        }
        if len(next_characters) < 2:
            continue
        candidates.append((prefix, tuple(sorted(members))))

    longest_by_members: dict[tuple[str, ...], str] = {}
    for prefix, members in candidates:
        current = longest_by_members.get(members, "")
        if len(prefix) > len(current):
            longest_by_members[members] = prefix
    return [
        {"root_candidate": prefix, "members": list(members)}
        for members, prefix in sorted(
            longest_by_members.items(),
            key=lambda item: (item[1], item[0]),
        )
    ]


def build_scan_report(project_path: Path, state: dict[str, Any], sample_limit: int) -> dict[str, Any]:
    corpus = CorpusIndex(state["items"])
    entries, issues = collect_entry_issues(
        state["glossary"],
        corpus,
        sample_limit,
    )
    srcs = [
        str(entry["entry"]["src"])
        for entry in entries
        if isinstance(entry.get("entry"), dict)
        and isinstance(entry["entry"].get("src"), str)
        and entry["entry"]["src"] != ""
    ]
    return {
        "format": REPORT_FORMAT,
        "project_path": str(project_path.resolve()),
        "storage": state["storage"],
        "snapshot": state["snapshot"],
        "summary": {
            "entry_count": len(state["glossary"]),
            "issue_count": len(issues),
            "zero_occurrence_count": sum(
                issue["kind"] == "zero_occurrence" for issue in issues
            ),
            "containment_group_count": len(build_containment_groups(srcs)),
            "shared_prefix_group_count": len(build_shared_prefix_groups(srcs)),
        },
        "issues": issues,
        "entries": entries,
        "containment_groups": build_containment_groups(srcs),
        "shared_prefix_groups": build_shared_prefix_groups(srcs),
    }


def normalize_snapshot(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise AuditError("计划 snapshot 不是对象")
    missing = [key for key in SNAPSHOT_KEYS if key not in value]
    extra = sorted(set(value) - set(SNAPSHOT_KEYS))
    if missing or extra:
        raise AuditError(
            f"计划 snapshot 字段不匹配，缺少={missing}，多余={extra}"
        )
    return {key: value[key] for key in SNAPSHOT_KEYS}


def require_plan(plan: Any) -> dict[str, Any]:
    if not isinstance(plan, dict):
        raise AuditError("计划不是 JSON 对象")
    if plan.get("format") != PLAN_FORMAT:
        raise AuditError(f"计划 format 必须为 {PLAN_FORMAT}")
    normalize_snapshot(plan.get("snapshot"))
    if not isinstance(plan.get("operations"), list):
        raise AuditError("计划 operations 不是数组")
    return plan


def assert_snapshot_matches(
    expected: dict[str, Any],
    current: dict[str, Any],
) -> None:
    differences = {
        key: {"expected": expected[key], "current": current[key]}
        for key in SNAPSHOT_KEYS
        if expected[key] != current[key]
    }
    if differences:
        raise AuditError(f"数据库快照已变化：{canonical_json(differences)}")


def normalize_evidence(
    operation: dict[str, Any],
    index: int,
) -> list[int]:
    evidence = operation.get("evidence")
    if not isinstance(evidence, list):
        raise AuditError(f"operations[{index}].evidence 不是数组")
    result: list[int] = []
    for value in evidence:
        if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
            raise AuditError(f"operations[{index}].evidence 含非法 item_id")
        if value not in result:
            result.append(value)
    return result


def validate_final_entries(
    entries: list[Any],
    corpus: CorpusIndex,
) -> None:
    seen_srcs: set[str] = set()
    seen_ids: set[str] = set()
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise AuditError(f"最终术语[{index}] 不是对象")
        unknown_fields = sorted(set(entry) - ENTRY_FIELDS)
        if unknown_fields:
            raise AuditError(
                f"最终术语[{index}] 含未知字段：{', '.join(unknown_fields)}"
            )
        src = entry.get("src")
        dst = entry.get("dst")
        info = entry.get("info")
        if not isinstance(src, str) or src == "" or src.strip() != src:
            raise AuditError(f"最终术语[{index}].src 非法")
        if src in seen_srcs:
            raise AuditError(f"最终术语 src 重复：{src}")
        seen_srcs.add(src)
        if not isinstance(dst, str) or dst == "" or dst.strip() != dst:
            raise AuditError(f"最终术语译文为空或边界异常：{src}")
        if info not in ALLOWED_INFOS:
            raise AuditError(f"最终术语分类非法：{src} -> {info!r}")
        if entry.get("regex") is not False:
            raise AuditError(f"最终术语必须关闭 regex：{src}")
        if not isinstance(entry.get("case_sensitive"), bool):
            raise AuditError(f"最终术语 case_sensitive 不是布尔值：{src}")
        entry_id = entry.get("entry_id")
        if entry_id is not None:
            if not isinstance(entry_id, str) or entry_id.strip() == "":
                raise AuditError(f"最终术语 entry_id 非法：{src}")
            if entry_id in seen_ids:
                raise AuditError(f"最终术语 entry_id 重复：{entry_id}")
            seen_ids.add(entry_id)
        if corpus.text.find(src) < 0:
            raise AuditError(f"最终术语未在原文中实际出现：{src}")


def validate_operation_evidence(
    evidence: list[int],
    relevant_terms: list[str],
    item_by_id: dict[int, dict[str, Any]],
    required: bool,
    label: str,
) -> None:
    if required and not evidence:
        raise AuditError(f"{label} 缺少语境证据")
    for item_id in evidence:
        item = item_by_id.get(item_id)
        if item is None:
            raise AuditError(f"{label} 引用了不存在的 item_id={item_id}")
        if not any(term and term in str(item["src"]) for term in relevant_terms):
            raise AuditError(f"{label} 的 item_id={item_id} 不包含相关源词")


def build_next_glossary(
    state: dict[str, Any],
    plan: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    glossary = state["glossary"]
    if not all(isinstance(entry, dict) for entry in glossary):
        raise AuditError("原术语表含非对象条目，拒绝差量写入")

    current_by_src: dict[str, dict[str, Any]] = {}
    for index, entry in enumerate(glossary):
        src = entry.get("src")
        if not isinstance(src, str) or src == "":
            raise AuditError(f"原术语[{index}].src 非法")
        if src in current_by_src:
            raise AuditError(f"原术语 src 重复，无法精确定位：{src}")
        current_by_src[src] = entry

    corpus = CorpusIndex(state["items"])
    item_by_id = {int(item["item_id"]): item for item in state["items"]}
    deletes: set[str] = set()
    updates: dict[str, dict[str, Any]] = {}
    additions: list[dict[str, Any]] = []
    targeted: set[str] = set()

    for index, raw_operation in enumerate(plan["operations"]):
        if not isinstance(raw_operation, dict):
            raise AuditError(f"operations[{index}] 不是对象")
        operation = raw_operation
        op = operation.get("op")
        reason = operation.get("reason")
        if not isinstance(reason, str) or reason.strip() == "":
            raise AuditError(f"operations[{index}].reason 不能为空")
        evidence = normalize_evidence(operation, index)

        if op == "delete":
            allowed = {"op", "src", "reason", "evidence"}
            extra = sorted(set(operation) - allowed)
            if extra:
                raise AuditError(f"operations[{index}] 含未知字段：{extra}")
            src = operation.get("src")
            if not isinstance(src, str) or src not in current_by_src:
                raise AuditError(f"删除目标不存在：{src!r}")
            if src in targeted:
                raise AuditError(f"术语被重复操作：{src}")
            targeted.add(src)
            deletes.add(src)
            occurrence_count = corpus.locate(src, 1)["occurrence_count"]
            validate_operation_evidence(
                evidence,
                [src],
                item_by_id,
                occurrence_count > 0,
                f"删除 {src}",
            )
            continue

        if op == "update":
            allowed = {"op", "src", "set", "reason", "evidence"}
            extra = sorted(set(operation) - allowed)
            if extra:
                raise AuditError(f"operations[{index}] 含未知字段：{extra}")
            src = operation.get("src")
            patch = operation.get("set")
            if not isinstance(src, str) or src not in current_by_src:
                raise AuditError(f"修改目标不存在：{src!r}")
            if src in targeted:
                raise AuditError(f"术语被重复操作：{src}")
            if not isinstance(patch, dict) or not patch:
                raise AuditError(f"修改 {src} 的 set 为空")
            unknown_patch_fields = sorted(set(patch) - UPDATE_FIELDS)
            if unknown_patch_fields:
                raise AuditError(
                    f"修改 {src} 含不可写字段：{unknown_patch_fields}"
                )
            if all(current_by_src[src].get(key) == value for key, value in patch.items()):
                raise AuditError(f"修改 {src} 没有产生变化")
            relevant_terms = [src]
            next_src = patch.get("src")
            if isinstance(next_src, str):
                relevant_terms.append(next_src)
            validate_operation_evidence(
                evidence,
                relevant_terms,
                item_by_id,
                True,
                f"修改 {src}",
            )
            targeted.add(src)
            updates[src] = copy.deepcopy(patch)
            continue

        if op == "add":
            allowed = {"op", "entry", "reason", "evidence"}
            extra = sorted(set(operation) - allowed)
            if extra:
                raise AuditError(f"operations[{index}] 含未知字段：{extra}")
            entry = operation.get("entry")
            if not isinstance(entry, dict):
                raise AuditError(f"operations[{index}].entry 不是对象")
            unknown_entry_fields = sorted(set(entry) - ENTRY_FIELDS)
            if unknown_entry_fields:
                raise AuditError(
                    f"新增术语含未知字段：{unknown_entry_fields}"
                )
            new_entry = copy.deepcopy(entry)
            src = new_entry.get("src")
            if not isinstance(src, str) or src == "":
                raise AuditError("新增术语 src 非法")
            if src in current_by_src:
                raise AuditError(f"新增术语已存在，应改用 update：{src}")
            if any(item.get("src") == src for item in additions):
                raise AuditError(f"新增术语重复：{src}")
            validate_operation_evidence(
                evidence,
                [src],
                item_by_id,
                True,
                f"新增 {src}",
            )
            if "entry_id" not in new_entry:
                stable_id = uuid.uuid5(
                    uuid.NAMESPACE_URL,
                    f"linguagacha:{state['snapshot']['glossary_sha256']}:{src}",
                )
                new_entry["entry_id"] = f"qr:{stable_id}"
            additions.append(new_entry)
            continue

        raise AuditError(f"operations[{index}].op 非法：{op!r}")

    next_glossary: list[dict[str, Any]] = []
    for entry in glossary:
        src = str(entry["src"])
        if src in deletes:
            continue
        next_entry = copy.deepcopy(entry)
        for key, value in updates.get(src, {}).items():
            next_entry[key] = value
        next_glossary.append(next_entry)
    next_glossary.extend(additions)
    validate_final_entries(next_glossary, corpus)

    return next_glossary, {
        "deleted": len(deletes),
        "updated": len(updates),
        "added": len(additions),
    }


def check_plan(
    project_path: Path,
    plan: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    with closing(connect_readonly(project_path)) as connection:
        assert_integrity(connection, "目标数据库")
        state = read_state(connection)
    assert_snapshot_matches(normalize_snapshot(plan["snapshot"]), state["snapshot"])
    next_glossary, counts = build_next_glossary(state, plan)
    apply_capable = bool(state["storage"]["capabilities"]["apply"])
    next_revision = (
        max(state["revisions"].values(), default=0) + 1 if apply_capable else None
    )
    summary = {
        "valid": True,
        "storage_status": state["storage"]["status"],
        "apply_capable": apply_capable,
        "before_count": len(state["glossary"]),
        "after_count": len(next_glossary),
        "deleted_count": counts["deleted"],
        "updated_count": counts["updated"],
        "added_count": counts["added"],
        "revision_before": state["snapshot"]["glossary_revision"],
        "revision_after": next_revision,
        "expected_glossary_sha256": value_sha256(next_glossary),
    }
    return summary, next_glossary, state


def choose_backup_path(project_path: Path) -> Path:
    timestamp = datetime.now().strftime("%Y%m%dT%H%M%S")
    base = project_path.with_name(
        f"{project_path.stem}.before_glossary_audit_{timestamp}{project_path.suffix}"
    )
    if not base.exists():
        return base
    index = 2
    while True:
        candidate = project_path.with_name(
            f"{project_path.stem}.before_glossary_audit_{timestamp}_{index}{project_path.suffix}"
        )
        if not candidate.exists():
            return candidate
        index += 1


def create_online_backup(project_path: Path, backup_path: Path) -> None:
    if backup_path.exists():
        raise AuditError(f"备份目标已存在，拒绝覆盖：{backup_path}")
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    source = connect_readonly(project_path)
    destination = sqlite3.connect(str(backup_path))
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    with closing(connect_readonly(backup_path)) as connection:
        assert_integrity(connection, "备份数据库")


def execute_apply(
    project_path: Path,
    plan: dict[str, Any],
    backup_path: Path | None = None,
) -> dict[str, Any]:
    summary, expected_glossary, initial_state = check_plan(project_path, plan)
    require_write_capability(initial_state["storage"])
    resolved_backup_path = (
        backup_path.resolve() if backup_path is not None else choose_backup_path(project_path)
    )
    create_online_backup(project_path, resolved_backup_path)

    connection = connect_writable(project_path)
    committed = False
    transaction_started = False
    try:
        connection.execute("BEGIN IMMEDIATE")
        transaction_started = True
        locked_state = read_state(connection)
        require_write_capability(locked_state["storage"])
        assert_snapshot_matches(
            normalize_snapshot(plan["snapshot"]),
            locked_state["snapshot"],
        )
        locked_glossary, locked_counts = build_next_glossary(locked_state, plan)
        if locked_glossary != expected_glossary:
            raise AuditError("锁内重算结果与写前结果不一致")
        next_revision = max(locked_state["revisions"].values(), default=0) + 1
        glossary_update = connection.execute(
            "UPDATE rules SET data = ? WHERE id = ? AND type = ?",
            (
                json.dumps(
                    locked_glossary,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                locked_state["glossary_rule_id"],
                RULE_TYPE,
            ),
        )
        if glossary_update.rowcount != 1:
            raise AuditError("锁内 glossary 行已变化，拒绝写入")
        revision_update = connection.execute(
            "UPDATE meta SET value = ? WHERE key = ?",
            (
                json.dumps(next_revision, ensure_ascii=False),
                "quality_rule_revision.glossary",
            ),
        )
        if revision_update.rowcount != 1:
            raise AuditError("glossary 修订键不唯一或不存在，拒绝写入")
        connection.execute("COMMIT")
        committed = True
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        if transaction_started and not committed:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()

    with closing(connect_readonly(project_path)) as verification:
        assert_integrity(verification, "目标数据库")
        final_state = read_state(verification)
    with closing(connect_readonly(resolved_backup_path)) as verification_backup:
        assert_integrity(verification_backup, "备份数据库")
        backup_state = read_state(verification_backup)

    expected_revision = summary["revision_after"]
    if final_state["snapshot"]["glossary_sha256"] != summary["expected_glossary_sha256"]:
        raise AuditError(f"写后 glossary 哈希不一致；备份位于 {resolved_backup_path}")
    if final_state["snapshot"]["glossary_revision"] != expected_revision:
        raise AuditError(f"写后 glossary revision 不一致；备份位于 {resolved_backup_path}")
    for key in (
        "schema_version",
        "storage_schema_sha256",
        "item_corpus_sha256",
        "other_rules_sha256",
        "item_count",
    ):
        if final_state["snapshot"][key] != initial_state["snapshot"][key]:
            raise AuditError(f"写后非目标事实 {key} 发生变化；备份位于 {resolved_backup_path}")
    for key in REVISION_KEYS:
        if key == "quality_rule_revision.glossary":
            continue
        if final_state["revisions"][key] != initial_state["revisions"][key]:
            raise AuditError(f"写后非目标修订 {key} 发生变化；备份位于 {resolved_backup_path}")
    if backup_state["snapshot"] != initial_state["snapshot"]:
        raise AuditError(f"备份快照与写前快照不一致：{resolved_backup_path}")

    return {
        **summary,
        "project_path": str(project_path.resolve()),
        "backup_path": str(resolved_backup_path),
        "integrity_check": "ok",
        "backup_integrity_check": "ok",
        "item_corpus_unchanged": True,
        "other_rules_unchanged": True,
        "applied": True,
        "operation_counts": locked_counts,
    }


def command_inspect(args: argparse.Namespace) -> None:
    project_path = Path(args.project).resolve()
    with closing(connect_readonly(project_path)) as connection:
        assert_quick_integrity(connection, "目标数据库")
        inspection = inspect_storage(connection)
    print_json({"project_path": str(project_path), **inspection})


def command_scan(args: argparse.Namespace) -> None:
    project_path = Path(args.project).resolve()
    with closing(connect_readonly(project_path)) as connection:
        assert_integrity(connection, "目标数据库")
        state = read_state(connection)
    report = build_scan_report(project_path, state, args.samples)
    if args.output:
        output_path = Path(args.output).resolve()
        write_json_file(output_path, report)
        print_json(
            {
                "report_path": str(output_path),
                "snapshot": report["snapshot"],
                "summary": report["summary"],
            }
        )
    else:
        print_json(report)


def command_locate(args: argparse.Namespace) -> None:
    project_path = Path(args.project).resolve()
    with closing(connect_readonly(project_path)) as connection:
        inspection = inspect_storage(connection)
        require_read_capability(inspection)
        items = read_items(connection)
    result = CorpusIndex(items).locate(args.src, args.limit)
    print_json(
        {
            "project_path": str(project_path),
            "src": args.src,
            **result,
        }
    )


def command_check(args: argparse.Namespace) -> None:
    project_path = Path(args.project).resolve()
    plan_path = Path(args.plan).resolve()
    plan = require_plan(load_json_file(plan_path))
    summary, _, _ = check_plan(project_path, plan)
    print_json(
        {
            "project_path": str(project_path),
            "plan_path": str(plan_path),
            **summary,
        }
    )


def command_apply(args: argparse.Namespace) -> None:
    project_path = Path(args.project).resolve()
    plan_path = Path(args.plan).resolve()
    plan = require_plan(load_json_file(plan_path))
    receipt = execute_apply(
        project_path,
        plan,
        Path(args.backup) if args.backup else None,
    )
    print_json(receipt)


def create_test_database(
    project_path: Path,
    *,
    schema_version: Any = REFERENCE_SCHEMA_VERSION,
    include_meta: bool = True,
) -> None:
    connection = sqlite3.connect(str(project_path))
    try:
        connection.executescript(
            """
            CREATE TABLE items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              data TEXT NOT NULL
            );
            CREATE TABLE rules (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              type TEXT NOT NULL,
              data TEXT NOT NULL
            );
            """
        )
        if include_meta:
            connection.execute(
                "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            for key, value in {
                "schema_version": schema_version,
                "quality_rule_revision.glossary": 1,
                "quality_rule_revision.post_replacement": 3,
            }.items():
                connection.execute(
                    "INSERT INTO meta (key, value) VALUES (?, ?)",
                    (key, json.dumps(value, ensure_ascii=False)),
                )
        for payload in (
            {
                "src": "騎士艾琳は感情伝達魔法を使った。",
                "file_path": "a.txt",
                "row": 1,
            },
            {
                "src": "艾琳は感情伝達の魔法を使った。",
                "file_path": "a.txt",
                "row": 2,
            },
            {"src": "剣を持つ。", "file_path": "a.txt", "row": 3},
        ):
            connection.execute(
                "INSERT INTO items (data) VALUES (?)",
                (json.dumps(payload, ensure_ascii=False),),
            )
        glossary = [
            {
                "src": "騎士艾琳",
                "dst": "骑士艾琳",
                "info": "女性角色",
                "regex": False,
                "case_sensitive": False,
                "entry_id": "old-1",
            },
            {
                "src": "感情伝達魔法",
                "dst": "情感传递魔法",
                "info": "特殊技能",
                "regex": False,
                "case_sensitive": False,
                "entry_id": "old-2",
            },
            {
                "src": "感情伝達の魔法",
                "dst": "情感传递魔法",
                "info": "特殊技能",
                "regex": False,
                "case_sensitive": False,
                "entry_id": "old-3",
            },
            {
                "src": "剣",
                "dst": "剑",
                "info": "其他",
                "regex": False,
                "case_sensitive": False,
                "entry_id": "old-4",
            },
        ]
        connection.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (
                RULE_TYPE,
                json.dumps(glossary, ensure_ascii=False, separators=(",", ":")),
            ),
        )
        connection.execute(
            "INSERT INTO rules (type, data) VALUES (?, ?)",
            (
                "post_translation_replacement",
                json.dumps([{"src": "甲", "dst": "乙"}], ensure_ascii=False),
            ),
        )
        connection.commit()
    finally:
        connection.close()


def command_self_test(_: argparse.Namespace) -> None:
    with tempfile.TemporaryDirectory(prefix="glossary-audit-") as temp_dir:
        exact_path = Path(temp_dir) / "exact.lg"
        create_test_database(exact_path)
        with closing(connect_readonly(exact_path)) as connection:
            exact_inspection = inspect_storage(connection)
            exact_state = read_state(connection)
        if exact_inspection["status"] != "exact":
            raise AuditError("自检 exact 能力判断错误")
        report = build_scan_report(exact_path, exact_state, 2)
        if report["summary"]["entry_count"] != 4:
            raise AuditError("自检 scan 结果错误")

        project_path = Path(temp_dir) / "compatible.lg"
        backup_path = Path(temp_dir) / "compatible.before.lg"
        create_test_database(project_path, schema_version=99)
        with closing(connect_readonly(project_path)) as connection:
            compatible_inspection = inspect_storage(connection)
            state = read_state(connection)
        if compatible_inspection["status"] != "compatible":
            raise AuditError("自检 compatible 能力判断错误")

        plan = {
            "format": PLAN_FORMAT,
            "snapshot": state["snapshot"],
            "operations": [
                {
                    "op": "delete",
                    "src": "騎士艾琳",
                    "reason": "去掉称谓，只保留核心人名",
                    "evidence": [1],
                },
                {
                    "op": "delete",
                    "src": "感情伝達魔法",
                    "reason": "由共享词根覆盖",
                    "evidence": [1],
                },
                {
                    "op": "delete",
                    "src": "感情伝達の魔法",
                    "reason": "由共享词根覆盖",
                    "evidence": [2],
                },
                {
                    "op": "delete",
                    "src": "剣",
                    "reason": "泛用物品",
                    "evidence": [3],
                },
                {
                    "op": "add",
                    "entry": {
                        "src": "艾琳",
                        "dst": "艾琳",
                        "info": "女性角色",
                        "regex": False,
                        "case_sensitive": False,
                    },
                    "reason": "人物核心名字",
                    "evidence": [1, 2],
                },
                {
                    "op": "add",
                    "entry": {
                        "src": "感情伝達",
                        "dst": "情感传递",
                        "info": "特殊技能",
                        "regex": False,
                        "case_sensitive": False,
                    },
                    "reason": "两个派生形式共享的最小有效词根",
                    "evidence": [1, 2],
                },
            ],
        }
        require_plan(plan)
        check_plan(project_path, plan)
        receipt = execute_apply(
            project_path,
            plan,
            backup_path,
        )
        if (
            receipt["after_count"] != 2
            or receipt["revision_after"] != 4
            or not backup_path.exists()
        ):
            raise AuditError("自检 apply 结果错误")

        read_only_path = Path(temp_dir) / "read-only.lg"
        create_test_database(read_only_path, include_meta=False)
        with closing(connect_readonly(read_only_path)) as connection:
            read_only_state = read_state(connection)
        if read_only_state["storage"]["status"] != "read_only":
            raise AuditError("自检 read_only 能力判断错误")
        read_only_plan = {
            "format": PLAN_FORMAT,
            "snapshot": read_only_state["snapshot"],
            "operations": [],
        }
        read_only_summary, _, _ = check_plan(read_only_path, read_only_plan)
        if read_only_summary["apply_capable"] or read_only_summary["revision_after"] is not None:
            raise AuditError("自检 read_only 计划结果错误")
        try:
            execute_apply(read_only_path, read_only_plan)
        except AuditError:
            pass
        else:
            raise AuditError("自检 read_only 未阻止写入")

        ambiguous_path = Path(temp_dir) / "ambiguous.lg"
        with closing(sqlite3.connect(str(ambiguous_path))) as connection:
            connection.execute("CREATE TABLE items (id INTEGER, data TEXT)")
        with closing(connect_readonly(ambiguous_path)) as connection:
            ambiguous_inspection = inspect_storage(connection)
        if ambiguous_inspection["status"] != "ambiguous":
            raise AuditError("自检 ambiguous 能力判断错误")

        print_json(
            {
                "self_test": "ok",
                "statuses": {
                    "exact": exact_inspection["status"],
                    "compatible": compatible_inspection["status"],
                    "read_only": read_only_state["storage"]["status"],
                    "ambiguous": ambiguous_inspection["status"],
                },
                "receipt": receipt,
            }
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="LinguaGacha .lg 术语表只读审校与安全写入工具"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser(
        "inspect",
        help="浅度探测表、字段和数据形状并判断能力等级",
    )
    inspect_parser.add_argument("project")
    inspect_parser.set_defaults(handler=command_inspect)

    scan_parser = subparsers.add_parser("scan", help="只读扫描术语、出处和同根候选")
    scan_parser.add_argument("project")
    scan_parser.add_argument("--output")
    scan_parser.add_argument("--samples", type=int, default=3)
    scan_parser.set_defaults(handler=command_scan)

    locate_parser = subparsers.add_parser("locate", help="查询术语的不同原文行")
    locate_parser.add_argument("project")
    locate_parser.add_argument("--src", required=True)
    locate_parser.add_argument("--limit", type=int, default=0)
    locate_parser.set_defaults(handler=command_locate)

    check_parser = subparsers.add_parser("check", help="只读校验变更计划")
    check_parser.add_argument("project")
    check_parser.add_argument("plan")
    check_parser.set_defaults(handler=command_check)

    apply_parser = subparsers.add_parser("apply", help="执行用户已确认的当前计划")
    apply_parser.add_argument("project")
    apply_parser.add_argument("plan")
    apply_parser.add_argument("--backup")
    apply_parser.set_defaults(handler=command_apply)

    self_test_parser = subparsers.add_parser("self-test", help="运行隔离数据库自检")
    self_test_parser.set_defaults(handler=command_self_test)
    return parser


def main() -> int:
    try:
        args = build_parser().parse_args()
        if hasattr(args, "samples") and args.samples < 0:
            raise AuditError("--samples 不能为负数")
        if hasattr(args, "limit") and args.limit < 0:
            raise AuditError("--limit 不能为负数")
        args.handler(args)
        return 0
    except (AuditError, sqlite3.Error, OSError) as error:
        print_json({"error": str(error)}, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
