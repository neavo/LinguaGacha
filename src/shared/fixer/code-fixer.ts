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
    if (src_codes.length >= dst_codes.length) {
      return dst;
    }
    const mismatch_indexes = this.find_extra_indexes(src_codes, dst_codes);
    if (mismatch_indexes === null) {
      return dst;
    }
    let index = 0;
    return rule.replace(dst, (match) => {
      if (match.trim() === "") {
        return match;
      }
      return mismatch_indexes.has(index++) ? "" : match;
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
  private static find_extra_indexes(expected: string[], actual: string[]): Set<number> | null {
    const mismatch_indexes = new Set<number>();
    let expected_index = 0;
    actual.forEach((item, index) => {
      if (item === expected[expected_index]) {
        expected_index += 1;
      } else {
        mismatch_indexes.add(index);
      }
    });
    return expected_index === expected.length ? mismatch_indexes : null;
  }
}
