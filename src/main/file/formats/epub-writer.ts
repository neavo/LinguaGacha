import fs from "node:fs";
import path from "node:path";

import render from "dom-serializer";
import { Element, isTag, Text, type ChildNode } from "domhandler";
import JSZip from "jszip";

import type { ApiJsonValue } from "../../api/api-types";
import { Item, read_json_record } from "../../../base/item";
import type { FileFormatServiceConfig } from "./file-format-shared";
import { EpubAst, read_epub_extra } from "./epub-ast";

/**
 * 导出写回会移除竖排样式。
 */
const CSS_VERTICAL_WRITING_PATTERN = /[^;\s]*writing-mode\s*:\s*vertical-rl;*/giu;

/**
 * 顺序写回只处理这些块级标签，避免在内联节点中错位替换。
 */
const EPUB_LEGACY_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "li", "td"]);

/**
 * EPUB 写回器，优先使用 AST 定位，缺少 parts 时回退顺序写回。
 */
export class EpubWriter {
  /**
   * AST 工具集中提供路径、slot、解析和清洗能力，写回器不重复实现 DOM 细节。
   */
  private readonly ast = new EpubAst();

  /**
   * 写回策略依赖导出配置，尤其是双语去重和目标语言路径规则。
   */
  public constructor(private readonly config: FileFormatServiceConfig) {}

  /**
   * 只有带 parts 定位的条目才能走 AST 写回，缺少定位时走顺序兼容写回。
   */
  public has_epub_ast_metadata(item: Item): boolean {
    const epub = read_epub_extra(item);
    const parts = epub?.["parts"];
    return Array.isArray(parts) && parts.length > 0;
  }

  /**
   * 根据条目元数据选择 AST 或顺序写回路径，保证项目能导出。
   */
  public async build_epub(
    original_epub_bytes: Uint8Array,
    items: Item[],
    out_path: string,
    bilingual: boolean,
  ): Promise<void> {
    const normalized_items = items.map((item) => Item.from_json(item));
    const use_ast = normalized_items.every((item) => this.has_epub_ast_metadata(item));
    if (use_ast) {
      await this.build_epub_ast(original_epub_bytes, normalized_items, out_path, bilingual);
      return;
    }
    await this.build_epub_legacy(original_epub_bytes, normalized_items, out_path, bilingual);
  }

  /**
   * AST 写回按 EPUB 内文档聚合条目，逐文件应用 slot 级替换并保留其它资源。
   */
  private async build_epub_ast(
    original_epub_bytes: Uint8Array,
    items: Item[],
    out_path: string,
    bilingual: boolean,
  ): Promise<void> {
    const by_doc = new Map<string, Item[]>();
    for (const item of items.filter((candidate) => candidate.file_type === "EPUB")) {
      const epub = read_epub_extra(item);
      if (epub === null) {
        continue;
      }
      const doc_path = String(epub["doc_path"] ?? item.tag ?? "");
      if (doc_path === "") {
        continue;
      }
      const bucket = by_doc.get(doc_path) ?? [];
      bucket.push(item);
      by_doc.set(doc_path, bucket);
    }
    for (const doc_items of by_doc.values()) {
      doc_items.sort((left, right) => left.row - right.row);
    }

    fs.mkdirSync(path.dirname(out_path), { recursive: true });
    const source_zip = await JSZip.loadAsync(original_epub_bytes);
    const output_zip = new JSZip();
    const opf_title_sync_pair = await this.resolve_opf_title_sync_pair(
      source_zip,
      by_doc,
      bilingual,
    );

    for (const name of Object.keys(source_zip.files)) {
      const file = source_zip.file(name);
      if (file === null) {
        continue;
      }
      const raw = await file.async("uint8array");
      const lower = name.toLowerCase();
      const is_html_document = this.ast.is_html_document_path(name);

      if (lower.endsWith(".opf")) {
        await this.write_opf_doc(output_zip, name, raw, by_doc.get(name) ?? [], bilingual);
        continue;
      }
      if (lower.endsWith(".css")) {
        output_zip.file(name, this.sanitize_css(this.ast.decode_bytes(raw)));
        continue;
      }
      if (
        (is_html_document || lower.endsWith(".ncx")) &&
        (by_doc.has(name) || (opf_title_sync_pair !== null && is_html_document))
      ) {
        await this.write_ast_content_doc(
          output_zip,
          name,
          raw,
          by_doc.get(name) ?? [],
          bilingual,
          opf_title_sync_pair,
        );
        continue;
      }
      output_zip.file(name, raw);
    }

    await this.write_zip_file(output_zip, out_path);
  }

