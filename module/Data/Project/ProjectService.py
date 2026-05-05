from collections.abc import Callable
from pathlib import Path

from base.Base import Base
from base.LogManager import LogManager
from module.Config import Config
from module.Data.Storage.LGDatabase import LGDatabase
from module.File.FileManager import FileManager
from module.Localizer.Localizer import Localizer
from module.Utils.ZstdTool import ZstdTool

ProgressCallback = Callable[[int, int, str], None]


class ProjectService(Base):
    """工程创建/预览服务。"""

    # 支持的文件扩展名
    SUPPORTED_EXTENSIONS = {
        ".txt",
        ".md",
        ".json",
        ".xlsx",
        ".epub",
        ".ass",
        ".srt",
        ".rpy",
        ".trans",
    }

    def __init__(self) -> None:
        super().__init__()
        self.progress_callback: ProgressCallback | None = None

    def set_progress_callback(self, callback: ProgressCallback | None) -> None:
        self.progress_callback = callback

    def report_progress(self, current: int, total: int, message: str) -> None:
        if self.progress_callback is None:
            return
        self.progress_callback(current, total, message)

    def create(
        self,
        source_path: str,
        output_path: str,
        init_rules: Callable[[LGDatabase], list[str]] | None = None,
    ) -> list[str]:
        """创建工程并写入 assets/items/meta。

        返回：初始化成功加载的默认预设名称列表。
        """
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        if Path(output_path).exists():
            Path(output_path).unlink()

        project_name = Path(source_path).name
        db = LGDatabase.create(output_path, project_name)

        loaded_presets: list[str] = []
        if init_rules is not None:
            loaded_presets = init_rules(db)

        source_files = self.collect_source_files(source_path)
        total_files = len(source_files)

        self.report_progress(
            0, total_files, Localizer.get().project_store_ingesting_assets
        )

        config = Config().load()
        file_manager = FileManager(config)
        items: list[dict] = []

        for i, file_path in enumerate(source_files):
            rel_path = self.get_relative_path(source_path, file_path)

            try:
                with open(file_path, "rb") as f:
                    original_data = f.read()
            except Exception as e:
                LogManager.get().error(f"Failed to read source file - {file_path}", e)
                continue

            compressed = ZstdTool.compress(original_data)
            db.add_asset(rel_path, compressed, len(original_data))

            try:
                for item in file_manager.parse_asset(rel_path, original_data):
                    items.append(item.to_dict())
            except Exception as e:
                LogManager.get().error(f"Failed to parse asset - {rel_path}", e)

            self.report_progress(
                i + 1,
                total_files,
                Localizer.get().project_store_ingesting_file.format(
                    NAME=Path(file_path).name
                ),
            )

        self.report_progress(
            total_files, total_files, Localizer.get().project_store_parsing_items
        )

        if items:
            db.set_items(items)

        db.set_meta("source_language", str(config.source_language))
        db.set_meta("target_language", str(config.target_language))
        db.set_meta("mtool_optimizer_enable", bool(config.mtool_optimizer_enable))
        db.set_meta(
            "skip_duplicate_source_text_enable",
            bool(config.skip_duplicate_source_text_enable),
        )
        db.set_meta("translation_extras", self.build_empty_translation_extras())

        self.report_progress(
            total_files, total_files, Localizer.get().project_store_created
        )

        return loaded_presets

    def build_create_preview(self, source_path: str) -> dict[str, object]:
        """只解析源文件草稿，不创建 .lg，也不执行预过滤。"""

        source_files = self.collect_source_files(source_path)
        config = Config().load()
        file_manager = FileManager(config)
        files: list[dict[str, object]] = []
        items: list[dict[str, object]] = []
        next_item_id = 1

        for sort_index, file_path in enumerate(source_files):
            rel_path = self.get_relative_path(source_path, file_path)
            try:
                with open(file_path, "rb") as f:
                    original_data = f.read()
            except Exception as e:
                LogManager.get().error(f"Failed to read source file - {file_path}", e)
                continue

            parsed_items = []
            try:
                parsed_items = file_manager.parse_asset(rel_path, original_data)
            except Exception as e:
                LogManager.get().error(f"Failed to parse asset - {rel_path}", e)

            file_type = "NONE"
            for item in parsed_items:
                payload = item.to_dict()
                payload["id"] = next_item_id
                payload["file_path"] = str(
                    payload.get("file_path", rel_path) or rel_path
                )
                payload["file_type"] = str(payload.get("file_type", "NONE") or "NONE")
                file_type = str(payload["file_type"])
                items.append(payload)
                next_item_id += 1

            files.append(
                {
                    "rel_path": rel_path,
                    "file_type": file_type,
                    "sort_index": sort_index,
                }
            )

        return {
            "source_path": source_path,
            "files": files,
            "items": items,
            "section_revisions": {
                "files": 0,
                "items": 0,
                "analysis": 0,
            },
        }

    def commit_create_preview(
        self,
        *,
        source_path: str,
        output_path: str,
        files: list[dict[str, object]],
        items: list[dict[str, object]],
        project_settings: dict[str, object],
        translation_extras: dict[str, object],
        prefilter_config: dict[str, object],
        init_rules: Callable[[LGDatabase], list[str]] | None = None,
    ) -> list[str]:
        """把前端预过滤后的草稿事务化写成新工程。"""

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        if Path(output_path).exists():
            Path(output_path).unlink()

        project_name = Path(source_path).name
        db = LGDatabase.create(output_path, project_name)

        loaded_presets: list[str] = []
        if init_rules is not None:
            loaded_presets = init_rules(db)

        source_file_by_rel_path = {
            self.get_relative_path(source_path, file_path): file_path
            for file_path in self.collect_source_files(source_path)
        }

        with db.connection() as conn:
            for file_record in sorted(
                files,
                key=lambda record: int(record.get("sort_index", 0) or 0),
            ):
                rel_path = str(file_record.get("rel_path", "") or "")
                source_file_path = source_file_by_rel_path.get(rel_path)
                if source_file_path is None:
                    continue
                with open(source_file_path, "rb") as f:
                    original_data = f.read()
                compressed = ZstdTool.compress(original_data)
                db.add_asset(
                    rel_path,
                    compressed,
                    len(original_data),
                    sort_order=int(file_record.get("sort_index", 0) or 0),
                    conn=conn,
                )

            db.set_items(items, conn=conn)
            db.upsert_meta_entries(
                self.build_project_settings_meta(
                    project_settings=project_settings,
                    translation_extras=translation_extras,
                    prefilter_config=prefilter_config,
                ),
                conn=conn,
            )
            conn.commit()

        return loaded_presets

    def build_open_alignment_preview(
        self,
        lg_path: str,
        config: Config,
    ) -> dict[str, object]:
        """读取工程设置镜像并按当前应用设置决定打开前对齐动作。"""

        if not Path(lg_path).exists():
            raise FileNotFoundError(
                Localizer.get().project_store_file_not_found.format(PATH=lg_path)
            )

        db = LGDatabase(lg_path)
        meta = db.get_all_meta()
        prefilter_config = (
            meta.get("prefilter_config", {})
            if isinstance(meta.get("prefilter_config", {}), dict)
            else {}
        )
        mtool_missing = (
            "mtool_optimizer_enable" not in meta
            and "mtool_optimizer_enable" not in prefilter_config
        )
        skip_duplicate_source_text_missing = (
            "skip_duplicate_source_text_enable" not in meta
            and "skip_duplicate_source_text_enable" not in prefilter_config
        )
        current_settings = {
            "source_language": str(config.source_language),
            "target_language": str(config.target_language),
            "mtool_optimizer_enable": bool(config.mtool_optimizer_enable),
            "skip_duplicate_source_text_enable": bool(
                config.skip_duplicate_source_text_enable
            ),
        }
        project_settings = {
            "source_language": str(meta.get("source_language", "")),
            "target_language": str(meta.get("target_language", "")),
            "mtool_optimizer_enable": bool(
                meta.get(
                    "mtool_optimizer_enable",
                    prefilter_config.get("mtool_optimizer_enable", False),
                )
            ),
            "skip_duplicate_source_text_enable": bool(
                meta.get(
                    "skip_duplicate_source_text_enable",
                    prefilter_config.get("skip_duplicate_source_text_enable", True),
                )
            ),
        }
        source_changed = (
            project_settings["source_language"] != current_settings["source_language"]
        )
        target_changed = (
            project_settings["target_language"] != current_settings["target_language"]
        )
        mtool_changed = mtool_missing or (
            project_settings["mtool_optimizer_enable"]
            != current_settings["mtool_optimizer_enable"]
        )
        skip_duplicate_source_text_changed = (
            skip_duplicate_source_text_missing
            or project_settings["skip_duplicate_source_text_enable"]
            != current_settings["skip_duplicate_source_text_enable"]
        )
        action = "load"
        draft: dict[str, object] | None = None
        if source_changed or mtool_changed or skip_duplicate_source_text_changed:
            action = "prefiltered_items"
            draft = self.build_project_draft_from_db(db)
        elif target_changed:
            action = "settings_only"

        return {
            "action": action,
            "project_path": lg_path,
            "project_settings": project_settings,
            "current_settings": current_settings,
            "changed": {
                "source_language": source_changed,
                "target_language": target_changed,
                "mtool_optimizer_enable": mtool_changed,
                "skip_duplicate_source_text_enable": skip_duplicate_source_text_changed,
            },
            "draft": draft,
        }

    def apply_alignment_to_project_file(
        self,
        *,
        lg_path: str,
        mode: str,
        items: list[dict[str, object]],
        project_settings: dict[str, object],
        translation_extras: dict[str, object],
        prefilter_config: dict[str, object],
        expected_section_revisions: dict[str, int] | None,
    ) -> dict[str, object]:
        """打开前直接对齐 .lg，避免未进入 loaded 时把状态绕回内存会话。"""

        if not Path(lg_path).exists():
            raise FileNotFoundError(
                Localizer.get().project_store_file_not_found.format(PATH=lg_path)
            )

        db = LGDatabase(lg_path)
        if mode == "settings_only":
            db.upsert_meta_entries(
                self.build_project_settings_only_meta(project_settings=project_settings)
            )
            return self.build_alignment_file_ack(db, [])

        if mode != "prefiltered_items":
            raise ValueError("项目设置对齐模式无效")

        self.assert_expected_file_revisions(
            db,
            expected_section_revisions,
            ("items", "analysis"),
        )
        normalized_items = self.normalize_project_items(items)
        next_item_revision = self.get_file_section_revision(db, "items") + 1
        next_analysis_revision = self.get_file_section_revision(db, "analysis") + 1
        normalized_meta = {
            **self.build_project_settings_meta(
                project_settings=project_settings,
                translation_extras=translation_extras,
                prefilter_config=prefilter_config,
            ),
            "project_runtime_revision.items": next_item_revision,
            "project_runtime_revision.analysis": next_analysis_revision,
        }

        with db.connection() as conn:
            db.set_items(normalized_items, conn=conn)
            db.upsert_meta_entries(normalized_meta, conn=conn)
            db.delete_analysis_item_checkpoints(conn=conn)
            db.clear_analysis_candidate_aggregates(conn=conn)
            conn.commit()

        return {
            "accepted": True,
            "projectRevision": max(next_item_revision, next_analysis_revision),
            "sectionRevisions": {
                "items": next_item_revision,
                "analysis": next_analysis_revision,
            },
        }

    def build_project_draft_from_db(self, db: LGDatabase) -> dict[str, object]:
        asset_records = db.get_all_asset_records()
        items = db.get_all_items()
        file_type_by_path: dict[str, str] = {}
        for item in items:
            rel_path = str(item.get("file_path", "") or "")
            if rel_path == "":
                continue
            file_type_by_path[rel_path] = str(item.get("file_type", "NONE") or "NONE")

        return {
            "files": [
                {
                    "rel_path": str(record.get("path", "") or ""),
                    "file_type": file_type_by_path.get(
                        str(record.get("path", "") or ""),
                        "NONE",
                    ),
                    "sort_index": int(record.get("sort_order", 0) or 0),
                }
                for record in asset_records
            ],
            "items": items,
            "section_revisions": {
                "files": int(
                    db.get_meta(
                        "project_runtime_revision.files",
                        0,
                    )
                    or 0
                ),
                "items": int(
                    db.get_meta(
                        "project_runtime_revision.items",
                        0,
                    )
                    or 0
                ),
                "analysis": int(
                    db.get_meta(
                        "project_runtime_revision.analysis",
                        0,
                    )
                    or 0
                ),
            },
        }

    def build_project_settings_meta(
        self,
        *,
        project_settings: dict[str, object],
        translation_extras: dict[str, object],
        prefilter_config: dict[str, object],
    ) -> dict[str, object]:
        normalized_prefilter_config = dict(prefilter_config)
        normalized_prefilter_config["source_language"] = str(
            project_settings.get("source_language", "") or ""
        )
        normalized_prefilter_config["mtool_optimizer_enable"] = bool(
            project_settings.get("mtool_optimizer_enable", False)
        )
        normalized_prefilter_config["skip_duplicate_source_text_enable"] = bool(
            project_settings.get("skip_duplicate_source_text_enable", True)
        )

        return {
            "source_language": str(project_settings.get("source_language", "") or ""),
            "target_language": str(project_settings.get("target_language", "") or ""),
            "mtool_optimizer_enable": bool(
                project_settings.get("mtool_optimizer_enable", False)
            ),
            "skip_duplicate_source_text_enable": bool(
                project_settings.get("skip_duplicate_source_text_enable", True)
            ),
            "prefilter_config": normalized_prefilter_config,
            "translation_extras": dict(translation_extras),
            "analysis_extras": {},
            "analysis_candidate_count": 0,
        }

    def build_project_settings_only_meta(
        self,
        *,
        project_settings: dict[str, object],
    ) -> dict[str, object]:
        return {
            "source_language": str(project_settings.get("source_language", "") or ""),
            "target_language": str(project_settings.get("target_language", "") or ""),
            "mtool_optimizer_enable": bool(
                project_settings.get("mtool_optimizer_enable", False)
            ),
            "skip_duplicate_source_text_enable": bool(
                project_settings.get("skip_duplicate_source_text_enable", True)
            ),
        }

    def get_file_section_revision(self, db: LGDatabase, section: str) -> int:
        raw_revision = db.get_meta(f"project_runtime_revision.{section}", 0)
        try:
            revision = int(raw_revision)
        except TypeError:
            return 0
        except ValueError:
            return 0
        return max(0, revision)

    def assert_expected_file_revisions(
        self,
        db: LGDatabase,
        expected_section_revisions: dict[str, int] | None,
        sections: tuple[str, ...],
    ) -> None:
        if expected_section_revisions is None:
            return

        for section in sections:
            if section not in expected_section_revisions:
                continue
            current_revision = self.get_file_section_revision(db, section)
            expected_revision = int(expected_section_revisions[section])
            if current_revision != expected_revision:
                raise ValueError(
                    "运行态 revision 冲突："
                    f"section={section} 当前={current_revision} 期望={expected_revision}"
                )

    def build_alignment_file_ack(
        self,
        db: LGDatabase,
        updated_sections: list[str],
    ) -> dict[str, object]:
        section_revisions = {
            section: self.get_file_section_revision(db, section)
            for section in updated_sections
        }
        project_revision = max(section_revisions.values(), default=0)
        return {
            "accepted": True,
            "projectRevision": project_revision,
            "sectionRevisions": section_revisions,
        }

    def normalize_project_items(
        self,
        items: list[dict[str, object]],
    ) -> list[dict[str, object]]:
        normalized_items: list[dict[str, object]] = []
        for item in items:
            raw_item_id = item.get("id", item.get("item_id"))
            try:
                item_id = int(raw_item_id)
            except TypeError:
                continue
            except ValueError:
                continue
            if item_id <= 0:
                continue

            normalized_items.append(
                {
                    "id": item_id,
                    "src": str(item.get("src", "") or ""),
                    "dst": str(item.get("dst", "") or ""),
                    "name_src": item.get("name_src"),
                    "name_dst": item.get("name_dst"),
                    "extra_field": item.get("extra_field", ""),
                    "tag": str(item.get("tag", "") or ""),
                    "row": int(item.get("row", item.get("row_number", 0)) or 0),
                    "file_type": str(item.get("file_type", "NONE") or "NONE"),
                    "file_path": str(item.get("file_path", "") or ""),
                    "text_type": str(item.get("text_type", "NONE") or "NONE"),
                    "status": str(item.get("status", Base.ItemStatus.NONE.value) or ""),
                    "retry_count": int(item.get("retry_count", 0) or 0),
                }
            )
        return normalized_items

    def build_empty_translation_extras(self) -> dict[str, int]:
        return {
            "total_line": 0,
            "line": 0,
            "total_tokens": 0,
            "total_input_tokens": 0,
            "total_output_tokens": 0,
            "time": 0,
        }

    def collect_source_files(self, source_path: str) -> list[str]:
        path_obj = Path(source_path)
        if path_obj.is_file():
            return [source_path] if self.is_supported_file(source_path) else []

        return [
            str(f)
            for f in path_obj.rglob("*")
            if f.is_file() and self.is_supported_file(str(f))
        ]

    def is_supported_file(self, file_path: str) -> bool:
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def get_relative_path(self, base_path: str, file_path: str) -> str:
        return (
            Path(file_path).name
            if Path(base_path).is_file()
            else str(Path(file_path).relative_to(base_path))
        )

    def get_project_preview(self, lg_path: str) -> dict:
        """获取工程预览信息（不完全加载）。"""
        if not Path(lg_path).exists():
            raise FileNotFoundError(
                Localizer.get().project_store_file_not_found.format(PATH=lg_path)
            )

        db = LGDatabase(lg_path)
        return db.get_project_summary()
