import re
import rapidjson as json
from base.Base import Base
from module.Localizer.Localizer import Localizer

class ResponseDecoder(Base):

    # 前缀和后缀
    RE_STRIP_DICT = re.compile(r"^[^\{]*|[^\}]*$", flags = re.DOTALL)
    RE_STRIP_LIST = re.compile(r"^[^\[]*|[^\]]*$", flags = re.DOTALL)

    # 匹配翻译条目
    RE_TRANSLATION = re.compile(r"['\"‘“](\d+)['\"’”]\s*:\s*['\"‘“](.+?)['\"’”][,，\}\n]", flags = re.DOTALL)

    # 匹配术语条目
    RE_GLOSSARY = re.compile(r"\{[^:]+?:[^:]+?:[^:]+?:[^:]+?\}", flags = re.DOTALL)

    # 混合块分割
    RE_MIX_SPLIT = re.compile(r"['\"‘“]name['\"’”]\s*:", flags = re.DOTALL)

    # 翻译块识别
    RE_MIX_TRANSLATION = re.compile(r"['\"‘“]0['\"’”]\s*:", flags = re.DOTALL)

    def __init__(self) -> None:
        super().__init__()

    # 解析混合文本
    def decode_mix(self, response: str) -> tuple[dict[str, str], list[dict[str, str]], str]:
        log = ""
        dst = None
        glossary = None

        # 尝试直接反序列化
        json_data = self.decode_translation_by_json(response)
        if isinstance(json_data, dict):
            dst = json_data.get("translation")
            glossary = json_data.get("name")

            # 有效性验证
            if isinstance(dst, dict) and isinstance(dst.get("0"), str):
                log = log + "\n" + f"翻译数据 [bright_blue]->[/] 反序列化，共 {len(dst)} 条"
            else:
                dst = None
            if isinstance(glossary, list) and glossary != [] and isinstance(glossary[0], dict):
                log = log + "\n" + f"术语数据 [bright_blue]->[/] 反序列化，共 {len(glossary)} 条"
            else:
                glossary = None

        # 尝试通过规则解析
        if dst is None or glossary is None:
            dst_ex, glossary_ex, log = self.decode_mix_by_rule(response)
            dst = dst_ex if dst is None else dst
            glossary = glossary_ex if glossary is None else glossary

        # 返回默认值
        return dst, glossary, log

    # 解析翻译文本 - 直接反序列化
    def decode_mix_by_json(self, response: str) -> dict[str, dict]:
        json_data: dict[str, dict[str, str] | list[dict[str, str]]] = None

        try:
            json_data = json.loads(response)
        except:
            pass

        return json_data

    # 解析翻译文本 - 通过规则解析
    def decode_mix_by_rule(self, response: str) -> tuple[dict[str, str], list[dict[str, str]], str]:
        chunk_dst: str = ""
        chunk_glossary: str = ""

        # 将文本分割成两段
        chunks = ResponseDecoder.RE_MIX_SPLIT.split(response)
        for chunk in chunks:
            if ResponseDecoder.RE_MIX_TRANSLATION.findall(chunk) != []:
                chunk_dst = chunk
            else:
                chunk_glossary = chunk

        # 分别处理
        json_data_dst, log_dst = self.decode_translation(chunk_dst)
        json_data_glossary, log_glossary = self.decode_glossary(chunk_glossary)

        # 拼接日志
        log = ""
        if log_dst != "":
            log = log + log_dst + "\n"
        if log_glossary != "":
            log = log + log_glossary + "\n"
        log = log.removesuffix("\n")

        return json_data_dst, json_data_glossary, log

    # 解析翻译文本
    def decode_translation(self, response: str) -> tuple[dict[str, str], str] :
        if "{" in response and "}" in response:
            response = ResponseDecoder.RE_STRIP_DICT.sub("", response)

        # 尝试直接反序列化
        json_data = self.decode_translation_by_json(response)
        if isinstance(json_data, dict) and isinstance(json_data.get("0"), str):
            return json_data, Localizer.get().response_decoder_translation_by_json.replace("{COUNT}", f"{len(json_data)}")

        # 尝试通过规则解析
        json_data = self.decode_translation_by_rule(response)
        if isinstance(json_data, dict) and isinstance(json_data.get("0"), str):
            return json_data, Localizer.get().response_decoder_translation_by_rule.replace("{COUNT}", f"{len(json_data)}")

        return {}, ""

    # 解析翻译文本 - 直接反序列化
    def decode_translation_by_json(self, response: str) -> dict[str, str]:
        json_data: dict[str, str] = None

        try:
            json_data = json.loads(response)
        except:
            pass

        return json_data

    # 解析翻译文本 - 通过规则解析
    def decode_translation_by_rule(self, response: str) -> dict[str, str]:
        json_data: dict[str, str] = None

        results = {k: v.replace("\\\"", "\"").replace("\\\'", "\'") for k, v in ResponseDecoder.RE_TRANSLATION.findall(response)}
        if results != {}:
            json_data = results

        return json_data

    # 解析术语文本
    def decode_glossary(self, response: str) -> tuple[list[dict[str, str]], str]:
        if "[" in response and "]" in response:
            response = ResponseDecoder.RE_STRIP_LIST.sub("", response)

        # 尝试直接反序列化
        json_data = self.decode_glossary_by_json(response)
        if isinstance(json_data, list) and json_data != [] and isinstance(json_data[0], dict):
            return json_data, Localizer.get().response_decoder_glossary_by_json.replace("{COUNT}", f"{len(json_data)}")

        # 尝试通过规则解析
        json_data = self.decode_glossary_by_rule(response)
        if isinstance(json_data, list) and json_data != [] and isinstance(json_data[0], dict):
            return json_data, Localizer.get().response_decoder_glossary_by_rule.replace("{COUNT}", f"{len(json_data)}")

        return [], ""

    # 解析术语文本 - 直接反序列化
    def decode_glossary_by_json(self, response: str) -> list[dict[str, str]]:
        json_data: list[dict[str, str]] = None

        try:
            json_data = json.loads(response)
        except:
            pass

        return json_data

    # 解析术语文本 - 通过规则解析
    def decode_glossary_by_rule(self, response: str) -> dict[str, str]:
        json_data = []

        for item in ResponseDecoder.RE_GLOSSARY.findall(response):
            try:
                json_data.append(json.loads(item))
            except:
                pass

        return json_data