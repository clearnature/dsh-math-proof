// 数学证明模式 — 本地插件回归测试（零依赖，只 import node: 内建模块）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/run.mjs
// 期望最后一行输出：ALL_PASS <n>/<n>
//
// 覆盖：proof_dag 状态机 / 失败诊断 / 签名变更级联失效 / 证据完整性 / 台账↔代码链接 /
//       损坏台账隔离 / 并发写不丢更新；proof_graph 的 DAG 拓扑与环检测；
//       proof_discipline 的 proof_audit 门禁；dype_engine 的编译指纹分诊。

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const PRESET = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const results = []
let failures = 0

function ok(name, cond, detail = '') {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}
function eq(name, actual, expected) {
  ok(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实得 ${JSON.stringify(actual)}`)
}
function contains(name, haystack, needle) {
  ok(name, String(haystack).includes(needle), `未包含 ${JSON.stringify(needle)}`)
}
async function rejects(name, fn, needle) {
  try {
    await fn()
    ok(name, false, '未抛错')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    ok(name, needle === undefined || msg.includes(needle), msg)
  }
}

/** 取插件的工具对象（apply 只注册，不 provide service）。 */
async function toolOf(file, toolName, extraCtx = {}) {
  const mod = await import(join(PRESET, 'plugins', file))
  const tools = []
  mod.apply({
    tools: { register: (t) => { tools.push(t); return () => {} } },
    effect: (fn) => { fn(); return () => {} },
    systemPrompt: { section: (def) => def },
    get: () => undefined,
    ...extraCtx,
  })
  const t = tools.find((x) => x.name === toolName)
  if (t === undefined) throw new Error(`${file} 未注册 ${toolName}`)
  return { mod, tool: t, call: async (args, cwd) => (await t.execute(args, { agent: { session: { header: { cwd } } } })).report }
}

/** 真实 shell（供需要 git 的测试用；插件本身走 ctx.shell）。 */
async function realShell() {
  const { spawn } = await import('node:child_process')
  return {
    resolve: (r) => ({ command: r.command, workdir: r.workdir ?? process.cwd(), timeoutMs: r.timeoutMs ?? 60000 }),
    run: (spec) =>
      new Promise((res) => {
        const p = spawn('bash', ['-c', spec.command], { cwd: spec.workdir })
        let out = ''
        let err = ''
        p.stdout.on('data', (d) => { out += d })
        p.stderr.on('data', (d) => { err += d })
        // 不能让 spawn 错误变成未捕获异常：那会跳过 finally、留下测试残渣
        p.on('error', (e) => res({ exitCode: -1, timedOut: false, stdout: { text: out }, stderr: { text: String(e) } }))
        p.on('close', (code) => res({ exitCode: code, timedOut: false, stdout: { text: out }, stderr: { text: err } }))
      }),
  }
}

/** 计算某 workspace 在状态目录里的所有文件（台账 / 锁 / 评分历史 / 损坏备份）。 */
function stateFiles(ws) {
  const h = createHash('sha1').update(String(ws)).digest('hex').slice(0, 12)
  const dir = join(homedir(), '.dsh', 'state', 'math-proof')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith(`dag-${h}`) || f.startsWith(`history-${h}`))
    .map((f) => join(dir, f))
}

/** 清掉某 workspace 在状态目录里的一切（测试必须不留残渣）。 */
function purge(ws) {
  const h = createHash('sha1').update(String(ws)).digest('hex').slice(0, 12)
  const dir = join(homedir(), '.dsh', 'state', 'math-proof')
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      // 台账 / 锁 / 评分历史 / 损坏备份 / git 见证仓库 / 见证检查点
      if (
        f.startsWith(`dag-${h}`) ||
        f.startsWith(`history-${h}`) ||
        f.startsWith(`witness-${h}`) ||
        f.startsWith(`checkpoint-${h}`)
      ) {
        rmSync(join(dir, f), { recursive: true, force: true })
      }
    }
  }
  // 空目录也算残渣：回执目录只在测试里用过就清掉
  for (const sub of ['receipts', 'oracle-receipts']) {
    try {
      rmdirSync(join(dir, sub))
    } catch {
      /* 非空或不存在：不是本测试的残渣 */
    }
  }
}

/** 隔离的临时 workspace + 状态清理。 */
function scratch(label) {
  const ws = mkdtempSync(join(tmpdir(), `math-proof-${label}-`))
  return {
    ws,
    done: () => {
      purge(ws)
      rmSync(ws, { recursive: true, force: true })
    },
  }
}

// ── 1. proof_dag：状态机 / 诊断 / 级联失效 / 证据 / 模块链接 ────────────────
{
  const { mod, call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('dag')
  const ledger = mod.ledgerPath(ws)
  try {
    await call({ action: 'init' }, ws)
    await call({ action: 'add', node: { id: 'A', statement: '引理 A', state: 'proven', evidence: 'compile exit 0' } }, ws)
    await call({ action: 'add', node: { id: 'B', statement: '引理 B', deps: ['A'], state: 'proven', evidence: 'compile exit 0' } }, ws)
    await call({ action: 'add', node: { id: 'C', statement: '目标 C', deps: ['B'] } }, ws)

    const next = await call({ action: 'next' }, ws)
    contains('proof_dag: next 只派发依赖已证的 pending 节点', next, '`C`')
    const chk0 = await call({ action: 'check' }, ws)
    contains('proof_dag: check 无环', chk0, '环: 无 ✅')
    contains('proof_dag: check 无悬空依赖', chk0, '悬空依赖: 无 ✅')

    await rejects('proof_dag: 非法 state 被拒绝', () => call({ action: 'update', id: 'A', state: 'done' }, ws), 'invalid state')
    await rejects('proof_dag: 非法 diagnosis 被拒绝', () => call({ action: 'update', id: 'A', diagnosis: 'whatever' }, ws), 'invalid diagnosis')
    await rejects('proof_dag: add 非法 diagnosis 被拒绝', () => call({ action: 'add', node: { id: 'Z', statement: 's', diagnosis: 'nope' } }, ws), 'invalid diagnosis')
    await rejects('proof_dag: 未知 action 报错（不静默 list）', () => call({ action: 'lst' }, ws), 'unknown action')
    await rejects('proof_dag: 未知节点报错', () => call({ action: 'update', id: 'NOPE', state: 'proven' }, ws), 'unknown node')

    const refuted = await call({ action: 'update', id: 'C', state: 'refuted', diagnosis: 'statement_wrong' }, ws)
    contains('proof_dag: statement_wrong 给出补救方向', refuted, '修形式化，不要硬证')

    // 上游 A 改陈述 = 签名变更 → A 与下游 B 全部退回 needs_review
    const cascade = await call({ action: 'update', id: 'A', statement: '引理 A（加强版）' }, ws)
    contains('proof_dag: 签名变更级联退回', cascade, '已退回 needs_review（2）')
    const after = JSON.parse(readFileSync(ledger, 'utf8'))
    eq('proof_dag: 上游 A 退回 needs_review', after.nodes.A.state, 'needs_review')
    eq('proof_dag: 下游 B 退回 needs_review', after.nodes.B.state, 'needs_review')
    eq('proof_dag: 无关节点 C 不受影响', after.nodes.C.state, 'refuted')

    // 证据完整性 + 台账↔代码链接
    await call({ action: 'add', node: { id: 'NE', statement: '无证据却声称已证', state: 'proven' } }, ws)
    mkdirSync(join(ws, 'src', 'Sovereign', 'Base'), { recursive: true })
    writeFileSync(join(ws, 'src', 'Sovereign', 'Base', 'Trit.agda'), 'module Sovereign.Base.Trit where\n')
    await call({ action: 'add', node: { id: 'M', statement: '真实模块', module: 'Sovereign.Base.Trit', state: 'pending' } }, ws)
    await call({ action: 'add', node: { id: 'G', statement: '幽灵模块', module: 'Sovereign.Nope.Missing', state: 'pending' } }, ws)
    const chk1 = await call({ action: 'check' }, ws)
    contains('proof_dag: proven 无证据被抓', chk1, 'proven 但无证据: ❌ NE')
    contains('proof_dag: 模块缺失被抓', chk1, 'G → Sovereign.Nope.Missing')
    ok('proof_dag: 真实模块不被误报', !chk1.includes('M → Sovereign.Base.Trit'), chk1.split('\n').find((l) => l.includes('模块文件缺失')))

    // 损坏台账：备份 + 报错，绝不静默重置
    writeFileSync(ledger, '{"nodes": {"keepme": {"id":"keepme"}}')
    let corrupted = ''
    try {
      await call({ action: 'list' }, ws)
    } catch (e) {
      corrupted = e.message
    }
    contains('proof_dag: 损坏台账报错', corrupted, '台账损坏')
    ok('proof_dag: 损坏台账已备份', readdirSync(join(ledger, '..')).some((f) => f.startsWith(`${ledger.split('/').pop()}.corrupt-`)))
    ok('proof_dag: 损坏台账不静默重置', !existsSync(ledger) || readFileSync(ledger, 'utf8') !== '{"nodes":{}}')
  } finally {
    done()
  }
}

// ── 2. proof_dag：并发写不丢更新（原子写 + 建议锁）─────────────────────────
{
  const { mod, call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('conc')
  const ledger = mod.ledgerPath(ws)
  try {
    await call({ action: 'init' }, ws)
    await Promise.all(Array.from({ length: 20 }, (_, i) => call({ action: 'add', node: { id: `n${i}`, statement: `命题 ${i}` } }, ws)))
    const nodes = JSON.parse(readFileSync(ledger, 'utf8')).nodes
    eq('proof_dag: 20 个并发 add 全部落盘', Object.keys(nodes).length, 20)
  } finally {
    done()
  }
}

// ── 3. proof_graph：拓扑序 / 环检测 / 未解析依赖 ───────────────────────────
{
  const g = await import(join(PRESET, 'plugins', 'proof-graph.mjs'))
  eq('proof_graph: 提取模块名', g.moduleNameOf('{-# OPTIONS --rewriting #-}\nmodule Foo.Bar where\n'), 'Foo.Bar')
  const imports = g.importsOf('open import Data.Nat using (ℕ)\nimport Foo.Bar as B\n')
  eq('proof_graph: 提取 import 数量', imports.length, 2)
  const files = [
    { path: '/x/A.agda', module: 'A', imports: ['B'] },
    { path: '/x/B.agda', module: 'B', imports: ['C'] },
    { path: '/x/C.agda', module: 'C', imports: [] },
  ]
  const graph = g.buildGraph(files, '/x')
  eq('proof_graph: 建成 3 节点图', graph.nodes.length, 3)
  eq('proof_graph: 边数 = 2', [...graph.edges.values()].reduce((n, s) => n + s.size, 0), 2)
  const order = g.renderGraph(graph, ['A', 'B', 'C'])
  contains('proof_graph: 输出 leaf-first 编译顺序', order, '编译顺序')
  contains('proof_graph: 叶子节点被标注', order, '← 叶子')
  ok('proof_graph: 无环时标注 ✅', order.includes('环: 无 ✅'), order.slice(0, 300))
  const cyc = g.buildGraph([
    { path: '/x/A.agda', module: 'A', imports: ['B'] },
    { path: '/x/B.agda', module: 'B', imports: ['A'] },
  ], '/x')
  const cycText = g.renderGraph(cyc, ['A', 'B'])
  contains('proof_graph: 检出环', cycText, '❌')
}

// ── 4. proof_discipline：proof_audit 门禁 ─────────────────────────────────
{
  const { call } = await toolOf('proof-discipline.mjs', 'proof_audit')
  const { ws, done } = scratch('audit')
  try {
    writeFileSync(join(ws, 'Clean.agda'), '{-# OPTIONS --rewriting --guardedness #-}\nmodule Clean where\n\nopen import Data.Nat using (ℕ)\n')
    const clean = await call({ path: 'Clean.agda' }, ws)
    contains('proof_audit: 干净模块无 postulate', clean, 'postulate')
    ok('proof_audit: 干净模块不报 ❌', !clean.includes('❌'), clean.slice(0, 300))

    writeFileSync(join(ws, 'Dirty.agda'), 'module Dirty where\n\npostulate cheat : ℕ\n')
    const dirty = await call({ path: 'Dirty.agda' }, ws)
    ok('proof_audit: 检出 postulate', dirty.includes('1') && dirty.includes('postulate'), dirty.slice(0, 300))
    await rejects('proof_audit: 空 path 报错', () => call({}, ws), 'path')
  } finally {
    done()
  }
}

// ── 5. dype_engine：编译指纹分诊（纯函数，不真编译）────────────────────────
{
  const d = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  ok('dype_engine: 声明 dype 根目录', typeof d.DYPE_ROOT === 'string' && d.DYPE_ROOT.includes('dype'))
  const parseFp = d.FINGERPRINTS.find((f) => f.test.test('[NoParseForLHS] x'))
  ok('dype_engine: 指纹表覆盖 NoParseForLHS', parseFp !== undefined)
  eq('dype_engine: NoParseForLHS 归 E 类', parseFp?.cls, 'E')
  contains('dype_engine: E 类给出 fixity 补救', parseFp?.fix ?? '', 'fixity')
  const hit = d.classify('NoParseForLHS', 'NoParseForLHS while parsing duodec-inv-involutive (x , a)')
  eq('dype_engine: classify 命中 E 类', hit.cls, 'E')
  eq('dype_engine: 未知诊断不静默通过', d.classify('WeirdError', 'x').cls, '?')
  const quote = d.shellQuote("it's a $test `x`")
  contains('dype_engine: shellQuote 转义单引号', quote, "'\\''")
  ok('dype_engine: shellQuote 包裹 $ 与反引号', quote.startsWith("'") && quote.endsWith("'"))
}

// ── 6. proof_dag：长程能力（溯源 / 流水 / 接手简报 / 断链）────────────────
{
  const { mod, call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('long')
  const ledger = mod.ledgerPath(ws)
  const writeModule = (mod, body) => {
    const rel = join(ws, 'src', `${mod.replace(/\./g, '/')}.agda`)
    mkdirSync(join(rel, '..'), { recursive: true })
    writeFileSync(rel, `module ${mod} where\n\n${body}\n`)
  }
  try {
    await call({ action: 'init' }, ws)
    writeModule('Sovereign.Base.Trit', '')
    writeModule('Sovereign.Algebra.Duodec', 'open import Sovereign.Base.Trit\n')
    writeModule('Sovereign.Algebra.Broken', '') // 声称依赖 Duodec，却没 import
    await call({ action: 'add', node: { id: 'trit', statement: 'Trit 是 GF(3)', module: 'Sovereign.Base.Trit', source: 'Base/Trit.agda:27', state: 'proven', evidence: 'exit 0' } }, ws)
    await call({ action: 'add', node: { id: 'duodec', statement: 'Duodec 加法群', module: 'Sovereign.Algebra.Duodec', deps: ['trit'], source: 'Algebra/Duodecimal.agda', state: 'proven', evidence: 'exit 0' } }, ws)
    await call({ action: 'add', node: { id: 'broken', statement: '断链节点', module: 'Sovereign.Algebra.Broken', deps: ['duodec'], state: 'proven', evidence: 'exit 0' } }, ws)

    // 溯源字段落盘
    const raw = JSON.parse(readFileSync(ledger, 'utf8'))
    eq('proof_dag: source 溯源落盘', raw.nodes.duodec.source, 'Algebra/Duodecimal.agda')

    // 断链：broken 声明依赖 duodec，但 Broken.agda 没有 import Duodec
    const chk = await call({ action: 'check' }, ws)
    contains('proof_dag: 检出台账↔代码断链', chk, '既未直接也未传递 import')
    ok('proof_dag: 已 import 的依赖不误报', !chk.includes('duodec 声明依赖 `Sovereign.Base.Trit`'), chk.split('\n').find((l) => l.includes('断链')))

    // 流水：写入 / 列出 / 待裁决
    await call({ action: 'journal', entry: { kind: 'source', text: '轨道稳定子按 T6.agda:1065 读作等式', source: 'T6.agda:1065', node: 'duodec' } }, ws)
    await call({ action: 'journal', entry: { kind: 'decision', text: 'memory 与代码冲突，待人类裁决', source: 'AUDIT §7.4', open: true } }, ws)
    const jr = await call({ action: 'journal' }, ws)
    contains('proof_dag: 流水可列出', jr, '轨道稳定子')
    contains('proof_dag: 待裁决被标注', jr, '⚠待裁决')
    const jrNode = await call({ action: 'journal', id: 'duodec' }, ws)
    ok('proof_dag: 流水按 node 过滤', jrNode.includes('轨道稳定子') && !jrNode.includes('待人类裁决'), jrNode.slice(0, 200))
    const lesson = await call({ action: 'journal', entry: { kind: 'lesson', text: '症状→判据→做法→证据', source: 'audit/rounds.md §十六' } }, ws)
    contains('proof_dag: 策略教训可入流水', lesson, 'journal +1（lesson）')
    contains('proof_dag: 流水列出 lesson', await call({ action: 'journal' }, ws), 'lesson')
    await rejects('proof_dag: 非法流水类型被拒', () => call({ action: 'journal', entry: { kind: 'gossip', text: 'x' } }, ws), 'invalid kind')
    await rejects('proof_dag: 空正文被拒', () => call({ action: 'journal', entry: { kind: 'decision', text: '  ' } }, ws), 'text')
    await rejects('proof_dag: 流水挂未知节点被拒', () => call({ action: 'journal', entry: { kind: 'decision', text: 'x', node: 'ghost' } }, ws), 'unknown node')

    // 接手简报：必须含目标 / 卡点 / 待裁决 / 下一步
    const brief = await call({ action: 'brief' }, ws)
    for (const key of ['跨天接手简报', '## 目标', '## 可开工', '## 卡点', '## 待人类裁决（1）', '## 建议下一步']) {
      contains(`proof_dag: brief 含 ${key}`, brief, key)
    }
    contains('proof_dag: brief 提示先请人类裁决', brief, '不要自行选边')
  } finally {
    done()
  }
}

// ── 7. prover_limits：限制 → 软件经验（含证据强制）────────────────────────
{
  const { mod, call } = await toolOf('prover-limits.mjs', 'prover_limits')
  const path = mod.limitsPath()
  const backup = existsSync(path) ? readFileSync(path, 'utf8') : null
  try {
    const list = await call({ action: 'list' })
    contains('prover_limits: 索引含堆限制条目', list, 'agda-heap-cap')
    ok('prover_limits: 种子条目 >= 10', mod.SEED.length >= 10, String(mod.SEED.length))

    const q = await call({ action: 'query', query: 'Heap exhausted while typechecking' })
    contains('prover_limits: 按诊断文本命中', q, 'agda-heap-cap')
    contains('prover_limits: 命中给出证据', q, '证据')
    const q2 = await call({ action: 'query', query: 'NoParseForLHS (x , a)' })
    contains('prover_limits: 语法类命中 fixity 条目', q2, 'parse-lhs-fixity')
    const q3 = await call({ action: 'query', query: '完全不认识的报错 zzz' })
    contains('prover_limits: 未命中时给两条出路', q3, '证据必填')

    const show = await call({ action: 'show', id: 'sandbox-stdlib-write' })
    contains('prover_limits: show 给出规避', show, 'proof_compile')
    await rejects('prover_limits: 未知 id 报错', () => call({ action: 'show', id: 'nope' }), 'unknown id')

    await rejects('prover_limits: 缺证据的 add 被拒', () => call({ action: 'add', entry: { id: 'my-limit', symptom: 's', remedy: 'r' } }), 'evidence')
    await rejects('prover_limits: 非法 id 被拒', () => call({ action: 'add', entry: { id: 'Bad_ID', symptom: 's', remedy: 'r', evidence: 'e' } }), 'kebab-case')
    const added = await call({ action: 'add', entry: { id: 'test-limit-x', cls: '测试', symptom: '症状', match: 'TEST_FP_X', remedy: '规避', evidence: '2026-09-09 node tests/run.mjs' } })
    contains('prover_limits: add 落盘成功', added, '✅')
    ok('prover_limits: add 写入状态目录', existsSync(path))
    const q4 = await call({ action: 'query', query: 'error TEST_FP_X happened' })
    contains('prover_limits: 累积条目可被 query 命中', q4, 'test-limit-x')
    // 统计断言必须相对化：真实会话可能已经累积过经验条目，不能假设「累积 1」
    const statsBefore = await call({ action: 'stats' })
    const beforeN = Number(/累积 (\d+)/.exec(statsBefore)?.[1] ?? '0')
    await call({ action: 'add', entry: { id: 'test-stats-x', cls: '测试', symptom: '症状', remedy: '规避', evidence: 'e' } })
    const statsAfter = await call({ action: 'stats' })
    const afterN = Number(/累积 (\d+)/.exec(statsAfter)?.[1] ?? '0')
    eq('prover_limits: add 后累积条目 +1', afterN, beforeN + 1)
    contains('prover_limits: stats 区分种子与累积', statsAfter, '累积')
    await rejects('prover_limits: 未知 action 报错', () => call({ action: 'dump' }), 'unknown action')
  } finally {
    if (backup === null) {
      if (existsSync(path)) rmSync(path, { force: true })
    } else {
      writeFileSync(path, backup)
    }
  }
}

// ── 8. dype_engine × prover_limits 联动 ───────────────────────────────────
{
  const d = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  eq('联动: NoParseForLHS 指向经验库条目', d.classify('NoParseForLHS', 'x').limit, 'parse-lhs-fixity')
  eq('联动: Heap exhausted 指向堆限制条目', d.classify('', 'Heap exhausted').limit, 'agda-heap-cap')
  eq('联动: InfectiveImport 指向传染性条目', d.classify('InfectiveImport', '').limit, 'infective-import')
  eq('联动: 真实代码错误不指向经验库', d.classify('NotInScope', 'foo').limit, undefined)
}

// ── 9. 技能索引完整性（frontmatter 与目录名一致，描述非空）──────────────────
{
  const skillsDir = join(PRESET, 'skills')
  const dirs = readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  ok('技能: 至少 9 个', dirs.length >= 9, dirs.join(', '))
  ok('技能: 含 long-horizon-discipline', dirs.includes('long-horizon-discipline'), dirs.join(', '))
  for (const d of dirs) {
    const text = readFileSync(join(skillsDir, d, 'SKILL.md'), 'utf8')
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)
    ok(`技能 ${d}: 有 frontmatter`, fm !== null)
    if (fm === null) continue
    const name = /^name:\s*(.+)$/m.exec(fm[1])?.[1]?.trim()
    const desc = /^description:\s*(.+)$/m.exec(fm[1])?.[1]?.trim()
    const when = /^whenToUse:\s*(.+)$/m.exec(fm[1])?.[1]?.trim()
    eq(`技能 ${d}: name 与目录一致`, name, d)
    ok(`技能 ${d}: description 非空`, typeof desc === 'string' && desc.length >= 20, String(desc).slice(0, 40))
    ok(`技能 ${d}: whenToUse 非空`, typeof when === 'string' && when.length >= 10, String(when).slice(0, 40))
    ok(`技能 ${d}: 有负向边界（Do NOT trigger for）`, typeof desc === 'string' && desc.includes('Do NOT trigger for'), String(desc).slice(-60))
  }
}

// ── 10. 完整性评分 / 趋势 / 裁决闭环（长程可测量）──────────────────────────
{
  const { mod, call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('score')
  const ledger = mod.ledgerPath(ws)
  const hist = mod.historyPath(ws)
  const receiptFiles = []
  const engineMod = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  const cleanup = () => {
    for (const f of receiptFiles) rmSync(f, { force: true })
    for (const m of ['Sovereign/Z/A']) rmSync(engineMod.aggPathFor(m), { force: true })
    done()
  }
  try {
    await call({ action: 'init' }, ws)
    const c0 = await call({ action: 'check' }, ws)
    contains('评分: 空台账满分', c0, '完整性评分: 100/100')
    contains('评分: 无扣分', c0, '扣分: 无 ✅')
    contains('评分: 首跑趋势', c0, '首跑')
    ok('评分: 历史已落盘', existsSync(hist))

    await call({ action: 'add', node: { id: 'a', statement: 'A', deps: ['b'], state: 'proven' } }, ws)
    await call({ action: 'add', node: { id: 'b', statement: 'B', deps: ['a'] } }, ws)
    await call({ action: 'add', node: { id: 'c', statement: 'C', deps: ['ghost'] } }, ws)
    await call({ action: 'journal', entry: { kind: 'decision', text: '待裁决事项', open: true } }, ws)
    const c1 = await call({ action: 'check' }, ws)
    for (const [name, needle] of [
      ['环扣分', '环 2 个（拓扑序不可定义）'],
      ['悬空扣分', '悬空依赖 1 条'],
      ['无证据扣分', 'proven 无证据 1 个'],
      ['待裁决扣分', '待人类裁决 1 条'],
      ['回退告警', '⚠ 回退'],
    ]) {
      contains(`评分: ${name}`, c1, needle)
    }
    ok('评分: 低于满分', !c1.includes('完整性评分: 100/100'), c1.split('\n')[2])
    contains('评分: 趋势行', c1, '→')
    eq('评分: 历史累计 2 条', mod.readHistory(ws).length, 2)

    // 裁决闭环：关闭待裁决
    const resolved = await call({ action: 'journal', resolve: 'last', note: '人类裁决：按代码为准' }, ws)
    contains('评分: 裁决成功', resolved, '裁决 ✅')
    contains('评分: 剩余待裁决归零', resolved, '剩余待裁决: 0')
    await rejects('评分: 无待裁决时 resolve 报错', () => call({ action: 'journal', resolve: 'last' }, ws), 'no open decision')

    // 修好依赖与证据 → 分数回升（proven 必须靠工具签发的回执，手写 evidence 不算）
    const dype = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
    mkdirSync(join(ws, 'src', 'Sovereign', 'Z'), { recursive: true })
    const mfile = join(ws, 'src', 'Sovereign', 'Z', 'A.agda')
    writeFileSync(mfile, 'module Sovereign.Z.A where\n')
    const hash = dype.sourceHashOf(readFileSync(mfile, 'utf8'))
    dype.writeReceipt({ sourceHash: hash, path: mfile, checker: 'agda', exitCode: 0, ts: '2026-09-09T00:00:00.000Z' })
    receiptFiles.push(join(dype.receiptDir(), `${hash}.json`))
    await call({ action: 'update', id: 'b', deps: [] }, ws)
    await call({ action: 'update', id: 'c', deps: [] }, ws)
    await call({ action: 'update', id: 'a', deps: [], state: 'proven', module: 'Sovereign.Z.A', receipt: hash }, ws)
    const c2 = await call({ action: 'check' }, ws)
    contains('评分: 修好后满分', c2, '完整性评分: 100/100')
    contains('评分: 回执计入可信证据', c2, '证据可信度: 1/1')
    contains('评分: 回升趋势', c2, '+')
    const runs = mod.readHistory(ws)
    eq('评分: 历史累计 3 条', runs.length, 3)
    ok('评分: 历史记录含 proven 计数', runs[2].proven === 1, JSON.stringify(runs[2]))

    // brief 也带评分与趋势
    const brief = await call({ action: 'brief' }, ws)
    contains('评分: brief 带评分', brief, '完整性评分: 100/100')
    contains('评分: brief 带趋势', brief, '趋势:')
  } finally {
    cleanup()
  }
}

// ── 11. 经验库的误判防护与影响级别 ─────────────────────────────────────────
{
  const { mod, call } = await toolOf('prover-limits.mjs', 'prover_limits')
  const path = mod.limitsPath()
  const backup = existsSync(path) ? readFileSync(path, 'utf8') : null
  try {
    ok('经验库: 种子全部带 notFlag', mod.SEED.every((e) => typeof e.notFlag === 'string' && e.notFlag.length > 5), mod.SEED.filter((e) => !e.notFlag).map((e) => e.id).join(', '))
    ok('经验库: 种子全部带 severity', mod.SEED.every((e) => ['blocker', 'degrade', 'noise'].includes(e.severity)), mod.SEED.filter((e) => !e.severity).map((e) => e.id).join(', '))
    const show = await call({ action: 'show', id: 'no-complex-no-float' })
    contains('经验库: show 显示误判防护', show, '误判防护')
    contains('经验库: show 显示影响级别', show, '/ blocker')
    const list = await call({ action: 'list' })
    contains('经验库: 索引显示影响级别', list, '/blocker')
    await call({ action: 'add', entry: { id: 'test-notflag-x', cls: '测试', severity: 'noise', symptom: '症状', remedy: '规避', evidence: 'e', notFlag: '不是这条限制的情形' } })
    const q = await call({ action: 'show', id: 'test-notflag-x' })
    contains('经验库: 累积条目的 notFlag 可读', q, '不是这条限制的情形')
    contains('经验库: 累积条目的 severity 可读', q, '/ noise')
  } finally {
    if (backup === null) {
      if (existsSync(path)) rmSync(path, { force: true })
    } else {
      writeFileSync(path, backup)
    }
  }
}

// ── 12. 回执：工具签发的事实 vs 模型自报（反「改记录拿分」）─────────────────
{
  const { call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const dype = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  const { ws, done } = scratch('receipt')
  const receiptFiles = []
  try {
    mkdirSync(join(ws, 'src', 'Sovereign', 'R'), { recursive: true })
    const mfile = join(ws, 'src', 'Sovereign', 'R', 'A.agda')
    writeFileSync(mfile, 'module Sovereign.R.A where\n')
    const text = readFileSync(mfile, 'utf8')
    const hash = dype.sourceHashOf(text)
    dype.writeReceipt({ sourceHash: hash, path: mfile, checker: 'agda', exitCode: 0, ts: '2026-09-09T00:00:00.000Z' })
    receiptFiles.push(join(dype.receiptDir(), `${hash}.json`))

    await call({ action: 'add', node: { id: 'a', statement: 'A', module: 'Sovereign.R.A', state: 'proven', receipt: hash } }, ws)
    const chk = await call({ action: 'check' }, ws)
    contains('回执: 可信证据计数', chk, '证据可信度: 1/1')

    // ── import 批量通道不豁免证据（真实事故：import 静默丢 receipt → 9 个 proven 变无证据）──
    const wsImp = mkdtempSync(join(tmpdir(), 'math-proof-import-'))
    const dagMod = (await toolOf('proof-dag.mjs', 'proof_dag')).mod
    try {
      mkdirSync(join(wsImp, 'src', 'Sovereign'), { recursive: true })
      const mfile2 = join(wsImp, 'src', 'Sovereign', 'M.agda')
      writeFileSync(mfile2, 'module Sovereign.M where\n\ntheoremX : Set\ntheoremX = Set\n')
      const h2 = dype.sourceHashOf(readFileSync(mfile2, 'utf8'))
      dype.writeReceipt({ sourceHash: h2, path: mfile2, checker: 'agda', exitCode: 0, ts: '2026-09-10T00:00:00.000Z' })
      receiptFiles.push(join(dype.receiptDir(), `${h2}.json`))

      // ① 带有效回执：必须真的落盘 + 标记已验证
      await call({ action: 'import', items: [{ id: 'I1', statement: 's', module: 'Sovereign.M', state: 'proven', receipt: h2 }] }, wsImp)
      const l1 = dagMod.readLedger(wsImp)
      eq('import: 有效回执被记录', l1.nodes.I1.evidenceReceipt, h2)
      eq('import: 有效回执标记已验证', l1.nodes.I1.evidenceVerified, true)

      // ② 无效回执：拒绝该条目
      const bad = await call({ action: 'import', items: [{ id: 'I2', statement: 't', module: 'Sovereign.M', state: 'proven', receipt: 'deadbeef' }] }, wsImp)
      contains('import: 无效回执被拒', bad, 'receipt 无效')
      ok('import: 无效回执不落盘', dagMod.readLedger(wsImp).nodes.I2 === undefined)

      // ③ 无回执写 proven：拒绝并给出三选一
      const noev = await call({ action: 'import', items: [{ id: 'I3', statement: 'u', module: 'Sovereign.M', state: 'proven' }] }, wsImp)
      contains('import: 无回执 proven 被拒', noev, '批量通道不豁免证据')
      ok('import: 无回执 proven 不落盘', dagMod.readLedger(wsImp).nodes.I3 === undefined)

      // ④ 迁移逃生：显式放行 + 明确列出 + check 扣分
      const allowed = await call({ action: 'import', allowUnevidencedProven: true, items: [{ id: 'I4', statement: 'v', module: 'Sovereign.M', state: 'proven' }] }, wsImp)
      contains('import: 显式放行会单独列出', allowed, 'proven 但无回执')
      const chkImp = await call({ action: 'check' }, wsImp)
      contains('import: 放行的节点在 check 里照样扣分', chkImp, 'proven 无证据')

      // ⑤ 覆盖既有节点时**证据必须保留**（这就是当初丢失的那三个字段）
      await call({ action: 'import', items: [{ id: 'I1', statement: 's（改名）', module: 'Sovereign.M' }] }, wsImp)
      const l2 = dagMod.readLedger(wsImp)
      eq('import: 覆盖时保留 receipt', l2.nodes.I1.evidenceReceipt, h2)
      eq('import: 覆盖时保留 evidenceVerified', l2.nodes.I1.evidenceVerified, true)
      ok('import: 覆盖时保留 evidence 文本', String(l2.nodes.I1.evidence ?? '').includes('工具签发'))
    } finally {
      rmSync(wsImp, { recursive: true, force: true })
    }
    contains('回执: 无未验证告警', chk, '未验证声明: 无 ✅')
    contains('回执: 满分', chk, '完整性评分: 100/100')

    // 编译后改文件 → 回执失效（不能靠改源码「保持已证」）
    writeFileSync(mfile, `${text}-- changed after compile\n`)
    const chk2 = await call({ action: 'check' }, ws)
    contains('回执: 源码改动后失效', chk2, '回执与当前源码不符')
    contains('回执: 失效计入未验证', chk2, '未验证声明: ⚠ a')
    contains('回执: 失效扣分', chk2, '未验证声明（无回执/回执失效）1 个（−5）')

    // 不存在的回执直接拒绝
    await rejects('回执: 伪造回执 id 被拒', () => call({ action: 'add', node: { id: 'b', statement: 'B', module: 'Sovereign.R.A', state: 'proven', receipt: 'deadbeef' } }, ws), '回执无效')

    // 手写 evidence 字符串不算已验证
    await call({ action: 'add', node: { id: 'c', statement: 'C', state: 'proven', evidence: 'proof_compile exit 0（手写）' } }, ws)
    const chk3 = await call({ action: 'check' }, ws)
    contains('回执: 手写证据被标未验证', chk3, '未验证声明')
    ok('回执: 手写证据不能得满分', !chk3.includes('完整性评分: 100/100'), chk3.split('\n')[2])

    // 回执是内容寻址：同内容同 id
    eq('回执: 内容寻址（同内容同 id）', dype.sourceHashOf(text), hash)
    ok('回执: 改一字符即变', dype.sourceHashOf(`${text} `) !== hash)
  } finally {
    for (const f of receiptFiles) rmSync(f, { force: true })
    for (const m of ['Sovereign/R/A']) rmSync(dype.aggPathFor(m), { force: true })
    done()
  }
}

// ── 13. git 本地见证：删/回退记录会被检出 ──────────────────────────────────
{
  const shell = await realShell()
  const { mod, call } = await toolOf('proof-dag.mjs', 'proof_dag', {
    shell,
    get: (name) => (name === 'shell' ? shell : undefined),
  })
  const { ws, done } = scratch('witness')
  const wdir = mod.witnessDir(ws)
  const ckpt = mod.checkpointPath(ws)
  const git = (cmd) => shell.run(shell.resolve({ command: `git ${cmd}`, workdir: wdir, timeoutMs: 30000 }))
  try {
    await call({ action: 'init' }, ws)
    ok('见证: 仓库已建立', existsSync(join(wdir, '.git')))
    ok('见证: 检查点已写入（仓库之外）', existsSync(ckpt))

    await call({ action: 'add', node: { id: 'a', statement: 'A', state: 'proven', evidence: '手写' } }, ws)
    const chk = await call({ action: 'check' }, ws)
    contains('见证: check 显示提交号', chk, 'git 见证: `')
    contains('见证: 完整时无告警', chk, '见证链完整 ✅')
    ok('见证: 手写证据仍被扣分', chk.includes('未验证声明'), chk.split('\n').find((l) => l.includes('未验证')))

    // 篡改 1：回退历史（删掉一次提交）
    await git('reset --hard HEAD~1')
    const chk2 = await call({ action: 'check' }, ws)
    contains('见证: 检出历史被改写', chk2, '历史被改写')
    contains('见证: 检出提交数倒退', chk2, '提交数倒退')
    contains('见证: 改写重罚', chk2, '历史被改写（删/回退提交）')
    ok('见证: 改写后分数显著下降', !chk2.includes('完整性评分: 100/100'), chk2.split('\n')[2])

    // 篡改 2：工作树脏（改了台账但没提交）
    writeFileSync(join(wdir, 'ledger.json'), '{"nodes":{}}\n', 'utf8')
    const chk3 = await call({ action: 'check' }, ws)
    contains('见证: 检出未提交改动', chk3, '工作树有未提交改动')
  } finally {
    rmSync(wdir, { recursive: true, force: true })
    rmSync(ckpt, { force: true })
    done()
  }
}

