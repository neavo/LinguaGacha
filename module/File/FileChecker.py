import os

import opencc
import rapidjson as json

from base.Base import Base
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.CodeSaver import CodeSaver
from module.Localizer.Localizer import Localizer

class FileChecker(Base):

    # 类变量
    OPENCCS2T = opencc.OpenCC("s2t")
    OPENCCT2S = opencc.OpenCC("t2s")

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
        pre_translation_replacement_data: list[dict] = self.config.get("pre_translation_replacement_data")
        pre_translation_replacement_enable: bool = self.config.get("pre_translation_replacement_enable")
        if pre_translation_replacement_enable == False or len(pre_translation_replacement_data) == 0:
            self.rpls = self.srcs
        else:
            for src in self.srcs:
                for v in pre_translation_replacement_data:
                    if v.get("src") in src:
                        src = src.replace(v.get("src"), v.get("dst"))
                self.rpls.append(src)

        # 获取文件路径
        self.file_paths: list[str] = [
            item.get_file_path() for item in items
            if item.get_status() in (Base.TranslationStatus.UNTRANSLATED, Base.TranslationStatus.TRANSLATED)
        ]

        # 获取文类型
        self.text_types: list[str] = [
            item.get_text_type() for item in items
            if item.get_status() in (Base.TranslationStatus.UNTRANSLATED, Base.TranslationStatus.TRANSLATED)
        ]

    # 检查代码段
    def check_code(self, path: str, code_saver: CodeSaver) -> None:
        count = 0
        result: dict[str, str] = {
            Localizer.get().file_checker_code_alert_key: Localizer.get().file_checker_code_alert_value,
        }
        for src, dst, rpl, file_path, text_type in zip(self.srcs, self.dsts, self.rpls, self.file_paths, self.text_types):
            if not code_saver.check(rpl, dst, text_type):
                count = count + 1
                result.setdefault(file_path, {})[src] = dst

        if count == 0:
            self.info(Localizer.get().file_checker_code)
        else:
            target = os.path.join(self.config.get("output_folder"), path).replace("\\", "/")
            self.info(
                Localizer.get().file_checker_code_full.replace("{COUNT}", f"{count}")
                                                      .replace("{PERCENT}", f"{(count / len(self.rpls) * 100):.2f}")
                                                      .replace("{TARGET}", f"{path}")
            )
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 检查术语表
    def check_glossary(self, path: str) -> None:
        glossary_enable: bool = self.config.get("glossary_enable")
        glossary_data: list[dict] = self.config.get("glossary_data")
        traditional_chinese_enable: bool = self.config.get("traditional_chinese_enable")

        # 有效性检查
        if glossary_enable == False or len(glossary_data) == 0:
            return

        # 如果启用了繁体输出，则先将数据转换为繁体
        if traditional_chinese_enable == True:
            glossary_data = [
                {
                    "src": v.get("src"),
                    "dst": FileChecker.OPENCCS2T.convert(v.get("dst")),
                }
                for v in glossary_data
            ]
        else:
            glossary_data = [
                {
                    "src": v.get("src"),
                    "dst": FileChecker.OPENCCT2S.convert(v.get("dst")),
                }
                for v in glossary_data
            ]

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
            self.info(
                Localizer.get().file_checker_glossary_full.replace("{COUNT}", f"{count}")
                                                          .replace("{PERCENT}", f"{(count / len(self.rpls) * 100):.2f}")
                                                          .replace("{TARGET}", f"{path}")
            )
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 检查翻译状态
    def check_untranslated(self, path: str) -> None:
        count = 0
        result: dict[str, str] = {
            Localizer.get().file_checker_translation_alert_key: Localizer.get().file_checker_translation_alert_value,
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
            self.info(
                Localizer.get().file_checker_translation_full.replace("{COUNT}", f"{count}")
                                                             .replace("{PERCENT}", f"{(count / len(self.rpls) * 100):.2f}")
                                                             .replace("{TARGET}", f"{path}")
            )
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))