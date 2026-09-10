// 数学证明模式 — 钩子回归（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/hooks-check.mjs
// 期望最后一行：HOOKS_OK n/n
//
// 覆盖三个钩子的**行为契约**（不是「配置存在」）：
//   SessionStart  → 输出 hookSpecificOutput.additionalContext（接手简报 / 空台账指引）
//   PreToolUse    → 越过步骤时 exit 2 + stderr 理由；合规时 exit 0
//   Stop          → 有未决项时附加上下文，无则空
// 以及 hooks.json 的结构（事件、命令指向真实脚本）。

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const HOOKS = join(PRESET, 'hooks')

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}
const runHook = (file, payload) => {
  const r = spawnSync(process.execPath, [join(HOOKS, file)], { input: JSON.stringify(payload), encoding: 'utf8' })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

const dag = await import(join(PRESET, 'plugins', 'proof-dag.mjs'))
const ws = mkdtempSync(join(tmpdir(), 'math-proof-hooks-'))
const purge = () => {
  const h = createHash('sha1').update(String(ws)).digest('hex').slice(0, 12)
  const dir = join(process.env.HOME ?? '', '.dsh', 'state', 'math-proof')
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith(`dag-${h}`) || f.startsWith(`history-${h}`) || f.startsWith(`witness-${h}`) || f.startsWith(`checkpoint-${h}`)) {
        rmSync(join(dir, f), { recursive: true, force: true })
      }
    }
  }
}

try {
  // ── hooks.json 结构 ─────────────────────────────────────────────────────
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8'))
  const events = Object.keys(cfg.hooks ?? {})
  for (const e of ['SessionStart', 'PreToolUse', 'Stop']) ok(`hooks.json 含 ${e}`, events.includes(e), events.join(', '))
  const commands = Object.values(cfg.hooks ?? {}).flat().flatMap((g) => g.hooks ?? []).map((h) => h.command)
  ok('hooks.json 命令数 >= 3', commands.length >= 3, String(commands.length))
  for (const c of commands) {
    const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/([\w.-]+)/.exec(c)
    ok(`hooks.json 命令指向存在的脚本 ${m?.[1] ?? c.slice(0, 40)}`, m !== undefined && existsSync(join(HOOKS, m[1])), c)
  }

  // ── SessionStart：空台账 → 指引 ─────────────────────────────────────────
  const empty = runHook('session-start.mjs', { cwd: ws, hook_event_name: 'SessionStart' })
  ok('SessionStart 空台账 exit 0', empty.code === 0, `exit ${empty.code}`)
  ok('SessionStart 空台账给指引', empty.out.includes('台账为空') && empty.out.includes('proof_dag init'), empty.out.slice(0, 120))
  ok('SessionStart 输出事件名正确', empty.out.includes('"hookEventName":"SessionStart"'), empty.out.slice(0, 80))

  // ── 造一个台账：一个已证依赖 + 一个未证依赖 ─────────────────────────────
  dag.writeLedger({
    workspace: ws,
    createdAt: new Date().toISOString(),
    nodes: {
      base: { id: 'base', statement: '基础引理', deps: [], state: 'proven', evidenceVerified: true, module: 'X.Base' },
      mid: { id: 'mid', statement: '中间引理', deps: ['base'], state: 'pending' },
      top: { id: 'top', statement: '目标', deps: ['mid'], state: 'pending' },
    },
    journal: [{ ts: new Date().toISOString(), kind: 'decision', text: '口径待定', open: true }],
  })
  const brief = runHook('session-start.mjs', { cwd: ws, hook_event_name: 'SessionStart' })
  ok('SessionStart 简报含进度', brief.out.includes('进度'), brief.out.slice(0, 200))
  ok('SessionStart 简报含待裁决', brief.out.includes('待人类裁决'), brief.out.slice(0, 260))
  ok('SessionStart 简报含可开工', brief.out.includes('可开工'), brief.out.slice(0, 260))

  // ── PreToolUse：越过步骤被拦 ────────────────────────────────────────────
  const noReceipt = runHook('gate-dag.mjs', { cwd: ws, tool_input: { action: 'update', id: 'mid', state: 'proven' } })
  ok('gate 无回执被拦（exit 2）', noReceipt.code === 2, `exit ${noReceipt.code}`)
  ok('gate 给出回执理由', noReceipt.err.includes('receipt') && noReceipt.err.includes('步骤拦截'), noReceipt.err.slice(0, 120))

  const depUnproven = runHook('gate-dag.mjs', {
    cwd: ws,
    tool_input: { action: 'update', id: 'top', state: 'proven', receipt: 'deadbeef' },
  })
  ok('gate 依赖未证被拦（exit 2）', depUnproven.code === 2, `exit ${depUnproven.code}`)
  ok('gate 点名未证依赖', depUnproven.err.includes('mid') && depUnproven.err.includes('依赖尚未 proven'), depUnproven.err.slice(0, 140))

  const allowed = runHook('gate-dag.mjs', {
    cwd: ws,
    tool_input: { action: 'update', id: 'mid', state: 'proven', receipt: 'abc123' },
  })
  ok('gate 依赖已证+有回执 → 放行', allowed.code === 0, `exit ${allowed.code}`)

  const unrelated = runHook('gate-dag.mjs', { cwd: ws, tool_input: { action: 'list' } })
  ok('gate 非 proven 操作放行', unrelated.code === 0)

  // ── Stop：有未决项 → 附加上下文 ────────────────────────────────────────
  const stop = runHook('stop-reminder.mjs', { cwd: ws, hook_event_name: 'Stop' })
  ok('Stop exit 0', stop.code === 0)
  ok('Stop 提醒待裁决', stop.out.includes('待人类裁决'), stop.out.slice(0, 160))
  ok('Stop 提醒写交接', stop.out.includes('handoff'), stop.out.slice(0, 200))
} finally {
  purge()
  rmSync(ws, { recursive: true, force: true })
}

console.log('# 钩子回归（SessionStart / PreToolUse / Stop）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'HOOKS_OK' : 'HOOKS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
