// 数学证明模式 — 缓存前缀稳定性检查（确定性，零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/cache-check.mjs
// 期望最后一行：CACHE_OK n/n
//
// 依据（本项目 Reasonix 文档的实测经验）：
//   · DeepSeek 上下文硬盘缓存按**完整前缀单元**命中（system + tools + messages 一体）；
//   · 工具定义参与缓存计算，**列表顺序 / 字段顺序 / 字段结构必须完全一致**；
//   · 「重复内容放开头，差异内容放末尾」——稳定前缀 + 追加式增长是唯一正确形态；
//   · 前缀里任何一处字节漂移（时间戳、随机数、顺序不定）都会让**整个会话**退回全价。
//
// 本检查回答三件事：
//   1. 常驻前缀（system 文本 + 工具定义）是否**跨进程字节一致**（确定性）；
//   2. 前缀里是否混入**易变内容**（时间戳 / 日期 / pid / tmp 路径 / 长随机串）；
//   3. 前缀体积与指纹（用于跨改动比对，相当于文档里的 view_fp / wire_fp）。

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { assemble } from './assemble-context.mjs'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

// ── 1. 跨进程确定性：两次独立进程的指纹必须一致 ───────────────────────────
const runs = [0, 1].map(() => {
  const r = spawnSync(process.execPath, [join(HERE, 'assemble-context.mjs'), '--fingerprint'], { encoding: 'utf8' })
  if (r.status !== 0) return { error: r.stderr.slice(0, 200) }
  return JSON.parse(r.stdout.trim())
})
ok('缓存: 两次独立进程都装配成功', runs.every((r) => r.fp !== undefined), JSON.stringify(runs[0]).slice(0, 120))
if (runs.every((r) => r.fp !== undefined)) {
  ok('缓存: 跨进程前缀指纹一致（确定性）', runs[0].fp === runs[1].fp, `${runs[0].fp.slice(0, 12)} vs ${runs[1].fp.slice(0, 12)}`)
  ok('缓存: 工具数与技能数稳定', runs[0].tools === runs[1].tools && runs[0].skills === runs[1].skills, JSON.stringify(runs[0]))
}

// ── 2. 前缀内不得混入易变内容 ─────────────────────────────────────────────
const a = await assemble()
const VOLATILE = [
  // 注意：**固定日期不算易变**（如「2026-09-09 实测」是历史标注）。只有带时钟的时间、
  // 随机串、临时路径才是运行时变化的东西——它们由下面的正则抓，跨进程指纹再兜底一次。
  { name: '带时钟的时间戳', re: /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/ },
  { name: '时钟时间', re: /\d{2}:\d{2}:\d{2}/ },
  { name: '临时路径 /tmp', re: /\/tmp\// },
  { name: '进程号 pid=', re: /\bpid[=:]\s*\d+/i },
  { name: '40+ 位十六进制串（哈希/commit）', re: /\b[0-9a-f]{40,}\b/ },
  { name: 'UUID', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
]
for (const v of VOLATILE) {
  const hit = v.re.exec(a.cacheable)
  ok(`缓存: 前缀不含「${v.name}」`, hit === null, hit === null ? '' : `命中 ${JSON.stringify(hit[0])}`)
}

// ── 3. 前缀体积与指纹 ─────────────────────────────────────────────────────
const fp = createHash('sha256').update(a.cacheable, 'utf8').digest('hex')
const chars = a.cacheable.length
// 粗略 token 估计：中文≈1 token/字，ASCII≈4 字符/token。只用于判断「是否远超最小可缓存长度」。
const cjk = (a.cacheable.match(/[\u4e00-\u9fff]/g) ?? []).length
const tokensLow = Math.round(cjk + (chars - cjk) / 4)
const tokensHigh = Math.round(cjk * 1.2 + (chars - cjk) / 3)
ok('缓存: 前缀远超最小可缓存长度（1024 token）', tokensLow > 1024, `约 ${tokensLow}–${tokensHigh} token`)
ok('缓存: 前缀不含空字节（\u0000/\u0001 只用于指纹拼接）', !a.resident.includes('\u0000') && !a.resident.includes('\u0001'))

console.log('# 缓存前缀稳定性检查\n')
console.log(results.join('\n'))
console.log('')
console.log(`- 前缀指纹（跨改动比对用）: \`${fp}\``)
console.log(`- 体积: ${chars} 字符（system 文本 ${a.resident.length} + 工具定义 ${chars - a.resident.length}）｜约 ${tokensLow}–${tokensHigh} token`)
console.log(`- 组成: ${a.tools.length} 个工具 + ${a.skills.length} 个技能索引`)
console.log('')
console.log('> 规则：改插件 / 技能 / persona = **打穿所有会话的缓存前缀**（一次全价）。')
console.log('> 长程会话中请批量改，改完开新会话；工具输出只追加、不改写历史前缀。')
console.log(`\n${failures === 0 ? 'CACHE_OK' : 'CACHE_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
