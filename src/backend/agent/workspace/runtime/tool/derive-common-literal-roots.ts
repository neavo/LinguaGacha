import { Type } from "@earendil-works/pi-ai";

import { define_agent_workspace_data_tool } from "./data-tool";

/** 公共片段至少需要两个不同词形才有业务意义。 */
const MIN_FORM_COUNT = 2;

const parameters = Type.Object(
  { forms: Type.Array(Type.String({ minLength: 1 }), { minItems: MIN_FORM_COUNT }) },
  { additionalProperties: false },
);

const result = Type.Object(
  {
    candidates: Type.Array(
      Type.Object(
        { root: Type.String(), grapheme_length: Type.Integer({ minimum: 1 }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** 只为已经确认语义相关的显式词形枚举候选，不推断关系或选择最终词根。 */
export const deriveCommonLiteralRoots = define_agent_workspace_data_tool({
  useWhen: "为已确认相关的不同词形枚举公共连续字面片段",
  description: "为已确认相关的不同词形枚举公共连续字面片段候选。",
  parameters,
  result,
  async execute(_context, args) {
    if (args.forms.some((form) => form.trim() === "")) {
      throw new Error("forms must contain at least two non-empty strings");
    }

    // 与正式字面 matcher 的不区分大小写规范化保持同义。
    const normalize = (text: string): string =>
      text
        .normalize("NFKC")
        .replaceAll("ẞ", "ss")
        .replaceAll("ß", "ss")
        .toLowerCase()
        .replaceAll("ς", "σ");
    const forms = args.forms;
    const normalizedForms = forms.map(normalize);
    if (new Set(normalizedForms).size < MIN_FORM_COUNT) {
      throw new Error("forms must contain at least two distinct forms");
    }

    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    // 后续长度与包含判断都以用户可见字符为单位。
    const segment = (text: string): string[] =>
      [...segmenter.segment(text)].map((part) => part.segment);
    const baseGraphemes = [...segmenter.segment(forms[0] ?? "")].map((part) => part.segment);
    const normalizedFormGraphemes = normalizedForms.map(segment);
    const candidatesByNormalized = new Map<
      string,
      { root: string; grapheme_length: number; discovery_order: number }
    >();
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
        const normalizedRoot = segment(normalize(root));
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
          discovery_order: candidatesByNormalized.size,
        });
      }
    }

    return {
      candidates: [...candidatesByNormalized.values()]
        .toSorted(
          (left, right) =>
            left.grapheme_length - right.grapheme_length ||
            left.discovery_order - right.discovery_order,
        )
        .map(({ root, grapheme_length }) => ({ root, grapheme_length })),
    };
  },
});
