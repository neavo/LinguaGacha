import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const script_dir = path.dirname(fileURLToPath(import.meta.url))
const project_root = path.resolve(script_dir, "..")

const TOKEN_OWNER_RELATIVE_PATH = "src/renderer/index.css"
const token_owner = path.join(project_root, TOKEN_OWNER_RELATIVE_PATH)
const forbidden_font_weight_values = new Set(["500", "600", "700", "800", "900"])

// 为什么：这组规则对应 SPEC 的“全局 token、主题与中文强调”，负责拦截可以稳定自动判定的硬违规。
const FILE_RULE_GROUPS = [
  {
    name: "全局 token、主题与中文强调",
    rules: [
      {
        should_skip: (file_path) => file_path === token_owner,
        find_matches: (content) => find_pattern_matches(content, /--ui-[a-z0-9-]+\s*:/, "--ui-* token"),
        build_error: (relative_path) =>
          `${relative_path} 违规定义了 --ui-* token，请改到 ${TOKEN_OWNER_RELATIVE_PATH}`,
      },
      {
        should_skip: (file_path) => file_path === token_owner,
        find_matches: (content) =>
          find_pattern_matches(content, /-webkit-text-stroke\s*:/, "-webkit-text-stroke"),
        build_error: (relative_path) =>
          `${relative_path} 违规则私写了 -webkit-text-stroke，请改到 ${TOKEN_OWNER_RELATIVE_PATH}，并改用 .ui-text-emphasis 或 data-ui-text="emphasis"`,
      },
      {
        find_matches: find_invalid_font_weight_values,
        build_error: (relative_path, matches) =>
          `${relative_path} 违规则使用了 font-weight: ${matches.join(", ")}；请改用 .ui-text-emphasis 或 data-ui-text="emphasis"`,
      },
      {
        find_matches: find_forbidden_tailwind_font_tokens,
        build_error: (relative_path, matches) =>
          `${relative_path} 违规则使用了 ${matches.join(", ")}；请改用 .ui-text-emphasis 或 data-ui-text="emphasis"`,
      },
    ],
  },
]

// 为什么：这组规则对应 SPEC 的“页面层边界”，负责拦截已接入命名空间的基础视觉越权。
const CSS_SELECTOR_RULE_GROUPS = [
  {
    name: "页面容器缩进契约",
    rules: [
      {
        component_name: "PageShell",
        selector_regex:
          /^\.(basic-settings-page|debug-panel-page|project-home|workbench-page)$/,
        forbidden_properties: [
          "padding",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left",
          "margin",
          "margin-top",
          "margin-right",
          "margin-bottom",
          "margin-left",
        ],
      },
    ],
  },
  {
    name: "页面层基础视觉边界",
    rules: [
      {
        component_name: "Card",
        selector_regex:
          /^\.(project-home__panel|workbench-page__stat-card|workbench-page__table-card|workbench-page__command-card)$/,
        forbidden_properties: ["background", "box-shadow", "border-radius", "border-color"],
      },
      {
        component_name: "Button",
        selector_regex:
          /^\.(workbench-page__command-button(\[data-slot='button'\])?|project-home__action)$/,
        forbidden_properties: ["border-radius", "box-shadow", "background"],
      },
      {
        component_name: "Table",
        selector_regex:
          /^\.(workbench-page__table-head-row( th)?|workbench-page__table-row( td)?|workbench-page__table-row:hover td|workbench-page__table-row--selected td)$/,
        forbidden_properties: ["border-bottom", "background", "height", "font-size", "color"],
      },
    ],
  },
]

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

function find_pattern_matches(content, pattern, label) {
  if (pattern.test(content)) {
    return [label]
  }

  return []
}

function collect_unique_matches(find_matches, content) {
  return Array.from(new Set(find_matches(content)))
}

function find_invalid_font_weight_values(content) {
  const matches = [...content.matchAll(/font-weight\s*:\s*([^;]+);/g)]

  return matches
    .map((match) => match[1].trim())
    .filter((value) => forbidden_font_weight_values.has(value))
}

function find_forbidden_tailwind_font_tokens(content) {
  const matches = [...content.matchAll(/(?:^|[\s"'`])(?:[a-z-]+:)*font-(medium|semibold|bold|extrabold|black)(?=$|[\s"'`])/gm)]

  return matches.map((match) => `font-${match[1]}`)
}

function build_component_boundary_error(relative_path, component_name, selector, forbidden_matches) {
  return `${relative_path} 中的 ${selector} 不应定义 ${forbidden_matches.join(", ")}；请把 ${component_name} 基础视觉收回到 ui 组件或 ${TOKEN_OWNER_RELATIVE_PATH}`
}

function audit_file_rule_groups(file_path, content) {
  const relative_path = path.relative(project_root, file_path)
  const errors = []

  for (const group of FILE_RULE_GROUPS) {
    for (const rule of group.rules) {
      if (rule.should_skip?.(file_path)) {
        continue
      }

      const matches = collect_unique_matches(rule.find_matches, content)

      if (matches.length === 0) {
        continue
      }

      errors.push(rule.build_error(relative_path, matches))
    }
  }

  return errors
}

function audit_css_selector_rule_groups(file_path, blocks) {
  const relative_path = path.relative(project_root, file_path)
  const errors = []

  for (const block of blocks) {
    for (const selector of block.selectors) {
      for (const group of CSS_SELECTOR_RULE_GROUPS) {
        for (const rule of group.rules) {
          if (!rule.selector_regex.test(selector)) {
            continue
          }

          const forbidden_matches = find_forbidden_properties(block.body, rule.forbidden_properties)

          if (forbidden_matches.length === 0) {
            continue
          }

          errors.push(
            build_component_boundary_error(
              relative_path,
              rule.component_name,
              selector,
              forbidden_matches
            )
          )
        }
      }
    }
  }

  return errors
}

const errors = []
const all_renderer_files = collect_files(path.join(project_root, "src/renderer"))
const css_files = all_renderer_files.filter((file_path) => path.extname(file_path) === ".css")

// 为什么：先跑文件级硬规则，集中处理 token、强调文本与粗体写法这类可以直接扫源码的违规。
for (const file_path of all_renderer_files) {
  const content = readFileSync(file_path, "utf8")
  errors.push(...audit_file_rule_groups(file_path, content))
}

// 为什么：再跑页面命名空间级规则，只拦截已经明确接入门闩的 Card / Button / Table 基础视觉越权。
for (const file_path of css_files) {
  const content = readFileSync(file_path, "utf8")
  const blocks = parse_css_blocks(content)
  errors.push(...audit_css_selector_rule_groups(file_path, blocks))
}

if (errors.length > 0) {
  console.error("UI 设计系统审查失败：")

  for (const error of errors) {
    console.error(`- ${error}`)
  }

  process.exit(1)
}

console.log("UI 设计系统审查通过。")
