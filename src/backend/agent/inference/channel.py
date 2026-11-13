import json
import math
import struct
import sys
import threading
from concurrent.futures import Future
import numpy as np

HEADER_MAX = 64 * 1024
PAYLOAD_MAX = 64 * 1024 * 1024


class Channel:
    """与 Node 之间的请求通道。读线程按编号结算应答，对端退出或帧损坏时所有等待者失败。"""

    def __init__(self):
        """标准流只属于本通道，多线程写入共用一把锁。"""
        self.input, self.output = sys.stdin.buffer, sys.stdout.buffer
        self.lock = threading.Lock()
        self.pending, self.next = {}, 0

    def read_exact(self, size):
        """截断帧直接失败，不能把不完整载荷交给模型。"""
        data = self.input.read(size)
        if len(data) != size:
            raise EOFError("通道已关闭或帧被截断")
        return data

    def read(self):
        """先校验声明长度，再读取二进制载荷。"""
        (size,) = struct.unpack("<I", self.read_exact(4))
        if size > HEADER_MAX:
            raise ValueError(f"帧头过长：{size}")
        header = json.loads(self.read_exact(size))
        length = header.get("bytes", 0)
        if not isinstance(length, int) or not 0 <= length <= PAYLOAD_MAX:
            raise ValueError(f"载荷长度非法：{length}")
        return header, self.read_exact(length)

    def write(self, header, payload=b""):
        """帧头和载荷在同一锁内写入，避免并发请求交错。"""
        head = json.dumps(
            {**header, "bytes": len(payload)}, ensure_ascii=False
        ).encode()
        with self.lock:
            self.output.write(struct.pack("<I", len(head)) + head)
            self.output.write(payload)
            self.output.flush()

    def listen(self):
        """读线程。应答编号必须对应在途请求，否则视为协议错误。"""
        try:
            while True:
                header, payload = self.read()
                with self.lock:
                    future = self.pending.pop(header.get("id"), None)
                if future is None:
                    raise ValueError(f"未知应答：{header}")
                if "error" in header:
                    future.set_exception(RuntimeError(header["error"]))
                else:
                    future.set_result((header, payload))
        except BaseException as error:  # noqa: BLE001 读线程退出原因转交所有等待者。
            with self.lock:
                pending, self.pending = list(self.pending.values()), {}
            for future in pending:
                future.set_exception(error)

    def request(self, kind, array, **fields):
        """提交 float32 张量，返回 Future[(应答头, 载荷)]。"""
        array = np.ascontiguousarray(array, np.float32)
        future = Future()
        with self.lock:
            id, self.next = self.next, self.next + 1
            self.pending[id] = future
        self.write(
            {
                "id": id,
                "kind": kind,
                "dtype": "float32",
                "shape": list(array.shape),
                **fields,
            },
            memoryview(array).cast("B"),
        )
        return future


def tensor(header, payload):
    """按应答头还原 float32 张量，形状与字节数必须一致。"""
    shape = header["shape"]
    if header.get("dtype") != "float32" or 4 * math.prod(shape) != len(payload):
        raise ValueError(f"应答形状不符：{header}")
    return np.frombuffer(payload, np.float32).reshape(shape)
