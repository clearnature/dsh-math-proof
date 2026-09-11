// 数学证明模式 — **Agda 交互式查询**（`agda --interaction-json`）与渲染（零依赖、纯函数）
//
// 这一层把「写证明项时最缺的信息」从 Agda 里取出来：**洞在哪、目标是什么、上下文里有什么、
// 这个项过不过、这个变量怎么分情况、自动搜索给什么候选**。
//
// 为什么**不**接 `agda-language-server`（ALS；检出目录的定位见「本机路径表」，本文件不写机器绝对路径）：
//   · ALS 0.2.7 明确支持的 Agda 是 **2.6.4.3 / 2.7.0.1 / 2.8.0**；本机是 **2.9.0-nightly**（实测 `agda --version`），
//     且该检出**没有构建产物**（无 `dist-newstyle`/`.stack-work`，PATH 上没有 `als`）；
//   · ALS 自己就是**驱动 `agda --interaction(-json)`** 的 LSP 前端——它做的编辑动作（give/refine/case）
//     最终都落在这套 IOTCM 命令上。我们直接驱动这一层：**零新依赖、与装着的 Agda 同版本、不预设别人的环境**。
//   · 将来若真要接 ALS（并对 2.9.0 构建），下面的 action ↔ LSP agda-mode 请求是一一对应的，
//     替换后端不影响工具签名（映射表见 `skills/agda-proof-engine/SKILL.md` 的交互一节）。
//
// 实测（2026-09-11，Agda 2.9.0-nightly）：交互命令**不改磁盘**（give/auto/case 只在内存里生效），
// 所以本工具是**只读**的；反过来说：它给出的任何结果**都不是证据**，证据只能由 `proof_compile` 签发回执。
//
// 协议形状（真实报文见 `tests/fixtures/agda-interaction-basic.txt`）：
//   输入：`IOTCM "<file>" NonInteractive Direct (<Cmd_…>)` 每行一条，喂给 `agda --interaction-json` 的 stdin；
//   输出：stdout 上每行一个 JSON（命令提示符是 `JSON> `，紧贴在**该命令的第一条响应**前）。

/** 支持的 action（与插件 schema 同源）。 */
export const GOALS_ACTIONS = ['list', 'context', 'infer', 'give', 'case', 'auto', 'normalize']

/** Haskell 字符串字面量（IOTCM 用 `show` 解析路径）。 */
export function haskellString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 构造喂给 `agda --interaction-json` 的命令行（**顺序即语义**：先 load，后查询）。
 * @returns `{ lines: string[], needs: string[] }`（`needs` 用于给出「缺什么参数」的明确报错）
 */
export function buildCommands({ action = 'list', path = '', goal = 0, expr = '', on = '' } = {}) {
  const needs = []
  const f = haskellString(path)
  const id = Number.isInteger(goal) ? goal : Number.parseInt(String(goal), 10)
  const gid = Number.isFinite(id) ? id : 0
  const lines = [`IOTCM ${f} NonInteractive Direct (Cmd_load ${f} [])`]
  switch (action) {
    case 'list':
      break // `Cmd_load` 自带 `AllGoalsWarnings`（洞清单 + 每个洞的类型）
    case 'context':
      lines.push(`IOTCM ${f} NonInteractive Direct (Cmd_goal_type_context Normalised ${gid} noRange "")`)
      break
    case 'infer':
      if (String(expr).trim() === '') needs.push('infer 需要 `expr`（要推断类型的表达式）')
      lines.push(`IOTCM ${f} NonInteractive Direct (Cmd_infer AsIs ${gid} noRange ${haskellString(expr)})`)
      break
    case 'give':
      // WithoutForce：不做额外检查（与 agda-mode 的 C-c C-SPC 一致）
      if (String(expr).trim() === '') needs.push('give 需要 `expr`（要在该洞里试的项）')
      lines.push(`IOTCM ${f} NonInteractive Direct (Cmd_give WithoutForce ${gid} noRange ${haskellString(expr)})`)
      break
    case 'case':
      if (String(on).trim() === '') needs.push('case 需要 `on`（要分情况的变量名）')
      lines.push(`IOTCM ${f} NonInteractive Direct (Cmd_make_case ${gid} noRange ${haskellString(on)})`)
      break
    case 'auto':
      // autoAll：让 Agda 的 proof search 对**所有洞**给候选（有就报，没有就空手）
      lines.push(`IOTCM ${f} NonInteractive Direct (Cmd_autoAll AsIs)`)
      break
    case 'normalize':
      if (String(expr).trim() === '') needs.push('normalize 需要 `expr`（要归一化的表达式）')
      lines.push(`IOTCM ${f} NonInteractive Direct (Cmd_compute DefaultCompute ${gid} noRange ${haskellString(expr)})`)
      break
    default:
      needs.push(`未知 action \`${action}\`（支持 ${GOALS_ACTIONS.join(' | ')}）`)
  }
  return { lines, needs }
}

