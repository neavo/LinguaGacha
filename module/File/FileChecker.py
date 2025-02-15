import os

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.CodeSaver import CodeSaver
from module.TextHelper import TextHelper

class FileChecker(Base):

    def __init__(self, config: dict, items: list[CacheItem]) -> None:
        super().__init__()

        # 初始化
        self.config = config

        # 获取原文
        self.srcs: list[str] = [
            item.get_src() for item in items
            if item.get_status() in (Base.TranslationStatus.UNTRANSLATED, Base.TranslationStatus.TRANSLATED)
        ]

        # 获取译文
        self.dsts: list[str] = [
            item.get_dst() for item in items
            if item.get_status() in (Base.TranslationStatus.UNTRANSLATED, Base.TranslationStatus.TRANSLATED)
        ]

        # 获取译前替换后的原文
        self.rpls: list[str] = []
        replace_before_translation_data: list[dict] = self.config.get("replace_before_translation_data")
        replace_before_translation_enable: bool = self.config.get("replace_before_translation_enable")
        if replace_before_translation_enable == False or len(replace_before_translation_data) == 0:
            self.rpls = self.srcs
        else:
            for src in self.srcs:
                for v in replace_before_translation_data:
                    if v.get("src") in src:
                        src = src.replace(v.get("src"), v.get("dst"))
                self.rpls.append(src)

    # 检查代码段
    def check_code(self, path: str, code_saver: CodeSaver) -> None:
        result: dict[str, str] = {}
        for src, dst, rpl in zip(self.srcs, self.dsts, self.rpls):
            if not code_saver.check(rpl, dst):
                result[src] = dst

        if len(result) == 0:
            self.info("已完成代码检查，未发现异常条目 ...")
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(f"已完成代码检查，发现 {len(result)} 个异常条目，占比为 {(len(result)/len(self.rpls) * 100):.2f} %，结果已写入 {target} ...")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 检查术语表
    def check_glossary(self, path: str) -> None:
        glossary_enable: list[dict] = self.config.get("glossary_enable")
        glossary_data: bool = self.config.get("glossary_data")

        # 有效性检查
        if glossary_enable == False:
            return

        result: dict[str, dict] = {}
        for src, dst, rpl in zip(self.srcs, self.dsts, self.rpls):
            for v in glossary_data:
                glossary_src = v.get("src", "")
                glossary_dst = v.get("dst", "")
                if glossary_src in rpl and glossary_dst not in dst:
                    result.setdefault(f"{glossary_src} -> {glossary_dst}", {})[src] = dst

        if len(result) == 0:
            self.info("已完成术语表检查，未发现异常条目 ...")
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(f"已完成术语表检查，发现 {len(result)} 个异常条目，占比为 {(len(result)/len(self.rpls) * 100):.2f} %，结果已写入 {target} ...")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 计算 Jaccard 相似度
    def check_similarity_by_Jaccard(self, x: str, y: str) -> float:
        set_x = set(x.split())
        set_y = set(y.split())

        # 求并集
        union = len(set_x | set_y)

        # 求交集
        intersection = len(set_x & set_y)

        # 计算并返回相似度，完全一致是 1，完全不同是 0
        return intersection / union if union > 0 else 0.0

    # 检查翻译状态
    def check_untranslated(self, path: str) -> None:
        result: dict[str, str] = {}
        for src, dst, rpl in zip(self.srcs, self.dsts, self.rpls):
            src = src.strip()
            rpl = rpl.strip()
            dst = dst.strip()

            # 针对短文本、长文本分别使用不同策略判断是否相同或相似
            if src == dst and TextHelper.get_display_lenght(src) < 10:
                result[src] = dst
            elif self.check_similarity_by_Jaccard(src, dst) > 0.80 and TextHelper.get_display_lenght(src) >= 10:
                result[src] = dst

        if len(result) == 0:
            self.info("已完成翻译检查，未发现异常条目 ...")
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(f"已完成翻译检查，发现 {len(result)} 个异常条目，占比为 {(len(result)/len(self.rpls) * 100):.2f} %，结果已写入 {target} ...")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))