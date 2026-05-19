import crypto from "node:crypto";
import posix from "node:path/posix";

import { parseDocument } from "htmlparser2";
import {
  cloneNode,
  Document,
  Element,
  isTag,
  isText,
  Text,
  type AnyNode,
  type ChildNode,
} from "domhandler";
import { decodeHTML } from "entities";
import JSZip from "jszip";

import type { ApiJsonValue } from "../../../api/api-types";
import { Item, read_json_record } from "../../../../base/item";
import { FileParseFailedError, InvalidFileStructureError } from "../../../../shared/error";

/**
 * EPUB slot 定位引用，path 指向元素，slot 区分元素首段文本和元素后的 tail 文本
 */
export interface EpubPartRef {
  slot: "text" | "tail";
  path: string;
}

/**
 * OPF 解析产物集中记录 spine/nav/ncx/title 路径，后续抽取不再重复扫描 manifest
 */
export interface EpubPackageInfo {
  opf_path: string;
  opf_dir: string;
  opf_version_major: number;
  spine_paths: string[];
  nav_path: string | null;
  ncx_path: string | null;
  opf_title_path: string | null;
  opf_title_text: string | null;
}

/**
 * 普通 EPUB 块保持 slot 级定位，逐行译文可精确写回原 DOM 位置
 */
export interface EpubSlotPerLineDocumentUnit {
  mode: "slot_per_line";
  block_path: string;
  slots: Array<[EpubPartRef, string]>;
}

/**
 * 含结构化 ruby 的 EPUB 块使用整块正文投影，避免 rt 注音进入应用文本生命周期
 */
export interface EpubBlockTextDocumentUnit {
  mode: "block_text";
  block_path: string;
  text: string;
}

/**
 * 单个可翻译块的抽象单位，mode 决定后续 item metadata 与 writer 写回策略
 */
export type EpubDocumentUnit = EpubSlotPerLineDocumentUnit | EpubBlockTextDocumentUnit;

/**
 * 元素路径片段使用本地名和同名序号，规避命名空间前缀变化造成的定位漂移
 */
interface EpubPathSeg {
  name: string;
  pos: number;
}

/**
 * 普通 spine 文档行号按百万分段，给每个文档内条目保留稳定排序空间
 */
const ROW_MULTIPLIER = 1_000_000;

/**
 * 导航页、OPF 标题和 NCX 使用高位行号段，避免与正文 spine 顺序冲突
 */
const ROW_BASE_NAV = 8_000_000_000;
const ROW_BASE_OPF_TITLE = 8_500_000_000;
const ROW_BASE_NCX = 9_000_000_000;

/**
 * 这些块级标签是翻译条目的主要边界，和旧抽取范围保持一致
 */
const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "div",
  "li",
  "td",
  "th",
  "caption",
  "figcaption",
  "dt",
  "dd",
]);

/**
 * 代码、样式、注音等子树不参与翻译抽取，避免破坏语义或生成不可写回文本
 */
const SKIP_SUBTREE_TAGS = new Set([
  "script",
  "style",
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  "noscript",
  "rt",
]);

/**
 * EPUB 正文常见扩展名统一视为 HTML 文档，供读取和写回路径判断共用
 */
const HTML_DOCUMENT_EXTENSIONS = [".xhtml", ".html", ".htm", ".xhtm"];

/**
 * slot 文本归一化只压缩行内空白，保留跨 slot 换行由条目拼接层控制
 */
const SLOT_INLINE_WHITESPACE_PATTERN = /[\r\n\t]+/gu;
const MULTI_SPACE_PATTERN = /[ ]{2,}/gu;

/**
 * HTML 命名实体和 NCX 裸 ampersand 单独修复，先尽量走 XML 精确解析
 */