  /**
   * OPF 标题成功写回后同步 XHTML title，避免书名与页面标题不一致。
   */
  private async resolve_opf_title_sync_pair(
    source_zip: JSZip,
    by_doc: Map<string, Item[]>,
    bilingual: boolean,
  ): Promise<[string, string] | null> {
    const candidate = this.extract_opf_title_sync_pair(by_doc);
    if (candidate === null) {
      return null;
    }
    for (const [doc_path, doc_items] of by_doc.entries()) {
      if (!doc_path.toLowerCase().endsWith(".opf") || doc_items.length === 0) {
        continue;
      }
      const file = source_zip.file(doc_path);
      if (file === null) {
        continue;
      }
      try {
        const root = this.ast.parse_opf_xml(await file.async("uint8array"));
        const [applied] = this.apply_items_to_tree(root, doc_path, doc_items, bilingual);
        if (applied > 0) {
          return candidate;
        }
      } catch {
        // 预检查失败只表示不触发 XHTML 标题同步，不影响正文写回。
      }
    }
    return null;
  }

  /**
   * 从 OPF 元数据条目提取单行标题替换对，只有真实译文才参与同步。
   */
  private extract_opf_title_sync_pair(by_doc: Map<string, Item[]>): [string, string] | null {
    for (const [doc_path, doc_items] of by_doc.entries()) {
      if (!doc_path.toLowerCase().endsWith(".opf")) {
        continue;
      }
      for (const item of doc_items) {
        const epub = read_epub_extra(item);
        if (
          epub?.["is_opf_metadata"] !== true ||
          epub["metadata_tag"] !== "dc:title" ||
          item.dst === "" ||
          item.dst === item.src
        ) {
          continue;
        }
        const src_lines = item.src.split("\n");
        const dst_lines = item.dst.split("\n");
        if (src_lines.length === 1 && dst_lines.length === 1) {
          return [src_lines[0] as string, dst_lines[0] as string];
        }
      }
    }
    return null;
  }

