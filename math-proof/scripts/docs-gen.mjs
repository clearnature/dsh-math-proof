// 数学证明模式 — 文档生成器（零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/docs-gen.mjs            # 写入 docs/maps/M2-dependency.md
//   node ~/.dsh/.agent-presets/math-proof/scripts/docs-gen.mjs --check    # 只校验（文档是否与源码一致），不一致退出 1
//   node ~/.dsh/.agent-presets/math-proof/scripts/docs-gen.mjs --print    # 打到 stdout
//
// 为什么要有它：**手写的依赖图一定会漂移**（本项目的第一原则：数字与结构不写进文档，由脚本现场取）。
// 所以 `docs/maps/M2-dependency.md` 整篇由本脚本从源码生成：
//   · 组合行（agent.cordis.yml 的行、分组、外部包 / 本地插件）
//   · 模块依赖（plugins / impl / tests / scripts 里的相对 import）→ Mermaid 图
//   · 外部依赖（每个模块 import 的 `node:` 内建与 `@deepseek-ai/*` 包）
//   · 工具 → 实现文件 → 依赖模块（谁注册了哪个工具）
//   · 数据文件 → 写入者（哪个模块写状态目录里的哪类文件）
// `tests/docs-check.mjs` 调 `--check` 做漂移门禁；改代码忘了改文档，门禁会红。

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRESET = dirname(HERE)
const OUT = join(PRESET, 'docs', 'maps', 'M2-dependency.md')

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const PRINT = argv.includes('--print')

// ── 采集 ────────────────────────────────────────────────────────────────────

const dirs = ['plugins', 'impl', 'tests', 'scripts']
const modules = []
for (const d of dirs) {
  const abs = join(PRESET, d)
  if (!existsSync(abs)) continue
  for (const f of readdirSync(abs)) {
    if (!f.endsWith('.mjs')) continue
    modules.push({ id: `${d}/${f}`, dir: d, file: f, text: readFileSync(join(abs, f), 'utf8') })
  }
}
modules.sort((a, b) => a.id.localeCompare(b.id))

