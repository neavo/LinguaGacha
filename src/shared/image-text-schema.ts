import { Type, type Static } from "typebox";
import {
  IMAGE_BOX_SCHEMA,
  IMAGE_COLOR_SCHEMA,
  IMAGE_DIRECTION_SCHEMA,
  IMAGE_ID_SCHEMA,
  IMAGE_KIND_SCHEMA,
  IMAGE_QUAD_SCHEMA,
} from "./image-package";

const SIZE = Type.Tuple([Type.Integer({ minimum: 1 }), Type.Integer({ minimum: 1 })]);
const REGION = Type.Object(
  {
    regionId: IMAGE_ID_SCHEMA,
    box: IMAGE_BOX_SCHEMA,
    distance: Type.String(),
    sourceLines: Type.Array(IMAGE_QUAD_SCHEMA, { maxItems: 10000 }),
    direction: IMAGE_DIRECTION_SCHEMA,
    kind: IMAGE_KIND_SCHEMA,
    backgroundColor: IMAGE_COLOR_SCHEMA,
    text: Type.String(),
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
export const IMAGE_TEXT_PAGE_SCHEMA = Type.Object(
  { pageId: IMAGE_ID_SCHEMA, regions: Type.Array(REGION, { minItems: 1, maxItems: 10000 }) },
  { additionalProperties: false },
);
export type ImageTextRegion = Static<typeof REGION>;
export type ImageTextPage = Static<typeof IMAGE_TEXT_PAGE_SCHEMA>;
