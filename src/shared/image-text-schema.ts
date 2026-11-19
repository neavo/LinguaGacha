import { Type, type Static } from "typebox";
import { IMAGE_COLOR_SCHEMA, IMAGE_DIRECTION_SCHEMA, IMAGE_ID_SCHEMA } from "./image-package";
import { IMAGE_FONT_SIZE_SCHEMA } from "./image-font-size";

const SIZE = Type.Tuple([Type.Integer({ minimum: 1 }), Type.Integer({ minimum: 1 })]);
const REGION = Type.Object(
  {
    regionId: IMAGE_ID_SCHEMA,
    size: SIZE,
    distance: Type.String(),
    direction: IMAGE_DIRECTION_SCHEMA,
    backgroundColor: IMAGE_COLOR_SCHEMA,
    text: Type.String(),
    fontSize: Type.Optional(IMAGE_FONT_SIZE_SCHEMA),
  },
  { additionalProperties: false },
);
export const IMAGE_TEXT_PAGE_SCHEMA = Type.Array(REGION, { minItems: 1, maxItems: 10000 });
export type ImageTextRegion = Static<typeof REGION>;
export type ImageTextPage = Static<typeof IMAGE_TEXT_PAGE_SCHEMA>;
