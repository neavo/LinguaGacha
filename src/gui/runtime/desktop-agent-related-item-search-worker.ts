import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { is_json_record } from "../../domain/json";
import {
  AGENT_RELATED_ITEM_SEARCH_LIMITS,
  type AgentRelatedItemSearchRequest,
  type AgentRelatedItemSearchResult,
} from "../../shared/backend-runtime";
import { iterate_utf8_lf_lines } from "../../shared/utils/text-tool";
import { NativeFs, default_native_fs } from "../../native/native-fs";

// 这些值只调节索引粒度和排序成本；公开稳定边界统一来自 shared limits。
const INDEX_VERSION = 3;
const FINE_WINDOW_CHARACTERS = 900;
const COARSE_WINDOW_CHARACTERS = 6_000;
const QUERY_WORD_LIMIT = 32;
const SEARCH_WORD_LIMIT = 8;
const QUERY_NGRAM_LIMIT = 16;
const RRF_K = 60;
// 日语查询中的高频功能词不应挤占按稀有度选择的检索词。
const PROXIMITY_STOP_WORDS = new Set([
  "は",
  "が",
  "を",
  "に",
  "で",
  "と",
  "の",
  "も",
  "へ",
  "や",
  "か",
  "て",
  "し",
  "する",
  "ある",
  "いる",
  "なる",
  "れる",
  "られる",
  "から",
  "まで",
  "より",
  "その",
  "この",
  "こと",
  "もの",
  "場面",
  "話",
]);

/** 索引只保留源字段与稳定自然顺序，不复制译文。 */
type SearchItem = {
  itemId: number;
  filePath: string;
  order: number;
  src: string;
  nameSrc: string;
};

/** FTS 文档窗口；fine 定位锚点，coarse 补足跨 item 主题语境。 */
type SearchSegment = {
  segmentId: number;
  granularity: "fine" | "coarse";
  filePath: string;
  itemIds: number[];
  src: string;
  nameSrc: string;
};

/** 各检索通道只交换排名，不耦合彼此的原始分数量纲。 */
type RankedSegment = { segmentId: number; rank: number };

// 同一 worker 只缓存最近快照；mtime/size 命中时避免重复解析大型 JSONL。
let cached_snapshot:
  | {
      workspacePath: string;
      itemsSize: number;
      itemsModified: number;
      projectMetaModified: number;
      value: { identity: string; sourceLanguage: string; items: SearchItem[] };
    }
  | undefined;

/** worker 所需的绝对磁盘落点与已经过协议校验的查询。 */
export type RelatedItemSearchWorkerInput = Readonly<{
  workspacePath: string;
  indexPath: string;
  request: AgentRelatedItemSearchRequest;
}>;

/** 在 worker 内懒建并查询派生索引；调用方只需串行化同一索引路径。 */
export async function run_related_item_search(
  input: RelatedItemSearchWorkerInput,
  is_cancelled: () => boolean = () => false,
  native_fs: NativeFs = default_native_fs,
): Promise<AgentRelatedItemSearchResult> {
  const snapshot = await read_snapshot(input.workspacePath, is_cancelled, native_fs);
  await ensure_index(input.indexPath, snapshot, is_cancelled, native_fs);
  assert_not_cancelled(is_cancelled);
  const db = new DatabaseSync(native_fs.to_native_path(input.indexPath), { readOnly: true });
  try {
    return search_index(db, snapshot.sourceLanguage, input.request);
  } finally {
    db.close();
  }
}

