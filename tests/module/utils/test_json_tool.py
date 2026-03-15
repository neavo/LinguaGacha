import codecs
import json
from pathlib import Path
from typing import Any

import orjson
import pytest

from module.Utils.JSONTool import JSONTool


class TestJSONToolLoads:
    def test_loads_valid_json_string(self) -> None:
        result = JSONTool.loads('{"name":"LinguaGacha","ok":true}')

        assert result == {"name": "LinguaGacha", "ok": True}

    def test_loads_valid_json_bytes(self) -> None:
        result = JSONTool.loads(b'{"count":2}')

        assert result == {"count": 2}

    def test_loads_with_utf8_bom(self) -> None:
        data = codecs.BOM_UTF8 + b'{"k":"v"}'

        assert JSONTool.loads(data) == {"k": "v"}

    def test_loads_fallback_to_stdlib_when_orjson_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        original_orjson_loads = orjson.loads

        def fake_orjson_loads(_: str | bytes) -> Any:
            try:
                original_orjson_loads(b"{")
            except orjson.JSONDecodeError as e:
                raise e
            raise AssertionError("unreachable")

        monkeypatch.setattr("module.Utils.JSONTool.orjson.loads", fake_orjson_loads)

        assert JSONTool.loads('{"fallback": true}') == {"fallback": True}

    def test_loads_invalid_json_raises(self) -> None:
        with pytest.raises(json.JSONDecodeError):
            JSONTool.loads("{broken json")


class TestJSONToolDumps:
    def test_dumps_returns_string(self) -> None:
        text = JSONTool.dumps({"id": 1})

        assert isinstance(text, str)
        assert text == '{"id":1}'

    def test_dumps_bytes_indent_zero_is_compact(self) -> None:
        data = JSONTool.dumps_bytes({"a": 1, "b": 2}, indent=0)

        assert data == b'{"a":1,"b":2}'

    def test_dumps_bytes_indent_two_is_pretty(self) -> None:
        text = JSONTool.dumps_bytes({"a": 1, "b": 2}, indent=2).decode("utf-8")

        assert '\n  "a": 1' in text
        assert '\n  "b": 2' in text

    def test_dumps_bytes_indent_two_fallback_when_orjson_type_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        def fake_orjson_dumps(_: Any, *, option: int = 0) -> bytes:
            raise TypeError("forced fallback")

        monkeypatch.setattr("module.Utils.JSONTool.orjson.dumps", fake_orjson_dumps)

        data = JSONTool.dumps_bytes({"name": "LG", "value": 7}, indent=2)
        text = data.decode("utf-8")

        assert isinstance(data, bytes)
        assert '\n  "name": "LG"' in text
        assert '\n  "value": 7' in text

    def test_dumps_bytes_indent_four_is_pretty(self) -> None:
        text = JSONTool.dumps_bytes({"a": 1, "b": 2}, indent=4).decode("utf-8")

        assert '\n    "a": 1' in text
        assert '\n    "b": 2' in text

    def test_dumps_bytes_indent_two_raises_original_error_when_stdlib_also_fails(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        class NotSerializable:
            pass

        def fake_orjson_dumps(_: Any, *, option: int = 0) -> bytes:
            raise TypeError("orjson type error")

        monkeypatch.setattr("module.Utils.JSONTool.orjson.dumps", fake_orjson_dumps)

        with pytest.raises(TypeError, match="orjson type error"):
            JSONTool.dumps_bytes(NotSerializable(), indent=2)

    def test_dumps_bytes_indent_four_surrogate_uses_backslashreplace(self) -> None:
        data = JSONTool.dumps_bytes({"text": "\ud800"}, indent=4)

        assert b"\\ud800" in data
        assert isinstance(data, bytes)

    def test_dumps_bytes_escapes_lone_surrogate(self) -> None:
        data = JSONTool.dumps_bytes({"text": "\ud800"}, indent=0)

        assert b"\\ud800" in data

    def test_dumps_bytes_unserializable_raises_type_error(self) -> None:
        class NotSerializable:
            pass

        with pytest.raises(TypeError):
            JSONTool.dumps_bytes(NotSerializable(), indent=0)


class TestJSONToolRepairLoads:
    def test_repair_loads_valid_json(self) -> None:
        result = JSONTool.repair_loads('{"ok":true}')

        assert result == {"ok": True}

    def test_repair_loads_trailing_comma(self) -> None:
        result = JSONTool.repair_loads('{"v": 1,}')

        assert result == {"v": 1}


class TestJSONToolFileIO:
    def test_save_then_load_file_roundtrip(self, fs) -> None:
        del fs
        path = Path("/workspace/json_tool/data.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"name": "LG", "value": 3}

        JSONTool.save_file(path, payload)

        assert JSONTool.load_file(path) == payload

    def test_load_file_with_utf8_bom(self, fs) -> None:
        del fs
        path = Path("/workspace/json_tool/bom.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(codecs.BOM_UTF8 + b'{"x":1}')

        assert JSONTool.load_file(path) == {"x": 1}

    def test_save_file_serialize_failed_does_not_truncate_file(
        self,
        fs,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        del fs
        path = Path("/workspace/json_tool/atomic.json")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"old":1}', encoding="utf-8")

        def broken_dumps_bytes(_: type[JSONTool], __: Any, *, indent: int = 0) -> bytes:
            raise TypeError("serialize failed")

        monkeypatch.setattr(JSONTool, "dumps_bytes", classmethod(broken_dumps_bytes))

        with pytest.raises(TypeError):
            JSONTool.save_file(path, {"new": 2}, indent=4)

        assert path.read_text(encoding="utf-8") == '{"old":1}'
