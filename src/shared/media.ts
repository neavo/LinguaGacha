import { Type, type Static, type TSchema } from "typebox";
import { Check } from "typebox/value";
import { JSON_VALUE_SCHEMA } from "../domain/json";

const TIME_SCHEMA = Type.Number({ minimum: 0 });
const BOX_SCHEMA = Type.Tuple([
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Number({ minimum: 0, maximum: 1 }),
  Type.Number({ minimum: 0, maximum: 1 }),
]);
const VIDEO_SCHEMA = Type.Union([
  Type.Object(
    {
      width: Type.Integer({ minimum: 1 }),
      height: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Null(),
]);
const SOURCE_SCHEMA = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    size: Type.Integer({ minimum: 0 }),
    mtime_ns: Type.String({ pattern: "^[0-9]+$" }),
    track: Type.Integer({ minimum: 0 }),
    language: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
const SPEECH_SCHEMA = Type.Array(Type.Tuple([TIME_SCHEMA, TIME_SCHEMA]));
const ASR_SENTENCE_SCHEMA = Type.Object(
  {
    start: TIME_SCHEMA,
    end: TIME_SCHEMA,
    text: Type.String(),
    tokens: Type.Array(Type.Tuple([Type.String(), TIME_SCHEMA])),
  },
  { additionalProperties: false },
);
const ASR_SCHEMA = Type.Array(ASR_SENTENCE_SCHEMA);
export const MEDIA_TEXT_REGION_SCHEMA = Type.Object(
  {
    id: Type.Integer({ minimum: 0 }),
    start: TIME_SCHEMA,
    end: TIME_SCHEMA,
    at: TIME_SCHEMA,
    box: BOX_SCHEMA,
  },
  { additionalProperties: false },
);
const TEXT_SCHEMA = Type.Array(MEDIA_TEXT_REGION_SCHEMA);

const MANIFEST_FIELDS = {
  source: SOURCE_SCHEMA,
  duration: Type.Number({ exclusiveMinimum: 0 }),
  video: VIDEO_SCHEMA,
};

/** 并行识别期间允许尚未发布的分支缺失。 */
export const MEDIA_WORK_MANIFEST_SCHEMA = Type.Object(
  {
    ...MANIFEST_FIELDS,
    speech: Type.Optional(Type.Union([SPEECH_SCHEMA, Type.Null()])),
    asr: Type.Optional(Type.Union([ASR_SCHEMA, Type.Null()])),
    text: Type.Optional(Type.Union([TEXT_SCHEMA, Type.Null()])),
  },
  { additionalProperties: false },
);
export type MediaWorkManifest = Static<typeof MEDIA_WORK_MANIFEST_SCHEMA>;

/** `.media` 包只保存全部分支已经结算的正式事实。 */
export const MEDIA_PACKAGE_MANIFEST_SCHEMA = Type.Object(
  {
    ...MANIFEST_FIELDS,
    speech: Type.Union([SPEECH_SCHEMA, Type.Null()]),
    asr: Type.Union([ASR_SCHEMA, Type.Null()]),
    text: Type.Union([TEXT_SCHEMA, Type.Null()]),
  },
  { additionalProperties: false },
);
export type MediaPackageManifest = Static<typeof MEDIA_PACKAGE_MANIFEST_SCHEMA>;

const MEDIA_ITEM_FIELDS = {
  start: TIME_SCHEMA,
  end: TIME_SCHEMA,
  kind: Type.Union([Type.Literal("dialogue"), Type.Literal("screen")]),
  name: Type.Optional(Type.String()),
  box: Type.Optional(BOX_SCHEMA),
};
export const MEDIA_ITEMS_SCHEMA = Type.Array(
  Type.Object(
    {
      ...MEDIA_ITEM_FIELDS,
      message: Type.String({ minLength: 1, pattern: "\\S" }),
    },
    { additionalProperties: JSON_VALUE_SCHEMA },
  ),
);
export type MediaItems = Static<typeof MEDIA_ITEMS_SCHEMA>;
export const MEDIA_WRITEBACK_ITEMS_SCHEMA = Type.Array(
  Type.Object(
    { ...MEDIA_ITEM_FIELDS, message: Type.String() },
    { additionalProperties: JSON_VALUE_SCHEMA },
  ),
);
export type MediaWritebackItems = Static<typeof MEDIA_WRITEBACK_ITEMS_SCHEMA>;

function valid_range(start: number, end: number, duration: number): boolean {
  return 0 <= start && start < end && end <= duration;
}

function valid_box(box: readonly number[]): boolean {
  return box[0]! < box[2]! && box[1]! < box[3]!;
}

function validate_manifest(manifest: MediaWorkManifest): void {
  const { duration, video, speech, asr, text } = manifest;
  if ((speech === undefined) !== (asr === undefined) || (speech === null) !== (asr === null))
    throw new Error("Media speech and ASR branches must be published together.");
  if (video === null ? text !== undefined && text !== null : text === null)
    throw new Error("Media text evidence does not match the picture stream.");
  for (const [start, end] of speech ?? [])
    if (!valid_range(start, end, duration)) throw new Error("Media speech range is invalid.");
  for (const sentence of asr ?? []) {
    if (!valid_range(sentence.start, sentence.end, duration))
      throw new Error("Media ASR range is invalid.");
    if (sentence.tokens.some(([, at]) => at < sentence.start || at > sentence.end))
      throw new Error("Media ASR token time is invalid.");
  }
  const ids = new Set<number>();
  for (const region of text ?? []) {
    if (
      ids.has(region.id) ||
      !valid_range(region.start, region.end, duration) ||
      region.at < region.start ||
      region.at > region.end ||
      !valid_box(region.box)
    )
      throw new Error("Media text region is invalid.");
    ids.add(region.id);
  }
}

export function read_media_work_manifest(value: unknown): MediaWorkManifest {
  if (!Check(MEDIA_WORK_MANIFEST_SCHEMA, value)) throw new Error("Invalid media work manifest.");
  validate_manifest(value);
  return value;
}

export function read_media_package_manifest(value: unknown): MediaPackageManifest {
  if (!Check(MEDIA_PACKAGE_MANIFEST_SCHEMA, value))
    throw new Error("Invalid media package manifest.");
  validate_manifest(value);
  if (
    value.video === null
      ? value.speech === null || value.asr === null || value.text !== null
      : value.text === null
  )
    throw new Error("Incomplete media package manifest.");
  return value;
}

function validate_media_items(
  items: MediaWritebackItems,
  duration: number,
  video: MediaPackageManifest["video"],
): void {
  for (const item of items) {
    if (
      !valid_range(item.start, item.end, duration) ||
      (item.kind === "screen" && video === null) ||
      (item.box !== undefined && (item.kind !== "screen" || !valid_box(item.box)))
    )
      throw new Error("Invalid media item.");
  }
}

export function read_media_items(
  value: unknown,
  duration: number,
  video: MediaPackageManifest["video"],
): MediaItems {
  if (!Check(MEDIA_ITEMS_SCHEMA, value)) throw new Error("Invalid media items.");
  validate_media_items(value, duration, video);
  return value;
}

export function read_media_writeback_items(
  value: unknown,
  duration: number,
  video: MediaPackageManifest["video"],
): MediaWritebackItems {
  if (!Check(MEDIA_WRITEBACK_ITEMS_SCHEMA, value))
    throw new Error("Invalid media writeback items.");
  validate_media_items(value, duration, video);
  return value;
}

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
