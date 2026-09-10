// 数学证明模式 — 知识覆盖校验（确定性，零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/knowledge-check.mjs
// 期望最后一行：KNOWLEDGE_OK n/n
//
// 它回答另一个问题：**evals.json 里承诺的知识，preset 里真的有吗？**
// 对每条 eval 的 `expect.structure` 条目，在全量知识里找：常驻层（persona/纪律/工具描述/技能索引）
// 或按需层（技能正文/references/经验库种子/dype 指纹表）。
// 找不到 = 要么 eval 写了不存在的产出，要么知识在某次重构里悄悄丢了。
//
// 与 eval-check.mjs 分工：eval-check 管「场景覆盖全不全」，knowledge-check 管「知识在不在」。

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assemble } from './assemble-context.mjs'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const spec = JSON.parse(readFileSync(join(HERE, 'evals.json'), 'utf8'))

/** 不需要在全量知识里出现的通用词（它们是对格式/状态的描述，不是知识锚点）。 */
const GENERIC = new Set(['exit', 'open', 'exit 0', '环', '缺口', '趋势', '依赖图', '拆解', '三筛', '建议下一步', '卡点', 'deps', 'add', 'journal', 'brief'])

const a = await assemble()
const limits = (await import(join(PRESET, 'plugins', 'prover-limits.mjs'))).SEED
const dype = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))

const corpus = [
  { label: '常驻: persona', text: a.persona },
  { label: '常驻: 纪律段', text: a.disc },
  { label: '常驻: 工具描述', text: a.tools.map((t) => `${t.name} ${t.description}`).join('\n') },
  { label: '常驻: 技能索引', text: a.skillIndex },
  ...a.skills.flatMap((s) => [
    { label: `按需: ${s.name}`, text: s.body },
    ...s.refs.map((r) => ({ label: `按需: ${s.name}/${r.file}`, text: r.text })),
  ]),
  { label: '按需: 经验库种子', text: limits.map((e) => Object.values(e).filter((v) => typeof v === 'string').join(' ')).join('\n') },
  { label: '按需: dype 指纹表', text: dype.FINGERPRINTS.map((f) => f.fix).join('\n') },
  // 工具实现：工具自己产出的格式/字段（如 `审计结论`、`notFlag`）也属于 preset 的知识，
  // 但它们不在模型读到的文本层——单列一类，避免把「格式锚点」误判成「知识缺失」。
  ...readdirSync(join(PRESET, 'plugins'))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => ({ label: `实现: ${f}`, text: readFileSync(join(PRESET, 'plugins', f), 'utf8') })),
]

const residentLabels = new Set(corpus.filter((c) => c.label.startsWith('常驻')).map((c) => c.label))
const implLabels = new Set(corpus.filter((c) => c.label.startsWith('实现')).map((c) => c.label))
const layerOf = (hits) => {
  if (hits.some((h) => residentLabels.has(h))) return '常驻'
  if (hits.some((h) => h.startsWith('按需'))) return '按需'
  if (hits.some((h) => implLabels.has(h))) return '实现（工具输出）'
  return '未知'
}

function locate(needle) {
  const hits = corpus.filter((c) => c.text.includes(needle)).map((c) => c.label)
  if (hits.length === 0) return { found: false, hits }
  return { found: true, hits, resident: hits.some((h) => residentLabels.has(h)) }
}

const rows = []
const problems = []
const counts = {}
let checked = 0
for (const e of spec.evals) {
  const anchors = (e.expect?.structure ?? []).filter((s) => !GENERIC.has(s))
  for (const s of anchors) {
    checked++
    const r = locate(s)
    if (!r.found) {
      problems.push(`eval ${e.id}（${e.name}）: 产出锚点 "${s}" 在全量知识里找不到`)
      rows.push(`❌ eval ${String(e.id).padStart(2)} 「${s}」`)
    } else {
      const layer = layerOf(r.hits)
      counts[layer] = (counts[layer] ?? 0) + 1
      rows.push(`✅ eval ${String(e.id).padStart(2)} 「${s}」 ← ${layer}（${r.hits[0]}）`)
    }
  }
}

console.log(`# 知识覆盖校验（${spec.evals.length} 条 eval，${checked} 个知识锚点）\n`)
console.log(rows.join('\n'))
console.log('')
console.log(`- 锚点分层: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
if (problems.length > 0) {
  console.log('\n## 问题')
  for (const p of problems) console.log(`- ${p}`)
}
const total = checked + 1
console.log(`\n${problems.length === 0 ? 'KNOWLEDGE_OK' : 'KNOWLEDGE_FAIL'} ${total - problems.length}/${total}`)
process.exit(problems.length === 0 ? 0 : 1)
