from __future__ import annotations

from module.Utils.JSONTool import JSONTool


# 分析任务固定使用旧版 JSONLINE + type 口径，避免提示词和解码器再出现双轨漂移。
class AnalysisResponseDecoder:
    def decode(self, response: str) -> list[dict[str, str]] | None:
        normalized_response = self.strip_code_block(response)
        parsed_terms = self.parse_json_lines(normalized_response)
        if parsed_terms is None:
            return None
        return self.normalize_terms(parsed_terms)

    def strip_code_block(self, response: str) -> str:
        stripped = response.strip()
        if not stripped.startswith("```"):
            return stripped

        lines = stripped.splitlines()
        if len(lines) <= 2:
            return stripped.strip("`").strip()
        return "\n".join(lines[1:-1]).strip()

    def parse_json_lines(self, response: str) -> list[dict[str, object]] | None:
        parsed_terms: list[dict[str, object]] = []
        for line in response.splitlines():
            stripped = line.strip()
            if stripped == "":
                continue
            json_data = JSONTool.repair_loads(stripped)
            if not isinstance(json_data, dict):
                return None
            if not self.is_legacy_term_dict(json_data):
                return None
            parsed_terms.append(json_data)
        if not parsed_terms:
            return None
        return parsed_terms

    def is_legacy_term_dict(self, value: dict[str, object]) -> bool:
        return "src" in value and "dst" in value and "type" in value

    def normalize_terms(
        self, raw_terms: list[dict[str, object]]
    ) -> list[dict[str, str]] | None:
        terms: list[dict[str, str]] = []
        for raw_term in raw_terms:
            src = raw_term.get("src")
            dst = raw_term.get("dst")
            raw_info = raw_term.get("type", "")
            if not isinstance(src, str) or not isinstance(dst, str):
                return None
            if not isinstance(raw_info, str):
                return None

            terms.append(
                {
                    "src": src,
                    "dst": dst,
                    "info": raw_info,
                }
            )
        return terms
