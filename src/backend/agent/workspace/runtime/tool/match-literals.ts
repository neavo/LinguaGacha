import { Type, type Static } from "@earendil-works/pi-ai";

import { compile_literal_patterns } from "../../../../../shared/text/literal-matcher";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../policy";
import { define_agent_workspace_data_tool } from "./data-tool";

const parameters = Type.Object(
  {
    patterns: Type.Array(
      Type.Object(
        {
          key: Type.String({
            minLength: 1,
            pattern: "\\S",
            description: "本次 patterns 中唯一的关联标识，结果按输入顺序返回。",
          }),
          text: Type.String({
            minLength: 1,
            pattern: "\\S",
            description: "完整连续字面模式，保留原始空白。",
          }),
          case_sensitive: Type.Boolean({
            description: "执行 Unicode 归一化；false 时同时折叠大小写。",
          }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    examples_per_pattern: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: AGENT_WORKSPACE_RUNTIME_POLICY.literalMatchExamplesMax,
        default: AGENT_WORKSPACE_RUNTIME_POLICY.literalMatchExamplesDefault,
        description:
          "每个模式最多返回的 (item_id, field) 证据记录数；按条目、src、name_src 顺序截取，同一条目可占两份，0 仅统计。",
      }),
    ),
  },
  { additionalProperties: false },
);

const result = Type.Object(
  {
    scanned_item_count: Type.Integer({ minimum: 0, description: "完整扫描的条目数。" }),
    matched_item_count: Type.Integer({ minimum: 0, description: "至少命中一个模式的去重条目数。" }),
    patterns: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          matched_item_count: Type.Integer({
            minimum: 0,
            description: "该模式在两个字段上的去重条目数。",
          }),
          field_item_counts: Type.Object(
            {
              src: Type.Integer({ minimum: 0 }),
              name_src: Type.Integer({ minimum: 0 }),
            },
            { additionalProperties: false },
          ),
          example_matches: Type.Array(
            Type.Object(
              {
                item_id: Type.Integer({ minimum: 1 }),
                field: Type.Union([Type.Literal("src"), Type.Literal("name_src")]),
                ranges: Type.Array(
                  Type.Object(
                    {
                      start: Type.Integer({
                        minimum: 0,
                        description: "原始字段 UTF-16 起始偏移，包含该位置。",
                      }),
                      end: Type.Integer({
                        minimum: 0,
                        description:
                          "原始字段 UTF-16 结束偏移，不包含该位置；使用原字段 slice(start, end) 提取证据。",
                      }),
                    },
                    { additionalProperties: false },
                  ),
                ),
              },
              { additionalProperties: false },
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

type LiteralMatchPatternResult = Static<(typeof result)["properties"]["patterns"]>[number];

/** 使用正式字面匹配器一次扫描只读 items，并按输入 pattern 顺序聚合证据。 */
export const matchLiterals = define_agent_workspace_data_tool({
  description: "按正式连续字面语义一次扫描 src 与 name_src，并返回完整计数和有限证据。",
  parameters,
  result,
  /** 关联键唯一后累计去重条目数，并按字段截取有限证据。 */
  async execute(context, args) {
    const keys = new Set<string>();
    for (const pattern of args.patterns) {
      if (keys.has(pattern.key)) throw new Error(`Duplicate literal pattern key: ${pattern.key}`);
      keys.add(pattern.key);
    }
    const examples_per_pattern =
      args.examples_per_pattern ?? context.contract.limits.literal_match_examples_default;
    const matcher = compile_literal_patterns(args.patterns);
    const results = new Map<string, LiteralMatchPatternResult>(
      args.patterns.map((pattern) => [
        pattern.key,
        {
          key: pattern.key,
          matched_item_count: 0,
          field_item_counts: { src: 0, name_src: 0 },
          example_matches: [],
        },
      ]),
    );
    let scanned_item_count = 0;
    let matched_item_count = 0;

    for await (const item of context.data.items()) {
      const { item_id, src, name_src } = item;
      scanned_item_count += 1;
      const matched_keys = new Set<string>();
      for (const [field, text] of [
        ["src", src],
        ["name_src", name_src],
      ] as const) {
        for (const match of matcher.match(text)) {
          const result = results.get(match.key);
          if (result === undefined) continue;
          result.field_item_counts[field] += 1;
          matched_keys.add(match.key);
          if (result.example_matches.length < examples_per_pattern) {
            result.example_matches.push({ item_id, field, ranges: match.ranges });
          }
        }
      }
      if (matched_keys.size > 0) matched_item_count += 1;
      for (const key of matched_keys) {
        const result = results.get(key);
        if (result !== undefined) result.matched_item_count += 1;
      }
    }

    return {
      scanned_item_count,
      matched_item_count,
      patterns: [...results.values()],
    };
  },
});
