import { Type, type Static } from "typebox";
import { IMAGE_DIRECTION_SCHEMA, IMAGE_FILL_SCHEMA } from "./image-package";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
/** 文件生成内部快照保留完成事实，空正文与未翻译分别表示。 */
export type ImageTextInput = {
  records: {
    pageId: string;
    regionId: string;
    output: "translated" | "original" | null;
    text: string | null;
  }[];
};

/** 字号与栅格判定共用规则。调用者只提供正文与已确认区域事实。 */
export const IMAGE_TEXT_RULES = Object.freeze({
  fontFile: "LGBaseFont-Regular.ttf",
  lineHeight: 1.1,
  minimumFontSize: 2,
  minimumStroke: 0.5,
  strokeRatio: 0.04,
  antialiasingAllowance: 1,
  squareDistanceCorrection: Math.SQRT2,
  pageTimeoutMs: 600_000,
  maximumMaterialBytes: 256_000_000,
});

const BOX = Type.Tuple([
  Type.Integer(),
  Type.Integer(),
  Type.Integer({ minimum: 1 }),
  Type.Integer({ minimum: 1 }),
]);
const IMAGE_TEXT_MAX_BLOCKS = 4;
const IMAGE_TEXT_MAX_CANDIDATES = 7;
const IMAGE_TEXT_GEOMETRY_BLOCK_SCHEMA = Type.Object(
  {
    blockId: ID,
    box: BOX,
    distance: Type.String(),
    sourceTextBoxIds: Type.Array(ID, { minItems: 1, maxItems: 10000 }),
  },
  { additionalProperties: false },
);
const IMAGE_TEXT_GEOMETRY_CANDIDATE_SCHEMA = Type.Object(
  {
    candidateId: ID,
    blocks: Type.Array(IMAGE_TEXT_GEOMETRY_BLOCK_SCHEMA, {
      minItems: 1,
      maxItems: IMAGE_TEXT_MAX_BLOCKS,
    }),
  },
  { additionalProperties: false },
);
const IMAGE_TEXT_BLOCK_SCHEMA = Type.Object(
  {
    blockId: ID,
    box: BOX,
    distance: Type.String(),
    preferredFontSize: Type.Integer({ minimum: IMAGE_TEXT_RULES.minimumFontSize }),
    sourceEnvelopeArea: Type.Number({ exclusiveMinimum: 0 }),
    sourceCenter: Type.Tuple([Type.Number(), Type.Number()]),
  },
  { additionalProperties: false },
);
const IMAGE_TEXT_CANDIDATE_SCHEMA = Type.Object(
  {
    candidateId: ID,
    blocks: Type.Array(IMAGE_TEXT_BLOCK_SCHEMA, {
      minItems: 1,
      maxItems: IMAGE_TEXT_MAX_BLOCKS,
    }),
  },
  { additionalProperties: false },
);
export const IMAGE_TEXT_PAGE_SCHEMA = Type.Object(
  {
    pageId: ID,
    width: Type.Integer({ minimum: 1, maximum: 100000 }),
    height: Type.Integer({ minimum: 1, maximum: 100000 }),
    regions: Type.Array(
      Type.Object(
        {
          regionId: ID,
          text: Type.String(),
          direction: IMAGE_DIRECTION_SCHEMA,
          fill: IMAGE_FILL_SCHEMA,
          candidates: Type.Array(IMAGE_TEXT_CANDIDATE_SCHEMA, {
            minItems: 1,
            maxItems: IMAGE_TEXT_MAX_CANDIDATES,
          }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);
export type ImageTextPage = Static<typeof IMAGE_TEXT_PAGE_SCHEMA>;
export const IMAGE_TEXT_GEOMETRY_REGION_SCHEMA = Type.Object(
  {
    regionId: ID,
    candidates: Type.Array(IMAGE_TEXT_GEOMETRY_CANDIDATE_SCHEMA, {
      minItems: 1,
      maxItems: IMAGE_TEXT_MAX_CANDIDATES,
    }),
  },
  { additionalProperties: false },
);
export type ImageTextGeometryRegion = Static<typeof IMAGE_TEXT_GEOMETRY_REGION_SCHEMA>;

const IMAGE_TEXT_RENDERED_RESULT_SCHEMA = Type.Object(
  { regionId: ID, box: BOX },
  { additionalProperties: false },
);
export const IMAGE_TEXT_BLOCK_RESULT_SCHEMA = Type.Union([
  Type.Object(
    {
      ...IMAGE_TEXT_RENDERED_RESULT_SCHEMA.properties,
      renderStatus: Type.Literal("success"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      regionId: ID,
      renderStatus: Type.Literal("failure"),
      reason: Type.Literal("layout_no_fit"),
    },
    { additionalProperties: false },
  ),
]);
export type ImageTextBlockResult = Static<typeof IMAGE_TEXT_BLOCK_RESULT_SCHEMA>;
export const IMAGE_TEXT_PAINT_SCHEMA = Type.Object(
  {
    result: IMAGE_TEXT_BLOCK_RESULT_SCHEMA,
    png: Type.Optional(Type.String()), // 同一原生覆盖层的 PNG，坐标为区域 box。
  },
  { additionalProperties: false },
);
export type ImageTextPaint = Static<typeof IMAGE_TEXT_PAINT_SCHEMA>;
export type ImageTextHostOperation = { kind: "render_image_text_page"; page: ImageTextPage };
export type ImageTextHost = (
  operation: ImageTextHostOperation,
  signal?: AbortSignal,
) => Promise<ImageTextPaint[]>;

/** 单换行只在相邻词段需要分隔时补空格。段落保留一个空行。 */
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

/** 在线性亮度下比较黑白对比度，底色来自已确认填色。 */
export function image_text_color(color: readonly number[]): "black" | "white" {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "black" : "white";
}
