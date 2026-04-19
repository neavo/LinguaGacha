import ast
from collections import defaultdict
from pathlib import Path
import re
from string import Formatter

import pytest

from base.BaseLanguage import BaseLanguage
from module.Localizer.Localizer import Localizer
from module.Localizer.LocalizerEN import LocalizerEN
from module.Localizer.LocalizerZH import LocalizerZH


ROOT_DIR = Path(__file__).resolve().parents[3]
MODULE_TEST_ROOT = ROOT_DIR / "tests" / "module"
MODULE_SOURCE_ROOT = ROOT_DIR / "module"


@pytest.fixture(autouse=True)
def reset_app_language(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Localizer, "APP_LANGUAGE", BaseLanguage.Enum.ZH)


def get_public_text_catalog(bundle: type[LocalizerZH]) -> dict[str, str]:
    return {
        key: value
        for key, value in vars(bundle).items()
        if not key.startswith("_") and isinstance(value, str)
    }


def get_placeholder_names(text: str) -> set[str]:
    formatter = Formatter()
    placeholder_names: set[str] = set()
    for _, field_name, _, _ in formatter.parse(text):
        if field_name:
            placeholder_names.add(field_name)
    return placeholder_names


def camel_to_snake(name: str) -> str:
    normalized_name = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", name)
    normalized_name = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", normalized_name)
    return normalized_name.lower()


def iter_module_source_files() -> list[str]:
    return sorted(
        path.relative_to(MODULE_SOURCE_ROOT).as_posix()
        for path in MODULE_SOURCE_ROOT.rglob("*.py")
        if path.name != "__init__.py" and "__pycache__" not in path.parts
    )


def normalize_test_stem(relative_test_path: Path) -> str:
    stem = relative_test_path.stem.removeprefix("test_")
    if relative_test_path.parts[:2] == ("file", "renpy") and stem.startswith("renpy"):
        return stem.replace("renpy", "ren_py", 1)
    return stem


def resolve_expected_business_files(
    relative_test_path: Path,
    business_files_by_stem: dict[str, list[str]],
) -> list[str]:
    override_targets = {
        "test_model_manager.py": "Model/Manager.py",
        "test_model_types.py": "Model/Types.py",
    }
    override_target = override_targets.get(relative_test_path.as_posix())
    if override_target is not None:
        return [override_target]

    return sorted(
        business_files_by_stem.get(normalize_test_stem(relative_test_path), [])
    )


def resolve_imported_business_files(
    test_path: Path,
    business_files: set[str],
) -> set[str]:
    def import_to_candidate(import_name: str) -> set[str]:
        if import_name == "":
            return set()

        parts = import_name.split(".")
        if len(parts) < 2 or parts[0] != "module":
            return set()

        candidate = "/".join(parts[1:]) + ".py"
        if candidate in business_files:
            return {candidate}
        return set()

    tree = ast.parse(test_path.read_text(encoding="utf-8"), filename=str(test_path))
    imported_files: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_files.update(import_to_candidate(alias.name))
            continue
        if not isinstance(node, ast.ImportFrom) or node.module is None:
            continue

        imported_files.update(import_to_candidate(node.module))
        for alias in node.names:
            imported_files.update(import_to_candidate(f"{node.module}.{alias.name}"))

    return imported_files


