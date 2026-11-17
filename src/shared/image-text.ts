import { Type, type Static } from "typebox";
import { IMAGE_DIRECTION_SCHEMA, IMAGE_FILL_SCHEMA } from "./image";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
/** 文件生成内部快照保留完成事实，空正文与未翻译分别表示。 */
export type ImageTextInput = {
  records: { pageId: string; regionId: string; text: string | null }[];
};

/** 字号、间距和栅格判定共用规则。调用者只提供正文与已确认区域事实。 */
export const IMAGE_TEXT_RULES = Object.freeze({
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
          text: Type.String(),
          direction: IMAGE_DIRECTION_SCHEMA,
          fill: IMAGE_FILL_SCHEMA,
          preferredFontSize: Type.Integer({ minimum: 2 }),
          sourceLineCount: Type.Integer({ minimum: 1 }),
          candidates: Type.Array(
            Type.Object(
              {
                candidateId: ID,
                blocks: Type.Array(
                  Type.Object(
                    {
                      blockId: ID,
                      box: BOX,
                      distance: Type.String(),
                      centroid: Type.Tuple([Type.Number(), Type.Number()]),
                    },
                    { additionalProperties: false },
                  ),
                  { minItems: 1, maxItems: 2 },
                ),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 7 },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);
export type ImageTextPage = Static<typeof IMAGE_TEXT_PAGE_SCHEMA>;
type ImageTextRenderedResult = {
  regionId: string;
  box: [number, number, number, number];
};
export type ImageTextBlockResult =
  | (ImageTextRenderedResult & { renderStatus: "success" })
  | (ImageTextRenderedResult & {
      renderStatus: "warning";
      reasons: ("small_font" | "tight_margin" | "off_center")[];
    })
  | {
      regionId: string;
      renderStatus: "failure";
      reason: "layout_no_fit" | "outside_layout_area";
    };
export type ImageTextPaint = {
  result: ImageTextBlockResult;
  png?: string; // 同一原生覆盖层的 PNG，坐标为区域 box。
};
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
