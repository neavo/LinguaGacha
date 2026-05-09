from __future__ import annotations

from module.Data.Project.ProjectFileService import ProjectFileService


def test_try_begin_file_operation_blocks_until_finish() -> None:
    service = ProjectFileService()

    assert service.try_begin_file_operation() is True
    assert service.is_file_op_running() is True
    assert service.try_begin_file_operation() is False

    service.finish_file_operation()

    assert service.is_file_op_running() is False
    assert service.try_begin_file_operation() is True


def test_finish_file_operation_is_idempotent() -> None:
    service = ProjectFileService()

    service.finish_file_operation()

    assert service.is_file_op_running() is False
