import type { ProjectDataSectionRevisions } from "../project-event";
import { compile_text_pattern, replace_text_pattern } from "../text/text-pattern";

export type ProofreadingManualStatusCode = "NONE" | "PROCESSED" | "EXCLUDED";

// 校对 planner 只读取当前 query 结果中的轻量 item 快照判断是否需要发命令。
export type ProofreadingCommandItemSnapshot = {
  item_id: number | string;
  dst: string;
  status: string;
  retry_count: number;
};

export type ProofreadingCommandSnapshot = {
  items: ProofreadingCommandItemSnapshot[];
  section_revisions: ProjectDataSectionRevisions;
};

export type ProofreadingCommandPlan = {
  changed_item_ids: number[]; // UI 用于计数和乐观反馈，不作为最终写库事实
  request_body: {
    item_id?: number; // 单条保存目标 item
    dst?: string; // 单条保存目标译文
    item_ids?: number[]; // 批量替换、清空译文或设置状态的目标 item 集合
    status?: ProofreadingManualStatusCode; // 批量设置的人工翻译状态
    search_text?: string; // 批量替换搜索文本，真实替换由后端执行
    replace_text?: string; // 批量替换目标文本
    is_regex?: boolean; // 批量替换是否使用正则语义
    expected_section_revisions: ProjectDataSectionRevisions; // items 与 proofreading 双 section 乐观锁
  };
};

// 校对计划只按目标 id 读取当前动作相关 item，避免重新依赖前端项目事实镜像。
function read_store_item(
  snapshot: ProofreadingCommandSnapshot,
  item_id: number,
): ProofreadingCommandItemSnapshot | undefined {
  return snapshot.items.find((item) => Number(item.item_id) === item_id);
}

// 校对 write 同时依赖 items 与 proofreading revision。
function build_expected_revisions(
  section_revisions: ProjectDataSectionRevisions,
): ProjectDataSectionRevisions {
  return {
    items: section_revisions.items ?? 0,
    proofreading: section_revisions.proofreading ?? 0,
  };
}

// 前端只预判替换是否会产生变化，最终替换文本以后端当前数据库事实为准。
function replace_all_in_text(args: {
  text: string;
  search_text: string;
  replace_text: string;
  is_regex: boolean;
}): { text: string; count: number } {
  if (!args.is_regex && args.search_text === "") {
    return {
      text: args.text,
      count: 0,
    };
  }

  const pattern = compile_text_pattern({
    source_text: args.search_text,
    mode: args.is_regex ? "regex" : "literal",
    case_sensitive: false,
    global: true,
    trim: false,
  });
  if (pattern === null) {
    return {
      text: args.text,
      count: 0,
    };
  }

  return replace_text_pattern({
    text: args.text,
    pattern,
    replacement_text: args.replace_text,
    replacement_syntax: args.is_regex ? "javascript" : "literal",
  });
}

// 单条保存只提交 item_id 和 dst，status 与进度统计由后端派生。
export function create_save_item_plan(args: {
  snapshot: ProofreadingCommandSnapshot;
  task_snapshot?: Record<string, unknown>;
  item_id: number;
  next_dst: string;
}): ProofreadingCommandPlan | null {
  const current_item = read_store_item(args.snapshot, args.item_id);
  if (current_item === undefined || current_item.dst === args.next_dst) {
    return null;
  }

  return {
    changed_item_ids: [args.item_id],
    request_body: {
      item_id: args.item_id,
      dst: args.next_dst,
      expected_section_revisions: build_expected_revisions(args.snapshot.section_revisions),
    },
  };
}

// 批量替换只提交搜索命令，前端不提交替换后的最终 item 事实。
export function create_replace_all_plan(args: {
  snapshot: ProofreadingCommandSnapshot;
  task_snapshot?: Record<string, unknown>;
  item_ids: number[];
  search_text: string;
  replace_text: string;
  is_regex: boolean;
}): ProofreadingCommandPlan | null {
  const changed_item_ids: number[] = [];

  for (const item_id of args.item_ids) {
    const current_item = read_store_item(args.snapshot, item_id);
    if (current_item === undefined) {
      continue;
    }
    const replace_result = replace_all_in_text({
      text: current_item.dst,
      search_text: args.search_text,
      replace_text: args.replace_text,
      is_regex: args.is_regex,
    });
    if (replace_result.count > 0 && replace_result.text !== current_item.dst) {
      changed_item_ids.push(item_id);
    }
  }

  if (changed_item_ids.length === 0) {
    return null;
  }

  return {
    changed_item_ids,
    request_body: {
      item_ids: args.item_ids,
      search_text: args.search_text,
      replace_text: args.replace_text,
      is_regex: args.is_regex,
      expected_section_revisions: build_expected_revisions(args.snapshot.section_revisions),
    },
  };
}

// 批量清空译文只提交目标 id，后端保留状态和重试计数。
export function create_clear_translations_plan(args: {
  snapshot: ProofreadingCommandSnapshot;
  task_snapshot?: Record<string, unknown>;
  item_ids: number[];
}): ProofreadingCommandPlan | null {
  const changed_item_ids: number[] = [];

  for (const item_id of args.item_ids) {
    const current_item = read_store_item(args.snapshot, item_id);
    if (current_item === undefined) {
      continue;
    }
    if (current_item.dst === "") {
      continue;
    }
    changed_item_ids.push(item_id);
  }

  if (changed_item_ids.length === 0) {
    return null;
  }

  return {
    changed_item_ids,
    request_body: {
      item_ids: args.item_ids,
      expected_section_revisions: build_expected_revisions(args.snapshot.section_revisions),
    },
  };
}

// 批量设置状态提交目标状态；同状态但仍有 retry_count 时也需要提交清理。
export function create_set_translation_status_plan(args: {
  snapshot: ProofreadingCommandSnapshot;
  task_snapshot?: Record<string, unknown>;
  item_ids: number[];
  status: ProofreadingManualStatusCode;
}): ProofreadingCommandPlan | null {
  const changed_item_ids: number[] = [];

  for (const item_id of args.item_ids) {
    const current_item = read_store_item(args.snapshot, item_id);
    if (current_item === undefined) {
      continue;
    }
    if (current_item.status === args.status && current_item.retry_count === 0) {
      continue;
    }
    changed_item_ids.push(item_id);
  }

  if (changed_item_ids.length === 0) {
    return null;
  }

  return {
    changed_item_ids,
    request_body: {
      item_ids: args.item_ids,
      status: args.status,
      expected_section_revisions: build_expected_revisions(args.snapshot.section_revisions),
    },
  };
}
