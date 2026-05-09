from __future__ import annotations

import base64
import os
import threading
import urllib.error
import urllib.request
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from typing import ClassVar

from base.Base import Base
from module.Data.Database.DatabaseContracts import DatabaseRuleType
from module.Utils.JSONTool import JSONTool


class DatabaseGatewayError(RuntimeError):
    # 内部 database service 调用失败。
    pass


class DatabaseTransaction:
    # 延迟收集一组 database 操作，并在 commit 时交给 TS 侧事务执行。

    def __init__(self, gateway: "DatabaseGateway") -> None:
        self.gateway = gateway
        self.operations: list[dict[str, Any]] = []
        self.committed = False

    def add_operation(self, name: str, args: dict[str, Any]) -> None:
        self.operations.append({"name": name, "args": args})

    def commit(self) -> None:
        if self.committed:
            return
        self.gateway.execute_transaction(self.operations)
        self.committed = True


class DatabaseGateway(Base):
    # Python Core 访问 Electron main database workflow 的唯一入口。

    RuleType = DatabaseRuleType
    SCHEMA_VERSION: ClassVar[int] = 2
    RULE_TYPE_TO_DATABASE_TYPE: ClassVar[dict[str, str]] = {
        DatabaseRuleType.GLOSSARY: "glossary",
        DatabaseRuleType.TEXT_PRESERVE: "text_preserve",
        DatabaseRuleType.PRE_REPLACEMENT: "pre_translation_replacement",
        DatabaseRuleType.POST_REPLACEMENT: "post_translation_replacement",
        DatabaseRuleType.TRANSLATION_PROMPT: "translation_prompt",
        DatabaseRuleType.ANALYSIS_PROMPT: "analysis_prompt",
    }

    DATABASE_API_BASE_URL_ENV_NAME: ClassVar[str] = "LINGUAGACHA_DATABASE_API_BASE_URL"
    DATABASE_API_TOKEN_ENV_NAME: ClassVar[str] = "LINGUAGACHA_DATABASE_API_TOKEN"
    DATABASE_TOKEN_HEADER_NAME: ClassVar[str] = "X-LinguaGacha-Database-Token"
    REQUEST_TIMEOUT_SECONDS: ClassVar[float] = 30.0

    def __init__(self, project_path: str) -> None:
        super().__init__()
        self.project_path = project_path
        self.lock = threading.RLock()
        self.base_url = self.require_env(self.DATABASE_API_BASE_URL_ENV_NAME)
        self.token = self.require_env(self.DATABASE_API_TOKEN_ENV_NAME)

    @classmethod
    def require_env(cls, name: str) -> str:
        # 强制由 Electron main 注入内部地址，避免 Core 独立误写 .lg。

        value = os.environ.get(name, "").strip()
        if value == "":
            raise RuntimeError(f"缺少内部 database service 环境变量：{name}")
        return value.rstrip("/")

    @classmethod
    def to_database_rule_type(cls, rule_type: DatabaseRuleType | str) -> str:
        # Python 业务枚举不是 .lg 物理槽位名，跨进程前必须归一。

        raw_rule_type = str(rule_type)
        return cls.RULE_TYPE_TO_DATABASE_TYPE.get(raw_rule_type, raw_rule_type)

    @classmethod
    def create(cls, project_path: str, name: str) -> "DatabaseGateway":
        # 新建工程必须先经过 TS database workflow 初始化 schema 与物理格式。

        gateway = cls(project_path)
        gateway.execute_operation("createProject", {"name": name})
        return gateway

    def open(self) -> None:
        # 触发 TS database workflow 打开工程，确保打开期迁移先于业务读取。

        self.execute_operation("getAllMeta", {})

    def close(self) -> None:
        self.execute_operation("closeProject", {})

    @contextmanager
    def connection(self) -> Generator[DatabaseTransaction, None, None]:
        # 保留旧 Data 层事务写法，但真实事务统一交给 TS database 执行。

        transaction = DatabaseTransaction(self)
        with self.lock:
            yield transaction

    def execute_operation(self, name: str, args: dict[str, Any]) -> Any:
        # 所有单步操作都补齐 projectPath，避免调用点散落物理工程路径。

        payload = {
            "name": name,
            "args": {
                "projectPath": self.project_path,
                **args,
            },
        }
        return self.request_json("/internal/database/op", payload)

    def queue_or_execute(
        self,
        conn: DatabaseTransaction | None,
        name: str,
        args: dict[str, Any],
    ) -> Any:
        # 同一方法同时支持事务排队与立即执行，减少 Data 层分叉。

        if conn is not None:
            conn.add_operation(
                name,
                {
                    "projectPath": self.project_path,
                    **args,
                },
            )
            return None
        return self.execute_operation(name, args)

    def execute_transaction(self, operations: list[dict[str, Any]]) -> None:
        if not operations:
            return
        self.request_json("/internal/database/transaction", {"operations": operations})

    def request_json(self, path: str, payload: dict[str, Any]) -> Any:
        # 解析统一 JSON 响应壳，让 Python 侧只感知成功数据或业务错误。

        raw_body = JSONTool.dumps_bytes(payload)
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=raw_body,
            headers={
                "Content-Type": "application/json",
                self.DATABASE_TOKEN_HEADER_NAME: self.token,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.REQUEST_TIMEOUT_SECONDS,
            ) as response:
                envelope = JSONTool.loads(response.read())
        except urllib.error.HTTPError as e:
            try:
                envelope = JSONTool.loads(e.read())
            except Exception as decode_error:
                raise DatabaseGatewayError("database service 返回了无效错误响应") from (
                    decode_error
                )
        except Exception as e:
            raise DatabaseGatewayError("database service 请求失败") from e

        if not isinstance(envelope, dict) or envelope.get("ok") is not True:
            error = envelope.get("error", {}) if isinstance(envelope, dict) else {}
            message = (
                str(error.get("message", "database service 调用失败"))
                if isinstance(error, dict)
                else "database service 调用失败"
            )
            raise DatabaseGatewayError(message)
        return envelope.get("data")

    def read_asset_content(self, path: str) -> bytes | None:
        # asset 解压由 TS database 持有，Python 只拿可解析的原始 bytes。

        raw_body = JSONTool.dumps_bytes(
            {
                "projectPath": self.project_path,
                "path": path,
            }
        )
        request = urllib.request.Request(
            f"{self.base_url}/internal/database/read-asset-content",
            data=raw_body,
            headers={
                "Content-Type": "application/json",
                self.DATABASE_TOKEN_HEADER_NAME: self.token,
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=self.REQUEST_TIMEOUT_SECONDS,
            ) as response:
                return response.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise DatabaseGatewayError("读取 asset bytes 失败") from e
        except Exception as e:
            raise DatabaseGatewayError("读取 asset bytes 失败") from e

    def get_meta(self, key: str, default: Any = None) -> Any:
        return self.execute_operation("getMeta", {"key": key, "default": default})

    def set_meta(self, key: str, value: Any) -> None:
        self.execute_operation("setMeta", {"key": key, "value": value})

    def upsert_meta_entries(
        self,
        meta: dict[str, Any],
        conn: DatabaseTransaction | None = None,
    ) -> None:
        if not meta:
            return
        self.queue_or_execute(conn, "upsertMetaEntries", {"meta": meta})

    def get_all_meta(self) -> dict[str, Any]:
        data = self.execute_operation("getAllMeta", {})
        return data if isinstance(data, dict) else {}

    def bump_runtime_section_revisions(self, sections: list[str]) -> dict[str, int]:
        # Python 任务只表达哪些 section 变化，公开 revision 规则由 TS database workflow 持有。

        data = self.execute_operation(
            "bumpRuntimeSectionRevisions",
            {"sections": sections},
        )
        return (
            {str(section): int(revision) for section, revision in data.items()}
            if isinstance(data, dict)
            else {}
        )

    def get_analysis_item_checkpoints(
        self,
        conn: DatabaseTransaction | None = None,
    ) -> list[dict[str, Any]]:
        del conn
        data = self.execute_operation("getAnalysisItemCheckpoints", {})
        return data if isinstance(data, list) else []

    def upsert_analysis_item_checkpoints(
        self,
        checkpoints: list[dict[str, Any]],
        conn: DatabaseTransaction | None = None,
    ) -> None:
        if not checkpoints:
            return
        self.queue_or_execute(
            conn,
            "upsertAnalysisItemCheckpoints",
            {"checkpoints": checkpoints},
        )

    def delete_analysis_item_checkpoints(
        self,
        *,
        status: str | None = None,
        conn: DatabaseTransaction | None = None,
    ) -> int:
        # 事务排队时先计算可见删除数，保持旧调用方返回语义不变。

        if conn is not None:
            deleted_count = 0
            if status is not None:
                deleted_count = sum(
                    1
                    for row in self.get_analysis_item_checkpoints()
                    if str(row.get("status", "")) == status
                )
            else:
                deleted_count = len(self.get_analysis_item_checkpoints())
            self.queue_or_execute(
                conn,
                "deleteAnalysisItemCheckpoints",
                {"status": status},
            )
            return deleted_count
        data = self.execute_operation(
            "deleteAnalysisItemCheckpoints",
            {"status": status},
        )
        return int(data or 0)

    def get_analysis_candidate_aggregates(
        self,
        conn: DatabaseTransaction | None = None,
    ) -> list[dict[str, Any]]:
        del conn
        data = self.execute_operation("getAnalysisCandidateAggregates", {})
        return data if isinstance(data, list) else []

    def get_analysis_candidate_aggregates_by_srcs(
        self,
        srcs: list[str],
        conn: DatabaseTransaction | None = None,
    ) -> list[dict[str, Any]]:
        del conn
        data = self.execute_operation(
            "getAnalysisCandidateAggregatesBySrcs",
            {"srcs": srcs},
        )
        return data if isinstance(data, list) else []

    def upsert_analysis_candidate_aggregates(
        self,
        aggregates: list[dict[str, Any]],
        conn: DatabaseTransaction | None = None,
    ) -> None:
        if not aggregates:
            return
        self.queue_or_execute(
            conn,
            "upsertAnalysisCandidateAggregates",
            {"aggregates": aggregates},
        )

    def clear_analysis_candidate_aggregates(
        self,
        conn: DatabaseTransaction | None = None,
    ) -> None:
        self.queue_or_execute(conn, "clearAnalysisCandidateAggregates", {})

    def add_asset(
        self,
        path: str,
        data: bytes,
        original_size: int,
        sort_order: int | None = None,
        conn: DatabaseTransaction | None = None,
    ) -> None:
        # 兼容少量仍传压缩 bytes 的调用，新的源文件导入优先用 source path。

        self.queue_or_execute(
            conn,
            "addAssetCompressedBase64",
            {
                "path": path,
                "compressedBase64": base64.b64encode(data).decode("ascii"),
                "originalSize": int(original_size),
                "sortOrder": sort_order,
            },
        )

    def add_asset_from_source(
        self,
        path: str,
        source_path: str,
        sort_order: int | None = None,
        conn: DatabaseTransaction | None = None,
    ) -> None:
        # 让 TS database 读取并压缩源文件，确保 .lg asset 格式只有一个实现。

        self.queue_or_execute(
            conn,
            "addAssetFromSource",
            {
                "path": path,
                "sourcePath": source_path,
                "sortOrder": sort_order,
            },
        )

    def update_asset_from_source(self, path: str, source_path: str) -> None:
        self.execute_operation(
            "updateAssetFromSource",
            {
                "path": path,
                "sourcePath": source_path,
            },
        )

    def update_asset_path(self, old_path: str, new_path: str) -> None:
        self.execute_operation(
            "updateAssetPath",
            {
                "oldPath": old_path,
                "newPath": new_path,
            },
        )

    def get_asset(self, path: str) -> bytes | None:
        data = self.execute_operation("getAssetCompressedBase64", {"path": path})
        if not isinstance(data, str):
            return None
        return base64.b64decode(data.encode("ascii"))

    def delete_asset(
        self,
        path: str,
        conn: DatabaseTransaction | None = None,
    ) -> None:
        self.queue_or_execute(conn, "deleteAsset", {"path": path})

    def asset_path_exists(self, path: str) -> bool:
        return bool(self.execute_operation("assetPathExists", {"path": path}))

    def get_all_asset_paths(self) -> list[str]:
        data = self.execute_operation("getAllAssetPaths", {})
        return [str(path) for path in data] if isinstance(data, list) else []

    def get_all_asset_records(self) -> list[dict[str, Any]]:
        data = self.execute_operation("getAllAssetRecords", {})
        return data if isinstance(data, list) else []

    def update_asset_sort_orders(
        self,
        ordered_paths: list[str],
        conn: DatabaseTransaction | None = None,
    ) -> None:
        self.queue_or_execute(
            conn,
            "updateAssetSortOrders",
            {"orderedPaths": ordered_paths},
        )

    def get_all_items(self) -> list[dict[str, Any]]:
        data = self.execute_operation("getAllItems", {})
        return data if isinstance(data, list) else []

    def get_items_by_ids(self, item_ids: list[int]) -> list[dict[str, Any]]:
        data = self.execute_operation("getItemsByIds", {"itemIds": item_ids})
        return data if isinstance(data, list) else []

    def delete_items_by_file_path(
        self,
        file_path: str,
        conn: DatabaseTransaction | None = None,
    ) -> int:
        if conn is not None:
            self.queue_or_execute(
                conn,
                "deleteItemsByFilePath",
                {"filePath": file_path},
            )
            return 0
        data = self.execute_operation(
            "deleteItemsByFilePath",
            {"filePath": file_path},
        )
        return int(data or 0)

    def set_item(self, item: dict[str, Any]) -> int:
        return int(self.execute_operation("setItem", {"item": item}) or 0)

    def set_items(
        self,
        items: list[dict[str, Any]],
        conn: DatabaseTransaction | None = None,
    ) -> list[int]:
        if conn is not None:
            self.queue_or_execute(conn, "setItems", {"items": items})
            return []
        data = self.execute_operation("setItems", {"items": items})
        return [int(item_id) for item_id in data] if isinstance(data, list) else []

    def preview_replace_all_item_ids(
        self,
        items: list[dict[str, Any]],
        conn: DatabaseTransaction | None = None,
    ) -> list[int]:
        del conn
        data = self.execute_operation("previewReplaceAllItemIds", {"items": items})
        return [int(item_id) for item_id in data] if isinstance(data, list) else []

    def update_batch(
        self,
        items: list[dict[str, Any]] | None = None,
        rules: dict[DatabaseRuleType, Any] | None = None,
        meta: dict[str, Any] | None = None,
        conn: DatabaseTransaction | None = None,
    ) -> None:
        # 批量写入口只传业务快照，规则枚举在网关边界转成稳定字符串。

        normalized_rules = (
            {
                self.to_database_rule_type(rule_type): rule_data
                for rule_type, rule_data in rules.items()
            }
            if rules
            else None
        )
        self.queue_or_execute(
            conn,
            "updateBatch",
            {
                "items": items,
                "rules": normalized_rules,
                "meta": meta,
            },
        )

    def get_rules(self, rule_type: DatabaseRuleType) -> list[dict[str, Any]]:
        data = self.execute_operation(
            "getRules",
            {"ruleType": self.to_database_rule_type(rule_type)},
        )
        return data if isinstance(data, list) else []

    def set_rules(
        self,
        rule_type: DatabaseRuleType,
        rules: list[dict[str, Any]],
    ) -> None:
        self.execute_operation(
            "setRules",
            {
                "ruleType": self.to_database_rule_type(rule_type),
                "rules": rules,
            },
        )

    def get_rule_text(self, rule_type: DatabaseRuleType) -> str:
        data = self.execute_operation(
            "getRuleText",
            {"ruleType": self.to_database_rule_type(rule_type)},
        )
        return str(data or "")

    def get_rule_text_by_name(self, rule_type_name: str) -> str:
        data = self.execute_operation(
            "getRuleTextByName",
            {"ruleTypeName": rule_type_name},
        )
        return str(data or "")

    def set_rule_text(self, rule_type: DatabaseRuleType, text: str) -> None:
        self.execute_operation(
            "setRuleText",
            {
                "ruleType": self.to_database_rule_type(rule_type),
                "text": text,
            },
        )

    def get_project_summary(self) -> dict[str, Any]:
        data = self.execute_operation("getProjectSummary", {})
        return (
            data if isinstance(data, dict) else {"name": Path(self.project_path).stem}
        )
