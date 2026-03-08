import re


class ResponseCleaner:
    """统一清洗模型回复中的结构化思考与空白行。

    为什么单独抽出来：
    - 翻译与分析都可能要求模型先输出 `<why>...</why>` 思考块
    - 清洗规则若分散在多个任务类里，后续修 bug 时很容易漂移
    """

    WHY_TAG_PATTERN: re.Pattern[str] = re.compile(r"<why>(.*?)</why>", re.DOTALL)

    @classmethod
    def extract_why_from_response(cls, response_result: str) -> tuple[str, str]:
        """从回复里剥离 `<why>`，避免后续 JSONLINE 解析被污染。"""
        if response_result == "":
            return response_result, ""

        matches = cls.WHY_TAG_PATTERN.findall(response_result)
        if not matches:
            return response_result, ""

        cleaned = cls.WHY_TAG_PATTERN.sub("", response_result)
        why_text = "\n".join(v.strip() for v in matches if v.strip())
        return cleaned, why_text

    @classmethod
    def normalize_blank_lines(cls, text: str) -> str:
        """压缩连续空行，避免日志和调试输出出现大片空洞。"""
        if text == "":
            return text

        lines = text.splitlines()
        normalized: list[str] = []
        prev_empty = False
        for line in lines:
            if line.strip() == "":
                if not prev_empty:
                    normalized.append("")
                prev_empty = True
                continue

            normalized.append(line)
            prev_empty = False

        return "\n".join(normalized)

    @classmethod
    def merge_text_blocks(cls, first_text: str, second_text: str) -> str:
        """把两段可选文本按块拼起来，避免调用方重复写空串分支。"""
        parts = [text for text in (first_text, second_text) if text != ""]
        return "\n".join(parts)
