import { Type, type Static } from "typebox";
import { IMAGE_ID_SCHEMA as ID } from "./image-package";

const IMAGE_OUTPUT_REASON_CODE_SCHEMA = Type.Union([
  Type.Literal("layout_no_fit"),
  Type.Literal("erase_failed"),
  Type.Literal("translation_incomplete"),
]);

const IMAGE_OUTPUT_REASON_SCHEMA = Type.Object(
  {
    code: IMAGE_OUTPUT_REASON_CODE_SCHEMA,
    detail: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
const IMAGE_OUTPUT_ENTRY_SCHEMA = Type.Object(
  {
    region_id: Type.Optional(ID),
    status: Type.Union([Type.Literal("success"), Type.Literal("failure")]),
    output: Type.Union([Type.Literal("original"), Type.Literal("translated")]),
    reasons: Type.Array(IMAGE_OUTPUT_REASON_SCHEMA),
  },
  { additionalProperties: false },
);
export const IMAGE_OUTPUT_ASSET_SCHEMA = Type.Object(
  {
    asset_path: Type.String({ minLength: 1 }),
    files: Type.Array(
      Type.Object(
        { path: Type.String({ minLength: 1 }), entries: Type.Array(IMAGE_OUTPUT_ENTRY_SCHEMA) },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ImageOutputAsset = Static<typeof IMAGE_OUTPUT_ASSET_SCHEMA>;

export const IMAGE_OUTPUT_SUMMARY_SCHEMA = Type.Object(
  {
    success: Type.Integer({ minimum: 0 }),
    failures: Type.Integer({ minimum: 0 }),
    originals: Type.Integer({ minimum: 0 }),
    translated: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ImageOutputSummary = Static<typeof IMAGE_OUTPUT_SUMMARY_SCHEMA>;

export const IMAGE_OUTPUT_REPORT_SCHEMA = Type.Object(
  { path: Type.String({ minLength: 1 }), summary: IMAGE_OUTPUT_SUMMARY_SCHEMA },
  { additionalProperties: false },
);
export type ImageOutputReport = Static<typeof IMAGE_OUTPUT_REPORT_SCHEMA>;
export type ImageQualityResult = { output_path: string; report: ImageOutputReport };
