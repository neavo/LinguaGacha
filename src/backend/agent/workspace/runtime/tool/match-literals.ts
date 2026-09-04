import { Type, type Static } from "@earendil-works/pi-ai";

import {
  compile_literal_patterns,
  type LiteralPattern,
} from "../../../../../shared/text/literal-matcher";
import { define_agent_workspace_data_tool } from "./data-tool";

const parameters = Type.Object(
  {
    patterns: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1 }),
          text: Type.String({ minLength: 1 }),
          case_sensitive: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    examples_per_pattern: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

const result = Type.Object(
  {
    scanned_item_count: Type.Integer({ minimum: 0 }),
    matched_item_count: Type.Integer({ minimum: 0 }),
    patterns: Type.Array(
      Type.Object(
        {
          key: Type.String(),
          matched_item_count: Type.Integer({ minimum: 0 }),
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
                      start: Type.Integer({ minimum: 0 }),
                      end: Type.Integer({ minimum: 0 }),
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

type LiteralMatchRequest = {
  patterns: LiteralPattern[];
  examples_per_pattern: number;
};

type LiteralMatchPatternResult = Static<(typeof result)["properties"]["patterns"]>[number];

/** 使用正式字面匹配器一次扫描只读 items，并按输入 pattern 顺序聚合证据。 */
export const matchLiterals = define_agent_workspace_data_tool({
  useWhen: "在 src 与 name_src 上执行正式连续字面匹配",
  description: "按正式连续字面语义一次扫描 src 与 name_src，并返回完整计数和有限证据。",
  parameters,
  result,
  async execute(context, args) {
    const request = read_literal_match_request(args, context.contract.limits);
    const matcher = compile_literal_patterns(request.patterns);
    const results = new Map<string, LiteralMatchPatternResult>(
      request.patterns.map((pattern) => [
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
          if (result.example_matches.length < request.examples_per_pattern) {
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

/** 收窄唯一 pattern key、非空文本与 contract 证据上限。 */
function read_literal_match_request(
  value: Static<typeof parameters>,
  limits: Readonly<{
    literal_match_examples_default: number;
    literal_match_examples_max: number;
  }>,
): LiteralMatchRequest {
  const keys = new Set<string>();
  const patterns = value.patterns.map((pattern, index): LiteralPattern => {
    const key = require_non_empty_string(pattern.key, `patterns[${index.toString()}].key`);
    if (keys.has(key)) throw new Error(`Duplicate literal pattern key: ${key}`);
    keys.add(key);
    const text = require_non_empty_string(pattern.text, `patterns[${index.toString()}].text`);
    return { key, text, case_sensitive: pattern.case_sensitive };
  });
  const requested_examples = value.examples_per_pattern ?? limits.literal_match_examples_default;
  if (requested_examples > limits.literal_match_examples_max) {
    throw new Error(
      `examples_per_pattern must be an integer from 0 to ${limits.literal_match_examples_max.toString()}`,
    );
  }
  return { patterns, examples_per_pattern: requested_examples };
}

/** Schema 之外继续拒绝只含空白的业务字符串。 */
function require_non_empty_string(value: unknown, name: string): string {
  const result = String(value);
  if (result.trim() === "") throw new Error(`${name} must be a non-empty string`);
  return result;
}
