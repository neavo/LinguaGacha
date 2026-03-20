from collections.abc import Generator
from typing import Any
from types import SimpleNamespace

import pytest

from base.Base import Base
from model.Item import Item
from module.Config import Config
from module.Data.DataManager import DataManager
from module.Engine.TaskRequestErrors import RequestCancelledError
from module.Engine.TaskRequestErrors import RequestHardTimeoutError
from module.Engine.TaskRequestErrors import StreamDegradationError
from module.Engine.TaskRequestExecutor import TaskRequestResult
from module.Engine.Translation.TranslationTask import TranslationTask
from module.QualityRule.QualityRuleSnapshot import QualityRuleSnapshot
from module.Response.ResponseCleaner import ResponseCleaner
from module.Response.ResponseChecker import ResponseChecker
from module.TextProcessor import TextProcessor


def create_snapshot(
    *,
    text_preserve_mode: DataManager.TextPreserveMode = DataManager.TextPreserveMode.CUSTOM,
    text_preserve_entries: tuple[dict, ...] = (),
) -> QualityRuleSnapshot:
    return QualityRuleSnapshot(
        glossary_enable=False,
        text_preserve_mode=text_preserve_mode,
        text_preserve_entries=text_preserve_entries,
        pre_replacement_enable=False,
        pre_replacement_entries=(),
        post_replacement_enable=False,
        post_replacement_entries=(),
        translation_prompt_enable=False,
        translation_prompt="",
        analysis_prompt_enable=False,
        analysis_prompt="",
        glossary_entries=[],
    )


@pytest.fixture(autouse=True)
def reset_text_processor_rule_cache() -> Generator[None, None, None]:
    TextProcessor.reset()
    yield
    TextProcessor.reset()


class FakeProcessor:
    def __init__(self, srcs: list[str], post_result: tuple[str | None, str]) -> None:
        self.srcs = srcs
        self.samples: list[str] = []
        self.post_result = post_result
        self.post_args: list[str] = []

    def pre_process(self) -> None:
        return None

    def post_process(self, dsts: list[str]) -> tuple[str | None, str]:
        self.post_args = dsts
        return self.post_result


class FakeResponseChecker:
    def __init__(self, checks: list[ResponseChecker.Error]) -> None:
        self.checks = checks
        self.calls: list[dict[str, Any]] = []

    def check(
        self,
        srcs: list[str],
        dsts: list[str],
        text_type: Item.TextType,
        *,
        stream_degraded: bool = False,
    ) -> list[ResponseChecker.Error]:
        self.calls.append(
            {
                "srcs": srcs,
                "dsts": dsts,
                "text_type": text_type,
                "stream_degraded": stream_degraded,
            }
        )
        return self.checks