// ── 14. 命名与权威：Agda 是唯一裁决，dype 是实验性内核 ────────────────────
{
  const plugins = readdirSync(join(PRESET, 'plugins'))
  ok('命名: 不再有 dype-engine.mjs', !plugins.includes('dype-engine.mjs'), plugins.join(', '))
  ok('命名: 有 agda-engine.mjs', plugins.includes('agda-engine.mjs'), plugins.join(', '))
  const engine = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  eq('命名: 插件名为 agda-engine', engine.name, 'agda-engine')

  const cands = engine.discoverCandidates()
  const firstAgda = cands.findIndex((c) => c.kind === 'agda')
  const firstDype = cands.findIndex((c) => c.kind === 'dype')
  if (firstAgda !== -1 && firstDype !== -1) {
    ok('权威: 候选排序 agda 先于 dype', firstAgda < firstDype, cands.map((c) => c.kind).join(','))
  } else {
    ok('权威: 候选排序（本机只装了其中一种，跳过比较）', true, cands.map((c) => c.kind).join(','))
  }
  ok('权威: 工具描述声明 Agda 唯一裁决', engine.apply !== undefined && String(engine.apply).length > 0)

  const skillsDir = join(PRESET, 'skills')
  const dirs = readdirSync(skillsDir)
  ok('命名: 技能目录 agda-proof-engine 存在', dirs.includes('agda-proof-engine'), dirs.join(', '))
  ok('命名: 技能目录 dype-proof-engine 已移除', !dirs.includes('dype-proof-engine'), dirs.join(', '))
  ok('命名: dype 地图移入 references', existsSync(join(skillsDir, 'agda-proof-engine', 'references', 'dype-experimental.md')))

  const lhText = readFileSync(join(skillsDir, 'long-horizon-discipline', 'SKILL.md'), 'utf8')
  contains('策略经验: 技能含策略表', lhText, '策略经验：什么时候用什么')
  contains('策略经验: 含抽样骗人案例', lhText, '抽样会骗人')
  contains('策略经验: 含编译面判据', lhText, '探针模块')
  contains('策略经验: 记法指向 journal lesson', lhText, 'journal(kind:"lesson"')

  const skillText = readFileSync(join(skillsDir, 'agda-proof-engine', 'SKILL.md'), 'utf8')
  contains('权威: 技能声明 Agda 唯一裁决', skillText, 'Agda 是唯一裁决器')
  contains('权威: 技能声明 dype 不可替代', skillText, '不能替代 Agda')
  const refText = readFileSync(join(skillsDir, 'agda-proof-engine', 'references', 'dype-experimental.md'), 'utf8')
  contains('权威: references 保留 dype 地图', refText, '模块地图')
  contains('权威: references 声明实验性', refText, '实验性内核')

  // 工具描述里必须写明 dype 非权威
  const tools = []
  engine.apply({ tools: { register: (t) => { tools.push(t); return () => {} } }, get: () => undefined })
  const compile = tools.find((t) => t.name === 'proof_compile')
  ok('权威: proof_compile 描述写明 Agda 唯一裁决', compile.description.includes('唯一裁决器'), compile.description.slice(0, 80))
  ok('权威: proof_compile 描述写明 dype 非权威', compile.description.includes('非权威'), compile.description.slice(0, 160))
  eq('权威: checker 默认 auto', compile.parameters.properties.checker.enum[0], 'auto')
  contains('权威: checker 说明 agda 优先', compile.parameters.properties.checker.description, 'agda 优先')
}

