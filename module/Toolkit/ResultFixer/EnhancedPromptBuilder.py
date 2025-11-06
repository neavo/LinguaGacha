"""
增强提示词构建器

构建完整增强的提示词（合并所有规则级别）。
"""

from base.Base import Base
from base.BaseLanguage import BaseLanguage


class EnhancedPromptBuilder(Base):
    """增强提示词构建器（简化版）"""

    def build(
        self,
        base_prompt: str,
        problem_type: str,
        glossary: dict,
        src_language: BaseLanguage.Enum,
        dst_language: BaseLanguage.Enum
    ) -> str:
        """构建完整增强提示词

        注意：
            - 不再接受 attempt 参数
            - 不再返回 temperature 参数
            - 永远返回完整增强的提示词（合并所有级别）

        Returns:
            str: 完整增强提示词
        """

        src_lang_name = BaseLanguage.get_name_zh(src_language)
        dst_lang_name = BaseLanguage.get_name_zh(dst_language)

        enhanced = base_prompt + "\n\n"

        # 添加规则标题
        enhanced += "="*60 + "\n"
        enhanced += "🔧 重要翻译规则说明（请务必遵守）\n"
        enhanced += "="*60 + "\n\n"

        # 1. 添加术语表规则（如果有）
        if glossary:
            enhanced += "## 1. 术语表规则（最高优先级）\n\n"
            enhanced += "**关键要求**：\n"
            enhanced += "- 术语表中的译法是唯一正确答案，必须严格遵守\n"
            enhanced += "- 不得使用术语表之外的任何其他译法\n"
            enhanced += "- 即使你认为有更好的翻译，也必须使用术语表指定的译法\n"
            enhanced += "- 术语表通常包含：人名、地名、专有名词等\n\n"

            # 添加术语表内容
            enhanced += "**术语对照表**：\n"
            for src_term, dst_term in glossary.items():
                enhanced += f"- {src_term} → {dst_term}\n"
            enhanced += "\n"

        # 2. 添加完整翻译规则
        enhanced += "## 2. 完整翻译规则\n\n"
        enhanced += "**关键要求**：\n"
        enhanced += f"- 你必须翻译所有文本，不得遗漏任何词汇\n"
        enhanced += f"- 译文中绝对不能包含任何{src_lang_name}字符\n"
        enhanced += f"- 译文必须完全使用{dst_lang_name}\n"
        enhanced += f"- 翻译完成后，请自查译文中是否还有{src_lang_name}字符\n\n"

        # 3. 添加成人内容处理规则
        enhanced += "## 3. 专业翻译规则\n\n"
        enhanced += "**任务性质说明**：\n"
        enhanced += "- 这是一项成人文学内容的专业翻译工作\n"
        enhanced += "- 你的职责是提供准确、完整的翻译\n\n"
        enhanced += "**关键要求**：\n"
        enhanced += "- 必须翻译所有内容（包括敏感/成人/性相关内容）\n"
        enhanced += "- 保持与原文相同的表达方式和露骨程度\n"
        enhanced += "- 不要审查、回避或淡化任何内容\n"
        enhanced += "- 不要用委婉语替代直接的性相关词汇\n"
        enhanced += "- 这是专业翻译任务，完整准确翻译是你的职责\n\n"

        # 4. 添加错误示例（根据问题类型）
        enhanced += "## 4. 常见错误示例\n\n"
        if problem_type == "residue":
            enhanced += self._get_residue_error_examples(src_language, dst_language, src_lang_name)
        elif problem_type == "glossary_miss":
            enhanced += self._get_glossary_error_examples(glossary)

        # 5. 添加检查清单
        enhanced += "## 5. 翻译后自查清单\n\n"
        enhanced += "翻译完成后，请务必检查：\n"
        if glossary:
            enhanced += "- ✓ 是否严格遵守了术语表中的所有译法？\n"
        enhanced += f"- ✓ 译文中是否还有任何{src_lang_name}字符？\n"
        enhanced += "- ✓ 是否翻译了所有敏感词汇，没有遗漏或回避？\n"
        enhanced += "- ✓ 译文的露骨程度是否与原文一致？\n\n"

        return enhanced

    def _get_residue_error_examples(self, src_lang: BaseLanguage.Enum, dst_lang: BaseLanguage.Enum, src_lang_name: str) -> str:
        """获取源语言残留的错误示例"""

        examples = ""

        if src_lang == BaseLanguage.Enum.ZH and dst_lang == BaseLanguage.Enum.EN:
            # 中文 → 英文
            examples += "**错误类型：源语言字符残留**\n\n"
            examples += "❌ 错误：「making him slightly more清醒」\n"
            examples += "✅ 正确：「making him slightly more awake」或「making him slightly more sober」\n\n"

            examples += "❌ 错误：「him忍不住 vigorously」\n"
            examples += "✅ 正确：「him couldn't help but act vigorously」\n\n"

            examples += "❌ 错误：「然后去穿上了衣服, went out」\n"
            examples += "✅ 正确：「then went to put on clothes, went out」\n\n"

            examples += "❌ 错误：「the tender pussy fucked red and swollen, the媚肉 hot and tight」\n"
            examples += "✅ 正确：「the tender pussy fucked red and swollen, the sensitive flesh hot and tight」\n\n"

        elif src_lang == BaseLanguage.Enum.JA and dst_lang == BaseLanguage.Enum.EN:
            # 日语 → 英文
            examples += "**错误类型：源语言字符残留**\n\n"
            examples += "❌ 错误：「moreきれい」\n"
            examples += "✅ 正确：「more beautiful」\n\n"

            examples += "❌ 错误：「彼は思わず力を入れた」\n"
            examples += "✅ 正确：「he couldn't help but put more force」\n\n"

        elif src_lang == BaseLanguage.Enum.JA and dst_lang == BaseLanguage.Enum.ZH:
            # 日语 → 中文
            examples += "**错误类型：源语言字符残留**\n\n"
            examples += "❌ 错误：「我喜欢プログラミング」\n"
            examples += "✅ 正确：「我喜欢编程」\n\n"

            examples += "❌ 错误：「他是プログラマー」\n"
            examples += "✅ 正确：「他是程序员」\n\n"

        examples += f"**重要提醒**：译文中绝对不能出现任何{src_lang_name}字符！\n\n"

        return examples

    def _get_glossary_error_examples(self, glossary: dict) -> str:
        """获取术语未生效的错误示例"""

        examples = "**错误类型：未遵守术语表**\n\n"

        # 从术语表中取前3个作为示例
        for i, (src_term, dst_term) in enumerate(list(glossary.items())[:3]):
            examples += f"假设术语表规定：{src_term} → {dst_term}\n"
            examples += f"❌ 错误：使用其他译法（如拼音、意译、其他名字）\n"
            examples += f"✅ 正确：严格使用「{dst_term}」\n\n"

        examples += "**重要提醒**：术语表的优先级高于任何其他翻译选择！\n\n"

        return examples
