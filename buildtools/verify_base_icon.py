from __future__ import annotations

import sys
from pathlib import Path
from typing import Any


def import_base_icon() -> Any:
    project_root: Path = Path(__file__).resolve().parents[1]
    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    from base.BaseIcon import BaseIcon

    return BaseIcon


def verify_all_icon_files_exist() -> None:
    BaseIcon = import_base_icon()
    missing: list[str] = []

    for icon in BaseIcon:
        path: str = icon.path()
        if not Path(path).is_file():
            missing.append(path)

    if not missing:
        return

    joined: str = "\n".join(missing)
    raise FileNotFoundError(f"BaseIcon 对应的 SVG 文件不存在：\n{joined}")


def verify_icon_render_smoke() -> None:
    # 选取包含不同 SVG 元素的图标做基本冒烟测试（path / circle 等）
    BaseIcon = import_base_icon()
    samples: list[Any] = [
        BaseIcon.PLUS,
        BaseIcon.CIRCLE,
        BaseIcon.TAG,
        BaseIcon.IMAGE,
    ]

    for icon in samples:
        icon.icon()
        icon.icon(color="#ff0000")
        icon.colored("#00aa00", "#0000ff").icon()


def main() -> None:
    verify_all_icon_files_exist()
    verify_icon_render_smoke()


if __name__ == "__main__":
    main()
