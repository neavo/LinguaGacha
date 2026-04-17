from __future__ import annotations

import inspect

import api.Contract.ProofreadingPayloads as proofreading_payloads


def test_proofreading_payloads_do_not_depend_on_data_layer_types() -> None:
    """契约层只能依赖 DTO 和标准类型，不能反向引用 Data 层实现类型。"""

    # 准备
    blocked_symbols = (
        "module.Data.Proofreading.ProofreadingSnapshotService",
        "ProofreadingLoadResult",
        "ProofreadingLoadKind",
    )

    # 执行
    source = inspect.getsource(proofreading_payloads)

    # 断言
    for blocked_symbol in blocked_symbols:
        assert blocked_symbol not in source
