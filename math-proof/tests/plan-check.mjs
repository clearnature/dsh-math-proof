// 数学证明模式 — **证明义务分解（proof_dag action:"plan"）**门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/plan-check.mjs
// 期望最后一行：PLAN_CHECK_OK n/n
//
// 为什么单独立一套：分解器是**给数学工作定形状**的东西，它出错的代价很实在——
//   · 少一条义务 → 漏项（只证一个方向 / 忘 step case）被"骨架"洗白；
//   · 多一条义务 → 台账里长出**没人会去证的假分支**，`next` 还会把它派出去（本轮就修了两处）；
//   · 校验太松 → 分解阶段就能写 `proven`，等于把"没证"写成"证了"。
// 所以这里既测**形状识别的取舍**，也测**校验会红**，还测**落盘契约**（默认不写、写了不给结论）。
//
// 全程用 `MATH_PROOF_STATE_DIR` 指到临时目录——绝不许碰用户真实台账。

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const STATE = mkdtempSync(join(tmpdir(), 'math-proof-plan-state-'))
process.env.MATH_PROOF_STATE_DIR = STATE
const WS = mkdtempSync(join(tmpdir(), 'math-proof-plan-ws-'))

const { analyzeStatement, detectShapes, findCycle, obligationId, planItemsToNodes, validatePlan } = await import(join(PRESET, 'impl', 'obligation.mjs'))
const { RULESET_VERSION } = await import(join(PRESET, 'impl', 'ruleset.mjs'))
const dagMod = await import(join(PRESET, 'plugins', 'proof-dag.mjs'))

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${String(detail).slice(0, 190)}`}`)
  if (!cond) failures++
}
const section = (t) => results.push(`\n## ${t}`)

// ── 工具调用脚手架（与 run.mjs 同款：直接注册工具再执行）────────────────────
const tools = []
dagMod.apply({
  tools: { register: (t) => { tools.push(t); return () => {} } },
  effect: (fn) => { fn(); return () => {} },
  on: () => () => {},
  systemPrompt: { section: (def) => def },
  get: () => undefined,
})
const dagTool = tools.find((t) => t.name === 'proof_dag')
ok('proof_dag 工具已注册', dagTool !== undefined)
const call = async (args) => (await dagTool.execute(args, { agent: { session: { header: { cwd: WS } } } })).report
const callErr = async (args) => {
  try {
    return { report: await call(args), error: null }
  } catch (e) {
    return { report: '', error: e instanceof Error ? e.message : String(e) }
  }
}
const readNodes = () => (existsSync(dagMod.ledgerPath(WS)) ? JSON.parse(readFileSync(dagMod.ledgerPath(WS), 'utf8')).nodes : {})

