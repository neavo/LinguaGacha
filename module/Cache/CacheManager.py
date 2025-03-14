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

    # 结尾标点符号
    END_LINE_PUNCTUATION = (
        ".",
        "。",
        "?",
        "？",
        "!",
        "…",
        "\"",
        "」",
    )

    # 类线程锁
    FILE_LOCK = threading.Lock()

    def __init__(self, tick: bool) -> None:
        super().__init__()

        # 默认值
        self.project: CacheProject = CacheProject({})
        self.items: list[CacheItem] = []

        # 启动定时任务
        if tick == True:
            self.subscribe(Base.Event.APP_SHUT_DOWN, self.app_shut_down)
            threading.Thread(target = self.save_to_file_tick).start()

    # 应用关闭事件
    def app_shut_down(self, event: int, data: dict) -> None:
        self.app_shut_down = True

    # 保存缓存到文件
    def save_to_file(self, project: CacheProject = None, items: list[CacheItem] = None, output_folder: str = None) -> None:
        # 创建上级文件夹
        os.makedirs(f"{output_folder}/cache", exist_ok = True)

        # 保存缓存到文件
        path = f"{output_folder}/cache/items.json"
        with CacheManager.FILE_LOCK:
            try:
                with open(path, "w", encoding = "utf-8") as writer:
                    writer.write(json.dumps([item.get_vars() for item in items], indent = None, ensure_ascii = False))
            except Exception as e:
                self.debug(Localizer.get().log_write_cache_file_fail, e)

        # 保存项目数据到文件
        path = f"{output_folder}/cache/project.json"
        with CacheManager.FILE_LOCK:
            try:
                with open(path, "w", encoding = "utf-8") as writer:
                    writer.write(json.dumps(project.get_vars(), indent = None, ensure_ascii = False))
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
                self.save_to_file(
                    project = self.project,
                    items = self.items,
                    output_folder = self.save_to_file_require_path,
                )

                # 触发事件
                self.emit(Base.Event.CACHE_FILE_AUTO_SAVE, {})

                # 重置标志
                self.save_to_file_require_flag = False

    # 请求保存缓存到文件
    def require_save_to_file(self, output_path: str) -> None:
        self.save_to_file_require_flag = True
        self.save_to_file_require_path = output_path

    # 从文件读取数据
    def load_from_file(self, output_path: str) -> None:
        path = f"{output_path}/cache/items.json"
        with CacheManager.FILE_LOCK:
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    self.items = [CacheItem(item) for item in json.load(reader)]
            except Exception as e:
                self.debug(Localizer.get().log_read_cache_file_fail, e)

        path = f"{output_path}/cache/project.json"
        with CacheManager.FILE_LOCK:
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    self.project = CacheProject(json.load(reader))
            except Exception as e:
                self.debug(Localizer.get().log_read_cache_file_fail, e)

    # 从文件读取项目数据
    def load_project_from_file(self, output_path: str) -> None:
        path = f"{output_path}/cache/project.json"
        with CacheManager.FILE_LOCK:
            try:
                with open(path, "r", encoding = "utf-8-sig") as reader:
                    self.project = CacheProject(json.load(reader))
            except Exception as e:
                self.debug(Localizer.get().log_read_cache_file_fail, e)

    # 设置缓存数据
    def set_items(self, items: list[CacheItem]) -> None:
        self.items = items

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

    # 复制缓存数据
    def copy_items(self) -> list[CacheItem]:
        return [CacheItem({
            "src": item.get_src(),
            "dst": item.get_dst(),
            "extra_field": item.get_extra_field(),
            "tag": item.get_tag(),
            "row": item.get_row(),
            "file_type": item.get_file_type(),
            "file_path": item.get_file_path(),
            "status": item.get_status(),
            "retry_count": item.get_retry_count(),
        }) for item in self.items]

    # 获取缓存数据数量（根据翻译状态）
    def get_item_count_by_status(self, status: int) -> int:
        return len([item for item in self.items if item.get_status() == status])

    # 生成缓存数据条目片段
    def generate_item_chunks(self, limit: int) -> list[list[CacheItem]]:
        # 根据 Token 阈值计算行数阈值，避免大量短句导致行数太多
        line_limit = max(8, int(limit / 16))

        chunk: list[CacheItem] = []
        chunks: list[list[CacheItem]] = []
        preceding_chunks: list[list[CacheItem]] = []
        chunk_length: int = 0
        for item in [v for v in self.items if v.get_status() == Base.TranslationStatus.UNTRANSLATED]:
            current_length = item.get_token_count()

            # 每个片段的第一条不判断是否超限，以避免特别长的文本导致死循环
            if len(chunk) == 0:
                pass
            # 如果 Token/行数 超限 或 数据来源跨文件，则结束此片段
            elif chunk_length + current_length > limit or len(chunk) >= line_limit or item.get_file_path() != chunk[-1].get_file_path():
                chunks.append(chunk)
                if len(chunks) <= 1:
                    preceding_chunks.append([])
                else:
                    preceding_chunks.append(self.generate_preceding_chunks(chunk[-1], chunks[-2]))

                chunk = []
                chunk_length = 0

            chunk.append(item)
            chunk_length = chunk_length + current_length

        # 如果还有剩余数据，则添加到列表中
        if len(chunk) > 0:
            chunks.append(chunk)
            if len(chunks) <= 1:
                preceding_chunks.append([])
            else:
                preceding_chunks.append(self.generate_preceding_chunks(chunk[-1], chunks[-2]))

        return chunks, preceding_chunks

    # 生成参考上文数据条目片段
    def generate_preceding_chunks(self, end: CacheItem, chunk: list[CacheItem]) -> list[list[CacheItem]]:
        result: list[CacheItem] = []

        # 没有候选数据时返回空值
        if len(chunk) == 0:
            return []

        # 候选数据与当前任务不在同一个文件中时，返回空值
        if end.get_file_path() != chunk[-1].get_file_path():
            return []

        # 逆序
        for item in sorted(chunk, key = lambda x: x.get_row(), reverse = True):
            src = item.get_src().strip()

            if src.endswith(CacheManager.END_LINE_PUNCTUATION):
                result.append(item)

            if len(result) >= 3:
                break

        return sorted(result, key = lambda x: x.get_row(), reverse = False)