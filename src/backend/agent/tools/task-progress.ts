import { StringEnum, Type, type Static } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import type { JsonRecord } from "../../../domain/json";
import { AgentToolError, agent_tool_result } from "./definition";

const MAX_TASK_PROGRESS_ITEMS = 2_048; // 防止模型反复派生导致对话级内存队列无界增长
const NEXT_ITEM_LIMIT = 20; // 工具结果只返回足够恢复执行的有限待办
const TASK_PROGRESS_KEY_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"; // 允许稳定层级键但拒绝空白和路径语义
const TASK_PROGRESS_ACTIONS = ["start", "advance", "read", "finish", "cancel"] as const; // 单一工具的稳定命令集合

/** start 与 advance 共享同一最小工作项协议。 */
const TASK_PROGRESS_ITEM_PARAMETERS = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 128, pattern: TASK_PROGRESS_KEY_PATTERN }),
    phase: Type.String({ minLength: 1, maxLength: 64 }),
    label: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

/** 模型协议保持跨供应商稳定的普通对象根；action 字段关系在工具入口收窄。 */
const TASK_PROGRESS_PARAMETERS = Type.Object(
  {
    action: StringEnum(TASK_PROGRESS_ACTIONS),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    items: Type.Optional(Type.Array(TASK_PROGRESS_ITEM_PARAMETERS, { minItems: 1, maxItems: 100 })),
    complete: Type.Optional(
      Type.Array(
        Type.String({ minLength: 1, maxLength: 128, pattern: TASK_PROGRESS_KEY_PATTERN }),
        { minItems: 1, maxItems: 100, uniqueItems: true },
      ),
    ),
    add: Type.Optional(Type.Array(TASK_PROGRESS_ITEM_PARAMETERS, { minItems: 1, maxItems: 100 })),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })),
  },
  { additionalProperties: false },
);

type TaskProgressItemInput = Static<typeof TASK_PROGRESS_ITEM_PARAMETERS>;
type TaskProgressParameters = Static<typeof TASK_PROGRESS_PARAMETERS>;

/** 扁平模型参数经条件字段校验后恢复为内部判别联合。 */
type TaskProgressCommand =
  | { action: "start"; title: string; items: TaskProgressItemInput[] }
  | { action: "advance"; complete: string[]; add?: TaskProgressItemInput[] }
  | { action: "read" }
  | { action: "finish" }
  | { action: "cancel"; reason: string };

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

  /** 按队列顺序返回全部未完成标签，供公开 UI 投影。 */
  public read_pending_labels(): string[] {
    return this.state?.items.filter((item) => !item.completed).map((item) => item.label) ?? [];
  }

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
        "管理当前对话中任务的动态工作队列。start 建立任务；advance 原子完成工作并追加派生项；read 读取紧凑进度；finish 仅在无待办时结束；cancel 只在用户放弃或替换任务时取消。长流程跨回合维护队列，单回合任务的队列在回复前收尾。进度不保存领域事实，也不代替领域完成条件。",
      executionMode: "sequential",
      parameters: TASK_PROGRESS_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        signal?.throwIfAborted();
        const command = read_task_progress_command(params);
        switch (command.action) {
          case "start":
            return agent_tool_result(progress.start(command.title, command.items));
          case "advance":
            return agent_tool_result(progress.advance(command.complete, command.add));
          case "read":
            return agent_tool_result(progress.read());
          case "finish":
            return agent_tool_result(progress.finish());
          case "cancel":
            return agent_tool_result(progress.cancel(command.reason));
        }
      },
    }),
  ];
}

/** 普通对象 Schema 只校验字段类型；这里一次性恢复 action 的精确字段组合。 */
function read_task_progress_command(params: TaskProgressParameters): TaskProgressCommand {
  const invalid = (): never => {
    throw new AgentToolError({ code: "task_progress.invalid_parameters", action: params.action });
  };
  switch (params.action) {
    case "start": {
      const { title, items } = params;
      if (
        title === undefined ||
        items === undefined ||
        has_unexpected_task_progress_fields(params, ["action", "title", "items"])
      ) {
        return invalid();
      }
      return { action: params.action, title, items };
    }
    case "advance": {
      const { complete, add } = params;
      if (
        complete === undefined ||
        has_unexpected_task_progress_fields(params, ["action", "complete", "add"])
      ) {
        return invalid();
      }
      return {
        action: params.action,
        complete,
        ...(add === undefined ? {} : { add }),
      };
    }
    case "read":
    case "finish":
      if (has_unexpected_task_progress_fields(params, ["action"])) return invalid();
      return { action: params.action };
    case "cancel": {
      const { reason } = params;
      if (
        reason === undefined ||
        has_unexpected_task_progress_fields(params, ["action", "reason"])
      ) {
        return invalid();
      }
      return { action: params.action, reason };
    }
  }
}

/** action 只接受声明字段，避免扁平 wire Schema 放宽原有调用协议。 */
function has_unexpected_task_progress_fields(
  params: TaskProgressParameters,
  allowed_fields: readonly (keyof TaskProgressParameters)[],
): boolean {
  return Object.keys(params).some(
    (field) => !allowed_fields.includes(field as keyof TaskProgressParameters),
  );
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
