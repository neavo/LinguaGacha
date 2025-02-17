import os

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.CodeSaver import CodeSaver
from module.Localizer.Localizer import Localizer
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

        # 获取文件路径
        self.file_paths: list[str] = [
            item.get_file_path() for item in items
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
        count = 0
        result: dict[str, str] = {}
        for src, dst, rpl, file_path in zip(self.srcs, self.dsts, self.rpls, self.file_paths):
            if not code_saver.check(rpl, dst):
                count = count + 1
                result.setdefault(file_path, {})[src] = dst

        if count == 0:
            self.info(Localizer.get().file_checker_code)
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(f"已完成代码检查，发现 {count} 个异常条目，占比为 {(count / len(self.rpls) * 100):.2f} %，结果已写入 {target} ...")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 检查术语表
    def check_glossary(self, path: str) -> None:
        glossary_enable: list[dict] = self.config.get("glossary_enable")
        glossary_data: bool = self.config.get("glossary_data")

        # 有效性检查
        if glossary_enable == False or len(glossary_data) == 0:
            return

        count = 0
        result: dict[str, dict] = {}
        for src, dst, rpl in zip(self.srcs, self.dsts, self.rpls):
            for v in glossary_data:
                glossary_src = v.get("src", "")
                glossary_dst = v.get("dst", "")
                if glossary_src in rpl and glossary_dst not in dst:
                    count = count + 1
                    result.setdefault(f"{glossary_src} -> {glossary_dst}", {})[src] = dst

        if count == 0:
            self.info(Localizer.get().file_checker_glossary)
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(f"已完成术语表检查，发现 {count} 个异常条目，占比为 {(count / len(self.rpls) * 100):.2f} %，结果已写入 {target} ...")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 检查翻译状态
    def check_untranslated(self, path: str) -> None:
        count = 0
        result: dict[str, str] = {
            "____说明____" : "本文件内列出的是 **可能** 存在漏翻情况的条目，实际是否漏翻请结合上下文语境判断！",
        }
        for src, dst, rpl, file_path in zip(self.srcs, self.dsts, self.rpls, self.file_paths):
            src = src.strip()
            rpl = rpl.strip()
            dst = dst.strip()

            # 判断是否包含或相似
            if rpl in dst or dst in rpl or TextHelper.check_similarity_by_Jaccard(rpl, dst) > 0.80:
                count = count + 1
                result.setdefault(file_path, {})[src] = dst

        if count == 0:
            self.info(Localizer.get().file_checker_translation)
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(f"已完成翻译检查，发现 {count} 个异常条目，占比为 {(count / len(self.rpls) * 100):.2f} %，结果已写入 {target} ...")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))