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
        if indent == 0:
            return orjson.dumps(obj).decode("utf-8")
        elif indent == 2:
            return orjson.dumps(obj, option=orjson.OPT_INDENT_2).decode("utf-8")
        else:
            return json.dumps(obj, ensure_ascii=False, indent=indent)

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
        """写入对象为 JSON 文件。

        性能路径：
        - indent=0: orjson 紧凑模式，直接写入 bytes（最快）
        - indent=2: orjson 2空格缩进，直接写入 bytes（次快）
        - indent=4: 标准库 json.dump 直接写入文件对象（兼容性）
        """
        if indent == 0:
            # 紧凑模式：orjson 直接写 bytes，避免编解码开销
            with open(path, "wb") as f:
                f.write(orjson.dumps(obj))
        elif indent == 2:
            # 2空格缩进：orjson 直接写 bytes
            with open(path, "wb") as f:
                f.write(orjson.dumps(obj, option=orjson.OPT_INDENT_2))
        else:
            # 其他缩进：标准库直接写入文件对象，避免中间字符串
            with open(path, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False, indent=indent)
