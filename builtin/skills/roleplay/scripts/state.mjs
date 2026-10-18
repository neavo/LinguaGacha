import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = "work/roleplay"; // 工作区根的相对路径，workspace_run 以工作区根为当前目录
const TURNS_DIR = path.join(ROOT, "turns");
const ARCHIVE_DIR = path.join(ROOT, "archive");
const CANON_PATH = path.join(ROOT, "canon.json");
const CANON_SECTIONS = Object.freeze(["world", "characters", "relations", "timeline"]); // canon_ref 可引用的分区
const STATE_SECTIONS = Object.freeze(["player", "narration", "scene"]); // 有效快照的必备字段

/** 判断值是否为普通对象。 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 回合号对应的快照路径。 */
function turnPath(turn) {
  return path.join(TURNS_DIR, `${turn}.json`);
}

/** 读取 JSON 文件，文件不存在表示尚未建立该记忆，返回 null。 */
async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

/** 先写临时文件再替换，避免脚本被取消或超时时留下半份 JSON。 */
async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

/** 递归找出名为 key 的全部字段，返回字段值及其在对象中的位置，便于模型定位修正。 */
function findField(value, key, at = "", found = []) {
  if (Array.isArray(value))
    value.forEach((entry, index) => findField(entry, key, `${at}[${index}]`, found));
  else if (isRecord(value))
    for (const [name, entry] of Object.entries(value)) {
      const where = at ? `${at}.${name}` : name;
      if (name === key) found.push({ at: where, value: entry });
      else findField(entry, key, where, found);
    }
  return found;
}

/** 摘要只覆盖原文字段，译文或翻译状态变化不会让原作证据失效。 */
function sourceDigest(item) {
  return createHash("sha256")
    .update(JSON.stringify([item.src ?? "", item.name_src ?? ""]))
    .digest("hex")
    .slice(0, 16);
}

/** 返回当前分支已有快照的回合号，按升序排列。 */
export async function listTurns() {
  let names;
  try {
    names = await readdir(TURNS_DIR);
  } catch (cause) {
    if (cause?.code === "ENOENT") return []; // 尚未开局时没有快照目录
    throw cause;
  }
  return names
    .map((name) => /^(\d+)\.json$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
}

/** 载入指定回合快照，省略回合号时载入最新快照，快照不存在时返回 null。 */
export async function loadTurn(turn) {
  turn ??= (await listTurns()).at(-1);
  return turn === undefined ? null : readJson(turnPath(turn));
}

/**
 * 校验后保存 state.turn 对应的快照。
 * 同号及更晚的旧快照移入归档，使本快照成为当前分支的最新回合。
 * 归档代替删除，因为用户可能在对话历史中切回被替换的分支。
 */
export async function saveTurn(state) {
  if (!isRecord(state)) throw new Error("state must be an object");
  const problems = [];
  if (!Number.isSafeInteger(state.turn) || state.turn < 0)
    problems.push("turn: expected a non-negative integer");
  for (const key of STATE_SECTIONS)
    if (!isRecord(state[key])) problems.push(`${key}: expected an object`);
  if (state.turn > 0 && !state.turn_summary?.trim?.())
    problems.push("turn_summary: required after turn 0");
  const refs = findField(state, "canon_ref");
  const canon = refs.length > 0 ? await loadCanon() : null;
  for (const { at, value } of refs) {
    const [section, id, ...rest] = String(value).split("/");
    if (
      rest.length > 0 ||
      !CANON_SECTIONS.includes(section) ||
      !Object.hasOwn(canon?.[section] ?? {}, id)
    )
      problems.push(`${at}: unknown canon_ref "${value}"`);
  }
  if (problems.length > 0) throw new Error(`Invalid roleplay state:\n${problems.join("\n")}`);

  const archived_turns = (await listTurns()).filter((turn) => turn >= state.turn);
  if (archived_turns.length > 0) {
    const target = path.join(ARCHIVE_DIR, new Date().toISOString().replace(/[:.]/g, "-")); // 文件名不允许冒号
    await mkdir(target, { recursive: true });
    for (const turn of archived_turns)
      await rename(turnPath(turn), path.join(target, `${turn}.json`));
  }
  await writeJson(turnPath(state.turn), state);
  return { archived_turns };
}

/** 载入原作记忆，不存在时返回 null。 */
export async function loadCanon() {
  return readJson(CANON_PATH);
}

/** 校验分区结构后保存原作记忆，saveTurn 依赖分区是以实体标识为键的对象。 */
export async function saveCanon(canon) {
  if (!isRecord(canon)) throw new Error("canon must be an object");
  const problems = CANON_SECTIONS.filter(
    (key) => canon[key] !== undefined && !isRecord(canon[key]),
  ).map((key) => `${key}: expected an object keyed by entity id`);
  if (problems.length > 0) throw new Error(`Invalid roleplay canon:\n${problems.join("\n")}`);
  await writeJson(CANON_PATH, canon);
}

/** 为条目证据生成 source_ref 元素。 */
export function sourceRef(item) {
  if (item?.item_id === undefined) throw new Error("item_id is required");
  return { item_id: item.item_id, digest: sourceDigest(item) };
}

/** 按当前条目核对 canon 中的条目证据。页面和上传材料的证据没有摘要，由模型核对。 */
export async function checkCanon(items) {
  const canon = await loadCanon();
  const wanted = new Map(); // item_id → 引用该条目的证据
  for (const { at, value } of findField(canon, "source_ref"))
    for (const [index, ref] of (Array.isArray(value) ? value : []).entries()) {
      if (ref?.item_id === undefined || typeof ref.digest !== "string") continue;
      const key = String(ref.item_id);
      if (!wanted.has(key)) wanted.set(key, []);
      wanted.get(key).push({ at: `${at}[${index}]`, ref });
    }
  const scoped = new Set(canon?.source_scope?.files ?? []);
  const new_files = new Set();
  const stale = [];
  for await (const item of items) {
    if (scoped.size > 0 && !scoped.has(item.file_path)) new_files.add(item.file_path);
    const key = String(item.item_id);
    const entries = wanted.get(key);
    if (!entries) continue;
    const digest = sourceDigest(item);
    for (const { at, ref } of entries)
      if (ref.digest !== digest) stale.push({ at, item_id: ref.item_id });
    wanted.delete(key); // 遍历结束后剩下的就是工程中已不存在的条目
  }
  const missing = [...wanted.values()].flat().map(({ at, ref }) => ({ at, item_id: ref.item_id }));
  return { stale, missing, new_files: [...new_files] };
}
