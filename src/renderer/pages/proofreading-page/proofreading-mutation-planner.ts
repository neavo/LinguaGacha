import type {
  ProjectStoreSectionRevisions,
  ProjectStoreState,
} from "@/project/store/project-store";
import type { ProjectItemPublicRecord } from "@base/item";
import { compile_text_pattern, replace_text_pattern } from "@shared/text/text-pattern";

// 校对 planner 只读取公开 DTO 镜像判断是否需要发命令。
type ProofreadingStoreItem = ProjectItemPublicRecord;

export type ProofreadingMutationPlan = {
  changed_item_ids: number[]; // UI 用于计数和乐观反馈，不作为最终写库事实
  request_body: {
    item_id?: number; // 单条保存目标 item
    dst?: string; // 单条保存目标译文
    item_ids?: number[]; // 批量替换或重置的目标 item 集合
    search_text?: string; // 批量替换搜索文本，真实替换由后端执行
    replace_text?: string; // 批量替换目标文本
    is_regex?: boolean; // 批量替换是否使用正则语义
    expected_section_revisions: ProjectStoreSectionRevisions; // items 与 proofreading 双 section 乐观锁
  };
};

// 批量校对操作按 item_id 建索引，只用于判断命令是否有实际影响。
function build_store_item_index(state: ProjectStoreState): Map<number, ProofreadingStoreItem> {
  const item_index = new Map<number, ProofreadingStoreItem>();
  for (const item of state.items.values()) {
    item_index.set(item.item_id, item);
  }
  return item_index;
}

// 校对 mutation 同时依赖 items 与 proofreading revision。
function build_expected_revisions(state: ProjectStoreState): ProjectStoreSectionRevisions {
  return {
    items: state.revisions.sections.items ?? 0,
    proofreading: state.revisions.sections.proofreading ?? 0,
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
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  item_id: number;
  next_dst: string;
}): ProofreadingMutationPlan | null {
  const current_item = build_store_item_index(args.state).get(args.item_id);
  if (current_item === undefined || current_item.dst === args.next_dst) {
    return null;
  }

  return {
    changed_item_ids: [args.item_id],
    request_body: {
      item_id: args.item_id,
      dst: args.next_dst,
      expected_section_revisions: build_expected_revisions(args.state),
    },
  };
}

// 批量替换只提交搜索命令，前端不提交替换后的最终 item 事实。
export function create_replace_all_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  item_ids: number[];
  search_text: string;
  replace_text: string;
  is_regex: boolean;
}): ProofreadingMutationPlan | null {
  const item_index = build_store_item_index(args.state);
  const changed_item_ids: number[] = [];

  for (const item_id of args.item_ids) {
    const current_item = item_index.get(item_id);
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
      expected_section_revisions: build_expected_revisions(args.state),
    },
  };
}

// 批量重置只提交目标 id，后端清空译文、状态和重试次数。
export function create_reset_items_plan(args: {
  state: ProjectStoreState;
  task_snapshot?: Record<string, unknown>;
  item_ids: number[];
}): ProofreadingMutationPlan | null {
  const item_index = build_store_item_index(args.state);
  const changed_item_ids: number[] = [];

  for (const item_id of args.item_ids) {
    const current_item = item_index.get(item_id);
    if (current_item === undefined) {
      continue;
    }
    if (
      current_item.dst === "" &&
      current_item.status === "NONE" &&
      current_item.retry_count === 0
    ) {
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
      expected_section_revisions: build_expected_revisions(args.state),
    },
  };
}
