import type { TextPreserveRule } from "../text/text-preserve-rules";

/**
 * 代码保护段修复器，删除译文中相对源文多出来的保护段
 */
export class CodeFixer {
  /**
   * 只有源文保护段是译文保护段的有序子集时才删除多余项
   */
  public static fix(src: string, dst: string, rule: TextPreserveRule | null): string {
    if (rule === null) {
      return dst;
    }
    const src_codes = this.collect_codes(src, rule);
    const dst_codes = this.collect_codes(dst, rule);
    if (src_codes.join("\u0000") === dst_codes.join("\u0000")) {
      return dst;
    }
    if (src_codes.length >= dst_codes.length) {
      return dst;
    }
    const subset = this.is_ordered_subset(src_codes, dst_codes);
    if (!subset.ok) {
      return dst;
    }
    let index = 0;
    return rule.replace(dst, (match) => {
      if (match.trim() === "") {
        return match;
      }
      return subset.mismatch_indexes.has(index++) ? "" : match;
    });
  }

  /**
   * 保护规则对象内部负责候选过滤，修复器只消费非空保护段序列
   */
  private static collect_codes(text: string, rule: TextPreserveRule): string[] {
    return rule.collect(text).filter((value) => value.trim() !== "");
  }

  /**
   * 判断 x 是否是 y 的有序子集，并记录 y 中多余元素索引
   */
  private static is_ordered_subset(
    x: string[],
    y_list: string[],
  ): { ok: boolean; mismatch_indexes: Set<number> } {
    const y_copy = [...y_list];
    const mismatch_indexes = new Set<number>();
    let y_index = -1;
    for (const x_item of x) {
      let matched = false;
      while (y_copy.length > 0) {
        const y_item = y_copy.shift() ?? "";
        y_index += 1;
        if (x_item === y_item) {
          matched = true;
          break;
        }
        mismatch_indexes.add(y_index);
      }
      if (!matched) {
        return { ok: false, mismatch_indexes: new Set() };
      }
    }
    for (let index = 0; index < y_copy.length; index += 1) {
      mismatch_indexes.add(y_index + index + 1);
    }
    return { ok: true, mismatch_indexes };
  }
}
