from module.QualityRule.QualityRuleStatistics import LiteralRuleTask
from module.QualityRule.QualityRuleStatistics import RegexRuleTask
from module.QualityRule.QualityRuleStatistics import RuleStatInput
from module.QualityRule.QualityRuleStatistics import RuleStatMode
from module.QualityRule.QualityRuleStatistics import build_aho_nodes
from module.QualityRule.QualityRuleStatistics import count_literal_bucket_hit_items
from module.QualityRule.QualityRuleStatistics import count_regex_bucket_hit_items
from module.QualityRule.QualityRuleStatistics import count_rule_occurrences


def test_count_glossary_case_sensitive_and_insensitive() -> None:
    rules = [
        RuleStatInput(
            key="sensitive",
            pattern="HP",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=True,
        ),
        RuleStatInput(
            key="insensitive",
            pattern="HP",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=False,
        ),
    ]
    src_texts = ("HP low", "hp low", "MP only")

    result = count_rule_occurrences(rules, src_texts, ())

    assert result["sensitive"].matched_item_count == 1
    assert result["insensitive"].matched_item_count == 2


def test_count_replacement_literal_case_insensitive_uses_literal_match() -> None:
    rules = [
        RuleStatInput(
            key="literal",
            pattern="a.b",
            mode=RuleStatMode.PRE_REPLACEMENT,
            regex=False,
            case_sensitive=False,
        )
    ]
    src_texts = ("A.B", "axb", "prefix a.b suffix")

    result = count_rule_occurrences(rules, src_texts, ())

    # 命中条目数按字面量统计：axb 不是命中。
    assert result["literal"].matched_item_count == 2


def test_count_replacement_literal_case_insensitive_unicode_semantics() -> None:
    rules = [
        RuleStatInput(
            key="literal_unicode",
            pattern="ß",
            mode=RuleStatMode.PRE_REPLACEMENT,
            regex=False,
            case_sensitive=False,
        )
    ]
    src_texts = ("SS", "straße", "mass")

    result = count_rule_occurrences(rules, src_texts, ())

    # TextProcessor 运行时使用 re.escape + IGNORECASE，不会把 ß 视为 SS。
    assert result["literal_unicode"].matched_item_count == 1


def test_count_replacement_regex_case_insensitive() -> None:
    rules = [
        RuleStatInput(
            key="regex",
            pattern=r"abc\d+",
            mode=RuleStatMode.PRE_REPLACEMENT,
            regex=True,
            case_sensitive=False,
        )
    ]
    src_texts = ("abc1", "ABC2", "abd3")

    result = count_rule_occurrences(rules, src_texts, ())

    assert result["regex"].matched_item_count == 2


def test_count_post_replacement_uses_dst_texts() -> None:
    rules = [
        RuleStatInput(
            key="post",
            pattern="DONE",
            mode=RuleStatMode.POST_REPLACEMENT,
            regex=False,
            case_sensitive=True,
        )
    ]
    src_texts = ("DONE", "DONE")
    dst_texts = ("done", "DONE")

    result = count_rule_occurrences(rules, src_texts, dst_texts)

    # 译后替换页按 dst 统计，只有第二条命中。
    assert result["post"].matched_item_count == 1


def test_count_text_preserve_forces_ignore_case_regex() -> None:
    rules = [
        RuleStatInput(
            key="preserve",
            pattern=r"<tag>",
            mode=RuleStatMode.TEXT_PRESERVE,
        )
    ]
    src_texts = ("<TAG>1</TAG>", "plain", "<tag>2</tag>")

    result = count_rule_occurrences(rules, src_texts, ())

    assert result["preserve"].matched_item_count == 2


def test_count_invalid_regex_returns_zero() -> None:
    rules = [
        RuleStatInput(
            key="bad",
            pattern=r"[a-z",
            mode=RuleStatMode.PRE_REPLACEMENT,
            regex=True,
            case_sensitive=False,
        )
    ]

    result = count_rule_occurrences(rules, ("abc",), ())

    assert result["bad"].matched_item_count == 0


def test_count_item_metric_counts_each_text_once() -> None:
    rules = [
        RuleStatInput(
            key="metric",
            pattern="a",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=True,
        )
    ]
    src_texts = ("aaa", "bbb", "a")

    result = count_rule_occurrences(rules, src_texts, ())

    # 第一条虽出现 3 次，也只算 1 条命中。
    assert result["metric"].matched_item_count == 2


def test_count_literal_overlapping_patterns_counts_all_hits() -> None:
    rules = [
        RuleStatInput(
            key="short",
            pattern="ab",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=False,
        ),
        RuleStatInput(
            key="long",
            pattern="abc",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=False,
        ),
    ]
    src_texts = ("abc", "xABx", "zzz")

    result = count_rule_occurrences(rules, src_texts, ())

    assert result["short"].matched_item_count == 2
    assert result["long"].matched_item_count == 1


