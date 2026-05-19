export type AnalysisCandidateGlossaryEntry = {
  src: string; // 候选原文，作为候选池消费和术语表 key 的共同身份
  dst: string; // 最高票译文，进入术语表前已去掉空白
  info: string; // 最高票类型说明，决定候选是否能作为术语导出
  regex: false; // 分析候选只生成普通术语，不生成正则规则
  case_sensitive: boolean; // 是否大小写敏感，沿用候选聚合行的服务端事实
};

const CONTROL_CODE_SELF_MAPPING_PATTERN = /\\(?:n|N){1,2}\[\d+\]/u; // 控制码自映射允许入表，普通原译相同候选会被过滤
const NON_GLOSSARY_INFO_VALUES = new Set(["其它", "其他", "other", "others"]); // 非术语类型跨中英文模型输出统一排除

// 本模块消费跨前后端 JSON，先用窄化函数隔离坏载荷，避免各调用点重复写对象判断。
function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 候选投票表只接受非空文本和正数票，保证 winner 选择、计数和导出共用同一坏值处理。
export function normalize_analysis_candidate_vote_map(value: unknown): Record<string, number> {
  if (!is_record(value)) {
    return {};
  }

  const normalized: Record<string, number> = {};
  for (const [raw_text, raw_votes] of Object.entries(value)) {
    const text = raw_text.trim();
    const votes = Number(raw_votes);
    if (text === "" || !Number.isFinite(votes) || votes <= 0) {
      continue;
    }
    normalized[text] = (normalized[text] ?? 0) + votes;
  }
  return normalized;
}

// 同票时保留对象插入顺序，匹配数据库候选聚合和历史导出结果的稳定性。
export function pick_analysis_candidate_winner(votes: Record<string, number>): string {
  let winner = "";
  let winner_votes = -1;
  for (const [text, count] of Object.entries(votes)) {
    if (count > winner_votes) {
      winner = text;
      winner_votes = count;
    }
  }
  return winner.trim();
}

// 控制码自映射用于保留脚本占位符，不让普通“原文等于译文”的候选进入术语表。
export function is_analysis_control_code_self_mapping(src: string, dst: string): boolean {
  const normalized_src = src.trim();
  return (
    normalized_src !== "" &&
    normalized_src === dst.trim() &&
    CONTROL_CODE_SELF_MAPPING_PATTERN.test(normalized_src)
  );
}

// 将一行候选聚合归一成术语条目；返回 null 表示它不应计入可导出候选数。
export function build_analysis_glossary_entry_from_candidate(
  value: unknown,
  fallback_src = "",
): AnalysisCandidateGlossaryEntry | null {
  if (!is_record(value)) {
    return null;
  }

  const src = String(value["src"] ?? fallback_src).trim();
  const dst = pick_analysis_candidate_winner(
    normalize_analysis_candidate_vote_map(value["dst_votes"]),
  );
  const info = pick_analysis_candidate_winner(
    normalize_analysis_candidate_vote_map(value["info_votes"]),
  );
  if (src === "" || dst === "" || info === "") {
    return null;
  }
  if (dst === src && !is_analysis_control_code_self_mapping(src, dst)) {
    return null;
  }
  if (NON_GLOSSARY_INFO_VALUES.has(info.toLowerCase())) {
    return null;
  }

  return {
    src,
    dst,
    info,
    regex: false,
    case_sensitive: Boolean(value["case_sensitive"]),
  };
}

// 面向导入预演和 CLI 导出生成稳定排序的术语候选列表。
export function build_analysis_glossary_entries_from_candidates(
  candidate_aggregate: Record<string, unknown>,
): AnalysisCandidateGlossaryEntry[] {
  return Object.entries(candidate_aggregate)
    .sort((left_entry, right_entry) => left_entry[0].localeCompare(right_entry[0], "zh-Hans-CN"))
    .flatMap(([raw_src, raw_entry]) => {
      const entry = build_analysis_glossary_entry_from_candidate(raw_entry, raw_src);
      return entry === null ? [] : [entry];
    });
}

// 导入动作消费“本轮已处理候选池”，因此这里覆盖有译文票数的候选，而不只覆盖最终写入术语表的条目。
export function collect_analysis_candidate_srcs_from_aggregate(
  candidate_aggregate: Record<string, unknown>,
): string[] {
  const srcs: string[] = [];
  const seen_srcs = new Set<string>();
  for (const [raw_src, raw_entry] of Object.entries(candidate_aggregate).sort(
    (left_entry, right_entry) => left_entry[0].localeCompare(right_entry[0], "zh-Hans-CN"),
  )) {
    if (!is_record(raw_entry)) {
      continue;
    }
    const src = String(raw_entry["src"] ?? raw_src).trim();
    const dst = pick_analysis_candidate_winner(
      normalize_analysis_candidate_vote_map(raw_entry["dst_votes"]),
    );
    if (src === "" || dst === "" || seen_srcs.has(src)) {
      continue;
    }
    seen_srcs.add(src);
    srcs.push(src);
  }
  return srcs;
}

// 后端 meta 中的候选数量只统计共享规则认定的可导出术语，避免任务提交与导入后重算分叉。
export function count_analysis_glossary_candidates(candidates: Iterable<unknown>): number {
  let count = 0;
  for (const candidate of candidates) {
    if (build_analysis_glossary_entry_from_candidate(candidate) !== null) {
      count += 1;
    }
  }
  return count;
}