// ── 1) 形状识别：该出义务的出、该只出提醒的不出 ───────────────────────────
section('形状识别（出义务 vs 只出提醒）')
{
  const iff = analyzeStatement('a^n + b^n ≡ c^n ↔ 不存在正整数解 n≥3', 'FLT.L4')
  const leavesOf = (a) => a.items.filter((i) => i.id !== a.goalId)
  ok('双向等价 → 出两条方向义务（根之外恰好 2 条）', leavesOf(iff).length === 2 && iff.items.some((i) => i.id.endsWith('.fwd')) && iff.items.some((i) => i.id.endsWith('.bwd')), iff.items.map((i) => i.id).join(', '))
  ok('双向等价 → 根节点依赖两条方向（不依赖自己）', (() => { const root = iff.items.find((i) => i.id === 'FLT.L4'); return root.deps.length === 2 && !root.deps.includes('FLT.L4') })())
  ok('双向等价时 `equality` 降级为提醒（不再长出一条 `.decide` 假义务）', !iff.items.some((i) => i.id.endsWith('.decide')), iff.items.map((i) => i.id).join(', '))
  ok('双向等价的提醒里说清「最常见的漏项是只证一个方向」', iff.notes.some((n) => n.includes('只证一个方向')), JSON.stringify(iff.notes).slice(0, 120))

  const fa = analyzeStatement('∀ (x : Carrier) → P x → Q x', 'Thm.all')
  ok('全称单独出现时**不出** `.intro` 义务（写法纪律不是命题）', !fa.items.some((i) => i.id.endsWith('.intro')), fa.items.map((i) => i.id).join(', '))
  ok('全称仍出提醒（类型标注要写全 / 别用 `_` 省 binder）', fa.notes.some((n) => n.includes('类型标注')), JSON.stringify(fa.notes).slice(0, 120))
  ok('全称 + 蕴含 + 认不出别的形状 → 有兜底义务（不会空手而归）', fa.items.length >= 2 && fa.items.some((i) => i.id.endsWith('.lemma1')), fa.items.map((i) => i.id).join(', '))

  const ex = analyzeStatement('∃ (e : G) → e ⊗ x ≡ x', 'Grp.unit')
  ok('存在 → witness + property 两条', ex.items.some((i) => i.id.endsWith('.witness')) && ex.items.some((i) => i.id.endsWith('.property')), ex.items.map((i) => i.id).join(', '))
  ok('存在命题的 verify 指向先跑 oracle（反例敏感）', (ex.items.find((i) => i.id.endsWith('.witness')) ?? {}).verify?.includes('proof_oracle') === true, (ex.items[0] ?? {}).verify)

  const ind = analyzeStatement('∀ (n : ℕ) → count n ≡ n', 'A4.count')
  ok('归纳候选 → base + step 两条', ind.items.some((i) => i.id.endsWith('.base')) && ind.items.some((i) => i.id.endsWith('.step')), ind.items.map((i) => i.id).join(', '))
  ok('归纳的 step 义务写明要带归纳假设', (ind.items.find((i) => i.id.endsWith('.step')) ?? {}).statement?.includes('归纳假设') === true, (ind.items.find((i) => i.id.endsWith('.step')) ?? {}).statement)

  const rec = analyzeStatement('GF(9) 构成 record IsField 结构', 'GF9.field')
  ok('代数结构 → carrier + laws 两条', rec.items.some((i) => i.id.endsWith('.carrier')) && rec.items.some((i) => i.id.endsWith('.laws')), rec.items.map((i) => i.id).join(', '))
  ok('结构的 laws 义务强调「定律是证明项、不是注释」', (rec.items.find((i) => i.id.endsWith('.laws')) ?? {}).why?.includes('不是注释') === true, (rec.items.find((i) => i.id.endsWith('.laws')) ?? {}).why)

  const eq = analyzeStatement('f x ≡ g x', 'Eq.simple')
  ok('相等单独出现 → 一条判定义务（refl 与链是同一件事的两条路线）', leavesOf(eq).length === 1 && eq.items.some((i) => i.id.endsWith('.decide')), eq.items.map((i) => i.id).join(', '))

  const hw = analyzeStatement('显然每个零点都是零因子', 'Hand.wave')
  ok('手挥词 → 出提醒但不出义务（纪律标记）', hw.notes.some((n) => n.includes('不是证明项')) && !hw.items.some((i) => i.id.endsWith('.term')), hw.items.map((i) => i.id).join(', '))

  ok('空语句 → 不出义务且说清原因', analyzeStatement('', 'X').items.length === 0 && analyzeStatement('', 'X').notes.length > 0)
  ok('id 规整：空格与非法字符不进 id', obligationId('My Thm!', 'a b') === 'My-Thm.a-b', obligationId('My Thm!', 'a b'))
  ok('detectShapes 纯文本判定（不假装理解数学）', detectShapes('∀ n → n ≡ n').map((s) => s.id).join(',') === 'forall,equality', detectShapes('∀ n → n ≡ n').map((s) => s.id).join(','))
  ok('每条义务都带 verify（机器出骨架时不留空判据）', [...iff.items, ...ex.items, ...ind.items, ...rec.items, ...eq.items].every((i) => String(i.verify ?? '').trim() !== ''))
  ok('机器出的骨架**绝不**自带状态（连 state 字段都不写，落盘时才统一成 pending）', [...iff.items, ...ex.items, ...eq.items].every((i) => i.state === undefined))
}

