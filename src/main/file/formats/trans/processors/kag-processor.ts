import { NoneTransProcessor } from "../trans-processor";
import type { ItemTextType } from "../../../../../base/item";

/**
 * KAG .trans 只改变 text_type，过滤逻辑继承 NONE
 */
export class KagTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "KAG";
}
