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

  // ── fable5 流程钩子：把「流程」当流程，而不是只当知识文件 ──────────────
  const intake = runHook('fable5-flow.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '把 NSEFinalClosure 里的 C7 实例化问题解决掉，并补齐 T6 的对象层' })
  ok('fable5: 多步任务 → 注入开工四项', intake.code === 0 && intake.out.includes('开工四项'), intake.out.slice(0, 120))
  ok('fable5: 开工清单含分解/拓扑扫描/台账', intake.out.includes('分解') && intake.out.includes('拓扑扫描') && intake.out.includes('台账'))

  const quiet = runHook('fable5-flow.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'exit 0 是什么意思？' })
  ok('fable5: 短问句不打扰', quiet.code === 0 && quiet.out.includes('"additionalContext":""'), quiet.out.slice(0, 120))

  const ack = runHook('fable5-flow.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '继续' })
  ok('fable5: 纯应答不打扰', ack.out.includes('"additionalContext":""'))

  const wrap = runHook('fable5-flow.mjs', { hook_event_name: 'Stop' })
  ok('fable5: Stop → 收工三项', wrap.code === 0 && wrap.out.includes('收工三项'), wrap.out.slice(0, 120))
  ok('fable5: 收工含持久记忆/对抗自检/防虚假完成', wrap.out.includes('持久记忆') && wrap.out.includes('对抗自检') && wrap.out.includes('防虚假完成'))

  // ── fable5 流程闸门（PreToolUse）：计划绑定 + 防虚假完成 ────────────────
  const gws = mkdtempSync(join(tmpdir(), 'math-proof-flow-'))
  try {
    // 无标记：直接写文件应放行
    const free = runHook('fable5-gate.mjs', { cwd: gws, tool_name: 'write', tool_input: { content: 'x' } })
    ok('流程闸门: 非多步任务不干预', free.code === 0, `exit ${free.code}`)

    // 多步任务 → 写标记 → 未落计划就动文件应被拦（exit 2 + 理由）
    runHook('fable5-flow.mjs', { hook_event_name: 'UserPromptSubmit', cwd: gws, session_id: 's-test', prompt: '帮我重构 proof-dag 的评分逻辑，并补上回归测试' })
    const blocked = runHook('fable5-gate.mjs', { cwd: gws, tool_name: 'write', tool_input: { content: 'x' } })
    ok('流程闸门: 多步任务未落计划 → 拦', blocked.code === 2, `exit ${blocked.code} ${blocked.err.slice(0, 80)}`)
    ok('流程闸门: 拦截理由指向台账/计划', blocked.err.includes('proof_dag') && blocked.err.includes('exit_plan_mode'), blocked.err.slice(0, 120))

    const retry = runHook('fable5-gate.mjs', { cwd: gws, tool_name: 'write', tool_input: { content: 'x' } })
    ok('流程闸门: 只拦一次（重试放行）', retry.code === 0, `exit ${retry.code}`)

    // 落台账后放行（另一任务）
    const gws2 = mkdtempSync(join(tmpdir(), 'math-proof-flow2-'))
    runHook('fable5-flow.mjs', { hook_event_name: 'UserPromptSubmit', cwd: gws2, prompt: '把这批模块的断链全部修掉，并补回归测试' })
    const planned = runHook('fable5-gate.mjs', { cwd: gws2, tool_name: 'proof_dag', tool_input: { action: 'add' } })
    ok('流程闸门: proof_dag add 放行并记为已出计划', planned.code === 0)
    const after = runHook('fable5-gate.mjs', { cwd: gws2, tool_name: 'write', tool_input: { content: 'x' } })
    ok('流程闸门: 落台账后写文件放行', after.code === 0, `exit ${after.code}`)
    rmSync(gws2, { recursive: true, force: true })

    // 防虚假完成：强完成宣称 + 无证据 → 拦；带证据 → 放行
    const claim = runHook('fable5-gate.mjs', { cwd: gws, tool_name: 'write', tool_input: { content: '状态: DONE\n文件: A.agda' } })
    ok('流程闸门: 完成宣称无证据 → 拦', claim.code === 2, `exit ${claim.code}`)
    ok('流程闸门: 拦截理由要求补证据', claim.err.includes('证据'), claim.err.slice(0, 100))
    const evidenced = runHook('fable5-gate.mjs', { cwd: gws, tool_name: 'write', tool_input: { content: '状态: DONE（回执 b55d4695fff8，编译 3.2s exit 0）' } })
    ok('流程闸门: 有证据的完成宣称放行', evidenced.code === 0, `exit ${evidenced.code}`)
    const prose = runHook('fable5-gate.mjs', { cwd: gws, tool_name: 'write', tool_input: { content: '# 已完成的功能列表\n- A\n- B' } })
    ok('流程闸门: 普通叙述不误拦', prose.code === 0, `exit ${prose.code}`)

    // 逃生开关
    const off = spawnSync(process.execPath, [join(HOOKS, 'fable5-gate.mjs')], {
      input: JSON.stringify({ cwd: gws, tool_name: 'write', tool_input: { content: '状态: DONE' } }),
      encoding: 'utf8',
      env: { ...process.env, MATH_PROOF_FLOW_GATE: 'off' },
    })
    ok('流程闸门: MATH_PROOF_FLOW_GATE=off 全放行', off.status === 0, `exit ${off.status}`)
  } finally {
    rmSync(gws, { recursive: true, force: true })
  }
} finally {
  purge()
  rmSync(ws, { recursive: true, force: true })
}

{
  const cfg = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')).hooks
  ok('hooks.json 注册了 UserPromptSubmit', Array.isArray(cfg.UserPromptSubmit) && cfg.UserPromptSubmit.length > 0)
  const commands = Object.values(cfg).flat().flatMap((g) => g.hooks.map((h) => h.command))
  for (const f of ['session-start.mjs', 'gate-dag.mjs', 'stop-reminder.mjs', 'fable5-flow.mjs', 'fable5-gate.mjs']) {
    ok(`hooks.json 指向真实脚本 ${f}`, commands.some((c) => c.includes(f)) && existsSync(join(HOOKS, f)))
  }
}

console.log('# 钩子回归（SessionStart / UserPromptSubmit / PreToolUse / Stop）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'HOOKS_OK' : 'HOOKS_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