/** 流式读取源字段并计算内容身份；译文字段不会触发索引重建。 */
async function read_snapshot(
  workspace_path: string,
  is_cancelled: () => boolean,
  native_fs: NativeFs,
): Promise<{ identity: string; sourceLanguage: string; items: SearchItem[] }> {
  assert_not_cancelled(is_cancelled);
  const items_path = path.join(workspace_path, "items", "entries.jsonl");
  const project_meta_path = path.join(workspace_path, "project_meta.json");
  const items_stat = native_fs.stat(items_path);
  const project_meta_stat = native_fs.stat(project_meta_path);
  if (
    cached_snapshot?.workspacePath === workspace_path &&
    cached_snapshot.itemsSize === items_stat.size &&
    cached_snapshot.itemsModified === items_stat.mtimeMs &&
    cached_snapshot.projectMetaModified === project_meta_stat.mtimeMs
  ) {
    return cached_snapshot.value;
  }
  const project_meta = JSON.parse(native_fs.read_text_file(project_meta_path)) as unknown;
  if (!is_json_record(project_meta) || typeof project_meta["source_language"] !== "string") {
    throw new Error("Workspace project metadata is invalid for related item search.");
  }
  const source_language = project_meta["source_language"];
  const hash = createHash("sha256").update(source_language).update("\0");
  const items: SearchItem[] = [];
  let order = 0;
  for await (const line of iterate_utf8_lf_lines(native_fs.create_read_stream(items_path))) {
    if (line.trim() === "") continue;
    const value = JSON.parse(line) as unknown;
    if (!is_json_record(value)) throw new Error("Workspace items are invalid for related search.");
    const item_id = value["item_id"];
    const file_path = value["file_path"];
    const src = value["src"];
    const name_src = value["name_src"];
    if (
      typeof item_id !== "number" ||
      !Number.isInteger(item_id) ||
      item_id < 1 ||
      typeof file_path !== "string" ||
      typeof src !== "string" ||
      typeof name_src !== "string"
    ) {
      throw new Error("Workspace items are invalid for related search.");
    }
    const item = { itemId: item_id, filePath: file_path, order, src, nameSrc: name_src };
    items.push(item);
    hash.update(JSON.stringify([item_id, file_path, src, name_src])).update("\n");
    order += 1;
    if (order % 1_000 === 0) {
      assert_not_cancelled(is_cancelled);
      await yield_to_worker();
    }
  }
  const value = { identity: hash.digest("hex"), sourceLanguage: source_language, items };
  cached_snapshot = {
    workspacePath: workspace_path,
    itemsSize: items_stat.size,
    itemsModified: items_stat.mtimeMs,
    projectMetaModified: project_meta_stat.mtimeMs,
    value,
  };
  return value;
}

/** 仅当源文身份或索引版本变化时，以临时库重建 sidecar。 */
async function ensure_index(
  index_path: string,
  snapshot: { identity: string; sourceLanguage: string; items: SearchItem[] },
  is_cancelled: () => boolean,
  native_fs: NativeFs,
): Promise<void> {
  if (index_matches(index_path, snapshot.identity, native_fs)) return;

  const temporary_path = `${index_path}.building-${randomUUID()}`;
  native_fs.ensure_parent_dir(temporary_path);
  try {
    await build_index(temporary_path, snapshot, is_cancelled, native_fs);
    // sidecar 不含权威数据；安装失败保留为 cache miss，下次调用直接重建。
    native_fs.remove(index_path, { force: true });
    native_fs.rename(temporary_path, index_path);
  } catch (error) {
    native_fs.remove(temporary_path, { force: true });
    throw error;
  }
}

