// 数学证明模式 — **流量报表 / 预算标定**（零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/traffic-report.mjs              # 看全机流量报表
//   node ~/.dsh/.agent-presets/math-proof/scripts/traffic-report.mjs --calibrate  # 顺带把各类中位调用数写进预算账本
//   node ...traffic-report.mjs --json                                            # 机器可读（给别的脚本吃）
//
// 为什么需要它（回答「用什么评价每次任务的流量平均消耗」）：
//   口径必须是**可复算的官方数据**，不是印象。数据源是持久化产物 `session.jsonl[.zstd]`，
//   取 `assistant/message.usage`（与 `@deepseek-ai/dsh-token-meter` 同源）。
//   本机实测（2026-09-10，26 会话 / 174 个有 usage 的回合）：
//     单回合 tok 中位 6.61M、p25 3.15M、p75 11.07M、p90 17.63M、max 84.14M（差 5.6–12 倍）
//     单回合步数中位 16、p90 52、max 325；每步上下文中位 49.2 万
//     拆分：input 8.2k / cacheRead 6.58M / output 14.2k ⇒ **99.6% 是上下文重复读，输出只占 0.9%**
//   ⇒ 结论：预算的主控量是**工具调用次数**，不是「让模型少写字」；
//     统计用**中位数**（一个 84M 的失控回合足以把均值拉偏 ~50%）。

import { BUDGET } from '../impl/ruleset.mjs'
import {
  classBaseline,
  classifyTask,
  fmtTok,
  loadProfile,
  percentile,
  saveProfile,
  scanSessionTurns,
  sessionLogFiles,
  summarize,
  ZSTD_SUPPORTED,
} from '../impl/session-traffic.mjs'

const args = process.argv.slice(2)
const wantJson = args.includes('--json')
const wantCalibrate = args.includes('--calibrate')
const headroom = Number((/--headroom=([\d.]+)/.exec(args.join(' ')) ?? [])[1] ?? 1.25)

if (!ZSTD_SUPPORTED) {
  console.error(
    `# ⚠ 本机 Node ${process.version} 的 \`node:zlib\` 没有 zstd（需 ≥22.15/23.8）：压缩会话日志读不了。\n` +
      '# 报表在明文 `session.jsonl` 的部署上仍然可用；否则请换 Node 版本。下面显示的是**读到的东西**（可能为空）。\n',
  )
}
const files = sessionLogFiles()
const turns = scanSessionTurns(files)
const usable = turns.filter((t) => t.tok > 0)
const closed = usable.filter((t) => t.open !== true && t.reason === 'completed')

const byPreset = {}
for (const t of usable) byPreset[t.preset || '—'] = (byPreset[t.preset || '—'] ?? 0) + 1
const byClass = new Map()
for (const t of usable) {
  const c = classifyTask(t.prompt ?? '')
  const list = byClass.get(c) ?? []
  list.push(t)
  byClass.set(c, list)
}

const overall = {
  files: files.length,
  turns: turns.length,
  usable: usable.length,
  tok: summarize(usable.map((t) => t.tok)),
  steps: summarize(usable.map((t) => t.steps)),
  calls: summarize(usable.map((t) => t.toolCalls)),
  input: summarize(usable.map((t) => t.inTok)),
  cache: summarize(usable.map((t) => t.cacheTok)),
  output: summarize(usable.map((t) => t.outTok)),
  wallMs: summarize(usable.map((t) => t.wallMs).filter((v) => typeof v === 'number')),
  byReason: usable.reduce((acc, t) => { acc[t.reason ?? '—'] = (acc[t.reason ?? '—'] ?? 0) + 1; return acc }, {}),
  byPreset,
}
const perClass = {}
for (const cls of BUDGET.classes) {
  const list = byClass.get(cls.id) ?? []
  perClass[cls.id] = {
    label: cls.label,
    turns: list.length,
    closedCompleted: list.filter((t) => t.open !== true && t.reason === 'completed').length,
    calls: summarize(list.map((t) => t.toolCalls)),
    tok: summarize(list.map((t) => t.tok)),
    steps: summarize(list.map((t) => t.steps)),
  }
}

