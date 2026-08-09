import type { ItemNameField } from "../../domain/item";
import type { ProjectDataSectionRevisions } from "../project-event";
import { read_item_name_text } from "../item-name";
import { compile_text_pattern, replace_text_pattern } from "../text/text-pattern";
import type { ProofreadingManualStatusCode } from "./proofreading-types";

// 校对 planner 只打包用户意图；仅需预判变化的命令才读取 query 的轻量 item 快照。
export type ProofreadingCommandItemSnapshot = {
  item_id: number | string;
  dst: string;
  name_src?: ItemNameField;
  name_dst?: ItemNameField;
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
    changes?: ProofreadingItemFieldUpdate[]; // 译文、译名与人工状态的统一字段更新
    item_ids?: number[]; // 批量替换或清空译文的目标 item 集合
    search_text?: string; // 批量替换搜索文本，真实替换由后端执行
    replace_text?: string; // 批量替换目标文本
    is_regex?: boolean; // 批量替换是否使用正则语义
    expected_section_revisions: ProjectDataSectionRevisions; // items 与 proofreading 双 section 乐观锁
  };
};

export type ProofreadingItemFieldUpdate = {
  item_id: number;
  dst?: string;
  name_dst?: string;
  status?: ProofreadingManualStatusCode;
};

// 校对计划只按目标 id 读取当前动作相关 item，避免重新依赖前端项目事实镜像。
function read_store_item(
  snapshot: ProofreadingCommandSnapshot,
  item_id: number,
): ProofreadingCommandItemSnapshot | undefined {
  return snapshot.items.find((item) => Number(item.item_id) === item_id);
}

// 校对写入同时依赖 items 与 proofreading revision。
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

// 正文或姓名译文任一字段实际变化即可纳入批量命令。
function has_replace_all_change(args: {
  item: ProofreadingCommandItemSnapshot;
  search_text: string;
  replace_text: string;
  is_regex: boolean;
}): boolean {
  const dst_replace_result = replace_all_in_text({
    text: args.item.dst,
    search_text: args.search_text,
    replace_text: args.replace_text,
    is_regex: args.is_regex,
  });
  if (dst_replace_result.count > 0 && dst_replace_result.text !== args.item.dst) {
    return true;
  }

  const name_dst = read_item_name_text(args.item.name_dst);
  const name_replace_result = replace_all_in_text({
    text: name_dst,
    search_text: args.search_text,
    replace_text: args.replace_text,
    is_regex: args.is_regex,
  });
  return name_replace_result.count > 0 && name_replace_result.text !== name_dst;
}

// 字段变更统一投影为批量更新命令，最终状态与进度统计由后端计算。
export function create_apply_item_changes_plan(args: {
  snapshot: ProofreadingCommandSnapshot;
  changes: ProofreadingItemFieldUpdate[];
}): ProofreadingCommandPlan | null {
  const changes: ProofreadingItemFieldUpdate[] = [];
  for (const requested of args.changes) {
    const current_item = read_store_item(args.snapshot, requested.item_id);
    if (current_item === undefined) continue;
    const change: ProofreadingItemFieldUpdate = { item_id: requested.item_id };
    // 后端会把非空 dst 默认置为 PROCESSED；这里仅预判该结果，避免漏掉显式覆盖状态。
    let automatic_status = current_item.status;
    if (requested.dst !== undefined && current_item.dst !== requested.dst) {
      change.dst = requested.dst;
      if (requested.dst !== "") automatic_status = "PROCESSED";
    }
    if (
      requested.name_dst !== undefined &&
      read_item_name_text(current_item.name_dst) !== requested.name_dst
    ) {
      change.name_dst = requested.name_dst;
    }
    if (
      requested.status !== undefined &&
      (requested.status !== automatic_status || current_item.retry_count !== 0)
    ) {
      change.status = requested.status;
    }
    if (change.dst !== undefined || change.name_dst !== undefined || change.status !== undefined) {
      changes.push(change);
    }
  }

  if (changes.length === 0) return null;

  return {
    changed_item_ids: changes.map((change) => change.item_id),
    request_body: {
      changes,
      expected_section_revisions: build_expected_revisions(args.snapshot.section_revisions),
    },
  };
}

// 批量替换只提交搜索命令，前端不提交替换后的最终 item 事实。
export function create_replace_all_plan(args: {
  snapshot: ProofreadingCommandSnapshot;
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
    if (
      has_replace_all_change({
        item: current_item,
        search_text: args.search_text,
        replace_text: args.replace_text,
        is_regex: args.is_regex,
      })
    ) {
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

// 批量清空只提交用户目标，是否存在实际变化由后端当前事实决定。
export function create_clear_translations_plan(args: {
  section_revisions: ProjectDataSectionRevisions;
  item_ids: number[];
}): ProofreadingCommandPlan {
  return {
    changed_item_ids: args.item_ids,
    request_body: {
      item_ids: args.item_ids,
      expected_section_revisions: build_expected_revisions(args.section_revisions),
    },
  };
}
