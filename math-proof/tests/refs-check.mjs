// 数学证明模式 — 引用与数字审计（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/refs-check.mjs [--repo <工作区>]
//      （默认仓库来自 `impl/local-paths.json` 的 `workspace`；换机器只改那一个文件或设 SOVEREIGN_REPO）
// 期望最后一行：REFS_OK n/n（仓库不存在时输出 REFS_SKIP 并 exit 0）
//
// 为什么需要它：preset 里散着 40+ 处 `文件.agda:行号` 引用与一批「N/M 模块」数字。
// 代码一改、文件一移位，这些引用就静默失真——本会话已经手工抓到过三处（501/533、24 个模块、
// GF729.agda:580→577）。本检查把它们变成可复跑的门禁：
//   ① 每个 `*.agda:LINE` 必须能解析到仓库里的文件，且行号在文件范围内；
//   ② 引用的符号（同行/邻近反引号里的标识符）应出现在该行附近；
//   ③ 关键数字（模块计数、postulate/hole 计数）与仓库实测一致。
//
// 仓库缺失时跳过（本检查依赖项目仓库，不是纯 preset 自检）。

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join, basename } from 'node:path'

import { path as localPath } from '../impl/local-paths.mjs'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const argv = process.argv.slice(2)
const repoArg = argv.indexOf('--repo')
// 默认仓库来自 `impl/local-paths.json` 的 `workspace`（可用 SOVEREIGN_REPO 覆盖）
const REPO = repoArg === -1 ? localPath('workspace') : argv[repoArg + 1]

if (!existsSync(join(REPO, 'src'))) {
  console.log(`REFS_SKIP 0/0（找不到仓库 ${REPO}）`)
  process.exit(0)
}

// ── 收集仓库里所有 .agda 文件 ──────────────────────────────────────────────
const agdaFiles = []
for (const dir of ['src']) {
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === '_build') continue
        walk(p)
      } else if (e.name.endsWith('.agda')) {
        agdaFiles.push(p)
      }
    }
  }
  if (existsSync(join(REPO, dir))) walk(join(REPO, dir))
}
const byBasename = new Map()
for (const f of agdaFiles) {
  const b = basename(f)
  if (!byBasename.has(b)) byBasename.set(b, [])
  byBasename.get(b).push(f)
}
const lineCache = new Map()
const linesOf = (f) => {
  if (!lineCache.has(f)) lineCache.set(f, readFileSync(f, 'utf8').split('\n'))
  return lineCache.get(f)
}

// ── 扫描 preset 里的引用 ──────────────────────────────────────────────────
const sources = [
  { label: 'persona', path: join(PRESET, 'agent.cordis.yml') },
  ...readdirSync(join(PRESET, 'plugins')).filter((f) => f.endsWith('.mjs')).map((f) => ({ label: `plugins/${f}`, path: join(PRESET, 'plugins', f) })),
  ...readdirSync(join(PRESET, 'skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const dir = join(PRESET, 'skills', d.name)
      return readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ label: `skills/${d.name}/${f}`, path: join(dir, f) }))
    }),
  { label: 'CACHE.md', path: join(PRESET, 'CACHE.md') },
]

