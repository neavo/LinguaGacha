import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const script_dir = path.dirname(fileURLToPath(import.meta.url))
const project_root = path.resolve(script_dir, "..")

const css_files = [
  path.join(project_root, "src/renderer/index.css"),
  path.join(project_root, "src/renderer/app/shell/app-shell.css"),
]

const token_owner = path.join(project_root, "src/renderer/index.css")

function collect_files(start_dir) {
  const entries = readdirSync(start_dir)
  const files = []

  for (const entry of entries) {
    const next_path = path.join(start_dir, entry)
    const next_stat = statSync(next_path)

    if (next_stat.isDirectory()) {
      files.push(...collect_files(next_path))
      continue
    }

    files.push(next_path)
  }

  return files
}

function parse_css_blocks(content) {
  const lines = content.split(/\r?\n/)
  const blocks = []
  let pending_selector_lines = []
  let current_selector = ""
  let current_body = []
  let depth = 0

  for (const line of lines) {
    if (depth === 0) {
      pending_selector_lines.push(line)

      if (!line.includes("{")) {
        continue
      }

      const selector_source = pending_selector_lines.join(" ")
      current_selector = selector_source.slice(0, selector_source.indexOf("{")).trim()
      current_body = [line.slice(line.indexOf("{") + 1)]
      pending_selector_lines = []
      depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)
      continue
    }

    current_body.push(line)
    depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0)

    if (depth === 0) {
      const selectors = current_selector
        .split(",")
        .map((selector) => selector.replace(/\s+/g, " ").trim())
        .filter((selector) => selector.length > 0)

      blocks.push({
        selectors,
        body: current_body.join("\n"),
      })
      current_selector = ""
      current_body = []
    }
  }

  return blocks
}

function find_forbidden_properties(body, properties) {
  const matches = []

  for (const property of properties) {
    const property_regex = new RegExp(`(^|\\n)\\s*${property}\\s*:`, "m")

    if (property_regex.test(body)) {
      matches.push(property)
    }
  }

  return matches
}

const errors = []
const all_renderer_files = collect_files(path.join(project_root, "src/renderer"))

// 为什么：全局视觉 token 只能在 index.css 里定义，避免页面层再次长出私有语义。
for (const file_path of all_renderer_files) {
  if (file_path === token_owner) {
    continue
  }

  const content = readFileSync(file_path, "utf8")

  if (/--ui-[a-z0-9-]+\s*:/.test(content)) {
    errors.push(`${path.relative(project_root, file_path)} 违规定义了 --ui-* token`)
  }
}

const selector_rules = [
  {
    selector_regex:
      /^\.(project-home__panel|workbench-page__stat-card|workbench-page__table-card|workbench-page__command-card)$/,
    forbidden_properties: ["background", "box-shadow", "border-radius", "border-color"],
  },
  {
    selector_regex:
      /^\.(workbench-page__command-button(\[data-slot='button'\])?|project-home__action)$/,
    forbidden_properties: ["border-radius", "box-shadow", "background"],
  },
  {
    selector_regex:
      /^\.(workbench-page__table-head-row( th)?|workbench-page__table-row( td)?|workbench-page__table-row:hover td|workbench-page__table-row--selected td)$/,
    forbidden_properties: ["border-bottom", "background", "height", "font-size", "color"],
  },
]

// 为什么：页面命名空间只允许保留布局与密度，不应该再定义基础视觉。
for (const file_path of css_files) {
  const content = readFileSync(file_path, "utf8")
  const blocks = parse_css_blocks(content)

  for (const block of blocks) {
    for (const selector of block.selectors) {
      for (const rule of selector_rules) {
        if (!rule.selector_regex.test(selector)) {
          continue
        }

        const forbidden_matches = find_forbidden_properties(block.body, rule.forbidden_properties)

        if (forbidden_matches.length === 0) {
          continue
        }

        errors.push(
          `${path.relative(project_root, file_path)} 中的 ${selector} 不应定义 ${forbidden_matches.join(", ")}`
        )
      }
    }
  }
}

if (errors.length > 0) {
  console.error("UI 设计系统审查失败：")

  for (const error of errors) {
    console.error(`- ${error}`)
  }

  process.exit(1)
}

console.log("UI 设计系统审查通过。")
