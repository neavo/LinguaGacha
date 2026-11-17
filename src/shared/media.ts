import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { MEDIA_TEXT_REGION_SCHEMA } from "./media-package";

const TIME_SCHEMA = Type.Number({ minimum: 0 });
const BOX_SCHEMA = Type.Tuple([
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Number({ minimum: 0, maximum: 1 }),
]);

const HELPER_TEXT_BOUND_SCHEMA = Type.Object(
  {
    row: Type.Integer({ minimum: 0 }),
    start: Type.Union([TIME_SCHEMA, Type.Null()]),
    end: Type.Union([TIME_SCHEMA, Type.Null()]),
  },
  { additionalProperties: false },
);
const HELPER_SHEET_SCHEMA = Type.Object(
  {
    file: Type.String({ minLength: 1 }),
    ids: Type.Array(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);

/** Python 媒体 helper 的请求与结果只在这一处定义。 */
export const MEDIA_HELPER_OPERATION_SCHEMAS = {
  speech: {
    request: Type.Object(
      {
        ffmpeg: Type.String(),
        source: Type.String(),
        track: Type.Integer({ minimum: 0 }),
        center: Type.Boolean(),
        language: Type.String(),
        vad_mvn: Type.String(),
        asr_mvn: Type.String(),
      },
      { additionalProperties: false },
    ),
    response: Type.Object(
      {
        spans: Type.Array(Type.Tuple([Type.Number(), Type.Number()])),
        windows: Type.Array(
          Type.Object(
            {
              from: Type.Number(),
              end: Type.Number(),
              tokens: Type.Array(Type.String()),
              timestamps: Type.Array(Type.Number()),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  scan: {
    request: Type.Object(
      {
        ffmpeg: Type.String(),
        source: Type.String(),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        out: Type.String(),
      },
      { additionalProperties: false },
    ),
    response: Type.Array(MEDIA_TEXT_REGION_SCHEMA),
  },
  refine: {
    request: Type.Object(
      {
        ffmpeg: Type.String(),
        source: Type.String(),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
        duration: Type.Number({ exclusiveMinimum: 0 }),
        rows: Type.Array(
          Type.Object(
            {
              row: Type.Integer({ minimum: 0 }),
              start: TIME_SCHEMA,
              end: TIME_SCHEMA,
              box: BOX_SCHEMA,
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    response: Type.Array(HELPER_TEXT_BOUND_SCHEMA),
  },
  sheet: {
    request: Type.Object(
      {
        entries: Type.Array(
          Type.Object(
            {
              id: Type.Integer({ minimum: 0 }),
              start: TIME_SCHEMA,
              file: Type.String(),
            },
            { additionalProperties: false },
          ),
        ),
        out: Type.String(),
      },
      { additionalProperties: false },
    ),
    response: Type.Array(HELPER_SHEET_SCHEMA),
  },
} as const satisfies Record<string, { request: TSchema; response: TSchema }>;

export type MediaHelperOperation = keyof typeof MEDIA_HELPER_OPERATION_SCHEMAS;
export type MediaHelperRequest<K extends MediaHelperOperation> = Static<
  (typeof MEDIA_HELPER_OPERATION_SCHEMAS)[K]["request"]
>;
export type MediaHelperResponse<K extends MediaHelperOperation> = Static<
  (typeof MEDIA_HELPER_OPERATION_SCHEMAS)[K]["response"]
>;
export type MediaTextRegion = MediaHelperResponse<"scan">[number];
export type MediaTextBound = MediaHelperResponse<"refine">[number];
export type MediaSheet = MediaHelperResponse<"sheet">[number];

export function check_media_helper_request<K extends MediaHelperOperation>(
  command: K,
  value: unknown,
): value is MediaHelperRequest<K> {
  return Check(MEDIA_HELPER_OPERATION_SCHEMAS[command].request, value);
}

export function read_media_helper_response<K extends MediaHelperOperation>(
  command: K,
  value: unknown,
): MediaHelperResponse<K> {
  if (!Check(MEDIA_HELPER_OPERATION_SCHEMAS[command].response, value))
    throw new Error(`Invalid media helper response: ${command}`);
  return value as MediaHelperResponse<K>;
}