// ── 15. 编译预算闸门（失败 ≥3 次 → 强制委托）────────────────────────────
{
  const { call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const engine = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  const { ws, done } = scratch('budget')
  const receiptFiles = []
  try {
    mkdirSync(join(ws, 'src', 'Sovereign', 'B'), { recursive: true })
    const mfile = join(ws, 'src', 'Sovereign', 'B', 'X.agda')
    // 三次失败回执（源码各不相同 → 三个内容寻址 id）
    for (let i = 0; i < 3; i++) {
      writeFileSync(mfile, `module Sovereign.B.X where\n-- attempt ${i}\n`)
      const h = engine.sourceHashOf(readFileSync(mfile, 'utf8'))
      engine.writeReceipt({ sourceHash: h, path: mfile, relPath: 'src/Sovereign/B/X.agda', checker: 'agda', exitCode: 1, errors: 1, warnings: 0, wallMs: 12000, ts: `2026-09-09T0${i}:00:00.000Z` })
      receiptFiles.push(join(engine.receiptDir(), `${h}.json`))
    }
    const hist = engine.compileHistory('Sovereign.B.X')
    eq('预算: 聚合出 3 次尝试', hist.attempts, 3)
    eq('预算: 聚合出 3 次失败', hist.failures, 3)
    eq('预算: 累计耗时聚合', hist.totalMs, 36000)

    await call({ action: 'add', node: { id: 'x', statement: 'X 引理', module: 'Sovereign.B.X' } }, ws)
    const chk = await call({ action: 'check' }, ws)
    contains('预算: check 打出闸门', chk, '编译预算闸门')
    contains('预算: 列出超限模块', chk, '失败 3/3 次')
    const brief = await call({ action: 'brief' }, ws)
    contains('预算: brief 也提示（改走自带批量修复协议）', brief, '批量修复协议')

    // 只失败 2 次不触发
    const { ws: ws2, done: done2 } = scratch('budget2')
    try {
      mkdirSync(join(ws2, 'src', 'Sovereign', 'C'), { recursive: true })
      const f2 = join(ws2, 'src', 'Sovereign', 'C', 'Y.agda')
      for (let i = 0; i < 2; i++) {
        writeFileSync(f2, `module Sovereign.C.Y where\n-- ${i}\n`)
        const h = engine.sourceHashOf(readFileSync(f2, 'utf8'))
        engine.writeReceipt({ sourceHash: h, path: f2, relPath: 'src/Sovereign/C/Y.agda', checker: 'agda', exitCode: 1, wallMs: 1000, ts: `2026-09-09T1${i}:00:00.000Z` })
        receiptFiles.push(join(engine.receiptDir(), `${h}.json`))
      }
      await call({ action: 'add', node: { id: 'y', statement: 'Y', module: 'Sovereign.C.Y' } }, ws2)
      const chk2 = await call({ action: 'check' }, ws2)
      contains('预算: 2 次不触发闸门', chk2, '编译预算闸门: 无超限 ✅')
    } finally {
      done2()
    }
  } finally {
    for (const f of receiptFiles) rmSync(f, { force: true })
    for (const m of ['Sovereign/B/X', 'Sovereign/C/Y']) rmSync(engine.aggPathFor(m), { force: true })
    done()
  }
}

// ── 16. oracle 回执：先算后验证闸门的机器判定 ──────────────────────────────
{
  const shell = await realShell()
  const ctx = { shell, get: (n) => (n === 'shell' ? shell : undefined) }
  const { call: oracle } = await toolOf('python-oracle.mjs', 'proof_oracle', ctx)
  const { call: dag } = await toolOf('proof-dag.mjs', 'proof_dag', ctx)
  const oracleMod = await import(join(PRESET, 'plugins', 'python-oracle.mjs'))
  const { ws, done } = scratch('oracle')
  const files = []
  try {
    const full = join(ws, 'oracle_full.py')
    writeFileSync(full, [
      'import sys',
      'pts = [(t, a) for t in range(3) for a in range(12)]',
      'ok = all((t + a) % 3 == (t + a) % 3 for t, a in pts)',
      'print("checked", len(pts))',
      'print(\'ORACLE-MANIFEST {"basis":"δ 基 × 相位","domain":36,"points":36,"claim":"Δf≡0 在 36 点成立"}\')',
      'sys.exit(0 if ok else 1)',
    ].join('\n'), 'utf8')
    const r1 = await oracle({ script: 'oracle_full.py' }, ws)
    contains('oracle: 解析清单', r1, 'δ 基 × 相位')
    contains('oracle: 覆盖完整判定', r1, '✅ 完整')
    contains('oracle: 签发回执', r1, '回执: `')
    const id1 = /回执: `([0-9a-f]{64})`/.exec(r1)?.[1]
    ok('oracle: 回执 id 已解析', typeof id1 === 'string' && id1.length === 64, String(id1))
    files.push(join(oracleMod.oracleDir(), `${id1}.json`))

    // 抽样：points < domain → 不算验证，proof_dag 拒绝
    const partial = join(ws, 'oracle_partial.py')
    writeFileSync(partial, 'print(\'ORACLE-MANIFEST {"basis":"线性场抽样","domain":36,"points":4,"claim":"抽样"}\')\n', 'utf8')
    const r2 = await oracle({ script: 'oracle_partial.py' }, ws)
    contains('oracle: 抽样被标出', r2, '抽样')
    const id2 = /回执: `([0-9a-f]{64})`/.exec(r2)?.[1]
    files.push(join(oracleMod.oracleDir(), `${id2}.json`))
    await rejects('oracle: 抽样回执不能进台账', () => dag({ action: 'add', node: { id: 'p', statement: 'P', oracle: id2 } }, ws), '抽样不算验证')

    // 无清单 → 拒绝签发为「完整」
    const nomanifest = join(ws, 'oracle_none.py')
    writeFileSync(nomanifest, 'print("no manifest here")\n', 'utf8')
    const r3 = await oracle({ script: 'oracle_none.py' }, ws)
    contains('oracle: 缺清单被指出', r3, '没有 ORACLE-MANIFEST')
    const id3 = /回执: `([0-9a-f]{64})`/.exec(r3)?.[1]
    if (typeof id3 === 'string') files.push(join(oracleMod.oracleDir(), `${id3}.json`))

    // 完整回执可进台账；脚本一改即失效
    const r4 = await dag({ action: 'add', node: { id: 'a', statement: 'A', oracle: id1 } }, ws)
    contains('oracle: 完整回执进台账', r4, '# proof_dag: add `a`')
    const chk = await dag({ action: 'check' }, ws)
    contains('oracle: check 报覆盖', chk, 'oracle 覆盖: 1 个节点有有效 oracle 回执')
    writeFileSync(full, `${readFileSync(full, 'utf8')}# changed\n`, 'utf8')
    const chk2 = await dag({ action: 'check' }, ws)
    contains('oracle: 脚本改动后回执失效', chk2, 'oracle 脚本已修改')

    // 伪造 id 被拒
    await rejects('oracle: 伪造 id 被拒', () => dag({ action: 'add', node: { id: 'b', statement: 'B', oracle: 'deadbeef' } }, ws), 'oracle 回执不存在')
  } finally {
    for (const f of files) rmSync(f, { force: true })
    try { rmdirSync(oracleMod.oracleDir()) } catch { /* 非空 */ }
    done()
  }
}

// ── 17. 编译热点：用回执里的 wallMs 说话 ──────────────────────────────────
{
  const engine = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  const files = []
  try {
    const spec = [['Hot/A.agda', 30000, 2], ['Hot/B.agda', 5000, 1], ['Hot/C.agda', 12000, 3]]
    for (const [rel, ms, times] of spec) {
      for (let i = 0; i < times; i++) {
        const h = engine.sourceHashOf(`${rel}#${i}`)
        engine.writeReceipt({ sourceHash: h, path: `/tmp/${rel}`, relPath: rel, checker: 'agda', exitCode: 0, wallMs: ms, ts: `2026-09-09T0${i}:00:00.000Z` })
        files.push(join(engine.receiptDir(), `${h}.json`))
      }
    }
    const hot = engine.compileHotspots(3)
    eq('热点: 返回 3 条', hot.length, 3)
    eq('热点: 最贵的是 A', hot[0].module, 'Hot/A.agda')
    eq('热点: A 累计耗时', hot[0].totalMs, 60000)
    eq('热点: 第二是 C', hot[1].module, 'Hot/C.agda')
    eq('热点: 次数聚合', hot[1].attempts, 3)

    // 路径段边界匹配：Trit 不能误命中 TritExtra（早先是 includes() 子串匹配的 bug）
    // 真实会话可能已经编译过这些模块 → 断言必须是**增量**，不能假设全局干净
    const beforeTrit = engine.compileHistory('Sovereign.Base.Trit')
    const beforeExtra = engine.compileHistory('Sovereign.Base.TritExtra')
    const ht = engine.sourceHashOf('trit-src-boundary-test')
    const hx = engine.sourceHashOf('tritextra-src-boundary-test')
    engine.writeReceipt({ sourceHash: ht, relPath: 'src/Sovereign/Base/Trit.agda', path: '/x/src/Sovereign/Base/Trit.agda', checker: 'agda', exitCode: 0, wallMs: 2000, ts: '2026-09-09T02:00:00.000Z' })
    engine.writeReceipt({ sourceHash: hx, relPath: 'src/Sovereign/Base/TritExtra.agda', path: '/x/src/Sovereign/Base/TritExtra.agda', checker: 'agda', exitCode: 0, wallMs: 1000, ts: '2026-09-09T02:01:00.000Z' })
    files.push(join(engine.receiptDir(), `${ht}.json`), join(engine.receiptDir(), `${hx}.json`))
    const afterTrit = engine.compileHistory('Sovereign.Base.Trit')
    const afterExtra = engine.compileHistory('Sovereign.Base.TritExtra')
    eq('热点: 路径段边界匹配（Trit 只加自己那一条）', afterTrit.attempts - beforeTrit.attempts, 1)
    eq('热点: Trit 只算自己的耗时（增量 2000ms）', afterTrit.totalMs - beforeTrit.totalMs, 2000)
    eq('热点: TritExtra 只加自己那一条', afterExtra.attempts - beforeExtra.attempts, 1)
    eq('热点: 路径写法也能匹配', engine.compileHistory('src/Sovereign/Base/Trit.agda').totalMs - beforeTrit.totalMs, 2000)
  } finally {
    for (const f of files) rmSync(f, { force: true })
    for (const m of ['Hot/A', 'Hot/B', 'Hot/C', 'Sovereign/Base/Trit', 'Sovereign/Base/TritExtra']) {
      rmSync(engine.aggPathFor(m), { force: true })
    }
    try { rmdirSync(engine.receiptDir()) } catch { /* 非空 */ }
  }
}

// ── 18. 工具输出有界化（缓存：旧消息字节不随规模漂移）──────────────────────
{
  const { call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('bound')
  try {
    await call({ action: 'init' }, ws)
    for (let i = 0; i < 45; i++) {
      await call({ action: 'add', node: { id: `n${String(i).padStart(2, '0')}`, statement: `命题 ${i}` } }, ws)
    }
    const list = await call({ action: 'list' }, ws)
    contains('有界化: list 表头 40 行上限', list, '另有 5 条')
    const rows = list.split('\n').filter((l) => l.startsWith('| `n')).length
    eq('有界化: list 实际行数 = 40', rows, 40)

    for (let i = 45; i < 70; i++) {
      await call({ action: 'add', node: { id: `n${String(i).padStart(2, '0')}`, statement: `命题 ${i}` } }, ws)
    }
    const chk = await call({ action: 'check' }, ws)
    contains('有界化: check 拓扑序 60 行上限', chk, '另有 10 个节点')
    const orderRows = chk.split('\n').filter((l) => /^\d+\. `n/.test(l)).length
    eq('有界化: check 拓扑序实际行数 = 60', orderRows, 60)

    // 关键状态节点不被截断藏起来：40 个 proven + 5 个 needs_review（id 排在最后）
    const { ws: ws2, done: done2 } = scratch('prio')
    try {
      await call({ action: 'init' }, ws2)
      for (let i = 0; i < 40; i++) {
        await call({ action: 'add', node: { id: `a${String(i).padStart(2, '0')}`, statement: `已证 ${i}`, state: 'proven', evidence: 'x' } }, ws2)
      }
      for (let i = 0; i < 5; i++) {
        await call({ action: 'add', node: { id: `zz${i}`, statement: `待复核 ${i}`, state: 'needs_review' } }, ws2)
      }
      const list2 = await call({ action: 'list' }, ws2)
      ok('有界化: 待复核节点不被截断', ['zz0', 'zz1', 'zz2', 'zz3', 'zz4'].every((id) => list2.includes(`\`${id}\``)), list2.split('\n').slice(0, 3).join(' '))
      contains('有界化: 表仍标出另有 N 条', list2, '另有 5 条')

      // 拓扑序被截断时，未完成节点必须点名
      for (let i = 40; i < 70; i++) {
        await call({ action: 'add', node: { id: `b${String(i).padStart(2, '0')}`, statement: `待办 ${i}` } }, ws2)
      }
      const chk2 = await call({ action: 'check' }, ws2)
      contains('有界化: 被截断的未完成节点被点名', chk2, '被截断的未完成节点')
    } finally {
      done2()
    }
  } finally {
    done()
  }
}

