from dataclasses import FrozenInstanceError

import pytest

from module.Data.Core.DataTypes import ProjectItemChange


def test_project_item_change_is_frozen() -> None:
    change = ProjectItemChange(
        item_ids=(1, 2),
        rel_paths=("script.txt",),
        reason="translation_batch_update",
    )

    assert change.reason == "translation_batch_update"

    with pytest.raises(FrozenInstanceError):
        change.reason = "config_updated"