/** 缓存损坏与旧版本都视为普通 miss，由调用方统一重建。 */
function index_matches(index_path: string, identity: string, native_fs: NativeFs): boolean {
  if (!native_fs.exists(index_path)) return false;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(native_fs.to_native_path(index_path), { readOnly: true });
    const row = db.prepare("SELECT value FROM metadata WHERE key = 'identity'").get() as
      | { value?: unknown }
      | undefined;
    const version = db.prepare("SELECT value FROM metadata WHERE key = 'version'").get() as
      | { value?: unknown }
      | undefined;
    return row?.value === identity && version?.value === INDEX_VERSION.toString();
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/** 在独立临时库内批量写入原文、检索窗口和 FTS 词表。 */
async function build_index(
  index_path: string,
  snapshot: { identity: string; sourceLanguage: string; items: SearchItem[] },
  is_cancelled: () => boolean,
  native_fs: NativeFs,
): Promise<void> {
  const db = new DatabaseSync(native_fs.to_native_path(index_path));
  try {
    db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE items (
        item_id INTEGER PRIMARY KEY,
        file_path TEXT NOT NULL,
        item_order INTEGER NOT NULL,
        src TEXT NOT NULL,
        name_src TEXT NOT NULL
      );
      CREATE INDEX items_file_order ON items(file_path, item_order);
      CREATE TABLE segments (
        segment_id INTEGER PRIMARY KEY,
        granularity TEXT NOT NULL,
        file_path TEXT NOT NULL,
        item_ids TEXT NOT NULL,
        src TEXT NOT NULL,
        name_src TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE word_fts USING fts5(
        segment_id UNINDEXED,
        granularity UNINDEXED,
        src_terms,
        name_terms,
        tokenize = 'unicode61'
      );
      CREATE VIRTUAL TABLE ngram_fts USING fts5(
        segment_id UNINDEXED,
        granularity UNINDEXED,
        text,
        tokenize = 'trigram'
      );
      CREATE VIRTUAL TABLE word_vocab USING fts5vocab(word_fts, 'row');
    `);
    const insert_item = db.prepare(
      "INSERT INTO items(item_id, file_path, item_order, src, name_src) VALUES (?, ?, ?, ?, ?)",
    );
    await in_batches(snapshot.items, 500, is_cancelled, (batch) => {
      db.exec("BEGIN");
      try {
        for (const item of batch) {
          insert_item.run(item.itemId, item.filePath, item.order, item.src, item.nameSrc);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });

    const segmenter = create_word_segmenter(snapshot.sourceLanguage);
    const segments = [
      ...build_segments(snapshot.items, "fine", FINE_WINDOW_CHARACTERS),
      ...build_segments(snapshot.items, "coarse", COARSE_WINDOW_CHARACTERS),
    ];
    const insert_segment = db.prepare(
      "INSERT INTO segments(segment_id, granularity, file_path, item_ids, src, name_src) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insert_word = db.prepare(
      "INSERT INTO word_fts(segment_id, granularity, src_terms, name_terms) VALUES (?, ?, ?, ?)",
    );
    const insert_ngram = db.prepare(
      "INSERT INTO ngram_fts(segment_id, granularity, text) VALUES (?, ?, ?)",
    );
    await in_batches(segments, 100, is_cancelled, (batch) => {
      db.exec("BEGIN");
      try {
        for (const segment of batch) {
          insert_segment.run(
            segment.segmentId,
            segment.granularity,
            segment.filePath,
            JSON.stringify(segment.itemIds),
            segment.src,
            segment.nameSrc,
          );
          insert_word.run(
            segment.segmentId,
            segment.granularity,
            word_tokens(segmenter, segment.src).join(" "),
            word_tokens(segmenter, segment.nameSrc).join(" "),
          );
          if (segment.granularity === "fine") {
            insert_ngram.run(
              segment.segmentId,
              segment.granularity,
              `${segment.src}\n${segment.nameSrc}`,
            );
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    });
    db.prepare("INSERT INTO metadata(key, value) VALUES ('identity', ?)").run(snapshot.identity);
    db.prepare("INSERT INTO metadata(key, value) VALUES ('version', ?)").run(
      INDEX_VERSION.toString(),
    );
    db.exec("PRAGMA optimize");
  } finally {
    db.close();
  }
}

/** 按文件和裸标题边界切窗，相邻窗口保留一个 item 以避免切断局部语境。 */
function build_segments(
  items: readonly SearchItem[],
  granularity: SearchSegment["granularity"],
  target_characters: number,
): SearchSegment[] {
  const segments: SearchSegment[] = [];
  let current: SearchItem[] = [];
  let characters = 0;
  let segment_id = granularity === "fine" ? 1 : 1_000_000_000;
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      segmentId: segment_id,
      granularity,
      filePath: current[0]!.filePath,
      itemIds: current.map((item) => item.itemId),
      src: current
        .map((item) => item.src)
        .filter(Boolean)
        .join("\n"),
      nameSrc: current
        .map((item) => item.nameSrc)
        .filter(Boolean)
        .join("\n"),
    });
    segment_id += 1;
    current = [];
    characters = 0;
  };
  for (const item of items) {
    if (/^#{1,6}$/u.test(item.src.trim())) {
      flush();
      continue;
    }
    const item_characters = item.src.length + item.nameSrc.length + 1;
    if (
      current.length > 0 &&
      (current[0]!.filePath !== item.filePath || characters + item_characters > target_characters)
    ) {
      const carry =
        current.length > 1 && current[0]!.filePath === item.filePath ? current.at(-1)! : null;
      flush();
      if (carry !== null) {
        current = [carry];
        characters = carry.src.length + carry.nameSrc.length + 1;
      }
    }
    current.push(item);
    characters += item_characters;
  }
  flush();
  return segments;
}

/** 对同一只读数据库批量执行查询，保留调用方提供的关联 key。 */
function search_index(
  db: DatabaseSync,
  source_language: string,
  request: AgentRelatedItemSearchRequest,
): AgentRelatedItemSearchResult {
  const segmenter = create_word_segmenter(source_language);
  const indexed_item_count = Number(
    (db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number | bigint }).count,
  );
  const reader = create_search_reader(db);
  return {
    indexed_item_count,
    queries: request.queries.map((query) => ({
      key: query.key,
      results: search_query(db, reader, segmenter, query.text, request),
    })),
  };
}

/** 合并粗粒度主题、细粒度邻近和短查询 trigram 候选并选择 item 锚点。 */
function search_query(
  db: DatabaseSync,
  reader: ReturnType<typeof create_search_reader>,
  segmenter: Intl.Segmenter,
  query_text: string,
  request: AgentRelatedItemSearchRequest,
): AgentRelatedItemSearchResult["queries"][number]["results"] {
  const all_words = [...new Set(word_tokens(segmenter, query_text))];
  const content_words = all_words.filter((word) => !PROXIMITY_STOP_WORDS.has(word));
  const words = (content_words.length === 0 ? all_words : content_words).slice(0, QUERY_WORD_LIMIT);
  const search_words = select_search_words(db, words);
  const trigram_terms = words.filter((word) => [...word].length >= 3).slice(0, QUERY_NGRAM_LIMIT);
  const candidate_limit = Math.max(30, request.limit * 2);
  const fine = query_fts(db, "word", "fine", search_words, request.file_paths, candidate_limit);
  const coarse = query_fts(db, "word", "coarse", search_words, request.file_paths, candidate_limit);
  const ngrams =
    search_words.length <= 2
      ? query_fts(db, "ngram", "fine", trigram_terms, request.file_paths, candidate_limit)
      : [];
  const proximity = rerank_by_proximity(reader, segmenter, fine, words);
  const fused = reciprocal_rank_fusion([
    { ranking: coarse, weight: 1.5 },
    { ranking: proximity, weight: 2.5 },
    { ranking: fine, weight: 0.5 },
    { ranking: ngrams, weight: 0.5 },
  ]);
  const results: Array<AgentRelatedItemSearchResult["queries"][number]["results"][number]> = [];
  const seen_item_ids = new Set<number>();
  for (const candidate of fused) {
    const segment = reader.readSegment(candidate.segmentId);
    if (segment === null) continue;
    const anchor = choose_anchor_item(reader, segment.itemIds, segmenter, words);
    if (anchor === null || seen_item_ids.has(anchor.itemId)) continue;
    seen_item_ids.add(anchor.itemId);
    const matched_terms = matched_terms_for_text(
      segmenter,
      `${anchor.src}\n${anchor.nameSrc}`,
      words,
    );
    results.push({
      rank: results.length + 1,
      anchor_item_id: anchor.itemId,
      file_path: anchor.filePath,
      matched_query_terms: matched_terms,
      source_excerpt: excerpt(anchor.src || anchor.nameSrc, matched_terms),
      context_item_ids: reader.readContextItemIds(anchor, request.context_items),
    });
    if (results.length >= request.limit) break;
  }
  return results;
}

/** 从真实词表选择文档频率最低的查询词，控制宽泛 OR 查询的成本。 */
function select_search_words(db: DatabaseSync, words: readonly string[]): string[] {
  const statement = db.prepare("SELECT doc FROM word_vocab WHERE term = ?");
  return words
    .flatMap((word, order) => {
      const row = statement.get(word) as { doc: number | bigint } | undefined;
      return row === undefined ? [] : [{ word, order, documents: Number(row.doc) }];
    })
    .sort((left, right) => left.documents - right.documents || left.order - right.order)
    .slice(0, SEARCH_WORD_LIMIT)
    .map((entry) => entry.word);
}

/** 使用参数绑定构造受控 FTS 查询；动态 SQL 只包含固定表名和占位符数量。 */
function query_fts(
  db: DatabaseSync,
  kind: "word" | "ngram",
  granularity: SearchSegment["granularity"],
  terms: readonly string[],
  file_paths: readonly string[],
  limit: number,
): RankedSegment[] {
  if (terms.length === 0) return [];
  const table = kind === "word" ? "word_fts" : "ngram_fts";
  const weights = kind === "word" ? "0.0, 0.0, 1.0, 4.0" : "0.0, 0.0, 1.0";
  const file_filter =
    file_paths.length === 0
      ? ""
      : ` AND segments.file_path IN (${file_paths.map(() => "?").join(", ")})`;
  const sql = `
    SELECT ${table}.segment_id AS segment_id, bm25(${table}, ${weights}) AS score
    FROM ${table}
    JOIN segments ON segments.segment_id = ${table}.segment_id
    WHERE ${table} MATCH ? AND ${table}.granularity = ?${file_filter}
    ORDER BY score
    LIMIT ?
  `;
  const match = terms.map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
  const rows = db.prepare(sql).all(match, granularity, ...file_paths, limit) as Array<{
    segment_id: number | bigint;
  }>;
  return rows.map((row, index) => ({ segmentId: Number(row.segment_id), rank: index + 1 }));
}

/** 在 BM25 候选内按词覆盖和最小跨度重排，不扩大候选集合。 */
function rerank_by_proximity(
  reader: ReturnType<typeof create_search_reader>,
  segmenter: Intl.Segmenter,
  ranking: readonly RankedSegment[],
  terms: readonly string[],
): RankedSegment[] {
  const rows = ranking.map((candidate) => {
    const segment = reader.readSegment(candidate.segmentId);
    const tokens =
      segment === null ? [] : word_tokens(segmenter, `${segment.src}\n${segment.nameSrc}`);
    const matched = terms.filter((term) => tokens.includes(term));
    return {
      ...candidate,
      coverage: terms.length === 0 ? 0 : matched.length / terms.length,
      span: minimum_span(tokens, matched),
      score: 0,
    };
  });
  const denominator = Math.max(1, ranking.length - 1);
  for (const row of rows) {
    const normalized_bm25_rank = 1 - (row.rank - 1) / denominator;
    const compactness = row.span === Number.MAX_SAFE_INTEGER ? 0 : 1 / (1 + row.span / 32);
    row.score =
      0.65 * normalized_bm25_rank + 0.25 * row.coverage + 0.1 * row.coverage * compactness;
  }
  rows.sort((left, right) => right.score - left.score || left.rank - right.rank);
  return rows.map((row, index) => ({ segmentId: row.segmentId, rank: index + 1 }));
}

/** 用加权 RRF 合并量纲不同的排名，并以 segment id 保证稳定并列顺序。 */
function reciprocal_rank_fusion(
  inputs: readonly Readonly<{ ranking: readonly RankedSegment[]; weight: number }>[],
): RankedSegment[] {
  const scores = new Map<number, number>();
  for (const { ranking, weight } of inputs) {
    for (const candidate of ranking) {
      scores.set(
        candidate.segmentId,
        (scores.get(candidate.segmentId) ?? 0) + weight / (RRF_K + candidate.rank),
      );
    }
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .map(([segmentId], index) => ({ segmentId, rank: index + 1 }));
}

/** 复用 prepared statement 与本次查询缓存，避免重复反序列化同一候选。 */
function create_search_reader(db: DatabaseSync) {
  const segment_statement = db.prepare(
    "SELECT segment_id, granularity, file_path, item_ids, src, name_src FROM segments WHERE segment_id = ?",
  );
  const item_statement = db.prepare(
    "SELECT item_id, file_path, item_order, src, name_src FROM items WHERE item_id = ?",
  );
  const context_statement = db.prepare(
    "SELECT item_id FROM items WHERE file_path = ? AND item_order BETWEEN ? AND ? ORDER BY item_order",
  );
  const segments = new Map<number, SearchSegment | null>();
  const items = new Map<number, SearchItem | null>();
  const readSegment = (segment_id: number): SearchSegment | null => {
    if (segments.has(segment_id)) return segments.get(segment_id)!;
    const row = segment_statement.get(segment_id) as
      | {
          segment_id: number | bigint;
          granularity: string;
          file_path: string;
          item_ids: string;
          src: string;
          name_src: string;
        }
      | undefined;
    const segment =
      row === undefined || (row.granularity !== "fine" && row.granularity !== "coarse")
        ? null
        : {
            segmentId: Number(row.segment_id),
            granularity: row.granularity as SearchSegment["granularity"],
            filePath: row.file_path,
            itemIds: JSON.parse(row.item_ids) as number[],
            src: row.src,
            nameSrc: row.name_src,
          };
    segments.set(segment_id, segment);
    return segment;
  };
  const readItem = (item_id: number): SearchItem | null => {
    if (items.has(item_id)) return items.get(item_id)!;
    const row = item_statement.get(item_id) as
      | {
          item_id: number | bigint;
          file_path: string;
          item_order: number | bigint;
          src: string;
          name_src: string;
        }
      | undefined;
    const item =
      row === undefined
        ? null
        : {
            itemId: Number(row.item_id),
            filePath: row.file_path,
            order: Number(row.item_order),
            src: row.src,
            nameSrc: row.name_src,
          };
    items.set(item_id, item);
    return item;
  };
  const readContextItemIds = (anchor: SearchItem, radius: number): number[] => {
    const rows = context_statement.all(
      anchor.filePath,
      anchor.order - radius,
      anchor.order + radius,
    ) as Array<{ item_id: number | bigint }>;
    return rows.map((row) => Number(row.item_id));
  };
  return { readSegment, readItem, readContextItemIds };
}

/** 从窗口内选择覆盖词最多、跨度最小且自然顺序最早的结果锚点。 */
function choose_anchor_item(
  reader: ReturnType<typeof create_search_reader>,
  item_ids: readonly number[],
  segmenter: Intl.Segmenter,
  terms: readonly string[],
): SearchItem | null {
  const candidates = item_ids.flatMap((item_id) => {
    const item = reader.readItem(item_id);
    if (item === null) return [];
    const tokens = word_tokens(segmenter, `${item.src}\n${item.nameSrc}`);
    const matched = terms.filter((term) => tokens.includes(term));
    return [{ item, matched: matched.length, span: minimum_span(tokens, matched) }];
  });
  candidates.sort(
    (left, right) =>
      right.matched - left.matched || left.span - right.span || left.item.order - right.item.order,
  );
  return candidates[0]?.item ?? null;
}

/** 滑动窗口计算覆盖全部不同词项的最短 token 跨度。 */
function minimum_span(tokens: readonly string[], terms: readonly string[]): number {
  const unique_terms = [...new Set(terms)];
  if (unique_terms.length < 2) return Number.MAX_SAFE_INTEGER;
  const wanted = new Set(unique_terms);
  const counts = new Map<string, number>();
  let covered = 0;
  let left = 0;
  let best = Number.MAX_SAFE_INTEGER;
  for (let right = 0; right < tokens.length; right += 1) {
    const token = tokens[right]!;
    if (!wanted.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (counts.get(token) === 1) covered += 1;
    while (covered === wanted.size) {
      best = Math.min(best, right - left + 1);
      const left_token = tokens[left]!;
      if (wanted.has(left_token)) {
        counts.set(left_token, counts.get(left_token)! - 1);
        if (counts.get(left_token) === 0) covered -= 1;
      }
      left += 1;
    }
  }
  return best;
}

/** 只报告锚点自身实际包含的查询词，避免把窗口命中误投影到单个 item。 */
function matched_terms_for_text(
  segmenter: Intl.Segmenter,
  text: string,
  terms: readonly string[],
): string[] {
  const tokens = new Set(word_tokens(segmenter, text));
  return terms.filter((term) => tokens.has(term));
}

/** 长原文围绕最早命中裁剪，结果仍受公开字符上限约束。 */
function excerpt(text: string, matched_terms: readonly string[]): string {
  const limit = AGENT_RELATED_ITEM_SEARCH_LIMITS.excerptCharactersMax;
  if (text.length <= limit) return text;
  const normalized = text.normalize("NFKC").toLowerCase();
  const positions = matched_terms
    .map((term) => normalized.indexOf(term))
    .filter((position) => position >= 0);
  const center = positions.length === 0 ? 0 : Math.min(...positions);
  const start = Math.max(0, center - 200);
  return text.slice(start, start + limit);
}

/** 使用源语言 locale；运行时不支持时 Intl 自动采用默认分词规则。 */
function create_word_segmenter(source_language: string): Intl.Segmenter {
  const locale = Intl.Segmenter.supportedLocalesOf([source_language])[0];
  return new Intl.Segmenter(locale, { granularity: "word" });
}

/** NFKC 与小写归一只服务检索，不改写返回的原文。 */
function word_tokens(segmenter: Intl.Segmenter, text: string): string[] {
  return [...segmenter.segment(text.normalize("NFKC").toLowerCase())]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

/** 每批事务后让出事件循环，使 worker 能接收取消消息。 */
async function in_batches<T>(
  values: readonly T[],
  size: number,
  is_cancelled: () => boolean,
  consume: (batch: readonly T[]) => void,
): Promise<void> {
  for (let index = 0; index < values.length; index += size) {
    assert_not_cancelled(is_cancelled);
    consume(values.slice(index, index + size));
    await yield_to_worker();
  }
}

function assert_not_cancelled(is_cancelled: () => boolean): void {
  if (is_cancelled()) throw new Error("Related item search was cancelled.");
}

/** 让出 worker 事件循环，使已到达的 cancel 消息可以更新取消集合。 */
function yield_to_worker(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
