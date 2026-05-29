import { NoneTransProcessor } from "../trans-processor";
import type { ItemTextType } from "../../../../../domain/item";

/**
 * RENPY .trans 只改变 text_type，过滤逻辑继承 NONE
 */
export class RenPyTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "RENPY";
}
