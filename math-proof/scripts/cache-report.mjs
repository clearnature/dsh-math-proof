// 数学证明模式 — 缓存与费用报告（零依赖，只 import node: 内建模块）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/cache-report.mjs [--days N] [--preset math-proof] [--json]
//
// 数据源：`~/.dsh/sessions/<workspace>/<session>/session[.vN].jsonl[.zstd]` 里的 `assistant/chunk`
// 事件（`chunk.type === "usage"`），字段：inputTokens（**未命中**输入）/ cacheReadTokens（**命中**输入）
// / outputTokens / reasoningTokens / totalTokens。
//
// 价格（DeepSeek 官方定价，元/百万 token，2026-09-09 查得；峰谷 2×：北京时间 9–12、14–18）：
//   v4-flash：命中 0.02｜未命中 1｜输出 2
//   v4-pro  ：命中 0.025｜未命中 3｜输出 6
// 来源：https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//
// 为什么需要它：缓存命中率只是「贵不贵」的一半——命中价 0.02、未命中价 1.0，**差 50 倍**，
// 所以 1.4% 的未命中 token 可以吃掉三分之一的账单。本脚本把「命中 / 未命中 / 输出」三段分开算，
// 让「改 preset 打穿前缀」「上下文过大」这类结构性浪费在数字上现形。

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readSessionHeader, sessionLogFiles, sessionsRoot, stepUsages } from '../impl/session-traffic.mjs'

const PRICES = {
  flash: { hit: 0.02, miss: 1.0, out: 2.0 },
  pro: { hit: 0.025, miss: 3.0, out: 6.0 },
}
const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? def : args[i + 1]
}
const DAYS = Number(flag('days', 0)) || 0
const PRESET = flag('preset', '')
const AS_JSON = args.includes('--json')
const TIER = args.includes('--pro') ? 'pro' : 'flash'
const P = PRICES[TIER]

/** 北京时间小时。 */
function beijingHour(ts) {
  return new Date(ts + 8 * 3600 * 1000).getUTCHours()
}
const isPeak = (ts) => {
  const h = beijingHour(ts)
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

const root = sessionsRoot() // `MATH_PROOF_SESSIONS_ROOT` 可覆盖（测试与异地部署都用它）
if (!existsSync(root)) {
  console.error(`cache-report: 没有会话目录 ${root}`)
  process.exit(2)
}

const rows = []
for (const file of sessionLogFiles(root)) {
  // `sessionLogFiles()` 已经做了两件必须由**唯一实现**决定的事：
  //   ① 一个会话目录里迁移前后的两份日志只取**版本最高**的一份（否则同一会话算两遍）；
  //   ② 文件名规则（`session[.vN].jsonl[.zstd]`）只有一处。
  const header = readSessionHeader(file)
  if (header === null) continue
  const parts = file.split('/')
  const sid = parts[parts.length - 2]
  const ws = parts[parts.length - 3]
  // 逐步 usage 走 `stepUsages`：v0 认 `assistant/chunk`，v3 认 `assistant/message.data.usage`——
  // 只认一种就会在另一种日志上静默算 0（v3 会话的 `assistant/chunk` 数量是 **0**）。
  for (const row of stepUsages(file)) {
    const u = row.usage ?? {}
    rows.push({
      preset: row.preset ?? header.agentPreset ?? 'standard',
      origin: header.origin ?? 'main',
      sid,
      ws,
      t: row.time ?? 0,
      hit: u.cacheReadTokens ?? 0,
      miss: u.inputTokens ?? 0,
      out: u.outputTokens ?? 0,
      reason: u.reasoningTokens ?? 0,
    })
  }
}

const cutoff = DAYS > 0 ? Date.now() - DAYS * 86400_000 : 0
const kept = rows.filter((r) => r.t >= cutoff && (PRESET === '' || r.preset === PRESET))

function agg(rs) {
  const hit = rs.reduce((n, r) => n + r.hit, 0)
  const miss = rs.reduce((n, r) => n + r.miss, 0)
  const out = rs.reduce((n, r) => n + r.out, 0)
  const reason = rs.reduce((n, r) => n + r.reason, 0)
  const peakSteps = rs.filter((r) => isPeak(r.t)).length
  const cHit = (hit / 1e6) * P.hit
  const cMiss = (miss / 1e6) * P.miss
  const cOut = (out / 1e6) * P.out
  const total = cHit + cMiss + cOut
  const sizes = rs.map((r) => r.hit + r.miss).sort((a, b) => a - b)
  const pct = (p) => (sizes.length === 0 ? 0 : sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * p))])
  return {
    steps: rs.length,
    hit,
    miss,
    out,
    reason,
    hitRate: hit + miss === 0 ? 0 : (hit / (hit + miss)) * 100,
    reasonShare: out === 0 ? 0 : (reason / out) * 100,
    cost: { hit: cHit, miss: cMiss, out: cOut, total },
    peakSteps,
    ctx: { median: pct(0.5), p90: pct(0.9), max: sizes[sizes.length - 1] ?? 0 },
  }
}

