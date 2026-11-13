import { Type, type Static } from "typebox";

const ID = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" });
const NUMBER = Type.Number({ minimum: 0, maximum: 100000 });
const POINT = Type.Object({ x: NUMBER, y: NUMBER }, { additionalProperties: false });
const POLYGON = Type.Array(POINT, { minItems: 3, maxItems: 10000 });
const SHAPES = Type.Array(POLYGON, { maxItems: 1000 });
const RECT = Type.Object(
  { x: NUMBER, y: NUMBER, width: NUMBER, height: NUMBER },
  { additionalProperties: false },
);
const COLOR = Type.String({ pattern: "^#[0-9a-fA-F]{6}$" });
export const IMAGE_REGION_SCHEMA = Type.Object(
  {
    regionId: ID,
    disposition: Type.Union([Type.Literal("translate"), Type.Literal("preserve")]),
    source: Type.Array(RECT, { minItems: 1, maxItems: 100 }),
    layout: SHAPES,
    direction: Type.Union([Type.Literal("horizontal-tb"), Type.Literal("vertical-rl")]),
    style: Type.Object(
      {
        color: COLOR,
        stroke: COLOR,
        strokeWidth: Type.Number({ minimum: 0, maximum: 32 }),
        weight: Type.Union([Type.Literal(400), Type.Literal(700)]),
        rotation: Type.Number({ minimum: -45, maximum: 45 }),
        minFontSize: Type.Number({ minimum: 1, maximum: 1000 }),
        fontSize: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export const IMAGE_GROUP_SCHEMA = Type.Object(
  {
    groupId: ID,
    regionIds: Type.Array(ID, { minItems: 1, uniqueItems: true }),
    mode: Type.Union([
      Type.Literal("basic"),
      Type.Literal("solid"),
      Type.Literal("inpaint"),
      Type.Literal("preserve"),
    ]),
    areas: SHAPES,
    protection: SHAPES,
    mask: Type.Optional(
      Type.Object(
        { path: Type.String({ minLength: 1 }), sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export const IMAGE_PAGE_SCHEMA = Type.Object(
  {
    pageId: ID,
    original: Type.String({ minLength: 1 }),
    sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    width: Type.Integer({ minimum: 1, maximum: 100000 }),
    height: Type.Integer({ minimum: 1, maximum: 100000 }),
    orientation: Type.Integer({ minimum: 1, maximum: 8 }),
    regions: Type.Array(IMAGE_REGION_SCHEMA, { maxItems: 10000 }),
    groups: Type.Array(IMAGE_GROUP_SCHEMA, { maxItems: 10000 }),
  },
  { additionalProperties: false },
);
export const IMAGE_BOOK_SCHEMA = Type.Object(
  {
    version: Type.Literal(1),
    bookId: ID,
    pages: Type.Array(IMAGE_PAGE_SCHEMA, { minItems: 1, maxItems: 10000 }),
  },
  { additionalProperties: false },
);
export type ImageBook = Static<typeof IMAGE_BOOK_SCHEMA>;
export type ImagePage = Static<typeof IMAGE_PAGE_SCHEMA>;
export type ImageRegion = Static<typeof IMAGE_REGION_SCHEMA>;
export type ImageGroup = Static<typeof IMAGE_GROUP_SCHEMA>;
export type ImageRecord = { message: string; name?: string; pageId: string; regionId: string };
export type ImageGenerationSnapshot = {
  generationId: string;
  projectPath: string;
  revisions: Record<string, number>;
};
export type ImageWriteback = ImageGenerationSnapshot & {
  version: 1;
  assetPath: string;
  sourceSha256: string;
  stateSha256: string;
  itemsSha256: string;
  rows: { row: number; pageId: string; regionId: string; completed: boolean }[];
};

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
          mask: Type.String({ minLength: 1 }),
          direction: IMAGE_REGION_SCHEMA.properties.direction,
          style: IMAGE_REGION_SCHEMA.properties.style,
          measurement: Type.Object(
            {
              status: Type.String(),
              value: Type.Union([Type.Number(), Type.Null()]),
              reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              axis: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 10000 },
    ),
  },
  { additionalProperties: false },
);
export type ImageLayoutRequest = Static<typeof IMAGE_LAYOUT_SCHEMA>;
export type ImageTile = { path: string; x: number; y: number; width: number; height: number };
export type ImageLayoutResult = {
  regions: {
    regionId: string;
    ready: boolean;
    reason?: string;
    size: number;
    tiles: ImageTile[];
  }[];
};
export type ImageHostOperation = ImageLayoutRequest & { outputDirectory: string };
export type ImageHost = (
  operation: ImageHostOperation,
  signal: AbortSignal,
) => Promise<ImageLayoutResult>;
