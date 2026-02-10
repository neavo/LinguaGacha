from base.Base import Base
from model.Item import Item
from module.ChunkGenerator import ChunkGenerator


def make_item(
    src: str,
    *,
    file_path: str = "a.txt",
    status: Base.ProjectStatus = Base.ProjectStatus.NONE,
) -> Item:
    return Item(src=src, file_path=file_path, status=status)


class TestChunkGenerator:
    def test_generate_item_chunks_splits_when_file_changes(self) -> None:
        items = [
            make_item("a1", file_path="a.txt"),
            make_item("a2", file_path="a.txt"),
            make_item("b1", file_path="b.txt"),
        ]

        chunks, preceding_chunks = ChunkGenerator.generate_item_chunks(
            items=items,
            input_token_threshold=1000,
            preceding_lines_threshold=3,
        )

        assert [len(chunk) for chunk in chunks] == [2, 1]
        assert preceding_chunks[1] == []

    def test_generate_item_chunks_skips_non_none_status_items(self) -> None:
        items = [
            make_item("line-1"),
            make_item("line-2", status=Base.ProjectStatus.PROCESSED),
            make_item("line-3"),
        ]

        chunks, _ = ChunkGenerator.generate_item_chunks(
            items=items,
            input_token_threshold=1000,
            preceding_lines_threshold=3,
        )

        flattened = [item.get_src() for chunk in chunks for item in chunk]
        assert flattened == ["line-1", "line-3"]

    def test_generate_item_chunks_splits_when_line_limit_exceeded(self) -> None:
        items = [
            make_item("\n".join([f"line-{i}" for i in range(8)])),
            make_item("line-9"),
        ]

        chunks, _ = ChunkGenerator.generate_item_chunks(
            items=items,
            input_token_threshold=16,
            preceding_lines_threshold=2,
        )

        assert [len(chunk) for chunk in chunks] == [1, 1]

    def test_generate_preceding_chunk_obeys_punctuation_and_threshold(self) -> None:
        items = [
            make_item("first.", file_path="a.txt"),
            make_item("second.", file_path="a.txt"),
            make_item("third.", file_path="a.txt"),
            make_item("target", file_path="a.txt"),
        ]

        preceding = ChunkGenerator.generate_preceding_chunk(
            items=items,
            chunk=[items[3]],
            start=4,
            skip=0,
            preceding_lines_threshold=2,
        )

        assert [item.get_src() for item in preceding] == ["second.", "third."]
