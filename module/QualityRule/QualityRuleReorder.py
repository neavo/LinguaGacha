from __future__ import annotations

from enum import StrEnum


class QualityRuleReorder:
    """质量规则列表重排器（纯逻辑）。

    目标：
    - 把排序规则从 UI 事件中解耦，保证可单测与可复用
    - 始终输出“原索引 -> 新顺序”的映射，业务层决定何时写回
    """

    class Operation(StrEnum):
        MOVE_UP = "MOVE_UP"
        MOVE_DOWN = "MOVE_DOWN"
        MOVE_TOP = "MOVE_TOP"
        MOVE_BOTTOM = "MOVE_BOTTOM"

    @staticmethod
    def identity_order(total_count: int) -> list[int]:
        if total_count <= 0:
            return []
        return list(range(int(total_count)))

    @staticmethod
    def normalize_rows(rows: list[int], total_count: int) -> list[int]:
        if total_count <= 0:
            return []
        return sorted({row for row in rows if 0 <= row < total_count})

    @staticmethod
    def build_order_for_drop(
        total_count: int,
        source_row: int,
        target_row: int,
    ) -> list[int]:
        rows = __class__.normalize_rows([source_row], total_count)
        if not rows:
            return __class__.identity_order(total_count)
        return __class__.build_order_move_to_index(total_count, rows, target_row)

    @staticmethod
    def build_order_move_to_index(
        total_count: int,
        moving_rows: list[int],
        target_index: int,
    ) -> list[int]:
        base_order = __class__.identity_order(total_count)
        rows = __class__.normalize_rows(moving_rows, total_count)
        if not rows:
            return base_order

        row_set = set(rows)
        remaining = [index for index in base_order if index not in row_set]
        if not remaining:
            return base_order

        # 允许目标位置等于 total_count，表示插入到末尾（append）。
        bounded_target = max(0, min(int(target_index), total_count))
        # 目标位置基于“完整列表”计算，插入前需要扣掉被移动行在目标之前的数量。
        insert_index = bounded_target - sum(1 for row in rows if row < bounded_target)
        insert_index = max(0, min(insert_index, len(remaining)))

        moved = remaining[:insert_index] + rows + remaining[insert_index:]
        if moved == base_order:
            return base_order
        return moved

    @staticmethod
    def build_order_for_operation(
        total_count: int,
        moving_rows: list[int],
        operation: "QualityRuleReorder.Operation",
    ) -> list[int]:
        if operation == __class__.Operation.MOVE_UP:
            return __class__.build_order_move_up(total_count, moving_rows)
        if operation == __class__.Operation.MOVE_DOWN:
            return __class__.build_order_move_down(total_count, moving_rows)
        if operation == __class__.Operation.MOVE_TOP:
            return __class__.build_order_move_top(total_count, moving_rows)
        if operation == __class__.Operation.MOVE_BOTTOM:
            return __class__.build_order_move_bottom(total_count, moving_rows)
        return __class__.identity_order(total_count)

    @staticmethod
    def build_order_move_up(total_count: int, moving_rows: list[int]) -> list[int]:
        order = __class__.identity_order(total_count)
        rows = __class__.normalize_rows(moving_rows, total_count)
        if not rows:
            return order

        row_set = set(rows)
        for index in range(1, total_count):
            if index not in row_set:
                continue
            if (index - 1) in row_set:
                continue
            order[index - 1], order[index] = order[index], order[index - 1]
        return order

    @staticmethod
    def build_order_move_down(total_count: int, moving_rows: list[int]) -> list[int]:
        order = __class__.identity_order(total_count)
        rows = __class__.normalize_rows(moving_rows, total_count)
        if not rows:
            return order

        row_set = set(rows)
        for index in range(total_count - 2, -1, -1):
            if index not in row_set:
                continue
            if (index + 1) in row_set:
                continue
            order[index], order[index + 1] = order[index + 1], order[index]
        return order

    @staticmethod
    def build_order_move_top(total_count: int, moving_rows: list[int]) -> list[int]:
        order = __class__.identity_order(total_count)
        rows = __class__.normalize_rows(moving_rows, total_count)
        if not rows:
            return order

        row_set = set(rows)
        remaining = [index for index in order if index not in row_set]
        return rows + remaining

    @staticmethod
    def build_order_move_bottom(total_count: int, moving_rows: list[int]) -> list[int]:
        order = __class__.identity_order(total_count)
        rows = __class__.normalize_rows(moving_rows, total_count)
        if not rows:
            return order

        row_set = set(rows)
        remaining = [index for index in order if index not in row_set]
        return remaining + rows