class FakeLogManager:
    def __init__(self, *, expert_mode: bool = False) -> None:
        self.expert_mode = expert_mode
        self.calls: list[dict[str, Any]] = []
        self.rich_messages: list[Any] = []

    def is_expert_mode(self) -> bool:
        return self.expert_mode

    def info(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.calls.append(
            {
                "level": "info",
                "msg": msg,
                "e": e,
                "file": file,
                "console": console,
            }
        )

    def warning(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.calls.append(
            {
                "level": "warning",
                "msg": msg,
                "e": e,
                "file": file,
                "console": console,
            }
        )

    def error(
        self,
        msg: str,
        e: Exception | BaseException | None = None,
        file: bool = True,
        console: bool = True,
    ) -> None:
        self.calls.append(
            {
                "level": "error",
                "msg": msg,
                "e": e,
                "file": file,
                "console": console,
            }
        )

    def print_rich(self, renderable: object) -> None:
        self.rich_messages.append(renderable)


def create_task(
    *,
    src: str = "hello",
    skip_response_check: bool = True,
    model: dict[str, Any] | None = None,
) -> TranslationTask:
    item = Item(src=src, text_type=Item.TextType.NONE)
    return TranslationTask(
        config=Config(auto_process_prefix_suffix_preserved_text=False),
        model=model or {"api_format": Base.APIFormat.OPENAI},
        items=[item],
        precedings=[],
        skip_response_check=skip_response_check,
    )


def create_request_response(
    *,
    start_time: float = 1.0,
    exception: Exception | None = None,
    normalized_think: str = "",
    cleaned_response_result: str = "",
    input_tokens: int = 0,
    output_tokens: int = 0,
    decoded_translations: tuple[str, ...] = tuple(),
    decoded_glossary_entries: tuple[dict[str, Any], ...] = tuple(),
) -> TaskRequestResult:
    return TaskRequestResult(
        start_time=start_time,
        exception=exception,
        response_think=normalized_think,
        response_result=cleaned_response_result,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        normalized_think=normalized_think,
        cleaned_response_result=cleaned_response_result,
        has_why_block=False,
        decoded_translations=decoded_translations,
        decoded_glossary_entries=decoded_glossary_entries,
    )


class TestTranslationTaskPrepareRequestData:
    def test_prepare_request_data_marks_done_when_all_lines_are_skipped(self) -> None:
        item = Item(src="<b></b>\n<i></i>", text_type=Item.TextType.NONE)
        config = Config(auto_process_prefix_suffix_preserved_text=False)
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.CUSTOM,
            text_preserve_entries=({"src": "<[^>]+>"},),
        )
        task = TranslationTask(
            config=config,
            model={"api_format": Base.APIFormat.OPENAI},
            items=[item],
            precedings=[],
            skip_response_check=True,
            quality_snapshot=snapshot,
        )

        prepared = task.prepare_request_data(
            task.items, task.processors, task.precedings
        )

        assert prepared["done"] is True
        assert prepared["result"]["row_count"] == 1
        assert item.get_dst() == item.get_src()
        assert item.get_status() == Base.ProjectStatus.PROCESSED

    def test_prepare_request_data_not_done_when_some_lines_still_need_translation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="<b></b>\nhello", text_type=Item.TextType.NONE)
        config = Config(auto_process_prefix_suffix_preserved_text=False)
        snapshot = create_snapshot(
            text_preserve_mode=DataManager.TextPreserveMode.CUSTOM,
            text_preserve_entries=({"src": "<[^>]+>"},),
        )
        task = TranslationTask(
            config=config,
            model={"api_format": Base.APIFormat.OPENAI},
            items=[item],
            precedings=[],
            skip_response_check=True,
            quality_snapshot=snapshot,
        )
        monkeypatch.setattr(
            task.prompt_builder,
            "generate_prompt",
            lambda srcs, samples, precedings: (
                [{"role": "system", "content": "S"}, {"role": "user", "content": "U"}],
                ["LOG"],
            ),
        )

        prepared = task.prepare_request_data(
            task.items, task.processors, task.precedings
        )

        assert prepared["done"] is False
        assert prepared["srcs"] == ["hello"]
        assert prepared["console_log"] == ["LOG"]
        assert item.get_dst() == ""
        assert item.get_status() == Base.ProjectStatus.NONE

    def test_prepare_request_data_uses_sakura_prompt_when_api_format_is_sakura(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(model={"api_format": Base.APIFormat.SAKURALLM})
        called: dict[str, Any] = {}
        monkeypatch.setattr(
            task.prompt_builder,
            "generate_prompt_sakura",
            lambda srcs: (
                called.setdefault("srcs", srcs.copy()),
                ["SAKURA_LOG"],
            ),
        )

        prepared = task.prepare_request_data(
            task.items,
            task.processors,
            task.precedings,
        )

        assert prepared["done"] is False
        assert called["srcs"] == ["hello"]
        assert prepared["messages"] == ["hello"]
        assert prepared["console_log"] == ["SAKURA_LOG"]


class TestTranslationTaskUtils:
    @pytest.mark.parametrize(
        ("source", "expected_cleaned", "expected_why"),
        [
            ("", "", ""),
            ("plain text", "plain text", ""),
            ("A<why>R1</why>B<why>\nR2\n</why>", "AB", "R1\nR2"),
        ],
    )
    def test_extract_why_from_response(
        self, source: str, expected_cleaned: str, expected_why: str
    ) -> None:
        cleaned, why_text = ResponseCleaner.extract_why_from_response(source)

        assert cleaned == expected_cleaned
        assert why_text == expected_why

    def test_normalize_blank_lines_collapse_consecutive_blanks(self) -> None:
        normalized = ResponseCleaner.normalize_blank_lines("A\n\n\nB\n \n\nC\n")
        assert normalized == "A\n\nB\n\nC"

    @pytest.mark.parametrize(
        ("error", "expected_attr"),
        [
            (ResponseChecker.Error.FAIL_DATA, "response_checker_fail_data"),
            (ResponseChecker.Error.FAIL_LINE_COUNT, "response_checker_fail_line_count"),
            (ResponseChecker.Error.FAIL_TIMEOUT, "response_checker_fail_timeout"),
            (ResponseChecker.Error.LINE_ERROR_KANA, "issue_kana_residue"),
            (ResponseChecker.Error.LINE_ERROR_HANGEUL, "issue_hangeul_residue"),
            (
                ResponseChecker.Error.LINE_ERROR_EMPTY_LINE,
                "response_checker_line_error_empty_line",
            ),
            (
                ResponseChecker.Error.LINE_ERROR_SIMILARITY,
                "response_checker_line_error_similarity",
            ),
            (
                ResponseChecker.Error.FAIL_DEGRADATION,
                "response_checker_fail_degradation",
            ),
        ],
    )
    def test_get_error_text_maps_known_errors(
        self, error: ResponseChecker.Error, expected_attr: str
    ) -> None:
        from module.Localizer.Localizer import Localizer

        TranslationTask.get_error_text.cache_clear()
        expected_text = getattr(Localizer.get(), expected_attr)
        assert TranslationTask.get_error_text(error) == expected_text

    def test_get_error_text_returns_empty_for_unknown(self) -> None:
        TranslationTask.get_error_text.cache_clear()
        assert TranslationTask.get_error_text(ResponseChecker.Error.UNKNOWN) == ""

    def test_generate_log_rows_formats_console_and_plain_text(self) -> None:
        task = create_task()

        plain_rows = task.generate_log_rows(
            srcs=["<a>"],
            dsts=["<b>"],
            extra=["  [X]  "],
            console=False,
        )
        console_rows = task.generate_log_rows(
            srcs=["<a>"],
            dsts=["<b>"],
            extra=["  [X]  "],
            console=True,
        )

        assert plain_rows[0] == "[X]"
        assert plain_rows[1] == "<a> --> <b>"
        assert console_rows[1] == "<a> [bright_blue]-->[/] <b>"

    def test_generate_log_table_builds_rows(self) -> None:
        task = create_task()
        table = task.generate_log_table(["row-1", "row-2"], "green")

        assert len(table.rows) == 2


class TestTranslationTaskApplyResponseData:
    def test_apply_response_data_updates_item_when_checks_pass(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(skip_response_check=False)
        task.items[0].set_name_src("Alice")

        processor = FakeProcessor(["hello"], ("艾莉丝", "你好"))
        checker = FakeResponseChecker([ResponseChecker.Error.NONE])
        task.processors = [processor]
        task.response_checker = checker

        logged: dict[str, Any] = {}
        monkeypatch.setattr(
            task,
            "print_log_table",
            lambda *args: logged.setdefault("args", args),
        )

        result = task.apply_response_data(
            prepared={"srcs": ["hello"], "console_log": ["PREP"]},
            request_response=create_request_response(
                start_time=1.0,
                normalized_think="think\nbecause",
                cleaned_response_result='{"0":"decoded"}',
                input_tokens=3,
                output_tokens=4,
                decoded_translations=("decoded",),
                decoded_glossary_entries=({"src": "s", "dst": "d"},),
            ),
        )

        assert result == {
            "row_count": 1,
            "input_tokens": 3,
            "output_tokens": 4,
        }
        assert task.items[0].get_dst() == "你好"
        assert task.items[0].get_name_dst() == "艾莉丝"
        assert task.items[0].get_status() == Base.ProjectStatus.PROCESSED
        assert checker.calls[0]["stream_degraded"] is False
        assert processor.post_args == ["decoded"]
        assert len(logged["args"]) == 8

    def test_apply_response_data_extends_missing_items_for_short_decoded_output(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(skip_response_check=True)
        processor = FakeProcessor(["a", "b"], (None, "joined"))
        task.processors = [processor]

        monkeypatch.setattr(task, "print_log_table", lambda *args: None)

        result = task.apply_response_data(
            prepared={"srcs": ["a", "b"], "console_log": []},
            request_response=create_request_response(
                start_time=1.0,
                input_tokens=10,
                output_tokens=20,
                decoded_translations=("only-one",),
            ),
        )

        assert result["row_count"] == 1
        assert processor.post_args == ["only-one", ""]
        assert task.items[0].get_dst() == "joined"
        assert task.items[0].get_status() == Base.ProjectStatus.PROCESSED

    def test_apply_response_data_request_timeout_skips_decoder_and_marks_timeout(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(skip_response_check=True)

        captured: dict[str, Any] = {}
        monkeypatch.setattr(
            task,
            "print_log_table",
            lambda checks, *args: captured.setdefault("checks", checks),
        )

        result = task.apply_response_data(
            prepared={
                "srcs": ["a", "b"],
                "console_log": [],
                "request_timeout": True,
            },
            request_response=create_request_response(
                start_time=1.0,
                normalized_think="think",
                cleaned_response_result='{"0":"x"}',
                input_tokens=1,
                output_tokens=1,
                decoded_translations=("x",),
            ),
        )

        assert result["row_count"] == 0
        assert captured["checks"] == [
            ResponseChecker.Error.FAIL_TIMEOUT,
            ResponseChecker.Error.FAIL_TIMEOUT,
        ]

    def test_apply_response_data_stream_degraded_uses_checker_and_increments_retry(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(skip_response_check=False)
        checker = FakeResponseChecker([ResponseChecker.Error.FAIL_DEGRADATION])
        task.response_checker = checker
        task.processors = [FakeProcessor(["hello"], (None, "unused"))]

        monkeypatch.setattr(task, "print_log_table", lambda *args: None)

        result = task.apply_response_data(
            prepared={
                "srcs": ["hello"],
                "console_log": [],
                "stream_degraded": True,
            },
            request_response=create_request_response(
                start_time=1.0,
                input_tokens=1,
                output_tokens=1,
            ),
        )

        assert result["row_count"] == 0
        assert checker.calls[0]["stream_degraded"] is True
        assert checker.calls[0]["dsts"] == [""]
        assert task.items[0].get_retry_count() == 1

    def test_apply_response_data_increments_retry_on_quality_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(skip_response_check=False)
        checker = FakeResponseChecker([ResponseChecker.Error.FAIL_DATA])
        task.response_checker = checker

        monkeypatch.setattr(task, "print_log_table", lambda *args: None)

        result = task.apply_response_data(
            prepared={"srcs": ["hello"], "console_log": []},
            request_response=create_request_response(
                start_time=1.0,
                input_tokens=1,
                output_tokens=1,
                decoded_translations=("bad",),
            ),
        )

        assert result["row_count"] == 0
        assert task.items[0].get_retry_count() == 1

    def test_apply_response_data_stream_degraded_without_checker_for_multi_items(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        items = [Item(src="a"), Item(src="b")]
        task = TranslationTask(
            config=Config(auto_process_prefix_suffix_preserved_text=False),
            model={"api_format": Base.APIFormat.OPENAI},
            items=items,
            precedings=[],
            skip_response_check=True,
        )
        task.processors = [
            FakeProcessor(["a"], (None, "A")),
            FakeProcessor(["b"], (None, "B")),
        ]

        captured: dict[str, Any] = {}
        monkeypatch.setattr(
            task,
            "print_log_table",
            lambda checks, *args: captured.setdefault("checks", checks),
        )

        result = task.apply_response_data(
            prepared={
                "srcs": ["a", "b"],
                "console_log": [],
                "stream_degraded": True,
            },
            request_response=create_request_response(
                start_time=1.0,
                input_tokens=1,
                output_tokens=1,
            ),
        )

        assert result["row_count"] == 0
        assert captured["checks"] == [
            ResponseChecker.Error.FAIL_DEGRADATION,
            ResponseChecker.Error.FAIL_DEGRADATION,
        ]
        assert [item.get_retry_count() for item in task.items] == [0, 0]

    def test_apply_response_data_non_expert_mode_keeps_console_result_log_unchanged(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task(skip_response_check=True)
        fake_log = FakeLogManager(expert_mode=False)
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )
        captured: dict[str, Any] = {}

        def capture_logs(
            checks: list[ResponseChecker.Error],
            start: float,
            pt: int,
            ct: int,
            srcs: list[str],
            dsts: list[str],
            file_log: list[str],
            console_log: list[str],
        ) -> None:
            del checks, start, pt, ct, srcs, dsts
            captured["file_log"] = file_log.copy()
            captured["console_log"] = console_log.copy()

        monkeypatch.setattr(task, "print_log_table", capture_logs)

        result = task.apply_response_data(
            prepared={"srcs": ["hello"], "console_log": ["BASE"]},
            request_response=create_request_response(
                start_time=1.0,
                cleaned_response_result='{"0":"ok"}',
                input_tokens=1,
                output_tokens=2,
                decoded_translations=("ok",),
            ),
        )

        assert result["row_count"] == 1
        assert captured["console_log"] == ["BASE"]
        assert len(captured["file_log"]) == len(captured["console_log"]) + 1

    def test_apply_response_data_partially_updates_when_some_checks_fail(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        items = [Item(src="a"), Item(src="b")]
        task = TranslationTask(
            config=Config(auto_process_prefix_suffix_preserved_text=False),
            model={"api_format": Base.APIFormat.OPENAI},
            items=items,
            precedings=[],
            skip_response_check=False,
        )
        checker = FakeResponseChecker(
            [ResponseChecker.Error.NONE, ResponseChecker.Error.FAIL_DATA]
        )
        task.response_checker = checker
        task.processors = [
            FakeProcessor(["a"], (None, "A_DST")),
            FakeProcessor(["b"], (None, "B_DST")),
        ]

        monkeypatch.setattr(task, "print_log_table", lambda *args: None)

        result = task.apply_response_data(
            prepared={"srcs": ["a", "b"], "console_log": []},
            request_response=create_request_response(
                start_time=1.0,
                input_tokens=5,
                output_tokens=6,
                decoded_translations=("da", "db"),
            ),
        )

        assert result["row_count"] == 1
        assert task.items[0].get_status() == Base.ProjectStatus.PROCESSED
        assert task.items[0].get_dst() == "A_DST"
        assert task.items[1].get_status() == Base.ProjectStatus.NONE
        assert task.items[1].get_dst() == ""


class TestTranslationTaskRequestAndStart:
    def test_start_returns_default_and_logs_when_request_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "request",
            lambda *args: (_ for _ in ()).throw(RuntimeError("boom")),
        )
        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )

        result = task.start()

        assert result["row_count"] == 0
        assert fake_log.calls[0]["level"] == "error"
        assert isinstance(fake_log.calls[0]["e"], RuntimeError)

    def test_request_returns_prepared_result_when_done_and_dict(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        expected = {
            "row_count": 2,
            "input_tokens": 1,
            "output_tokens": 1,
        }
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {"done": True, "result": expected},
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result is expected

    def test_request_returns_default_when_done_but_result_not_dict(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {"done": True, "result": "invalid"},
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result["row_count"] == 0

    def test_request_returns_default_when_messages_is_not_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {"done": False, "messages": "bad"},
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result["row_count"] == 0

    def test_request_returns_default_when_cancelled_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {"done": False, "messages": []},
        )

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TaskRequestExecutor.execute",
            lambda **kwargs: create_request_response(
                exception=RequestCancelledError("cancelled")
            ),
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result["row_count"] == 0

    def test_request_returns_default_when_engine_is_stopping_after_exception(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {"done": False, "messages": []},
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_status=lambda: Base.TaskStatus.STOPPING),
        )

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TaskRequestExecutor.execute",
            lambda **kwargs: create_request_response(
                exception=RuntimeError("boom"),
                normalized_think="TH",
                cleaned_response_result="RR",
                input_tokens=1,
                output_tokens=2,
            ),
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result["row_count"] == 0

    @pytest.mark.parametrize(
        ("exception", "expected_flag"),
        [
            (RequestHardTimeoutError("timeout"), "request_timeout"),
            (StreamDegradationError("degraded"), "stream_degraded"),
        ],
    )
    def test_request_handles_recoverable_exception_and_delegates_apply(
        self,
        monkeypatch: pytest.MonkeyPatch,
        exception: Exception,
        expected_flag: str,
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {
                "done": False,
                "messages": [{"role": "user", "content": "U"}],
            },
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_status=lambda: Base.TaskStatus.IDLE),
        )

        captured: dict[str, Any] = {}

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TaskRequestExecutor.execute",
            lambda **kwargs: create_request_response(
                exception=exception,
                normalized_think="think",
                cleaned_response_result="result",
                input_tokens=7,
                output_tokens=8,
            ),
        )
        monkeypatch.setattr(
            task,
            "apply_response_data",
            lambda prepared, request_response: captured.setdefault(
                "args", (prepared, request_response)
            ),
        )

        result = task.request(task.items, task.processors, task.precedings)

        prepared, request_response = captured["args"]
        assert prepared[expected_flag] is True
        assert request_response.normalized_think == ""
        assert request_response.cleaned_response_result == ""
        assert request_response.input_tokens == 0
        assert request_response.output_tokens == 0
        assert result == captured["args"]

    def test_request_logs_unknown_exception_and_returns_default(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        task.split_count = 1
        task.retry_count = 2
        task.token_threshold = 3

        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {
                "done": False,
                "messages": [{"role": "user", "content": "U"}],
            },
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_status=lambda: Base.TaskStatus.IDLE),
        )

        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TaskRequestExecutor.execute",
            lambda **kwargs: create_request_response(
                exception=RuntimeError("boom"),
                normalized_think="TH",
                cleaned_response_result="RR",
                input_tokens=1,
                output_tokens=2,
            ),
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result["row_count"] == 0
        assert fake_log.calls[0]["level"] == "error"
        assert isinstance(fake_log.calls[0]["e"], RuntimeError)

    def test_request_success_delegates_to_apply_response_data(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        monkeypatch.setattr(
            task,
            "prepare_request_data",
            lambda *args: {
                "done": False,
                "messages": [{"role": "user", "content": "U"}],
                "srcs": ["hello"],
                "console_log": ["LOG"],
            },
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_status=lambda: Base.TaskStatus.IDLE),
        )

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TaskRequestExecutor.execute",
            lambda **kwargs: create_request_response(
                normalized_think="THINK",
                cleaned_response_result="RESULT",
                input_tokens=11,
                output_tokens=22,
            ),
        )
        monkeypatch.setattr(
            task,
            "apply_response_data",
            lambda prepared, request_response: {
                "row_count": 9,
                "input_tokens": request_response.input_tokens,
                "output_tokens": request_response.output_tokens,
            },
        )

        result = task.request(task.items, task.processors, task.precedings)

        assert result == {
            "row_count": 9,
            "input_tokens": 11,
            "output_tokens": 22,
        }


class TestTranslationTaskPrintLogTable:
    @pytest.mark.parametrize(
        ("checks", "expected_level"),
        [
            ([ResponseChecker.Error.UNKNOWN], "error"),
            ([ResponseChecker.Error.FAIL_TIMEOUT], "error"),
            ([ResponseChecker.Error.FAIL_DEGRADATION], "error"),
            ([ResponseChecker.Error.FAIL_DATA], "error"),
            ([ResponseChecker.Error.FAIL_LINE_COUNT], "error"),
            ([ResponseChecker.Error.LINE_ERROR_KANA], "error"),
            (
                [ResponseChecker.Error.NONE, ResponseChecker.Error.LINE_ERROR_KANA],
                "warning",
            ),
            ([ResponseChecker.Error.NONE], "info"),
        ],
    )
    def test_print_log_table_selects_expected_log_level(
        self,
        monkeypatch: pytest.MonkeyPatch,
        checks: list[ResponseChecker.Error],
        expected_level: str,
    ) -> None:
        task = create_task()
        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_running_task_count=lambda: 1),
        )
        monkeypatch.setattr(task, "generate_log_rows", lambda *args, **kwargs: ["ROW"])
        monkeypatch.setattr(
            task,
            "generate_log_table",
            lambda rows, style: {"rows": rows, "style": style},
        )

        task.print_log_table(
            checks=checks,
            start=1.0,
            pt=1,
            ct=2,
            srcs=["src"],
            dsts=["dst"],
            file_log=[],
            console_log=[],
        )

        assert fake_log.calls[0]["level"] == expected_level
        assert fake_log.rich_messages[0]["rows"] == ["ROW"]

    def test_print_log_table_force_accept_uses_warning_and_simple_mode(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        task.is_sub_task = True
        task.retry_count = 3
        task.split_count = 1
        task.token_threshold = 2

        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_running_task_count=lambda: 64),
        )
        monkeypatch.setattr(task, "generate_log_rows", lambda *args, **kwargs: ["ROW"])

        task.print_log_table(
            checks=[ResponseChecker.Error.FAIL_DATA],
            start=1.0,
            pt=1,
            ct=2,
            srcs=["src"],
            dsts=["dst"],
            file_log=[],
            console_log=[],
        )

        assert fake_log.calls[0]["level"] == "warning"
        assert len(fake_log.rich_messages) == 1

    def test_print_log_table_subtask_without_force_accept_uses_normal_flow(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        task.is_sub_task = True
        task.retry_count = 2
        task.split_count = 1
        task.token_threshold = 2

        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_running_task_count=lambda: 1),
        )
        monkeypatch.setattr(task, "generate_log_rows", lambda *args, **kwargs: ["ROW"])
        monkeypatch.setattr(
            task,
            "generate_log_table",
            lambda rows, style: {"rows": rows, "style": style},
        )

        task.print_log_table(
            checks=[ResponseChecker.Error.NONE],
            start=1.0,
            pt=1,
            ct=2,
            srcs=["src"],
            dsts=["dst"],
            file_log=[],
            console_log=[],
        )

        assert fake_log.calls[0]["level"] == "info"
        assert fake_log.rich_messages[0]["style"] == "green"

    def test_print_log_table_simple_mode_without_sub_info(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        task = create_task()
        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.Engine.get",
            lambda: SimpleNamespace(get_running_task_count=lambda: 64),
        )
        monkeypatch.setattr(task, "generate_log_rows", lambda *args, **kwargs: ["ROW"])

        task.print_log_table(
            checks=[ResponseChecker.Error.NONE],
            start=1.0,
            pt=1,
            ct=2,
            srcs=["src"],
            dsts=["dst"],
            file_log=[],
            console_log=[],
        )

        assert fake_log.calls[0]["level"] == "info"
        assert str(fake_log.rich_messages[0]).count("\n") == 3


