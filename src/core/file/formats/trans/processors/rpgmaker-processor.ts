import type { ItemTextType } from "../../../../../base/item";
import { BLACKLIST_EXTENSIONS, has_color_block_tag, NoneTransProcessor } from "../trans-processor";

/**
 * RPG Maker .trans 在默认过滤上叠加路径和地址黑名单
 */
export class RPGMakerTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "RPGMAKER";

  private static readonly BLACKLIST_PATH = [/\.js$/iu]; // JS 插件脚本文件整体不进入翻译

  private static readonly BLACKLIST_ADDRESS = [
    /^(?=.*MZ Plugin Command)(?!.*text).*/iu, // MZ 插件命令里只有 text 字段可能是正文
    /filename/iu, // 文件名字段通常是资源路径或资源 ID
    /\/events\/\d+\/name/iu, // 地图事件名称不作为玩家可见正文
    /Tilesets\/\d+\/name/iu, // 图块集名称属于编辑器数据
    /MapInfos\/\d+\/name/iu, // 地图信息名称属于编辑器数据
    /Animations\/\d+\/name/iu, // 动画名称属于资源管理数据
    /CommonEvents\/\d+\/name/iu, // 公共事件名称属于编辑器数据
  ] as const;

  private cached_path = "";
  private cached_path_blocked = false;

  /**
   * 路径黑名单按 file_key 缓存，地址黑名单逐 context 判断
   */
  public override filter(
    src: string,
    path_key: string,
    tag: string[],
    context: string[],
  ): boolean[] {
    const length = context.length > 0 ? context.length : 1;
    if (BLACKLIST_EXTENSIONS.some((extension) => src.includes(extension))) {
      return Array.from({ length }, () => true);
    }

    if (this.cached_path !== path_key) {
      this.cached_path = path_key;
      this.cached_path_blocked = RPGMakerTransProcessor.BLACKLIST_PATH.some((rule) =>
        rule.test(path_key),
      );
    }
    if (this.cached_path_blocked) {
      return Array.from({ length }, () => true);
    }

    if (context.length === 0) {
      return [has_color_block_tag(tag)];
    }

    return context.map((address) => {
      if (has_color_block_tag(tag)) {
        return true;
      }
      return RPGMakerTransProcessor.BLACKLIST_ADDRESS.some((rule) => rule.test(address));
    });
  }
}
