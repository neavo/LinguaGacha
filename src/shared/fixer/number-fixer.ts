// 圆圈数字列表：①-⑳
const CIRCLED_NUMBERS = Array.from({ length: 0x2474 - 0x2460 }, (_, index) =>
  String.fromCodePoint(0x2460 + index),
);

// CJK 圆圈数字扩展：㉑-㉟
const CIRCLED_NUMBERS_CJK_01 = Array.from({ length: 0x3260 - 0x3251 }, (_, index) =>
  String.fromCodePoint(0x3251 + index),
);

// CJK 圆圈数字扩展：㊱-㊿
const CIRCLED_NUMBERS_CJK_02 = Array.from({ length: 0x32c0 - 0x32b1 }, (_, index) =>
  String.fromCodePoint(0x32b1 + index),
);

// 开头放空字符串，让数组索引和数字面值对齐，例如 CIRCLED_NUMBERS_ALL[1] === "①"
const CIRCLED_NUMBERS_ALL = [
  "",
  ...CIRCLED_NUMBERS,
  ...CIRCLED_NUMBERS_CJK_01,
  ...CIRCLED_NUMBERS_CJK_02,
];

const ALL_NUMBER_PATTERN = /\d+|[①-⑳㉑-㉟㊱-㊿]/gu; // 预设正则：普通阿拉伯数字和圆圈数字都参与位置对齐

const CIRCLED_NUMBER_PATTERN = /[①-⑳㉑-㉟㊱-㊿]/gu; // 预设正则：只用于判断源文/译文里实际出现了多少圆圈数字

/**
 * 圆圈数字修复器，恢复模型把 `①` 译成 `1` 这类可逆变化
 */
export class NumberFixer {
  /**
   * 只在数字数量可一一对应时按索引恢复圆圈数字
   */
  public static fix(src: string, dst: string): string {
    const src_nums = src.match(ALL_NUMBER_PATTERN) ?? [];
    const dst_nums = dst.match(ALL_NUMBER_PATTERN) ?? [];
    const src_circled_nums = src.match(CIRCLED_NUMBER_PATTERN) ?? [];
    const dst_circled_nums = dst.match(CIRCLED_NUMBER_PATTERN) ?? [];
    if (
      src_circled_nums.length === 0 ||
      src_nums.length !== dst_nums.length ||
      src_circled_nums.length < dst_circled_nums.length
    ) {
      return dst;
    }
    let index = 0;
    return dst.replace(ALL_NUMBER_PATTERN, (dst_num) => {
      const src_num = src_nums[index++] ?? "";
      const dst_num_int = Number.parseInt(dst_num, 10);
      return CIRCLED_NUMBERS_ALL.includes(src_num) &&
        Number.isFinite(dst_num_int) &&
        CIRCLED_NUMBERS_ALL[dst_num_int] === src_num
        ? src_num
        : dst_num;
    });
  }
}
