import { Type, type Static } from "@earendil-works/pi-ai";

import { compile_literal_patterns } from "../../../../../shared/text/literal-matcher";
import { AGENT_WORKSPACE_RUNTIME_POLICY } from "../policy";
import { define_agent_workspace_data_tool } from "./data-tool";

/** 模式独立续页；页大小只限制证据返回量，完整扫描计数始终保留。 */
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
          offset: Type.Optional(
            Type.Integer({
              minimum: 0,
              default: 0,
              description:
                "本模式的 (item_id, field) 证据偏移；同一快照和模式下用 next_offset 续页。计数始终覆盖完整快照。",
            }),
          ),
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
          "每个模式本页最多返回的 (item_id, field) 证据记录数；按条目、src、name_src 排序，同一条目可占两份。0 仅统计，读取证据时使用正数。",
      }),
    ),
  },
  { additionalProperties: false },
);

/** 字段证据携带原文范围，供调用方重建覆盖集合并检查同一条目内的额外命中。 */
const result = Type.Object(
  {
    scanned_item_count: Type.Integer({ minimum: 0, description: "完整扫描的条目数。" }),
    matched_item_count: Type.Integer({ minimum: 0, description: "至少命中一个模式的去重条目数。" }),
    patterns: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          next_offset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()], {
            description:
              "本模式下一页的证据偏移，null 表示证据已到末尾。仅统计时如有证据则返回当前偏移，须改用正数页大小继续。",
          }),
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

/** 使用正式字面匹配器完整扫描只读 items，计数与每个模式的证据分页独立。 */
export const matchLiterals = define_agent_workspace_data_tool({
  description:
    "按正式连续字面语义扫描 src 与 name_src，返回完整计数及分页命中证据；完整覆盖核验须消费各模式全部证据页。",
  parameters,
  result,
  /** 复用正式匹配器的键校验与匹配语义；一次扫描聚合完整计数和各模式证据页。 */
  async execute(context, args) {
    const examples_per_pattern =
      args.examples_per_pattern ?? context.contract.limits.literal_match_examples_default;
    const matcher = compile_literal_patterns(args.patterns);
    const pages = new Map<string, { offset: number; result: LiteralMatchPatternResult }>(
      args.patterns.map((pattern) => [
        pattern.key,
        {
          offset: pattern.offset ?? 0, // 与对应结果共同保存，按字段证据计数。
          result: {
            key: pattern.key,
            next_offset: null,
            matched_item_count: 0,
            field_item_counts: { src: 0, name_src: 0 },
            example_matches: [],
          },
        },
      ]),
    );
    let scanned_item_count = 0;
    let matched_item_count = 0;

    for await (const item of context.data.items()) {
      const { item_id, src, name_src } = item;
      scanned_item_count += 1;
      const matched_results = new Set<LiteralMatchPatternResult>(); // 正文与姓名共同命中只计一个 item。
      for (const [field, text] of [
        ["src", src],
        ["name_src", name_src],
      ] as const) {
        for (const match of matcher.match(text)) {
          // 匹配器仅返回输入模式的 key，pages 在扫描前已为全部模式建立记录。
          const { offset, result } = pages.get(match.key)!;
          result.field_item_counts[field] += 1;
          matched_results.add(result);
          // 分页单位是字段证据；同字段的全部 ranges 留在一条记录中。
          const field_count = result.field_item_counts.src + result.field_item_counts.name_src;
          if (field_count > offset && result.example_matches.length < examples_per_pattern) {
            result.example_matches.push({ item_id, field, ranges: match.ranges });
          }
        }
      }
      if (matched_results.size > 0) matched_item_count += 1;
      for (const result of matched_results) result.matched_item_count += 1;
    }

    // 每个模式按自己的证据总数结束；纯计数调用保留当前偏移作为读取入口。
    for (const { offset, result } of pages.values()) {
      const end = offset + result.example_matches.length;
      const total = result.field_item_counts.src + result.field_item_counts.name_src;
      result.next_offset = end < total ? end : null;
    }

    return {
      scanned_item_count,
      matched_item_count,
      patterns: [...pages.values()].map(({ result }) => result),
    };
  },
});
