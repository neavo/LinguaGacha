import JSZip from "jszip";
import { type Item, create_item } from "../../../domain/item";
import { read_json_record, type JsonValue } from "../../../domain/json";
import type { ProjectDatabase, ProjectDatabaseWrite } from "../../database/database-operations";
import { EpubAst, read_epub_extra } from "../../file/epub/epub-ast";
import { replace_project_file_items } from "./project-file-item-replacement";

/**
 * 迁移背景：
 * 旧 EPUB 将去注音正文放在 `ruby_clean_candidate`，当前解析器直接输出正文和 AST 定位。
 * 打开旧工程需要把候选条目转换为 `block_text`，让翻译与导出消费同一份正文。
 *
 * 生效场景：
 * 候选含 `cleaned_src` 或 `cleaned_digest` 时，直接读取固化原资产，按文档路径和原块路径匹配。
 * 核验使用历史正文口径，使迁移独立于当前导入的条目发现和排序。
 * 正文优先于摘要参与核验。同一原块只允许匹配一次，整份文件验证通过后才生成替换写入。
 * 候选条目继承现有 `Item` 字段并更新正文及 `extra_field`。提交时重读集合，保留前序迁移结果。
 *
 * 不处理范围：
 * 原资产缺失、解析失败或任一候选不匹配时，该文件保留旧条目。新发现的正文留给重新导入。
 * 条目沿用当前 `Item` 投影，未知顶层字段会被舍弃。
 */
export class EpubRubyBlockTextMigration {
  private readonly ast = new EpubAst(); // 复用路径解析与历史正文算法，不依赖新导入结果。

  /**
   * `database` 是 `.lg` 唯一读写入口。本类只读取快照并生成类型化写入。
   */
  public constructor(private readonly database: Pick<ProjectDatabase, "read_asset_content">) {}

  /**
   * 按原资产核验 `ruby_clean_candidate`，生成整文件替换写入。
   */
  public async build_writes(
    project_path: string,
    raw_items: readonly JsonValue[],
  ): Promise<ProjectDatabaseWrite[]> {
    const items_by_path = new Map<string, Item[]>(); // 保留同文件全部条目，迁移时只替换旧候选。
    for (const value of raw_items) {
      if (read_json_record(value)["file_type"] !== "EPUB") continue;
      const item = create_item(value);
      const items = items_by_path.get(item.file_path) ?? [];
      items.push(item);
      items_by_path.set(item.file_path, items);
    }

    const replacements = new Map<string, JsonValue[]>(); // 只收录整文件核验通过的替换集合。
    for (const [file_path, old_file_items] of items_by_path) {
      if (!old_file_items.some((item) => this.has_legacy_ruby_candidate(item))) continue;
      const asset_content = await this.database.read_asset_content(project_path, file_path);
      if (asset_content === null) {
        continue;
      }
      try {
        const merged_items = await this.merge_file_items(asset_content, old_file_items);
        if (merged_items !== null) replacements.set(file_path, merged_items);
      } catch {
        // 原资产无法解析时保留该文件的旧条目，避免丢失已有译文。
        continue;
      }
    }

    if (replacements.size === 0) {
      return [];
    }

    return [
      (database) => {
        const latest_items = database.get_all_items(project_path); // 保留前序迁移在当前事务中的写入。
        database.set_items(project_path, replace_project_file_items(latest_items, replacements));
        database.bump_section_revisions(project_path, ["items"]);
      },
    ];
  }

  /**
   * 旧候选字段是唯一触发条件，避免误改仍然有效的普通 EPUB 项。
   */
  private has_legacy_ruby_candidate(item: Item): boolean {
    const epub = read_epub_extra(item);
    const candidate = read_json_record(epub?.["ruby_clean_candidate"]);
    return (
      typeof candidate["cleaned_src"] === "string" ||
      typeof candidate["cleaned_digest"] === "string"
    );
  }

  /** 直接定位历史块，整份文件核验完成后才提交候选替换。 */
  private async merge_file_items(content: Uint8Array, old_items: Item[]): Promise<Item[] | null> {
    const zip = await JSZip.loadAsync(content);
    const documents = new Map<string, ReturnType<EpubAst["parse_xhtml_or_html"]>>(); // 同文件的候选共用原稿解析结果。
    const matched = new Set<string>(); // 同一历史块只能继承一份译文。
    const merged: Item[] = [];
    for (const old of old_items) {
      if (!this.has_legacy_ruby_candidate(old)) {
        merged.push(old);
        continue;
      }
      const epub = read_epub_extra(old)!;
      const candidate = read_json_record(epub["ruby_clean_candidate"]);
      const doc_path = epub["doc_path"] ?? old.tag;
      const block_path = candidate["block_path"] ?? epub["block_path"];
      if (typeof doc_path !== "string" || typeof block_path !== "string") return null;
      const key = JSON.stringify([doc_path, block_path]);
      if (matched.has(key)) return null;
      let root = documents.get(doc_path);
      if (root === undefined) {
        const raw = await zip.file(doc_path)?.async("uint8array");
        if (raw === undefined) return null;
        root = this.ast.parse_xhtml_or_html(raw);
        documents.set(doc_path, root);
      }
      const block = this.ast.find_by_path(root, block_path);
      if (block === null || !this.ast.has_ruby_descendant(block)) return null;
      const src = this.ast.build_canonical_block_text(block);
      const src_digest = this.ast.sha1_hex(src);
      // 正文存在时必须匹配正文，旧摘要只能在正文缺失时使用。
      const matches =
        typeof candidate["cleaned_src"] === "string"
          ? candidate["cleaned_src"] === src
          : candidate["cleaned_digest"] === src_digest;
      if (!matches) return null;
      matched.add(key);
      merged.push({
        ...old,
        src,
        extra_field: {
          ...read_json_record(old.extra_field),
          epub: {
            mode: "block_text",
            doc_path,
            block_path,
            src_digest,
            is_nav: epub["is_nav"] === true || this.ast.is_nav_page(root),
          },
        },
      });
    }
    return merged;
  }
}
