from pathlib import Path

import pytest
from PySide6.QtWidgets import QApplication
from qfluentwidgets import FluentWindow
from qfluentwidgets import SpinBox

from frontend.Model.ModelTaskSettingPage import ModelTaskSettingPage
from model.Model import ModelType
from module.Config import Config


def get_qapplication() -> QApplication:
    """复用全局 QApplication，避免测试中重复初始化 Qt 运行时。"""
    app = QApplication.instance()
    if app is None:
        app = QApplication([])
    return app


def build_anthropic_model(model_id: str) -> dict:
    """构造最小可运行模型配置，保证任务设置页可独立验证。"""
    return {
        "id": model_id,
        "type": ModelType.CUSTOM_ANTHROPIC.value,
        "name": "CLIProxyAPI",
        "api_format": "Anthropic",
        "api_url": "https://api.anthropic.com",
        "api_key": "key",
        "model_id": "claude-3-5-haiku",
        "request": {},
        "threshold": {
            "input_token_limit": 512,
            "output_token_limit": 0,
            "rpm_limit": 0,
            "concurrency_limit": 0,
        },
        "thinking": {"level": "OFF"},
        "generation": {},
    }


def prepare_temp_config(
    tmp_path: Path, model_id: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """把配置路径重定向到临时目录，确保测试互不影响。"""
    monkeypatch.setenv("LINGUAGACHA_APP_DIR", str(tmp_path))
    monkeypatch.setenv("LINGUAGACHA_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("QT_QPA_PLATFORM", "offscreen")
    (tmp_path / "resource").mkdir(parents=True, exist_ok=True)

    config = Config()
    config.models = [build_anthropic_model(model_id)]
    config.activate_model_id = model_id
    config.save()


def test_task_setting_input_spinbox_saves_its_own_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    model_id = "anthropic-test-input"
    prepare_temp_config(tmp_path, model_id, monkeypatch)

    app = get_qapplication()
    window = FluentWindow()
    page = ModelTaskSettingPage(model_id, window)

    spin_boxes = page.findChildren(SpinBox)
    assert len(spin_boxes) == 4

    spin_boxes[0].setValue(777)
    app.processEvents()

    threshold = Config().load().get_model(model_id).get("threshold", {})
    assert threshold.get("input_token_limit") == 777
    assert threshold.get("output_token_limit") == 0
    assert threshold.get("concurrency_limit") == 0
    assert threshold.get("rpm_limit") == 0

    page.close()
    window.close()


def test_task_setting_output_spinbox_does_not_overwrite_other_fields(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_id = "anthropic-test-output"
    prepare_temp_config(tmp_path, model_id, monkeypatch)

    app = get_qapplication()
    window = FluentWindow()
    page = ModelTaskSettingPage(model_id, window)

    spin_boxes = page.findChildren(SpinBox)
    assert len(spin_boxes) == 4

    spin_boxes[1].setValue(321)
    app.processEvents()

    threshold = Config().load().get_model(model_id).get("threshold", {})
    assert threshold.get("input_token_limit") == 512
    assert threshold.get("output_token_limit") == 321
    assert threshold.get("concurrency_limit") == 0
    assert threshold.get("rpm_limit") == 0

    page.close()
    window.close()
