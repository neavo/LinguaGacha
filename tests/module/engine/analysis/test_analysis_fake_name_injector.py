from module.Engine.Analysis.AnalysisFakeNameInjector import AnalysisFakeNameInjector


class TestAnalysisFakeNameInjector:
    def test_inject_and_restore_keep_mapping_stable_for_same_control_code(self) -> None:
        injector = AnalysisFakeNameInjector(
            [
                r"前缀\n[7]中段\n[7]后缀",
                r"另一行\N[9]",
                r"第三行\NN[11]\nn[12]",
            ]
        )

        injected = injector.inject_texts(
            [
                r"前缀\n[7]中段\n[7]后缀",
                r"另一行\N[9]",
                r"第三行\NN[11]\nn[12]",
            ]
        )
        restored_text, changed = injector.restore_text(injected[0])

        assert injected[0].count("蓝霁云") == 2
        assert "檀秋萦" in injected[1]
        assert "墨临川" in injected[2]
        assert "泠鸢晚" in injected[2]
        assert restored_text == r"前缀\n[7]中段\n[7]后缀"
        assert changed is True

    def test_build_fake_name_falls_back_to_numbered_placeholder(self) -> None:
        injector = AnalysisFakeNameInjector([])

        assert injector.build_fake_name(len(injector.DEFAULT_FAKE_NAMES)) == "伪名0101"

    def test_inject_texts_keeps_original_when_no_control_code_exists(self) -> None:
        injector = AnalysisFakeNameInjector(["普通文本"])

        assert injector.inject_texts(["普通文本"]) == ["普通文本"]
        assert injector.restore_text("普通文本") == ("普通文本", False)

    def test_is_control_code_text_only_accepts_pure_control_code(self) -> None:
        assert AnalysisFakeNameInjector.is_control_code_text(r"\n[7]") is True
        assert AnalysisFakeNameInjector.is_control_code_text(r"前缀\n[7]") is False
