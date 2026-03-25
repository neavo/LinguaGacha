from __future__ import annotations

from pathlib import Path
from typing import Any

from module.PromptPathResolver import PromptPathResolver


class PromptService:
    """提示词业务服务。

    这个服务把提示词文本、revision、导入导出与预设读写收口到一起，
    让 UI 只和一个稳定入口交互。
    """

    REVISION_META_KEY_PREFIX: str = "quality_prompt_revision"

    def __init__(self, quality_rule_service: Any, meta_service: Any) -> None:
        self.quality_rule_service = quality_rule_service
        self.meta_service = meta_service

    def _get_state_lock(self) -> Any:
        """复用工程会话锁，让 revision 检查、写入和 bump 处于同一临界区。"""

        return self.meta_service.session.state_lock

    @classmethod
    def normalize_task_type(
        cls,
        task_type: str | PromptPathResolver.TaskType,
    ) -> PromptPathResolver.TaskType:
        """把外部输入统一收口到提示词任务枚举。"""

        if isinstance(task_type, PromptPathResolver.TaskType):
            normalized_task_type = task_type
        else:
            normalized_task_type = PromptPathResolver.TaskType(str(task_type))
        return normalized_task_type

    @classmethod
    def build_revision_meta_key(
        cls,
        task_type: str | PromptPathResolver.TaskType,
    ) -> str:
        """统一生成提示词 revision 键，避免读写两边各自拼接。"""

        normalized_task_type = cls.normalize_task_type(task_type)
        return f"{cls.REVISION_META_KEY_PREFIX}.{normalized_task_type.value}"

    def get_revision(self, task_type: str | PromptPathResolver.TaskType) -> int:
        """读取提示词 revision。"""

        revision_key = self.build_revision_meta_key(task_type)
        raw_revision = self.meta_service.get_meta(revision_key, 0)
        if isinstance(raw_revision, int):
            revision = raw_revision
        else:
            try:
                revision = int(raw_revision)
            except TypeError, ValueError:
                revision = 0
        if revision < 0:
            revision = 0
        return revision

    def _assert_revision(
        self,
        task_type: str | PromptPathResolver.TaskType,
        expected_revision: int,
    ) -> None:
        """在写提示词前做 revision 校验，避免旧版本覆盖新内容。"""

        current_revision = self.get_revision(task_type)
        if expected_revision != current_revision:
            raise RuntimeError(
                f"提示词 revision 冲突：当前={current_revision}，期望={expected_revision}"
            )

    def _bump_revision(
        self,
        task_type: str | PromptPathResolver.TaskType,
        current_revision: int,
    ) -> int:
        """写提示词成功后推进 revision。"""

        new_revision = current_revision + 1
        revision_key = self.build_revision_meta_key(task_type)
        self.meta_service.set_meta(revision_key, new_revision)
        return new_revision

    def _read_prompt_text(
        self,
        task_type: PromptPathResolver.TaskType,
    ) -> str:
        """读取指定任务的当前提示词文本。"""

        if task_type == PromptPathResolver.TaskType.TRANSLATION:
            text = self.quality_rule_service.get_translation_prompt()
        else:
            text = self.quality_rule_service.get_analysis_prompt()
        return text

    def _write_prompt_text(
        self,
        task_type: PromptPathResolver.TaskType,
        text: str,
    ) -> None:
        """把提示词文本写回底层服务。"""

        if task_type == PromptPathResolver.TaskType.TRANSLATION:
            self.quality_rule_service.set_translation_prompt(text)
        else:
            self.quality_rule_service.set_analysis_prompt(text)

    def _read_prompt_enabled(
        self,
        task_type: PromptPathResolver.TaskType,
    ) -> bool:
        """读取提示词启用状态。"""

        if task_type == PromptPathResolver.TaskType.TRANSLATION:
            enabled = self.quality_rule_service.get_translation_prompt_enable()
        else:
            enabled = self.quality_rule_service.get_analysis_prompt_enable()
        return bool(enabled)

    def _write_prompt_enabled(
        self,
        task_type: PromptPathResolver.TaskType,
        enabled: bool,
    ) -> None:
        """写回提示词启用状态。"""

        if task_type == PromptPathResolver.TaskType.TRANSLATION:
            self.quality_rule_service.set_translation_prompt_enable(enabled)
        else:
            self.quality_rule_service.set_analysis_prompt_enable(enabled)

    def _build_prompt_snapshot_payload(
        self,
        task_type: PromptPathResolver.TaskType,
    ) -> dict[str, object]:
        """在已持有锁的前提下构建提示词快照，供读写路径复用。"""

        text = self._read_prompt_text(task_type)
        meta = {"enabled": self._read_prompt_enabled(task_type)}
        return {
            "task_type": task_type.value,
            "revision": self.get_revision(task_type),
            "meta": meta,
            "text": text,
        }

    def get_prompt_snapshot(
        self,
        task_type: str | PromptPathResolver.TaskType,
    ) -> dict[str, object]:
        """读取提示词文本、启用状态与 revision。"""

        normalized_task_type = self.normalize_task_type(task_type)
        with self._get_state_lock():
            return self._build_prompt_snapshot_payload(normalized_task_type)

    def save_prompt(
        self,
        task_type: str | PromptPathResolver.TaskType,
        *,
        expected_revision: int,
        text: str,
        enabled: bool | None = None,
    ) -> dict[str, object]:
        """保存提示词文本，并可选同步启用状态。"""

        normalized_task_type = self.normalize_task_type(task_type)
        with self._get_state_lock():
            self._assert_revision(normalized_task_type, expected_revision)
            current_revision = self.get_revision(normalized_task_type)
            self._write_prompt_text(normalized_task_type, text)
            if enabled is not None:
                self._write_prompt_enabled(normalized_task_type, bool(enabled))
            self._bump_revision(normalized_task_type, current_revision)
            snapshot = self._build_prompt_snapshot_payload(normalized_task_type)
        return snapshot

    def export_prompt(
        self,
        task_type: str | PromptPathResolver.TaskType,
        path: str | Path,
    ) -> str:
        """把当前提示词导出为纯文本文件。"""

        normalized_task_type = self.normalize_task_type(task_type)
        export_path = Path(path)
        if export_path.suffix.lower() != ".txt":
            if export_path.suffix == "":
                export_path = Path(f"{export_path}.txt")
            else:
                export_path = export_path.with_suffix(".txt")
        export_path.write_text(
            self._read_prompt_text(normalized_task_type).strip(),
            encoding="utf-8",
        )
        return export_path.as_posix()

    def import_prompt(
        self,
        task_type: str | PromptPathResolver.TaskType,
        path: str | Path,
        *,
        expected_revision: int,
        enabled: bool | None = None,
    ) -> dict[str, object]:
        """从纯文本文件导入提示词，并复用保存逻辑。"""

        import_path = Path(path)
        text = import_path.read_text(encoding="utf-8-sig").strip()
        return self.save_prompt(
            task_type,
            expected_revision=expected_revision,
            text=text,
            enabled=enabled,
        )

    def list_presets(
        self,
        task_type: str | PromptPathResolver.TaskType,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        """列出提示词预设。"""

        normalized_task_type = self.normalize_task_type(task_type)
        return PromptPathResolver.list_presets(normalized_task_type)

    def read_preset(
        self,
        task_type: str | PromptPathResolver.TaskType,
        virtual_id: str,
    ) -> str:
        """读取指定提示词预设文本。"""

        normalized_task_type = self.normalize_task_type(task_type)
        return PromptPathResolver.read_preset(normalized_task_type, virtual_id)

    def save_user_preset(
        self,
        task_type: str | PromptPathResolver.TaskType,
        name: str,
        text: str,
    ) -> str:
        """保存用户提示词预设。"""

        normalized_task_type = self.normalize_task_type(task_type)
        return PromptPathResolver.save_user_preset(normalized_task_type, name, text)

    def rename_user_preset(
        self,
        task_type: str | PromptPathResolver.TaskType,
        virtual_id: str,
        new_name: str,
    ) -> dict[str, str]:
        """重命名用户提示词预设。"""

        normalized_task_type = self.normalize_task_type(task_type)
        return PromptPathResolver.rename_user_preset(
            normalized_task_type,
            virtual_id,
            new_name,
        )

    def delete_user_preset(
        self,
        task_type: str | PromptPathResolver.TaskType,
        virtual_id: str,
    ) -> str:
        """删除用户提示词预设。"""

        normalized_task_type = self.normalize_task_type(task_type)
        return PromptPathResolver.delete_user_preset(normalized_task_type, virtual_id)

    def get_default_preset_text(
        self,
        task_type: str | PromptPathResolver.TaskType,
        virtual_id: str,
    ) -> str:
        """读取默认预设文本，供配置初始化复用。"""

        normalized_task_type = self.normalize_task_type(task_type)
        return PromptPathResolver.get_default_preset_text(
            normalized_task_type, virtual_id
        )
