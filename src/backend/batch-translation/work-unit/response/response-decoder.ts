import { JsonTool } from "../../../../shared/utils/json-tool";
import { split_text_lines } from "../../../../shared/text/text-lines";
import { is_json_record } from "../../../../domain/json";
import {
  normalize_translation_actor,
  type TranslationDecodedItem,
  type TranslationPromptMode,
  type TranslationRequestItem,
} from "../translation-item";

/**
 * 按翻译请求模式解码模型正文，保留 item 对齐信息
 */
export class ResponseDecoder {
  /** 多条按实际请求正文的行数对应，单条可直接接收换行变化后的完整译文。 */
  public decode_sakura(
    response: string,
    request_items: readonly TranslationRequestItem[],
  ): TranslationDecodedItem[] {
    if (request_items.length === 1) {
      return response.trim() === ""
        ? []
        : [{ request_id: request_items[0]!.request_id, text_dst: response, actor_dst: null }];
    }
    const lines = split_text_lines(response);
    const decoded: TranslationDecodedItem[] = [];
    let offset = 0; // 下一条译文在响应中的起始行，空行也占据对应位置。
    for (const item of request_items) {
      const end = offset + split_text_lines(item.text_src).length;
      const text_dst = lines.slice(offset, end).join("\n");
      offset = end;
      if (text_dst.trim() !== "") {
        decoded.push({ request_id: item.request_id, text_dst, actor_dst: null });
      }
    }
    // 整批行数对应后才接受候选译文，其余情况交给现有缩段重试。
    return offset === lines.length ? decoded : [];
  }

  /**
   * 按请求模式解码翻译结果，调用方负责按 request_id 对齐请求 item。
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

  /** 只接受安全请求 ID 与非空正文，调用方据此独立裁决每个请求 item。 */
  private build_translation_item(
    json_data: Record<string, unknown>,
    mode: TranslationPromptMode,
  ): TranslationDecodedItem | null {
    const request_id = this.read_request_id(json_data.id);
    if (request_id === null || typeof json_data.text !== "string" || json_data.text.trim() === "") {
      return null;
    }
    if (mode === "text") return { request_id, text_dst: json_data.text, actor_dst: null };
    if (json_data.actor !== null && typeof json_data.actor !== "string") return null;
    return {
      request_id,
      text_dst: json_data.text,
      actor_dst: normalize_translation_actor(json_data.actor),
    };
  }

  /**
   * 接受非负安全整数及其数字字符串，保持请求 ID 的数值匹配语义。
   */
  private read_request_id(key: unknown): number | null {
    if (typeof key === "number" && Number.isSafeInteger(key) && key >= 0) return key;
    if (typeof key !== "string" || !/^\d+$/u.test(key)) {
      return null;
    }
    const id = Number(key);
    return Number.isSafeInteger(id) ? id : null;
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
