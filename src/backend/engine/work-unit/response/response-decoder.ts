import { JsonTool } from "../../../../shared/utils/json-tool";
import { split_text_lines } from "../../../../shared/text/text-lines";
import { is_json_record } from "../../../../domain/json";
import {
  normalize_translation_actor,
  type TranslationDecodedItem,
  type TranslationPromptMode,
} from "../translation-item";

/**
 * 模型响应解码器，显式区分翻译结果和术语候选
 */
export class ResponseDecoder {
  /** 解码单 item Sakura 请求返回的完整纯文本正文。 */
  public decode_plain_text_item(response: string, request_index: number): TranslationDecodedItem[] {
    return response.trim() === "" ? [] : [{ request_index, text_dst: response, actor_dst: null }];
  }

  /**
   * 按请求模式解码翻译结果，调用方负责按 request_index 对齐请求 item。
   */
  public async decode_translation(
    response: string,
    mode: TranslationPromptMode,
  ): Promise<TranslationDecodedItem[]> {
    const lines: TranslationDecodedItem[] = [];
    for (const line of split_text_lines(response)) {
      const stripped_line = line.trim();
      if (stripped_line === "" || stripped_line.startsWith("```")) {
        continue;
      }
      const json_data = await this.repair_parse_object(stripped_line);
      if (json_data === null) {
        continue;
      }
      const item = this.build_translation_item(json_data, mode);
      if (item !== null) lines.push(item);
    }
    if (lines.length > 0) {
      return lines;
    }
    const json_data = await this.repair_parse_object(response);
    if (json_data === null) return [];
    const item = this.build_translation_item(json_data, mode);
    return item === null ? [] : [item];
  }

  /**
   * 分析链路只解码 src/dst/type 候选，翻译 JSONL 不参与术语输出。
   */
  public async decode_glossary_entries(response: string): Promise<Array<Record<string, string>>> {
    const glossary_entries: Array<Record<string, string>> = [];
    for (const line of split_text_lines(response)) {
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

  /** 解码请求与响应共用的固定 index/text 记录。 */
  private build_translation_item(
    json_data: Record<string, unknown>,
    mode: TranslationPromptMode,
  ): TranslationDecodedItem | null {
    const request_index = this.read_request_index(json_data.index);
    if (request_index === null || typeof json_data.text !== "string") return null;
    if (mode === "text") return { request_index, text_dst: json_data.text, actor_dst: null };
    if (json_data.actor !== null && typeof json_data.actor !== "string") return null;
    return {
      request_index,
      text_dst: json_data.text,
      actor_dst: normalize_translation_actor(json_data.actor),
    };
  }

  /**
   * request_index 只允许安全整数，防止模型输出任意 key 污染对齐流程。
   */
  private read_request_index(key: unknown): number | null {
    if (typeof key === "number" && Number.isSafeInteger(key) && key >= 0) return key;
    if (typeof key !== "string" || !/^\d+$/u.test(key)) {
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
      return is_json_record(value) ? value : null;
    } catch {
      return null;
    }
  }
}
