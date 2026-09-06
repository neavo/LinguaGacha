import { Type } from "@earendil-works/pi-ai";

import { normalize_literal_text } from "../../../../../shared/text/literal-matcher";
import { define_agent_workspace_data_tool } from "./data-tool";

/** 公共片段至少需要两个不同词形才有业务意义。 */
const MIN_FORM_COUNT = 2;

const parameters = Type.Object(
  {
    forms: Type.Array(Type.String({ minLength: 1, pattern: "\\S" }), {
      minItems: MIN_FORM_COUNT,
      description:
        "已确认语义相关的短词形；经 Unicode 归一化和大小写折叠后，至少包含两种不同词形。",
    }),
  },
  { additionalProperties: false },
);

const result = Type.Object(
  {
    candidates: Type.Array(
      Type.Object(
        {
          root: Type.String({
            description: "所有词形共有的规范化连续片段，保留首个输入词形的原始写法。",
          }),
          grapheme_length: Type.Integer({
            minimum: 1,
            description: "候选原始写法的可见字符数；候选按此长度升序，等长按首项发现顺序排列。",
          }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** 只为已经确认语义相关的显式词形枚举候选，不推断关系或选择最终词根。 */
export const deriveCommonLiteralRoots = define_agent_workspace_data_tool({
  description: "为已确认相关的不同词形枚举公共连续字面片段候选。",
  parameters,
  result,
  /** 在可见字符边界枚举，并用正式匹配规范化核对完整词形集合。 */
  async execute(_context, args) {
    const forms = args.forms;
    const normalizedForms = forms.map((form) => normalize_literal_text(form, false));
    if (new Set(normalizedForms).size < MIN_FORM_COUNT) {
      throw new Error("forms must contain at least two distinct forms");
    }

    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    // 后续长度与包含判断都以用户可见字符为单位。
    const segment = (text: string): string[] =>
      [...segmenter.segment(text)].map((part) => part.segment);
    const baseGraphemes = segment(forms[0]);
    const normalizedFormGraphemes = normalizedForms.map(segment);
    const candidatesByNormalized = new Map<string, { root: string; grapheme_length: number }>();
    // 数组级匹配避免把组合字符或代理对拆开比较。
    const containsSequence = (form: string[], root: string[]): boolean => {
      for (let start = 0; start <= form.length - root.length; start += 1) {
        if (root.every((grapheme, offset) => form[start + offset] === grapheme)) return true;
      }
      return false;
    };

    // ponytail: 最坏 O(N × L⁴)，只适合短术语；基准证明不足时再引入子串索引。
    for (let start = 0; start < baseGraphemes.length; start += 1) {
      for (let end = start + 1; end <= baseGraphemes.length; end += 1) {
        const root = baseGraphemes.slice(start, end).join("");
        const normalizedRoot = segment(normalize_literal_text(root, false));
        const normalizedKey = JSON.stringify(normalizedRoot);
        if (
          normalizedRoot.join("").trim() === "" ||
          candidatesByNormalized.has(normalizedKey) ||
          !normalizedFormGraphemes.slice(1).every((form) => containsSequence(form, normalizedRoot))
        ) {
          continue;
        }
        candidatesByNormalized.set(normalizedKey, {
          root,
          grapheme_length: end - start,
        });
      }
    }

    return {
      // Map 保留发现顺序，稳定排序让等长候选沿用该顺序。
      candidates: [...candidatesByNormalized.values()].toSorted(
        (left, right) => left.grapheme_length - right.grapheme_length,
      ),
    };
  },
});
