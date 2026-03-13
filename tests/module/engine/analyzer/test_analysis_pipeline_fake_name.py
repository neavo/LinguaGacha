from model.Item import Item
from module.Data.DataManager import DataManager
from module.Engine.Analyzer.AnalysisModels import AnalysisItemContext
from module.Engine.Analyzer.AnalysisModels import AnalysisTaskContext

from tests.module.engine.analyzer.support import build_request_pipeline
from tests.module.engine.analyzer.support import capture_chunk_log
from tests.module.engine.analyzer.support import stub_glossary_request


def build_context(source_text: str) -> AnalysisTaskContext:
    return AnalysisTaskContext(
        task_fingerprint="fp",
        file_path="story.txt",
        items=(
            AnalysisItemContext(
                item_id=1,
                file_path="story.txt",
                source_text=source_text,
                source_hash="h1",
            ),
        ),
    )


class TestAnalysisPipelineFakeName:
    def test_execute_task_request_injects_fake_name_only_for_model_request(
        self, monkeypatch
    ) -> None:
        pipeline = build_request_pipeline()
        context = build_context(r"村长\n[7]来了")
        captured_request_srcs: dict[str, list[str]] = {}
        captured_chunk_log = capture_chunk_log(monkeypatch, pipeline)

        stub_glossary_request(
            monkeypatch,
            response_result="<why>当前文本没有稳定术语</why>\n```jsonline\n\n```",
            on_generate=lambda srcs: captured_request_srcs.update({"srcs": srcs}),
        )

        result = pipeline.execute_task_request(context)

        assert result.success is True
        assert captured_request_srcs["srcs"] == ["村长蓝霁云来了"]
        assert captured_chunk_log["srcs"] == [r"村长\n[7]来了"]
        assert captured_chunk_log["glossary_entries"] == []

    def test_execute_task_request_restores_fake_name_only_terms_to_control_code_self_mapping(
        self, monkeypatch
    ) -> None:
        pipeline = build_request_pipeline()
        context = build_context(r"村长\n[7]来了")
        captured_chunk_log = capture_chunk_log(monkeypatch, pipeline)

        stub_glossary_request(
            monkeypatch,
            response_result='{"src":"蓝霁云","dst":"爱丽丝","type":"女性人名"}',
        )

        result = pipeline.execute_task_request(context)

        assert result.success is True
        assert list(result.glossary_entries) == [
            {
                "src": r"\n[7]",
                "dst": r"\n[7]",
                "info": "女性人名",
                "case_sensitive": False,
            }
        ]
        assert captured_chunk_log["status_text"] == ""
        assert captured_chunk_log["glossary_entries"] == [
            {
                "src": r"\n[7]",
                "dst": r"\n[7]",
                "info": "女性人名",
                "case_sensitive": False,
            }
        ]
        assert captured_chunk_log["srcs"] == [r"村长\n[7]来了"]

    def test_execute_task_request_still_filters_fake_name_mixed_terms(
        self, monkeypatch
    ) -> None:
        pipeline = build_request_pipeline()
        context = build_context(r"村长\n[7]来了")
        captured_chunk_log = capture_chunk_log(monkeypatch, pipeline)

        stub_glossary_request(
            monkeypatch,
            response_result='{"src":"村长蓝霁云","dst":"村长爱丽丝","type":"女性人名"}',
        )

        result = pipeline.execute_task_request(context)

        assert result.success is False
        assert result.glossary_entries == tuple()
        assert captured_chunk_log["glossary_entries"] == []
        assert captured_chunk_log["srcs"] == [r"村长\n[7]来了"]

    def test_execute_task_request_keeps_normal_terms_when_source_contains_control_code(
        self, monkeypatch
    ) -> None:
        pipeline = build_request_pipeline()
        context = build_context(r"村长\n[7]在教堂祈祷")
        captured_chunk_log = capture_chunk_log(monkeypatch, pipeline)

        stub_glossary_request(
            monkeypatch,
            response_result='{"src":"教堂","dst":"Church","type":"地名"}',
            input_tokens=3,
            output_tokens=4,
        )

        result = pipeline.execute_task_request(context)

        assert result.success is True
        assert list(result.glossary_entries) == [
            {
                "src": "教堂",
                "dst": "Church",
                "info": "地名",
                "case_sensitive": False,
            }
        ]
        assert captured_chunk_log["glossary_entries"] == [
            {
                "src": "教堂",
                "dst": "Church",
                "info": "地名",
                "case_sensitive": False,
            }
        ]

    def test_build_analysis_source_text_keeps_original_hash_input_unchanged(
        self,
    ) -> None:
        item = Item(id=1, src=r"正文\n[7]", name_src="角色名")

        assert DataManager.build_analysis_source_text(item) == "角色名\n正文\\n[7]"
