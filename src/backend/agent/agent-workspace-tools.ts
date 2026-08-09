import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";

import { ITEM_STATUSES } from "../../domain/item";
import type { JsonRecord } from "../../domain/json";
import { QUALITY_RULE_KINDS } from "../../domain/quality";
import { PROOFREADING_WARNING_CODES } from "../../shared/proofreading/proofreading-types";
import { agent_tool_result } from "./agent-tool";
import type { AgentWorkspacePort } from "./agent-workspace-service";

/** create 不接受模型重传工程身份或快照选项。 */
const WORKSPACE_CREATE_PARAMETERS = Type.Object({}, { additionalProperties: false });
/** 单页上限属于模型输入边界；描述与 TypeBox 约束必须共用同一值。 */
const AGENT_WORKSPACE_RECIPE_PAGE_LIMIT = 100;

/** 模型只提交函数体，不接触工作区绝对路径。 */
const WORKSPACE_SCRIPT_PARAMETERS = Type.Object(
  {
    script: Type.String({
      minLength: 1,
      description:
        "异步 JavaScript 函数体；唯一参数 workspace 提供同源 contract 及其 script_api 声明的方法，return 小型 JSON 结果。",
    }),
  },
  { additionalProperties: false },
);

/** 枚举 Schema 直接复用领域常量，不另建允许值列表。 */
const enum_schema = <T extends readonly string[]>(values: T) =>
  Type.Union(values.map((value) => Type.Literal(value)));

/** 两个分页 recipe 共用同一 offset / limit 契约。 */
const page_parameters = (unit: string) => ({
  offset: Type.Optional(Type.Integer({ minimum: 0, description: `跳过的${unit}数量，默认 0。` })),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: AGENT_WORKSPACE_RECIPE_PAGE_LIMIT,
      description: `本页最多返回的${unit}数量，默认 20，最大 ${AGENT_WORKSPACE_RECIPE_PAGE_LIMIT.toString()}。`,
    }),
  ),
});