/** 从响应里的 range 取「行:列-列」（Agda 的 JSON 行列都是 1 基，end 不含）。 */
export function rangeLabel(range) {
  const r = Array.isArray(range) ? range[0] : range
  const s = r?.start
  const e = r?.end
  if (s === undefined) return '—'
  return e === undefined ? `${s.line}:${s.col}` : `${s.line}:${s.col}-${e.col}`
}

/**
 * 解析 `--interaction-json` 的输出流。
 * 只认 JSON 行（可选 `JSON> ` 前缀）；非 JSON 行原样留在 `raw`，**不假装理解**。
 */
export function parseStream(text) {
  const out = { goals: [], goalType: null, inferred: null, normalForm: null, give: null, makeCase: null, errors: [], warnings: [], status: null, loaded: false, raw: [] }
  const take = (o) => {
    const k = o?.kind
    if (k === undefined) return
    if (k === 'DisplayInfo') {
      const info = o.info ?? {}
      if (info.kind === 'AllGoalsWarnings') {
        out.loaded = true // `Cmd_load` 的响应：装载完成（成功与否看 errors）
        for (const g of info.visibleGoals ?? []) {
          out.goals.push({ id: g?.constraintObj?.id ?? out.goals.length, range: rangeLabel(g?.constraintObj?.range), type: String(g?.type ?? ''), kind: String(g?.kind ?? '') })
        }
        for (const g of info.invisibleGoals ?? []) {
          out.goals.push({ id: g?.constraintObj?.id ?? out.goals.length, range: rangeLabel(g?.constraintObj?.range), type: String(g?.type ?? ''), kind: 'Invisible' })
        }
        for (const e of info.errors ?? []) out.errors.push(String(e?.message ?? e))
        for (const w of info.warnings ?? []) out.warnings.push(String(w?.message ?? w))
      } else if (info.kind === 'Error') {
        out.errors.push(String(info.error?.message ?? info.error ?? '（无法读取的错误）'))
      } else if (info.kind === 'GoalSpecific') {
        const gi = info.goalInfo ?? {}
        if (gi.kind === 'GoalType') {
          out.goalType = {
            id: info.interactionPoint?.id ?? null,
            range: rangeLabel(info.interactionPoint?.range),
            type: String(gi.type ?? ''),
            rewrite: String(gi.rewrite ?? ''),
            entries: (gi.entries ?? []).map((e) => ({ name: String(e?.originalName ?? e?.reifiedName ?? ''), type: String(e?.binding ?? ''), inScope: e?.inScope !== false })),
            boundary: (gi.boundary ?? []).map((b) => (typeof b === 'string' ? b : JSON.stringify(b))),
          }
        } else if (gi.kind === 'InferredType') {
          out.inferred = { expr: String(gi.expr ?? ''), id: info.interactionPoint?.id ?? null }
        } else if (gi.kind === 'NormalForm') {
          out.normalForm = { expr: String(gi.expr ?? ''), computeMode: String(gi.computeMode ?? '') }
        }
      }
      return
    }
    if (k === 'GiveAction') out.give = { id: o.interactionPoint?.id ?? null, range: rangeLabel(o.interactionPoint?.range), result: o.giveResult ?? null }
    else if (k === 'MakeCase') out.makeCase = { id: o.interactionPoint?.id ?? null, variant: String(o.variant ?? ''), clauses: (o.clauses ?? []).map(String) }
    else if (k === 'Status') out.status = o.status ?? null
    else if (k === 'Error') out.errors.push(String(o.error?.message ?? o.error ?? '（无法读取的错误）'))
  }
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const body = trimmed.startsWith('JSON>') ? trimmed.slice(5).trim() : trimmed
    if (body === '') continue
    if (!body.startsWith('{')) {
      out.raw.push(body) // `cannot read: …` 这类不是 JSON：如实保留
      continue
    }
    try {
      take(JSON.parse(body))
    } catch {
      out.raw.push(body.slice(0, 300))
    }
  }
  return out
}

/** 是否装载成功（有洞或有错都算「装载过」；`cannot read` 之类会留在 raw 里由调用方报出）。 */
export function loadFailed(parsed) {
  return parsed.loaded !== true && parsed.errors.length > 0
}

