import os

from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Localizer.Localizer import Localizer
from module.ExpertConfig import ExpertConfig

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

    def __init__(self, config: dict) -> None:
        super().__init__()

        # 初始化
        self.config: dict = config
        self.input_path: str = config.get("input_folder")
        self.output_path: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.target_language: str = config.get("target_language")

    # 在扩展名前插入文本
    def insert_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.target_language.lower()}{ext}"

    # 在扩展名前插入文本
    def insert_source_target(self, path: str) -> str:
        root, ext = os.path.splitext(path)
        return f"{root}.{self.source_language.lower()}.{self.target_language.lower()}{ext}"

    # 读取
    def read_from_path(self, abs_paths: list[str]) -> list[CacheItem]:
        items:list[CacheItem] = []
        for abs_path in abs_paths:
            # 获取相对路径
            rel_path = os.path.relpath(abs_path, self.input_path)

            # 获取文件编码
            encoding = TextHelper.get_enconding(path = abs_path, auto_suffix = True)

            # 数据处理
            with open(abs_path, "r", encoding = encoding) as reader:
                lines = [line.strip() for line in reader.readlines()]

                # 格式字段的数量
                in_event = False
                format_field_num = -1
                for line in lines:
                    # 判断是否进入事件块
                    if line == "[Events]":
                        in_event = True
                    # 在事件块中寻找格式字段
                    if in_event == True and line.startswith("Format:"):
                        format_field_num = len(line.split(",")) - 1
                        break

                for line in lines:
                    content = ",".join(line.split(",")[format_field_num:]) if line.startswith("Dialogue:") else ""
                    extra_field = line.replace(f"{content}", "{{CONTENT}}") if content != "" else line

                    # 添加数据
                    items.append(
                        CacheItem({
                            "src": content.replace("\\N", "\n"),
                            "dst": content.replace("\\N", "\n"),
                            "extra_field": extra_field,
                            "row": len(items),
                            "file_type": CacheItem.FileType.ASS,
                            "file_path": rel_path,
                        })
                    )

        return items

    # 写入
    def write_to_path(self, items: list[CacheItem]) -> None:
        # 筛选
        target = [
            item for item in items
            if item.get_file_type() == CacheItem.FileType.ASS
        ]

        # 按文件路径分组
        group: dict[str, list[str]] = {}
        for item in target:
            group.setdefault(item.get_file_path(), []).append(item)

        # 分别处理每个文件
        for rel_path, items in group.items():
            abs_path = os.path.join(self.output_path, rel_path)
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)

            result: list[str] = []
            for item in items:
                result.append(item.get_extra_field().replace("{{CONTENT}}", item.get_dst().replace("\n", "\\N")))

            with open(self.insert_target(abs_path), "w", encoding = "utf-8") as writer:
                writer.write("\n".join(result))

        # 分别处理每个文件（双语）
        for rel_path, items in group.items():
            result: list[str] = []
            for item in items:
                if ExpertConfig.get().deduplication_in_bilingual == True and item.get_src() == item.get_dst():
                    line = item.get_extra_field().replace("{{CONTENT}}", "{{CONTENT}}\\N{{CONTENT}}")
                    line = line.replace("{{CONTENT}}", item.get_dst().replace("\n", "\\N"), 1)
                    result.append(line)
                else:
                    line = item.get_extra_field().replace("{{CONTENT}}", "{{CONTENT}}\\N{{CONTENT}}")
                    line = line.replace("{{CONTENT}}", item.get_src().replace("\n", "\\N"), 1)
                    line = line.replace("{{CONTENT}}", item.get_dst().replace("\n", "\\N"), 1)
                    result.append(line)

            abs_path = f"{self.output_path}/{Localizer.get().path_bilingual}/{rel_path}"
            os.makedirs(os.path.dirname(abs_path), exist_ok = True)
            with open(self.insert_source_target(abs_path), "w", encoding = "utf-8") as writer:
                writer.write("\n".join(result))