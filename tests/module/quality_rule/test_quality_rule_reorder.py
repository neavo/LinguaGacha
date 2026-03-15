from typing import cast

from module.QualityRule.QualityRuleReorder import QualityRuleReorder


def apply_order(values: list[str], order: list[int]) -> list[str]:
    return [values[index] for index in order]


def test_build_order_for_drop_moves_source_row_to_target_position() -> None:
    order = QualityRuleReorder.build_order_for_drop(
        total_count=5,
        source_row=1,
        target_row=3,
    )

    assert apply_order(["a", "b", "c", "d", "e"], order) == ["a", "c", "b", "d", "e"]


def test_build_order_for_drop_supports_append_target_position() -> None:
    order = QualityRuleReorder.build_order_for_drop(
        total_count=5,
        source_row=1,
        target_row=5,
    )

    assert apply_order(["a", "b", "c", "d", "e"], order) == ["a", "c", "d", "e", "b"]


def test_move_up_on_top_row_is_no_op() -> None:
    order = QualityRuleReorder.build_order_move_up(total_count=4, moving_rows=[0])

    assert order == [0, 1, 2, 3]


def test_move_down_moves_each_selected_row_by_one_step() -> None:
    order = QualityRuleReorder.build_order_move_down(total_count=6, moving_rows=[1, 3])

    assert order == [0, 2, 1, 4, 3, 5]


def test_move_bottom_keeps_relative_order_of_selected_rows() -> None:
    order = QualityRuleReorder.build_order_move_bottom(
        total_count=6,
        moving_rows=[1, 3],
    )

    assert order == [0, 2, 4, 5, 1, 3]


def test_identity_and_normalize_rows_return_empty_when_non_positive_total() -> None:
    assert QualityRuleReorder.identity_order(0) == []
    assert QualityRuleReorder.identity_order(-1) == []
    assert QualityRuleReorder.normalize_rows([0, 1], 0) == []
    assert QualityRuleReorder.normalize_rows([0, 1], -3) == []


def test_build_order_for_drop_out_of_range_source_returns_identity() -> None:
    order = QualityRuleReorder.build_order_for_drop(
        total_count=4,
        source_row=99,
        target_row=1,
    )

    assert order == [0, 1, 2, 3]


def test_build_order_move_to_index_handles_empty_full_and_same_position() -> None:
    assert QualityRuleReorder.build_order_move_to_index(
        total_count=4,
        moving_rows=[],
        target_index=2,
    ) == [0, 1, 2, 3]
    assert QualityRuleReorder.build_order_move_to_index(
        total_count=4,
        moving_rows=[0, 1, 2, 3],
        target_index=2,
    ) == [0, 1, 2, 3]
    assert QualityRuleReorder.build_order_move_to_index(
        total_count=4,
        moving_rows=[1],
        target_index=1,
    ) == [0, 1, 2, 3]
    assert QualityRuleReorder.build_order_move_to_index(
        total_count=4,
        moving_rows=[1],
        target_index=4,
    ) == [0, 2, 3, 1]


def test_build_order_for_operation_dispatch_and_fallback() -> None:
    assert QualityRuleReorder.build_order_for_operation(
        total_count=4,
        moving_rows=[2],
        operation=QualityRuleReorder.Operation.MOVE_UP,
    ) == QualityRuleReorder.build_order_move_up(4, [2])
    assert QualityRuleReorder.build_order_for_operation(
        total_count=4,
        moving_rows=[1],
        operation=QualityRuleReorder.Operation.MOVE_DOWN,
    ) == QualityRuleReorder.build_order_move_down(4, [1])
    assert QualityRuleReorder.build_order_for_operation(
        total_count=4,
        moving_rows=[2],
        operation=QualityRuleReorder.Operation.MOVE_TOP,
    ) == QualityRuleReorder.build_order_move_top(4, [2])
    assert QualityRuleReorder.build_order_for_operation(
        total_count=4,
        moving_rows=[1],
        operation=QualityRuleReorder.Operation.MOVE_BOTTOM,
    ) == QualityRuleReorder.build_order_move_bottom(4, [1])

    assert QualityRuleReorder.build_order_for_operation(
        total_count=4,
        moving_rows=[1],
        operation=cast(QualityRuleReorder.Operation, "UNKNOWN"),
    ) == [0, 1, 2, 3]


def test_build_order_move_up_covers_empty_and_adjacent_rows() -> None:
    assert QualityRuleReorder.build_order_move_up(4, []) == [0, 1, 2, 3]
    assert QualityRuleReorder.build_order_move_up(4, [2]) == [0, 2, 1, 3]
    assert QualityRuleReorder.build_order_move_up(4, [1, 2]) == [1, 0, 2, 3]


def test_build_order_move_down_covers_empty_and_adjacent_rows() -> None:
    assert QualityRuleReorder.build_order_move_down(4, []) == [0, 1, 2, 3]
    assert QualityRuleReorder.build_order_move_down(4, [1, 2]) == [0, 1, 3, 2]


def test_build_order_move_top_normalizes_rows() -> None:
    assert QualityRuleReorder.build_order_move_top(4, []) == [0, 1, 2, 3]
    assert QualityRuleReorder.build_order_move_top(5, [3, 1, 1, 9, -1]) == [
        1,
        3,
        0,
        2,
        4,
    ]


def test_build_order_move_bottom_handles_empty_rows() -> None:
    assert QualityRuleReorder.build_order_move_bottom(4, []) == [0, 1, 2, 3]
