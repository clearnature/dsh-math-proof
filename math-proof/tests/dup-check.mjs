// 数学证明模式 — 重复正文检测（确定性，零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/dup-check.mjs [--json]
// 期望：DUP_OK（无超阈值重复）或 DUP_WARN n（有重复，但不超过基线）
//
// 为什么：同一事实写在 persona / 纪律段 / 技能里，改一处就漏一处——文档漂移就是这么来的。
// 本工具把「重复的长行」找出来（行级，长度 >= 24 字符，忽略纯标点差异），
// 并给出每处的位置，供人工决定「谁是唯一事实源、其余的改成指针」。
//
// 不做自动删除：删除正文属于内容决策，必须人来看（本项目反对信息截断）。

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { assemble } from './assemble-context.mjs'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

/** 归一化：去掉 markdown 前缀、空白、常见标点，只留实质字符。 */
function norm(line) {
  return line
    .replace(/^\s*[-*>|]\s*/, '')
    .replace(/[`*_#]/g, '')
    .replace(/[\s，。、；：（）()「」『』【】—－\-.,;:!?]/g, '')
    .trim()
}

const a = await assemble()
const sources = [
  { label: 'persona', text: a.persona },
  { label: '纪律段', text: a.disc },
  ...a.skills.flatMap((s) => [
    { label: `skill:${s.name}`, text: s.body },
    ...s.refs.map((r) => ({ label: `skill:${s.name}/${r.file}`, text: r.text })),
  ]),
]

const index = new Map()
for (const src of sources) {
  for (const raw of src.text.split('\n')) {
    const n = norm(raw)
    if (n.length < 24) continue
    if (!index.has(n)) index.set(n, { sample: raw.trim().slice(0, 90), hits: [] })
    index.get(n).hits.push(src.label)
  }
}

const dupes = [...index.values()]
  .filter((v) => new Set(v.hits).size >= 2)
  .sort((x, y) => y.hits.length - x.hits.length || y.sample.length - x.sample.length)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(dupes.map((d) => ({ line: d.sample, where: [...new Set(d.hits)] })), null, 2))
} else {
  console.log(`# 重复正文检测（${sources.length} 个来源，行级归一化，>= 24 字符）\n`)
  if (dupes.length === 0) {
    console.log('无重复长行 ✅')
  } else {
    console.log(`发现 **${dupes.length}** 组重复：\n`)
    for (const d of dupes.slice(0, 40)) {
      console.log(`- ${[...new Set(d.hits)].join(' ＋ ')}`)
      console.log(`  「${d.sample}${d.sample.length >= 90 ? '…' : ''}」`)
    }
    if (dupes.length > 40) console.log(`\n（仅显示前 40 组，共 ${dupes.length} 组；用 --json 看全部）`)
  }
  console.log(`\n${dupes.length === 0 ? 'DUP_OK' : 'DUP_WARN'} ${dupes.length} 组重复`)
}

// 门禁语义：出现重复长行即失败（修法是「定唯一事实源 + 其余改指针」，不是删正文）。
process.exit(dupes.length === 0 ? 0 : 1)