// ── 19. oracle_kit：先算后验证的沉淀与复用 ────────────────────────────────
{
  const shell = await realShell()
  const ctx = { shell, get: (n) => (n === 'shell' ? shell : undefined) }
  const mod = await import(join(PRESET, 'plugins', 'python-oracle.mjs'))
  const { ws, done } = scratch('kit')
  const receipts = []
  const kitBackup = existsSync(mod.kitIndexPath()) ? readFileSync(mod.kitIndexPath(), 'utf8') : null
  try {
    // 共享库确实随 preset 发布
    ok('kit: oracle_kit.py 存在', existsSync(join(mod.kitDir(), 'oracle_kit.py')))
    ok('kit: 种子条目 >= 8', mod.KIT_SEED.length >= 8, String(mod.KIT_SEED.length))

    // 脚本复用共享库：跑真 python，找反例 + 打印覆盖清单
    const good = join(ws, 'good.py')
    writeFileSync(good, [
      'from oracle_kit import t6_points, laplacian, first_counterexample, manifest, delta_basis',
      'pts = t6_points()',
      'delta0 = next(delta_basis(6))',
      'cex = first_counterexample(pts, lambda x: laplacian(delta0, x) == 0)',
      'print("反例:", cex)',
      'manifest(basis="δ 基 × 729 点", domain=len(pts), points=len(pts), claim="laplacian(δ₀) ≡ 0")',
    ].join('\n'), 'utf8')
    const r = await mod.runOracle(ctx, { script: 'good.py', timeoutMs: 60000 }, { agent: { session: { header: { cwd: ws } } } })
    contains('kit: 共享库进 PYTHONPATH', r.report, '已加入 PYTHONPATH')
    contains('kit: 脚本复用共享库跑通', r.report, '覆盖判定: ✅ 完整')
    contains('kit: 反例出现在报告里', r.report, '反例:')
    contains('kit: 清单被解析', r.report, 'δ 基 × 729 点')
    const id = /回执: `([0-9a-f]{64})`/.exec(r.report)?.[1]
    if (typeof id === 'string') receipts.push(join(mod.oracleDir(), `${id}.json`))

    // lint：好脚本合规
    const lintGood = mod.runKit({ action: 'lint', script: good })
    contains('kit: 好脚本 lint 合规', lintGood, '✅ 合规')

    // lint：坏脚本（浮点 + 无清单 + 手写算法）
    const bad = join(ws, 'bad.py')
    writeFileSync(bad, [
      'import math',
      'def gf3_add(a, b):',
      '    return (a + b) % 3',
      'print(1.5 * math.pi)',
    ].join('\n'), 'utf8')
    const lintBad = mod.runKit({ action: 'lint', script: bad })
    contains('kit: lint 抓浮点', lintBad, '浮点/复数')
    contains('kit: lint 抓 math', lintBad, 'math/cmath')
    contains('kit: lint 抓缺清单', lintBad, '覆盖清单')
    contains('kit: lint 提醒复用', lintBad, '重复造轮子')
    contains('kit: lint 判不合规', lintBad, '❌ 不合规')

    // 索引与沉淀
    const list = mod.runKit({ action: 'list' })
    contains('kit: list 含 δ 基', list, 'delta-basis')
    contains('kit: list 含性能模式', list, 'precompute-table')
    const show = mod.runKit({ action: 'show', id: 'delta-basis' })
    contains('kit: show 给出何时用', show, '何时用')
    contains('kit: show 给出证据', show, '证据')
    await rejects('kit: 未知 id 报错', async () => mod.runKit({ action: 'show', id: 'nope' }), 'unknown id')
    await rejects('kit: 缺证据的 add 被拒', async () => mod.runKit({ action: 'add', entry: { id: 'x-y', purpose: 'p', api: 'a', when: 'w' } }), 'evidence')
    const added = mod.runKit({ action: 'add', entry: { id: 'test-kit-x', kind: '性能', purpose: '测试条目', api: 'f()', complexity: 'O(1)', when: '仅测试', evidence: '2026-09-09 tests/run.mjs' } })
    contains('kit: add 落盘', added, '✅')
    contains('kit: 累积条目可列出', mod.runKit({ action: 'list' }), 'test-kit-x')
    contains('kit: path 打印库目录', mod.runKit({ action: 'path' }), 'oracle_kit.py'.replace('oracle_kit.py', 'oracle-kit'))
    await rejects('kit: 未知 action 报错', async () => mod.runKit({ action: 'dump' }), 'unknown action')
  } finally {
    for (const f of receipts) rmSync(f, { force: true })
    try { rmdirSync(mod.oracleDir()) } catch { /* 非空 */ }
    if (kitBackup === null) {
      if (existsSync(mod.kitIndexPath())) rmSync(mod.kitIndexPath(), { force: true })
    } else {
      writeFileSync(mod.kitIndexPath(), kitBackup)
    }
    done()
  }
}

