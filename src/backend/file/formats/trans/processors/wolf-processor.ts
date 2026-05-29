import type { ItemTextType } from "../../../../../domain/item";
import {
  BLACKLIST_EXTENSIONS,
  has_color_block_tag,
  NoneTransProcessor,
  string_array,
  to_mutable_record,
  type ApiJsonRecord,
} from "../trans-processor";

/**
 * WOLF .trans 使用地址白名单/黑名单和数据库屏蔽文本集合
 */
export class WolfTransProcessor extends NoneTransProcessor {
  public override readonly text_type: ItemTextType = "WOLF";

  private static readonly WHITELIST_ADDRESS = [
    /\/Database\/stringArgs\/0$/iu, // 数据库第 0 字符串参数通常是显示文本
    /\/CommonEvent\/stringArgs\/\d*[1-9]\d*$/iu, // 公共事件非 0 字符串参数通常是显示文本
    /\/CommonEventByName\/stringArgs\/\d*[1-9]\d*$/iu, // 按名称引用公共事件时保留同一非 0 规则
    /\/Message\/stringArgs\/\d+$/iu, // 对话消息参数是玩家可见正文
    /\/Picture\/stringArgs\/\d+$/iu, // 图片显示命令可含屏幕文字
    /\/Choices\/stringArgs\/\d+$/iu, // 选项文本是玩家可见正文
    /\/SetString\/stringArgs\/\d+$/iu, // 字符串赋值可承载后续显示文本
    /\/StringCondition\/stringArgs\/\d+$/iu, // 字符串条件可承载可见分支文本
  ] as const;

  private static readonly BLACKLIST_ADDRESS = [
    /\/Database\/stringArgs\/\d*[1-9]\d*$/iu, // 数据库非 0 字符串参数多为内部配置值
    /\/CommonEvent\/stringArgs\/0$/iu, // 公共事件第 0 字符串参数通常是命令名或内部标识
    /\/CommonEventByName\/stringArgs\/0$/iu, // 按名称引用公共事件时第 0 参数同样视为内部标识
    /\/name$/iu, // 名称字段多为编辑器或资源标识
    /\/description$/iu, // 描述字段多为编辑器备注
    /\/Comment\/stringArgs\//iu, // 注释命令不进入翻译
    /\/DebugMessage\/stringArgs\//iu, // 调试消息不进入翻译
  ] as const;

  private block_text = new Set<string>();

  /**
   * 读取前根据整个 project 生成被数据库地址遮蔽的文本集合
   */
  public override pre_process(): void {
    this.block_text = this.generate_block_text(this.project);
  }

  /**
   * 写回前重新生成屏蔽集合，避免原始 project 被外部修改后缓存过期
   */
  public override post_process(): void {
    this.block_text = this.generate_block_text(this.project);
  }

  /**
   * WOLF 先应用白名单，再应用黑名单、色标、common 路径和屏蔽文本
   */
  public override filter(
    src: string,
    _path_key: string,
    tag: string[],
    context: string[],
  ): boolean[] {
    const length = context.length > 0 ? context.length : 1;
    if (BLACKLIST_EXTENSIONS.some((extension) => src.includes(extension))) {
      return Array.from({ length }, () => true);
    }

    if (context.length === 0) {
      return [has_color_block_tag(tag)];
    }

    return context.map((address) => {
      if (WolfTransProcessor.WHITELIST_ADDRESS.some((rule) => rule.test(address))) {
        return false;
      }
      if (WolfTransProcessor.BLACKLIST_ADDRESS.some((rule) => rule.test(address))) {
        return true;
      }
      if (has_color_block_tag(tag)) {
        return true;
      }
      if (/^common\//iu.test(address)) {
        return true;
      }
      if (
        /DataBase\.json\/types\/\d+\/data\/\d+\/data\/\d+\/value/iu.test(address) &&
        this.block_text.has(src)
      ) {
        return true;
      }
      return false;
    });
  }

  /**
   * 从 WOLF 数据库 stringArgs 非 0 项收集应屏蔽文本，对齐旧 generate_block_text
   */
  private generate_block_text(project: ApiJsonRecord): Set<string> {
    const result = new Set<string>();
    const files = to_mutable_record(project["files"]);
    for (const entry_raw of Object.values(files)) {
      const entry = to_mutable_record(entry_raw);
      const data_list = Array.isArray(entry["data"]) ? entry["data"] : [];
      const context_list = Array.isArray(entry["context"]) ? entry["context"] : [];
      const max_length = Math.max(data_list.length, context_list.length);
      for (let index = 0; index < max_length; index += 1) {
        const data_items = string_array(data_list[index]);
        const context_items = string_array(context_list[index]);
        if (data_items.length === 0) {
          continue;
        }
        if (/\/Database\/stringArgs\/\d*[1-9]\d*$/iu.test(context_items.join("\n"))) {
          result.add(data_items[0] ?? "");
        }
      }
    }
    result.delete("");
    return result;
  }
}
