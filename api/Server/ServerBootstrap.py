import threading
from collections.abc import Callable

from api.Server.CoreApiServer import CoreApiServer


class ServerBootstrap:
    """统一维护本地 HTTP 服务的启动与关闭入口。"""

    @classmethod
    def start_for_test(cls) -> tuple[str, Callable[[], None]]:
        """为测试启动独立服务，返回访问地址与关闭函数。"""

        core_api_server = CoreApiServer()
        core_api_server.register_routes()
        http_server = core_api_server.create_http_server()
        serve_thread = threading.Thread(
            target=http_server.serve_forever,
            daemon=True,
        )
        serve_thread.start()

        host, port = http_server.server_address
        base_url = f"http://{host}:{port}"

        def shutdown() -> None:
            """测试结束时统一关闭监听线程，避免端口泄漏。"""

            http_server.shutdown()
            http_server.server_close()
            serve_thread.join(timeout=1)

        return base_url, shutdown
