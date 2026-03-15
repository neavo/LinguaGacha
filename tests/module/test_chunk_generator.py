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

    def test_generate_item_chunks_returns_empty_when_all_items_are_skipped(
        self,
    ) -> None:
        items = [
            make_item("line-1", status=Base.ProjectStatus.PROCESSED),
            make_item("line-2", status=Base.ProjectStatus.PROCESSED_IN_PAST),
        ]

        chunks, preceding_chunks = ChunkGenerator.generate_item_chunks(
            items=items,
            input_token_threshold=1000,
            preceding_lines_threshold=2,
        )

        assert chunks == []
        assert preceding_chunks == []

    def test_generate_item_chunks_splits_when_token_limit_exceeded(self) -> None:
        items = [
            make_item("first"),
            make_item("second"),
        ]

        chunks, _ = ChunkGenerator.generate_item_chunks(
            items=items,
            input_token_threshold=0,
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

    def test_generate_preceding_chunk_skips_excluded_and_empty_items(self) -> None:
        items = [
            make_item("skip.", file_path="a.txt", status=Base.ProjectStatus.EXCLUDED),
            make_item("   ", file_path="a.txt"),
            make_item("kept.", file_path="a.txt"),
            make_item("target", file_path="a.txt"),
        ]

        preceding = ChunkGenerator.generate_preceding_chunk(
            items=items,
            chunk=[items[3]],
            start=4,
            skip=0,
            preceding_lines_threshold=2,
        )

        assert [item.get_src() for item in preceding] == ["kept."]

    def test_generate_preceding_chunk_skips_rule_and_language_skipped(self) -> None:
        items = [
            make_item("skip.", status=Base.ProjectStatus.RULE_SKIPPED),
            make_item("skip.", status=Base.ProjectStatus.LANGUAGE_SKIPPED),
            make_item("kept."),
            make_item("target"),
        ]

        preceding = ChunkGenerator.generate_preceding_chunk(
            items=items,
            chunk=[items[3]],
            start=4,
            skip=0,
            preceding_lines_threshold=2,
        )

        assert [item.get_src() for item in preceding] == ["kept."]

    def test_generate_preceding_chunk_stops_when_sentence_has_no_end_punctuation(
        self,
    ) -> None:
        items = [
            make_item("valid."),
            make_item("no-ending"),
            make_item("target"),
        ]

        preceding = ChunkGenerator.generate_preceding_chunk(
            items=items,
            chunk=[items[2]],
            start=3,
            skip=0,
            preceding_lines_threshold=2,
        )

        assert preceding == []

    def test_generate_preceding_chunk_stops_when_file_changes(self) -> None:
        items = [
            make_item("cross-file.", file_path="a.txt"),
            make_item("target", file_path="b.txt"),
        ]

        preceding = ChunkGenerator.generate_preceding_chunk(
            items=items,
            chunk=[items[1]],
            start=2,
            skip=0,
            preceding_lines_threshold=2,
        )

        assert preceding == []
