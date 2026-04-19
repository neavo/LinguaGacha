from types import SimpleNamespace

import pytest

from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionConflictError,
)
from module.Data.Proofreading.ProofreadingRevisionService import (
    ProofreadingRevisionService,
)


def build_service(
    meta_store: dict[str, object] | None = None,
) -> tuple[ProofreadingRevisionService, dict[str, object]]:
    stored_meta = {} if meta_store is None else meta_store
    meta_service = SimpleNamespace(
        get_meta=lambda key, default=0: stored_meta.get(key, default),
        set_meta=lambda key, value: stored_meta.__setitem__(key, value),
    )
    return ProofreadingRevisionService(meta_service), stored_meta


@pytest.mark.parametrize(
    ("raw_revision", "expected_revision"),
    [
        ("5", 5),
        ("bad", 0),
        (-3, 0),
    ],
)
def test_get_revision_normalizes_invalid_values(
    raw_revision: object,
    expected_revision: int,
) -> None:
    service, meta_store = build_service(
        {"proofreading_revision.proofreading": raw_revision}
    )

    revision = service.get_revision("proofreading")

    assert revision == expected_revision
    assert meta_store["proofreading_revision.proofreading"] == raw_revision


def test_assert_revision_raises_when_snapshot_is_stale() -> None:
    service, _meta_store = build_service({"proofreading_revision.proofreading": 2})

    with pytest.raises(ProofreadingRevisionConflictError, match="当前=2，期望=1"):
        service.assert_revision("proofreading", 1)


def test_bump_revision_reads_current_value_and_writes_next_revision() -> None:
    service, meta_store = build_service({"proofreading_revision.proofreading": 3})

    new_revision = service.bump_revision("proofreading")

    assert new_revision == 4
    assert meta_store["proofreading_revision.proofreading"] == 4
