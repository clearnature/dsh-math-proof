// 数学证明模式 — 文档门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/docs-check.mjs
// 期望最后一行：DOCS_OK n/n
//
// 为什么要有它：**手写的架构文档会漂移**，而漂移的文档比没有文档更坏（它让人相信错的东西）。
// 本门禁钉死四件事：
//   1. `docs/maps/M2-dependency.md` 与源码**逐字节一致**（跑 docs-gen --check）——结构类文档不许手改；
//   2. 六张地图文件齐、且都被 `docs/README.md` 索引到（不多不少）；
//   3. 每个地图至少有一个 Mermaid 块，且代码围栏成对闭合（否则 GitHub 上渲染成一堆乱码）；
//   4. 文档里的相对链接（文件路径）都真实存在——死链会让读者跳到 404。
//
// 与知识类断言的分工：`knowledge-check` 管「eval 承诺的知识在不在技能里」，
// 本门禁只管**架构文档的结构完整性与一致性**。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const DOCS = join(PRESET, 'docs')
const MAPS = join(DOCS, 'maps')

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

// ── 1) M2 生成物与源码一致 ─────────────────────────────────────────────────
const gen = spawnSync(process.execPath, [join(PRESET, 'scripts', 'docs-gen.mjs'), '--check'], { encoding: 'utf8' })
ok('M2 依赖图与源码一致（生成物不许手改）', gen.status === 0, `${(gen.stdout ?? '').trim()} ${(gen.stderr ?? '').trim()}`.slice(0, 160))

// ── 2) 地图文件齐 + 被索引 ────────────────────────────────────────────────
const maps = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => f.endsWith('.md')).sort() : []
ok('docs/maps 至少 6 张地图', maps.length >= 6, maps.join(', '))
const expected = ['M1-architecture.md', 'M2-dependency.md', 'M3-data-flow.md', 'M4-state-and-storage.md', 'M5-lifecycle.md', 'M6-evidence-chain.md']
for (const f of expected) ok(`地图存在：${f}`, maps.includes(f), maps.join(','))

const index = existsSync(join(DOCS, 'README.md')) ? readFileSync(join(DOCS, 'README.md'), 'utf8') : ''
ok('docs/README.md 存在', index !== '')
for (const f of expected) ok(`索引指向 ${f}`, index.includes(`maps/${f}`), '')

// 索引里出现的每个 maps/*.md 都必须真实存在（防死链）
for (const m of index.matchAll(/\((maps\/[A-Za-z0-9._-]+\.md)\)/g)) {
  ok(`索引链接可解析：${m[1]}`, existsSync(join(DOCS, m[1])), m[1])
}

// ── 3) Mermaid 块与围栏配对 ───────────────────────────────────────────────
for (const f of maps) {
  const text = readFileSync(join(MAPS, f), 'utf8')
  const fences = (text.match(/^```/gm) ?? []).length
  ok(`${f}：代码围栏成对`, fences % 2 === 0, `fences=${fences}`)
  const mermaid = (text.match(/^```mermaid$/gm) ?? []).length
  ok(`${f}：含 Mermaid 图`, mermaid >= 1, `mermaid=${mermaid}`)
  // 每个 mermaid 块里必须至少有一条边/参与者（空图等于没画）
  const blocks = text.split(/^```mermaid$/m).slice(1).map((b) => b.split(/^```/m)[0])
  for (const [i, b] of blocks.entries()) {
    const hasContent = /-->|->>|-->>|participant|graph |sequenceDiagram/.test(b)
    ok(`${f}：Mermaid 块 ${i + 1} 非空`, hasContent, b.trim().slice(0, 60))
  }
}

// ── 4) 文档里的相对文件链接都存在 ─────────────────────────────────────────
const releasesDir = join(DOCS, 'releases')
const releases = existsSync(releasesDir) ? readdirSync(releasesDir).filter((f) => f.endsWith('.md')).sort().map((f) => join(releasesDir, f)) : []
ok('docs/releases 至少一份版本说明', releases.length >= 1, releases.map((f) => f.split('/').pop()).join(','))
const docFiles = [join(DOCS, 'README.md'), ...maps.map((f) => join(MAPS, f)), ...releases]
let links = 0
for (const file of docFiles) {
  const text = readFileSync(file, 'utf8')
  for (const m of text.matchAll(/\]\((\.{1,2}\/[^)#\s]+?)\)/g)) {
    const target = resolve(dirname(file), m[1])
    links++
    ok(`${relative(PRESET, file)} → ${m[1]} 可解析`, existsSync(target), target)
  }
}
resultCount(links)

function resultCount(n) {
  results.push(`⏵ 共校验 ${n} 条相对链接`)
}

// ── 5) 反漂移：文档里不得写死会漂移的计数 ─────────────────────────────────
// （本项目的纪律：模块数/断言数/字符数一律现场取，不写进文档）
const VOLATILE = [
  [/\b\d{3}\s*个断言/, '断言总数'],
  [/共\s*\d+\s*个模块/, '模块数'],
]
for (const file of docFiles) {
  const text = readFileSync(file, 'utf8')
  for (const [re, label] of VOLATILE) {
    ok(`${relative(PRESET, file)} 未写死「${label}」`, !re.test(text), (re.exec(text) ?? [''])[0])
  }
}

// 文档必须提到现场取数的方式（否则读者只能相信文档）
const all = docFiles.map((f) => readFileSync(f, 'utf8')).join('\n')
ok('文档说明「数字现场取」的纪律', /refs-check|assemble-context|docs-gen/.test(all), '')

console.log('# 文档门禁（架构地图 / 生成物一致性 / 链接）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'DOCS_OK' : 'DOCS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
