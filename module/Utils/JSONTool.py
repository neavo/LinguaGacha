import codecs
import json
from pathlib import Path
from typing import Any

import json_repair
import orjson


class JSONTool:
    """统一的 JSON 工具入口。

    - 序列化优先使用 orjson（更快）。
    - 反序列化在 orjson 失败时自动降级到标准库（应对外部数据兼容性差异）。
    - 支持使用 json_repair 修复损坏的 JSON。
    """

    @classmethod
    def loads(cls, obj: str | bytes) -> Any:
        """反序列化 JSON。"""
        if isinstance(obj, bytes) and obj.startswith(codecs.BOM_UTF8):
            obj = obj.removeprefix(codecs.BOM_UTF8)
        try:
            return orjson.loads(obj)
        except orjson.JSONDecodeError:
            # 外部数据兼容性差异（UTF-8 严格性/解析细节）时兜底到标准库
            return json.loads(obj)

    @classmethod
    def dumps(cls, obj: Any, *, indent: int = 0) -> str:
        """序列化为 JSON 文本。

        - indent=0: 紧凑格式（orjson）
        - indent=2: 2 空格缩进（orjson）
        - 其他: 指定空格缩进（标准库）
        """
        return cls.dumps_bytes(obj, indent=indent).decode("utf-8")

    @classmethod
    def dumps_bytes(cls, obj: Any, *, indent: int = 0) -> bytes:
        """序列化为 UTF-8 JSON bytes。

        约束：必须保证返回值可直接写入文件，避免孤立代理字符导致的编码失败。
        注意：孤立代理字符（如 \\ud800）会被转义为 \\\\ud800，读回时不会还原（有损但安全）。
        """
        if indent == 0:
            try:
                return orjson.dumps(obj)
            except TypeError as e:
                # orjson 对孤立代理（如 \ud800）会抛错，降级到标准库并转义写回
                try:
                    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
                except TypeError:
                    # 不是孤立代理问题，而是对象不可序列化，抛出原始异常
                    raise e from None
                return text.encode("utf-8", errors="backslashreplace")
        elif indent == 2:
            try:
                return orjson.dumps(obj, option=orjson.OPT_INDENT_2)
            except TypeError as e:
                try:
                    text = json.dumps(obj, ensure_ascii=False, indent=indent)
                except TypeError:
                    raise e from None
                return text.encode("utf-8", errors="backslashreplace")
        else:
            # 其他 indent 值走标准库，大多数情况能正常编码，仅在存在孤立代理时降级
            text = json.dumps(obj, ensure_ascii=False, indent=indent)
            try:
                return text.encode("utf-8")
            except UnicodeEncodeError:
                return text.encode("utf-8", errors="backslashreplace")

    @classmethod
    def repair_loads(cls, text: str) -> Any:
        """反序列化 JSON，失败后自动修复。"""
        try:
            return orjson.loads(text)
        except orjson.JSONDecodeError:
            return json_repair.loads(text, skip_json_loads=True)

    @classmethod
    def load_file(cls, path: str | Path) -> Any:
        """从文件读取并反序列化，统一按 bytes 读取，避免平台默认编码差异。"""

        with open(path, "rb") as f:
            content = f.read()

        return cls.loads(content)

    @classmethod
    def save_file(cls, path: str | Path, obj: Any, *, indent: int = 4) -> None:
        """写入对象为 JSON 文件，先完成序列化再写入，避免失败时文件被截断。"""
        # 先完成序列化再打开文件，避免序列化失败导致目标文件被截断/写入半截内容。
        data = cls.dumps_bytes(obj, indent=indent)

        # 写入文件
        with open(path, "wb") as f:
            f.write(data)