const overall = agg(kept)
const byPreset = new Map()
for (const r of kept) {
  if (!byPreset.has(r.preset)) byPreset.set(r.preset, [])
  byPreset.get(r.preset).push(r)
}
const bySession = new Map()
for (const r of kept) {
  if (!bySession.has(r.sid)) bySession.set(r.sid, [])
  bySession.get(r.sid).push(r)
}
const top = [...bySession.entries()].map(([sid, rs]) => ({ sid, ...agg(rs) })).sort((a, b) => b.cost.total - a.cost.total)

// 未命中 token 的来源分桶
const buckets = [
  ['<1k', (m) => m < 1000],
  ['1–10k', (m) => m >= 1000 && m < 10000],
  ['10–50k', (m) => m >= 10000 && m < 50000],
  ['50–200k', (m) => m >= 50000 && m < 200000],
  ['≥200k', (m) => m >= 200000],
].map(([label, test]) => {
  const rs = kept.filter((r) => test(r.miss))
  return { label, steps: rs.length, miss: rs.reduce((n, r) => n + r.miss, 0) }
})

if (AS_JSON) {
  console.log(JSON.stringify({ tier: TIER, overall, byPreset: [...byPreset].map(([k, v]) => ({ preset: k, ...agg(v) })), top: top.slice(0, 10), buckets }, null, 2))
  process.exit(0)
}

const yuan = (x) => `${x.toFixed(2)} 元`
const pctOf = (x) => (overall.cost.total === 0 ? '—' : `${((x / overall.cost.total) * 100).toFixed(0)}%`)

console.log(`# 缓存与费用报告（${TIER} 价｜${kept.length} 步${PRESET === '' ? '' : `｜preset=${PRESET}`}${DAYS > 0 ? `｜最近 ${DAYS} 天` : ''}）\n`)
console.log('## 总体')
console.log(`- 输入: ${(overall.hit + overall.miss).toLocaleString()}（命中 ${overall.hit.toLocaleString()} = **${overall.hitRate.toFixed(1)}%** / 未命中 ${overall.miss.toLocaleString()}）`)
console.log(`- 输出: ${overall.out.toLocaleString()}（其中推理 ${overall.reason.toLocaleString()} = ${overall.reasonShare.toFixed(1)}%）`)
console.log(`- 费用: **${yuan(overall.cost.total)}** = 命中 ${yuan(overall.cost.hit)}（${pctOf(overall.cost.hit)}）+ 未命中 ${yuan(overall.cost.miss)}（${pctOf(overall.cost.miss)}）+ 输出 ${yuan(overall.cost.out)}（${pctOf(overall.cost.out)}）`)
console.log(`- 上下文规模: 中位 ${overall.ctx.median.toLocaleString()}｜P90 ${overall.ctx.p90.toLocaleString()}｜最大 ${overall.ctx.max.toLocaleString()}`)
console.log(`- 高峰时段步数: ${overall.peakSteps}/${overall.steps}（高峰按 2× 计费，本表未上浮）`)

