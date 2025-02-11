import os
import re
import time
import shutil
import urllib
import threading
import concurrent.futures

import rapidjson as json
from tqdm import tqdm

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheManager import CacheManager
from module.Check.ResultChecker import ResultChecker
from module.CodeSaver import CodeSaver
from module.Translator.TranslatorTask import TranslatorTask
from module.FileHelper import FileHelper
from module.TextHelper import TextHelper
from module.Filter.RuleFilter import RuleFilter
from module.PromptBuilder import PromptBuilder

# 翻译器
class Translator(Base):

    def __init__(self) -> None:
        super().__init__()

        # 初始化
        self.cache_manager = CacheManager()

        # 线程锁
        self.data_lock = threading.Lock()

        # 注册事件
        self.subscribe(Base.Event.TRANSLATION_STOP, self.translation_stop)
        self.subscribe(Base.Event.TRANSLATION_START, self.translation_start)
        self.subscribe(Base.Event.TRANSLATION_MANUAL_EXPORT, self.translation_manual_export)
        self.subscribe(Base.Event.TRANSLATION_PROJECT_STATUS, self.translation_project_status_check)
        self.subscribe(Base.Event.APP_SHUT_DOWN, self.app_shut_down)

    # 应用关闭事件
    def app_shut_down(self, event: int, data: dict) -> None:
        Base.work_status = Base.Status.STOPING

    # 翻译停止事件
    def translation_stop(self, event: int, data: dict) -> None:
        # 设置运行状态为停止中
        Base.work_status = Base.Status.STOPING

        def target() -> None:
            while True:
                time.sleep(0.5)
                if self.translating == False:
                    self.print("")
                    self.info("翻译任务已停止 ...")
                    self.print("")
                    self.emit(Base.Event.TRANSLATION_STOP_DONE, {})
                    break

        threading.Thread(target = target).start()

    # 翻译开始事件
    def translation_start(self, event: int, data: dict) -> None:
        threading.Thread(
            target = self.translation_start_target,
            args = (data.get("status"), ),
        ).start()

    # 翻译结果手动导出事件
    def translation_manual_export(self, event: int, data: dict) -> None:
        # 确保当前状态为 翻译中
        if Base.work_status != Base.Status.TRANSLATING:
            return None

        # 检查结果并写入文件
        self.check_and_wirte_result()

    # 翻译状态检查事件
    def translation_project_status_check(self, event: int, data: dict) -> None:
        threading.Thread(
            target = self.translation_project_status_check_target
        ).start()

    # 翻译状态检查
    def translation_project_status_check_target(self) -> None:
        # 等一下，等页面切换效果结束再执行，避免争抢 CPU 资源，导致 UI 卡顿
        time.sleep(0.5)

        # 检查结果的默认值
        status = Base.TranslationStatus.UNTRANSLATED

        # 只有翻译状态为 无任务 时才执行检查逻辑，其他情况直接返回默认值
        if Base.work_status == Base.Status.IDLE:
            config = self.load_config()
            self.cache_manager.load_from_file(config.get("output_folder"))
            status = self.cache_manager.get_project_status()

        self.emit(Base.Event.TRANSLATION_PROJECT_STATUS_CHECK_DONE, {
            "status" : status,
        })

    # 实际的翻译流程
    def translation_start_target(self, status: int) -> None:
        # 设置内部状态（用于判断翻译任务是否实际在执行）
        self.translating = True

        # 设置翻译状态为正在翻译状态
        Base.work_status = Base.Status.TRANSLATING

        # 初始化
        self.config = self.load_config()
        self.platform = {}
        for platform in self.config.get("platforms"):
            if platform.get("id") == self.config.get("activate_platform"):
                self.platform = platform
                break
        self.initialize_proxy()
        self.initialize_batch_size()

        # 生成缓存列表
        try:
            # 根据 status 判断是否为继续翻译
            if status == Base.TranslationStatus.TRANSLATING:
                self.cache_manager.load_from_file(self.config.get("output_folder"))
            else:
                shutil.rmtree(f"{self.config.get("output_folder")}/cache", ignore_errors = True)
                file_helper = FileHelper(self.config.get("input_folder"), self.config.get("output_folder"))
                project, items = file_helper.read_from_path()
                self.cache_manager.set_items(items)
                self.cache_manager.set_project(project)

            # 检查数据是否为空
            if self.cache_manager.get_item_count() == 0:
                raise Exception("未在输入文件夹中找到数据 ...")
        except Exception as e:
            self.error("翻译项目数据载入失败 ... ", e)
            return None

        # 从头翻译时加载默认数据
        if status == Base.TranslationStatus.TRANSLATING:
            self.extras = self.cache_manager.get_project_extras()
            self.extras["start_time"] = time.time() - self.extras.get("time", 0)
        else:
            self.extras = {
                "start_time": time.time(),
                "total_line": 0,
                "line": 0,
                "token": 0,
                "total_completion_tokens": 0,
                "time": 0,
            }

        # 更新翻译进度
        self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)

        # 规则过滤
        self.rule_filter(self.cache_manager.get_items())

        # 语言过滤
        self.language_filter(self.cache_manager.get_items())

        # 开始循环
        for current_round in range(self.config.get("max_round") + 1):
            # 检测是否需要停止任务
            if Base.work_status == Base.Status.STOPING:
                # 循环次数比实际最大轮次要多一轮，当触发停止翻译的事件时，最后都会从这里退出任务
                # 执行到这里说明停止翻译的任务已经执行完毕，可以重置内部状态了
                self.translating = False
                return None

            # 获取 待翻译 状态的条目数量
            item_count_status_untranslated = self.cache_manager.get_item_count_by_status(Base.TranslationStatus.UNTRANSLATED)

            # 判断是否需要继续翻译
            if item_count_status_untranslated == 0:
                self.print("")
                self.info("所有文本均已翻译，翻译任务已结束 ...")
                self.print("")
                break

            # 达到最大翻译轮次时
            if item_count_status_untranslated > 0 and current_round == self.config.get("max_round"):
                self.print("")
                self.warning("已达到最大翻译轮次，仍有部分文本未翻译，请检查结果 ...")
                self.print("")
                break

            # 第一轮时且不是继续翻译时，记录总行数
            if current_round == 0 and status == Base.TranslationStatus.UNTRANSLATED:
                self.extras["total_line"] = item_count_status_untranslated

            # 第二轮开始对半切分
            if current_round > 0:
                self.config["task_token_limit"] = max(1, int(self.config.get("task_token_limit") / 2))

            # 生成缓存数据条目片段
            chunks = self.cache_manager.generate_item_chunks(self.config.get("task_token_limit"))

            # 生成翻译任务
            tasks: list[TranslatorTask] = []
            self.print("")
            for chunk in tqdm(chunks, desc = "生成翻译任务", total = len(chunks)):
                tasks.append(TranslatorTask(self.config, self.platform, self.cache_manager.get_project(), chunk))
            self.print("")

            # 输出开始翻译的日志
            self.print("")
            self.info(f"当前轮次 - {current_round + 1}")
            self.info(f"最大轮次 - {self.config.get("max_round")}")
            self.print("")
            self.info(f"接口名称 - {self.platform.get("name")}")
            self.info(f"接口地址 - {self.platform.get("api_url")}")
            self.info(f"模型名称 - {self.platform.get("model")}")
            if self.config.get("proxy_enable") == True and self.config.get("proxy_url") != "":
                self.print("")
                self.info(f"生效中的 网络代理 - {self.config.get("proxy_url")}")
            self.print("")
            if self.platform.get("api_format") != Base.APIFormat.SAKURALLM:
                auto_glossary_enable = self.config.get("auto_glossary_enable")
                custom_prompt_enable = self.config.get("custom_prompt_enable")
                self.info(f"本次任务使用以下提示词：\n{PromptBuilder.build_base(self.config, custom_prompt_enable, auto_glossary_enable)}\n")
            self.info(f"即将开始执行翻译任务，预计任务总数为 {len(tasks)}, 并发任务数为 {self.config.get("batch_size")}，请注意保持网络通畅 ...")
            self.print("")

            # 开始执行翻译任务
            with concurrent.futures.ThreadPoolExecutor(max_workers = self.config.get("batch_size"), thread_name_prefix = "translator") as executor:
                for task in tasks:
                    future = executor.submit(task.start, current_round)
                    future.add_done_callback(self.task_done_callback)

        # 设置项目状态为已翻译
        self.cache_manager.set_project_status(Base.TranslationStatus.TRANSLATED)

        # 等待可能存在的缓存文件写入请求处理完毕
        time.sleep(CacheManager.SAVE_INTERVAL)

        # 检查结果并写入文件
        self.check_and_wirte_result()

        # 重置内部状态（正常完成翻译）
        self.translating = False

        # 触发翻译停止完成的事件
        self.emit(Base.Event.TRANSLATION_STOP_DONE, {})

    # 初始化网络代理
    def initialize_proxy(self) -> None:
        if self.config.get("proxy_enable") == False or self.config.get("proxy_url") == "":
            os.environ.pop("http_proxy", None)
            os.environ.pop("https_proxy", None)
        else:
            os.environ["http_proxy"] = self.config.get("proxy_url")
            os.environ["https_proxy"] = self.config.get("proxy_url")

    # 初始化 batch_size
    def initialize_batch_size(self) -> None:
        try:
            response_json = None
            with urllib.request.urlopen(f"{re.sub(r"/v1$", "", self.platform.get("api_url"))}/slots") as response:
                response_json = json.loads(response.read().decode("utf-8"))
        except Exception:
            self.debug("无法获取 [green]llama.cpp[/] 响应数据 ...")
        if isinstance(response_json, list) and len(response_json) > 0:
            self.config["batch_size"] = len(response_json)
        elif self.config.get("batch_size") == 0:
            self.config["batch_size"] = 4

    # 规则过滤
    def rule_filter(self, items: list[CacheItem]) -> None:
        # 筛选出无效条目并标记为已排除
        target = []
        self.print("")
        target = [
            v for v in tqdm(items)
            if RuleFilter.filter(v) == True
        ]
        for item in target:
            item.set_status(Base.TranslationStatus.EXCLUDED)

        # 输出结果
        self.print("")
        self.info(f"规则过滤已完成，共过滤 {len(target)} 个无需翻译的条目 ...")
        self.print("")

    # 语言过滤
    def language_filter(self, items: list[CacheItem]) -> None:
        if self.config.get("source_language") == Base.Language.ZH:
            func = TextHelper.has_any_cjk
        elif self.config.get("source_language") == Base.Language.EN:
            func = TextHelper.has_any_latin
        elif self.config.get("source_language") == Base.Language.JA:
            func = TextHelper.has_any_japanese
        elif self.config.get("source_language") == Base.Language.KO:
            func = TextHelper.has_any_korean
        elif self.config.get("source_language") == Base.Language.RU:
            func = TextHelper.has_any_russian

        # 筛选出无效条目并标记为已排除
        target = []
        if callable(func) == True:
            self.print("")
            target = [
                v for v in tqdm(items)
                if func(v.get_src()) == False
            ]
            for item in target:
                item.set_status(Base.TranslationStatus.EXCLUDED)

        # 输出结果
        self.print("")
        self.info(f"语言过滤已完成，共过滤 {len(target)} 个不包含目标语言的条目 ...")
        self.print("")

    # 检查结果并写入文件
    def check_and_wirte_result(self) -> None:
        # 清理一下
        if os.path.isdir(self.config.get("output_folder")) == True:
            [
                os.remove(entry.path)
                for entry in os.scandir(self.config.get("output_folder"))
                if entry.is_file() and entry.name.startswith("结果检查_")
            ]

        # 检查结果
        result_check = ResultChecker(self.config, self.cache_manager.get_items())
        result_check.check_code("结果检查_代码异常的条目.json", CodeSaver(self.config))
        result_check.check_glossary("结果检查_术语表未生效的条目.json")
        result_check.check_untranslated("结果检查_翻译状态异常的条目.json")

        # 写入文件
        file_helper = FileHelper(self.config.get("input_folder"), self.config.get("output_folder"))
        file_helper.write_to_path(self.cache_manager.get_items())
        self.print("")
        self.info(f"翻译结果已保存至 {self.config.get("output_folder")} 目录 ...")
        self.print("")

    # 翻译任务完成时
    def task_done_callback(self, future: concurrent.futures.Future) -> None:
        try:
            # 获取结果
            result = future.result()

            # 结果为空则跳过后续的更新步骤
            if result == None or len(result) == 0:
                return

            # 记录数据
            with self.data_lock:
                if result.get("check_flag") != None:
                    # 任务成功
                    new = {}
                    new["start_time"] = self.extras.get("start_time")
                    new["total_line"] = self.extras.get("total_line")
                    new["line"] = self.extras.get("line")
                    new["token"] = self.extras.get("token") + result.get("prompt_tokens", 0) + result.get("completion_tokens", 0)
                    new["total_completion_tokens"] = self.extras.get("total_completion_tokens")
                    new["time"] = time.time() - self.extras.get("start_time")
                    self.extras = new
                else:
                    # 任务失败
                    new = {}
                    new["start_time"] = self.extras.get("start_time")
                    new["total_line"] = self.extras.get("total_line")
                    new["line"] = self.extras.get("line") + result.get("row_count", 0)
                    new["token"] = self.extras.get("token") + result.get("prompt_tokens", 0) + result.get("completion_tokens", 0)
                    new["total_completion_tokens"] = self.extras.get("total_completion_tokens") + result.get("completion_tokens")
                    new["time"] = time.time() - self.extras.get("start_time")
                    self.extras = new

            # 更新翻译进度
            self.cache_manager.set_project_extras(self.extras)

            # 更新翻译状态
            self.cache_manager.set_project_status(Base.TranslationStatus.TRANSLATING)

            # 请求保存缓存文件
            self.cache_manager.require_save_to_file(self.config.get("output_folder"))

            # 触发翻译进度更新事件
            self.emit(Base.Event.TRANSLATION_UPDATE, self.extras)
        except Exception as e:
            self.error(f"翻译任务错误 ... {e}", e if self.is_debug() else None)