  /**
   * OPF 写回失败时回退原文加清洗，元数据文件不能阻塞正文导出。
   */
  private async write_opf_doc(
    output_zip: JSZip,
    name: string,
    raw: Uint8Array,
    doc_items: Item[],
    bilingual: boolean,
  ): Promise<void> {
    if (doc_items.length === 0) {
      output_zip.file(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
      return;
    }
    const has_real_translation = doc_items.some((item) => item.dst !== "" && item.dst !== item.src);
    if (!has_real_translation) {
      output_zip.file(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
      return;
    }
    try {
      const root = this.ast.parse_opf_xml(raw);
      const [applied] = this.apply_items_to_tree(root, name, doc_items, bilingual);
      const text = applied > 0 ? this.serialize_doc(root) : this.ast.decode_bytes(raw);
      output_zip.file(name, this.sanitize_opf(text));
    } catch {
      output_zip.file(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
    }
  }

  /**
   * XHTML/NCX 写回在 AST 定位失败时保留原始文档，避免损坏 EPUB 包。
   */
  private async write_ast_content_doc(
    output_zip: JSZip,
    name: string,
    raw: Uint8Array,
    doc_items: Item[],
    bilingual: boolean,
    opf_title_sync_pair: [string, string] | null,
  ): Promise<void> {
    try {
      const root = name.toLowerCase().endsWith(".ncx")
        ? this.ast.parse_ncx_xml(raw)
        : this.ast.parse_xhtml_or_html(raw);
      let changed = false;
      if (doc_items.length > 0) {
        this.apply_items_to_tree(root, name, doc_items, bilingual);
        changed = true;
      }
      if (opf_title_sync_pair !== null && this.ast.is_html_document_path(name)) {
        const [src_title, dst_title] = opf_title_sync_pair;
        if (this.sync_xhtml_title(root, src_title, dst_title)) {
          changed = true;
        }
      }
      output_zip.file(name, changed ? this.serialize_doc(root) : raw);
    } catch {
      output_zip.file(name, raw);
    }
  }

  /**
   * 将译文应用到 DOM slot，并在双语模式下收集需要插入的原文块克隆。
   */
  private apply_items_to_tree(
    root: Element,
    doc_path: string,
    items: Item[],
    bilingual: boolean,
  ): [number, number] {
    let applied = 0;
    let skipped = 0;
    const doc_lower = doc_path.toLowerCase();
    const is_ncx = doc_lower.endsWith(".ncx") || this.ast.local_name(root.name) === "ncx";
    const is_opf =
      doc_lower.endsWith(".opf") || this.ast.local_name(root.name).toLowerCase() === "package";
    const is_nav_flag = items.some((item) => read_epub_extra(item)?.["is_nav"] === true);
    const allow_bilingual_insert =
      bilingual && !this.ast.is_nav_page(root) && !is_nav_flag && !is_ncx && !is_opf;
    const elem_by_path = this.ast.build_elem_by_path(root);
    const block_refs: Array<[Element, Element]> = [];
    const inserted_block_paths = new Set<string>();

    for (const item of items) {
      const epub = read_epub_extra(item);
      const parts = epub?.["parts"];
      const src_digest = epub?.["src_digest"];
      if (
        epub === null ||
        !Array.isArray(parts) ||
        parts.length === 0 ||
        typeof src_digest !== "string" ||
        src_digest === ""
      ) {
        skipped += 1;
        continue;
      }

      const item_dst = Item.from_json(item).effective_dst();
      const dst_lines = item_dst.split("\n");
      if (dst_lines.length !== parts.length) {
        if (
          this.apply_ruby_clean_candidate_to_block(
            root,
            elem_by_path,
            epub,
            item,
            item_dst,
            allow_bilingual_insert,
            block_refs,
            inserted_block_paths,
          )
        ) {
          applied += 1;
        } else {
          skipped += 1;
        }
        continue;
      }

      const current_texts: string[] = [];
      const resolved: Array<[string, Element]> = [];
      let ok = true;
      for (const part of parts) {
        const part_record = read_json_record(part);
        const slot = String(part_record["slot"] ?? "");
        const elem_path = String(part_record["path"] ?? "");
        if (slot !== "text" && slot !== "tail") {
          ok = false;
          break;
        }
        const elem = elem_by_path.get(elem_path) ?? this.ast.find_by_path(root, elem_path);
        if (elem === null) {
          ok = false;
          break;
        }
        current_texts.push(
          this.ast.normalize_slot_text(
            slot === "text" ? this.ast.read_text_slot(elem) : this.ast.read_tail_slot(elem),
          ),
        );
        resolved.push([slot, elem]);
      }

      if (!ok || this.ast.sha1_hex_with_null_separator(current_texts) !== src_digest) {
        skipped += 1;
        continue;
      }

      if (
        allow_bilingual_insert &&
        !(this.config.deduplication_in_bilingual === true && item.src === item_dst)
      ) {
        const block_path = typeof epub["block_path"] === "string" ? epub["block_path"] : "";
        this.collect_bilingual_block_ref(
          root,
          elem_by_path,
          block_path,
          block_refs,
          inserted_block_paths,
        );
      }

      resolved.forEach(([slot, elem], index) => {
        const safe_text = this.ast.sanitize_xml_text(dst_lines[index] ?? "");
        if (slot === "text") {
          this.ast.write_text_slot(elem, safe_text);
        } else {
          this.ast.write_tail_slot(elem, safe_text);
        }
      });
      applied += 1;
    }

    if (allow_bilingual_insert) {
      for (const [block, clone] of [...block_refs].reverse()) {
        const parent = block.parent;
        if (!(parent instanceof Element)) {
          continue;
        }
        const style = String(clone.attribs["style"] ?? "").replace(/;+$/u, "");
        clone.attribs["style"] = `${style}${style === "" ? "" : ";"}opacity:0.50;`;
        const index = parent.children.indexOf(block);
        if (index < 0) {
          continue;
        }
        clone.parent = parent;
        parent.children.splice(index, 0, clone);
        clone.next = block;
        clone.prev = index > 0 ? (parent.children[index - 1] as ChildNode) : null;
        block.prev = clone;
        clone.children.push(new Text(""));
      }
    }

    return [applied, skipped];
  }

  /**
   * ruby 清洗候选用于处理带注音的文本块，slot 数量变化时仍能按块安全写回。
   */
  private apply_ruby_clean_candidate_to_block(
    root: Element,
    elem_by_path: Map<string, Element>,
    epub: Record<string, ApiJsonValue>,
    item: Item,
    item_dst: string,
    allow_bilingual_insert: boolean,
    block_refs: Array<[Element, Element]>,
    inserted_block_paths: Set<string>,
  ): boolean {
    const candidate = read_json_record(epub["ruby_clean_candidate"]);
    const block_path_candidate = String(candidate["block_path"] ?? epub["block_path"] ?? "");
    const cleaned_digest = String(candidate["cleaned_digest"] ?? "");
    if (block_path_candidate === "" || cleaned_digest === "") {
      return false;
    }
    const block_elem =
      elem_by_path.get(block_path_candidate) ?? this.ast.find_by_path(root, block_path_candidate);
    if (block_elem === null) {
      return false;
    }
    const current_cleaned_src = this.ast.collect_visible_text_without_skipped_subtrees(block_elem);
    if (this.ast.sha1_hex(current_cleaned_src) !== cleaned_digest) {
      return false;
    }
    if (
      allow_bilingual_insert &&
      !(this.config.deduplication_in_bilingual === true && item.src === item_dst)
    ) {
      this.collect_bilingual_block_ref(
        root,
        elem_by_path,
        block_path_candidate,
        block_refs,
        inserted_block_paths,
      );
    }
    block_elem.children = [new Text(this.ast.sanitize_xml_text(item_dst))];
    block_elem.children[0].parent = block_elem;
    return true;
  }

  /**
   * 双语插入按 block_path 去重，避免同一原文块被多个 slot 重复克隆。
   */
  private collect_bilingual_block_ref(
    root: Element,
    elem_by_path: Map<string, Element>,
    block_path: string,
    block_refs: Array<[Element, Element]>,
    inserted_block_paths: Set<string>,
  ): void {
    if (block_path === "" || inserted_block_paths.has(block_path)) {
      return;
    }
    const block_elem = elem_by_path.get(block_path) ?? this.ast.find_by_path(root, block_path);
    if (block_elem === null) {
      return;
    }
    block_refs.push([block_elem, this.ast.clone_element(block_elem)]);
    inserted_block_paths.add(block_path);
  }

  /**
   * OPF 书名变更时同步 XHTML head/title，只改完全匹配原标题的节点。
   */
  private sync_xhtml_title(root: Element, src_title: string, dst_title: string): boolean {
    let changed = false;
    for (const head of this.ast.find_descendants(root, "head")) {
      for (const title_elem of this.ast.iter_children_elements(head)) {
        if (this.ast.local_name(title_elem.name) !== "title") {
          continue;
        }
        const current_text = this.ast.normalize_slot_text(this.ast.read_text_slot(title_elem));
        if (current_text !== src_title) {
          continue;
        }
        this.ast.write_text_slot(title_elem, this.ast.sanitize_xml_text(dst_title));
        changed = true;
      }
    }
    return changed;
  }

  /**
   * 顺序写回使用顺序替换策略，服务缺少 AST 元数据的项目。
   */
  private async build_epub_legacy(
    original_epub_bytes: Uint8Array,
    items: Item[],
    out_path: string,
    bilingual: boolean,
  ): Promise<void> {
    const sorted_items = items
      .filter((item) => item.file_type === "EPUB")
      .map((item) => Item.from_json(item))
      .sort((left, right) => left.row - right.row);
    const tag_group = new Map<string, Item[]>();
    for (const item of sorted_items) {
      const bucket = tag_group.get(item.tag) ?? [];
      bucket.push(item);
      tag_group.set(item.tag, bucket);
    }

    fs.mkdirSync(path.dirname(out_path), { recursive: true });
    const source_zip = await JSZip.loadAsync(original_epub_bytes);
    const output_zip = new JSZip();
    for (const name of Object.keys(source_zip.files)) {
      const file = source_zip.file(name);
      if (file === null) {
        continue;
      }
      const raw = await file.async("uint8array");
      const lower = name.toLowerCase();
      if (lower.endsWith(".css")) {
        output_zip.file(name, this.sanitize_css(this.ast.decode_bytes(raw)));
      } else if (lower.endsWith(".opf")) {
        output_zip.file(name, this.sanitize_opf(this.ast.decode_bytes(raw)));
      } else if (lower.endsWith(".ncx")) {
        output_zip.file(name, this.process_legacy_ncx(raw, tag_group.get(name) ?? []));
      } else if (this.ast.is_html_document_path(name)) {
        output_zip.file(name, this.process_legacy_html(raw, tag_group.get(name) ?? [], bilingual));
      } else {
        output_zip.file(name, raw);
      }
    }
    await this.write_zip_file(output_zip, out_path);
  }

  /**
   * NCX 顺序写回按 text 节点顺序消费条目。
   */
  private process_legacy_ncx(raw: Uint8Array, target_items: Item[]): string {
    const root = this.ast.parse_ncx_xml(raw);
    let item_index = 0;
    for (const text_elem of this.ast.find_descendants(root, "text")) {
      if (this.ast.read_text_slot(text_elem).trim() === "" || item_index >= target_items.length) {
        continue;
      }
      this.ast.write_text_slot(
        text_elem,
        Item.from_json(target_items[item_index] as Item).effective_dst(),
      );
      item_index += 1;
    }
    return this.serialize_doc(root);
  }

  /**
   * HTML legacy 写回按块级标签顺序替换，并在双语模式插入原文克隆。
   */
  private process_legacy_html(raw: Uint8Array, target_items: Item[], bilingual: boolean): string {
    const root = this.ast.parse_xhtml_or_html(raw);
    const is_nav_page = this.ast.is_nav_page(root);
    let item_index = 0;
    for (const dom of this.ast.flatten_elements(root)) {
      this.remove_vertical_style(dom);
      if (!EPUB_LEGACY_TAGS.has(this.ast.local_name(dom.name))) {
        continue;
      }
      if (
        this.collect_text_content(dom).trim() === "" ||
        this.has_legacy_tag_descendant(dom) ||
        item_index >= target_items.length
      ) {
        continue;
      }
      const item = target_items[item_index] as Item;
      const item_dst = Item.from_json(item).effective_dst();
      if (
        bilingual &&
        !is_nav_page &&
        !(this.config.deduplication_in_bilingual === true && item.src === item_dst)
      ) {
        const parent = dom.parent;
        if (parent instanceof Element) {
          const clone = this.ast.clone_element(dom);
          const style = String(clone.attribs["style"] ?? "").replace(/;+$/u, "");
          clone.attribs["style"] = `${style}${style === "" ? "" : ";"}opacity:0.50;`;
          const index = parent.children.indexOf(dom);
          clone.parent = parent;
          parent.children.splice(index, 0, new Text("\n"), clone);
        }
      }
      const serialized = this.serialize_fragment(dom);
      if (serialized.includes(item.src)) {
        const replaced = this.ast.parse_html_document(serialized.replace(item.src, () => item_dst));
        this.replace_element(dom, replaced);
      } else if (!is_nav_page) {
        dom.children = [new Text(item_dst)];
        dom.children[0].parent = dom;
      }
      item_index += 1;
    }
    return this.serialize_doc(root);
  }

  /**
   * 导出统一移除竖排 class/style，避免翻译后横排文本仍受原排版约束。
   */
  private remove_vertical_style(dom: Element): void {
    const class_attr = dom.attribs["class"];
    if (class_attr !== undefined) {
      const cleaned = class_attr.replace(/[hv]rtl|[hv]ltr/giu, "").trim();
      if (cleaned === "") {
        delete dom.attribs["class"];
      } else {
        dom.attribs["class"] = cleaned.split(/\s+/u).join(" ");
      }
    }
    const style_attr = dom.attribs["style"];
    if (style_attr !== undefined) {
      const cleaned = style_attr.replace(CSS_VERTICAL_WRITING_PATTERN, "").trim();
      if (cleaned === "") {
        delete dom.attribs["style"];
      } else {
        dom.attribs["style"] = cleaned;
      }
    }
  }

  /**
   * 顺序写回块不能包含另一个候选块，否则替换会同时命中父子节点。
   */
  private has_legacy_tag_descendant(dom: Element): boolean {
    return this.ast
      .flatten_elements(dom)
      .slice(1)
      .some((elem) => EPUB_LEGACY_TAGS.has(this.ast.local_name(elem.name)));
  }

  /**
   * 递归收集元素可见文本，供空文本过滤和字符串替换判断使用。
   */
  private collect_text_content(elem: Element): string {
    const parts: string[] = [];
    for (const child of elem.children) {
      if (isTag(child)) {
        parts.push(this.collect_text_content(child));
      } else if (child instanceof Text) {
        parts.push(child.data);
      }
    }
    return parts.join("");
  }

  /**
   * 用解析后的替换片段接管原节点位置，保持父级 children 链接关系稳定。
   */
  private replace_element(target: Element, replacement: Element): void {
    const parent = target.parent;
    if (!(parent instanceof Element)) {
      return;
    }
    const index = parent.children.indexOf(target);
    if (index < 0) {
      return;
    }
    replacement.parent = parent;
    parent.children.splice(index, 1, replacement);
  }

  /**
   * OPF 清洗去掉翻页方向属性。
   */
  private sanitize_opf(text: string): string {
    return text.replace('page-progression-direction="rtl"', "");
  }

  /**
   * CSS 清洗移除竖排样式。
   */
  private sanitize_css(text: string): string {
    return text.replace(CSS_VERTICAL_WRITING_PATTERN, "");
  }

  /**
   * 整文档序列化按根节点判断 XML/HTML 模式，避免纯 HTML 被强加 XML 声明。
   */
  private serialize_doc(root: Element): string {
    const is_plain_html = root.name.toLowerCase() === "html" && !root.name.includes(":");
    const rendered = render(root, {
      decodeEntities: true,
      emptyAttrs: false,
      encodeEntities: "utf8",
      selfClosingTags: true,
      xmlMode: !is_plain_html,
    });
    return is_plain_html ? rendered : `<?xml version="1.0" encoding="utf-8"?>\n${rendered}`;
  }

  /**
   * 片段序列化固定使用 HTML 模式，供 legacy 字符串替换后的重解析使用。
   */
  private serialize_fragment(root: Element): string {
    return render(root, {
      decodeEntities: true,
      emptyAttrs: false,
      encodeEntities: "utf8",
      selfClosingTags: true,
      xmlMode: false,
    });
  }

  /**
   * EPUB 输出沿用 STORE 压缩，避免重压缩带来不必要的二进制差异。
   */
  private async write_zip_file(zip_file: JSZip, out_path: string): Promise<void> {
    const content = await zip_file.generateAsync({ compression: "STORE", type: "nodebuffer" });
    await fs.promises.writeFile(out_path, content);
  }
}
