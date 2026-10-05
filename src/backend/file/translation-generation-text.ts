import type { Item } from "../../domain/item";

/**
 * `PROCESSED` 接受整条当前结果，`dst` 的空值、空格和换行均原样生效。
 * 其它状态返回 `undefined`，格式按源资产选择正文。姓名由 `resolve_output_item_name()` 解释。
 *
 * - 单值类（TXT、Markdown、ASS、SRT、MESSAGEJSON、EPUB）：未完成时使用 `src`。
 *   格式负责表达空正文，EPUB 书名与目录等受限位置回源。
 * - KV 类（XLSX、WOLFXLSX、TRANS）：仅完成结果覆盖目标，未完成时保留源译文及其结构。
 * - KV 带回退类（RENPY、MTool KVJSON）：未完成时保留源资产非空译文，空占位回退 `src`。
 *
 * `DUPLICATED` 在生成服务中先复用同组已完成结果，只修改生成对象。
 */
export function read_translation_for_generation(
  item: Readonly<Pick<Item, "status" | "dst">>,
): string | undefined {
  return item.status === "PROCESSED" ? item.dst : undefined;
}
