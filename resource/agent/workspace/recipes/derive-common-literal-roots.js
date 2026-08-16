/** 公共片段至少需要两个不同词形才有业务意义。 */
const MIN_FORM_COUNT = 2;

// 只为已经确认语义相关的显式词形枚举候选，不推断关系或选择最终词根。
async function runRecipe(_workspace, args) {
  if (
    !Array.isArray(args.forms) ||
    args.forms.length < MIN_FORM_COUNT ||
    args.forms.some((form) => typeof form !== "string" || form.trim() === "")
  ) {
    throw new Error("forms 必须包含至少两个非空字符串");
  }

  // 与正式字面 matcher 的不区分大小写规范化保持同义。
  const normalize = (text) =>
    text
      .normalize("NFKC")
      .replaceAll("ẞ", "ss")
      .replaceAll("ß", "ss")
      .toLowerCase()
      .replaceAll("ς", "σ");
  const normalizedForms = args.forms.map(normalize);
  if (new Set(normalizedForms).size < MIN_FORM_COUNT) {
    throw new Error("forms 必须包含至少两个不同词形");
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  // 后续长度与包含判断都以用户可见字符为单位。
  const segment = (text) => [...segmenter.segment(text)].map((part) => part.segment);
  const baseGraphemes = [...segmenter.segment(args.forms[0])].map((part) => part.segment);
  const normalizedFormGraphemes = normalizedForms.map(segment);
  const candidatesByNormalized = new Map();
  // 数组级匹配避免把组合字符或代理对拆开比较。
  const containsSequence = (form, root) => {
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
}

// runner 在同一函数体末尾追加真实调用；这里让独立资源的静态检查看到消费者。
void runRecipe;
