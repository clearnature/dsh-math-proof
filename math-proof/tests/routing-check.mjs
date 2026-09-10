// 数学证明模式 — 技能路由歧义检查（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/routing-check.mjs
// 期望：ROUTING_OK（技能描述两两相似度均低于阈值）
//
// 为什么：9 个技能靠 `description` + `whenToUse` 被路由。若两条描述高度重叠，
// 模型会随机挑一个（或都不挑），而我们有「Do NOT trigger for」却没人验证它够不够区分。
// 本检查用字符 bigram + 英文词做 Jaccard 相似度，超阈值就点名——提示把边界写清。

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const THRESHOLD = Number(process.argv[2] ?? 0.55)

const skills = readdirSync(join(PRESET, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => {
    const text = readFileSync(join(PRESET, 'skills', d.name, 'SKILL.md'), 'utf8')
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? ''
    const field = (k) => (new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm)?.[1] ?? '').trim()
    return { name: d.name, text: `${field('description')} ${field('whenToUse')}` }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

/** 特征集合：CJK 双字组 + 英文小写词（长度 ≥3）。 */
function features(s) {
  const out = new Set()
  const cjk = s.match(/[\u4e00-\u9fff]+/g) ?? []
  for (const run of cjk) {
    for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2))
  }
  for (const w of s.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []) out.add(w)
  return out
}
const jaccard = (a, b) => {
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

const feats = skills.map((s) => ({ ...s, f: features(s.text) }))
const rows = []
let worst = 0
for (let i = 0; i < feats.length; i++) {
  for (let j = i + 1; j < feats.length; j++) {
    const sim = jaccard(feats[i].f, feats[j].f)
    worst = Math.max(worst, sim)
    if (sim >= THRESHOLD) rows.push([sim, feats[i].name, feats[j].name])
  }
}
rows.sort((a, b) => b[0] - a[0])

console.log(`# 技能路由歧义检查（${skills.length} 个技能｜阈值 ${THRESHOLD}）\n`)
if (rows.length === 0) {
  console.log(`无超阈值重叠 ✅（最高相似度 ${worst.toFixed(3)}）`)
} else {
  console.log('| 相似度 | 技能 A | 技能 B |')
  console.log('| --- | --- | --- |')
  for (const [s, a, b] of rows) console.log(`| ${s.toFixed(3)} | ${a} | ${b} |`)
  console.log(`\n最高相似度 ${worst.toFixed(3)}；请把两者的「不触发（Do NOT trigger for）」边界写得更互斥。`)
}
console.log(`\n${rows.length === 0 ? 'ROUTING_OK' : 'ROUTING_WARN'} ${rows.length === 0 ? '0 组超阈值' : `${rows.length} 组超阈值`}`)
process.exit(0)
