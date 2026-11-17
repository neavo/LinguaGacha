import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { JSON_VALUE_SCHEMA } from "../domain/json";
import { GENERIC_ITEM_SCHEMA } from "./generic-package";

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
/** 画面文字证据使用归一化坐标和媒体时间。 */
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
  name: GENERIC_ITEM_SCHEMA.properties.name,
  box: Type.Optional(BOX_SCHEMA),
};
/** 正式媒体条目要求非空原文。 */
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
/** 写回输入允许空译文覆盖已确认的画面或对白。 */
export const MEDIA_WRITEBACK_ITEMS_SCHEMA = Type.Array(
  Type.Object(
    { ...MEDIA_ITEM_FIELDS, message: Type.String() },
    { additionalProperties: JSON_VALUE_SCHEMA },
  ),
);
export type MediaWritebackItems = Static<typeof MEDIA_WRITEBACK_ITEMS_SCHEMA>;

/** 时间段必须非空且位于媒体时长内。 */
function valid_range(start: number, end: number, duration: number): boolean {
  return 0 <= start && start < end && end <= duration;
}

/** 归一化矩形的右下角必须位于左上角之后。 */
function valid_box(box: readonly number[]): boolean {
  return box[0]! < box[2]! && box[1]! < box[3]!;
}

/** 校验识别分支之间无法由 Schema 表达的发布关系。 */
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

/** 读取允许识别分支尚未完成的工作清单。 */
export function read_media_work_manifest(value: unknown): MediaWorkManifest {
  if (!Check(MEDIA_WORK_MANIFEST_SCHEMA, value)) throw new Error("Invalid media work manifest.");
  validate_manifest(value);
  return value;
}

/** 读取全部识别分支已经结算的正式清单。 */
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

/** 校验条目时间、画面分支和矩形语义。 */
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

/** 读取带非空原文的正式媒体条目。 */
export function read_media_items(
  value: unknown,
  duration: number,
  video: MediaPackageManifest["video"],
): MediaItems {
  if (!Check(MEDIA_ITEMS_SCHEMA, value)) throw new Error("Invalid media items.");
  validate_media_items(value, duration, video);
  return value;
}

/** 读取允许空译文的媒体写回条目。 */
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