/** recipe 的结构与值域在工具边界一次校验，脚本源码只负责查询算法。 */
const WORKSPACE_RECIPE_PARAMETERS = Type.Union([
  Type.Object(
    {
      name: Type.Literal("query-items"),
      args: Type.Object(
        {
          filters: Type.Optional(
            Type.Object(
              {
                item_ids: Type.Optional(
                  Type.Array(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), {
                    uniqueItems: true,
                    description: "只保留这些 item_id；同一数组内取并集。",
                  }),
                ),
                statuses: Type.Optional(
                  Type.Array(enum_schema(ITEM_STATUSES), {
                    uniqueItems: true,
                    description: "只保留这些状态；同一数组内取并集。",
                  }),
                ),
                file_paths: Type.Optional(
                  Type.Array(Type.String(), {
                    uniqueItems: true,
                    description: "只保留路径完全相等的文件；同一数组内取并集。",
                  }),
                ),
                warning_types: Type.Optional(
                  Type.Array(enum_schema(PROOFREADING_WARNING_CODES), {
                    uniqueItems: true,
                    description: "只保留命中任一指定警告的条目。",
                  }),
                ),
              },
              {
                additionalProperties: false,
                description: "不同过滤字段取交集；省略或传空数组表示该字段不限制。",
              },
            ),
          ),
          search: Type.Optional(
            Type.Object(
              {
                keywords: Type.Array(Type.String({ pattern: "\\S" }), {
                  minItems: 1,
                  description: "按输入顺序去重后进行 NFKC、大小写折叠的字面量 OR 匹配。",
                }),
                scope: Type.Optional(
                  Type.Union([Type.Literal("src"), Type.Literal("dst"), Type.Literal("all")], {
                    description: "搜索原文、译文或两者；默认 all。",
                  }),
                ),
              },
              { additionalProperties: false },
            ),
          ),
          include_warnings: Type.Optional(
            Type.Boolean({
              description: "是否为本页条目附带完整 warning_evidence；默认 false，不影响筛选。",
            }),
          ),
          ...page_parameters("目标条目"),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.Literal("query-item-contexts"),
      args: Type.Object(
        {
          item_ids: Type.Array(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), {
            minItems: 1,
            maxItems: 20,
            uniqueItems: true,
            description: "需要补充邻近文本的目标 item_id；返回同文件前后各两条非空原文。",
          }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      name: Type.Literal("query-quality-rule-groups"),
      args: Type.Object(
        {
          kind: Type.Union(
            QUALITY_RULE_KINDS.map((value) => Type.Literal(value)),
            { description: "要查询的质量规则类型。" },
          ),
          keywords: Type.Optional(
            Type.Array(Type.String({ pattern: "\\S" }), {
              minItems: 1,
              description: "对规则原文进行 NFKC、大小写折叠的字面量 OR 匹配。",
            }),
          ),
          include_examples: Type.Optional(
            Type.Boolean({ description: "是否附带每条规则的代表例句；默认 false。" }),
          ),
          ...page_parameters("完整关系组"),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
]);

/** apply 始终消费当前活动工作区，不接受模型重传身份或 revision。 */
const WORKSPACE_APPLY_PARAMETERS = Type.Object({}, { additionalProperties: false });

/** 工作区始终保持单一状态拥有者，四个工具只做参数适配。 */
export function create_agent_workspace_tools(workspace: AgentWorkspacePort): ToolDefinition[] {
  return [
    defineTool({
      name: "workspace_create",
      label: "创建工作区",
      description:
        "任务需要读取或准备修改当前工程数据时创建完整工作区，并返回 project_meta 与 contract。创建本身不修改工程；再次调用会在新工作区成功后替换旧工作区。",
      executionMode: "sequential",
      parameters: WORKSPACE_CREATE_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.create_workspace();
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
    defineTool({
      name: "workspace_recipe",
      label: "运行工作区配方",
      description:
        "运行 contract 声明的只读 recipe 并返回自描述分页 JSON；重复记录由 *_fields 声明列顺序。三个入口分别查询目标条目、条目邻近文本和质量规则关系组；存在 next_offset 时按其继续，recipe 源码也可从工作区读取作为实现参考。",
      executionMode: "sequential",
      parameters: WORKSPACE_RECIPE_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        const effective_signal = signal ?? new AbortController().signal;
        effective_signal.throwIfAborted();
        return agent_tool_result({
          result: await workspace.run_recipe(
            params.name,
            // TypeBox 已验证为 JSON 对象；SDK 推导类型只缺少 JsonRecord 的索引签名。
            params.args as unknown as JsonRecord,
            effective_signal,
          ),
        });
      },
    }),
    defineTool({
      name: "workspace_script",
      label: "运行工作区脚本",
      description:
        "运行模型提供的 JavaScript 并返回 JSON 结果。脚本可读取工作区，也可通过文件事务修改 contract 标记为 writable 的数据集或 scratch；成功保留本次修改，失败只回滚本次运行。",
      executionMode: "sequential",
      parameters: WORKSPACE_SCRIPT_PARAMETERS,
      execute: async (_tool_call_id, params, signal) => {
        // SDK 未提供 signal 时仍传入永不取消的标准信号，服务端口无需处理双态。
        const effective_signal = signal ?? new AbortController().signal;
        effective_signal.throwIfAborted();
        return agent_tool_result({
          result: await workspace.run_script(params.script, effective_signal),
        });
      },
    }),
    defineTool({
      name: "workspace_apply",
      label: "应用工作区",
      description:
        "在用户明确批准当前方案后，校验当前全部可写数据集差异并以一个事务应用到工程；无变化不会写入，任一校验、revision 或领域规则失败都不会部分应用。",
      executionMode: "sequential",
      parameters: WORKSPACE_APPLY_PARAMETERS,
      execute: async (_tool_call_id, _params, signal) => {
        signal?.throwIfAborted();
        const result = await workspace.apply_workspace();
        signal?.throwIfAborted();
        return agent_tool_result(result);
      },
    }),
  ];
}
