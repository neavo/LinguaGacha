import { Type, type Static } from "typebox";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" }); // 跨包与页面引用的稳定标识。
const COLOR = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }); // 六位十六进制 RGB 颜色。
const DIRECTION_SCHEMA = Type.Union([Type.Literal("horizontal-tb"), Type.Literal("vertical-rl")]); // 排版书写方向。
const STYLE_SCHEMA = Type.Object(
  {
    color: Type.Optional(COLOR),
    stroke: Type.Optional(COLOR),
    strokeWidth: Type.Optional(Type.Number({ minimum: 0, maximum: 32 })),
    weight: Type.Optional(Type.Union([Type.Literal(400), Type.Literal(700)])),
    rotation: Type.Optional(Type.Number({ minimum: -45, maximum: 45 })),
    minFontSize: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
    fontSize: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
    align: Type.Optional(Type.Union([Type.Literal("center"), Type.Literal("start")])),
  },
  { additionalProperties: false },
); // 区域文字渲染样式覆盖项。
const REGION_SCHEMA = Type.Object(
  {
    regionId: ID,
    disposition: Type.Union([Type.Literal("translate"), Type.Literal("preserve")]),
    bbox: Type.Object(
      {
        x: Type.Integer({ minimum: 0, maximum: 100000 }),
        y: Type.Integer({ minimum: 0, maximum: 100000 }),
        width: Type.Integer({ minimum: 1, maximum: 100000 }),
        height: Type.Integer({ minimum: 1, maximum: 100000 }),
      },
      { additionalProperties: false },
    ),
    direction: DIRECTION_SCHEMA,
    style: Type.Optional(STYLE_SCHEMA),
  },
  { additionalProperties: false },
); // 单页内的待译或保留文字区域。

/** 图片书完整结构契约，用于草稿保存与 `.image` 归档校验。 */
export const IMAGE_BOOK_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    bookId: ID,
    pages: Type.Array(
      Type.Object(
        {
          pageId: ID,
          original: Type.String({ minLength: 1 }),
          sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          width: Type.Integer({ minimum: 1, maximum: 100000 }),
          height: Type.Integer({ minimum: 1, maximum: 100000 }),
          orientation: Type.Integer({ minimum: 1, maximum: 8 }),
          regions: Type.Array(REGION_SCHEMA, { maxItems: 10000 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);
export type ImageBook = Static<typeof IMAGE_BOOK_SCHEMA>;
export type ImagePage = ImageBook["pages"][number];
export type ImageRegion = ImagePage["regions"][number];
export type ImageRecord = { message: string; name?: string; pageId: string; regionId: string }; // 与区域一一对应的文本条目。
export type ImageGenerationSnapshot = {
  generationId: string;
  projectPath: string;
  revisions: Record<string, number>;
}; // 导出时记录的工程修订基线。
export type ImageWriteback = ImageGenerationSnapshot & {
  version: 1;
  assetPath: string;
  sourceSha256: string;
  recordsSha256: string;
  itemsSha256: string;
  rows: { row: number; pageId: string; regionId: string; completed: boolean }[];
}; // 写回阶段校验原稿、条目与完成状态一致性的清单。

/** 提交给原生排版宿主的单页文字渲染请求契约。 */
export const IMAGE_LAYOUT_SCHEMA = Type.Object(
  {
    kind: Type.Literal("render_image"),
    regions: Type.Array(
      Type.Object(
        {
          regionId: ID,
          text: Type.String({ maxLength: 100000 }),
          width: Type.Integer({ minimum: 1, maximum: 20000 }),
          height: Type.Integer({ minimum: 1, maximum: 20000 }),
          direction: DIRECTION_SCHEMA,
          style: STYLE_SCHEMA,
        },
        { additionalProperties: false },
      ),
      { maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);
export type ImageLayoutRequest = Static<typeof IMAGE_LAYOUT_SCHEMA>;
export type ImageTile = { path: string; x: number; y: number; width: number; height: number }; // 排版宿主输出的局部透明图层切片。
export type ImageLayoutResult = {
  regions: {
    regionId: string;
    ready: boolean;
    reason?: string;
    size: number;
    tiles: ImageTile[];
  }[];
}; // 排版宿主返回的各区域切片与拟合字号。
export type ImageHostOperation = ImageLayoutRequest & { outputDirectory: string }; // 附加宿主分配输出目录的渲染任务。
export type ImageHost = (
  operation: ImageHostOperation,
  signal: AbortSignal,
) => Promise<ImageLayoutResult>; // 原生窗口排版渲染宿主回调。