/** 相对 import（模块依赖图只用它）。 */
function relativeImports(text) {
  const out = new Set()
  for (const m of text.matchAll(/^import[^'"]*from\s+'([^']+)'/gm)) if (m[1].startsWith('.')) out.add(m[1])
  return [...out]
}

/** 包依赖：node 内建与外部包。 */
function packageImports(text) {
  const out = new Set()
  for (const m of text.matchAll(/^import[^'"]*from\s+'([^']+)'/gm)) if (!m[1].startsWith('.')) out.add(m[1])
  return [...out]
}

/** 把 `../impl/x.mjs` 这类相对路径解析成模块 id。 */
function resolveModule(fromDir, spec) {
  const parts = join(fromDir, spec).split('/')
  const stack = []
  for (const p of parts) {
    if (p === '.' || p === '') continue
    if (p === '..') stack.pop()
    else stack.push(p)
  }
  return stack.join('/')
}

/** 组合行（含分组缩进的扁平化）。 */
function compositionRows() {
  const text = readFileSync(join(PRESET, 'agent.cordis.yml'), 'utf8')
  const rows = []
  let group = null
  for (const line of text.split('\n')) {
    const idm = /^(\s*)- id:\s*(.+?)\s*$/.exec(line)
    if (idm !== null) {
      const row = { indent: idm[1].length, id: idm[2].replace(/^['"]|['"]$/g, ''), name: '', disabled: false }
      rows.push(row)
      continue
    }
    const cur = rows[rows.length - 1]
    if (cur === undefined) continue
    const nm = /^\s*name:\s*(.+?)\s*$/.exec(line)
    if (nm !== null) {
      cur.name = nm[1].replace(/^['"]|['"]$/g, '')
      continue
    }
    if (/^\s*disabled:\s*true\s*$/.test(line)) cur.disabled = true
  }
  // 顶层（indent 0）里 name 为 cordis:group 的作为分组标题，其后的深缩进行归入该组
  const out = []
  let current = null
  for (const r of rows) {
    if (r.indent === 0 && r.name !== 'cordis:group') {
      current = null
      out.push({ ...r, group: null })
      continue
    }
    if (r.indent === 0) {
      current = r.id
      out.push({ ...r, group: null, isGroup: true })
      continue
    }
    out.push({ ...r, group: current })
  }
  void group
  return out
}

/** 工具名 → 实现模块（在 `ctx.tools.register({ name: '…' })` 里找）。 */
function registeredTools() {
  const out = []
  for (const m of modules) {
    for (const mm of m.text.matchAll(/name:\s*'((?:proof_|prover_)[a-z_]+)'/g)) out.push({ tool: mm[1], module: m.id })
  }
  return out.sort((a, b) => a.tool.localeCompare(b.tool))
}

/** 状态文件种类：在模块里出现的 `state/math-proof/…` 文件名模式。 */
function stateWriters() {
  const kinds = new Map()
  const note = (kind, module) => {
    if (!kinds.has(kind)) kinds.set(kind, new Set())
    kinds.get(kind).add(module)
  }
  for (const m of modules) {
    if (/state',\s*'math-proof',\s*'receipts'/.test(m.text)) note('`receipts/`（编译回执 + `agg-*.json` 聚合索引）', m.id)
    if (/state',\s*'math-proof',\s*'oracle-receipts'/.test(m.text)) note('`oracle-receipts/`（oracle 回执）', m.id)
    if (/state',\s*'math-proof',\s*'oracle-kit'/.test(m.text)) note('`oracle-kit.json`（oracle kit 预计算索引）', m.id)
    if (/state',\s*'math-proof',\s*'prover-limits'/.test(m.text)) note('`prover-limits.json`（工具链限制经验库）', m.id)
    if (/dag-\$\{hash\}/.test(m.text)) note('`dag-<ws-hash>.json`（命题台账，**主数据**）', m.id)
    if (/history-\$\{hash\}/.test(m.text)) note('`history-<ws-hash>.json`（评分历史，限 200 条）', m.id)
    if (/checkpoint-\$\{hash\}/.test(m.text)) note('`checkpoint-<ws-hash>.json`（见证检查点，仓库之外）', m.id)
    if (/witness-\$\{hash\}/.test(m.text)) note('`witness-<ws-hash>/`（独立 git 见证仓库）', m.id)
    if (/graph-\$\{|`graph-\$\{/.test(m.text)) note('`graph-<ws-hash>.{json,md}`（知识图谱导出，可重建）', m.id)
    if (/^const LOCK_SUFFIX|\.lock`/.test(m.text)) note('`*.lock`（台账写锁，带 PID 存活探测）', m.id)
  }
  return [...kinds.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

// ── 渲染 ────────────────────────────────────────────────────────────────────

const rows = compositionRows()
const tools = registeredTools()
const stateFiles = stateWriters()

const localRows = rows.filter((r) => r.name.startsWith('./'))
const pkgRows = rows.filter((r) => r.name.startsWith('@deepseek-ai/'))
const groups = rows.filter((r) => r.isGroup === true)

// 模块依赖图（Mermaid）
const edges = []
for (const m of modules) {
  for (const spec of relativeImports(m.text)) {
    const target = resolveModule(m.dir, spec)
    const hit = modules.find((x) => x.id === target)
    if (hit !== undefined) edges.push([m.id, hit.id])
  }
}
const edgeLines = edges
  .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]))
  .map(([a, b]) => `  ${a.replace(/[/.]/g, '_')}["${a}"] --> ${b.replace(/[/.]/g, '_')}["${b}"]`)

const nodeIds = new Set(modules.map((m) => m.id))
const edgeTargets = new Set(edges.map((e) => e[1]))
const leaves = [...nodeIds].filter((n) => !edgeTargets.has(n)).sort()

const lines = []
lines.push('<!-- 本文件由 `scripts/docs-gen.mjs` 从源码生成，请勿手改。改动后跑 `node scripts/docs-gen.mjs` 重生成。 -->')
lines.push('')
lines.push('# M2 · 依赖图（组合行 / 模块 / 外部包 / 数据文件）')
lines.push('')
lines.push('> 生成源：`agent.cordis.yml` + `plugins/` `impl/` `tests/` `scripts/` 的源码。')
lines.push('> 漂移门禁：`node tests/docs-check.mjs`（不一致即失败）。')
lines.push('')
lines.push('## M2.1 组合行（agent 平面）')
lines.push('')
const uniqueSpecs = new Set(pkgRows.map((r) => r.name))
const uniquePkgs = new Set(pkgRows.map((r) => r.name.split('/').slice(0, 2).join('/')))
lines.push(
  `共 **${rows.filter((r) => r.isGroup !== true).length}** 行 = 外部包 **${pkgRows.length}** 条行（去重后 **${uniqueSpecs.size}** 条 spec / **${uniquePkgs.size}** 个包）` +
    ` + 本地插件 **${localRows.length}** 个，另有 **${groups.length}** 个分组。`,
)
lines.push('')
lines.push('| 行 id | 提供者 | 所属分组 | 状态 |')
lines.push('| --- | --- | --- | --- |')
for (const r of rows) {
  if (r.isGroup === true) {
    lines.push(`| \`${r.id}\` | **分组**（\`cordis:group\`） | — | ${r.disabled ? '禁用' : '启用'} |`)
    continue
  }
  lines.push(`| \`${r.id}\` | \`${r.name}\` | ${r.group === null ? '—' : `\`${r.group}\``} | ${r.disabled ? '禁用' : '启用'} |`)
}
lines.push('')
lines.push('## M2.2 模块依赖图')
lines.push('')
lines.push('```mermaid')
lines.push('graph LR')
lines.push(...edgeLines)
lines.push('```')
lines.push('')
lines.push(`- 有出边的模块（**核心层**）：${[...new Set(edges.map((e) => e[0]))].sort().map((x) => `\`${x}\``).join('、')}`)
lines.push(`- 无出边的模块（**叶子/独立**）：${leaves.map((x) => `\`${x}\``).join('、')}`)
lines.push('')
lines.push('> 依赖方向即「谁可以 import 谁」：`plugins/` 是注册层（薄），`impl/` 是可热读共享层，')
lines.push('> `tests/` 与 `scripts/` 只消费、不被消费（所以它们不会出现在别人的 import 里）。')
lines.push('')
lines.push('## M2.3 外部依赖')
lines.push('')
lines.push('| 模块 | node 内建 | 外部包 |')
lines.push('| --- | --- | --- |')
for (const m of modules) {
  const pkgs = packageImports(m.text)
  const builtins = pkgs.filter((p) => p.startsWith('node:'))
  const external = pkgs.filter((p) => !p.startsWith('node:'))
  if (builtins.length === 0 && external.length === 0) continue
  lines.push(`| \`${m.id}\` | ${builtins.map((b) => `\`${b}\``).join(' ') || '—'} | ${external.map((b) => `\`${b}\``).join(' ') || '—'} |`)
}
lines.push('')
lines.push('## M2.4 工具 → 实现')
lines.push('')
lines.push('| 工具 | 实现模块 |')
lines.push('| --- | --- |')
for (const t of tools) lines.push(`| \`${t.tool}\` | \`${t.module}\` |`)
lines.push('')
lines.push('## M2.5 数据文件 → 写入者')
lines.push('')
lines.push(`状态目录：\`~/.dsh/state/math-proof/\`（**不写进项目仓库**；preset 目录下另有 \`state/\` 存市场快照与宿主组合 dump）。`)
lines.push('')
lines.push('| 数据文件 | 写入者 |')
lines.push('| --- | --- |')
for (const [kind, writers] of stateFiles) lines.push(`| ${kind} | ${[...writers].map((w) => `\`${w}\``).join('、')} |`)
lines.push('')
lines.push('> 维护入口：`scripts/state-gc.mjs`（归档回执 / 重建聚合 / 压缩见证 / 清理图谱导出）。')

const content = `${lines.join('\n')}\n`

if (PRINT) {
  console.log(content)
  process.exit(0)
}

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null
  if (current === content) {
    console.log('DOCS_M2_OK（M2 依赖图与源码一致）')
    process.exit(0)
  }
  console.log('DOCS_M2_STALE（M2 与源码不一致；跑 `node scripts/docs-gen.mjs` 重生成）')
  if (current === null) console.log(`- 文件不存在：${OUT}`)
  process.exit(1)
}

writeFileSync(OUT, content)
const bytes = statSync(OUT).size
console.log(`已生成 ${relative(PRESET, OUT)}（${lines.length} 行 / ${(bytes / 1024).toFixed(1)} KB）`)
console.log(`- 组合行 ${rows.filter((r) => r.isGroup !== true).length}｜模块 ${modules.length}｜import 边 ${edges.length}｜工具 ${tools.length}｜数据文件 ${stateFiles.length}`)
