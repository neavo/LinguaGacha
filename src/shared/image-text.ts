import { Type, type Static } from "typebox";
import { IMAGE_DIRECTION_SCHEMA, IMAGE_FILL_SCHEMA } from "./image";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
const SHA256 = Type.String({ pattern: "^[a-f0-9]{64}$" });

/** 图片写回快照保留完成事实，空正文与未翻译分别表示。 */
export const IMAGE_TEXT_INPUT_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    bookId: ID,
    sourceSha256: SHA256,
    records: Type.Array(
      Type.Object(
        {
          pageId: ID,
          regionId: ID,
          text: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 100000 },
    ),
  },
  { additionalProperties: false },
);

export type ImageTextInput = Static<typeof IMAGE_TEXT_INPUT_SCHEMA>;

/** 字号、间距和栅格判定共同版本化；调用者只提供正文与已确认区域事实。 */
export const IMAGE_TEXT_RULES = Object.freeze({
  version: 3,
  fontFile: "LGBaseFont-Regular.ttf",
  lineHeight: 1.1,
  minimumFontSize: 2,
  smallFontSize: 8,
  minimumMargin: 2,
  marginRatio: 0.35,
  minimumStroke: 0.5,
  strokeRatio: 0.04,
  minimumCenterTolerance: 1,
  centerToleranceRatio: 0.4,
  squareDistanceCorrection: Math.SQRT2,
  pageTimeoutMs: 600_000,
  maximumMaterialBytes: 256_000_000,
  atlasMaximumEdge: 8192,
  atlasMaximumPixels: 16_000_000,
  measurementFontSize: 100,
  measurementPrecision: 1 / 64,
  progressInterval: 16,
});

