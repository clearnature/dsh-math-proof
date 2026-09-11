// 数学证明模式 — **交互式询问 Agda（`proof_goals`）**门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/goals-check.mjs
// 期望最后一行：GOALS_CHECK_OK n/n
//
// 为什么单独立一套：这个工具是**给写证明项的人（模型）看的眼睛**——
// 它读错一个字段，模型就会对着错的目标类型写项（比"没有这个工具"更坏）。
// 所以：
//   · 解析层用**真实报文**（`tests/fixtures/agda-interaction-basic.txt`，由 Agda 2.9.0-nightly 实跑得到）钉死；
//   · 渲染层断言「关键事实必须在报告里」（目标类型 / 上下文名字 / 期望 vs 实际类型 / 子句 / 候选）；
//   · 端到端在**本机有 Agda 时**真跑一次（CI 没有 Agda → 如实 SKIP，不假绿）。
//
// 全程零外部依赖：纯文本进、纯文本出。

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const FIXTURE = join(HERE, 'fixtures', 'agda-interaction-basic.txt')

const I = await import(join(PRESET, 'impl', 'agda-interaction.mjs'))

const results = []
let failures = 0
let skips = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${String(detail).slice(0, 190)}`}`)
  if (!cond) failures++
}
const skipReasons = []
const skip = (name, why) => {
  results.push(`⏭ ${name} — SKIP：${why}`)
  skips++
  skipReasons.push(why)
}
const section = (t) => results.push(`\n## ${t}`)

/** 构造一个 `AllGoalsWarnings` 响应（用 JSON.stringify 而不是手写字符串：手写容易少括号，本套件早期就栽过）。 */
const allGoals = (visibleGoals, extra = {}) =>
  I.parseStream(JSON.stringify({ kind: 'DisplayInfo', info: { kind: 'AllGoalsWarnings', visibleGoals, invisibleGoals: [], errors: [], warnings: [], ...extra } }))

// ── 1) 真实报文解析（夹具来自 Agda 2.9.0-nightly 实跑）──────────────────────
section('解析真实报文（夹具：Agda 2.9.0-nightly 实跑输出）')
{
  ok('夹具存在', existsSync(FIXTURE), FIXTURE)
  const text = readFileSync(FIXTURE, 'utf8')
  const p = I.parseStream(text)
  ok('洞清单：2 个洞，带位置与目标类型', p.goals.length === 2 && p.goals[0].type === 'Nat' && /^\d+:\d+-\d+$/.test(p.goals[0].range), JSON.stringify(p.goals))
  ok('洞的位置是「行:起始列-结束列」（1 基）', p.goals[1].range === '10:10-14', p.goals[1].range)
  ok('目标 + 上下文：类型 Nat、上下文有 x 与 y : Nat', p.goalType !== null && p.goalType.type === 'Nat' && p.goalType.entries.map((e) => `${e.name}:${e.type}`).join(',') === 'x:Nat,y:Nat', JSON.stringify(p.goalType?.entries))
  ok('目标的 rewrite 模式被记下（Normalised）', p.goalType.rewrite === 'Normalised', p.goalType.rewrite)
  ok('infer：表达式类型被读出', p.inferred !== null && p.inferred.expr === 'Nat', JSON.stringify(p.inferred))
  ok('normalize：范式被读出', p.normalForm !== null && p.normalForm.expr === '3', JSON.stringify(p.normalForm))
  ok('case：variant 与子句都被读出（可直接粘贴）', p.makeCase !== null && p.makeCase.variant === 'Function' && p.makeCase.clauses.length === 2 && p.makeCase.clauses[0].includes('zero'), JSON.stringify(p.makeCase?.clauses))
  ok('give：自动搜索的候选项被读出（`x , x`）', p.give !== null && p.give.result?.str === 'x , x', JSON.stringify(p.give))
  ok('错误被结构化读出（不再是 stdout 文本猜测）', p.errors.length === 1 && p.errors[0].includes('CannotApply'), JSON.stringify(p.errors).slice(0, 140))
  ok('装载完成被标记（`AllGoalsWarnings` 到达）', p.loaded === true)
  ok('高亮等无关响应不污染结论（raw 为空）', p.raw.length === 0, JSON.stringify(p.raw))
  ok('`JSON> ` 提示符不影响解析（首行就是它）', text.split('\n')[0].startsWith('JSON>') && p.goals.length > 0)
}

