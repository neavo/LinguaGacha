import { Type, type Static } from "@earendil-works/pi-ai";

import { compile_literal_patterns } from "../../../../../shared/text/literal-matcher";
import { define_agent_workspace_data_tool } from "./data-tool";

/** 一次扫描完成完整计数；可选上限只控制字段证据收集量。 */
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
    max_matches_per_pattern: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "每个模式最多收集的 (item_id, field) 证据数；省略时收集全部，0 仅统计，正整数收集最先出现的至多 N 条。所有调用均返回完整计数。",
      }),
    ),
  },
  { additionalProperties: false },
);

/** 字段证据携带原文范围与完整性，供调用方重建覆盖集合并核验边界。 */
const result = Type.Object(
  {
    scanned_item_count: Type.Integer({ minimum: 0, description: "完整扫描的条目数。" }),
    matched_item_count: Type.Integer({ minimum: 0, description: "至少命中一个模式的去重条目数。" }),
    patterns: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          matches_complete: Type.Boolean({
            description:
              "matches 是否包含本模式全部字段证据；无命中时为 true，限量或仅统计时按实际收集量判断。",
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
          matches: Type.Array(
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
            {
              description:
                "按快照条目、src、name_src 顺序返回；每条记录包含该字段全部命中范围，同一条目可有两个字段记录。",
            },
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

type LiteralMatchPatternResult = Static<(typeof result)["properties"]["patterns"]>[number];

/** 使用正式字面匹配器一次扫描只读 items，计数与证据收集量独立。 */
export const matchLiterals = define_agent_workspace_data_tool({
  description: "一次扫描 src 与 name_src，返回完整计数及全部或限量字段命中证据。",
  parameters,
  result,
  /** 完整计数只读取命中身份，尚需收集证据时才计算原文范围。 */
  async execute(context, args) {
    const max_matches = args.max_matches_per_pattern ?? Infinity;
    const matcher = compile_literal_patterns(args.patterns);
    const results = new Map<string, LiteralMatchPatternResult>(
      args.patterns.map(({ key }) => [
        key,
        {
          key,
          matches_complete: true,
          matched_item_count: 0,
          field_item_counts: { src: 0, name_src: 0 },
          matches: [],
        },
      ]),
    );
    let scanned_item_count = 0;
    let matched_item_count = 0;

    for await (const { item_id, src, name_src } of context.data.items()) {
      scanned_item_count += 1;
      const matched_results = new Set<LiteralMatchPatternResult>(); // 正文与姓名共同命中只计一个 item。
      for (const [field, text] of [
        ["src", src],
        ["name_src", name_src],
      ] as const) {
        const evidence_keys = new Set<string>();
        matcher.scan_keys(text, (key) => {
          const result = results.get(key)!; // 身份来自本次编译的模式集合。
          result.field_item_counts[field] += 1;
          matched_results.add(result);
          if (result.matches.length < max_matches) evidence_keys.add(key);
        });
        // 纯计数、无命中和证据已收齐的字段均无需原文坐标。
        if (evidence_keys.size > 0) {
          for (const { key, ranges } of matcher.match(text, evidence_keys)) {
            results.get(key)!.matches.push({ item_id, field, ranges });
          }
        }
      }
      if (matched_results.size > 0) matched_item_count += 1;
      for (const result of matched_results) result.matched_item_count += 1;
    }

    for (const result of results.values()) {
      result.matches_complete =
        result.matches.length === result.field_item_counts.src + result.field_item_counts.name_src;
    }
    return { scanned_item_count, matched_item_count, patterns: [...results.values()] };
  },
});