const BOX = Type.Tuple([
  Type.Integer(),
  Type.Integer(),
  Type.Integer({ minimum: 1 }),
  Type.Integer({ minimum: 1 }),
]);
export const IMAGE_TEXT_PAGE_SCHEMA = Type.Object(
  {
    pageId: ID,
    width: Type.Integer({ minimum: 1, maximum: 100000 }),
    height: Type.Integer({ minimum: 1, maximum: 100000 }),
    regions: Type.Array(
      Type.Object(
        {
          regionId: ID,
          blockId: ID,
          text: Type.String(),
          direction: IMAGE_DIRECTION_SCHEMA,
          fill: IMAGE_FILL_SCHEMA,
          box: BOX,
          distance: Type.String(),
          centroid: Type.Tuple([Type.Number(), Type.Number()]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);
export type ImageTextPage = Static<typeof IMAGE_TEXT_PAGE_SCHEMA>;
export const IMAGE_TEXT_ENVIRONMENT_SCHEMA = Type.Object(
  {
    rulesVersion: Type.Integer({ minimum: 1 }),
    fontSha256: SHA256,
    rendererSha256: SHA256,
    chromium: Type.String({ minLength: 1 }),
    platform: Type.String({ minLength: 1 }),
    arch: Type.String({ minLength: 1 }),
    raster: Type.Literal("chromium-native-dpr1"),
  },
  { additionalProperties: false },
);
export type ImageTextEnvironment = Static<typeof IMAGE_TEXT_ENVIRONMENT_SCHEMA>;
export type ImageTextBlockResult = Static<typeof IMAGE_TEXT_BLOCK_RESULT_SCHEMA>;
export type ImageTextPageResult = Static<typeof IMAGE_TEXT_PAGE_RESULT_SCHEMA>;
export type ImageTextRender = {
  version: 1;
  renderId: string;
  partitionVersion: number;
  bookId: string;
  sourceSha256: string;
  environment: ImageTextEnvironment;
  pages: ImageTextPageResult[];
};
export type ImageTextPaint = {
  result: ImageTextBlockResult;
  png?: string; // 同一原生覆盖层的 PNG，坐标为区域 box。
};
export type ImageTextHostResult = {
  environment: ImageTextEnvironment;
  regions: ImageTextPaint[];
};
export type ImageTextHostOperation = { kind: "render_image_text_page"; page: ImageTextPage | null };
export type ImageTextHost = (
  operation: ImageTextHostOperation,
  signal?: AbortSignal,
) => Promise<ImageTextHostResult>;

const REGION_RESULT_BASE = {
  regionId: ID,
  blockId: ID,
  text: Type.Union([Type.String(), Type.Null()]),
  box: BOX,
};
export const IMAGE_TEXT_BLOCK_RESULT_SCHEMA = Type.Union([
  Type.Object(
    {
      ...REGION_RESULT_BASE,
      status: Type.Literal("rendered"),
      fontSize: Type.Integer({ minimum: 2 }),
      strokeWidth: Type.Number({ minimum: 0 }),
      margin: Type.Number({ minimum: 0 }),
      bounds: Type.Tuple([Type.Integer(), Type.Integer(), Type.Integer(), Type.Integer()]),
      centerError: Type.Number({ minimum: 0 }),
      warnings: Type.Array(Type.Literal("small_font")),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...REGION_RESULT_BASE,
      status: Type.Union([Type.Literal("blank"), Type.Literal("untranslated")]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...REGION_RESULT_BASE,
      status: Type.Literal("failed"),
      reason: Type.Union([Type.Literal("no_fit"), Type.Literal("missing_glyph")]),
      missing: Type.Optional(Type.Array(Type.String())),
    },
    { additionalProperties: false },
  ),
]);
export const IMAGE_TEXT_REGION_RESULT_SCHEMA = Type.Object(
  {
    regionId: ID,
    text: Type.Union([Type.String(), Type.Null()]),
    candidateId: ID,
    blocks: Type.Array(IMAGE_TEXT_BLOCK_RESULT_SCHEMA),
  },
  { additionalProperties: false },
);
export type ImageTextRegionResult = Static<typeof IMAGE_TEXT_REGION_RESULT_SCHEMA>;

export const IMAGE_TEXT_PAGE_RESULT_SCHEMA = Type.Object(
  {
    pageId: ID,
    inputSha256: SHA256,
    status: Type.Union([Type.Literal("ready"), Type.Literal("incomplete"), Type.Literal("error")]),
    regions: Type.Array(IMAGE_TEXT_REGION_RESULT_SCHEMA),
    preview: Type.Optional(Type.String()),
    previewSha256: Type.Optional(SHA256),
    error: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** 单换行只在相邻词段需要分隔时补空格；段落保留一个空行。 */
export function normalize_image_text(text: string): string {
  return text
    .replace(/\r\n?/gu, "\n")
    .split(/\n[\t ]*\n(?:[\t ]*\n)*/u)
    .map((paragraph) =>
      paragraph
        .replace(
          /(?<=[\p{L}\p{M}\p{N}])(?<![\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}])\n(?![\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}])(?=[\p{L}\p{M}\p{N}])/gu,
          " ",
        )
        .replaceAll("\n", ""),
    )
    .join("\n\n");
}

/** 小字号仍保留最小留白，大字号按比例扩大。 */
export function image_text_margin(fontSize: number): number {
  return Math.max(IMAGE_TEXT_RULES.minimumMargin, fontSize * IMAGE_TEXT_RULES.marginRatio);
}

/** 在线性亮度下比较黑白对比度，底色来自已确认填色。 */
export function image_text_color(color: readonly number[]): "black" | "white" {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "black" : "white";
}

export const IMAGE_TEXT_PARTITION_VERSION = 1;
const PLAN_BLOCK_SCHEMA = Type.Object(
  {
    blockId: ID,
    areaShare: Type.Number({ minimum: 0, maximum: 1 }),
    box: BOX,
    selection: Type.Object(
      { path: Type.String(), sha256: SHA256 },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const IMAGE_TEXT_PLAN_SCHEMA = Type.Object(
  {
    planId: SHA256,
    revision: Type.Integer({ minimum: 0 }),
    sourceDigest: SHA256,
    partitionVersion: Type.Integer({ minimum: 1 }),
    input: IMAGE_TEXT_INPUT_SCHEMA,
    pages: Type.Array(
      Type.Object(
        {
          pageId: ID,
          originalPreview: Type.String(),
          regions: Type.Array(
            Type.Object(
              {
                regionId: ID,
                sourceText: Type.String(),
                text: Type.Union([Type.String(), Type.Null()]),
                recommendedCandidateId: ID,
                candidates: Type.Array(
                  Type.Object(
                    {
                      candidateId: ID,
                      preview: Type.String(),
                      previewSha256: SHA256,
                      blocks: Type.Array(PLAN_BLOCK_SCHEMA, { minItems: 1, maxItems: 2 }),
                    },
                    { additionalProperties: false },
                  ),
                  { minItems: 1, maxItems: 7 },
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
export type ImageTextPlan = Static<typeof IMAGE_TEXT_PLAN_SCHEMA>;
const ASSIGNED_BLOCKS_SCHEMA = Type.Array(
  Type.Object({ blockId: ID, text: Type.String() }, { additionalProperties: false }),
  { minItems: 1, maxItems: 2 },
);
export const IMAGE_TEXT_ASSIGNMENT_SCHEMA = Type.Union([
  Type.Object(
    {
      pageId: ID,
      regionId: ID,
      candidateId: Type.Literal("C0"),
      blocks: Type.Optional(ASSIGNED_BLOCKS_SCHEMA),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { pageId: ID, regionId: ID, candidateId: ID, blocks: ASSIGNED_BLOCKS_SCHEMA },
    { additionalProperties: false },
  ),
]);
export type ImageTextAssignment = Static<typeof IMAGE_TEXT_ASSIGNMENT_SCHEMA>;
export type ImageTextSelection = {
  regionId: string;
  candidateId: string;
  text: string | null;
  blocks: (Static<typeof PLAN_BLOCK_SCHEMA> & { text: string | null })[];
};
