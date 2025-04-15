import json_repair as repair

from base.Base import Base

class ResponseDecoder(Base):

    def __init__(self) -> None:
        super().__init__()

    # 解析文本
    def decode(self, response: str) -> tuple[dict[str, str], list[dict[str, str]]]:
        dst_dict: dict[str, str] = {}
        glossary_list: list[dict[str, str]] = []

        # 按行解析失败时，尝试按照普通 JSON 字典进行解析
        for line in response.splitlines():
            json_data = repair.loads(line)
            if isinstance(json_data, dict):
                # 翻译结果
                if len(json_data) == 1:
                    _, v = list(json_data.items())[0]
                    if isinstance(v, str):
                        dst_dict[str(len(dst_dict))] = v

                # 术语表条目
                if len(json_data) == 3:
                    if "src" in json_data and "dst" in json_data and "gender" in json_data:
                        glossary_list.append(
                            {
                                "src": json_data.get("src"),
                                "dst": json_data.get("dst"),
                                "info": json_data.get("gender")
                            }
                        )

        # 按行解析失败时，尝试按照普通 JSON 字典进行解析
        if len(dst_dict) == 0:
            json_data = repair.loads(response)
            if isinstance(json_data, dict) and isinstance(json_data.get("0"), str):
                dst_dict = json_data

        # 返回默认值
        return dst_dict, glossary_list