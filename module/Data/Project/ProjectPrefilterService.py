from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from module.Data.Core.Item import Item
from module.Config import Config
from module.Data.Core.BatchService import BatchService
from module.Data.Core.DataTypes import ProjectPrefilterRequest
from module.Data.Core.ItemService import ItemService
from module.Data.Core.ProjectSession import ProjectSession
from module.Filter.ProjectPrefilter import ProjectPrefilter
from module.Filter.ProjectPrefilter import ProjectPrefilterResult


class ProjectPrefilterService:
    """工程预过滤服务。"""

    def __init__(
        self,
        session: ProjectSession,
        item_service: ItemService,
        batch_service: BatchService,
    ) -> None:
        self.session = session
        self.item_service = item_service
        self.batch_service = batch_service

        self.prefilter_lock = threading.Lock()
        self.prefilter_running = False
        self.prefilter_pending = False
        self.prefilter_latest_request: ProjectPrefilterRequest | None = None

    def is_prefilter_needed(self, current_config: object, config: Config) -> bool:
        """判断当前工程是否需要重跑预过滤。"""

        if not isinstance(current_config, dict):
            return True

        expected = {
            "source_language": str(config.source_language),
            "mtool_optimizer_enable": bool(config.mtool_optimizer_enable),
        }
        return current_config != expected

    def enqueue_request(
        self,
        config: Config,
        *,
        reason: str,
        lg_path: str,
    ) -> tuple[ProjectPrefilterRequest, bool]:
        """压入一条异步预过滤请求。"""

        start_worker = False
        with self.prefilter_lock:
            if not self.prefilter_running:
                self.prefilter_running = True
                start_worker = True

            request = self.build_request(
                config,
                reason=reason,
                lg_path=lg_path,
            )
            self.prefilter_latest_request = request
            self.prefilter_pending = True
            return request, start_worker

    def build_request(
        self,
        config: Config,
        *,
        reason: str,
        lg_path: str,
    ) -> ProjectPrefilterRequest:
        """统一构造冻结请求。"""

        return ProjectPrefilterRequest(
            lg_path=lg_path,
            reason=reason,
            source_language=str(config.source_language),
            mtool_optimizer_enable=bool(config.mtool_optimizer_enable),
        )

    def pop_pending_request(self) -> ProjectPrefilterRequest | None:
        """弹出当前待处理的最新请求。"""

        with self.prefilter_lock:
            if not self.prefilter_pending:
                return None
            request = self.prefilter_latest_request
            self.prefilter_pending = False
            return request

    def finish_worker(self) -> None:
        """结束当前 worker 生命周期。"""

        with self.prefilter_lock:
            self.prefilter_running = False

    def apply_once(
        self,
        request: ProjectPrefilterRequest,
        *,
        items: list[Item],
        progress_cb: Callable[[int, int], None] | None = None,
    ) -> ProjectPrefilterResult | None:
        """执行一次预过滤并写回数据库。"""

        with self.session.state_lock:
            if self.session.db is None:
                return None
            if self.session.lg_path != request.lg_path:
                return None

        self.item_service.clear_item_cache()
        result = ProjectPrefilter.apply(
            items=items,
            source_language=request.source_language,
            mtool_optimizer_enable=request.mtool_optimizer_enable,
            progress_cb=progress_cb,
        )

        item_dicts: list[dict[str, Any]] = []
        for item in items:
            item_dicts.append(item.to_dict())

        meta = {
            "prefilter_config": result.prefilter_config,
            "analysis_extras": {},
            "analysis_candidate_count": 0,
        }

        with self.session.state_lock:
            if self.session.db is None or self.session.lg_path != request.lg_path:
                return None

            self.batch_service.update_batch(items=item_dicts, meta=meta)
            self.session.db.delete_analysis_item_checkpoints()
            self.session.db.clear_analysis_candidate_aggregates()

        return result
