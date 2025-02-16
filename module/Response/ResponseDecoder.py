import re
import rapidjson as json
from base.Base import Base

class ResponseDecoder(Base):

    GLOSSARY_PATTERN = re.compile(r"(\{[^:]+:[^:]+:[^:]+:[^:]+\})\s*[,，\]]", flags = re.DOTALL)
    TRANSLATION_PATTERN = re.compile(r"['\"‘“](\d+)['\"’”]\s*:\s*['\"‘“]([^'\"‘”]+)['\"’”]", flags = re.DOTALL)

    def __init__(self) -> None:
        super().__init__()

    # 从响应文本中解析出结果
    def decode(self, response: str) -> tuple[dict[str, str], dict[str, str]]:
        glossary = []
        translation = {}

        # 预处理
        response = response.strip().replace("```json", "").replace("```", "")

        try:
            json_data = json.loads(response)

            # 处理不同的数据结构
            if "0" in json_data:
                translation = json_data
            elif "translation" in json_data:
                glossary = json_data.get("name", [])
                translation = json_data.get("translation", {})

            # 确保数据结构正确
            if not isinstance(glossary, list):
                raise ValueError("Invalid JSON format")
            if not isinstance(translation, dict):
                raise ValueError("Invalid JSON format")

            return translation, glossary
        except:
            pass

        if not ("\"translation\"" in response and "\"name\"" in response):
            translation = self.decode_translation(response)
        else:
            x, y = response.split("\"name\"")
            if "\"translation\"" in x:
                glossary = self.decode_glossary(y)
                translation = self.decode_translation(x)
            else:
                glossary = self.decode_glossary(x)
                translation = self.decode_translation(y)

        return translation, glossary

    # 从响应文本中解析出术语表
    def decode_glossary(self, response: str) -> list[dict[str, str]]:
        result = []

        for item in ResponseDecoder.GLOSSARY_PATTERN.findall(response):
            try:
                result.append(json.loads(item))
            except:
                pass

        return result

    # 从响应文本中解析出翻译
    def decode_translation(self, response: str) -> dict[str, str]:
        return {k: v for k, v in ResponseDecoder.TRANSLATION_PATTERN.findall(response)}