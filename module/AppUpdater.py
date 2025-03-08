import threading

import httpx

from base.Base import Base

class AppUpdater(Base):

    def __init__(self) -> None:
        super().__init__()

        # 注册事件
        self.subscribe(Base.Event.APP_UPDATER_CHECK, self.app_updater_check)

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
            self.emit(Base.Event.APP_UPDATER_CHECK_DONE, {
                "result": response.json()
            })
        except Exception as e:
            pass