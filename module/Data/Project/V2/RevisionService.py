class V2ProjectRevisionService:
    """维护 V2 项目运行态的全局 revision 与 section revision。"""

    DEFAULT_SECTIONS: tuple[str, ...] = (
        "project",
        "files",
        "items",
        "quality",
        "prompts",
        "analysis",
        "task",
    )

    def __init__(self) -> None:
        self.project_revision: int = 0
        self.section_revisions: dict[str, int] = {
            section: 0 for section in self.DEFAULT_SECTIONS
        }

    def bump(self, *sections: str) -> tuple[int, dict[str, int]]:
        """推进项目 revision，并只递增本次受影响的 section。"""

        self.project_revision += 1
        for section in sections:
            self.section_revisions[section] = self.section_revisions.get(section, 0) + 1
        return self.project_revision, dict(self.section_revisions)

    def snapshot(self) -> tuple[int, dict[str, int]]:
        """读取当前 revision 快照，供 reject / bootstrap 对账使用。"""

        return self.project_revision, dict(self.section_revisions)