def test_module_source_files_have_one_to_one_test_mapping() -> None:
    # Arrange
    business_files = iter_module_source_files()
    business_files_by_stem: dict[str, list[str]] = defaultdict(list)
    for business_file in business_files:
        business_files_by_stem[camel_to_snake(Path(business_file).stem)].append(
            business_file
        )

    reverse_mapping: dict[str, list[str]] = defaultdict(list)
    issues: list[str] = []
    business_file_set = set(business_files)

    for test_path in sorted(MODULE_TEST_ROOT.rglob("test_*.py")):
        if "__pycache__" in test_path.parts:
            continue

        relative_test_path = test_path.relative_to(MODULE_TEST_ROOT)
        expected_business_files = resolve_expected_business_files(
            relative_test_path,
            business_files_by_stem,
        )
        if len(expected_business_files) != 1:
            issues.append(
                f"{relative_test_path.as_posix()} 未能唯一映射到业务文件: {expected_business_files}"
            )
            continue

        imported_business_files = resolve_imported_business_files(
            test_path,
            business_file_set,
        )
        expected_business_file = expected_business_files[0]
        if expected_business_file not in imported_business_files:
            issues.append(
                f"{relative_test_path.as_posix()} 预期测试 {expected_business_file}，"
                f"但当前导入为 {sorted(imported_business_files)}"
            )
            continue

        reverse_mapping[expected_business_file].append(relative_test_path.as_posix())

    for business_file in business_files:
        linked_tests = reverse_mapping.get(business_file, [])
        if len(linked_tests) != 1:
            issues.append(f"{business_file} 的测试文件映射异常: {linked_tests}")

    # Act / Assert
    assert issues == [], "\n".join(issues)


@pytest.mark.parametrize(
    ("app_language", "expected_bundle", "expected_task_failed"),
    [
        (BaseLanguage.Enum.ZH, LocalizerZH, LocalizerZH.task_failed),
        (BaseLanguage.Enum.EN, LocalizerEN, LocalizerEN.task_failed),
        (BaseLanguage.Enum.JA, LocalizerZH, LocalizerZH.task_failed),
    ],
)
def test_get_returns_expected_bundle_for_selected_language(
    app_language: BaseLanguage.Enum,
    expected_bundle: type[LocalizerZH],
    expected_task_failed: str,
) -> None:
    # Arrange
    Localizer.set_app_language(app_language)

    # Act
    bundle = Localizer.get()

    # Assert
    assert bundle is expected_bundle
    assert bundle.task_failed == expected_task_failed


def test_get_app_language_returns_latest_public_state() -> None:
    # Arrange
    Localizer.set_app_language(BaseLanguage.Enum.EN)

    # Act
    current_language = Localizer.get_app_language()

    # Assert
    assert current_language == BaseLanguage.Enum.EN


def test_union_text_resolve_reads_latest_app_language() -> None:
    text = Localizer.UnionText(zh="中文", en="English")

    Localizer.set_app_language(BaseLanguage.Enum.ZH)
    assert text.resolve() == "中文"

    Localizer.set_app_language(BaseLanguage.Enum.EN)
    assert text.resolve() == "English"


@pytest.mark.parametrize(
    ("app_language", "text", "expected"),
    [
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh="中文", en="English"), "English"),
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh="中文", en=None), "中文"),
        (BaseLanguage.Enum.JA, Localizer.UnionText(zh="中文", en="English"), "中文"),
        (BaseLanguage.Enum.JA, Localizer.UnionText(zh=None, en="English"), "English"),
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh=None, en=None), None),
        (BaseLanguage.Enum.EN, Localizer.UnionText(zh="中文", en=""), ""),
        (BaseLanguage.Enum.ZH, Localizer.UnionText(zh="", en="English"), ""),
    ],
)
def test_union_text_resolves_by_app_language(
    app_language: BaseLanguage.Enum,
    text: Localizer.UnionText,
    expected: str | None,
) -> None:
    Localizer.set_app_language(app_language)

    assert text.resolve() == expected


def test_union_text_is_immutable() -> None:
    text = Localizer.UnionText(zh="中文", en="English")

    with pytest.raises(AttributeError):
        text.zh = "修改后中文"


def test_localizer_bundles_share_same_keys_and_placeholders() -> None:
    # Arrange
    zh_catalog = get_public_text_catalog(LocalizerZH)
    en_catalog = get_public_text_catalog(LocalizerEN)

    # Act / Assert
    assert zh_catalog.keys() == en_catalog.keys()
    for key in zh_catalog:
        assert get_placeholder_names(zh_catalog[key]) == get_placeholder_names(
            en_catalog[key]
        ), f"{key} 的占位符集合应保持一致"
