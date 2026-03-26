from __future__ import annotations

import re
import threading
from collections.abc import Callable
from typing import Any

from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.Engine import Engine
from module.Localizer.Localizer import Localizer


class NameFieldExtractionService:
    """把姓名字段提取、翻译与术语表写入收口到数据层。"""

    def __init__(
        self,
        data_manager_getter: Callable[[], Any] | None = None,
        engine_getter: Callable[[], Any] | None = None,
        config_loader: Callable[[], Any] | None = None,
    ) -> None:
        self.data_manager_getter = (
            data_manager_getter if data_manager_getter is not None else DataManager.get
        )
        self.engine_getter = engine_getter if engine_getter is not None else Engine.get
        self.config_loader = config_loader if config_loader is not None else Config

    def get_name_field_snapshot(self) -> dict[str, object]:
        """统一提供姓名字段快照入口，避免上层重复决定取数方式。"""

        return self.extract_name_fields()

    def extract_name_fields(self) -> dict[str, object]:
        """从工程条目提取唯一姓名，并优先保留最长上下文。"""

        data_manager = self.data_manager_getter()
        if not data_manager.is_loaded():
            return {"items": []}

        glossary_map = self.build_glossary_map(data_manager.get_glossary())
        best_context_by_name: dict[str, str] = {}

        for item in data_manager.get_all_items():
            context = str(item.get_src()).strip()
            if context == "":
                continue

            for name in self.collect_names(item.get_name_src()):
                existing_context = best_context_by_name.get(name, "")
                if len(context) > len(existing_context):
                    best_context_by_name[name] = context

        extracted_items: list[dict[str, str]] = []
        for name in sorted(best_context_by_name):
            dst = glossary_map.get(name, "")
            extracted_items.append(
                self.build_name_field_item(
                    src=name,
                    dst=dst,
                    context=best_context_by_name[name],
                )
            )

        return {"items": extracted_items}

    def translate_name_fields(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        """按整表请求翻译姓名草稿，并返回完整结果与统计。"""

        translated_items = [self.normalize_item(item) for item in items]
        indexes_to_translate = [
            index
            for index, item in enumerate(translated_items)
            if item["src"] != "" and item["dst"] == ""
        ]
        if indexes_to_translate == []:
            return {
                "items": translated_items,
                "success_count": 0,
                "failed_count": 0,
            }

        config = self.config_loader().load()
        if str(getattr(config, "activate_model_id", "")) == "":
            self.mark_items_failed(translated_items, indexes_to_translate)
            return {
                "items": translated_items,
                "success_count": 0,
                "failed_count": len(indexes_to_translate),
            }

        engine = self.engine_getter()
        success_count = 0
        failed_count = 0

        for index in indexes_to_translate:
            translated_name = self.translate_single_name(
                engine, config, translated_items[index]
            )
            if translated_name != "":
                translated_items[index]["dst"] = translated_name
                translated_items[index]["status"] = (
                    Localizer.get().proofreading_page_status_processed
                )
                success_count += 1
            else:
                translated_items[index]["status"] = (
                    Localizer.get().proofreading_page_status_error
                )
                failed_count += 1

        return {
            "items": translated_items,
            "success_count": success_count,
            "failed_count": failed_count,
        }

    def save_name_fields_to_glossary(
        self,
        items: list[dict[str, object]],
    ) -> dict[str, object]:
        """把当前草稿整表并入术语表，避免页面继续直接操作数据层。"""

        normalized_items = [self.normalize_item(item) for item in items]
        data_manager = self.data_manager_getter()
        if not data_manager.is_loaded():
            return {"items": normalized_items}

        glossary_map = {
            str(entry.get("src", "")).strip(): dict(entry)
            for entry in data_manager.get_glossary()
            if str(entry.get("src", "")).strip() != ""
        }
        for item in normalized_items:
            src = item["src"]
            dst = item["dst"]
            if src == "" or dst == "":
                continue

            existing = glossary_map.get(src)
            if existing is None:
                glossary_map[src] = {
                    "src": src,
                    "dst": dst,
                    "info": "",
                    "case_sensitive": False,
                }
            else:
                existing["dst"] = dst
                if "info" not in existing:
                    existing["info"] = ""
                if "case_sensitive" not in existing:
                    existing["case_sensitive"] = False
                glossary_map[src] = existing

        merged_glossary = [glossary_map[key] for key in sorted(glossary_map)]
        data_manager.set_glossary(merged_glossary)
        return {"items": normalized_items}

    def collect_names(self, value: str | list[str] | None) -> tuple[str, ...]:
        """统一把单个或多个姓名输入归一化，避免同名草稿重复进入结果。"""

        names: list[str] = []
        if isinstance(value, str):
            normalized_name = value.strip()
            if normalized_name != "":
                names.append(normalized_name)
        elif isinstance(value, list):
            for raw_name in value:
                normalized_name = str(raw_name).strip()
                if normalized_name != "" and normalized_name not in names:
                    names.append(normalized_name)
        return tuple(names)

    def build_glossary_map(
        self,
        glossary_entries: list[dict[str, Any]],
    ) -> dict[str, str]:
        """把术语表裁剪成名字到译文的映射，保证提取与保存走同一来源。"""

        glossary_map: dict[str, str] = {}
        for entry in glossary_entries:
            src = str(entry.get("src", "")).strip()
            if src == "":
                continue
            glossary_map[src] = str(entry.get("dst", "")).strip()
        return glossary_map

    def build_name_field_item(
        self,
        *,
        src: str,
        dst: str,
        context: str,
    ) -> dict[str, str]:
        """统一生成姓名草稿，避免不同入口给出不一致状态字段。"""

        status = Localizer.get().proofreading_page_status_none
        if dst != "":
            status = Localizer.get().proofreading_page_status_processed
        return {
            "src": src,
            "dst": dst,
            "context": context,
            "status": status,
        }

    def normalize_item(self, item: dict[str, object]) -> dict[str, str]:
        """统一整表回写项的字段结构，避免 API 与页面各自补默认值。"""

        return {
            "src": str(item.get("src", "")).strip(),
            "dst": str(item.get("dst", "")).strip(),
            "context": str(item.get("context", "")).strip(),
            "status": str(item.get("status", "")).strip(),
        }

    def mark_items_failed(
        self, items: list[dict[str, str]], indexes: list[int]
    ) -> None:
        """当没有可用模型时统一标记失败，避免页面继续窥探配置状态。"""

        for index in indexes:
            items[index]["status"] = Localizer.get().proofreading_page_status_error

    def translate_single_name(
        self,
        engine: Any,
        config: Config,
        item: dict[str, str],
    ) -> str:
        """复用单条翻译接口，并把结果收敛为姓名字段需要的最终译名。"""

        prompt_item = Item()
        prompt_item.set_src(f"【{item['src']}】\n{item['context']}")
        prompt_item.set_file_type(Item.FileType.TXT)
        prompt_item.set_text_type(Item.TextType.NONE)

        finished = threading.Event()
        result_state: dict[str, object] = {"success": False, "item": None}

        def callback(result_item: Item, success: bool) -> None:
            result_state["success"] = success
            result_state["item"] = result_item
            finished.set()

        engine.translate_single_item(prompt_item, config, callback)
        finished.wait()

        result_item = result_state["item"]
        if not result_state["success"] or not isinstance(result_item, Item):
            return ""

        return self.extract_name_from_response(result_item.get_dst(), item["src"])

    def extract_name_from_response(self, raw_dst: str, src_name: str) -> str:
        """兼容旧页面的姓名解析规则，避免本轮迁移顺手改变翻译结果。"""

        match = re.search(r"【(.*?)】", raw_dst)
        if match is not None:
            return match.group(1).strip()

        if len(raw_dst) < len(src_name) * 3 + 10:
            return raw_dst.strip()
        return ""
