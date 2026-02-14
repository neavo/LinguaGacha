from __future__ import annotations

import re
from pathlib import Path


def normalize_icon_member_name(stem: str) -> str:
    """将文件名 stem（如 'add-item'）转换为 Enum 成员名（如 'ADD_ITEM'）。"""

    name: str = re.sub(r"[^0-9A-Za-z]+", "_", stem).strip("_").upper()
    if not name:
        return "ICON"

    if name[0].isdigit():
        return f"ICON_{name}"

    return name


def generate_base_icon_module_text(icon_filenames: list[str]) -> str:
    members: list[str] = []
    used_names: dict[str, int] = {}

    for filename in icon_filenames:
        stem: str = Path(filename).stem
        member_name: str = normalize_icon_member_name(stem)

        # 规避极少数规范化后重名的情况
        count: int = used_names.get(member_name, 0) + 1
        used_names[member_name] = count
        if count > 1:
            member_name = f"{member_name}_{count}"

        members.append(f'    {member_name} = "{filename}"')

    members_text: str = "\n".join(members)

    return (
        "\n".join(
            [
                "from __future__ import annotations",
                "",
                "from enum import Enum",
                "from pathlib import Path",
                "",
                "from PySide6.QtCore import Qt",
                "from PySide6.QtGui import QColor",
                "from PySide6.QtGui import QIcon",
                "from PySide6.QtGui import QPainter",
                "from qfluentwidgets import FluentIconBase",
                "from qfluentwidgets import Theme",
                "from qfluentwidgets import getIconColor",
                "from qfluentwidgets import isDarkTheme",
                "from qfluentwidgets.common.icon import SvgIconEngine",
                "from qfluentwidgets.common.icon import drawSvgIcon",
                "",
                "# 注意：本文件由 buildtools/generate_base_icon.py 自动生成。",
                "# 请不要手工修改，更新图标后重新运行生成脚本即可。",
                "",
                "svg_source_cache: dict[str, str] = {}",
                "svg_colored_cache: dict[tuple[str, str], str] = {}",
                "qicon_cache: dict[tuple[str, str], QIcon] = {}",
                "",
                "",
                "def get_svg_source(svg_path: str) -> str:",
                "    cached: str | None = svg_source_cache.get(svg_path)",
                "    if cached is not None:",
                "        return cached",
                "",
                '    svg_text: str = Path(svg_path).read_text(encoding="utf-8")',
                "    svg_source_cache[svg_path] = svg_text",
                "    return svg_text",
                "",
                "",
                "def get_colored_svg(svg_path: str, color: str) -> str:",
                "    key: tuple[str, str] = (svg_path, color)",
                "    cached: str | None = svg_colored_cache.get(key)",
                "    if cached is not None:",
                "        return cached",
                "",
                "    # Lucide 图标基于 'currentColor'，替换它即可让整张图标随主题变化。",
                "    svg_text: str = get_svg_source(svg_path)",
                '    colored_svg: str = svg_text.replace("currentColor", color)',
                "    svg_colored_cache[key] = colored_svg",
                "    return colored_svg",
                "",
                "",
                "def get_cached_qicon(svg_path: str, color: str) -> QIcon:",
                "    key: tuple[str, str] = (svg_path, color)",
                "    cached: QIcon | None = qicon_cache.get(key)",
                "    if cached is not None:",
                "        return cached",
                "",
                "    svg: str = get_colored_svg(svg_path, color)",
                "    icon: QIcon = QIcon(SvgIconEngine(svg))",
                "    qicon_cache[key] = icon",
                "    return icon",
                "",
                "",
                "class BaseIcon(FluentIconBase, Enum):",
                "    def path(self, theme: Theme = Theme.AUTO) -> str:",
                "        # 保持相对路径：app.py 会将 cwd 锁定到 app_dir，确保可访问 resource/。",
                '        return f"resource/icon/{self.value}"',
                "",
                "    def icon(self, theme: Theme = Theme.AUTO, color: QColor | Qt.GlobalColor | str | None = None) -> QIcon:",
                "        svg_path: str = self.path(theme)",
                "",
                "        if color is None:",
                "            # qfluentwidgets 约定：浅色主题用黑色图标，深色主题用白色图标。",
                "            color = QColor(getIconColor(theme)).name()",
                "        else:",
                "            color = QColor(color).name()",
                "",
                "        return get_cached_qicon(svg_path, color)",
                "",
                '    def colored(self, lightColor: QColor | Qt.GlobalColor | str, darkColor: QColor | Qt.GlobalColor | str) -> "ColoredBaseIcon":',
                "        return ColoredBaseIcon(self, QColor(lightColor), QColor(darkColor))",
                "",
                "    def render(self, painter: QPainter, rect, theme: Theme = Theme.AUTO, indexes=None, **attributes) -> None:",
                "        # drawIcon() 会调用 render()；这里保持与 icon()/qicon() 行为一致。",
                "        svg_path: str = self.path(theme)",
                "",
                '        override = attributes.get("stroke") or attributes.get("fill")',
                "        color: str = QColor(override or getIconColor(theme)).name()",
                "        svg: str = get_colored_svg(svg_path, color)",
                "        drawSvgIcon(svg.encode(), painter, rect)",
                "",
                members_text,
                "",
                "",
                "class ColoredBaseIcon(FluentIconBase):",
                "    def __init__(self, source_icon: BaseIcon, light_color: QColor, dark_color: QColor) -> None:",
                "        super().__init__()",
                "        self.source_icon = source_icon",
                "        self.light_color = light_color",
                "        self.dark_color = dark_color",
                "",
                "    def path(self, theme: Theme = Theme.AUTO) -> str:",
                "        return self.source_icon.path(theme)",
                "",
                "    def icon(self, theme: Theme = Theme.AUTO, color: QColor | Qt.GlobalColor | str | None = None) -> QIcon:",
                "        if color is not None:",
                "            return self.source_icon.icon(theme, color=color)",
                "",
                "        if theme == Theme.AUTO:",
                "            selected: QColor = self.dark_color if isDarkTheme() else self.light_color",
                "        else:",
                "            selected = self.dark_color if theme == Theme.DARK else self.light_color",
                "",
                "        return self.source_icon.icon(theme, color=selected)",
                "",
                "    def render(self, painter: QPainter, rect, theme: Theme = Theme.AUTO, indexes=None, **attributes) -> None:",
                "        if theme == Theme.AUTO:",
                "            selected: QColor = self.dark_color if isDarkTheme() else self.light_color",
                "        else:",
                "            selected = self.dark_color if theme == Theme.DARK else self.light_color",
                "",
                "        svg_path: str = self.path(theme)",
                '        override = attributes.get("stroke") or attributes.get("fill")',
                "        color: str = QColor(override or selected).name()",
                "        svg: str = get_colored_svg(svg_path, color)",
                "        drawSvgIcon(svg.encode(), painter, rect)",
            ]
        )
        + "\n"
    )


def generate_base_icon_module() -> None:
    root: Path = Path(__file__).resolve().parents[1]
    icon_dir: Path = root / "resource" / "icon"
    icon_filenames: list[str] = sorted(p.name for p in icon_dir.glob("*.svg"))

    target: Path = root / "base" / "BaseIcon.py"
    target.write_text(generate_base_icon_module_text(icon_filenames), encoding="utf-8")


def main() -> None:
    generate_base_icon_module()


if __name__ == "__main__":
    main()
