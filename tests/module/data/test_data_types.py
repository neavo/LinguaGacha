from dataclasses import FrozenInstanceError

import pytest

from module.Data.Core.DataTypes import ProjectPrefilterRequest


def test_project_prefilter_request_is_frozen() -> None:
    request = ProjectPrefilterRequest(
        lg_path="demo/project.lg",
        reason="project_loaded",
        source_language="JA",
        mtool_optimizer_enable=True,
    )

    assert request.reason == "project_loaded"

    with pytest.raises(FrozenInstanceError):
        request.reason = "config_updated"