// ── 2) 校验：该红的必须红（逐条负向）────────────────────────────────────
section('校验（负向：每条纪律都能被判出来）')
{
  const base = [
    { id: 'g', statement: '目标命题', deps: ['a', 'b'], verify: 'proof_compile' },
    { id: 'a', statement: '子义务 A', verify: 'proof_compile' },
    { id: 'b', statement: '子义务 B', verify: 'proof_compile' },
  ]
  ok('基线：合法分解通过', validatePlan(base, { goalId: 'g' }).ok === true, JSON.stringify(validatePlan(base, { goalId: 'g' }).problems))

  const noVerify = base.map((x) => (x.id === 'a' ? { ...x, verify: '' } : x))
  const r1 = validatePlan(noVerify, { goalId: 'g' })
  ok('缺 `verify` → 红（分解的核心纪律）', r1.ok === false && r1.problems.some((p) => p.includes('verify')), r1.problems.join('｜'))

  const noStmt = base.map((x) => (x.id === 'b' ? { ...x, statement: '' } : x))
  ok('缺 `statement` → 红', validatePlan(noStmt, { goalId: 'g' }).problems.some((p) => p.includes('statement')))

  const dangling = base.map((x) => (x.id === 'g' ? { ...x, deps: ['a', 'ghost'] } : x))
  ok('悬空依赖 → 红', validatePlan(dangling, { goalId: 'g' }).problems.some((p) => p.includes('ghost')))

  const cyclic = [
    { id: 'x', statement: 'X', deps: ['y'], verify: 'v' },
    { id: 'y', statement: 'Y', deps: ['x'], verify: 'v' },
  ]
  const rc = validatePlan(cyclic, {})
  ok('成环 → 红，且指名环上节点', rc.ok === false && rc.problems.some((p) => p.includes('成环')), rc.problems.join('｜'))
  ok('findCycle 直接测：a→b→a 报出两个节点', findCycle([{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['a'] }]).length === 2, JSON.stringify(findCycle([{ id: 'a', deps: ['b'] }, { id: 'b', deps: ['a'] }])))

  const proven = base.map((x) => (x.id === 'a' ? { ...x, state: 'proven' } : x))
  const rp = validatePlan(proven, { goalId: 'g' })
  ok('分解阶段写 `proven` → 红（结论只能来自回执）', rp.ok === false && rp.problems.some((p) => p.includes('不许自带结论')), rp.problems.join('｜'))

  const obj = [
    { id: 'o', kind: 'object', statement: '对象 O', deps: [], verify: 'v' },
    { id: 'g', statement: '目标', deps: ['o'], verify: 'v' },
  ]
  ok('object 缺 construction → 红（对象层不允许只有公理）', validatePlan(obj, { goalId: 'g' }).problems.some((p) => p.includes('construction')))

  const noRoot = [
    { id: 'a', statement: 'A', deps: ['b'], verify: 'v' },
    { id: 'b', statement: 'B', deps: ['a'], verify: 'v' },
  ]
  ok('互相依赖、没有根 → 红（并另外报成环）', validatePlan(noRoot, {}).problems.some((p) => p.includes('没有组合')))

  ok('方案里没有以目标 id 收口的根 → 红', validatePlan([{ id: 'a', statement: 'A', deps: [], verify: 'v' }], { goalId: 'g' }).problems.some((p) => p.includes('g')))
  ok('id 重复 → 红', validatePlan([{ id: 'a', statement: 'A', verify: 'v' }, { id: 'a', statement: 'A2', verify: 'v' }], {}).problems.some((p) => p.includes('id 重复')))
  ok('空方案 → 红', validatePlan([], {}).ok === false)

  const tooMany = Array.from({ length: 14 }, (_, i) => ({ id: `n${i}`, statement: `S${i}`, deps: i === 0 ? [] : ['n0'], verify: 'v' }))
  ok('超过上限 → 提醒（不是红）', validatePlan(tooMany, {}).warnings.some((w) => w.includes('上限')), validatePlan(tooMany, {}).warnings.join('｜'))
  ok('只有一条 → 提醒「这更像一条引理」', validatePlan([{ id: 'a', statement: 'A', deps: [], verify: 'v' }], {}).warnings.some((w) => w.includes('更像一条引理')))
  ok('陈述重复 → 提醒合并', validatePlan([{ id: 'a', statement: '同', verify: 'v' }, { id: 'b', statement: '同', verify: 'v' }], {}).warnings.some((w) => w.includes('重复')))
  ok('planItemsToNodes：一律 pending、带 source=plan、verify 进 note', (() => {
    const n = planItemsToNodes([{ id: 'a', statement: 'A', verify: '怎么验证', why: '为什么', deps: ['b'] }])[0]
    return n.state === 'pending' && n.source === 'plan' && n.note.includes('怎么验证') && n.note.includes('为什么') && JSON.stringify(n.deps) === '["b"]'
  })())
}

