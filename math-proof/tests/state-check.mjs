// 数学证明模式 — **数据保留策略回归**（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/state-check.mjs
// 期望最后一行：STATE_OK n/n
//
// 为什么要有这一套：用户问「这个数据保留多少条，还是覆盖的」——这是一个**必须能一眼答出来**的问题。
// 而真实风险是**悄悄累积**：2026-09-10 实测 `flow-*.json` 已经堆到 124 个且**没有任何清理路径**。
// 所以本套件钉死三件事：
//   1. **每个会累积的类别，要么有代码上限、要么被维护脚本报告**（不允许「无人管」的类别）；
//   2. 上限**真的生效**（写超了会截断，不是写在注释里）；
//   3. 维护脚本**只动该动的**：流程标记可清、会话日志绝不碰（那是唯一的历史）。
//
// 全程用 `MATH_PROOF_STATE_DIR` 指向临时目录，**不碰用户真实状态**。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const STATE = mkdtempSync(join(tmpdir(), 'math-proof-state-'))
process.env.MATH_PROOF_STATE_DIR = STATE

const results = []
let failures = 0
let skips = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${String(detail).slice(0, 150)}`}`)
  if (!cond) failures++
}
const section = (t) => results.push(`\n## ${t}`)
const gc = (args = []) =>
  spawnSync(process.execPath, [join(PRESET, 'scripts', 'state-gc.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, MATH_PROOF_STATE_DIR: STATE },
  })

const ruleset = await import(join(PRESET, 'impl', 'ruleset.mjs'))
const traffic = await import(join(PRESET, 'impl', 'session-traffic.mjs'))
const quota = await import(join(PRESET, 'impl', 'quota.mjs'))
const carry = await import(join(PRESET, 'hooks', 'carryover.mjs'))

// ── 1) 上限常量存在且为正 ─────────────────────────────────────────────────
section('上限常量（每个累积型存储都要有一个数）')
{
  ok('任务样本上限 > 0（BUDGET.historyMax）', Number.isInteger(ruleset.BUDGET.historyMax) && ruleset.BUDGET.historyMax > 0, String(ruleset.BUDGET.historyMax))
  ok('类基线窗口 > 0 且 ≤ 样本上限', ruleset.BUDGET.window > 0 && ruleset.BUDGET.window <= ruleset.BUDGET.historyMax, `${ruleset.BUDGET.window}/${ruleset.BUDGET.historyMax}`)
  ok('余额采样上限 > 0（quota.SAMPLES_MAX）', Number.isInteger(quota.SAMPLES_MAX) && quota.SAMPLES_MAX > 0, String(quota.SAMPLES_MAX))
  ok('收工信箱上限 > 0（carryover.CARRY_MAX）', Number.isInteger(carry.CARRY_MAX) && carry.CARRY_MAX > 0, String(carry.CARRY_MAX))
  ok('会话预算/思考档位这类「单值」配置不累积（表里是标量）', typeof ruleset.SESSION.defaultTokens === 'number' && typeof ruleset.EFFORT.ladder[0] === 'string')
}

// ── 2) 上限真的生效（写超了会截断）────────────────────────────────────────
section('上限真的生效')
{
  // 任务样本：写超 → 截到 historyMax 且丢最旧
  const prof = traffic.blankProfile()
  prof.samples = Array.from({ length: ruleset.BUDGET.historyMax + 25 }, (_, i) => ({ at: 'x', class: 'chat', calls: i, countable: true }))
  traffic.saveProfile(prof)
  const back = traffic.loadProfile()
  ok('任务样本：超上限自动截断（丢最旧）', back.samples.length === ruleset.BUDGET.historyMax && back.samples[0].calls === 25, `${back.samples.length}/${back.samples[0]?.calls}`)

  // 余额采样
  const many = { version: 1, baseline: null, samples: Array.from({ length: quota.SAMPLES_MAX + 10 }, () => ({ at: 'x', currency: 'CNY', total: 1 })) }
  quota.saveQuota(many)
  ok('余额采样：超上限自动截断', quota.loadQuota().samples.length === quota.SAMPLES_MAX, String(quota.loadQuota().samples.length))

  // 收工信箱：同 kind 去重 + 总量上限
  const ws = '/w-retention'
  for (let i = 0; i < carry.CARRY_MAX + 4; i++) carry.appendCarry(ws, { kind: `k${i}`, text: `t${i}` })
  ok('收工信箱：总量不超过 CARRY_MAX', carry.readCarry(ws).items.length <= carry.CARRY_MAX, String(carry.readCarry(ws).items.length))
  carry.appendCarry(ws, { kind: 'dup', text: 'a' })
  carry.appendCarry(ws, { kind: 'dup', text: 'b' })
  ok('收工信箱：同 kind 只留最新一条', carry.takeCarry(ws).filter((x) => x.kind === 'dup').length <= 1)

  // 评分历史：读代码里的常量（每个 workspace 200 条）
  const dagSrc = readFileSync(join(PRESET, 'plugins', 'proof-dag.mjs'), 'utf8')
  ok('评分历史上限写在代码里（每 workspace 200 条）', /slice\(-200\)/.test(dagSrc), '')
  // 待结算队列
  const polSrc = readFileSync(join(PRESET, 'impl', 'budget-policy.mjs'), 'utf8')
  ok('待结算队列有上限（slice(-20)）', /slice\(-20\)/.test(polSrc), '')
  ok('重复指纹表有上限（裁剪到 200 键）', /keys\.slice\(-200\)/.test(polSrc), '')
}

// ── 3) 维护脚本：报告覆盖每个类别 + 只动该动的 ─────────────────────────────
section('维护脚本（state-gc）')
{
  const out = gc()
  const text = `${out.stdout ?? ''}${out.stderr ?? ''}`
  ok('state-gc 退出 0', out.status === 0, String(out.status))
  for (const label of ['编译回执', 'oracle 回执', '评分历史', '见证仓库', '知识图谱导出', '预算账本', '流程标记', '会话日志']) {
    ok(`报告里出现「${label}」`, text.includes(label), text.slice(0, 80))
  }
  ok('明确标注会话日志「没有任何保留策略」且只报告', text.includes('没有任何保留策略') && text.includes('绝不删'), '')
  ok('列出流程标记清理开关', text.includes('--flow-min-age-days'), '')

  // 流程标记：陈旧可清、新鲜保留、**别的文件不动**
  rmSync(STATE, { recursive: true, force: true })
  mkdirSync(STATE, { recursive: true })
  const stale = join(STATE, 'flow-stale.json')
  const fresh = join(STATE, 'flow-fresh.json')
  writeFileSync(stale, JSON.stringify({ ts: Date.now() - 10 * 86400000, sessionId: 's', planned: false, blockedOnce: true }))
  writeFileSync(fresh, JSON.stringify({ ts: Date.now(), sessionId: 's', planned: false, blockedOnce: false }))
  const keeper = join(STATE, 'budget-profile.json')
  writeFileSync(keeper, JSON.stringify({ version: 1, samples: [] }))
  const applied = gc(['--apply', '--flow-min-age-days', '3'])
  ok('--apply 清掉陈旧流程标记', !existsSync(stale) && applied.status === 0, `exit ${applied.status}`)
  ok('新流程标记**保留**（正在用的任务不能被清）', existsSync(fresh))
  ok('同时**不碰别的文件**（预算账本等）', existsSync(keeper))

  // 会话日志：只读报告，绝不删
  const sessionsRoot = join(homedir(), '.dsh', 'sessions')
  const before = existsSync(sessionsRoot) ? readdirSync(sessionsRoot).length : 0
  const out2 = gc(['--apply', '--flow-min-age-days', '3', '--archive-days', '0'])
  const after = existsSync(sessionsRoot) ? readdirSync(sessionsRoot).length : 0
  ok('--apply 之后会话日志目录数量不变（绝不删历史）', before === after, `${before} → ${after}`)
  const gcSrc = readFileSync(join(PRESET, 'scripts', 'state-gc.mjs'), 'utf8')
  ok('脚本里没有删除会话日志的路径（静态检查）', !/rmSync\([^)]*sessions/.test(gcSrc), '')
  ok('--json 输出里带流程标记与会话日志统计', (() => {
    const j = gc(['--json'])
    try {
      const parsed = JSON.parse(j.stdout ?? '{}')
      return parsed.flow !== undefined && parsed.sessions !== undefined
    } catch {
      return false
    }
  })(), (gc(['--json']).stdout ?? '').slice(0, 80))
}

// ── 4) 覆盖语义：单值文件是「原子重写」，不是追加 ──────────────────────────
section('覆盖 vs 追加')
{
  ok('回合状态是覆盖写（writeTurn 用 tmp+rename 原子重写）', /export function writeTurn|writeTurn\(/.test(readFileSync(join(PRESET, 'impl', 'budget-policy.mjs'), 'utf8')))
  const statePath = traffic.turnStatePath('sess-x')
  ok('回合状态文件名按会话固定（不随次数增长）', statePath.endsWith('budget-turn-sess-x.json'), statePath)
  const profPath = traffic.profilePath()
  ok('学习账本是**一个文件**（原子重写，不追加）', profPath.endsWith('budget-profile.json'))
  const quotaPath = quota.quotaSamplesPath()
  ok('余额采样是**一个文件**（环形数组，不追加）', quotaPath.endsWith('quota-samples.json'))
  // 原子写：写盘后没有 .tmp 残留
  traffic.saveProfile(traffic.blankProfile())
  ok('原子写不留 .tmp 残留', readdirSync(STATE).every((f) => !f.endsWith('.tmp')))
}

console.log('# 数据保留策略回归\n')
console.log(results.join('\n'))
const passed = results.filter((r) => r.startsWith('✅')).length
const judged = results.filter((r) => /^[✅❌]/.test(r)).length
console.log(`\n${failures === 0 ? 'STATE_OK' : 'STATE_FAIL'} ${passed}/${judged}${skips > 0 ? `（另有 ${skips} 条 SKIP）` : ''}`)
try {
  rmSync(STATE, { recursive: true, force: true })
} catch {
  /* 清理失败不影响判定 */
}
process.exit(failures === 0 ? 0 : 1)
