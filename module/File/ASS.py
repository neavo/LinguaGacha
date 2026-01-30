import os

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Text.TextHelper import TextHelper


class ASS(Base):
    # [Script Info]
    # ; This is an Advanced Sub Station Alpha v4+ script.
    # Title:
    # ScriptType: v4.00+
    # PlayDepth: 0
    # ScaledBorderAndShadow: Yes

    # [V4+ Styles]
    # Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
    # Style: Default,Arial,20,&H00FFFFFF,&H0000FFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,1,2,10,10,10,1

    # [Events]
    # Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    # Dialogue: 0,0:00:08.12,0:00:10.46,Default,,0,0,0,,にゃにゃにゃ
    # Dialogue: 0,0:00:14.00,0:00:15.88,Default,,0,0,0,,えーこの部屋一人で使\Nえるとか最高じゃん
    # Dialogue: 0,0:00:15.88,0:00:17.30,Default,,0,0,0,,えるとか最高じゃん

    def __init__(self, config: Config) -> None:
        super().__init__()

        # 初始化
        self.config = config
        self.source_language: BaseLanguage.Enum = config.source_language
        self.target_language: BaseLanguage.Enum = config.target_language

    # 在扩展名前插入文本
    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.target_language.lower()}{ext}"

    # 在扩展名前插入文本
    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return (
            f"{root}.{self.source_language.lower()}.{self.target_language.lower()}{ext}"
        )

    # 读取
    def read_from_path(self, abs_paths: list[str], input_path: str) -> list[Item]:
        items: list[Item] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, input_path)

            # 数据处理
            with open(abs_path, "rb") as reader:
                items.extend(self.read_from_stream(reader.read(), rel_path))

        return items

    # 从流读取
    def read_from_stream(self, content: bytes, rel_path: str) -> list[Item]:
        items: list[Item] = []

        # 获取文件编码
        encoding = TextHelper.get_encoding(content=content, add_sig_to_utf8=True)

        # 数据处理
        text = content.decode(encoding)
        lines = [line.strip() for line in text.splitlines()]

        # 格式字段的数量
        in_event = False
        format_field_num = -1
        for line in lines:
            # 判断是否进入事件块
            if line == "[Events]":
                in_event = True
            # 在事件块中寻找格式字段
            if in_event and line.startswith("Format:"):
                format_field_num = len(line.split(",")) - 1
                break

        for line in lines:
            content_val = (
                ",".join(line.split(",")[format_field_num:])
                if line.startswith("Dialogue:")
                else ""
            )
            extra_field = (
                line.replace(f"{content_val}", "{{CONTENT}}")
                if content_val != ""
                else line
            )

            # 添加数据
            items.append(
                Item.from_dict(
                    {
                        "src": content_val.replace("\\N", "\n"),
                        "dst": content_val.replace("\\N", "\n"),
                        "extra_field": extra_field,
                        "row": len(items),
                        "file_type": Item.FileType.ASS,
                        "file_path": rel_path,
                    }
                )
            )

        return items

    # 写入
    def write_to_path(self, items: list[Item]) -> None:
        # 获取输出目录
        dm = DataManager.get()
        output_path = dm.get_translated_path()
        bilingual_path = dm.get_bilingual_path()

        # 筛选
        target = [item for item in items if item.get_file_type() == Item.FileType.ASS]

        # 按文件路径分组
        group: dict[str, list[Item]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, group_items in group.items():
            abs_path = os.path.join(output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)

            result: list[str] = []
            for item in group_items:
                extra_field_raw = item.get_extra_field()
                extra_field: str = (
                    extra_field_raw if isinstance(extra_field_raw, str) else ""
                )
                result.append(
                    extra_field.replace(
                        "{{CONTENT}}", item.get_dst().replace("\n", "\\N")
                    )
                )

            with open(self.insert_target(abs_path), "w", encoding="utf-8") as writer:
                writer.write("\n".join(result))

        # 分别处理每个文件（双语）
        for rel_path, group_items in group.items():
            result: list[str] = []
            for item in group_items:
                extra_field_raw = item.get_extra_field()
                extra_field: str = (
                    extra_field_raw if isinstance(extra_field_raw, str) else ""
                )
                if (
                    self.config.deduplication_in_bilingual
                    and item.get_src() == item.get_dst()
                ):
                    line = extra_field.replace(
                        "{{CONTENT}}", "{{CONTENT}}\\N{{CONTENT}}"
                    )
                    line = line.replace(
                        "{{CONTENT}}", item.get_dst().replace("\n", "\\N"), 1
                    )
                    result.append(line)
                else:
                    line = extra_field.replace(
                        "{{CONTENT}}", "{{CONTENT}}\\N{{CONTENT}}"
                    )
                    line = line.replace(
                        "{{CONTENT}}", item.get_src().replace("\n", "\\N"), 1
                    )
                    line = line.replace(
                        "{{CONTENT}}", item.get_dst().replace("\n", "\\N"), 1
                    )
                    result.append(line)

            abs_path = os.path.join(bilingual_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(
                self.insert_source_target(abs_path), "w", encoding="utf-8"
            ) as writer:
                writer.write("\n".join(result))
