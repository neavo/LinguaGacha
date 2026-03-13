from __future__ import annotations

import re
from typing import ClassVar


class AnalysisFakeNameInjector:
    """把控制码临时伪装成人名，避免术语分析把它们当实体。"""

    # 这里沿用 KG 的控制码口径，保证旧经验可以直接迁过来。
    CONTROL_CODE_PATTERN: ClassVar[re.Pattern[str]] = re.compile(
        r"\\(?:n|N){1,2}\[\d+\]"
    )

    # 这里优先复用 KG 的伪名列表，减少模型把控制码识别成术语的概率。
    DEFAULT_FAKE_NAMES: ClassVar[tuple[str, ...]] = (
        "蓝霁云",
        "檀秋萦",
        "墨临川",
        "泠鸢晚",
        "云螭遥",
        "邝溟幽",
        "颛鹤唳",
        "玄璆夜",
        "砚秋辞",
        "聆音澈",
        "雪渟寒",
        "萤照晚",
        "青霭浮",
        "绛霄临",
        "墨漪澜",
        "霜序遥",
        "霁川流",
        "檀烟渺",
        "玄螭隐",
        "青冥远",
        "墨笙寒",
        "霜序晚",
        "霁云舒",
        "檀香凝",
        "玄夜阑",
        "紫陌迁",
        "容止安",
        "蔚迟暮",
        "靖远尘",
        "聆夜笙",
        "绯辞镜",
        "予怀瑾",
        "疏星朗",
        "霁无瑕",
        "素问筠",
        "景行瞻",
        "聆风吟",
        "怀霜澈",
        "静姝窈",
        "思覃远",
        "语凝烟",
        "霁月朗",
        "星河澹",
        "清芷蘅",
        "韶华倾",
        "霁雪霏",
        "云舒卷",
        "風祭宵",
        "月代雫",
        "雨宮静",
        "星影律",
        "霧島朔",
        "時雨遥",
        "雪村茜",
        "花垣葵",
        "水瀬碧",
        "空木凪",
        "音羽奏",
        "琴引紬",
        "篝火茜",
        "砂川凪",
        "藤咲雫",
        "柚木碧",
        "柊木律",
        "楓原宵",
        "霞見遥",
        "篝屋静",
        "草薙朔",
        "月詠茜",
        "風早奏",
        "雪代紬",
        "花散里",
        "鸦羽透",
        "星屑海",
        "铁仙斎",
        "龙胆朔",
        "冬月葵",
        "胧月夜",
        "霞草雫",
        "薄墨葵",
        "绯桜咲",
        "苍海凪",
        "翠岚悠",
        "琥珀川",
        "霁辰砂",
        "暮云合",
        "清漪岚",
        "素影瞳",
        "怀瑾瑜",
        "朗夜汐",
        "轻尘陌",
        "雪霁空",
        "泠然止",
        "澹台清",
        "汐見凪",
        "氷川朔",
        "月白静",
        "風音律",
        "雪華遥",
        "雨夜雫",
    )

    def __init__(self, source_texts: list[str] | tuple[str, ...]) -> None:
        self.source_to_fake_name: dict[str, str] = {}
        self.fake_name_to_source: dict[str, str] = {}
        self.fake_name_pattern: re.Pattern[str] | None = None
        self.initialize_mapping(tuple(source_texts))

    def initialize_mapping(self, source_texts: tuple[str, ...]) -> None:
        """预先收集整轮任务的控制码，保证并发 worker 里映射稳定不漂。"""
        control_codes = self.collect_control_codes(source_texts)
        if not control_codes:
            return

        for index, control_code in enumerate(control_codes):
            fake_name = self.build_fake_name(index)
            self.source_to_fake_name[control_code] = fake_name
            self.fake_name_to_source[fake_name] = control_code

        fake_names = sorted(self.fake_name_to_source.keys(), key=len, reverse=True)
        self.fake_name_pattern = re.compile(
            "|".join(re.escape(fake_name) for fake_name in fake_names)
        )

    def collect_control_codes(self, source_texts: tuple[str, ...]) -> tuple[str, ...]:
        """按出现顺序去重收集控制码，保证同一输入批次总是分到同一伪名。"""
        ordered_codes: list[str] = []
        seen_codes: set[str] = set()

        for source_text in source_texts:
            for match in self.CONTROL_CODE_PATTERN.finditer(source_text):
                control_code = match.group(0)
                if control_code in seen_codes:
                    continue

                seen_codes.add(control_code)
                ordered_codes.append(control_code)

        return tuple(ordered_codes)

    def build_fake_name(self, index: int) -> str:
        """默认列表不够时继续按固定编号补齐，避免因为耗尽而退回原控制码。"""
        if index < len(self.DEFAULT_FAKE_NAMES):
            return self.DEFAULT_FAKE_NAMES[index]
        return f"伪名{index + 1:04d}"

    def inject_text(self, source_text: str) -> str:
        """只在真正发请求前替换，外部状态始终继续保存原始文本。"""
        if not self.source_to_fake_name:
            return source_text

        return self.CONTROL_CODE_PATTERN.sub(
            lambda match: self.source_to_fake_name.get(match.group(0), match.group(0)),
            source_text,
        )

    def inject_texts(self, source_texts: list[str]) -> list[str]:
        """批量注入保持简单列表口径，方便直接喂给提示词构造器。"""
        return [self.inject_text(source_text) for source_text in source_texts]

    @classmethod
    def is_control_code_text(cls, text: str) -> bool:
        """分析链路只为“纯控制码术语”开白名单，判断统一收口到这里。"""
        normalized_text = text.strip()
        if normalized_text == "":
            return False
        return cls.CONTROL_CODE_PATTERN.fullmatch(normalized_text) is not None

    @classmethod
    def is_control_code_self_mapping(cls, src: str, dst: str) -> bool:
        """纯控制码的自映射术语要单独放行，避免被普通自映射过滤误杀。"""
        normalized_src = src.strip()
        normalized_dst = dst.strip()
        if normalized_src == "" or normalized_src != normalized_dst:
            return False
        return cls.is_control_code_text(normalized_src)

    def restore_glossary_entry(self, src: str, dst: str) -> tuple[str, str] | None:
        """术语归一化前先还原伪名，避免业务层重复写同一套判断。"""
        restored_src, fake_name_injected = self.restore_text(src)
        if not fake_name_injected:
            return src, dst
        if not self.is_control_code_text(restored_src):
            return None

        # 伪名命中纯控制码时，说明模型把控制码本体识别成了实体名；这里强制
        # 回写成自映射术语，保证后续导入与过滤都使用同一口径。
        return restored_src, restored_src

    def restore_text(self, text: str) -> tuple[str, bool]:
        """候选入池前统一还原，便于识别纯控制码术语并过滤混合脚手架。"""
        fake_name_pattern = self.fake_name_pattern
        if fake_name_pattern is None or text == "":
            return text, False

        original_text = text
        restored_text = fake_name_pattern.sub(
            lambda match: self.fake_name_to_source.get(match.group(0), match.group(0)),
            text,
        )
        return restored_text, restored_text != original_text
