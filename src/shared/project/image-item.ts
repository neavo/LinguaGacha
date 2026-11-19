import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { ITEM_STATUSES, type ItemStatus } from "../../domain/item";
import { IMAGE_FONT_SIZE_SCHEMA } from "../image-font-size";

const IMAGE_ITEM_EXTRA_SCHEMA = Type.Object(
  {
    image: Type.Object(
      {
        inactiveStatus: Type.Optional(Type.Enum(ITEM_STATUSES)),
        fontSize: Type.Optional(IMAGE_FONT_SIZE_SCHEMA),
      },
      { additionalProperties: false, minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);

export type ImageItemExtra = Static<typeof IMAGE_ITEM_EXTRA_SCHEMA>;

/** 区分可随条目更新写入的图片数据与其他格式的私有数据。 */
export function is_image_item_extra(value: unknown): value is ImageItemExtra {
  return Check(IMAGE_ITEM_EXTRA_SCHEMA, value);
}

/** 图片条目缺少私有数据时使用自动字号和当前状态。 */
export function read_image_item_extra(value: unknown): ImageItemExtra["image"] {
  return is_image_item_extra(value) ? value.image : {};
}

/** 用条目默认值表示空配置，字段缺省时省略对应的 JSON 键。 */
export function build_image_item_extra({
  inactiveStatus,
  fontSize,
}: {
  inactiveStatus?: ItemStatus | undefined;
  fontSize?: number | undefined;
}): ImageItemExtra | "" {
  if (inactiveStatus === undefined && fontSize === undefined) return "";
  return {
    image: {
      ...(inactiveStatus !== undefined && { inactiveStatus }),
      ...(fontSize !== undefined && { fontSize }),
    },
  };
}
