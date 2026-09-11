// 数学证明模式 — **证明义务分解**（零依赖，纯函数）
//
// 这一层回答一个问题：**「把目标拆成可独立验证的子义务」这件事，机器能替人做哪一部分？**
//
// 诚实边界（必须写在报告里，也必须写在这里）：
//   · 机器**不能**替你想出数学分解——它做的是**形状识别 + 漏项检查 + 纪律校验**：
//     认出「双向等价 / 全称 / 存在 / 归纳候选 / 代数结构 / 定义相等」这些**常见漏项形状**，
//     给出该形状**标准子义务**的骨架，并强制每条义务写清「怎么验证」；
//   · 骨架**不是证明**：所有生成的节点一律 `pending`，而且**禁止**自带 `proven`/`refuted`
//     这类结论——结论只能来自 `proof_compile` 签发的回执（或 `proof_oracle` 的回执）。
//
// 为什么要有它（而不是继续写在提示词里）：提示词里的「拆解纪律」靠模型自觉，
// 而「只证了一个方向」「忘了 step case」「结构只写了载体没写定律」「分解完没有组合节点」
// 这四类漏项**是可以被机器判定的**。判得出来的就不该靠自觉——这是本 preset 的一贯做法
// （闸门 > 提醒；能拦就不劝）。
//
// 规则表在 `impl/ruleset.mjs` 的 `PLAN`（冷档，改动要 bump RULESET_VERSION），本文件只解释它。

import { PLAN } from './ruleset.mjs'

