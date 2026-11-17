import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import {
  IMAGE_BOOK_SCHEMA,
  IMAGE_CLEAN_SCHEMA,
  IMAGE_OUTPUT_ASSET_SCHEMA,
  IMAGE_RECORD_SCHEMA,
} from "./image";
import { IMAGE_TEXT_GEOMETRY_REGION_SCHEMA } from "./image-text";

const PAGE_SCHEMA = IMAGE_BOOK_SCHEMA.properties.pages.items;
const CLEAN_PAGE_SCHEMA = IMAGE_CLEAN_SCHEMA.properties.pages.items;
const CLEAN_REGION_SCHEMA = CLEAN_PAGE_SCHEMA.properties.regions.items;
const OUTPUT_ENTRY_SCHEMA =
  IMAGE_OUTPUT_ASSET_SCHEMA.properties.files.items.properties.entries.items;

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
const CREATE_RESULT_SCHEMA = Type.Object(
  {
    pages: Type.Array(
      Type.Object(
        {
          page: PAGE_SCHEMA,
          records: Type.Array(IMAGE_RECORD_SCHEMA),
          clean: CLEAN_PAGE_SCHEMA,
          diagnostics: Type.Object(
            {
              preview: Type.String({ minLength: 1 }),
              detected: Type.Integer({ minimum: 0 }),
              regions: Type.Integer({ minimum: 0 }),
              failures: Type.Array(
                Type.Object(
                  { regionId: Type.String({ minLength: 1 }), error: Type.String({ minLength: 1 }) },
                  { additionalProperties: false },
                ),
              ),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const PATH_RESULT_SCHEMA = Type.Object(
  { path: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
const PREVIEW_RESULT_SCHEMA = Type.Object(
  { preview: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/** Python 图片 helper 的请求与结果只在这一处定义。 */
export const IMAGE_HELPER_OPERATION_SCHEMAS = {
  create: {
    request: Type.Object(
      { pages: Type.Array(CREATE_PAGE_SCHEMA, { minItems: 1 }), output: Type.String() },
      { additionalProperties: false },
    ),
    response: CREATE_RESULT_SCHEMA,
  },
  pack: {
    request: Type.Object(
      {
        output: Type.String(),
        book: IMAGE_BOOK_SCHEMA,
        records: Type.Array(IMAGE_RECORD_SCHEMA),
        clean: IMAGE_CLEAN_SCHEMA,
        sources: Type.Record(Type.String(), Type.String()),
      },
      { additionalProperties: false },
    ),
    response: PATH_RESULT_SCHEMA,
  },
  text_layout: {
    request: Type.Object(
      {
        root: Type.String(),
        page: PAGE_SCHEMA,
        maximumBytes: Type.Integer({ minimum: 1 }),
      },
      { additionalProperties: false },
    ),
    response: Type.Array(IMAGE_TEXT_GEOMETRY_REGION_SCHEMA),
  },
  text_compose: {
    request: Type.Object(
      {
        root: Type.String(),
        page: PAGE_SCHEMA,
        source: Type.String(),
        original: Type.String(),
        cleanRegions: Type.Array(CLEAN_REGION_SCHEMA),
        fallbackRegionIds: Type.Array(Type.String()),
        paint: Type.String(),
        output: Type.String(),
      },
      { additionalProperties: false },
    ),
    response: PREVIEW_RESULT_SCHEMA,
  },
  qa_preview: {
    request: Type.Object(
      {
        root: Type.String(),
        page: PAGE_SCHEMA,
        source: Type.String(),
        entries: Type.Array(OUTPUT_ENTRY_SCHEMA),
        output: Type.String(),
      },
      { additionalProperties: false },
    ),
    response: PREVIEW_RESULT_SCHEMA,
  },
  encode_output: {
    request: Type.Object(
      { source: Type.String(), output: Type.String(), extension: Type.String() },
      { additionalProperties: false },
    ),
    response: PATH_RESULT_SCHEMA,
  },
} as const satisfies Record<string, { request: TSchema; response: TSchema }>;

export type ImageHelperOperation = keyof typeof IMAGE_HELPER_OPERATION_SCHEMAS;
export type ImageHelperRequest<K extends ImageHelperOperation> = Static<
  (typeof IMAGE_HELPER_OPERATION_SCHEMAS)[K]["request"]
>;
export type ImageHelperResponse<K extends ImageHelperOperation> = Static<
  (typeof IMAGE_HELPER_OPERATION_SCHEMAS)[K]["response"]
>;
export type ImagePixelHost = <K extends ImageHelperOperation>(
  command: K,
  input: ImageHelperRequest<K>,
) => Promise<ImageHelperResponse<K>>;

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