const CODE = '```'
/** 统一的「这不是证据」提醒——交互结果只在内存里，回执只能由 proof_compile 签发。 */
export const NOT_EVIDENCE =
  '> ⚠ **这不是证据**：交互命令只在 Agda 内存里生效（不改磁盘），本工具**不签发回执**。' +
  '要证据必须把结果真的写进文件，再跑 `proof_compile`。'

/** 洞清单（list 的渲染）。 */
export function renderGoals(parsed, meta = {}) {
  const L = [`# proof_goals: ${meta.path ?? ''}（list）`, '']
  if (meta.checker !== undefined) L.push(`- 检查器: \`${meta.checker}\``)
  L.push(`- 洞: **${parsed.goals.length}** 个${parsed.goals.length === 0 ? '（当前没有未解决的洞）' : ''}`)
  if (parsed.goals.length > 0) {
    L.push('', '| # | 位置 | 目标类型 |', '| --- | --- | --- |')
    for (const g of parsed.goals.slice(0, 40)) L.push(`| ${g.id} | ${g.range} | ${g.type.slice(0, 120)} |`)
    L.push('', '> 下一步：`action:"context"` 看某个洞**上下文里有什么名字**（那些就是你能直接用的项）；卡住时 `action:"auto"` 让 Agda 的 proof search 给候选，`action:"case"` 对变量分情况。')
  }
  if (parsed.errors.length > 0) L.push('', '## ❌ 装载报错（先修这些，洞才有意义）', ...parsed.errors.map((e) => `- ${String(e).slice(0, 400)}`))
  L.push('', NOT_EVIDENCE)
  return L.join('\n')
}

/** 目标 + 上下文（context 的渲染）。 */
export function renderContext(parsed, meta = {}) {
  const gt = parsed.goalType
  const L = [`# proof_goals: ${meta.path ?? ''}（context｜洞 ${meta.goal ?? 0}）`, '']
  if (gt === null) {
    L.push('❌ 没拿到目标信息——多半是**洞 id 不对**或该洞已被关闭。先跑 `action:"list"` 看现存的洞。')
    if (parsed.errors.length > 0) L.push('', ...parsed.errors.map((e) => `- ${String(e).slice(0, 400)}`))
    return L.join('\n')
  }
  L.push(`- 位置: ${gt.range}${gt.rewrite === '' ? '' : `（${gt.rewrite}）`}`)
  L.push(`- **目标**: \`${gt.type}\``)
  if (gt.boundary.length > 0) L.push('', '边界/约束:', ...gt.boundary.map((b) => `- \`${String(b).slice(0, 200)}\``))
  L.push('', `上下文（**这些名字就是你能直接用的项**）：`)
  if (gt.entries.length === 0) L.push('', '（空上下文——只能靠目标类型本身构造，或先引入参数）')
  else {
    L.push('', '| 名字 | 类型 |', '| --- | --- |')
    for (const e of gt.entries) L.push(`| \`${e.name}\`${e.inScope ? '' : ' ⚠不在作用域'} | ${e.type.slice(0, 120)} |`)
  }
  L.push('', '> 写项时优先用上下文里的名字；需要分情况用 `action:"case"`，需要试探某个项用 `action:"give"`（不通过会告诉你**期望类型 vs 实际类型**）。')
  L.push('', NOT_EVIDENCE)
  return L.join('\n')
}

/** 类型推断（infer 的渲染）。 */
export function renderInfer(parsed, meta = {}) {
  const L = [`# proof_goals: ${meta.path ?? ''}（infer）`, '']
  if (parsed.inferred === null) {
    L.push('❌ 没拿到推断结果——表达式可能无法解析，或该洞不存在。')
    if (parsed.errors.length > 0) L.push('', ...parsed.errors.map((e) => `- ${String(e).slice(0, 400)}`))
    return L.join('\n')
  }
  L.push(`- \`${meta.expr ?? ''}\` : \`${parsed.inferred.expr}\``)
  L.push('', NOT_EVIDENCE)
  return L.join('\n')
}

/** 归一化（normalize 的渲染）。 */
export function renderNormalize(parsed, meta = {}) {
  const L = [`# proof_goals: ${meta.path ?? ''}（normalize）`, '']
  if (parsed.normalForm === null) {
    L.push('❌ 没拿到范式——表达式可能无法解析，或该洞不存在。')
    if (parsed.errors.length > 0) L.push('', ...parsed.errors.map((e) => `- ${String(e).slice(0, 400)}`))
    return L.join('\n')
  }
  L.push(`- \`${meta.expr ?? ''}\`\n  → \`${String(parsed.normalForm.expr).slice(0, 600)}\`（${parsed.normalForm.computeMode}）`)
  L.push('', '> 范式是**判定相等**的常用依据：若两边范式相同，通常 `refl` 就能闭合。')
  L.push('', NOT_EVIDENCE)
  return L.join('\n')
}

