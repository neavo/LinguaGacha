import { JsonTool } from "../../../../shared/utils/json-tool";
import {
  normalize_translation_actor,
  type TranslationDecodedLine,
  type TranslationPromptMode,
} from "../translation-line";

/**
 * 模型响应解码器，显式区分翻译结果和术语候选
 */
export class ResponseDecoder {
  /**
   * 按请求模式解码翻译结果，调用方负责按 request_index 对齐请求行。
   */
  public async decode_translation(
    response: string,
    mode: TranslationPromptMode,
  ): Promise<TranslationDecodedLine[]> {
    const lines: TranslationDecodedLine[] = [];
    for (const line of response.split(/\r?\n/u)) {
      const stripped_line = line.trim();
      if (stripped_line === "" || stripped_line.startsWith("```")) {
        continue;
      }
      const json_data = await this.repair_parse_object(stripped_line);
      if (json_data === null) {
        continue;
      }
      lines.push(...this.build_translation_lines(json_data, mode, true));
    }
    if (lines.length > 0) {
      return lines;
    }
    const json_data = await this.repair_parse_object(response);
    return json_data === null ? [] : this.build_translation_lines(json_data, mode, false);
  }

  /**
   * 分析链路只解码 src/dst/type 候选，翻译 JSONL 不参与术语输出。
   */
  public async decode_glossary_entries(response: string): Promise<Array<Record<string, string>>> {
    const glossary_entries: Array<Record<string, string>> = [];
    for (const line of response.split(/\r?\n/u)) {
      const stripped_line = line.trim();
      if (stripped_line === "" || stripped_line.startsWith("```")) {
        continue;
      }
      const json_data = await this.repair_parse_object(stripped_line);
      if (json_data === null) {
        continue;
      }
      const glossary_entry = this.build_glossary_entry(json_data);
      if (glossary_entry !== null) {
        glossary_entries.push(glossary_entry);
      }
    }
    return glossary_entries;
  }

  /**
   * JSONLINE 行必须是单键对象；整块对象回退允许多个序号键。
   */
  private build_translation_lines(
    json_data: Record<string, unknown>,
    mode: TranslationPromptMode,
    require_single_entry: boolean,
  ): TranslationDecodedLine[] {
    const entries = Object.entries(json_data);
    if (require_single_entry && entries.length !== 1) {
      return [];
    }
    const lines: TranslationDecodedLine[] = [];
    for (const [key, value] of entries) {
      const request_index = this.read_request_index(key);
      if (request_index === null) {
        continue;
      }
      const line =
        mode === "actor_text"
          ? this.build_actor_text_line(request_index, value)
          : this.build_text_line(request_index, value);
      if (line !== null) {
        lines.push(line);
      }
    }
    return lines;
  }

  /**
   * 纯文本模式只接收字符串译文，坏值交由缺行校验处理。
   */
  private build_text_line(request_index: number, value: unknown): TranslationDecodedLine | null {
    if (typeof value !== "string") {
      return null;
    }
    return { request_index, text_dst: value, actor_dst: null };
  }

  /**
   * actor/text 模式要求对象同时带 actor 和 text，避免旧字符串响应误写姓名字段。
   */
  private build_actor_text_line(
    request_index: number,
    value: unknown,
  ): TranslationDecodedLine | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (!("actor" in record) || typeof record.text !== "string") {
      return null;
    }
    if (record.actor !== null && typeof record.actor !== "string") {
      return null;
    }
    return {
      request_index,
      text_dst: record.text,
      actor_dst: normalize_translation_actor(record.actor),
    };
  }

  /**
   * request_index 只允许安全整数，防止模型输出任意 key 污染对齐流程。
   */
  private read_request_index(key: string): number | null {
    if (!/^\d+$/u.test(key)) {
      return null;
    }
    const index = Number(key);
    return Number.isSafeInteger(index) ? index : null;
  }

  /**
   * `src/dst/type` 三字段对象归一成分析候选
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
   * jsonrepair 失败时返回 null，模型杂质文本直接忽略
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
