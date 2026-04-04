import json
from pathlib import Path


class CoreApiPortCatalog:
    """统一维护 Core API 候选端口清单，避免前后端各自长出一份配置。"""

    PORT_CANDIDATE_FILE_PATH: Path = (
        Path(__file__).resolve().parents[2]
        / "frontend-vite"
        / "core-api-port-candidates.json"
    )

    @classmethod
    def load_candidates(cls) -> tuple[int, ...]:
        """从共享契约文件读取候选端口，并保证顺序稳定。"""

        payload = json.loads(cls.PORT_CANDIDATE_FILE_PATH.read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError("Core API 候选端口配置格式错误。")

        normalized_ports: list[int] = []
        for port_raw in payload:
            port = int(port_raw)
            if port <= 0:
                raise ValueError("Core API 候选端口必须是正整数。")
            normalized_ports.append(port)

        if len(normalized_ports) == 0:
            raise ValueError("Core API 候选端口不能为空。")

        return tuple(normalized_ports)
