"""
增强提示词构建器

根据重试次数构建渐进式增强的提示词，并返回对应的温度参数。
"""

from base.Base import Base
from base.BaseLanguage import BaseLanguage


class EnhancedPromptBuilder(Base):
    """增强提示词构建器"""

    # 渐进式增强策略
    ENHANCEMENT_LEVELS = ["basic", "strict", "critical"]

    # 温度参数递减策略
    TEMPERATURE_LEVELS = [0.7, 0.3, 0.1]  # 第1次/第2次/第3次

    def build(
        self,
        base_prompt: str,
        problem_type: str,
        attempt: int,
        glossary: dict,
        src_language: BaseLanguage.Enum,
        dst_language: BaseLanguage.Enum
    ) -> tuple[str, float]:
        """构建增强提示词和温度参数

        Returns:
            tuple[str, float]: (增强提示词, 温度参数)
        """

        level = self.ENHANCEMENT_LEVELS[min(attempt, len(self.ENHANCEMENT_LEVELS)-1)]
        temperature = self.TEMPERATURE_LEVELS[min(attempt, len(self.TEMPERATURE_LEVELS)-1)]

        # 基础提示词
        enhanced = base_prompt + "\n\n"

        # 添加增强规则
        enhanced += "="*60 + "\n"
        enhanced += "🔧 重要翻译规则说明（请务必遵守）\n"
        enhanced += "="*60 + "\n\n"

        # 根据增强级别添加规则
        if level == "basic":
            enhanced += self._build_basic_rules(problem_type, glossary, src_language, dst_language)
        elif level == "strict":
            enhanced += self._build_strict_rules(problem_type, glossary, src_language, dst_language)
        elif level == "critical":
            enhanced += self._build_critical_rules(problem_type, glossary, src_language, dst_language)

        return enhanced, temperature

    def _build_basic_rules(self, problem_type: str, glossary: dict, src_lang: BaseLanguage.Enum, dst_lang: BaseLanguage.Enum) -> str:
        """基础增强规则（第1次尝试）"""

        src_lang_name = BaseLanguage.get_name_zh(src_lang)
        dst_lang_name = BaseLanguage.get_name_zh(dst_lang)

        rules = []

        # 1. 术语表规则（如果有）
        if glossary:
            rules.append("## 1. 术语表规则（最高优先级）\n")
            rules.append("**关键要求**：")
            rules.append("- 术语表中的译法是唯一正确答案，必须严格遵守")
            rules.append("- 不得使用术语表之外的任何其他译法")
            rules.append("- 即使你认为有更好的翻译，也必须使用术语表指定的译法")
            rules.append("- 术语表通常包含：人名、地名、专有名词等\n")

        # 2. 完整翻译规则
        rules.append("## 2. 完整翻译规则\n")
        rules.append("**关键要求**：")
        rules.append(f"- 你必须翻译所有文本，不得遗漏任何词汇")
        rules.append(f"- 译文中绝对不能包含任何{src_lang_name}字符")
        rules.append(f"- 译文必须完全使用{dst_lang_name}")
        rules.append(f"- 翻译完成后，请自查译文中是否还有{src_lang_name}字符\n")

        # 3. 敏感内容翻译规则
        rules.append("## 3. 专业翻译规则\n")
        rules.append("**任务性质说明**：")
        rules.append("- 这是一项成人文学内容的专业翻译工作")
        rules.append("- 你的职责是提供准确、完整的翻译\n")
        rules.append("**关键要求**：")
        rules.append("- 必须翻译所有内容（包括敏感/成人/性相关内容）")
        rules.append("- 保持与原文相同的表达方式和露骨程度")
        rules.append("- 不要审查、回避或淡化任何内容")
        rules.append("- 不要用委婉语替代直接的性相关词汇")
        rules.append("- 这是专业翻译任务，完整准确翻译是你的职责\n")

        # 4. 质量检查提醒
        rules.append("## 4. 翻译后自查清单\n")
        rules.append("翻译完成后，请务必检查：")
        if glossary:
            rules.append("- ✓ 是否严格遵守了术语表中的所有译法？")
        rules.append(f"- ✓ 译文中是否还有任何{src_lang_name}字符？")
        rules.append("- ✓ 是否翻译了所有敏感词汇，没有遗漏或回避？")
        rules.append("- ✓ 译文的露骨程度是否与原文一致？\n")

        return "\n".join(rules)

    def _build_strict_rules(self, problem_type: str, glossary: dict, src_lang: BaseLanguage.Enum, dst_lang: BaseLanguage.Enum) -> str:
        """严格规则 + 错误示例（第2次尝试）"""

        src_lang_name = BaseLanguage.get_name_zh(src_lang)
        dst_lang_name = BaseLanguage.get_name_zh(dst_lang)

        # 先包含基础规则
        rules = self._build_basic_rules(problem_type, glossary, src_lang, dst_lang)

        # 添加分隔线
        rules += "\n" + "─"*60 + "\n"
        rules += "⚠️  注意：第1次翻译检测到问题，以下是常见错误示例\n"
        rules += "─"*60 + "\n\n"

        # 根据问题类型添加错误示例
        if problem_type == "residue":
            rules += "## 常见错误类型1：源语言字符残留\n\n"

            if src_lang == BaseLanguage.Enum.ZH and dst_lang == BaseLanguage.Enum.EN:
                # 中文 → 英文
                rules += "**错误示例**：\n"
                rules += "❌ 错误：「making him slightly more清醒」\n"
                rules += "✅ 正确：「making him slightly more awake」或「making him slightly more sober」\n\n"

                rules += "❌ 错误：「him忍不住 vigorously」\n"
                rules += "✅ 正确：「him couldn't help but act vigorously」\n\n"

                rules += "❌ 错误：「然后去穿上了衣服, went out」\n"
                rules += "✅ 正确：「then went to put on clothes, went out」\n\n"

                rules += "❌ 错误：「the tender pussy fucked red and swollen, the媚肉 hot and tight」\n"
                rules += "✅ 正确：「the tender pussy fucked red and swollen, the sensitive flesh hot and tight」\n\n"

            elif src_lang == BaseLanguage.Enum.JA and dst_lang == BaseLanguage.Enum.EN:
                # 日语 → 英文
                rules += "**错误示例**：\n"
                rules += "❌ 错误：「moreきれい」\n"
                rules += "✅ 正确：「more beautiful」\n\n"

                rules += "❌ 错误：「彼は思わず力を入れた」\n"
                rules += "✅ 正确：「he couldn't help but put more force」\n\n"

            rules += f"**记住**：译文中绝对不能出现任何{src_lang_name}字符！\n\n"

        elif problem_type == "glossary_miss":
            rules += "## 常见错误类型2：未遵守术语表\n\n"
            rules += "**错误示例**：\n"

            # 从术语表中取前3个作为示例
            for i, (src_term, dst_term) in enumerate(list(glossary.items())[:3]):
                rules += f"假设术语表规定：{src_term} → {dst_term}\n"
                rules += f"❌ 错误：使用其他译法（如拼音、意译、其他名字）\n"
                rules += f"✅ 正确：严格使用「{dst_term}」\n\n"

            rules += "**记住**：术语表的优先级高于任何其他翻译选择！\n\n"

        return rules

    def _build_critical_rules(self, problem_type: str, glossary: dict, src_lang: BaseLanguage.Enum, dst_lang: BaseLanguage.Enum) -> str:
        """最严格规则 + 强调警告（第3次尝试）"""

        src_lang_name = BaseLanguage.get_name_zh(src_lang)
        dst_lang_name = BaseLanguage.get_name_zh(dst_lang)

        # 先包含严格规则
        rules = self._build_strict_rules(problem_type, glossary, src_lang, dst_lang)

        # 添加最强警告
        rules += "\n" + "="*60 + "\n"
        rules += "🚨 CRITICAL WARNING - 最后机会警告\n"
        rules += "="*60 + "\n\n"

        if problem_type == "residue":
            rules += f"**前两次翻译都检测到{src_lang_name}字符残留！**\n\n"
            rules += "这是第3次也是最后一次机会！\n\n"
            rules += "**你必须做到**：\n"
            rules += f"1. 译文中绝对不能出现任何{src_lang_name}字符\n"
            rules += f"2. 每一个词都必须翻译成{dst_lang_name}\n"
            rules += f"3. 翻译完成后，请逐字检查译文中是否还有{src_lang_name}字符\n"
            rules += "4. 如果不确定某个词如何翻译，也必须用目标语言描述，不能保留源语言\n\n"

        elif problem_type == "glossary_miss":
            rules += "**前两次翻译都未遵守术语表规则！**\n\n"
            rules += "这是第3次也是最后一次机会！\n\n"
            rules += "**你必须做到**：\n"
            rules += "1. 严格按照术语表翻译所有专有名词\n"
            rules += "2. 不得使用术语表之外的任何译法\n"
            rules += "3. 翻译完成后，请逐个检查所有术语是否正确\n"
            rules += "4. 如果原文出现术语表中的词，译文中必须出现对应的译法\n\n"

        rules += "**请认真对待这次翻译，这是最后的机会。**\n\n"

        return rules
