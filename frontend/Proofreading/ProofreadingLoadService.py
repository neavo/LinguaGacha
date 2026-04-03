from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadKind as ProofreadingLoadKind,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingLoadResult as ProofreadingLoadResult,
)
from module.Data.Proofreading.ProofreadingSnapshotService import (
    ProofreadingSnapshotService as ProofreadingSnapshotService,
)


class ProofreadingLoadService:
    """Proofreading 的加载编排服务。

    这个壳只保留旧入口名字，真正的加载逻辑已经下沉到 core。
    """

    @staticmethod
    def load_snapshot(expected_lg_path: str) -> ProofreadingLoadResult:
        """加载校对页所需数据快照。"""

        return ProofreadingSnapshotService().load_snapshot(expected_lg_path)
