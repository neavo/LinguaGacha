from pathlib import Path

import pytest


@pytest.fixture
def lg_path(tmp_path: Path) -> str:
    # 根 conftest 只保留跨 application 与 client 都会复用的共享路径夹具。
    project_path = tmp_path / "demo.lg"
    project_path.write_text("{}", encoding="utf-8")
    return str(project_path)
