import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from base.Base import Base
from module.Config import Config
from module.Localizer.Localizer import Localizer
from module.Data.Database.DatabaseGateway import DatabaseGateway

ProgressCallback = Callable[[int, int, str], None]


@dataclass(frozen=True)
class ProjectSourceFile:
    # 工程创建链路中的源文件快照，固定住原始路径与工程内相对路径。

    source_path: str
    rel_path: str


class ProjectService(Base):
    # 工程创建/预览服务。

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
        init_rules: Callable[[DatabaseGateway], list[str]] | None = None,
    ) -> list[str]:
        # 创建工程并写入 assets/items/meta。
        # 返回：初始化成功加载的默认预设名称列表。
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)

        if Path(output_path).exists():
            Path(output_path).unlink()

        project_name = Path(source_path).name
        db = DatabaseGateway.create(output_path, project_name)

        loaded_presets: list[str] = []
        if init_rules is not None:
            loaded_presets = init_rules(db)

        source_files = self.collect_source_files(source_path)
        total_files = len(source_files)

        self.report_progress(
            0, total_files, Localizer.get().project_store_ingesting_assets
        )

        config = Config().load()
        items: list[dict] = []

        for i, file_path in enumerate(source_files):
            rel_path = self.get_relative_path(source_path, file_path)

            # .lg asset 压缩由 TS database 持有，Python 只提交源路径。
            db.add_asset_from_source(rel_path, file_path)

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

    def build_create_preview(
        self,
        source_paths: list[str],
    ) -> dict[str, object]:
        # 只构建源文件草稿，不创建 .lg，也不执行预过滤。

        effective_source_paths = self.normalize_source_paths(source_paths)
        source_files = self.collect_source_file_entries(effective_source_paths)
        files: list[dict[str, object]] = []
        items: list[dict[str, object]] = []

        for sort_index, source_file in enumerate(source_files):
            rel_path = source_file.rel_path
            file_type = "NONE"

            files.append(
                {
                    "rel_path": rel_path,
                    "file_type": file_type,
                    "sort_index": sort_index,
                    "source_path": source_file.source_path,
                }
            )

        return {
            "source_paths": effective_source_paths,
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
        source_paths: list[str],
        output_path: str,
        files: list[dict[str, object]],
        items: list[dict[str, object]],
        project_settings: dict[str, object],
        translation_extras: dict[str, object],
        prefilter_config: dict[str, object],
        init_rules: Callable[[DatabaseGateway], list[str]] | None = None,
    ) -> list[str]:
        # 把前端预过滤后的草稿事务化写成新工程。

        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        if Path(output_path).exists():
            Path(output_path).unlink()

        effective_source_paths = self.normalize_source_paths(source_paths)
        project_name_seed = (
            effective_source_paths[0] if effective_source_paths else output_path
        )
        project_name = Path(project_name_seed).name
        db = DatabaseGateway.create(output_path, project_name)

        loaded_presets: list[str] = []
        if init_rules is not None:
            loaded_presets = init_rules(db)

        with db.connection() as conn:
            for file_record in sorted(
                files,
                key=lambda record: int(record.get("sort_index", 0) or 0),
            ):
                rel_path = str(file_record.get("rel_path", "") or "")
                source_file_path = str(file_record.get("source_path", "") or "")
                if source_file_path == "":
                    continue
                # source_path 只穿过网关给 TS database，Python 不再持有 .lg asset 压缩细节。
                db.add_asset_from_source(
                    rel_path,
                    source_file_path,
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
        # 读取工程设置镜像并按当前应用设置决定打开前对齐动作。

        if not Path(lg_path).exists():
            raise FileNotFoundError(
                Localizer.get().project_store_file_not_found.format(PATH=lg_path)
            )

        db = DatabaseGateway(lg_path)
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

    def build_project_draft_from_db(self, db: DatabaseGateway) -> dict[str, object]:
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

    def normalize_source_paths(self, source_paths: list[str]) -> list[str]:
        normalized_paths: list[str] = []
        seen_keys: set[str] = set()

        for source_path in source_paths:
            normalized_path = str(source_path).strip()
            if normalized_path == "":
                continue
            path_key = self.build_path_identity_key(normalized_path)
            if path_key in seen_keys:
                continue
            seen_keys.add(path_key)
            normalized_paths.append(normalized_path)

        return normalized_paths

    def collect_source_files_from_paths(self, source_paths: list[str]) -> list[str]:
        # 按用户选择顺序收集多个源路径下可导入的源文件。

        return [
            source_file.source_path
            for source_file in self.collect_source_file_entries(
                self.normalize_source_paths(source_paths)
            )
        ]

    def collect_source_file_entries(
        self,
        source_paths: list[str],
    ) -> list[ProjectSourceFile]:
        normalized_source_paths = self.normalize_source_paths(source_paths)
        source_file_candidates: list[ProjectSourceFile] = []
        seen_file_keys: set[str] = set()

        for normalized_source_path in normalized_source_paths:
            for source_file in self.collect_source_files(normalized_source_path):
                file_key = self.build_path_identity_key(source_file)
                if file_key in seen_file_keys:
                    continue
                seen_file_keys.add(file_key)
                source_file_candidates.append(
                    ProjectSourceFile(
                        source_path=source_file,
                        rel_path=self.build_source_relative_path(
                            source_root=normalized_source_path,
                            source_file=source_file,
                        ),
                    )
                )

        used_rel_paths: set[str] = set()
        source_files: list[ProjectSourceFile] = []

        for index, source_file in enumerate(source_file_candidates):
            unique_rel_path = self.build_unique_relative_path(
                rel_path=source_file.rel_path,
                used_rel_paths=used_rel_paths,
                source_index=index,
            )
            source_files.append(
                ProjectSourceFile(
                    source_path=source_file.source_path,
                    rel_path=unique_rel_path,
                )
            )

        return source_files

    def build_path_identity_key(self, source_path: str) -> str:
        return os.path.normcase(str(Path(source_path).resolve(strict=False)))

    def build_relative_path_identity_key(self, rel_path: str) -> str:
        return rel_path.replace("\\", "/").casefold()

    def build_source_relative_path(
        self,
        *,
        source_root: str,
        source_file: str,
    ) -> str:
        source_root_path = Path(source_root)
        if source_root_path.is_file():
            return Path(source_file).name

        try:
            return str(Path(source_file).relative_to(source_root_path))
        except ValueError:
            return Path(source_file).name

    def build_unique_relative_path(
        self,
        *,
        rel_path: str,
        used_rel_paths: set[str],
        source_index: int,
    ) -> str:
        rel_path_key = self.build_relative_path_identity_key(rel_path)
        if rel_path_key not in used_rel_paths:
            used_rel_paths.add(rel_path_key)
            return rel_path

        rel_path_obj = Path(rel_path)
        parent_path = rel_path_obj.parent
        stem = rel_path_obj.stem
        suffix = rel_path_obj.suffix
        unique_index = source_index + 1

        while True:
            candidate_name = f"{stem}_{unique_index}{suffix}"
            candidate_path = (
                candidate_name
                if str(parent_path) == "."
                else str(parent_path / candidate_name)
            )
            candidate_path_key = self.build_relative_path_identity_key(candidate_path)
            if candidate_path_key not in used_rel_paths:
                used_rel_paths.add(candidate_path_key)
                return candidate_path
            unique_index += 1

    def is_supported_file(self, file_path: str) -> bool:
        ext = Path(file_path).suffix.lower()
        return ext in self.SUPPORTED_EXTENSIONS

    def get_relative_path(self, base_path: str, file_path: str) -> str:
        return (
            Path(file_path).name
            if Path(base_path).is_file()
            else str(Path(file_path).relative_to(base_path))
        )
