import pytest

from module.Filter.RuleFilter import RuleFilter


class TestRuleFilterEmptyAndBlank:
    """空字符串与空白行的过滤行为。"""

    def test_empty_string_not_filtered(self) -> None:
        # 空字符串 → flags 为空列表 → 返回 False
        assert RuleFilter.filter("") is False

    def test_single_blank_line_filtered(self) -> None:
        assert RuleFilter.filter("   ") is True

    def test_multiple_blank_lines_filtered(self) -> None:
        assert RuleFilter.filter("  \n  \n  ") is True


class TestRuleFilterNumericAndPunctuation:
    """仅含数字/标点的文本应被过滤。"""

    def test_only_digits_filtered(self) -> None:
        assert RuleFilter.filter("12345") is True

    def test_only_punctuation_filtered(self) -> None:
        assert RuleFilter.filter("...!!!") is True

    def test_digits_and_punctuation_filtered(self) -> None:
        assert RuleFilter.filter("123, 456.") is True

    def test_normal_text_not_filtered(self) -> None:
        assert RuleFilter.filter("Hello World") is False

    def test_cjk_text_not_filtered(self) -> None:
        assert RuleFilter.filter("你好世界") is False


class TestRuleFilterPrefix:
    """以特定前缀开头的文本应被过滤。"""

    @pytest.mark.parametrize(
        "src",
        [
            "MapData/map001",
            "SE/sound_effect",
            "BGS001",
            "0=some_value",
            "BGM/battle_theme",
            "FIcon/icon01",
        ],
        ids=["MapData/", "SE/", "BGS", "0=", "BGM/", "FIcon/"],
    )
    def test_known_prefix_filtered(self, src: str) -> None:
        assert RuleFilter.filter(src) is True

    def test_prefix_case_insensitive(self) -> None:
        # 前缀比较时 line 已 lower()
        assert RuleFilter.filter("MAPDATA/map001") is True
        assert RuleFilter.filter("bgm/music") is True


class TestRuleFilterSuffix:
    """以特定后缀结尾的文本应被过滤。"""

    @pytest.mark.parametrize(
        "src",
        [
            "music.mp3",
            "sound.wav",
            "track.ogg",
            "track.mid",
            "image.png",
            "photo.jpg",
            "pic.jpeg",
            "anim.gif",
            "video.avi",
            "clip.mp4",
            "movie.webm",
            "note.txt",
            "archive.zip",
            "data.json",
            "save.sav",
            "font.ttf",
            "font.otf",
            "font.woff",
        ],
    )
    def test_known_suffix_filtered(self, src: str) -> None:
        assert RuleFilter.filter(src) is True


class TestRuleFilterRegex:
    """符合特定正则表达式的文本应被过滤。"""

    @pytest.mark.parametrize(
        "src",
        [
            "EV001",
            "ev123",
            "EV99999",
        ],
        ids=["EV_upper", "ev_lower", "EV_long"],
    )
    def test_ev_pattern_filtered(self, src: str) -> None:
        assert RuleFilter.filter(src) is True

    def test_dejavu_sans_filtered(self) -> None:
        assert RuleFilter.filter("DejaVu Sans") is True

    def test_opendyslexic_filtered(self) -> None:
        assert RuleFilter.filter("Opendyslexic") is True

    def test_file_time_filtered(self) -> None:
        assert RuleFilter.filter("{#file_time}2024-01-01") is True


class TestRuleFilterMultiline:
    """多行文本：所有行都应被过滤时返回 True，否则 False。"""

    def test_all_lines_filtered(self) -> None:
        src = "123\n456\n789"
        assert RuleFilter.filter(src) is True

    def test_mixed_lines_not_filtered(self) -> None:
        # 第二行包含普通文本，不应被整体过滤
        src = "123\nHello World\n456"
        assert RuleFilter.filter(src) is False

    def test_normal_multiline_not_filtered(self) -> None:
        src = "Hello\nWorld"
        assert RuleFilter.filter(src) is False


class TestRuleFilterEdgeCases:
    """边界场景。"""

    def test_ev_with_letters_not_filtered(self) -> None:
        # "EV001abc" 不匹配 ^EV\d+$ 模式
        assert RuleFilter.filter("EV001abc") is False

    def test_text_with_suffix_in_middle_not_filtered(self) -> None:
        # 后缀只在结尾匹配
        assert RuleFilter.filter("file.mp3 is good") is False

    def test_text_with_prefix_in_middle_not_filtered(self) -> None:
        # 只要不以前缀开头即可
        assert RuleFilter.filter("go to MapData/map") is False

    def test_text_with_mid_substring_not_filtered(self) -> None:
        assert RuleFilter.filter("formidable") is False
