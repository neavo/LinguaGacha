from __future__ import annotations

import threading


class ProjectFileService:
    """保留 Python Core 内部文件操作互斥锁，公开文件预演已迁到 TS。"""

    def __init__(self) -> None:
        """初始化文件操作互斥状态，避免工作台 mutation 与任务并发写入。"""

        self.file_op_lock = threading.Lock()
        self.file_op_running = False

    def is_file_op_running(self) -> bool:
        """读取当前文件操作临界区状态，供 runtime bridge 诊断和测试使用。"""

        with self.file_op_lock:
            return self.file_op_running

    def try_begin_file_operation(self) -> bool:
        """尝试进入文件操作临界区；已占用时返回 False 而不是抛异常。"""

        with self.file_op_lock:
            if self.file_op_running:
                return False
            self.file_op_running = True
            return True

    def finish_file_operation(self) -> None:
        """释放文件操作临界区，异常收尾也允许幂等调用。"""

        with self.file_op_lock:
            self.file_op_running = False