/** 试探一个项（give 的渲染）。 */
export function renderGive(parsed, meta = {}) {
  const L = [`# proof_goals: ${meta.path ?? ''}（give｜洞 ${meta.goal ?? 0} ← \`${meta.expr ?? ''}\`）`, '']
  if (parsed.errors.length > 0) {
    L.push('❌ **不通过**', '')
    for (const e of parsed.errors) L.push(`${CODE}text\n${String(e).slice(0, 800)}\n${CODE}`)
    L.push('', '> 读错误里的**期望类型 vs 实际类型**再改项；改完再 `give` 一次（交互式试探比整模块编译快得多）。')
  } else if (parsed.give !== null) {
    L.push('✅ 类型检查通过（Agda 在内存里把这个洞关掉了）')
    const remaining = parsed.goals.length
    L.push(`- 剩余洞: ${remaining}${remaining === 0 ? '（整文件当前已闭合）' : `（还有：${parsed.goals.map((g) => `#${g.id} ${g.type.slice(0, 40)}`).join('、')}）`}`)
    L.push('', '> 通过**不代表**已经写进文件：把它写进对应的 `{!!}` 位置，再跑 `proof_compile` 拿回执。')
  } else {
    L.push('⚠ 没有拿到 give 响应（命令可能没被接受）。原始输出：')
    L.push(`${CODE}text\n${(parsed.raw ?? []).join('\n').slice(0, 500) || '（空）'}\n${CODE}`)
  }
  L.push('', NOT_EVIDENCE)
  return L.join('\n')
}

/** 分情况（case 的渲染）。 */
export function renderCase(parsed, meta = {}) {
  const L = [`# proof_goals: ${meta.path ?? ''}（case｜洞 ${meta.goal ?? 0} 对 \`${meta.on ?? ''}\`）`, '']
  if (parsed.makeCase === null) {
    L.push('❌ 没拿到分情况结果——变量名可能不在作用域，或该洞不存在。')
    if (parsed.errors.length > 0) L.push('', ...parsed.errors.map((e) => `- ${String(e).slice(0, 400)}`))
    if ((parsed.raw ?? []).length > 0) L.push('', `${CODE}text\n${parsed.raw.join('\n').slice(0, 400)}\n${CODE}`)
    return L.join('\n')
  }
  L.push(`- variant: \`${parsed.makeCase.variant}\`（Function = 顶层函数子句；ExtendedLambda = λ 表达式内的分情况）`)
  L.push('', `${CODE}agda`, ...parsed.makeCase.clauses.map((c) => String(c)), CODE)
  L.push('', '> 把子句替换进文件，再把每个 `?` 换成 `{!!}` 继续逐个问 `context`——**这正是消除 `with`/嵌套 `case` 手写错误的地方**。')
  L.push('', NOT_EVIDENCE)
  return L.join('\n')
}

/** 自动搜索（auto 的渲染）。 */
export function renderAuto(parsed, meta = {}) {
  const L = [`# proof_goals: ${meta.path ?? ''}（auto：Agda proof search）`, '']
  if (parsed.give !== null) {
    const r = parsed.give.result ?? {}
    const candidate = typeof r.str === 'string' && r.str !== '' ? r.str : typeof r.expr === 'string' && r.expr !== '' ? r.expr : null
    if (candidate !== null) {
      L.push(`- 洞 ${parsed.give.id}: 候选 \`${candidate}\``)
    } else {
      L.push(`- 洞 ${parsed.give.id}: 搜索**成功**，但响应里没有可读的项（giveResult 形状变了）——原始：\`${JSON.stringify(r).slice(0, 200)}\``)
    }
  } else if ((parsed.goals ?? []).length > 0) {
    L.push(`- 没有找到候选（${parsed.goals.length} 个洞仍在）。自动搜索对**构造性/组合型**目标有效，对需要归纳或新引理的目标通常空手——这是正常的，不是失败。`)
    L.push('', '| # | 目标类型 |', '| --- | --- |')
    for (const g of parsed.goals.slice(0, 20)) L.push(`| ${g.id} | ${g.type.slice(0, 100)} |`)
  } else {
    L.push('- 没有洞（文件当前已闭合）或装载失败。')
  }
  if (parsed.errors.length > 0) L.push('', ...parsed.errors.map((e) => `- ❌ ${String(e).slice(0, 300)}`))
  L.push('', '> 候选**不是证据**：写进文件后仍要 `proof_compile` 拿回执；搜索失败时回到 `case` / `context` 手工推进。')
  return L.join('\n')
}