class TestTranslationTaskTranslateSingle:
    def test_translate_single_callback_false_when_no_active_model(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="hello")
        config = Config()
        monkeypatch.setattr(config, "get_active_model", lambda: None)

        created_threads: list[str] = []

        class ImmediateThread:
            def __init__(self, target: Any, name: str) -> None:
                self.target = target
                self.name = name
                created_threads.append(name)

            def start(self) -> None:
                self.target()

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.threading.Thread",
            ImmediateThread,
        )

        callback_result: list[tuple[Item, bool]] = []
        TranslationTask.translate_single(
            item,
            config,
            lambda callback_item, success: callback_result.append(
                (callback_item, success)
            ),
        )

        assert created_threads == ["ENGINE_SINGLE"]
        assert callback_result == [(item, False)]

    def test_translate_single_allows_none_callback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="hello")
        config = Config()
        monkeypatch.setattr(config, "get_active_model", lambda: None)

        created_threads: list[str] = []

        class ImmediateThread:
            def __init__(self, target: Any, name: str) -> None:
                self.target = target
                self.name = name
                created_threads.append(name)

            def start(self) -> None:
                self.target()

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.threading.Thread",
            ImmediateThread,
        )

        TranslationTask.translate_single(item, config, lambda *_: None)

        assert created_threads == ["ENGINE_SINGLE"]

    def test_translate_single_callback_true_when_start_returns_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="hello")
        config = Config()
        monkeypatch.setattr(
            config,
            "get_active_model",
            lambda: {"api_format": Base.APIFormat.OPENAI},
        )

        class ImmediateThread:
            def __init__(self, target: Any, name: str) -> None:
                self.target = target
                self.name = name

            def start(self) -> None:
                self.target()

        created_task_args: dict[str, Any] = {}

        class FakeTranslationTaskCtor:
            def __init__(self, **kwargs: Any) -> None:
                created_task_args.update(kwargs)

            def start(self) -> dict[str, Any]:
                return {"row_count": 1}

        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.threading.Thread",
            ImmediateThread,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TranslationTask",
            FakeTranslationTaskCtor,
        )

        callback_result: list[tuple[Item, bool]] = []
        TranslationTask.translate_single(
            item,
            config,
            lambda callback_item, success: callback_result.append(
                (callback_item, success)
            ),
        )

        assert created_task_args["skip_response_check"] is True
        assert created_task_args["items"] == [item]
        assert callback_result == [(item, True)]

    def test_translate_single_logs_and_callback_false_when_task_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        item = Item(src="hello")
        config = Config()
        monkeypatch.setattr(
            config,
            "get_active_model",
            lambda: {"api_format": Base.APIFormat.OPENAI},
        )

        class ImmediateThread:
            def __init__(self, target: Any, name: str) -> None:
                self.target = target
                self.name = name

            def start(self) -> None:
                self.target()

        class FakeTranslationTaskCtor:
            def __init__(self, **kwargs: Any) -> None:
                del kwargs

            def start(self) -> dict[str, Any]:
                raise RuntimeError("boom")

        fake_log = FakeLogManager()
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.threading.Thread",
            ImmediateThread,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.TranslationTask",
            FakeTranslationTaskCtor,
        )
        monkeypatch.setattr(
            "module.Engine.Translation.TranslationTask.LogManager.get",
            lambda: fake_log,
        )

        callback_result: list[tuple[Item, bool]] = []
        TranslationTask.translate_single(
            item,
            config,
            lambda callback_item, success: callback_result.append(
                (callback_item, success)
            ),
        )

        assert callback_result == [(item, False)]
        assert fake_log.calls[0]["level"] == "error"
