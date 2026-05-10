import { JsonTool } from "../../../shared/utils/json-tool";

/**
 * 模型响应解码器，宽容读取 JSONLINE 翻译结果和术语候选。
 */
export class ResponseDecoder {
  /**
   * 按行抽取 JSON 对象；若行式失败，再尝试整块 JSON 对象回退。
   */
  public async decode(response: string): Promise<{
    translations: string[];
    glossary_entries: Array<Record<string, string>>;
  }> {
    const translations: string[] = [];
    const glossary_entries: Array<Record<string, string>> = [];
    for (const line of response.split(/\r?\n/u)) {
      const stripped_line = line.trim();
      if (stripped_line === "") {
        continue;
      }
      const json_data = await this.repair_parse_object(stripped_line);
      if (json_data === null) {
        continue;
      }
      const translation_text = this.get_translation_text(json_data);
      if (translation_text !== null) {
        translations.push(translation_text);
        continue;
      }
      const glossary_entry = this.build_glossary_entry(json_data);
      if (glossary_entry !== null) {
        glossary_entries.push(glossary_entry);
      }
    }
    if (translations.length === 0) {
      const json_data = await this.repair_parse_object(response);
      if (json_data !== null) {
        for (const value of Object.values(json_data)) {
          if (typeof value === "string") {
            translations.push(value);
          }
        }
      }
    }
    return { translations, glossary_entries };
  }

  /**
   * 单键字典视为一行翻译结果。
   */
  private get_translation_text(json_data: Record<string, unknown>): string | null {
    const values = Object.values(json_data);
    return values.length === 1 && typeof values[0] === "string" ? values[0] : null;
  }

  /**
   * `src/dst/type` 三字段对象归一成分析候选。
   */
  private build_glossary_entry(json_data: Record<string, unknown>): Record<string, string> | null {
    if (Object.keys(json_data).length !== 3) {
      return null;
    }
    if (!("src" in json_data) || !("dst" in json_data) || !("type" in json_data)) {
      return null;
    }
    return {
      src: typeof json_data.src === "string" ? json_data.src : "",
      dst: typeof json_data.dst === "string" ? json_data.dst : "",
      info: typeof json_data.type === "string" ? json_data.type : "",
    };
  }

  /**
   * jsonrepair 失败时返回 null，模型杂质文本直接忽略。
   */
  private async repair_parse_object(text: string): Promise<Record<string, unknown> | null> {
    try {
      const value = await JsonTool.repairParse<unknown>(text);
      return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}
