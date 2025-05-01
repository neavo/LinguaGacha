import threading

from base.Base import Base
from base.BaseData import BaseData

class CacheProject(BaseData):

    def __init__(self, args: dict) -> None:
        super().__init__()

        # 默认值
        self.id: str = ""                                                               # 项目 ID
        self.status: Base.TranslationStatus = Base.TranslationStatus.UNTRANSLATED       # 翻译状态
        self.extras: dict = {}                                                          # 额外数据

        # 初始化
        for k, v in args.items():
            setattr(self, k, v)

        # 线程锁
        self.lock = threading.Lock()

    # 获取项目 ID
    def get_id(self) -> str:
        with self.lock:
            return self.id

    # 设置项目 ID
    def set_id(self, id: str) -> None:
        with self.lock:
            self.id = id

    # 获取翻译状态
    def get_status(self) -> Base.TranslationStatus:
        with self.lock:
            return self.status

    # 设置翻译状态
    def set_status(self, status: Base.TranslationStatus) -> None:
        with self.lock:
            self.status = status

    # 获取额外数据
    def get_extras(self) -> dict:
        with self.lock:
            return self.extras

    # 设置额外数据
    def set_extras(self, extras: dict) -> None:
        with self.lock:
            self.extras = extras