// ── 2) 解析稳健性（垃圾进不能把工具带崩）─────────────────────────────────
section('解析稳健性')
{
  const empty = I.parseStream('')
  ok('空输入：返回空结构而不是抛异常', empty.goals.length === 0 && empty.errors.length === 0)
  const noise = I.parseStream(`JSON> \nJSON> cannot read: IOTCM "x" (Cmd_bogus)\n{ not json\n${JSON.stringify({ kind: 'Status', status: {} })}\n`)
  ok('非 JSON 行**原样保留**在 raw（不假装理解）', noise.raw.length === 2 && noise.raw.some((r) => r.includes('cannot read')) && noise.raw.some((r) => r.includes('not json')), JSON.stringify(noise.raw))
  ok('坏 JSON 行不抛异常', noise.raw.length >= 2)
  const weird = allGoals([{ constraintObj: { id: 7, range: { start: { line: 3, col: 2 } } }, kind: 'OfType', type: '?' }])
  ok('range 是对象而非数组时也能标出位置', weird.goals[0].range === '3:2', weird.goals[0].range)
}

// ── 3) 命令构造（协议正确性：一条命令写错就是「静默没反应」）──────────────
section('命令构造（IOTCM）')
{
  const l = I.buildCommands({ action: 'list', path: 'G.agda' })
  ok('list：只发 Cmd_load（它的响应自带洞清单）', l.lines.length === 1 && l.lines[0] === 'IOTCM "G.agda" NonInteractive Direct (Cmd_load "G.agda" [])', l.lines.join(' | '))
  const c = I.buildCommands({ action: 'context', path: 'G.agda', goal: 2 })
  ok('context：`Cmd_goal_type_context Normalised <id> noRange ""`（**四个参数**，少一个 Agda 会 cannot read）', c.lines[1] === 'IOTCM "G.agda" NonInteractive Direct (Cmd_goal_type_context Normalised 2 noRange "")', c.lines[1])
  ok('infer：表达式走 Haskell 字符串字面量', I.buildCommands({ action: 'infer', path: 'G.agda', expr: 'x + y' }).lines[1].includes('(Cmd_infer AsIs 0 noRange "x + y")'))
  ok('give：WithoutForce（与 agda-mode 的 C-c C-SPC 一致）', I.buildCommands({ action: 'give', path: 'G.agda', expr: 'zero' }).lines[1].includes('(Cmd_give WithoutForce 0 noRange "zero")'))
  ok('case：`Cmd_make_case <id> noRange "<var>"`', I.buildCommands({ action: 'case', path: 'G.agda', on: 'x' }).lines[1].includes('(Cmd_make_case 0 noRange "x")'))
  ok('auto：`Cmd_autoAll AsIs`（对全部洞搜索）', I.buildCommands({ action: 'auto', path: 'G.agda' }).lines[1].includes('(Cmd_autoAll AsIs)'))
  ok('normalize：`Cmd_compute DefaultCompute <id> noRange "<expr>"`', I.buildCommands({ action: 'normalize', path: 'G.agda', expr: '1 + 2' }).lines[1].includes('(Cmd_compute DefaultCompute 0 noRange "1 + 2")'))
  ok('缺参数如实报出（infer/give 要 expr；case 要 on）', I.buildCommands({ action: 'infer', path: 'G.agda' }).needs.length === 1 && I.buildCommands({ action: 'case', path: 'G.agda' }).needs.length === 1)
  ok('未知 action 报错（不是静默当 list）', I.buildCommands({ action: 'bogus', path: 'G.agda' }).needs.some((n) => n.includes('未知 action')))
  ok('路径里的引号/反斜杠被转义（否则 IOTCM 解析不了）', I.haskellString('a"b\\c') === '"a\\"b\\\\c"', I.haskellString('a"b\\c'))
  ok('goal 非整数时不崩（回落到 0）', I.buildCommands({ action: 'context', path: 'G.agda', goal: 'x' }).lines[1].includes('Normalised 0 '))
}