const HTML_NAMED_ENTITY_PATTERN = /&([A-Za-z][A-Za-z0-9._:-]*);/gu;
const CDATA_PATTERN = /<!\[CDATA\[.*?\]\]>/gsu;
const NCX_BARE_AMP_PATTERN = /&(?!(?:[A-Za-z][A-Za-z0-9._:-]*|#[0-9]+|#[xX][0-9A-Fa-f]+);)/gu;

/**
 * XML 1.0 文本节点不能写入非法码点，导出前必须过滤以免生成坏包
 */
function is_valid_xml_text_code_point(code_point: number): boolean {
  return (
    code_point === 0x09 ||
    code_point === 0x0a ||
    code_point === 0x0d ||
    (code_point >= 0x20 && code_point <= 0xd7ff) ||
    (code_point >= 0xe000 && code_point <= 0xfffd) ||
    (code_point >= 0x10000 && code_point <= 0x10ffff)
  );
}

/**
 * EPUB AST 抽取器，统一维护 slot_per_line 与 block_text 两种写回协议
 */
export class EpubAst {
  /**
   * 对外暴露行号倍数，测试和迁移代码可复用同一排序协议
   */
  public static readonly ROW_MULTIPLIER = ROW_MULTIPLIER;

  /**
   * 导航页行号基准固定高位，保证排序时位于正文之后
   */
  public static readonly ROW_BASE_NAV = ROW_BASE_NAV;

  /**
   * OPF 标题行号基准固定高位，兼容旧项目元数据条目排序
   */
  public static readonly ROW_BASE_OPF_TITLE = ROW_BASE_OPF_TITLE;

  /**
   * NCX 目录行号基准固定高位，避免与 spine 文档行号重叠
   */
  public static readonly ROW_BASE_NCX = ROW_BASE_NCX;

  /**
   * 归一化 slot 内部空白，避免解析器格式化差异导致 digest 不稳定
   */
  public normalize_slot_text(text: string): string {
    if (
      !text.includes("\r") &&
      !text.includes("\n") &&
      !text.includes("\t") &&
      !text.includes("  ")
    ) {
      return text;
    }
    return text.replace(SLOT_INLINE_WHITESPACE_PATTERN, " ").replace(MULTI_SPACE_PATTERN, " ");
  }

  /**
   * EPUB 内路径统一为 POSIX 斜杠并做 NFC，保证 zip 路径和 metadata 可比对
   */
  public normalize_epub_path(raw_path: string): string {
    return raw_path.replace(/\\/gu, "/").normalize("NFC");
  }

  /**
   * 只把真实 HTML/XHTML 文档纳入正文处理，资源文件保持原样透传
   */
  public is_html_document_path(file_path: string): boolean {
    const lower_path = file_path.toLowerCase();
    return HTML_DOCUMENT_EXTENSIONS.some((ext) => lower_path.endsWith(ext));
  }

  /**
   * href 解析以 OPF 所在目录为基准，匹配 EPUB manifest 的相对路径语义
   */
  public resolve_href(base_dir: string, href: string): string {
    const normalized_href = this.normalize_epub_path(href);
    return posix.normalize(posix.join(base_dir, normalized_href)).replace(/^\.\//u, "");
  }

  /**
   * DOM 标签可能带命名空间前缀或 Clark 记法，定位时只比较本地名
   */
  public local_name(tag_name: string): string {
    const brace_index = tag_name.lastIndexOf("}");
    const without_namespace = brace_index >= 0 ? tag_name.slice(brace_index + 1) : tag_name;
    const colon_index = without_namespace.lastIndexOf(":");
    return colon_index >= 0 ? without_namespace.slice(colon_index + 1) : without_namespace;
  }

  /**
   * 块级候选决定条目边界，过宽会误合并，过窄会破坏双语插入
   */
  public is_block_candidate(elem: Element): boolean {
    return BLOCK_TAGS.has(this.local_name(elem.name));
  }

  /**
   * 子元素迭代统一过滤文本节点，DOM 树遍历只处理可定位元素
   */
  public iter_children_elements(elem: Element | Document): Element[] {
    return elem.children.filter((child): child is Element => isTag(child));
  }

  /**
   * 生成元素和稳定路径的配对列表，路径基于同名子元素序号而非原始索引
   */
  public iter_elem_path_pairs(root: Element): Array<[Element, string]> {
    const pairs: Array<[Element, string]> = [];
    const root_path = `/${this.local_name(root.name)}[1]`;
    const stack: Array<[Element, string]> = [[root, root_path]];
    while (stack.length > 0) {
      const entry = stack.pop();
      if (entry === undefined) {
        continue;
      }
      const [parent, parent_path] = entry;
      pairs.push([parent, parent_path]);

      const counter = new Map<string, number>();
      const child_entries: Array<[Element, string]> = [];
      for (const child of this.iter_children_elements(parent)) {
        const name = this.local_name(child.name);
        const index = (counter.get(name) ?? 0) + 1;
        counter.set(name, index);
        child_entries.push([child, `${parent_path}/${name}[${index}]`]);
      }
      for (const child_entry of child_entries.reverse()) {
        stack.push(child_entry);
      }
    }
    return pairs;
  }

  /**
   * 元素到路径映射用于抽取阶段写入 metadata，路径必须与写回查找规则一致
   */
  public build_elem_path_map(root: Element): Map<Element, string> {
    return new Map(this.iter_elem_path_pairs(root));
  }

  /**
   * 路径到元素映射用于写回快速定位，失败时还可用 find_by_path 再兜底
   */
  public build_elem_by_path(root: Element): Map<string, Element> {
    return new Map(this.iter_elem_path_pairs(root).map(([elem, elem_path]) => [elem_path, elem]));
  }

  /**
   * 按 metadata 路径回找 DOM 元素，命名空间前缀变化不会影响本地名匹配
   */
  public find_by_path(root: Element, elem_path: string): Element | null {
    const segs = this.parse_elem_path(elem_path);
    if (segs.length === 0 || this.local_name(root.name) !== segs[0]?.name) {
      return null;
    }
    let current = root;
    for (const seg of segs.slice(1)) {
      const candidates = this.iter_children_elements(current).filter(
        (child) => this.local_name(child.name) === seg.name,
      );
      if (seg.pos <= 0 || seg.pos > candidates.length) {
        return null;
      }
      current = candidates[seg.pos - 1] as Element;
    }
    return current;
  }

  /**
   * 单文本摘要用于 block_text metadata，保证整块正文投影可校验
   */
  public sha1_hex(text: string): string {
    return crypto.createHash("sha1").update(text, "utf-8").digest("hex");
  }

  /**
   * 多 slot 摘要使用空字节分隔，避免不同 slot 拼接后产生摘要碰撞
   */
  public sha1_hex_with_null_separator(parts: string[]): string {
    const hash = crypto.createHash("sha1");
    parts.forEach((part, index) => {
      if (index > 0) {
        hash.update(Buffer.from([0]));
      }
      hash.update(part, "utf-8");
    });
    return hash.digest("hex");
  }

  /**
   * 读取 EPUB 包并按 OPF spine/nav/ncx 顺序生成可写回的翻译条目
   */
  public async read_from_stream(content: Uint8Array, rel_path: string): Promise<Item[]> {
    const zip_reader = await JSZip.loadAsync(content);
    const opf_path = await this.parse_container_opf_path(zip_reader);
    const pkg = await this.parse_opf(zip_reader, opf_path);
    const items: Item[] = [];

    const opf_title_item = this.extract_item_from_opf_title(rel_path, pkg);
    if (opf_title_item !== null) {
      items.push(opf_title_item);
    }

    const processed_paths = new Set<string>();
    for (const [spine_index, doc_path] of pkg.spine_paths.entries()) {
      if (!this.is_html_document_path(doc_path)) {
        continue;
      }
      const raw = await this.read_zip_bytes(zip_reader, doc_path);
      if (raw === null) {
        continue;
      }
      items.push(
        ...this.extract_items_from_document(
          doc_path,
          raw,
          spine_index,
          rel_path,
          pkg.nav_path === doc_path,
        ),
      );
      processed_paths.add(doc_path);
    }

    if (pkg.nav_path !== null && !processed_paths.has(pkg.nav_path)) {
      if (this.is_html_document_path(pkg.nav_path)) {
        const raw = await this.read_zip_bytes(zip_reader, pkg.nav_path);
        if (raw !== null) {
          items.push(
            ...this.extract_items_from_document(
              pkg.nav_path,
              raw,
              Math.floor(ROW_BASE_NAV / ROW_MULTIPLIER),
              rel_path,
              true,
            ),
          );
          processed_paths.add(pkg.nav_path);
        }
      }
    }

    if (pkg.ncx_path !== null) {
      const raw = await this.read_zip_bytes(zip_reader, pkg.ncx_path);
      if (raw !== null) {
        items.push(...this.extract_items_from_ncx(pkg.ncx_path, raw, rel_path));
      }
    }

    return items;
  }

  /**
   * container.xml 是 EPUB 入口，缺失 OPF rootfile 直接视为坏包
   */
  public async parse_container_opf_path(zip_reader: JSZip): Promise<string> {
    const data = await this.require_zip_text(zip_reader, "META-INF/container.xml");
    const root = this.parse_xml_document(data);
    const rootfiles = this.find_descendants(root, "rootfile");
    for (const rootfile of rootfiles) {
      const full_path = rootfile.attribs["full-path"];
      if (typeof full_path === "string" && full_path !== "") {
        return this.normalize_epub_path(full_path);
      }
    }
    throw new InvalidFileStructureError({
      public_details: { format: "EPUB" },
      diagnostic_context: { entry: "META-INF/container.xml", reason: "missing_opf_rootfile" },
    });
  }

  /**
   * 解析 OPF manifest/spine/nav/ncx/title，后续读取只依赖该包级结构
   */
  public async parse_opf(zip_reader: JSZip, opf_path: string): Promise<EpubPackageInfo> {
    const opf_text = await this.require_zip_text(zip_reader, opf_path);
    const opf_root = this.parse_xml_document(opf_text);
    const version = opf_root.attribs["version"] ?? "2.0";
    const major = Number.parseInt(version.split(".", 1)[0] ?? "2", 10);
    const opf_dir = posix.dirname(opf_path);
    const manifest_items = new Map<
      string,
      { path: string; media_type: string; properties: string }
    >();

    for (const manifest of this.find_descendants(opf_root, "manifest")) {
      for (const item of this.iter_children_elements(manifest)) {
        if (this.local_name(item.name) !== "item") {
          continue;
        }
        const item_id = item.attribs["id"];
        const href = item.attribs["href"];
        if (item_id === undefined || href === undefined) {
          continue;
        }
        manifest_items.set(item_id, {
          path: this.resolve_href(opf_dir, href),
          media_type: item.attribs["media-type"] ?? "",
          properties: item.attribs["properties"] ?? "",
        });
      }
    }

    let nav_path: string | null = null;
    for (const item of manifest_items.values()) {
      if (new Set(item.properties.split(/\s+/u).filter(Boolean)).has("nav")) {
        nav_path = item.path;
        break;
      }
    }

    let ncx_path: string | null = null;
    const spine = this.find_descendants(opf_root, "spine")[0];
    const toc_id = spine?.attribs["toc"];
    if (toc_id !== undefined && manifest_items.has(toc_id)) {
      ncx_path = manifest_items.get(toc_id)?.path ?? null;
    } else {
      for (const item of manifest_items.values()) {
        if (item.media_type.toLowerCase().endsWith("application/x-dtbncx+xml")) {
          ncx_path = item.path;
          break;
        }
      }
    }

    const spine_paths: string[] = [];
    if (spine !== undefined) {
      for (const itemref of this.iter_children_elements(spine)) {
        if (this.local_name(itemref.name) !== "itemref") {
          continue;
        }
        const idref = itemref.attribs["idref"];
        const item = idref === undefined ? undefined : manifest_items.get(idref);
        if (item !== undefined && item.path !== "") {
          spine_paths.push(item.path);
        }
      }
    }

    let opf_title_path: string | null = null;
    let opf_title_text: string | null = null;
    for (const metadata of this.find_descendants(opf_root, "metadata")) {
      for (const title_elem of this.iter_children_elements(metadata)) {
        if (this.local_name(title_elem.name) !== "title") {
          continue;
        }
        const title_text = this.normalize_slot_text(this.read_text_slot(title_elem));
        if (title_text.trim() === "") {
          continue;
        }
        opf_title_path = this.build_elem_path_map(opf_root).get(title_elem) ?? null;
        opf_title_text = title_text;
        break;
      }
      if (opf_title_path !== null) {
        break;
      }
    }

    return {
      opf_path,
      opf_dir,
      opf_version_major: Number.isFinite(major) ? major : 2,
      spine_paths,
      nav_path,
      ncx_path,
      opf_title_path,
      opf_title_text,
    };
  }

  /**
   * OPF 标题作为独立条目抽取，写回后可同步到 XHTML title
   */
  public extract_item_from_opf_title(rel_path: string, pkg: EpubPackageInfo): Item | null {
    if (pkg.opf_title_path === null || pkg.opf_title_text === null) {
      return null;
    }
    const digest = this.sha1_hex_with_null_separator([pkg.opf_title_text]);
    return Item.from_json({
      src: pkg.opf_title_text,
      dst: "",
      tag: pkg.opf_path,
      row: ROW_BASE_OPF_TITLE,
      file_type: "EPUB",
      file_path: rel_path,
      extra_field: {
        epub: {
          mode: "slot_per_line",
          doc_path: pkg.opf_path,
          block_path: pkg.opf_title_path,
          parts: [{ slot: "text", path: pkg.opf_title_path }],
          src_digest: digest,
          is_opf_metadata: true,
          metadata_tag: "dc:title",
        },
      } as ApiJsonValue,
    });
  }

  /**
   * XHTML 优先 XML 精确解析，失败后修复常见 HTML 实体，再回退 HTML 容错解析
   */
  public parse_xhtml_or_html(raw: Uint8Array): Element {
    const text = this.decode_bytes(raw);
    try {
      return this.parse_xml_document(text);
    } catch {
      // 继续走 HTML 实体修复与容错解析
    }

    const fixed = this.normalize_html_named_entities_for_xml(text);
    try {
      return this.parse_xml_document(fixed);
    } catch {
      // 继续走 HTML 容错解析
    }

    return this.parse_html_document(text);
  }

  /**
   * NCX 是 XML，但常见坏包会出现裸 &，这里只做最小兼容修复
   */
  public parse_ncx_xml(raw: Uint8Array): Element {
    const text = this.decode_bytes(raw);
    try {
      return this.parse_xml_document(text);
    } catch {
      // 继续做裸 & 修复
    }

    return this.parse_xml_document(this.fix_ncx_bare_ampersands(text));
  }

  /**
   * OPF 使用 XML recover 模式，允许保留根节点后继续读取元数据
   */
  public parse_opf_xml(raw: Uint8Array): Element {
    return this.parse_xml_document(this.decode_bytes(raw), true);
  }

  /**
   * XML 解析前把 HTML 命名实体转为数字实体，CDATA 内文本保持原样
   */
  public normalize_html_named_entities_for_xml(text: string): string {
    if (!text.includes("&")) {
      return text;
    }
    return this.replace_outside_cdata(text, (segment) =>
      segment.replace(HTML_NAMED_ENTITY_PATTERN, (match, name: string) => {
        const decoded = decodeHTML(match);
        return decoded === match
          ? `&amp;${name};`
          : [...decoded].map((char) => `&#${char.codePointAt(0) ?? 0};`).join("");
      }),
    );
  }

  /**
   * NCX 裸 & 只在非 CDATA 片段中转义，避免破坏已有合法实体
   */
  public fix_ncx_bare_ampersands(text: string): string {
    if (!text.includes("&")) {
      return text;
    }
    return this.replace_outside_cdata(text, (segment) =>
      segment.replace(NCX_BARE_AMP_PATTERN, "&amp;"),
    );
  }

  /**
   * 从块中抽取 text/tail slot，跳过代码和注音等不可翻译子树
   */
  public iter_translatable_text_slots(
    root: Element,
    block: Element,
    path_map?: Map<Element, string>,
  ): Array<[EpubPartRef, string]> {
    const results: Array<[EpubPartRef, string]> = [];
    const get_path = (elem: Element): string =>
      path_map?.get(elem) ?? this.build_elem_path_map(root).get(elem) ?? "";

    const walk = (elem: Element): void => {
      const name = this.local_name(elem.name);
      if (SKIP_SUBTREE_TAGS.has(name)) {
        return;
      }
      const text = this.read_text_slot(elem);
      if (text !== "") {
        results.push([{ slot: "text", path: get_path(elem) }, text]);
      }
      for (const child of this.iter_children_elements(elem)) {
        walk(child);
        const tail = this.read_tail_slot(child);
        if (tail !== "") {
          results.push([{ slot: "tail", path: get_path(child) }, tail]);
        }
      }
    };

    walk(block);
    return results;
  }

  /**
   * 收集跳过子树之外的可见文本，并统一归一成 block_text 的规范正文
   */
  public canonical_block_text_projection(block: Element): string {
    const parts: string[] = [];
    const walk = (elem: Element): void => {
      const name = this.local_name(elem.name);
      if (SKIP_SUBTREE_TAGS.has(name)) {
        return;
      }
      const text = this.read_text_slot(elem);
      if (text !== "") {
        parts.push(text);
      }
      for (const child of this.iter_children_elements(elem)) {
        walk(child);
        const tail = this.read_tail_slot(child);
        if (tail !== "") {
          parts.push(tail);
        }
      }
    };
    walk(block);
    return this.normalize_slot_text(parts.join(""));
  }

  /**
   * 判断块内是否存在 EPUB 结构化 ruby，命中后必须使用 block_text 协议
   */
  public has_ruby_descendant(elem: Element): boolean {
    return this.flatten_elements(elem).some((node) => this.local_name(node.name) === "ruby");
  }

  /**
   * 将 DOM 树切分成翻译单位，嵌套块保留直接 text/tail，叶子块聚合内部 slot
   */
  public collect_document_units(
    root: Element,
    elem: Element,
    path_map: Map<Element, string>,
    in_skipped_map: Map<Element, boolean>,
    has_block_descendant_map: Map<Element, boolean>,
  ): EpubDocumentUnit[] {
    if (in_skipped_map.get(elem) === true) {
      return [];
    }

    const units: EpubDocumentUnit[] = [];
    const is_block = this.is_block_candidate(elem);
    const has_block_descendant = has_block_descendant_map.get(elem) === true;
    const elem_path = path_map.get(elem) ?? "";

    if (is_block && !has_block_descendant) {
      if (this.has_ruby_descendant(elem)) {
        const text = this.canonical_block_text_projection(elem);
        if (text.trim() !== "") {
          units.push({
            mode: "block_text",
            block_path: elem_path,
            text,
          });
        }
        return units;
      }
      units.push({
        mode: "slot_per_line",
        block_path: elem_path,
        slots: this.iter_translatable_text_slots(root, elem, path_map),
      });
      return units;
    }

    const collect_direct_slots = is_block && has_block_descendant;
    const text = this.read_text_slot(elem);
    if (collect_direct_slots && text !== "") {
      units.push({
        mode: "slot_per_line",
        block_path: elem_path,
        slots: [[{ slot: "text", path: elem_path }, text]],
      });
    }

    for (const child of this.iter_children_elements(elem)) {
      units.push(
        ...this.collect_document_units(
          root,
          child,
          path_map,
          in_skipped_map,
          has_block_descendant_map,
        ),
      );
      const tail = this.read_tail_slot(child);
      if (collect_direct_slots && tail !== "") {
        units.push({
          mode: "slot_per_line",
          block_path: elem_path,
          slots: [[{ slot: "tail", path: path_map.get(child) ?? "" }, tail]],
        });
      }
    }

    return units;
  }

  /**
   * 从单个 HTML 文档生成条目，并把 spine/nav 信息写入行号和 extra_field
   */
  public extract_items_from_document(
    doc_path: string,
    raw: Uint8Array,
    spine_index: number,
    rel_path: string,
    is_nav = false,
  ): Item[] {
    const root = this.parse_xhtml_or_html(raw);
    const elem_list = this.flatten_elements(root);
    const path_map = this.build_elem_path_map(root);
    const in_skipped_map = new Map<Element, boolean>();
    for (const elem of elem_list) {
      const parent = elem.parent;
      const parent_in_skip =
        parent instanceof Element ? in_skipped_map.get(parent) === true : false;
      in_skipped_map.set(elem, parent_in_skip || SKIP_SUBTREE_TAGS.has(this.local_name(elem.name)));
    }

    const has_block_in_subtree_map = new Map<Element, boolean>();
    const has_block_descendant_map = new Map<Element, boolean>();
    for (const elem of [...elem_list].reverse()) {
      const has_child_block = this.iter_children_elements(elem).some(
        (child) => has_block_in_subtree_map.get(child) === true,
      );
      has_block_descendant_map.set(elem, has_child_block);
      has_block_in_subtree_map.set(elem, this.is_block_candidate(elem) || has_child_block);
    }

    const units = this.collect_document_units(
      root,
      root,
      path_map,
      in_skipped_map,
      has_block_descendant_map,
    );
    const items: Item[] = [];
    let unit_index = 0;
    for (const unit of units) {
      const item =
        unit.mode === "block_text"
          ? this.create_item_from_block_text(
              doc_path,
              rel_path,
              spine_index,
              unit_index,
              unit.block_path,
              unit.text,
              is_nav,
            )
          : this.create_item_from_slots(
              doc_path,
              rel_path,
              spine_index,
              unit_index,
              unit.block_path,
              unit.slots,
              is_nav,
            );
      if (item === null) {
        continue;
      }
      items.push(item);
      unit_index += 1;
    }
    return items;
  }

  /**
   * NCX 目录只抽取 text 节点，目录条目使用独立高位行号段
   */
  public extract_items_from_ncx(ncx_path: string, raw: Uint8Array, rel_path: string): Item[] {
    const root = this.parse_ncx_xml(raw);
    const items: Item[] = [];
    let unit_index = 0;
    for (const elem of this.find_descendants(root, "text")) {
      const text = this.normalize_slot_text(this.read_text_slot(elem));
      if (text.trim() === "") {
        continue;
      }
      const elem_path = this.build_elem_path_map(root).get(elem) ?? "";
      items.push(
        Item.from_json({
          src: text,
          dst: "",
          tag: ncx_path,
          row: ROW_BASE_NCX + unit_index,
          file_type: "EPUB",
          file_path: rel_path,
          extra_field: {
            epub: {
              mode: "slot_per_line",
              doc_path: ncx_path,
              block_path: elem_path,
              parts: [{ slot: "text", path: elem_path }],
              src_digest: this.sha1_hex(text),
              is_ncx: true,
            },
          } as ApiJsonValue,
        }),
      );
      unit_index += 1;
    }
    return items;
  }

  /**
   * slot 列表组装成 Item，摘要和路径 metadata 是 AST 写回的契约
   */
  public create_item_from_slots(
    doc_path: string,
    rel_path: string,
    spine_index: number,
    unit_index: number,
    block_path: string,
    slots: Array<[EpubPartRef, string]>,
    is_nav: boolean,
  ): Item | null {
    const part_defs: EpubPartRef[] = [];
    const part_texts: string[] = [];
    let has_non_empty_text = false;
    for (const [ref, text] of slots) {
      part_defs.push({ slot: ref.slot, path: ref.path });
      part_texts.push(this.normalize_slot_text(text));
      if (text.trim() !== "") {
        has_non_empty_text = true;
      }
    }
    if (!has_non_empty_text) {
      return null;
    }

    const epub_extra: Record<string, ApiJsonValue> = {
      mode: "slot_per_line",
      doc_path,
      block_path,
      parts: part_defs as unknown as ApiJsonValue,
      src_digest: this.sha1_hex_with_null_separator(part_texts),
      is_nav,
    };

    return Item.from_json({
      src: part_texts.join("\n"),
      dst: "",
      tag: doc_path,
      row: spine_index * ROW_MULTIPLIER + unit_index,
      file_type: "EPUB",
      file_path: rel_path,
      extra_field: { epub: epub_extra } as ApiJsonValue,
    });
  }

  /**
   * 含 ruby 块组装成单条 block_text Item，src_digest 只绑定去注音后的可见正文
   */
  public create_item_from_block_text(
    doc_path: string,
    rel_path: string,
    spine_index: number,
    unit_index: number,
    block_path: string,
    text: string,
    is_nav: boolean,
  ): Item | null {
    const src = this.normalize_slot_text(text);
    if (src.trim() === "") {
      return null;
    }
    return Item.from_json({
      src,
      dst: "",
      tag: doc_path,
      row: spine_index * ROW_MULTIPLIER + unit_index,
      file_type: "EPUB",
      file_path: rel_path,
      extra_field: {
        epub: {
          mode: "block_text",
          doc_path,
          block_path,
          src_digest: this.sha1_hex(src),
          is_nav,
        },
      } as ApiJsonValue,
    });
  }

  /**
   * 读取元素首个子元素前的文本节点，这是 ElementTree text 的等价语义
   */
  public read_text_slot(elem: Element): string {
    const parts: string[] = [];
    for (const child of elem.children) {
      if (isTag(child)) {
        break;
      }
      if (isText(child)) {
        parts.push(child.data);
      }
    }
    return parts.join("");
  }

  /**
   * 读取元素之后、下一个兄弟元素之前的文本节点，这是 ElementTree tail 的等价语义
   */
  public read_tail_slot(elem: Element): string {
    const parent = elem.parent;
    if (!(parent instanceof Element) && !(parent instanceof Document)) {
      return "";
    }
    const parts: string[] = [];
    const siblings = parent.children;
    const start_index = siblings.indexOf(elem);
    if (start_index < 0) {
      return "";
    }
    for (const sibling of siblings.slice(start_index + 1)) {
      if (isTag(sibling)) {
        break;
      }
      if (isText(sibling)) {
        parts.push(sibling.data);
      }
    }
    return parts.join("");
  }

  /**
   * text slot 写入通过统一 write_slot 维护 DOM 链接，避免局部替换后 prev/next 失效
   */
  public write_text_slot(elem: Element, text: string): void {
    this.write_slot(elem, "text", text);
  }

  /**
   * tail slot 写入同样复用统一逻辑，确保写回 metadata 的 slot 类型可逆
   */
  public write_tail_slot(elem: Element, text: string): void {
    this.write_slot(elem, "tail", text);
  }

  /**
   * 克隆块用于双语对照插入，深拷贝可以保留原块内联结构和属性
   */
  public clone_element(elem: Element): Element {
    return cloneNode(elem, true);
  }

  /**
   * block_text 写回会接管整个块的 children，统一重连 DOM 节点关系
   */
  public replace_element_children_with_text(elem: Element, text: string): void {
    const text_node = new Text(text);
    text_node.parent = elem;
    elem.children = [text_node];
    this.relink_children(elem);
  }

  /**
   * nav 页面不插入双语原文块，避免目录导航结构被额外节点干扰
   */
  public is_nav_page(root: Element): boolean {
    for (const nav of this.find_descendants(root, "nav")) {
      for (const [key, value] of Object.entries(nav.attribs)) {
        if (
          (key === "epub:type" || key.endsWith(":type") || key.endsWith("}type")) &&
          (value === "toc" || value === "landmarks")
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 按本地名查找后代，调用方无需关心 EPUB 文档使用的命名空间前缀
   */
  public find_descendants(root: Element, local_name: string): Element[] {
    return this.flatten_elements(root).filter((elem) => this.local_name(elem.name) === local_name);
  }

  /**
   * 深度优先展开元素树，统一供查找、块分析和 legacy 判断复用
   */
  public flatten_elements(root: Element): Element[] {
    const result: Element[] = [];
    const walk = (elem: Element): void => {
      result.push(elem);
      for (const child of this.iter_children_elements(elem)) {
        walk(child);
      }
    };
    walk(root);
    return result;
  }

  /**
   * XML 解析默认拒绝 parsererror，recover 模式只用于 OPF 元数据读取
   */
  public parse_xml_document(text: string, recover = false): Element {
    const doc = parseDocument(text, {
      decodeEntities: true,
      lowerCaseAttributeNames: false,
      lowerCaseTags: false,
      recognizeSelfClosing: true,
      xmlMode: true,
    });
    const root = this.first_root_element(doc);
    if (root === null || (!recover && this.looks_like_parser_error(root))) {
      throw new FileParseFailedError({
        public_details: { format: "EPUB", parser: "XML" },
        diagnostic_context: {
          recover,
          parser_error_root: root === null ? null : this.local_name(root.name),
        },
      });
    }
    return root;
  }

  /**
   * HTML 容错解析作为最后回退，保证常见非严格 XHTML 仍可导入
   */
  public parse_html_document(text: string): Element {
    const doc = parseDocument(text, {
      decodeEntities: true,
      lowerCaseAttributeNames: false,
      lowerCaseTags: false,
      recognizeSelfClosing: true,
      xmlMode: false,
    });
    const root = this.first_root_element(doc);
    if (root === null) {
      throw new FileParseFailedError({
        public_details: { format: "EPUB", parser: "HTML" },
        diagnostic_context: { reason: "missing_root_element" },
      });
    }
    return root;
  }

  /**
   * EPUB 文本统一按 UTF-8 解码并移除 BOM，匹配 zip 内文本资源主流编码
   */
  public decode_bytes(raw: Uint8Array): string {
    return Buffer.from(raw)
      .toString("utf-8")
      .replace(/^\uFEFF/u, "");
  }

  /**
   * 写回 XML 前过滤非法文本码点，防止单个异常字符破坏整本 EPUB
   */
  public sanitize_xml_text(text: string): string {
    return [...text]
      .filter((char) => is_valid_xml_text_code_point(char.codePointAt(0) ?? 0))
      .join("");
  }

  /**
   * 读取必需 zip 文本资源，缺文件时抛出带路径的错误方便定位坏包
   */
  private async require_zip_text(zip_reader: JSZip, file_path: string): Promise<string> {
    const file = zip_reader.file(file_path);
    if (file === null) {
      throw new InvalidFileStructureError({
        public_details: { format: "EPUB" },
        diagnostic_context: { entry: file_path, reason: "missing_required_zip_entry" },
      });
    }
    return this.decode_bytes(await file.async("uint8array"));
  }

  /**
   * 读取可选 zip 资源，缺失时返回 null 让上层按 EPUB 容错策略跳过
   */
  private async read_zip_bytes(zip_reader: JSZip, file_path: string): Promise<Uint8Array | null> {
    const file = zip_reader.file(file_path);
    return file === null ? null : await file.async("uint8array");
  }

  /**
   * 解析 metadata 中的元素路径，格式不合法说明写回定位契约已经失效
   */
  private parse_elem_path(elem_path: string): EpubPathSeg[] {
    const parts = elem_path
      .trim()
      .split("/")
      .filter((part) => part !== "");
    return parts.map((part) => {
      const match = /^([A-Za-z0-9:_-]+)\[(\d+)\]$/u.exec(part);
      if (match === null) {
        throw new InvalidFileStructureError({
          public_details: { format: "EPUB" },
          diagnostic_context: { elem_path, reason: "invalid_element_path" },
        });
      }
      return { name: match[1] as string, pos: Number.parseInt(match[2] as string, 10) };
    });
  }

  /**
   * 对 CDATA 外片段应用修复函数，避免实体修复误改用户原始 CDATA 内容
   */
  private replace_outside_cdata(text: string, replacer: (segment: string) => string): string {
    const parts: string[] = [];
    let last_end = 0;
    for (const match of text.matchAll(CDATA_PATTERN)) {
      const index = match.index ?? 0;
      parts.push(replacer(text.slice(last_end, index)));
      parts.push(match[0]);
      last_end = index + match[0].length;
    }
    parts.push(replacer(text.slice(last_end)));
    return parts.join("");
  }

  /**
   * 写入 text/tail slot 后重建 DOM 子节点链接，供后续序列化稳定遍历
   */
  private write_slot(elem: Element, slot: "text" | "tail", text: string): void {
    const parent = slot === "text" ? elem : elem.parent;
    if (!(parent instanceof Element) && !(parent instanceof Document)) {
      return;
    }
    const children = parent.children;
    const start_index = slot === "text" ? 0 : children.indexOf(elem) + 1;
    if (start_index < 0) {
      return;
    }
    let end_index = start_index;
    while (end_index < children.length && !isTag(children[end_index] as ChildNode)) {
      end_index += 1;
    }
    const text_node = new Text(text);
    text_node.parent = parent;
    children.splice(start_index, end_index - start_index, text_node);
    this.relink_children(parent);
  }

  /**
   * htmlparser2 文档根可能混有声明或空白，抽取第一个真实元素作为根
   */
  private first_root_element(doc: Document): Element | null {
    for (const child of doc.children) {
      if (isTag(child)) {
        return child;
      }
    }
    return null;
  }

  /**
   * parsererror 根节点表示 XML 解析失败，默认不能作为有效 EPUB 文档继续处理
   */
  private looks_like_parser_error(root: Element): boolean {
    const name = this.local_name(root.name).toLowerCase();
    return name === "parsererror";
  }

  /**
   * 手动替换 children 后必须重连 parent/prev/next，否则后续 DOM 操作会失真
   */
  private relink_children(parent: Element | Document): void {
    let previous: ChildNode | null = null;
    for (const child of parent.children) {
      child.parent = parent;
      child.prev = previous;
      if (previous !== null) {
        previous.next = child;
      }
      previous = child;
    }
    if (previous !== null) {
      previous.next = null;
    }
  }
}

/**
 * 从通用 extra_field 中读取 EPUB metadata，非对象或数组都视为无 AST 信息
 */
export function read_epub_extra(item: Item): Record<string, ApiJsonValue> | null {
  const extra = read_json_record(item.extra_field);
  const epub = extra["epub"];
  return typeof epub === "object" && epub !== null && !Array.isArray(epub)
    ? (epub as Record<string, ApiJsonValue>)
    : null;
}

/**
 * 对外保留 domhandler 节点类型，便于测试或迁移代码复用同一 AST 类型
 */
export type { AnyNode };
