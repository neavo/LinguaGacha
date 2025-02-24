import os
import re
import time
import threading

import rapidjson as json

from base.Base import Base
from module.Cache.CacheItem import CacheItem
from module.Cache.CacheProject import CacheProject
from module.Localizer.Localizer import Localizer

class CacheManager(Base):

    # 缓存文件保存周期（秒）
    SAVE_INTERVAL = 15

    # 用于判断是否包含 RPGMaker 数据条目
    # if(!s[982]) en(v[982] >= 1) if(v[982] >= 1)
    # /c[xy12] \bc[xy12] <\bc[xy12]>【/c[xy12]】
    RE_RM = re.compile(r"(en|if)\(.{0,5}[vs]\[\d+\].{0,16}\)|[<【]{0,1}[/\\][a-z]{1,5}[<\[][a-z\d]{0,16}[>\]][>】]{0,1}", flags = re.IGNORECASE)

    def __init__(self) -> None:
        super().__init__()

        # 默认值
        self.project: CacheProject = CacheProject({})
        self.items: list[CacheItem] = []

        # 线程锁
        self.file_lock = threading.Lock()

        # 注册事件
        self.subscribe(Base.Event.APP_SHUT_DOWN, self.app_shut_down)

        # 定时器
        threading.Thread(target = self.save_to_file_tick).start()

    # 应用关闭事件
    def app_shut_down(self, event: int, data: dict) -> None:
        self.app_shut_down = True

    # 保存缓存到文件
    def save_to_file(self) -> None:
        path = f"{self.save_to_file_require_path}/cache/items.json"
        with self.file_lock:
            try:
                with open(path, "w", encoding = "utf-8") as writer:
                    writer.write(json.dumps([item.get_vars() for item in self.items], indent = None, ensure_ascii = False))
            except Exception as e:
                self.debug(Localizer.get().log_write_cache_file_fail, e)

        path = f"{self.save_to_file_require_path}/cache/project.json"
        with self.file_lock:
            try:
                with open(path, "w", encoding = "utf-8") as writer:
                    writer.write(json.dumps(self.project.get_vars(), indent = None, ensure_ascii = False))
            except Exception as e:
                self.debug(Localizer.get().log_write_cache_file_fail, e)

    # 保存缓存到文件的定时任务
    def save_to_file_tick(self) -> None:
        while True:
            time.sleep(self.SAVE_INTERVAL)

            # 接收到退出信号则停止
            if getattr(self, "app_shut_down", False)  == True:
                break

            # 接收到保存信号则保存
            if getattr(self, "save_to_file_require_flag", False)  == True:
                # 创建上级文件夹
                folder_path = f"{self.save_to_file_require_path}/cache"
                os.makedirs(folder_path, exist_ok = True)

                # 保存缓存到文件
                self.save_to_file()

                # 触发事件
                self.emit(Base.Event.CACHE_FILE_AUTO_SAVE, {})

                # 重置标志
                self.save_to_file_require_flag = False

    # 请求保存缓存到文件
    def require_save_to_file(self, output_path: str) -> None:
        self.save_to_file_require_flag = True
        self.save_to_file_require_path = output_path

    # 从文件读取缓存数据
    def load_from_file(self, output_path: str) -> None:
        path = f"{output_path}/cache/items.json"
        with self.file_lock:
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    self.items = [CacheItem(item) for item in json.load(reader)]
            except Exception as e:
                self.debug(Localizer.get().log_read_cache_file_fail, e)

        path = f"{output_path}/cache/project.json"
        with self.file_lock:
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    self.project = CacheProject(json.load(reader))
            except Exception as e:
                self.debug(Localizer.get().log_read_cache_file_fail, e)

    # 设置缓存数据
    def set_items(self, items: list[CacheItem]) -> None:
        self.items = items
        self._any_rpgmaker = None

    # 获取缓存数据
    def get_items(self) -> list[CacheItem]:
        return self.items

    # 设置项目数据
    def set_project(self, project: CacheProject) -> None:
        self.project = project

    # 获取项目数据
    def get_project(self) -> CacheProject:
        return self.project

    # 获取缓存数据数量
    def get_item_count(self) -> int:
        return len(self.items)

    # 判断是否包含任何 RPGMaker 数据
    def any_rpgmaker(self) -> bool:
        if getattr(self, "_any_rpgmaker", None) is None:
            self._any_rpgmaker = any(CacheManager.RE_RM.findall(item.get_src()) != [] for item in self.items)

        return self._any_rpgmaker

    # 获取缓存数据数量（根据翻译状态）
    def get_item_count_by_status(self, status: int) -> int:
        return len([item for item in self.items if item.get_status() == status])

    # 生成缓存数据条目片段
    def generate_item_chunks(self, limit: int) -> list[list[CacheItem]]:
        # 根据 Token 阈值计算行数阈值，避免大量短句导致行数太多
        line_limit = max(8, int(limit / 16))

        chunk: list[CacheItem] = []
        chunks: list[list[CacheItem]] = []
        chunk_length: int = 0
        for item in [v for v in self.items if v.get_status() == Base.TranslationStatus.UNTRANSLATED]:
            current_length = item.get_token_count()

            # 每个片段的第一条不判断是否超限，以避免特别长的文本导致死循环
            if len(chunk) == 0:
                pass
            # 如果 Token/行数 超限 或 数据来源跨文件，则结束此片段
            elif chunk_length + current_length > limit or len(chunk) >= line_limit or item.get_file_path() != chunk[-1].get_file_path():
                chunks.append(chunk)

                chunk = []
                chunk_length = 0

            chunk.append(item)
            chunk_length = chunk_length + current_length

        # 如果还有剩余数据，则添加到列表中
        if len(chunk) > 0:
            chunks.append(chunk)

        return chunks