/** 把义务 id 规整成安全形式（点号分层；去掉空白与换行，保留 Agda 标识符可用的字符）。 */
export function obligationId(base, suffix = '') {
  const clean = (s) =>
    String(s ?? '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w.\u4e00-\u9fff-]/g, '')
      .replace(/^[.-]+|[.-]+$/g, '')
  const b = clean(base) === '' ? 'goal' : clean(base)
  return suffix === '' ? b : `${b}.${clean(suffix)}`
}

/** 单行化（报告与 statement 里不出现换行）。 */
const flat = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()

/** 用 `{A}`/`{B}` 填模板；缺捕获时退化为原样模板里的整句。 */
function fill(template, caps, whole) {
  return flat(String(template ?? '').replace(/\{A\}/g, caps[0] ?? whole).replace(/\{B\}/g, caps[1] ?? whole))
}

/**
 * 形状识别：**只看语句文本**，不假装理解数学。
 * @returns {{id: string, what: string, caps: string[]}[]}
 */
export function detectShapes(statement) {
  const text = flat(statement)
  const out = []
  for (const shape of PLAN.shapes) {
    const re = new RegExp(shape.match)
    if (!re.test(text)) continue
    let caps = [text, text]
    if (typeof shape.split === 'string' && shape.split !== '') {
      const m = new RegExp(shape.split).exec(text)
      if (m !== null && m.length >= 3) caps = [flat(m[1]), flat(m[2])]
    }
    out.push({ id: shape.id, what: shape.what, caps, note: shape.note })
  }
  return out
}

/**
 * 把一个目标语句拆成**义务骨架**。
 *
 * @param statement - 目标命题原文（要可验证的陈述，不是「证明 X」）
 * @param goalId - 可选：目标在台账里的 id（给了就用它当根节点 id）
 * @param options - `{ rules }` 覆盖 `PLAN`（测试用）
 * @returns `{ goalId, statement, shapes, items, notes }`
 */
export function analyzeStatement(statement, goalId = '', options = {}) {
  const plan = options.rules ?? PLAN
  const text = flat(statement)
  if (text === '') return { goalId: '', statement: '', shapes: [], items: [], notes: ['目标语句是空的——先写清要证什么（可验证的命题，不是「证明 X」）'] }
  const rootId = obligationId(goalId === '' ? plan.defaultGoalId ?? 'goal' : goalId)
  const shapes = detectShapes(text)
  const items = []
  const notes = []
  const seenSuffix = new Set()

  for (const shape of shapes) {
    const rule = plan.shapes.find((s) => s.id === shape.id)
    // advisory 形状（如「全称：类型标注要写全」）只出提醒、不出义务——
    // 判据是它有没有**可独立验证的内容**；写法纪律不是命题。
    // `advisoryIf`：当同句里还命中了更**结构性**的形状时，本条降级成提醒（技法提醒 vs 并列义务）。
    const downgraded = Array.isArray(rule?.advisoryIf) && rule.advisoryIf.some((id) => shapes.some((x) => x.id === id))
    if (rule?.advisory === true || downgraded) {
      if (typeof rule.note === 'string' && rule.note !== '') notes.push(`- \`${shape.id}\`（${shape.what}）：${rule.note}`)
      continue
    }
    const obligations = rule?.obligations ?? []
    obligations.forEach((ob, i) => {
      const suffix = typeof ob.suffix === 'string' && ob.suffix !== '' ? ob.suffix : `${shape.id}${i + 1}`
      if (seenSuffix.has(suffix)) return
      seenSuffix.add(suffix)
      items.push({
        id: obligationId(rootId, suffix),
        statement: fill(ob.statement, shape.caps, text),
        verify: flat(ob.verify ?? plan.defaultVerify),
        why: flat(ob.why ?? shape.what),
        shape: shape.id,
      })
    })
    if (typeof rule?.note === 'string' && rule.note !== '') notes.push(`- \`${shape.id}\`（${shape.what}）：${rule.note}`)
  }

  if (items.length === 0) {
    // 认不出形状也要给一条**可执行**的起点，而不是空手而归
    items.push({
      id: obligationId(rootId, 'lemma1'),
      statement: text,
      verify: flat(plan.defaultVerify),
      why: '未识别到常见漏项形状：至少先把陈述写成一条可独立编译的引理，再决定怎么拆',
      shape: 'fallback',
    })
    notes.push('- 没认出常见形状（双向/全称/存在/归纳/结构/定义相等），所以只给一条起点：**先把陈述本身写成引理**。')
  }

  // 根（组合）节点：子义务靠它闭合——「子义务都证了」不等于「目标证了」
  const root = {
    id: rootId,
    statement: text,
    deps: items.map((it) => it.id),
    verify: flat(plan.rootVerify),
    why: '组合：下列子义务合起来蕴含本目标（缺了它，子义务证完也不代表目标证完）',
    shape: 'root',
  }

  return { goalId: rootId, statement: text, shapes: shapes.map((s) => s.id), items: [...items, root], notes }
}

/** 有向图找环（返回参与环的 id；无环返回空数组）。 */
export function findCycle(items) {
  const ids = new Set(items.map((it) => it.id))
  const deps = new Map(items.map((it) => [it.id, (it.deps ?? []).filter((d) => ids.has(d))]))
  const state = new Map() // 0 未访问 / 1 在栈 / 2 完成
  const stack = []
  const cycles = []
  const visit = (id) => {
    const st = state.get(id) ?? 0
    if (st === 2) return
    if (st === 1) {
      const from = stack.indexOf(id)
      cycles.push(...stack.slice(from === -1 ? 0 : from))
      return
    }
    state.set(id, 1)
    stack.push(id)
    for (const d of deps.get(id) ?? []) visit(d)
    stack.pop()
    state.set(id, 2)
  }
  for (const it of items) visit(it.id)
  return [...new Set(cycles)]
}

/**
 * 校验一份分解方案（无论是模型给的，还是上面骨架生成的）。
 * 判的是**结构与纪律**，不是数学对错——数学对错只有 Agda 说了算。
 *
 * @returns `{ ok, problems, warnings, notes }`
 */
export function validatePlan(items, options = {}) {
  const plan = options.rules ?? PLAN
  const knownIds = new Set(options.knownIds ?? [])
  const problems = []
  const warnings = []
  const notes = []

  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, problems: ['分解方案是空的：至少要有子义务 + 一条组合（根）节点'], warnings, notes }
  }
  const ids = items.map((it) => String(it?.id ?? '').trim())
  const dup = ids.filter((id, i) => id !== '' && ids.indexOf(id) !== i)
  if (dup.length > 0) problems.push(`id 重复：${[...new Set(dup)].join(', ')}`)
  for (const it of items) {
    const id = String(it?.id ?? '').trim() === '' ? '(缺 id)' : String(it.id)
    if (String(it?.id ?? '').trim() === '') problems.push('有条目缺 id')
    if (flat(it?.statement) === '') problems.push(`${id}: 缺 \`statement\`（义务必须是可验证命题，不能是「证明 X」）`)
    // **核心纪律**：每条义务必须写清「怎么验证」——没有判据的义务会退化成口号
    if (plan.requireVerify !== false && flat(it?.verify) === '') problems.push(`${id}: 缺 \`verify\`（怎么验证这条义务：proof_compile / proof_oracle / 逐 case 枚举…）`)
    // 骨架不许自带结论：结论只能来自回执
    const state = it?.state === undefined || it?.state === null ? 'pending' : String(it.state)
    if ((plan.forbidStates ?? []).includes(state)) {
      problems.push(`${id}: state="${state}" —— 分解阶段**不许自带结论**；结论只能由 \`proof_compile\` 回执给出（先登记为 pending）`)
    } else if (!(plan.allowStates ?? ['pending', 'active']).includes(state)) {
      warnings.push(`${id}: state="${state}" 不是分解阶段的常规取值（建议 pending）`)
    }
    if (String(it?.kind ?? 'lemma') === 'object' && flat(it?.construction) === '') {
      problems.push(`${id}: kind="object" 必须给 \`construction\`（由什么生成：载体 + 生成元 + 关系）`)
    }
    for (const d of it?.deps ?? []) {
      const dep = String(d)
      if (!ids.includes(dep) && !knownIds.has(dep)) problems.push(`${id}: 依赖 \`${dep}\` 既不在本方案里、也不在台账里（悬空依赖）`)
    }
  }
  const cycle = findCycle(items)
  if (cycle.length > 0) problems.push(`依赖成环：${cycle.join(' → ')}`)

  // 覆盖：必须有一条「根」——它的依赖覆盖其余条目，或者没有出边的条目唯一
  const referenced = new Set(items.flatMap((it) => (it?.deps ?? []).map(String)))
  const roots = items.filter((it) => !referenced.has(String(it?.id ?? '')))
  if (roots.length === 0) problems.push('没有组合（根）节点：所有条目互相依赖，无法收敛——分解必须给出「谁依赖谁」的方向')
  else if (roots.length > 1) {
    warnings.push(`有 ${roots.length} 个未被依赖的条目（${roots.map((r) => r.id).join(', ')}）：确认它们都是叶子义务，而不是漏了组合关系`)
  }
  if (options.goalId !== undefined && options.goalId !== '' && !items.some((it) => String(it?.id ?? '') === String(options.goalId))) {
    problems.push(`方案里没有以目标 id \`${options.goalId}\` 收口的根节点：子义务证完也不代表目标证完`)
  }

  // 粒度
  const n = items.length
  if (n < (plan.minObligations ?? 2)) warnings.push(`只有 ${n} 条：这更像一条引理，不需要「分解」`)
  if (n > (plan.maxObligations ?? 12)) warnings.push(`${n} 条超过上限 ${plan.maxObligations ?? 12}：分解没收敛，先把它们归成几组再登记`)

  // 重复陈述
  const stmts = items.map((it) => flat(it?.statement))
  const dupStmt = stmts.filter((s, i) => s !== '' && stmts.indexOf(s) !== i)
  if (dupStmt.length > 0) warnings.push(`有条目陈述重复（${[...new Set(dupStmt)].map((s) => s.slice(0, 40)).join(' / ')}）：合并它们，或说明为什么需要两条`)

  return { ok: problems.length === 0, problems, warnings, notes }
}