if (wantJson) {
  console.log(JSON.stringify({ at: new Date().toISOString(), overall, perClass }, null, 2))
} else {
  const fmt = (n) => fmtTok(n)
  console.log('# 数学证明模式 — 会话流量报表\n')
  console.log(`- 数据源: \`${process.env.MATH_PROOF_SESSIONS_ROOT ?? '~/.dsh/sessions'}\`｜日志 ${overall.files} 个｜回合 ${overall.turns} 个（有 usage ${overall.usable}）`)
  console.log(`- 会话预设分布: ${Object.entries(byPreset).map(([k, v]) => `${k} ${v}`).join('｜')}`)
  console.log(`- 回合结束原因: ${Object.entries(overall.byReason).map(([k, v]) => `${k} ${v}`).join('｜')}`)
  console.log('\n## 单回合（口径：中位数，不用均值——一个失控回合足以把均值拉偏）')
  console.log(`- tok: 中位 **${fmt(overall.tok.median)}**｜p25 ${fmt(percentile(usable.map((t) => t.tok), 0.25))}｜p75 ${fmt(percentile(usable.map((t) => t.tok), 0.75))}｜p90 ${fmt(overall.tok.p90)}｜max ${fmt(overall.tok.max)}｜合计 ${fmt(overall.tok.sum)}`)
  console.log(`- 步数: 中位 ${overall.steps.median}｜p90 ${overall.steps.p90}｜max ${overall.steps.max}`)
  console.log(`- 工具调用: 中位 ${overall.calls.median}｜p90 ${overall.calls.p90}｜max ${overall.calls.max}`)
  console.log(`- 墙钟: 中位 ${((overall.wallMs.median ?? 0) / 1000).toFixed(1)}s｜p90 ${((overall.wallMs.p90 ?? 0) / 1000).toFixed(1)}s`)
  const total = overall.input.median + overall.cache.median + overall.output.median
  console.log(`\n## 流量拆开看（中位回合）`)
  console.log(`- input ${fmt(overall.input.median)}｜cacheRead **${fmt(overall.cache.median)}**｜output **${fmt(overall.output.median)}**`)
  if (total > 0) {
    console.log(`- 占比: 上下文重复读 **${((overall.cache.median / total) * 100).toFixed(1)}%**｜模型输出 **${((overall.output.median / total) * 100).toFixed(1)}%**`)
    console.log('  ⇒ 结论：**流量 ≈ 调用次数 × 每步上下文**；「少写字」几乎省不了流量，主控量是调用次数与上下文规模。')
  }
  // ── 思考强度（相关，不是因果）─────────────────────────────────────────────
  // 为什么单列：用户关心「过度思考」。实测 reasoning token 只占流量的 0.12%，
  // 但「档位 ↔ 步数/流量」的关系值得用**自己的数据**持续看，而不是靠印象。
  const effortGroups = new Map()
  for (const t of usable) {
    const key = t.effortAtStart ?? '（未记录）'
    const list = effortGroups.get(key) ?? []
    list.push(t)
    effortGroups.set(key, list)
  }
  console.log('\n## 思考强度 vs 消耗（**相关，不是因果**；档位取自 request/header，是阶跃值）')
  console.log('| 回合起始档位 | 回合 | 中位调用 | 中位步数 | 中位 tok | 每步 reasoning（中位） |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const [key, list] of [...effortGroups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(
      `| \`${key}\` | ${list.length} | ${summarize(list.map((t) => t.toolCalls)).median ?? '—'} | ${summarize(list.map((t) => t.steps)).median ?? '—'} | ${fmt(summarize(list.map((t) => t.tok)).median)} | ${Math.round(summarize(list.map((t) => (t.reasoningTok ?? 0) / Math.max(1, t.steps))).median ?? 0)} |`,
    )
  }
  const reas = summarize(usable.map((t) => t.reasoningTok ?? 0))
  console.log(
    `- reasoning token 合计 **${fmt(reas.sum)}**，占全部流量 **${((reas.sum / (overall.tok.sum || 1)) * 100).toFixed(2)}%**` +
      `（中位回合每个 reasoning token 只值 ${Math.round(summarize(usable.map((t) => (t.reasoningTok ?? 0) / Math.max(1, t.steps))).median ?? 0)}/步）`,
  )
  console.log('- ⇒ **思考强度不是省流量的杠杆**；它是「预算吃紧时强制收敛」的杠杆（见 M7.6）。')

  console.log('\n## 按任务类')
  console.log('| 类 | 含义 | 回合 | 中位调用 | p90 调用 | 中位步数 | 中位 tok |')
  console.log('| --- | --- | --- | --- | --- | --- | --- |')
  for (const [id, s] of Object.entries(perClass)) {
    console.log(`| \`${id}\` | ${s.label} | ${s.turns} | ${s.calls.median ?? '—'} | ${s.calls.p90 ?? '—'} | ${s.steps.median ?? '—'} | ${fmt(s.tok.median)} |`)
  }
  console.log('\n## 预算账本现状')
  const profile = loadProfile()
  console.log(`- 样本 ${profile.samples?.length ?? 0} 条｜债务 ${profile.debt ?? 0} 笔｜模式 ${profile.enabled === false ? 'warn（只提醒）' : 'brake'}`)
  for (const cls of BUDGET.classes) {
    const base = classBaseline(profile, cls.id)
    const rec = profile.budgets?.[cls.id]
    console.log(`- \`${cls.id}\`: 预算 **${rec?.calls ?? cls.calls}**${rec === undefined ? '（先验）' : '（已标定）'}｜基线样本 ${base.n}/${BUDGET.minSamples}${base.calibrated ? `，中位 ${base.calls.median}` : ''}`)
  }
  if (!wantCalibrate) console.log('\n> 标定：`--calibrate` 会把各类**中位调用数 × 1.25 余量**写进预算账本（样本 < 5 条的类保留先验）。')
}

if (wantCalibrate) {
  const profile = loadProfile()
  const next = { ...(profile.budgets ?? {}) }
  const written = []
  for (const cls of BUDGET.classes) {
    const list = (byClass.get(cls.id) ?? []).filter((t) => t.open !== true && t.reason === 'completed')
    const stats = summarize(list.map((t) => t.toolCalls))
    if (stats.n < BUDGET.minSamples) continue
    const calls = Math.max(1, Math.ceil((stats.median ?? cls.calls) * headroom))
    next[cls.id] = { calls, at: new Date().toISOString(), why: `traffic-report --calibrate：${stats.n} 个已完成同回合中位 ${stats.median} 次 × ${headroom} 余量` }
    written.push(`${cls.id}→${calls}（n=${stats.n}，中位 ${stats.median}）`)
  }
  profile.budgets = next
  profile.calibration = { at: new Date().toISOString(), files: files.length, turns: closed.length, perClass: Object.fromEntries([...byClass].map(([c, l]) => [c, l.length])) }
  saveProfile(profile)
  console.log(`\n## 标定写入 ✅（余量 ×${headroom}）`)
  console.log(written.length === 0 ? '- 没有任何类样本达标（<5 条）——保留先验是**正确**行为，不要为了「有数字」而编数字。' : written.map((w) => `- ${w}`).join('\n'))
}
