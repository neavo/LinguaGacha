from __future__ import annotations

import os
from enum import Enum
from typing import Any
from typing import ClassVar

import httpx

from base.Base import Base
from module.Data.Core.Item import Item
from module.Engine.TaskProgressSnapshot import TaskProgressSnapshot


class TaskDataClient:
    """Python Engine 访问 TS 任务数据服务的唯一窄客户端。"""

    # TS Gateway 公开地址由 Electron main 注入，Python 任务不自行猜端口。
    CORE_API_BASE_URL_ENV_NAME: ClassVar[str] = "LINGUAGACHA_CORE_API_BASE_URL"

    # Core token 只用于进程内受保护路由，不能进入 renderer 或用户配置。
    CORE_API_TOKEN_ENV_NAME: ClassVar[str] = "LINGUAGACHA_CORE_API_TOKEN"

    # 复用 Gateway 既有鉴权 header，避免为 task-data 再造一套 token 协议。
    TOKEN_HEADER_NAME: ClassVar[str] = "X-LinguaGacha-Core-Token"

    # 任务提交可能携带批量 items，超时要比普通 UI 请求更宽。
    REQUEST_TIMEOUT_SECONDS: ClassVar[float] = 60.0

    # Engine 内部共享一个 client，便于测试替换和运行时环境变量集中读取。
    instance: ClassVar["TaskDataClient | None"] = None

    def __init__(
        self, *, base_url: str | None = None, token: str | None = None
    ) -> None:
        """初始化内部 HTTP 依赖，环境变量缺失时保留到首次请求再报语义错误。"""

        self.base_url = (
            base_url or os.environ.get(self.CORE_API_BASE_URL_ENV_NAME, "")
        ).strip()
        self.token = (token or os.environ.get(self.CORE_API_TOKEN_ENV_NAME, "")).strip()

    @classmethod
    def get(cls) -> "TaskDataClient":
        """返回进程内共享客户端，避免每个任务重复解析环境变量。"""

        if cls.instance is None:
            cls.instance = cls()
        return cls.instance

    def is_loaded(self) -> bool:
        """任务门禁只读取 TS 当前工程上下文，不依赖 Python DataManager 会话。"""

        return bool(self.get_project_context().get("loaded", False))

    def get_project_context(self) -> dict[str, Any]:
        """读取当前工程上下文和 meta 快照。"""

        return self.post_json("/internal/task-data/project-context", {})

    def get_translation_extras(self) -> dict[str, Any]:
        """读取翻译进度 extras，供 CONTINUE 模式恢复累计统计。"""

        meta = self.get_project_context().get("meta", {})
        if isinstance(meta, dict) and isinstance(meta.get("translation_extras"), dict):
            return dict(meta["translation_extras"])
        return {}

    def get_analysis_progress_snapshot(self) -> dict[str, Any]:
        """读取分析进度快照，坏值统一按 TaskProgressSnapshot 归零。"""

        meta = self.get_project_context().get("meta", {})
        extras = meta.get("analysis_extras", {}) if isinstance(meta, dict) else {}
        return self.normalize_analysis_progress_snapshot(
            dict(extras) if isinstance(extras, dict) else {}
        )

    def get_analysis_candidate_count(self) -> int:
        """读取候选术语数量缓存，供进度事件补齐 analysis_candidate_count。"""

        meta = self.get_project_context().get("meta", {})
        try:
            return (
                int(meta.get("analysis_candidate_count", 0))
                if isinstance(meta, dict)
                else 0
            )
        except TypeError:
            return 0
        except ValueError:
            return 0

    def get_items_for_translation(
        self,
        config: object,
        mode: Base.TranslationMode,
    ) -> list[Item]:
        """读取翻译任务条目快照；config 仅保留签名兼容，筛选权威在 TS。"""

        del config
        payload = self.post_json(
            "/internal/task-data/translation/items",
            {"mode": self.to_json_value(mode)},
        )
        return self.items_from_payload(payload.get("items", []))

    def commit_translation_batch(
        self,
        finalized_items: list[dict[str, Any]],
        extras_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        """提交翻译批次，TS 负责落库、revision 推进和 project.patch。"""

        return self.post_json(
            "/internal/task-data/translation/commit",
            {
                "items": finalized_items,
                "translation_extras": extras_snapshot,
            },
        )

    def update_translation_progress(
        self, extras_snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        """只持久化翻译进度 extras，不触发 item patch。"""

        return self.post_json(
            "/internal/task-data/translation/progress",
            {"translation_extras": extras_snapshot},
        )

    def get_analysis_context(self) -> dict[str, Any]:
        """读取分析任务需要的 items、checkpoint 和 meta。"""

        return self.post_json("/internal/task-data/analysis/context", {})

    def get_all_items(self) -> list[Item]:
        """读取当前工程全部条目对象，供分析覆盖率与调度使用。"""

        payload = self.get_analysis_context()
        return self.items_from_payload(payload.get("items", []))

    def get_all_item_dicts(self) -> list[dict[str, Any]]:
        """读取全部条目字典，供重翻进度重算使用。"""

        payload = self.get_analysis_context()
        items = payload.get("items", [])
        return [dict(item) for item in items if isinstance(item, dict)]

    def get_item_dicts_by_ids(self, item_ids: list[int]) -> list[dict[str, Any]]:
        """按 id 读取重翻条目，并保留 TS 返回顺序。"""

        payload = self.post_json(
            "/internal/task-data/retranslate/items",
            {"item_ids": item_ids},
        )
        items = payload.get("items", [])
        return [dict(item) for item in items if isinstance(item, dict)]

    def get_analysis_item_checkpoints(self) -> dict[int, dict[str, Any]]:
        """读取 checkpoint map，状态保持字符串并由调度器统一归一。"""

        payload = self.get_analysis_context()
        checkpoints = payload.get("checkpoints", [])
        result: dict[int, dict[str, Any]] = {}
        if not isinstance(checkpoints, list):
            return result
        for checkpoint in checkpoints:
            if not isinstance(checkpoint, dict):
                continue
            try:
                item_id = int(checkpoint.get("item_id", 0))
            except TypeError:
                continue
            except ValueError:
                continue
            if item_id > 0:
                result[item_id] = dict(checkpoint)
        return result

    def get_pending_analysis_items(self) -> list[Item]:
        """按当前 checkpoint 筛选待分析条目，避免调度器回读 DataManager。"""

        checkpoints = self.get_analysis_item_checkpoints()
        pending_items: list[Item] = []
        for item in self.get_all_items():
            status = item.get_status()
            if status in (
                Base.ItemStatus.EXCLUDED,
                Base.ItemStatus.RULE_SKIPPED,
                Base.ItemStatus.LANGUAGE_SKIPPED,
                Base.ItemStatus.DUPLICATED,
            ):
                continue
            item_id = item.get_id()
            if not isinstance(item_id, int) or item.get_src().strip() == "":
                continue
            checkpoint = checkpoints.get(item_id)
            checkpoint_status = checkpoint.get("status") if checkpoint else None
            if checkpoint_status in (
                Base.ItemStatus.PROCESSED.value,
                Base.ItemStatus.PROCESSED,
            ):
                continue
            pending_items.append(item)
        return pending_items

    def reset_analysis_progress(self) -> dict[str, Any]:
        """清空分析派生事实，NEW/RESET 模式进入任务前调用。"""

        return self.post_json("/internal/task-data/analysis/reset", {})

    def normalize_analysis_progress_snapshot(
        self, snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        """复用共享快照对象完成进度字段归一。"""

        return TaskProgressSnapshot.from_dict(snapshot).to_dict()

    def update_analysis_progress_snapshot(
        self, snapshot: dict[str, Any]
    ) -> dict[str, Any]:
        """持久化分析进度快照，并返回 TS 归一后的进度。"""

        payload = self.post_json(
            "/internal/task-data/analysis/progress",
            {"analysis_extras": snapshot},
        )
        extras = payload.get("analysis_extras", {})
        return self.normalize_analysis_progress_snapshot(
            dict(extras) if isinstance(extras, dict) else {}
        )

    def refresh_analysis_progress_snapshot_cache(self) -> dict[str, Any]:
        """显式刷新时交给 TS 保存当前 Python 已计算好的快照。"""

        return self.update_analysis_progress_snapshot(
            self.get_analysis_progress_snapshot()
        )

    def commit_analysis_task_batch(
        self,
        *,
        success_checkpoints: list[dict[str, Any]] | None = None,
        error_checkpoints: list[dict[str, Any]] | None = None,
        glossary_entries: list[dict[str, Any]] | None = None,
        progress_snapshot: dict[str, Any] | None = None,
    ) -> int:
        """提交分析批次，返回本批有效术语数量。"""

        payload = self.post_json(
            "/internal/task-data/analysis/commit",
            {
                "success_checkpoints": success_checkpoints or [],
                "error_checkpoints": error_checkpoints or [],
                "glossary_entries": glossary_entries or [],
                "progress_snapshot": progress_snapshot,
            },
        )
        try:
            return int(payload.get("inserted_count", 0))
        except TypeError:
            return 0
        except ValueError:
            return 0

    def commit_retranslate_batch(
        self,
        finalized_items: list[dict[str, Any]],
        translation_extras: dict[str, Any],
    ) -> dict[str, Any]:
        """提交重翻批次，TS 同步推进 items/proofreading/task patch。"""

        return self.post_json(
            "/internal/task-data/retranslate/commit",
            {
                "items": finalized_items,
                "translation_extras": translation_extras,
            },
        )

    def items_from_payload(self, value: object) -> list[Item]:
        """把 TS JSON item dict 转回 Engine 内部 Item 对象。"""

        if not isinstance(value, list):
            return []
        return [Item.from_dict(dict(item)) for item in value if isinstance(item, dict)]

    def post_json(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        """统一调用 TS 内部 task-data 路由并处理响应壳。"""

        if self.base_url == "" or self.token == "":
            raise RuntimeError("缺少 TS Gateway task-data 环境变量。")
        try:
            response = httpx.post(
                f"{self.base_url}{path}",
                json=self.to_json_value(payload),
                headers={self.TOKEN_HEADER_NAME: self.token},
                timeout=self.REQUEST_TIMEOUT_SECONDS,
            )
            envelope = response.json()
        except Exception as e:
            raise RuntimeError("TS task-data 调用失败。") from e

        if (
            response.is_success
            and isinstance(envelope, dict)
            and envelope.get("ok") is True
        ):
            data = envelope.get("data", {})
            return dict(data) if isinstance(data, dict) else {}

        message = "TS task-data 调用失败。"
        if isinstance(envelope, dict):
            error = envelope.get("error")
            if isinstance(error, dict):
                message = str(error.get("message", message))
        raise RuntimeError(message)

    def to_json_value(self, value: Any) -> Any:
        """把 Enum、Item 和嵌套容器转换成 httpx 可序列化的 JSON 值。"""

        if isinstance(value, Enum):
            return value.value
        if isinstance(value, Item):
            return self.to_json_value(value.to_dict())
        if isinstance(value, dict):
            return {str(key): self.to_json_value(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [self.to_json_value(item) for item in value]
        return value