/** 台账节点的最小形态（plan 落盘用；证据字段一律不带——骨架没有证据）。 */
export function planItemsToNodes(items) {
  return items.map((it) => ({
    id: String(it.id),
    kind: String(it.kind ?? 'lemma'),
    statement: flat(it.statement),
    construction: flat(it.construction) === '' ? undefined : flat(it.construction),
    deps: (it.deps ?? []).map(String),
    state: 'pending',
    source: 'plan',
    note: [flat(it.why) === '' ? '' : `为什么：${flat(it.why)}`, flat(it.verify) === '' ? '' : `怎么验证：${flat(it.verify)}`].filter((s) => s !== '').join('｜'),
    module: flat(it.module) === '' ? undefined : flat(it.module),
    owner: flat(it.owner) === '' ? undefined : flat(it.owner),
  }))
}

/** 分解纪律的**常驻提醒**（写进报告尾部：机器说得出的话，人也要看得见）。 */
export const PLAN_DISCLAIMER = [
  '**这是骨架，不是证明**：每一条义务都要你自己给出项，并通过 `proof_compile`（或 `proof_oracle`）拿到回执才算数。',
  '**结论只来自回执**：分解阶段一律 `pending`——把没证的写成证了，比停下来更严重。',
  '**先算后验证**：形状里有「存在/反例敏感」的义务时，先 `proof_oracle` 搜反例，再动笔写证明。',
]