def test_count_empty_pattern_returns_zero_and_keeps_key() -> None:
    rules = [
        RuleStatInput(
            key="empty",
            pattern="",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=False,
        )
    ]

    result = count_rule_occurrences(rules, ("abc",), ())

    assert "empty" in result
    assert result["empty"].matched_item_count == 0


def test_count_same_pattern_multiple_keys_share_result() -> None:
    rules = [
        RuleStatInput(
            key="alias_a",
            pattern="HP",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=False,
        ),
        RuleStatInput(
            key="alias_b",
            pattern="HP",
            mode=RuleStatMode.GLOSSARY,
            case_sensitive=False,
        ),
    ]
    src_texts = ("hp", "HP", "mp")

    result = count_rule_occurrences(rules, src_texts, ())

    assert result["alias_a"].matched_item_count == 2
    assert result["alias_b"].matched_item_count == 2


def test_count_post_replacement_literal_case_insensitive_uses_dst_snapshot() -> None:
    rules = [
        RuleStatInput(
            key="post_casefold",
            pattern="hp",
            mode=RuleStatMode.POST_REPLACEMENT,
            regex=False,
            case_sensitive=False,
        )
    ]
    src_texts = ("HP", "hp", "hP")
    dst_texts = ("Hp", "mp")

    result = count_rule_occurrences(rules, src_texts, dst_texts)

    assert result["post_casefold"].matched_item_count == 1


def test_count_post_replacement_literal_case_insensitive_unicode_semantics() -> None:
    rules = [
        RuleStatInput(
            key="post_unicode",
            pattern="ß",
            mode=RuleStatMode.POST_REPLACEMENT,
            regex=False,
            case_sensitive=False,
        )
    ]

    result = count_rule_occurrences(
        rules=rules,
        src_texts=("SS", "straße", "mass"),
        dst_texts=("SS", "straße", "mass"),
    )

    # 译后替换保持 TextProcessor 语义：非正则+忽略大小写按 re.escape + IGNORECASE。
    assert result["post_unicode"].matched_item_count == 1


def test_count_literal_bucket_hit_items_returns_empty_when_texts_empty() -> None:
    result = count_literal_bucket_hit_items(
        texts=(),
        rules=(LiteralRuleTask(key="a", pattern="HP"),),
    )

    assert result == {}


def test_count_literal_bucket_hit_items_returns_empty_when_rules_empty() -> None:
    result = count_literal_bucket_hit_items(
        texts=("HP",),
        rules=(),
    )

    assert result == {}


def test_count_literal_bucket_hit_items_only_empty_patterns_return_zero() -> None:
    result = count_literal_bucket_hit_items(
        texts=("HP", "MP"),
        rules=(
            LiteralRuleTask(key="empty_a", pattern=""),
            LiteralRuleTask(key="empty_b", pattern=""),
        ),
    )

    assert result["empty_a"] == 0
    assert result["empty_b"] == 0


def test_count_literal_bucket_hit_items_mixed_empty_and_non_empty_pattern() -> None:
    result = count_literal_bucket_hit_items(
        texts=("HP", "MP"),
        rules=(
            LiteralRuleTask(key="empty", pattern=""),
            LiteralRuleTask(key="hp", pattern="HP"),
        ),
    )

    assert result["empty"] == 0
    assert result["hp"] == 1


def test_count_regex_bucket_hit_items_returns_empty_when_texts_empty() -> None:
    result = count_regex_bucket_hit_items(
        texts=(),
        rules=(RegexRuleTask(key="a", pattern=r"HP", flags=0),),
    )

    assert result == {}


def test_count_regex_bucket_hit_items_returns_empty_when_rules_empty() -> None:
    result = count_regex_bucket_hit_items(
        texts=("HP",),
        rules=(),
    )

    assert result == {}


def test_count_regex_bucket_hit_items_duplicate_pattern_shares_result() -> None:
    result = count_regex_bucket_hit_items(
        texts=("aaa", "bbb", "ccc"),
        rules=(
            RegexRuleTask(key="a", pattern=r"a+", flags=0),
            RegexRuleTask(key="b", pattern=r"a+", flags=0),
            RegexRuleTask(key="c", pattern=r"b+", flags=0),
        ),
    )

    assert result["a"] == 1
    assert result["b"] == 1
    assert result["c"] == 1


def test_build_aho_nodes_child_fail_index_can_fallback_to_root() -> None:
    nodes = build_aho_nodes(("abx", "bq"))

    index_a = nodes[0].children["a"]
    index_ab = nodes[index_a].children["b"]
    index_abx = nodes[index_ab].children["x"]
    index_b = nodes[0].children["b"]

    assert nodes[index_ab].fail_index == index_b
    assert nodes[index_abx].fail_index == 0
