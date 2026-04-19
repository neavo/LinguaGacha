import os
from pathlib import Path

import pytest
from pyfakefs.fake_filesystem import FakeFilesystem


@pytest.fixture
def lg_path(fs: FakeFilesystem) -> str:
    # 根 conftest 只保留跨 application 与 client 都会复用的共享路径夹具。
    project_path = Path(os.path.abspath(os.sep)) / "workspace" / "demo.lg"
    fs.create_file(str(project_path), contents="{}", create_missing_dirs=True)
    return str(project_path)