// ── 20. 工具合并 + 待裁决超期提醒 ─────────────────────────────────────────
{
  const { mod, call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('overdue')
  const ledger = mod.ledgerPath(ws)
  try {
    const old = new Date(Date.now() - 5 * 86400000).toISOString()
    const fresh = new Date().toISOString()
    mod.writeLedger({
      workspace: ws,
      createdAt: fresh,
      nodes: {},
      journal: [
        { ts: old, kind: 'decision', text: '五年前的旧口径分歧', open: true, source: 'AUDIT §7.4' },
        { ts: fresh, kind: 'decision', text: '今天新提的裁决', open: true },
      ],
    })
    const brief = await call({ action: 'brief' }, ws)
    contains('超期: 标出已挂天数', brief, '⏰ 已挂 5 天')
    contains('超期: 建议停下来问人', brief, '停下来问人')
    contains('超期: 新决策不标记', brief.includes('今天新提的裁决') && !brief.includes('今天新提的裁决 ⏰'), true)
    ok('超期: 只标超期那条', (brief.match(/⏰ 已挂/g) ?? []).length === 1, String((brief.match(/⏰ 已挂/g) ?? []).length))
  } finally {
    done()
  }

  // 工具合并：oracle_kit 的 action 空间挂在 proof_oracle 上
  const shell = await realShell()
  const ctx = { shell, get: (n) => (n === 'shell' ? shell : undefined) }
  const { tool } = await toolOf('python-oracle.mjs', 'proof_oracle', ctx)
  const acts = tool.parameters.properties.action.enum
  ok('合并: action 空间含 kit-list', acts.includes('kit-list'), acts.join(','))
  ok('合并: 不再单独注册 oracle_kit', !acts.includes('oracle_kit') && tool.name === 'proof_oracle')
  const listed = (await tool.execute({ action: 'kit-list' }, { agent: { session: { header: { cwd: PRESET } } } })).report
  contains('合并: kit-list 可用', listed, 'delta-basis')
  contains('合并: kit-path 可用', (await tool.execute({ action: 'kit-path' }, { agent: { session: { header: { cwd: PRESET } } } })).report, 'oracle-kit')
}

// ── 21. 理论定位：与 HoTT / Cubical 的边界（事实校准）────────────────────
{
  const ttp = readFileSync(join(PRESET, 'skills', 'type-theory-presentation', 'SKILL.md'), 'utf8')
  contains('定位: 技能含 HoTT/Cubical 关系节', ttp, '与 HoTT / Cubical 的关系')
  contains('定位: 明确 Cubical 不是建立在实数上', ttp, '不是**「建立在实数上」')
  contains('定位: 指出真正问题是投影', ttp, '真正的问题是「投影」')
  contains('定位: 承认自己的边界', ttp, '我们自己的边界')
  contains('定位: 给出互补而非取代', ttp, '互补而非取代')

  const { assemble } = await import(join(PRESET, 'tests', 'assemble-context.mjs'))
  const a = await assemble()
  // 常驻层不写易漂移的精确计数（仓库规模每轮都在变）；只保留不随规模漂移的结构性事实
  contains('定位: persona 用定性表述（绝大多数模块）', a.persona, '绝大多数模块')
  contains('定位: persona 用定性表述（Cubical 少数模块）', a.persona, 'Cubical 只在少数模块使用')
  ok('定位: persona 不再写易漂移的模块计数', !/\d+\/\d+\*\* 模块/.test(a.persona) && !/\d+ 个模块涉及 Cubical/.test(a.persona), a.persona.match(/\d+\/\d+\*\* 模块|\d+ 个模块涉及 Cubical/)?.[0] ?? '')
  contains('定位: persona 精确化 postulate 边界', a.persona, '一批模块含 `postulate`')
  ok('定位: persona 不再残留旧数字', !a.persona.includes('501/533') && !a.persona.includes('仅 24 个模块'), a.persona.match(/501\/533|24 个模块/)?.[0] ?? '')

  // 「相等是判定，不是结构」——不用 HoTT 口号
  ok('定位: persona 不再说「相等即路径」', !a.persona.includes('相等即路径'), '相等即路径')
  contains('定位: persona 明确相等是判定', a.persona, '相等是判定，不是结构')
  contains('定位: persona 说明结构来自生成方式', a.persona, '从 `Trit` 逐层构造')

  // GF(9) vs 复共轭案例
  contains('定位: 技能含 GF(9) 案例', ttp, '结构相似 ≠ 结构同一')
  contains('定位: 案例给出算术强制', ttp, '算术强制')
  contains('定位: 案例给出唯一典范', ttp, '唯一典范')
  contains('定位: 案例禁止类比替代定义', ttp, '不得用「同构于 ℂ')
  contains('定位: 案例重申数值不替代证明', ttp, '数值计算不得替代构造性证明')
  contains('定位: 案例指向唯一事实源', ttp, 'frobenius-vs-conjugation-erratum.md')
  contains('对象层: 技能含对象层节', ttp, '信息完整对象层')
  contains('对象层: 指出是信息压缩而非工程重复', ttp, '不是「工程重复」，是「信息压缩」')
  contains('对象层: 给出对象字段模型', ttp, 'Object = {')
  contains('对象层: 承认对象层尚未建成', ttp, '对象层本身尚未建成')
  contains('对象层: 给出字段映射与缺口', ttp, '对象字段映射与缺口')
  contains('对象层: 说明图谱接口', ttp, 'AI 接口：知识图谱导出')
  contains('对象层: 图谱 JSON schema 版本', ttp, 'math-proof/knowledge-graph@1')

  // 三方定位（Claude / OpenAI / 我们）
  const rs = readFileSync(join(PRESET, 'skills', 'research-system', 'SKILL.md'), 'utf8')
  contains('定位: 含三方对照表', rs, '三方定位：Claude FLT / OpenAI NS / 大衍')
  contains('定位: 说明无外力 NS 仍开放', rs, '无外力 NS 全局正则性（Clay 原始 A/B）仍然完全开放')
  contains('定位: 说明互不构成否定', rs, '互不构成否定')
  contains('定位: 列出可迁移候选', rs, 'PacketShiftArithmetic.lean')
  contains('定位: 列出不适用项', rs, '以 ℝ/实分析为基座的模块')
  contains('定位: 成熟度指标不是定理数量', rs, '信息完整度 + 证据可信度 + 断链数')
  // 计算许可 + 12 进制不是域
  const disc = (await import(join(PRESET, 'plugins', 'proof-discipline.mjs'))).DISCIPLINE
  contains('纪律: 计算是工具不是裁决', disc, '计算是工具，不是裁决')
  contains('纪律: 明确大数计算允许', disc, '68630377364883')
  contains('纪律: 12 进制不是域', disc, '把「12 进制」当有限域')
  contains('persona: R₁₂ 是环不是域', a.persona, 'R₁₂ 是环，不是域')
  contains('persona: 12 进制是记数法', a.persona, '「12 进制」是记数法（Doz），不是有限域')
  // 五层对照：DC / DuodecClock / C₁₂ / R₁₂ / Doz
  contains('五层: 技能含五层对照表', ttp, '五层对照：DC / DuodecClock / C₁₂ / R₁₂ / Doz')
  contains('五层: DuodecClock 属本源侧', ttp, 'DC 的**时钟过程 / 模块实现**（同侧，不是投影）')
  contains('五层: R₁₂ 另赋乘法', ttp, '另赋乘法')
  contains('五层: 解释零因子来源', ttp, '两个不同的运算施加在同一批 12 个标签上')
  contains('五层: Doz 不是代数结构也不是序概念', ttp, '**不是代数结构，也不是序概念**')
  contains('persona: 显式区分 DuodecClock', a.persona, 'DuodecClock（其时钟过程实现）')
  // Doz 不是序概念
  contains('Doz: 不是序概念', ttp, 'Doz 是记数法，**不是序概念**')
  contains('Doz: 连续统序属于 ℝ', ttp, '这是 ℝ 的性质')
  contains('Doz: 库内明确非无穷数系', ttp, '不是无穷的 Doz 数系')
  contains('Doz: 书写排列不是序关系', ttp, '不是数学上的序关系')
  // 常见混淆清单
  contains('混淆: 含 DC vs D₁₂', ttp, '**DC vs D₁₂**')
  contains('混淆: D₁₂ 是二面体群非交换', ttp, '非交换')
  contains('混淆: DC 不是 C₃×C₄ 直积', ttp, 'DC vs C₃×C₄ 直积 / C₁₂ 循环群')
  contains('混淆: 禁 A₄ ≅ Z/12', ttp, 'A₄ vs Z/12 / 十二进制')
  contains('混淆: Trit vs Fin 3', ttp, '**Trit vs GF3 = Fin 3**')
  contains('混淆: AlphaPower vs GF9Star', ttp, 'AlphaPower（C₄）vs GF9Star（C₈）')
  contains('混淆: 零冥族不是零元', ttp, '零冥族 vs 零元')
  contains('混淆: 三问读法', ttp, '先问三件事')
}

// ── 22. 两个经验库的指纹一致性（防两套表漂移）─────────────────────────────
{
  const engine = await import(join(PRESET, 'plugins', 'agda-engine.mjs'))
  const limits = await import(join(PRESET, 'plugins', 'prover-limits.mjs'))
  const samples = [
    ['infective-import', 'InfectiveImport', '[InfectiveImport] importing module with REWRITE'],
    ['ambiguous-stdlib-names', 'AmbiguousName', '[AmbiguousName] zero is ambiguous'],
    ['parse-lhs-fixity', 'NoParseForLHS', '[NoParseForLHS] (x , a)'],
    ['projection-stuck-let', 'UnsolvedConstraints', '[UnsolvedConstraints] stuck on .proj'],
    ['agda-heap-cap', '', 'Heap exhausted while typechecking'],
  ]
  for (const [id, label, msg] of samples) {
    const c = engine.classify(label, msg)
    eq(`指纹一致性: classify(${label || 'heap'}).limit = ${id}`, c.limit, id)
    const hits = limits.matchLimits(msg)
    ok(`指纹一致性: 经验库能匹配 ${id}`, hits.some((h) => h.id === id), hits.map((h) => h.id).join(', '))
  }
  // 反向：经验库里每条带 match 的种子，其正则必须能被自身症状命中
  for (const e of limits.SEED) {
    if (typeof e.match !== 'string' || e.match === '') continue
    // 有些条目的正则是匹配**编译输出**而非症状文本（如 exit=42）
    if (e.matchTarget === 'output') continue
    let hitSelf = false
    try {
      hitSelf = new RegExp(e.match, 'i').test(`${e.symptom} ${e.cause ?? ''}`)
    } catch {
      hitSelf = false
    }
    ok(`指纹一致性: ${e.id} 的正则命中自己的症状`, hitSelf, e.match)
  }
}

// ── 23. 信息完整对象层：object 必须带生成方式 ──────────────────────────────
{
  const { call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('object')
  try {
    await call({ action: 'init' }, ws)
    await rejects('对象层: object 无 construction 被拒', () => call({ action: 'add', node: { id: 'g', kind: 'object', statement: 'A4 旋转群' } }, ws), 'construction')
    await rejects('对象层: 非法 kind 被拒', () => call({ action: 'add', node: { id: 'x', kind: 'thing', statement: 'X' } }, ws), 'invalid kind')

    await call({ action: 'add', node: { id: 'a4', kind: 'object', statement: 'A4 是四面体旋转群', construction: 'A4 ⊂ SO(3)（正四面体顶点置换）', relations: ['acts_on:tetrahedron', 'represents:regular'] } }, ws)
    await call({ action: 'add', node: { id: 'gf9', kind: 'object', statement: 'GF(9) = GF(3)[x]/(x²+1)', construction: 'Trit(GF(3)) → 二次扩张 α²=−1' } }, ws)  // 故意缺 relations
    await call({ action: 'add', node: { id: 'l1', statement: 'A4 非交换', deps: ['a4'] } }, ws)

    const chk = await call({ action: 'check' }, ws)
    contains('对象层: 报完整度', chk, '对象信息完整度: 1/2')
    contains('对象层: 点名缺关系的 object', chk, '缺关系: gf9')
    contains('对象层: 报节点种类', chk, 'object 2 / lemma 1')
    contains('对象层: 默认 kind 是 lemma', chk, 'lemma 1')

    // 补上关系后完整
    await call({ action: 'update', id: 'gf9', relations: ['embeds:Trit', 'rigidity:frobenius'] }, ws)
    const chk2 = await call({ action: 'check' }, ws)
    contains('对象层: 补齐后 2/2', chk2, '对象信息完整度: 2/2')
    contains('对象层: 补齐后无告警', chk2, '对象信息完整度: 2/2（构造 2｜载体 0｜运算 0｜关系 2） ✅')

    // 不允许把 object 的 construction 清空
    await rejects('对象层: object 不能清空 construction', () => call({ action: 'update', id: 'gf9', construction: '' }, ws), '必须保留')

    const brief = await call({ action: 'brief' }, ws)
    contains('对象层: brief 也报完整度', brief, '对象信息完整度')

    // 知识图谱导出（AI 接口）
    const g = await call({ action: 'graph' }, ws)
    contains('图谱: 摘要含对象数', g, '对象: **2**')
    contains('图谱: 摘要含边数', g, '边: ')
    contains('图谱: 给出 JSON 路径', g, 'JSON（机器接口）: `')
    contains('图谱: 给出人类视图路径', g, 'Markdown（人类视图）: `')
    const gfile = /JSON（机器接口）: `([^`]+)`/.exec(g)?.[1]
    ok('图谱: JSON 落盘', typeof gfile === 'string' && existsSync(gfile), String(gfile))
    const json = JSON.parse(readFileSync(gfile, 'utf8'))
    eq('图谱: schema 版本', json.schema, 'math-proof/knowledge-graph@1')
    eq('图谱: objects 数量', json.objects.length, 2)
    eq('图谱: claims 数量', json.claims.length, 1)
    const a4 = json.objects.find((o) => o.id === 'a4')
    ok('图谱: 对象带 construction', typeof a4.construction === 'string' && a4.construction.length > 0)
    ok('图谱: relations 按词表分桶', Array.isArray(a4.relations.acts_on) && a4.relations.acts_on.includes('tetrahedron'), JSON.stringify(a4.relations))
    ok('图谱: 关系边已生成', json.edges.some((e) => e.kind === 'acts_on' && e.from === 'a4' && e.to === 'tetrahedron'), JSON.stringify(json.edges))
    ok('图谱: gaps 报告缺关系对象', json.gaps.objectsMissingRelations.length === 0, JSON.stringify(json.gaps))
    ok('图谱: 未归类关系单独收集', Array.isArray(json.gaps.unverifiedEvidence))
    // 人类可读视图 + 引用完整性
    const gmd = /Markdown（人类视图）: `([^`]+)`/.exec(g)?.[1]
    ok('图谱: Markdown 视图落盘', typeof gmd === 'string' && existsSync(gmd), String(gmd))
    const mdText = readFileSync(gmd, 'utf8')
    contains('图谱: Markdown 含对象表', mdText, '| id | 载体 | 生成方式 | 关系 |')
    contains('图谱: Markdown 含缺口节', mdText, '## 缺口')
    contains('图谱: JSON 带 $schema', JSON.stringify(json.$schema), 'knowledge-graph.schema.json')
    ok('图谱: 关系索引按目标建立', Object.keys(json.relationIndex).length > 0, JSON.stringify(Object.keys(json.relationIndex)))

    // 发布的 JSON Schema：结构自校验（零依赖手写最小校验器）
    const schemaPath = join(PRESET, 'schema', 'knowledge-graph.schema.json')
    ok('图谱: schema 文件存在', existsSync(schemaPath))
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    eq('图谱: schema 版本标识', schema.$id, 'math-proof/knowledge-graph@1')
    const missing = (schema.required ?? []).filter((k) => !Object.hasOwn(json, k))
    ok('图谱: 导出满足 schema 必填字段', missing.length === 0, missing.join(', '))
    ok('图谱: entry 必填字段覆盖导出条目', (schema.definitions?.entry?.required ?? []).every((k) => Object.hasOwn(json.objects[0] ?? {}, k)), JSON.stringify(schema.definitions?.entry?.required))
    ok('图谱: $schema 指向发布文件', String(json.$schema).includes('knowledge-graph.schema.json'), String(json.$schema))
    rmSync(gfile, { force: true })
    rmSync(gmd, { force: true })

    // 引用完整性：关系指向未登记目标必须被暴露（不是静默通过）
    const gBefore = await call({ action: 'graph' }, ws)
    const gfBefore = /JSON（机器接口）: `([^`]+)`/.exec(gBefore)?.[1]
    const nBefore = JSON.parse(readFileSync(gfBefore, 'utf8')).gaps.unregisteredRelations.length
    rmSync(gfBefore, { force: true })
    rmSync(/Markdown（人类视图）: `([^`]+)`/.exec(gBefore)?.[1], { force: true })
    await call({ action: 'add', node: { id: 'ghost', kind: 'object', statement: '幽灵对象', construction: 'x', carrier: 'c', operations: ['op'], relations: ['acts_on:不存在的东西'] } }, ws)
    const g3 = await call({ action: 'graph' }, ws)
    contains('图谱: 未登记关系目标被暴露', g3, '未登记关系目标')
    contains('图谱: 点名具体未登记关系', g3, 'ghost --acts_on--> 不存在的东西')
    const gf3 = /JSON（机器接口）: `([^`]+)`/.exec(g3)?.[1]
    const j3 = JSON.parse(readFileSync(gf3, 'utf8'))
    eq('图谱: gaps 记录未登记关系（增量 +1）', j3.gaps.unregisteredRelations.length, nBefore + 1)
    rmSync(gf3, { force: true })
    const gmd3 = /Markdown（人类视图）: `([^`]+)`/.exec(g3)?.[1]
    rmSync(gmd3, { force: true })
    await call({ action: 'update', id: 'ghost', state: 'abandoned', note: '测试用幽灵对象' }, ws)

    // 批量导入（对象层登记入口）+ 示例模板
    const { ws: ws3, done: done3 } = scratch('import')
    try {
      await call({ action: 'init' }, ws3)
      const imp = await call({ action: 'import', file: join(PRESET, 'examples', 'objects.json') }, ws3)
      contains('导入: 新增 5 个对象', imp, '新增: **5**')
      contains('导入: 无报错', imp, '跳过/报错: 无 ✅')
      const chk3 = await call({ action: 'check' }, ws3)
      contains('导入: 全部登记为 object', chk3, 'object 5')
      contains('导入: 对象层完整度 5/5', chk3, '对象信息完整度: 5/5')
      const g2 = await call({ action: 'graph' }, ws3)
      const gf = /JSON（机器接口）: `([^`]+)`/.exec(g2)?.[1]
      const gj = JSON.parse(readFileSync(gf, 'utf8'))
      eq('导入: 图谱对象数', gj.objects.length, 5)
      // 期望值从样本文件本身推导，避免样本更新后测试硬编码过期
      const sample = JSON.parse(readFileSync(join(PRESET, 'examples', 'objects.json'), 'utf8'))
      const sampleRels = sample.nodes.flatMap((n) => n.relations ?? [])
      const nodeTarget = sampleRels.filter((r) => !r.startsWith('invariant:'))
      const propertyRels = sampleRels.length - nodeTarget.length
      eq('导入: 节点目标关系边数', gj.edges.filter((e) => e.kind !== 'depends_on' && !String(e.kind).startsWith('invariant')).length, nodeTarget.length)
      eq('导入: 属性标签关系边数', gj.edges.filter((e) => e.kind === 'invariant').length, propertyRels)
      ok('导入: 节点目标全部已登记（无幽灵）', gj.gaps.unregisteredRelations.length === 0, JSON.stringify(gj.gaps.unregisteredRelations))
      ok('导入: 示例全部带 carrier', gj.objects.every((o) => o.carrier !== null), JSON.stringify(gj.gaps))
      ok('导入: 示例全部带 operations', gj.objects.every((o) => o.operations.length > 0))
      rmSync(gf, { force: true })
      // 幂等：再导一次是「更新」而非「新增」
      const imp2 = await call({ action: 'import', file: join(PRESET, 'examples', 'objects.json') }, ws3)
      contains('导入: 重复导入走更新', imp2, '更新: **5**')
      contains('导入: 重复导入不新增', imp2, '新增: **0**')
      // 非法条目被跳过并报错
      const bad = await call({ action: 'import', items: [{ id: 'bad', kind: 'object', statement: '缺构造' }, { id: 'ok', statement: '正常' }] }, ws3)
      contains('导入: 非法对象被跳过', bad, 'object 缺 construction')
      contains('导入: 合法条目仍导入', bad, '新增: **1**')
    } finally {
      done3()
    }
  } finally {
    done()
  }
}

// ── 24. 复用查找（写新引理前先查）─────────────────────────────────────────
{
  const { call } = await toolOf('proof-dag.mjs', 'proof_dag')
  const { ws, done } = scratch('search')
  try {
    await call({ action: 'init' }, ws)
    await call({ action: 'add', node: { id: 'A.orbit', statement: 'orbit-stabilizer：|Orbit a| × |Stab a| ≡ |G|', state: 'proven', evidence: 'x', module: 'Sovereign.Algebra.GroupTheory.OrbitStabilizer' } }, ws)
    await call({ action: 'add', node: { id: 'A.lap', statement: 'laplacian 恒零（假）', state: 'refuted' } }, ws)
    await call({ action: 'add', node: { id: 'obj.gf9', kind: 'object', statement: 'GF(9)', construction: 'GF(3) 二次扩张', carrier: '{a+bα}', operations: ['_*gf9_'], relations: ['invariant:galoisNorm'] } }, ws)

    const hit = await call({ action: 'search', query: 'orbit' }, ws)
    contains('复用: 命中已证引理', hit, 'A.orbit')
    contains('复用: 标注状态', hit, '[proven')
    contains('复用: 给出模块', hit, 'OrbitStabilizer')
    const refuted = await call({ action: 'search', query: 'laplacian' }, ws)
    contains('复用: 命中被否证方向', refuted, 'refuted')
    const obj = await call({ action: 'search', query: 'galoisNorm' }, ws)
    contains('复用: 对象关系也可检索', obj, 'obj.gf9')
    const none = await call({ action: 'search', query: '完全不存在的符号xyz' }, ws)
    contains('复用: 无命中时提示新引理流程', none, '新引理')
    await rejects('复用: 空 query 报错', () => call({ action: 'search', query: '  ' }, ws), 'query')
  } finally {
    done()
  }
}

// ── 25. 热重载：改纪律文本无需新会话 ──────────────────────────────────────
{
  const disc = await import(join(PRESET, 'plugins', 'proof-discipline.mjs'))
  const file = join(PRESET, 'impl', 'discipline.md')
  ok('热重载: 纪律真身是 impl/discipline.md', existsSync(file))
  ok('热重载: 暴露 disciplineText()', typeof disc.disciplineText === 'function')

  // 注册的是函数（harness 每次装配 prompt 重新求值）
  let sectionDef = null
  disc.apply({
    tools: { register: () => () => {} },
    effect: (fn) => { fn(); return () => {} },
    systemPrompt: { section: (d) => { sectionDef = d; return () => {} } },
    get: () => undefined,
  })
  ok('热重载: section.text 是函数（每次装配重读）', typeof sectionDef?.text === 'function', typeof sectionDef?.text)
  ok('热重载: section 名字稳定', sectionDef?.name === 'math-proof:discipline', String(sectionDef?.name))

  const before = disc.disciplineText()
  const backup = readFileSync(file, 'utf8')
  try {
    writeFileSync(file, `${backup}\n<!-- HOT-RELOAD-PROBE -->\n`, 'utf8')
    const after = disc.disciplineText()
    ok('热重载: 改文件后同进程内立即生效', after.includes('HOT-RELOAD-PROBE') && after.length > before.length, `${before.length} → ${after.length}`)
    ok('热重载: section 函数返回新内容', sectionDef.text({}).includes('HOT-RELOAD-PROBE'))
  } finally {
    writeFileSync(file, backup, 'utf8')
  }
  ok('热重载: 恢复后内容还原', !disc.disciplineText().includes('HOT-RELOAD-PROBE'))
}

// ── 汇总 ───────────────────────────────────────────────────────────────────
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'ALL_PASS' : 'FAILED'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
