import { Type } from "typebox";
import { IMAGE_TEXT_RULES } from "./image-text";

export const IMAGE_FONT_SIZE_SCHEMA = Type.Integer({ minimum: IMAGE_TEXT_RULES.minimumFontSize });
