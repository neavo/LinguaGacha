import { Type, type Static } from "typebox";

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
