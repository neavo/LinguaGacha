import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../domain/json";
import { AgentToolError, agent_tool_result } from "./agent-tool";

const MAX_TASK_PROGRESS_ITEMS = 2_048; // 防止模型反复派生导致对话级内存队列无界增长
const NEXT_ITEM_LIMIT = 20; // 工具结果只返回足够恢复执行的有限待办
const TASK_PROGRESS_KEY_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"; // 允许稳定层级键但拒绝空白和路径语义

/** start 与 advance 共享同一最小工作项协议。 */
const TASK_PROGRESS_ITEM_PARAMETERS = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 128, pattern: TASK_PROGRESS_KEY_PATTERN }),
    phase: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

/** action 判别联合让 SDK 在执行前拒绝无关字段。 */
const TASK_PROGRESS_PARAMETERS = Type.Union([
  Type.Object(
    {
      action: Type.Literal("start"),
      title: Type.String({ minLength: 1, maxLength: 200 }),
      items: Type.Array(TASK_PROGRESS_ITEM_PARAMETERS, { minItems: 1, maxItems: 100 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("advance"),
      complete: Type.Array(
        Type.String({ minLength: 1, maxLength: 128, pattern: TASK_PROGRESS_KEY_PATTERN }),
        { minItems: 1, maxItems: 100, uniqueItems: true },
      ),
      add: Type.Optional(Type.Array(TASK_PROGRESS_ITEM_PARAMETERS, { minItems: 1, maxItems: 100 })),
    },
    { additionalProperties: false },
  ),
  Type.Object({ action: Type.Literal("read") }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal("finish") }, { additionalProperties: false }),
  Type.Object(
    {
      action: Type.Literal("cancel"),
      reason: Type.String({ minLength: 1, maxLength: 300 }),
    },
    { additionalProperties: false },
  ),
]);

type TaskProgressItemInput = {
  key: string;
  phase: string;
  label: string;
};

/** 队列项只增加完成状态；领域证据和派生关系仍归各自 skill 资产。 */
type TaskProgressItem = TaskProgressItemInput & { completed: boolean };

/** 一个对话同时只允许一个活动任务。 */
type TaskProgressState = {
  title: string;
  items: TaskProgressItem[];
};

/** 当前产品 Agent 对话的通用动态工作队列；不承载领域事实或工程写入。 */
export class AgentTaskProgress {
  private state: TaskProgressState | null = null; // null 同时表示尚未开始或已经结束

  /** 建立唯一活动任务，并返回可供下一回合恢复的紧凑快照。 */
  public start(title: string, items: readonly TaskProgressItemInput[]): JsonRecord {
    if (this.state !== null) throw new AgentToolError({ code: "task_progress.active" });
    const normalized_title = read_non_empty_text(title, "title");
    const normalized_items = normalize_new_items(items, new Set());
    this.state = {
      title: normalized_title,
      items: normalized_items.map((item) => ({ ...item, completed: false })),
    };
    return this.read();
  }

  /** 先完整校验完成项与新增项，再一次性替换状态，失败不留下部分进度。 */
  public advance(
    complete: readonly string[],
    add: readonly TaskProgressItemInput[] = [],
  ): JsonRecord {
    const state = this.require_state();
    const complete_keys = new Set(complete);
    if (complete_keys.size !== complete.length) {
      throw new AgentToolError({ code: "task_progress.duplicate_completion" });
    }
    const existing_by_key = new Map(state.items.map((item) => [item.key, item]));
    for (const key of complete) {
      const item = existing_by_key.get(key);
      if (item === undefined) {
        throw new AgentToolError({ code: "task_progress.item_not_found", key });
      }
      if (item.completed) {
        throw new AgentToolError({ code: "task_progress.item_already_completed", key });
      }
    }
    const additions = normalize_new_items(add, new Set(existing_by_key.keys()));
    if (state.items.length + additions.length > MAX_TASK_PROGRESS_ITEMS) {
      throw new AgentToolError({
        code: "task_progress.too_many_items",
        limit: MAX_TASK_PROGRESS_ITEMS,
      });
    }

    this.state = {
      title: state.title,
      items: [
        ...state.items.map((item) =>
          complete_keys.has(item.key) ? { ...item, completed: true } : item,
        ),
        ...additions.map((item) => ({ ...item, completed: false })),
      ],
    };
    return this.read();
  }

  /** 汇总阶段计数并只回显队首有限待办，避免进度本身挤占模型上下文。 */
  public read(): JsonRecord {
    if (this.state === null) return { status: "idle" };
    const completed_count = this.state.items.filter((item) => item.completed).length;
    const phase_counts = new Map<string, { total: number; completed: number; pending: number }>();
    for (const item of this.state.items) {
      const counts = phase_counts.get(item.phase) ?? { total: 0, completed: 0, pending: 0 };
      counts.total += 1;
      counts[item.completed ? "completed" : "pending"] += 1;
      phase_counts.set(item.phase, counts);
    }
    return {
      status: "active",
      title: this.state.title,
      item_count: this.state.items.length,
      completed_count,
      pending_count: this.state.items.length - completed_count,
      phases: Object.fromEntries(phase_counts),
      next_items: this.state.items
        .filter((item) => !item.completed)
        .slice(0, NEXT_ITEM_LIMIT)
        .map(({ key, phase, label }) => ({ key, phase, label })),
    };
  }

  /** 只有所有已知工作完成后才结束任务，防止一轮游提前收敛。 */
  public finish(): JsonRecord {
    const state = this.require_state();
    const pending_keys = state.items.filter((item) => !item.completed).map((item) => item.key);
    if (pending_keys.length > 0) {
      throw new AgentToolError({
        code: "task_progress.pending_items",
        pending_count: pending_keys.length,
        next_keys: pending_keys.slice(0, NEXT_ITEM_LIMIT),
      });
    }
    const result = { status: "finished", title: state.title, item_count: state.items.length };
    this.state = null;
    return result;
  }

  /** 显式放弃活动任务；取消进度不撤销任何其它副作用。 */
  public cancel(reason: string): JsonRecord {
    const state = this.require_state();
    const pending_count = state.items.filter((item) => !item.completed).length;
    const result = {
      status: "cancelled",
      title: state.title,
      item_count: state.items.length,
      pending_count,
      reason: read_non_empty_text(reason, "reason"),
    };
    this.state = null;
    return result;
  }

  /** 会话 reset、工程切换或 dispose 时直接清除对话级状态。 */
  public reset(): void {
    this.state = null;
  }

  /** 统一拒绝没有活动任务的变更操作。 */
  private require_state(): TaskProgressState {
    if (this.state === null) throw new AgentToolError({ code: "task_progress.missing" });
    return this.state;
  }
}

/** task_progress 始终注册；状态由 AgentService 持有并随产品会话 reset。 */
export function create_agent_task_progress_tools(progress: AgentTaskProgress): ToolDefinition[] {
  return [
    defineTool({
      name: "task_progress",
      label: "任务进度",
      description:
        "管理当前对话中一个长任务的动态工作队列。start 建立任务；advance 原子完成工作并追加派生项；read 读取紧凑进度；finish 仅在无待办时结束；cancel 只在用户放弃或替换任务时取消。进度不保存领域事实，也不代替领域完成条件。",
      executionMode: "sequential",
      parameters: TASK_PROGRESS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        switch (params.action) {
          case "start":
            return agent_tool_result(progress.start(params.title, params.items));
          case "advance":
            return agent_tool_result(progress.advance(params.complete, params.add));
          case "read":
            return agent_tool_result(progress.read());
          case "finish":
            return agent_tool_result(progress.finish());
          case "cancel":
            return agent_tool_result(progress.cancel(params.reason));
        }
      },
    }),
  ];
}

/** 一次性规范化新增项并拒绝与现有或同批键冲突，供原子状态替换使用。 */
function normalize_new_items(
  items: readonly TaskProgressItemInput[],
  existing_keys: ReadonlySet<string>,
): TaskProgressItemInput[] {
  const new_keys = new Set<string>();
  return items.map((item) => {
    if (existing_keys.has(item.key) || new_keys.has(item.key)) {
      throw new AgentToolError({ code: "task_progress.duplicate_item", key: item.key });
    }
    new_keys.add(item.key);
    return {
      key: item.key,
      phase: read_non_empty_text(item.phase, `item ${item.key}.phase`),
      label: read_non_empty_text(item.label, `item ${item.key}.label`),
    };
  });
}

/** 所有用户可见描述在进入内存状态前裁掉无意义首尾空白。 */
function read_non_empty_text(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new AgentToolError({ code: "task_progress.invalid_text", name });
  return normalized;
}