// ── 4) 渲染：关键事实必须在报告里（少一条，模型就白问）──────────────────
section('渲染（关键事实必须在报告里）')
{
  const p = I.parseStream(readFileSync(FIXTURE, 'utf8'))
  const list = I.renderGoals(p, { path: 'G.agda', checker: '/usr/local/bin/agda' })
  ok('list：报出洞数与目标类型', list.includes('洞: **2**') && list.includes('Nat') && list.includes('Σ Nat'))
  ok('list：给出下一步（context / auto / case）', list.includes('action:"context"') && list.includes('action:"auto"') && list.includes('action:"case"'))
  ok('list：带「这不是证据」', list.includes('这不是证据') && list.includes('proof_compile'))

  const closed = I.renderGoals(allGoals([]), { path: 'G.agda' })
  ok('list：没有洞时明说「当前没有未解决的洞」', closed.includes('当前没有未解决的洞'))

  const ctx = I.renderContext(p, { path: 'G.agda', goal: 0 })
  ok('context：目标类型 + 上下文名字与类型都在', ctx.includes('**目标**: `Nat`') && ctx.includes('`x`') && ctx.includes('`y`') && ctx.includes('Nat'))
  ok('context：点明「这些名字就是你能直接用的项」', ctx.includes('能直接用的项'))
  ok('context：拿不到目标时指路回 list（不是空白报告）', I.renderContext(I.parseStream(''), { path: 'G.agda', goal: 9 }).includes('action:"list"'))

  const inf = I.renderInfer(p, { path: 'G.agda', expr: 'x + y' })
  ok('infer：`表达式 : 类型` 一行给全', inf.includes('`x + y` : `Nat`'), inf.split('\n')[2])

  const nf = I.renderNormalize(p, { path: 'G.agda', expr: '1 + 2' })
  ok('normalize：范式 + 「两边范式相同通常 refl 就能闭合」', nf.includes('`3`') && nf.includes('refl'))

  const bad = I.parseStream(readFileSync(FIXTURE, 'utf8'))
  const give = I.renderGive(bad, { path: 'G.agda', goal: 0, expr: 'x y' })
  ok('give：失败时给出 Agda 的**期望 vs 实际**错误原文', give.includes('不通过') && give.includes('CannotApply') && give.includes('does not have function type'), give.split('\n').slice(0, 6).join(' / '))
  const good = I.renderGive(I.parseStream(`${JSON.stringify({ kind: 'GiveAction', interactionPoint: { id: 0, range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } } }, giveResult: { paren: false } })}\n${JSON.stringify({ kind: 'DisplayInfo', info: { kind: 'AllGoalsWarnings', visibleGoals: [], invisibleGoals: [], errors: [], warnings: [] } })}`), { path: 'G.agda', goal: 0, expr: 'zero' })
  ok('give：通过时明说「通过 ≠ 已写进文件」，并要求 proof_compile', good.includes('类型检查通过') && good.includes('不代表') && good.includes('proof_compile'))
  ok('give：通过时报剩余洞数', good.includes('剩余洞: 0'))
  const noResp = I.renderGive(I.parseStream('JSON> cannot read: IOTCM "x" (Cmd_give)\n'), { path: 'G.agda', goal: 0, expr: 'z' })
  ok('give：没响应时不编造结果（保留原始输出）', noResp.includes('没有拿到 give 响应') && noResp.includes('cannot read'))

  const cs = I.renderCase(p, { path: 'G.agda', goal: 0, on: 'x' })
  ok('case：给出可粘贴的子句块', cs.includes('add zero y = ?') && cs.includes('add (suc x) y = ?') && cs.includes('```agda'))
  ok('case：说明 variant 含义（Function/ExtendedLambda）', cs.includes('Function') && cs.includes('ExtendedLambda'))
  ok('case：没结果时提示可能「变量不在作用域」', I.renderCase(I.parseStream(''), { path: 'G.agda', goal: 0, on: 'zzz' }).includes('不在作用域'))

  const au = I.renderAuto(p, { path: 'G.agda' })
  ok('auto：报出候选项', au.includes('候选 `x , x`'), au.split('\n').slice(0, 4).join(' / '))
  const auEmpty = I.renderAuto(allGoals([{ constraintObj: { id: 0, range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } } }, kind: 'OfType', type: 'Nat' }]), { path: 'G.agda' })
  ok('auto：搜不到时说明这是**正常**的（并列出剩余目标类型）', auEmpty.includes('没有找到候选') && auEmpty.includes('正常的'))
  ok('auto：明说候选不是证据', au.includes('不是证据') && au.includes('proof_compile'))
  ok('所有动作都带「不签发回执」这条硬事实', [list, ctx, inf, nf, give, cs, au].every((r) => r.includes('回执') || r.includes('证据')))
}

