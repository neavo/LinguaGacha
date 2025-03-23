import os

import opencc
import rapidjson as json

from base.Base import Base
from base.BaseLanguage import BaseLanguage
from module.Text.TextHelper import TextHelper
from module.Cache.CacheItem import CacheItem
from module.Response.ResponseChecker import ResponseChecker
from module.Localizer.Localizer import Localizer
from module.CodeSaver import CodeSaver
from module.ExpertConfig import ExpertConfig

class ResultChecker(Base):

    # 类变量
    CODESAVER = CodeSaver()
    OPENCCS2T = opencc.OpenCC("s2t")
    OPENCCT2S = opencc.OpenCC("t2s")

    def __init__(self, config: dict, items: list[CacheItem]) -> None:
        super().__init__()

        # 初始化
        self.output_folder: str = config.get("output_folder")
        self.source_language: str = config.get("source_language")
        self.glossary_data: list[dict] = config.get("glossary_data")
        self.glossary_enable: bool = config.get("glossary_enable")
        self.traditional_chinese_enable: bool = config.get("traditional_chinese_enable")

        # 筛选数据
        self.items_translated = [item for item in items if item.get_status() == Base.TranslationStatus.TRANSLATED]
        self.items_untranslated = [item for item in items if item.get_status() == Base.TranslationStatus.UNTRANSLATED]

        # 获取译前替换后的原文
        self.rpls_translated: list[str] = []
        pre_translation_replacement_data: list[dict] = config.get("pre_translation_replacement_data")
        pre_translation_replacement_enable: bool = config.get("pre_translation_replacement_enable")
        for item in self.items_translated:
            src = item.get_src()

            if pre_translation_replacement_enable == True and len(pre_translation_replacement_data) > 0:
                for v in pre_translation_replacement_data:
                    src = src.replace(v.get("src"), v.get("dst"))

            self.rpls_translated.append(src)

    # 检查
    def check(self) -> None:
        os.makedirs(self.output_folder, exist_ok = True)
        [
            os.remove(entry.path)
            for entry in os.scandir(self.output_folder)
            if entry.is_file() and entry.name.startswith(("结果检查_", "result_check_"))
        ]

        self.check_kana()
        self.check_hangeul()
        self.check_code()
        self.check_similarity()
        self.check_glossary()
        self.check_untranslated()
        self.check_retry_count_threshold()

    # 假名残留检查
    def check_kana(self) -> None:
        if self.source_language != BaseLanguage.JA:
            return None

        count = 0
        result: dict[str, str] = {}

        for item in self.items_translated:
            if TextHelper.JA.any_hiragana(item.get_dst()) or TextHelper.JA.any_katakana(item.get_dst()):
                count = count + 1
                result.setdefault(item.get_file_path(), {})[item.get_src()] = item.get_dst()

        if count == 0:
            self.info(Localizer.get().file_checker_kana)
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_kana}".replace("\\", "/")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

            # 打印日志
            message = Localizer.get().file_checker_kana_full.replace("{COUNT}", f"{count}")
            message = message.replace("{PERCENT}", f"{(count / (len(self.items_translated) + len(self.items_untranslated)) * 100):.2f}")
            message = message.replace("{TARGET}", f"{Localizer.get().path_result_check_kana}")
            self.info(message)

    # 谚文残留检查
    def check_hangeul(self) -> None:
        if self.source_language != BaseLanguage.KO:
            return None

        count = 0
        result: dict[str, str] = {}

        for item in self.items_translated:
            if TextHelper.KO.any_hangeul(item.get_dst()):
                count = count + 1
                result.setdefault(item.get_file_path(), {})[item.get_src()] = item.get_dst()

        if count == 0:
            self.info(Localizer.get().file_checker_hangeul)
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_hangeul}".replace("\\", "/")
            self.info(
                Localizer.get().file_checker_hangeul_full.replace("{COUNT}", f"{count}")
                                                         .replace("{PERCENT}", f"{(count / (len(self.items_translated) + len(self.items_untranslated)) * 100):.2f}")
                                                         .replace("{TARGET}", f"{Localizer.get().path_result_check_hangeul}")
            )
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 代码错误检查
    def check_code(self) -> None:
        count = 0
        result: dict[str, str] = {
            Localizer.get().file_checker_code_alert_key: Localizer.get().file_checker_code_alert_value,
        }

        for item, rpl in zip(self.items_translated, self.rpls_translated):
            if ResultChecker.CODESAVER.check(rpl, item.get_dst(), item.get_text_type()) == False:
                count = count + 1
                result.setdefault(item.get_file_path(), {})[item.get_src()] = item.get_dst()

        if count == 0:
            self.info(Localizer.get().file_checker_code)
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_code}".replace("\\", "/")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

            # 打印日志
            message = Localizer.get().file_checker_code_full.replace("{COUNT}", f"{count}")
            message = message.replace("{PERCENT}", f"{(count / (len(self.items_translated) + len(self.items_untranslated)) * 100):.2f}")
            message = message.replace("{TARGET}", f"{Localizer.get().path_result_check_code}")
            self.info(message)

    # 相似度较高检查
    def check_similarity(self) -> None:
        count = 0
        result: dict[str, str] = {
            Localizer.get().file_checker_similarity_alert_key: Localizer.get().file_checker_similarity_alert_value,
        }

        for item, rpl in zip(self.items_translated, self.rpls_translated):
            rpl = rpl.strip()
            src = item.get_src().strip()
            dst = item.get_dst().strip()

            # 判断是否包含或相似
            if rpl in dst or dst in rpl or TextHelper.check_similarity_by_jaccard(rpl, dst) > 0.80:
                count = count + 1
                result.setdefault(item.get_file_path(), {})[src] = dst

        if count == 0:
            self.info(Localizer.get().file_checker_similarity)
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_similarity}".replace("\\", "/")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

            # 打印日志
            message = Localizer.get().file_checker_similarity_full.replace("{COUNT}", f"{count}")
            message = message.replace("{PERCENT}", f"{(count / (len(self.items_translated) + len(self.items_untranslated)) * 100):.2f}")
            message = message.replace("{TARGET}", f"{Localizer.get().path_result_check_similarity}")
            self.info(message)

    # 术语表未生效检查
    def check_glossary(self) -> None:
        # 有效性检查
        if self.glossary_enable == False or len(self.glossary_data) == 0:
            return None

        # 如果启用了繁体输出，则先将数据转换为繁体
        if self.traditional_chinese_enable == True:
            self.glossary_data = [
                {
                    "src": v.get("src"),
                    "dst": ResultChecker.OPENCCS2T.convert(v.get("dst")),
                }
                for v in self.glossary_data
            ]
        else:
            self.glossary_data = [
                {
                    "src": v.get("src"),
                    "dst": ResultChecker.OPENCCT2S.convert(v.get("dst")),
                }
                for v in self.glossary_data
            ]

        count = 0
        result: dict[str, dict] = {}
        for item, rpl in zip(self.items_translated, self.rpls_translated):
            for v in self.glossary_data:
                glossary_src = v.get("src", "")
                glossary_dst = v.get("dst", "")
                if glossary_src in rpl and glossary_dst not in item.get_dst():
                    count = count + 1
                    result.setdefault(f"{glossary_src} -> {glossary_dst}", {})[item.get_src()] = item.get_dst()

        if count == 0:
            self.info(Localizer.get().file_checker_glossary)
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_glossary}".replace("\\", "/")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

            # 打印日志
            message = Localizer.get().file_checker_glossary_full.replace("{COUNT}", f"{count}")
            message = message.replace("{PERCENT}", f"{(count / (len(self.items_translated) + len(self.items_untranslated)) * 100):.2f}")
            message = message.replace("{TARGET}", f"{Localizer.get().path_result_check_glossary}")
            self.info(message)

    # 未翻译检查
    def check_untranslated(self) -> None:
        count = 0
        result: dict[str, str] = {}

        for item in self.items_untranslated:
            count = count + 1
            result.setdefault(item.get_file_path(), {})[item.get_src()] = item.get_dst()

        if count == 0:
            pass
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_untranslated}".replace("\\", "/")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))

    # 重试次数达到阈值检查
    def check_retry_count_threshold(self) -> None:
        if ExpertConfig.get().result_checker_retry_count_threshold != True:
            return None

        count = 0
        result: dict[str, str] = {}

        for item in [v for v in self.items_translated if v.get_retry_count() >= ResponseChecker.RETRY_COUNT_THRESHOLD]:
            count = count + 1
            result.setdefault(item.get_file_path(), {})[item.get_src()] = item.get_dst()

        if count == 0:
            pass
        else:
            target = f"{self.output_folder}/{Localizer.get().path_result_check_retry_count_threshold}".replace("\\", "/")
            with open(target, "w", encoding = "utf-8") as writer:
                writer.write(json.dumps(result, indent = 4, ensure_ascii = False))