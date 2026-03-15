from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

from model.Item import Item
from module.Config import Config
from module.Data.Core.BatchService import BatchService
from module.Data.Core.DataTypes import ProjectPrefilterRequest
from module.Data.Core.ItemService import ItemService
from module.Data.Core.ProjectSession import ProjectSession
from module.Filter.ProjectPrefilter import ProjectPrefilter
from module.Filter.ProjectPrefilter import ProjectPrefilterResult
from module.Utils.GapTool import GapTool


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
        self.prefilter_cond = threading.Condition(self.prefilter_lock)
        self.prefilter_running = False
        self.prefilter_pending = False
        self.prefilter_token = 0
        self.prefilter_active_token = 0
        self.prefilter_request_seq = 0
        self.prefilter_last_handled_seq = 0
        self.prefilter_latest_request: ProjectPrefilterRequest | None = None

    def is_prefilter_needed(self, current_config: object, config: Config) -> bool:
        """判断当前工程是否需要重跑预过滤。"""

        if not isinstance(current_config, dict):
            return True

        expected = {
            "source_language": str(config.source_language),
            "target_language": str(config.target_language),
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
        with self.prefilter_cond:
            if self.prefilter_running:
                token = self.prefilter_active_token
            else:
                self.prefilter_token += 1
                token = self.prefilter_token
                self.prefilter_active_token = token
                self.prefilter_running = True
                start_worker = True

            request = self.build_request(
                config,
                reason=reason,
                lg_path=lg_path,
                token=token,
            )
            self.prefilter_latest_request = request
            self.prefilter_pending = True
            self.prefilter_cond.notify_all()
            return request, start_worker

    def enqueue_sync_request(
        self,
        config: Config,
        *,
        reason: str,
        lg_path: str,
    ) -> tuple[ProjectPrefilterRequest | None, bool]:
        """压入同步请求。

        返回 `(request, True)` 表示调用方要在当前线程直接跑 worker。
        返回 `(None, False)` 表示已有 worker 在跑，本次只合并请求并等待。
        """

        with self.prefilter_cond:
            if self.prefilter_running:
                request = self.build_request(
                    config,
                    reason=reason,
                    lg_path=lg_path,
                    token=self.prefilter_active_token,
                )
                self.prefilter_latest_request = request
                self.prefilter_pending = True
                self.prefilter_cond.notify_all()
                self.prefilter_cond.wait_for(lambda: not self.prefilter_running)
                return None, False

            self.prefilter_token += 1
            token = self.prefilter_token
            self.prefilter_active_token = token
            self.prefilter_running = True
            request = self.build_request(
                config,
                reason=reason,
                lg_path=lg_path,
                token=token,
            )
            self.prefilter_latest_request = request
            self.prefilter_pending = True
            self.prefilter_cond.notify_all()
            return request, True

    def build_request(
        self,
        config: Config,
        *,
        reason: str,
        lg_path: str,
        token: int,
    ) -> ProjectPrefilterRequest:
        """统一构造冻结请求。"""

        self.prefilter_request_seq += 1
        return ProjectPrefilterRequest(
            token=token,
            seq=self.prefilter_request_seq,
            lg_path=lg_path,
            reason=reason,
            source_language=str(config.source_language),
            target_language=str(config.target_language),
            mtool_optimizer_enable=bool(config.mtool_optimizer_enable),
        )

    def pop_pending_request(self) -> ProjectPrefilterRequest | None:
        """弹出当前待处理的最新请求。"""

        with self.prefilter_cond:
            if not self.prefilter_pending:
                return None
            request = self.prefilter_latest_request
            self.prefilter_pending = False
            return request

    def mark_request_handled(self, request: ProjectPrefilterRequest) -> None:
        """记录某条请求已经处理完成。"""

        with self.prefilter_cond:
            self.prefilter_last_handled_seq = request.seq
            self.prefilter_cond.notify_all()

    def finish_worker(self) -> None:
        """结束当前 worker 生命周期。"""

        with self.prefilter_cond:
            self.prefilter_running = False
            self.prefilter_active_token = 0
            self.prefilter_cond.notify_all()

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
            target_language=request.target_language,
            mtool_optimizer_enable=request.mtool_optimizer_enable,
            progress_cb=progress_cb,
        )

        item_dicts: list[dict[str, Any]] = []
        for item in GapTool.iter(items):
            item_dicts.append(item.to_dict())

        meta = {
            "prefilter_config": result.prefilter_config,
            "source_language": request.source_language,
            "target_language": request.target_language,
            "analysis_extras": {},
            "analysis_state": {},
        }

        with self.session.state_lock:
            if self.session.db is None or self.session.lg_path != request.lg_path:
                return None

            self.batch_service.update_batch(items=item_dicts, meta=meta)
            self.session.db.delete_analysis_item_checkpoints()
            self.session.db.clear_analysis_task_observations()
            self.session.db.clear_analysis_candidate_aggregates()

        return result