// ── 3) 落盘契约（真跑工具）──────────────────────────────────────────────
section('落盘契约（先看后写 / 只种骨架 / 不留假证据）')
{
  ok('plan 用空参数调用 → 明确报错（不是静默返回空报告）', (await callErr({ action: 'plan' })).error !== null, (await callErr({ action: 'plan' })).error)

  const dry = await call({ action: 'plan', statement: '∀ n → n + 0 ≡ n', goalId: 'Nat.pz' })
  ok('默认**不落盘**：只渲染骨架', dry.includes('proof_dag: plan') && Object.keys(readNodes()).length === 0, Object.keys(readNodes()).join(','))
  ok('报告含诚实边界（骨架不是证明 / 结论只来自回执）', dry.includes('这是骨架，不是证明') && dry.includes('结论只来自回执'))
  ok('报告给出下一步（commit:true 落盘）', dry.includes('commit: true'))

  const committed = await call({ action: 'plan', statement: '∀ n → n + 0 ≡ n', goalId: 'Nat.pz', commit: true })
  const nodes = readNodes()
  ok('commit:true → 节点落盘', Object.keys(nodes).length === 2, Object.keys(nodes).join(','))
  ok('落盘节点**一律 pending**（骨架不给结论）且条数为 2', Object.keys(nodes).length === 2 && Object.values(nodes).every((n) => n.state === 'pending'), Object.values(nodes).map((n) => n.state).join(','))
  ok('落盘节点带 `source: plan`（可追溯是分解器种的）', Object.values(nodes).every((n) => n.source === 'plan'))
  ok('落盘节点带「怎么验证」（判据随节点走，不留在聊天里）', Object.values(nodes).every((n) => String(n.note ?? '').includes('怎么验证')))
  ok('根节点依赖叶子', (nodes['Nat.pz']?.deps ?? []).includes('Nat.pz.decide'), JSON.stringify(nodes['Nat.pz']?.deps))
  // 空节点的 `every()` 会**真空通过**——所以先钉住条数，再判内容（否则「一律 pending」这类断言会骗人）
  ok('落盘条数正确（先钉条数，避免空集合让后面的断言真空通过）', Object.keys(nodes).length === 2, Object.keys(nodes).join(','))
  ok('落盘后报告写明已落盘', committed.startsWith('# proof_dag: plan（已落盘）'), committed.split('\n')[0])
  ok('journal 留痕（分解这件事本身可追溯）', JSON.parse(readFileSync(dagMod.ledgerPath(WS), 'utf8')).journal.some((e) => String(e.text ?? '').includes('拆解')), JSON.stringify(JSON.parse(readFileSync(dagMod.ledgerPath(WS), 'utf8')).journal).slice(0, 120))

  const next = await call({ action: 'next' })
  ok('`next` 只派发叶子（根因依赖未 proven 不派）', next.includes('Nat.pz.decide') && !next.includes('1. `Nat.pz`'), next.slice(0, 200))

  const again = await call({ action: 'plan', statement: '∀ n → n + 0 ≡ n', goalId: 'Nat.pz', commit: true })
  ok('重复分解同一目标 → 被 id 冲突拦（不覆盖已有节点）', again.includes('台账里已经有了') && Object.keys(readNodes()).length === 2, again.split('\n').filter((l) => l.startsWith('- ')).slice(0, 2).join('｜'))

  const bad = await call({ action: 'plan', goalId: 'Bad.plan', commit: true, items: [
    { id: 'Bad.plan.a', statement: '缺 verify 的义务', deps: [] },
    { id: 'Bad.plan', statement: '目标', deps: ['Bad.plan.a'], verify: 'v' },
  ] })
  ok('带阻断问题的方案 commit → **不落盘**且说明原因', bad.includes('未落盘') && readNodes()['Bad.plan.a'] === undefined, bad.includes('未落盘') ? 'ok' : '未写「未落盘」')

  const okPlan = await call({ action: 'plan', goalId: 'Good.plan', commit: true, items: [
    { id: 'Good.plan.a', statement: '子义务 A', deps: [], verify: 'proof_compile', why: 'why A' },
    { id: 'Good.plan.b', statement: '子义务 B', deps: [], verify: 'proof_oracle 先搜反例', why: 'why B' },
    { id: 'Good.plan', statement: '目标', deps: ['Good.plan.a', 'Good.plan.b'], verify: '子义务回执', why: '组合' },
  ] })
  // 证据纪律：骨架走的是 **import** 通道，所以「proven 但无回执」必须被通道自己拦住
  const sneaky = await call({ action: 'import', items: [{ id: 'Sneaky.proven', statement: '我声称证完了', deps: [], state: 'proven' }] })
  ok('import 通道拒收「proven 但无回执」（分解器依赖这条纪律）', sneaky.includes('没有有效回执') && readNodes()['Sneaky.proven'] === undefined, sneaky.split('\n').slice(3, 5).join('｜'))

  const n2 = readNodes()
  ok('模型自带的分解方案（结构合法）能落盘', n2['Good.plan'] !== undefined && (n2['Good.plan'].deps ?? []).length === 2, JSON.stringify(n2['Good.plan']?.deps))
  ok('模型方案里的 verify 被留在节点 note 里（不是丢掉）', String(n2['Good.plan.b']?.note ?? '').includes('proof_oracle'), n2['Good.plan.b']?.note)
  ok('落盘报告带规则集戳（分解规则冷档、可追溯）', okPlan.includes(`规则集: \`${RULESET_VERSION}/`), okPlan.split('\n').pop())
}

rmSync(STATE, { recursive: true, force: true })
rmSync(WS, { recursive: true, force: true })

console.log('# 证明义务分解（plan）门禁\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'PLAN_CHECK_OK' : 'PLAN_CHECK_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
