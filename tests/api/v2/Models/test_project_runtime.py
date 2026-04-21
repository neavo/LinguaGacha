from api.v2.Models.ProjectRuntime import RowBlock


def test_v2_row_block_to_dict_serializes_rows_as_json_ready_lists() -> None:
    # Arrange
    row_block = RowBlock(
        schema="project-items.v1",
        fields=("item_id", "status"),
        rows=(
            (1, "TODO"),
            (2, "DONE"),
        ),
    )

    # Act
    result = row_block.to_dict()

    # Assert
    assert result == {
        "schema": "project-items.v1",
        "fields": ["item_id", "status"],
        "rows": [
            [1, "TODO"],
            [2, "DONE"],
        ],
    }