// ── 5) 插件契约 ──────────────────────────────────────────────────────────
section('插件契约')
{
  const src = readFileSync(join(PRESET, 'plugins', 'agda-goals.mjs'), 'utf8')
  ok('插件只 import node: 内建 + preset 本地模块（零外部依赖）', !/from '(?!node:|\.\.?\/)/.test(src))
  ok('声明 inject（shell / tools 都真的用到）', /export const inject = \['shell', 'tools'\]/.test(src))
  ok('驱动的是 `--interaction-json`（不是 LSP、不是外部 CLI 依赖）', src.includes('--interaction-json'))
  ok('说明为什么不用 ALS（版本不支持 + 未构建）', src.includes('agda-language-server') && src.includes('2.8.0'))
  ok('路径含双引号时明确报错（IOTCM 表达不了）', src.includes('含双引号'))
  ok('工具描述写明「只读且不签发证据」', /只读/.test(src) && /不签发/.test(src))
  ok('action 枚举与实现同源（GOALS_ACTIONS）', src.includes('enum: GOALS_ACTIONS'))
}

// ── 6) 端到端（本机有 Agda 才跑；CI 没有 → 如实 SKIP）────────────────────
section('端到端（真跑 Agda；无 Agda 则 SKIP）')
{
  const probe = spawnSync('bash', ['-c', 'command -v agda'], { encoding: 'utf8' })
  const hasAgda = probe.status === 0 && String(probe.stdout).trim() !== ''
  if (!hasAgda) {
    skip('端到端：proof_goals 真跑一次', '本机 PATH 上没有 agda')
  } else {
    const WS = mkdtempSync(join(tmpdir(), 'math-proof-goals-ws-'))
    writeFileSync(join(WS, 'G.agda'), 'module G where\n\nopen import Agda.Builtin.Nat\n\nadd : Nat → Nat → Nat\nadd x y = {!!}\n')
    const mod = await import(join(PRESET, 'plugins', 'agda-goals.mjs'))
    const tools = []
    const shell = {
      resolve: (r) => ({ command: r.command, workdir: r.workdir ?? process.cwd(), timeoutMs: r.timeoutMs ?? 60000 }),
      run: (spec) =>
        new Promise((res) => {
          const p = spawnSync('bash', ['-c', spec.command], { cwd: spec.workdir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: spec.timeoutMs })
          res({ exitCode: p.status ?? -1, timedOut: p.error?.code === 'ETIMEDOUT', stdout: { text: p.stdout ?? '' }, stderr: { text: p.stderr ?? '' } })
        }),
    }
    mod.apply({ tools: { register: (t) => { tools.push(t); return () => {} } }, shell, get: () => undefined, effect: (f) => { f(); return () => {} }, on: () => () => {}, systemPrompt: { section: (d) => d } })
    const tool = tools.find((t) => t.name === 'proof_goals')
    ok('插件注册了 proof_goals 工具', tool !== undefined)
    const call = async (args) => (await tool.execute(args, { agent: { session: { header: { cwd: WS } } } })).report
    const list = await call({ action: 'list', path: 'G.agda' })
    ok('端到端 list：报出 1 个洞且类型是 Nat', list.includes('洞: **1**') && list.includes('Nat'), list.split('\n').slice(0, 6).join(' / '))
    const ctx = await call({ action: 'context', path: 'G.agda', goal: 0 })
    ok('端到端 context：上下文里有 x 与 y', ctx.includes('`x`') && ctx.includes('`y`'), ctx.split('\n').slice(0, 8).join(' / '))
    const cs = await call({ action: 'case', path: 'G.agda', goal: 0, on: 'x' })
    ok('端到端 case：给出两个子句', cs.includes('zero') && cs.includes('suc'), cs.split('\n').slice(0, 10).join(' / '))
    ok('端到端：工具**不改磁盘**（交互是只读的）', readFileSync(join(WS, 'G.agda'), 'utf8').includes('{!!}'))
    const missing = await call({ action: 'list', path: '不存在.agda' }).catch((e) => String(e))
    void missing
    rmSync(WS, { recursive: true, force: true })
  }
}

console.log('# 交互式询问 Agda（proof_goals）门禁\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'GOALS_CHECK_OK' : 'GOALS_CHECK_FAIL'} ${results.length - failures}/${results.length}${skips > 0 ? `（${skips} 条 SKIP：${[...new Set(skipReasons)].join('；')}）` : ''}`)
process.exit(failures === 0 ? 0 : 1)