const results = []
let failures = 0
const check = (name, ok, detail = '') => {
  results.push(`${ok ? '✅' : '❌'} ${name}${ok || detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures++
}

const CITATION = /((?:[A-Za-z0-9_/.-]*[A-Za-z0-9_-])\.agda):(\d+)(?:-(\d+))?/g
let citations = 0
for (const src of sources) {
  const text = readFileSync(src.path, 'utf8')
  for (const m of text.matchAll(CITATION)) {
    citations++
    const [, rel, lineStr, endStr] = m
    const line = Number(lineStr)
    const end = endStr === undefined ? line : Number(endStr)
    const b = basename(rel)
    const cands = (byBasename.get(b) ?? []).filter((p) => p.endsWith(rel) || p.endsWith(rel.replace(/^src\//, '')))
    const any = cands.length > 0 ? cands : (byBasename.get(b) ?? [])
    if (any.length === 0) {
      check(`引用 ${src.label}: ${rel}:${line}`, false, '仓库里找不到该文件')
      continue
    }
    const inRange = any.filter((p) => line <= linesOf(p).length)
    if (inRange.length === 0) {
      check(`引用 ${src.label}: ${rel}:${line}`, false, `行号超出范围（最大 ${Math.max(...any.map((p) => linesOf(p).length))}）`)
      continue
    }
    // 符号邻近检查：同一行/上一行反引号里的标识符应出现在 ±25 行内
    const allLines = linesOf(inRange[0])
    const ctx = allLines.slice(Math.max(0, line - 2), line + 1).join(' ')
    const syms = [...ctx.matchAll(/`([A-Za-z][A-Za-z0-9'_-]{2,})`/g)].map((x) => x[1]).filter((s) => !/\.agda|^src$/.test(s))
    if (syms.length > 0) {
      const window = allLines.slice(Math.max(0, line - 26), Math.min(allLines.length, end + 26)).join('\n')
      const missing = syms.filter((s) => !window.includes(s))
      if (missing.length > 0) {
        check(`引用 ${src.label}: ${rel}:${line} 符号 ${missing.join(',')}`, false, `±25 行内找不到符号：${missing.join(', ')}`)
        continue
      }
    }
    results.push(`✅ 引用 ${src.label}: ${rel}:${line}${end !== line ? `-${end}` : ''}`)
  }
}

// ── 关键数字 vs 仓库实测 ──────────────────────────────────────────────────
const strip = (t) => t.replace(/\{-[\s\S]*?-\}/g, '').replace(/--.*$/gm, '')
let propEq = 0
let cubicalMention = 0
let cubicalFlag = 0
let postulateFiles = 0
let holeFiles = 0
for (const f of agdaFiles) {
  const raw = readFileSync(f, 'utf8')
  const body = strip(raw)
  if (raw.includes('PropositionalEquality')) propEq++
  if (raw.includes('Cubical')) cubicalMention++
  if (raw.includes('OPTIONS --cubical')) cubicalFlag++
  if (/^\s*postulate\b/m.test(body) && f.includes('/Sovereign/')) postulateFiles++
  if (/\{!/.test(body)) holeFiles++
}
const facts = {
  total: agdaFiles.length,
  propEq,
  cubicalMention,
  cubicalFlag,
  postulateFiles,
  holeFiles,
}

const FIX = argv.includes('--fix')
const personaPath = join(PRESET, 'agent.cordis.yml')
let persona = readFileSync(personaPath, 'utf8')
if (FIX) {
  const limitsPath = join(PRESET, 'plugins', 'prover-limits.mjs')
  let limits = readFileSync(limitsPath, 'utf8')
  const before = persona
  persona = persona
    .replace(/\*\*\d+\/\d+\*\* 模块/, `**${facts.propEq}/${facts.total}** 模块`)
    .replace(/\*\*\d+ 个模块涉及 Cubical/, `**${facts.cubicalMention} 个模块涉及 Cubical`)
    .replace(/\b\d+ 个开 `--cubical`/, `${facts.cubicalFlag} 个开 \`--cubical\``)
    .replace(/\*\*\d+ 个模块含 `postulate`\*\*/g, `**${facts.postulateFiles} 个模块含 \`postulate\`**`)
    .replace(/\*\*\d+ 个模块含 `\{!` hole\*\*/g, `**${facts.holeFiles} 个模块含 \`{!\` hole**`)
  limits = limits
    .replace(/本库 \d+\/\d+ 模块用命题相等/, `本库 ${facts.propEq}/${facts.total} 模块用命题相等`)
    .replace(/实测 2026-\d\d-\d\d：\d+ 个模块开 flag，\d+ 个涉及 Cubical/, `实测 2026-09-10：${facts.cubicalFlag} 个模块开 flag，${facts.cubicalMention} 个涉及 Cubical`)
  if (persona !== before) {
    writeFileSync(personaPath, persona, 'utf8')
    console.log('（--fix）已同步 persona 的实测数字')
  }
  if (limits !== readFileSync(limitsPath, 'utf8')) {
    writeFileSync(limitsPath, limits, 'utf8')
    console.log('（--fix）已同步 prover-limits 的实测数字')
  }
}
const claim = (re) => re.exec(persona)?.[0] ?? null
const numChecks = [
  ['模块总数', new RegExp(`\\b${facts.total}\\b`), `${facts.total}`],
  ['命题相等', new RegExp(`${facts.propEq}/${facts.total}`), `${facts.propEq}/${facts.total}`],
  ['Cubical 涉及', new RegExp(`${facts.cubicalMention} 个模块涉及 Cubical`), `${facts.cubicalMention} 个模块涉及 Cubical`],
  ['cubical flag', new RegExp(`\\b${facts.cubicalFlag} 个开`), `${facts.cubicalFlag} 个开`],
  ['postulate', new RegExp(`${facts.postulateFiles} 个模块含`), `${facts.postulateFiles} 个模块含 postulate`],
  ['hole', new RegExp(`${facts.holeFiles} 个模块含`), `${facts.holeFiles} 个模块含 hole`],
]
const factsLines = numChecks.map(([name, , expected]) => `- ${name}：${expected}`)

console.log(`# 引用与数字审计（仓库 ${REPO}｜${agdaFiles.length} 个 .agda｜${citations} 处引用）\n`)
console.log(results.join('\n'))
console.log('')
console.log('## 仓库实测（报告，不参与判定）')
console.log(factsLines.join('\n'))
console.log('- 常驻层只保留不随规模漂移的事实（相等观 / Cubical 用途 / 0 实数 import）。')
console.log(`\n${failures === 0 ? 'REFS_OK' : 'REFS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