console.log('\n## 按 preset')
console.log('| preset | 步 | 输入 | 命中率 | 未命中 | 输出 | 费用 | 命中/未命中/输出 |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const [k, rs] of [...byPreset].sort((a, b) => agg(b[1]).cost.total - agg(a[1]).cost.total)) {
  const a = agg(rs)
  console.log(`| ${k} | ${a.steps} | ${(a.hit + a.miss).toLocaleString()} | ${a.hitRate.toFixed(1)}% | ${a.miss.toLocaleString()} | ${a.out.toLocaleString()} | ${yuan(a.cost.total)} | ${a.cost.hit.toFixed(2)} / ${a.cost.miss.toFixed(2)} / ${a.cost.out.toFixed(2)} |`)
}

console.log('\n## 最贵会话 Top 5')
for (const s of top.slice(0, 5)) {
  console.log(`- \`${s.sid}\`：${s.steps} 步｜命中 ${s.hitRate.toFixed(1)}%｜未命中 ${s.miss.toLocaleString()}｜输出 ${s.out.toLocaleString()}｜${yuan(s.cost.total)}｜上下文中位 ${s.ctx.median.toLocaleString()}`)
}

console.log('\n## 未命中 token 的来源')
for (const b of buckets) {
  if (b.steps === 0) continue
  console.log(`- ${b.label}: ${b.steps} 步｜未命中 ${b.miss.toLocaleString()}（占未命中 ${((b.miss / Math.max(1, overall.miss)) * 100).toFixed(0)}%）`)
}

console.log('\n## 稳态估算（前缀稳定后，每 100 步的输入成本）')
console.log('假设：上下文恒定 C、每步新增内容约 2k token（新工具输出/新消息，按未命中计）。')
console.log('| 上下文 C | 100 步输入成本 | 说明 |')
console.log('| --- | --- | --- |')
for (const C of [50_000, 100_000, 200_000, 400_000, 800_000]) {
  const hitTokens = C * 100
  const missTokens = 2000 * 100
  const c = (hitTokens / 1e6) * P.hit + (missTokens / 1e6) * P.miss
  console.log(`| ${C.toLocaleString()} | ${yuan(c)} | 命中 ${(hitTokens / 1e6).toFixed(1)}M × ${P.hit} 元 + 未命中 0.2M × ${P.miss} 元 |`)
}

console.log('\n## 读法（怎么把这份表变成动作）')
const tips = []
if (overall.cost.miss / overall.cost.total > 0.25) {
  tips.push(`未命中占账单 ${pctOf(overall.cost.miss)}：**大上下文里改 preset / 冷启动一次 = 整段重付**（未命中价是命中价的 50 倍）。改插件、技能、persona 请集中做，改完开新会话。`)
}
const big = buckets.find((b) => b.label === '≥200k')
if (big !== undefined && big.steps > 0) {
  tips.push(`有 ${big.steps} 步单步未命中 ≥200k（合计 ${big.miss.toLocaleString()}）：这些几乎都是「上下文很大时前缀被改动」——在 600k 上下文的会话里改一次配置约 ${yuan(0.6)}。`)
}
if (overall.ctx.median > 150000) {
  tips.push(`上下文中位 ${overall.ctx.median.toLocaleString()}：即使命中价低，**上下文 × 步数**仍是主要成本。压缩阈值、工具输出有界化、少读大文件都能直接降这一项。`)
}
if (overall.reasonShare > 40) {
  tips.push(`推理占输出 ${overall.reasonShare.toFixed(0)}%：输出按 2 元/M 全价计费，机械步骤可降低 reasoning effort。`)
}
if (overall.hitRate > 95 && overall.cost.miss / overall.cost.total <= 0.25) {
  tips.push('命中率与未命中占比都健康：继续守住「前缀稳定 + 只追加」，不要为了小改动反复重启会话。')
}
for (const t of tips) console.log(`- ${t}`)
