import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { IMAGE_FONT_SIZE_SCHEMA } from "./image-font-size";
import {
  IMAGE_BOOK_SCHEMA,
  IMAGE_BOX_SCHEMA,
  IMAGE_ID_SCHEMA,
  IMAGE_RECORD_SCHEMA,
} from "./image-package";

const PAGE_SCHEMA = IMAGE_BOOK_SCHEMA.properties.pages.items;

const CREATE_PAGE_SCHEMA = Type.Object(
  {
    pageId: PAGE_SCHEMA.properties.pageId,
    relativePath: PAGE_SCHEMA.properties.relativePath,
    original: PAGE_SCHEMA.properties.original,
    sha256: PAGE_SCHEMA.properties.sha256,
    width: PAGE_SCHEMA.properties.width,
    height: PAGE_SCHEMA.properties.height,
    orientation: PAGE_SCHEMA.properties.orientation,
    source: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
const SCAN_RESULT_SCHEMA = Type.Object(
  {
    pages: Type.Array(
      Type.Object(
        {
          pageId: IMAGE_ID_SCHEMA,
          relativePath: PAGE_SCHEMA.properties.relativePath,
          preview: Type.String(),
          records: Type.Array(
            Type.Object(
              {
                regionId: IMAGE_ID_SCHEMA,
                group: IMAGE_ID_SCHEMA,
                message: IMAGE_RECORD_SCHEMA.properties.message,
                kind: PAGE_SCHEMA.properties.regions.items.properties.kind,
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

const BUBBLE_GROUP_PROPERTIES = {
  pageId: IMAGE_ID_SCHEMA,
  group: IMAGE_ID_SCHEMA,
};
const BUBBLE_GROUP_SCHEMA = Type.Object(BUBBLE_GROUP_PROPERTIES, { additionalProperties: false });
const BUBBLE_PARTITION_SCHEMA = Type.Object(
  {
    ...BUBBLE_GROUP_PROPERTIES,
    parts: Type.Array(
      Type.Object(
        {
          textBoxIds: Type.Array(IMAGE_ID_SCHEMA, { minItems: 1 }),
          translate: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
export type ImageBubbleGroup = Static<typeof BUBBLE_GROUP_SCHEMA>;
export type ImageBubblePartition = Static<typeof BUBBLE_PARTITION_SCHEMA>;

const SELECTION_SCHEMA = Type.Object(
  {
    pageId: IMAGE_ID_SCHEMA,
    regionId: IMAGE_ID_SCHEMA,
    message: Type.Optional(IMAGE_RECORD_SCHEMA.properties.message),
    contour: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
/** Python 图片 helper 的请求与结果只在这一处定义。 */
export const IMAGE_HELPER_OPERATION_SCHEMAS = {
  scan: {
    request: Type.Object(
      { pages: Type.Array(CREATE_PAGE_SCHEMA, { minItems: 1 }), output: Type.String() },
      { additionalProperties: false },
    ),
    response: SCAN_RESULT_SCHEMA,
  },
  inspect_bubble_group: {
    request: Type.Object(
      { root: Type.String(), output: Type.String(), ...BUBBLE_GROUP_PROPERTIES },
      { additionalProperties: false },
    ),
    response: Type.Object(
      {
        preview: Type.String(),
        lines: Type.Array(
          Type.Object(
            { textBoxId: IMAGE_ID_SCHEMA, message: IMAGE_RECORD_SCHEMA.properties.message },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  prepare: {
    request: Type.Object(
      {
        root: Type.String(),
        output: Type.String(),
        selected: Type.Array(SELECTION_SCHEMA),
        partitions: Type.Array(BUBBLE_PARTITION_SCHEMA),
        variants: Type.Boolean(),
        repartition: Type.Optional(BUBBLE_GROUP_SCHEMA),
        previous: Type.Optional(Type.String()),
        reserved: Type.Optional(
          Type.Array(
            Type.Object({
              regionId: IMAGE_ID_SCHEMA,
              box: IMAGE_BOX_SCHEMA,
            }),
          ),
        ),
      },
      { additionalProperties: false },
    ),
    response: Type.Object(
      {
        pages: Type.Array(PAGE_SCHEMA),
        records: Type.Array(IMAGE_RECORD_SCHEMA),
      },
      { additionalProperties: false },
    ),
  },
  text_layout: {
    request: Type.Object(
      {
        root: Type.String(),
        output: Type.String(),
        page: PAGE_SCHEMA,
        lettering: Type.Array(
          Type.Object(
            {
              regionId: IMAGE_ID_SCHEMA,
              text: Type.String(),
              fontSize: Type.Optional(IMAGE_FONT_SIZE_SCHEMA),
            },
            { additionalProperties: false },
          ),
        ),
        maximumBytes: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    response: Type.Null(),
  },
  text_output: {
    request: Type.Object(
      {
        root: Type.String(),
        original: Type.String(),
        layers: Type.Optional(Type.String()),
        qa: Type.Object({
          path: Type.String(),
          maxEdge: Type.Integer({ minimum: 2 }),
          marks: Type.Array(
            Type.Object({
              regionId: Type.String(),
              box: IMAGE_BOX_SCHEMA,
              warning: Type.Boolean(),
            }),
          ),
        }),
        output: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    response: Type.Null(), // 调用方已指定译图和 QA 的落盘路径。
  },
} as const satisfies Record<string, { request: TSchema; response: TSchema }>;

export type ImageHelperOperation = keyof typeof IMAGE_HELPER_OPERATION_SCHEMAS;
export type ImageHelperRequest<K extends ImageHelperOperation> = Static<
  (typeof IMAGE_HELPER_OPERATION_SCHEMAS)[K]["request"]
>;
export type ImageHelperResponse<K extends ImageHelperOperation> = Static<
  (typeof IMAGE_HELPER_OPERATION_SCHEMAS)[K]["response"]
>;
export function check_image_helper_request<K extends ImageHelperOperation>(
  command: K,
  value: unknown,
): value is ImageHelperRequest<K> {
  return Check(IMAGE_HELPER_OPERATION_SCHEMAS[command].request, value);
}

export function read_image_helper_response<K extends ImageHelperOperation>(
  command: K,
  value: unknown,
): ImageHelperResponse<K> {
  if (!Check(IMAGE_HELPER_OPERATION_SCHEMAS[command].response, value))
    throw new Error(`Invalid image helper response: ${command}`);
  return value as ImageHelperResponse<K>;
}
