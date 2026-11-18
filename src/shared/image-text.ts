import { Type, type Static } from "typebox";
import { IMAGE_ID_SCHEMA, type ImageRegion } from "./image-package";

/** 字号与栅格判定共用规则。调用者只提供正文与已确认区域事实。 */
export const IMAGE_TEXT_RULES = Object.freeze({
  fontFile: "LGBaseFont-Regular.ttf",
  lineHeight: 1.1,
  minimumFontSize: 2,
  fontSizeScale: 1.5,
  rotationAllowance: 1,
  minimumStroke: 1,
  strokeRatio: 0.08,
  antialiasingAllowance: 1,
  squareDistanceCorrection: Math.SQRT2,
  pageTimeoutMs: 600_000,
  maximumMaterialBytes: 256_000_000,
});

const SIZE = Type.Tuple([Type.Integer({ minimum: 1 }), Type.Integer({ minimum: 1 })]);
const POINT = Type.Tuple([Type.Number(), Type.Number()]);
const QUAD = Type.Tuple([POINT, POINT, POINT, POINT]);
export const IMAGE_TEXT_GEOMETRY_REGION_SCHEMA = Type.Object(
  {
    regionId: IMAGE_ID_SCHEMA,
    box: Type.Tuple([Type.Integer(), Type.Integer(), ...SIZE.items]),
    distance: Type.String(),
    sourceLines: Type.Array(QUAD, { maxItems: 10000 }), // 气泡按容器排版，无框文字才传原行框。
    alignment: Type.Optional(
      Type.Object(
        {
          size: SIZE,
          distance: Type.String(),
          transform: Type.Tuple([
            Type.Number(),
            Type.Number(),
            Type.Number(),
            Type.Number(),
            Type.Number(),
            Type.Number(),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ImageTextGeometryRegion = Static<typeof IMAGE_TEXT_GEOMETRY_REGION_SCHEMA>;

export type ImageTextRegion = ImageTextGeometryRegion & {
  text: string;
  direction: ImageRegion["direction"];
  kind: ImageRegion["kind"];
  backgroundColor: ImageRegion["backgroundColor"];
};

export type ImageTextPage = {
  pageId: string;
  regions: ImageTextRegion[];
};

/** 空位图表示区域无法安全排版。绘制坐标沿用请求的 `box`。 */
export type ImageTextPaint = { regionId: string; png: string | null };

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

/** 排版预留与 Chromium 绘制共用描边宽度。 */
export function image_text_stroke_width(fontSize: number): number {
  return Math.max(IMAGE_TEXT_RULES.minimumStroke, fontSize * IMAGE_TEXT_RULES.strokeRatio);
}

/** 按区域背景色的线性亮度比较黑白对比度。 */
export function image_text_color(color: readonly number[]): "black" | "white" {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "black" : "white";
}
