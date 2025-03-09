import threading

import httpx

from base.Base import Base

class VersionManager(Base):

    VERSION: str = "v0.0.0"

    def __init__(self, version: str) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.APP_UPDATE_CHECK, self.app_updater_check)

        # 初始化
        VersionManager.VERSION = version

    # 检查更新
    def app_updater_check(self, event: int, data: dict) -> None:
        thread = threading.Thread(target = self.app_updater_check_task, args = (event, data))
        thread.start()

    # 检查更新开始
    def app_updater_check_task(self, event: int, data: dict) -> None:
        try:
            # 获取更新信息
            response = httpx.get("https://api.github.com/repos/neavo/LinguaGacha/releases/latest", timeout = 60)
            response.raise_for_status()

            # 发送完成事件
            self.emit(Base.Event.APP_UPDATE_CHECK_DONE, {
                "result": response.json()
            })
        except Exception as e:
            pass