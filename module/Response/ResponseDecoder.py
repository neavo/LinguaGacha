from base.Base import Base
from module.Utils.JSONTool import JSONTool


class ResponseDecoder(Base):
    """统一解码模型回复里的翻译结果和术语条目。"""

    def __init__(self) -> None:
        super().__init__()

    def get_glossary_info_key(self, json_data: dict) -> str:
        """术语信息字段当前只接受分析链路使用的 type。"""
        if all(v in json_data for v in ("src", "dst", "type")):
            return "type"
        return ""

    def get_translation_text(self, json_data: dict) -> str | None:
        """单键字典沿用旧口径，继续视为翻译结果行。"""
        if len(json_data) != 1:
            return None

        value = next(iter(json_data.values()))
        if isinstance(value, str):
            return value
        return None

    def build_glossary_entry(self, json_data: dict) -> dict[str, str] | None:
        """三字段字典视为术语条目，统一归一成 src/dst/info。"""
        if len(json_data) != 3:
            return None

        glossary_info_key = self.get_glossary_info_key(json_data)
        if glossary_info_key == "":
            return None

        src = json_data.get("src")
        dst = json_data.get("dst")
        info = json_data.get(glossary_info_key)
        return {
            "src": src if isinstance(src, str) else "",
            "dst": dst if isinstance(dst, str) else "",
            "info": info if isinstance(info, str) else "",
        }

    def decode(self, response: str) -> tuple[list[str], list[dict[str, str]]]:
        """按行抽取 JSONLINE，避免不同任务各自维护一套近似逻辑。"""
        dsts: list[str] = []
        glossary: list[dict[str, str]] = []

        # 逐行吃掉可解析的 JSON，对代码块标记和杂质文本天然保持宽容。
        for line in response.splitlines():
            stripped_line = line.strip()
            if not stripped_line:
                continue

            json_data = JSONTool.repair_loads(stripped_line)
            if not isinstance(json_data, dict):
                continue

            translation_text = self.get_translation_text(json_data)
            if translation_text is not None:
                dsts.append(translation_text)
                continue

            glossary_entry = self.build_glossary_entry(json_data)
            if glossary_entry is not None:
                glossary.append(glossary_entry)

        # 纯 JSON 对象回复常见于退化场景，这里保留旧回退逻辑兜底翻译结果。
        if not dsts:
            json_data = JSONTool.repair_loads(response)
            if isinstance(json_data, dict):
                for value in json_data.values():
                    if isinstance(value, str):
                        dsts.append(value)

        return dsts, glossary
