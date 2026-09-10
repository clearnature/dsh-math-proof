// 数学证明模式 — prover-limits 本地插件
//
// 注册 `prover_limits` 工具：**证明器/工具链限制的经验库**。
//
// 为什么需要它：长程证明任务（连续数天）里最贵的浪费不是「算不出来」，而是
// 反复撞同一堵墙——把编译器/工具链的固有限制当成自己的证明失败，然后改证明方向。
// 这类限制必须从「口口相传」变成**可查询、可累积、带证据的软件经验**：
//   · 内置种子（SEED）：已实测确认的限制，含症状 → 根因 → 规避 → 证据
//   · 运行期累积（add）：新撞到的限制写进 ~/.dsh/state/math-proof/prover-limits.json，
//     跨天、跨会话、跨进程保留（`evidence` 必填，禁止无证据的经验）
//   · 编译分诊联动：`proof_compile` 的指纹分诊会带上对应 `limit` id，直接指到这里
//   · 误判防护：每条都带 `notFlag`（什么情况下**不是**这条限制），防止把代码问题当限制
//
// 本行不 provide 任何 service，可裸露在 preset 里；文件只 import `node:` 内建模块。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'prover-limits'
export const inject = ['tools']

/** 运行期累积的限制条目落盘路径（按用户，不按 workspace）。 */
export function limitsPath() {
  return join(homedir(), '.dsh', 'state', 'math-proof', 'prover-limits.json')
}

/**
 * 内置种子：每条都必须有实测证据（evidence 字段），否则不许进库。
 * `match` 是用于编译诊断文本匹配的正则（字符串形式，避免跨实例的 lastIndex 状态）。
 */
export const SEED = [
  {
    id: 'agda-heap-cap',
    severity: 'blocker',
    notFlag: '模块本身有真实展开 bug、或逻辑递归不终止（改堆限制不会好，只会晚一点死）',
    cls: '性能',
    symptom: '编译 1–3 秒内报 `Heap exhausted`，同一模块去掉堆限制却能通过',
    match: 'Heap exhausted|stack overflow|out of memory',
    cause: '`+RTS -M<n>G` 的上限低于该模块的基线常驻内存；大 Fin 递归 / 4320D 归约展开本身占用高',
    remedy: '上限必须按机器标定：先无限制跑一次测 RSS 作为基线，再设高于基线的值（本机 `-M8G` 起通过，`-M6G` 误杀）；判定「展开 bug」要相对同模块基线 RSS，不要只看撞到上限',
    evidence: '2026-09-09 实测：`-M6G` 下 DuodecClock/DCGroup/DayanCore/Kakeya* 均 1.2–3s Heap exhausted；`-M8G` exit 0；无限制 RSS 6.4–6.7G',
  },
  {
    id: 'infective-import',
    severity: 'blocker',
    notFlag: '模块自己写了 `{-# OPTIONS --rewriting #-}` 却忘了在命令行/文件头统一（那是配置问题，不是传染性检查）',
    cls: '工具链',
    symptom: '`[InfectiveImport]` / `[SafeFlagPragma]`：import 了带 `--rewriting` 的模块',
    match: 'InfectiveImport|SafeFlagPragma',
    cause: 'Agda 为保证 subject reduction，强制「import 带 REWRITE 规则的模块 ⇒ 本模块也要开 --rewriting」；少数模块刻意不开（如 HolographicSpace.agda）',
    remedy: '命令行**不加** `--rewriting`，文件头保留 `{-# OPTIONS --rewriting --guardedness #-}`；刻意不开的模块触发的报错是 Agda 2.9.0 开发版固有限制，**不是代码缺陷**',
    evidence: '全库 335/342 模块已统一 `--rewriting`；HolographicSpace.agda:26 注释说明理由',
  },
  {
    id: 'parse-lhs-fixity',
    severity: 'blocker',
    notFlag: '真正的语法笔误（少括号、关键字拼错），补 fixity 并不能修好',
    cls: '语法',
    symptom: '`[NoParseForLHS]` / `[ParseError]`，模式里写了 `(x , a)` 或 `⊕`/`⊗`',
    match: 'NoParseForLHS|Could not parse the left-hand side|ParseError',
    cause: '模式中的 `_,_` 需要 fixity 声明才可解析；`⊕`/`⊗` 未 `infixl` 同理',
    remedy: '`open import Data.Product using (_,_)`；自定义算子补 `infixl 6 _⊕_`；避免 `postulate ... where` 反模式',
    evidence: 'DCInvolution.agda 实测：补 `using (_,_)` 后 exit 0',
  },
  {
    id: 'projection-stuck-let',
    severity: 'degrade',
    notFlag: '被调函数**没有** `let` 却仍不归约——那可能是缺少 REWRITE 规则或需要 `subst`',
    cls: '归约',
    symptom: '`.projᵢ` 停在复合项上 / `[UnsolvedConstraints]` 卡住',
    match: '\\.proj|UnsolvedConstraints',
    cause: '被调函数含 `let` 绑定，定义相等无法继续归约；大 Fin 递归展开爆炸',
    remedy: '改成 let-free 的直接模式匹配；大 Fin 递归改为引用已编译模块 + `fromℕ<`；必要时补 REWRITE 规则',
    evidence: 'agda-engine 指纹 F/R 类实测归纳（AUDIT §7.3）',
  },
  {
    id: 'ambiguous-stdlib-names',
    severity: 'degrade',
    notFlag: '同名但可消歧的局部变量（不该靠 renaming 掩盖命名混乱）',
    cls: '命名',
    symptom: '`[AmbiguousName]`：`zero`/`suc`/`_+_` 在多处可见',
    match: 'AmbiguousName',
    cause: 'stdlib 与项目模块同名符号同时进作用域',
    remedy: '`renaming`：`Data.Fin` 的 `zero/suc → fzero/fsuc`；`Data.Integer/Rational` 的 `_+_ → _+ℤ_/_+ℚ_`',
    evidence: 'agda-engine 指纹 C 类',
  },
  {
    id: 'no-generic-hom-record',
    severity: 'degrade',
    notFlag: '同伦等价 `_≃_` 已足够表达的场景（不要为了「像群论」硬造 record）',
    cls: '库边界',
    symptom: '想找通用 `GroupHom` / `GroupIso` record 却找不到',
    match: 'GroupHom|GroupIso',
    cause: '本库**没有**通用群同态/同构 record；唯一同构类是泛型同伦等价 `_≃_`（PlatonicTorusProjection.agda:69）',
    remedy: '明确二选一：写成 Π-类型命题（保持运算的等式），或**新增** record；不要假设库里已有',
    evidence: 'persona §二投影层工具表；`UniversalAlgebra.agda` 只有结构词汇表',
  },
  {
    id: 'no-complex-no-float',
    severity: 'blocker',
    notFlag: '整数/有理数的**精确**表示（`ℤ`、`ℚ`、定点整数比）——禁的是浮点与 `Data.Complex`，不是全部数值',
    cls: '宪法',
    symptom: '证明里出现 `Data.Complex`、`Float`、`Double` 或无理数近似',
    match: 'Data\\.Complex|Float|Double',
    cause: '宪法禁令：禁浮点、禁连续统复数；范数坍缩与相位不可约性要求精确结构',
    remedy: '用 GF(9) / ℤ[i] / ℤ[ω] / ℚ(√3) / ℚ(√2) 的定点整数比；`proof_audit` 会直接报违规',
    evidence: '`memory/dual_track_constitution.md`；persona §四',
  },
  {
    id: 'sandbox-stdlib-write',
    severity: 'degrade',
    notFlag: '闸门因**类型错误**非零退出（要看退出码与 stderr：42 才是权限）',
    cls: '环境',
    symptom: '链闸门 `engineering/check_*_chain.sh` 退出码 42',
    match: 'exit=42|exit code 42|Permission denied.*_build',
    matchTarget: 'output',
    cause: '闸门要写 agda-stdlib 的 `_build/*.agdai`；在 `workspace-write` 沙箱下该目录只读（**权限问题，不是类型错误**）',
    remedy: '改用 `proof_compile` 逐模块验证（只写工作区内 `.agdai`），或请用户放开写权限；不要把 42 当证明失败',
    evidence: '2026-09-09 实测；已写入 persona §三 与 group-first-proof §6',
  },
  {
    id: 'cubical-vs-propositional',
    severity: 'degrade',
    notFlag: '确实需要 `∥_∥₂` / 集合商 / `isSet` 的命题（那就该用 Cubical，不是绕开）',
    cls: '理论',
    symptom: '在 `_≡_` 与 Cubical `Path` 之间反复转换，或给普通模块加 `--cubical`',
    match: '--cubical|PathP|∥_∥₂',
    cause: '本库绝大多数模块用命题相等 `_≡_`；`--cubical` 只为 `∥_∥₂` / `_/_` / `_≃_` / 集合商而开（精确计数用 `tests/refs-check.mjs` 实测）',
    remedy: '默认 `_≡_`（refl/sym/trans/cong/cong₂/≡-Reasoning/subst）；确需 Cubical 才开 flag，且明确转换点',
    evidence: 'persona §一；A4Group.agda 定律是独立函数而非 record 字段',
  },
  {
    id: 'postulate-compiles-but-unproven',
    severity: 'blocker',
    notFlag: '`postulate` 出现在**实验/占位**模块且已显式标注缺口——仍然要报，但不能当成已证定理',
    cls: '语义',
    symptom: '模块 exit 0，但里面含 `postulate`',
    match: 'postulate',
    cause: 'Agda 允许 postulate，内核不会拒绝；编译通过 ≠ 命题已证',
    remedy: '交付必须用 `proof_audit` 报 postulate 数并**声明缺口**（如 ProjectiveCore 群公理、T6 `φ-respects`）；不把 postulate 当已证定理',
    evidence: 'AUDIT §7.3 事实审计；`Geometry/ProjectiveCore.agda:130-137`、`Structology/T6.agda:976-977`',
  },
]

/** 读运行期累积条目（损坏则备份后返回空，并保留种子）。 */
export function readExtra() {
  const path = limitsPath()
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed.entries : []
  } catch {
    const bak = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(path, bak)
    } catch {
      /* 备份失败也不掩盖 */
    }
    return []
  }
}

/** 写运行期累积条目（原子）。 */
export function writeExtra(entries) {
  const path = limitsPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 合并种子与累积条目（同 id 时累积条目覆盖，便于修正）。 */
export function allLimits() {
  const extra = readExtra()
  const byId = new Map(SEED.map((e) => [e.id, { ...e, origin: 'seed' }]))
  for (const e of extra) byId.set(String(e.id), { ...e, origin: 'accumulated' })
  return [...byId.values()]
}

/**
 * 按诊断文本匹配限制条目。
 * 先按 `match` 正则；不中时退化为「症状/根因/规避」里的关键词命中（宽召回，结果全量展示）。
 */
export function matchLimits(query) {
  const text = String(query ?? '')
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
  return allLimits().filter((e) => {
    if (typeof e.match === 'string' && e.match !== '') {
      try {
        if (new RegExp(e.match, 'i').test(text)) return true
      } catch {
        if (text.includes(e.match)) return true
      }
    }
    const haystack = `${e.symptom} ${e.cause ?? ''} ${e.remedy ?? ''}`.toLowerCase()
    return words.some((w) => haystack.includes(w))
  })
}

/** 渲染一条限制。 */
function renderOne(e, verbose = true) {
  const lines = [
    `### \`${e.id}\`（${e.cls ?? '—'}${e.severity ? ` / ${e.severity}` : ''}${e.origin ? ` / ${e.origin}` : ''}）`,
    `- 症状: ${e.symptom}`,
  ]
  if (verbose) {
    lines.push(
      `- 根因: ${e.cause ?? '—'}`,
      `- 规避: ${e.remedy ?? '—'}`,
      `- 证据: ${e.evidence ?? '—'}`,
      `- 误判防护: ${e.notFlag ?? '（未登记——请补：什么情况下不是这条限制）'}`,
    )
  }
  return lines.join('\n')
}

/** 执行一次经验库操作。 */
export function runLimits(args) {
  const input = args === null || typeof args !== 'object' ? {} : args
  const action = typeof input.action === 'string' && input.action !== '' ? input.action : 'list'
  const ACTIONS = ['list', 'query', 'show', 'add', 'stats']
  if (!ACTIONS.includes(action)) {
    throw new Error(`prover_limits: unknown action "${action}" (expected ${ACTIONS.join(' | ')})`)
  }
  const all = allLimits()

  if (action === 'list') {
    return [
      '# prover_limits: list（证明器限制经验库）',
      '',
      `- 条目: ${all.length}（种子 ${SEED.length} / 累积 ${all.length - SEED.length}）`,
      `- 落盘: \`${limitsPath()}\``,
      '',
      ...all.map((e) => `- \`${e.id}\`（${e.cls}${e.severity ? `/${e.severity}` : ''}）${String(e.symptom).slice(0, 80)}`),
      '',
      '> 用途：撞到限制时先 `query`，别把工具链的固有限制当成自己的证明失败。',
    ].join('\n')
  }

  if (action === 'query') {
    const q = String(input.query ?? '').trim()
    if (q === '') throw new Error('prover_limits query: `query` required（编译诊断文本或关键词）')
    const hits = matchLimits(q)
    if (hits.length === 0) {
      return [
        '# prover_limits: query（无匹配）',
        '',
        `- 查询: ${q.slice(0, 200)}`,
        '',
        '库里没有这条限制。两种可能：',
        '1. 这**是**代码/证明问题 → 按 `proof-engineer` 错误指纹继续诊断；',
        '2. 这**是**新的工具链限制 → 用 `action:"add"` 连同**实测证据**写进库（证据必填）。',
      ].join('\n')
    }
    return [
      `# prover_limits: query（${hits.length} 条匹配）`,
      '',
      `- 查询: ${q.slice(0, 200)}`,
      '',
      hits.map((e) => renderOne(e)).join('\n\n'),
    ].join('\n')
  }

  if (action === 'show') {
    const id = String(input.id ?? '').trim()
    if (id === '') throw new Error('prover_limits show: `id` required')
    const e = all.find((x) => x.id === id)
    if (e === undefined) throw new Error(`prover_limits show: unknown id "${id}"`)
    return `# prover_limits: show \`${id}\`\n\n${renderOne(e)}`
  }

  if (action === 'stats') {
    const byCls = new Map()
    for (const e of all) byCls.set(e.cls ?? '—', (byCls.get(e.cls ?? '—') ?? 0) + 1)
    return [
      '# prover_limits: stats',
      '',
      `- 条目: ${all.length}（种子 ${SEED.length} / 累积 ${all.length - SEED.length}）`,
      ...[...byCls.entries()].sort().map(([c, n]) => `- ${c}: ${n}`),
      '',
      '> 累积条目越多，说明「把限制转成软件经验」越有效；但每条都必须有实测证据。',
    ].join('\n')
  }

  // add
  const entry = input.entry
  if (entry === null || typeof entry !== 'object') throw new Error('prover_limits add: `entry` object required')
  const id = String(entry.id ?? '').trim()
  if (!/^[a-z0-9][a-z0-9-]{2,40}$/.test(id)) {
    throw new Error('prover_limits add: `entry.id` must be kebab-case (3–41 chars, [a-z0-9-])')
  }
  for (const key of ['symptom', 'remedy', 'evidence']) {
    if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
      throw new Error(`prover_limits add: \`entry.${key}\` required（经验必须带证据，禁止口口相传）`)
    }
  }
  const extra = readExtra().filter((e) => e.id !== id)
  extra.push({
    id,
    cls: String(entry.cls ?? '未归类'),
    symptom: entry.symptom.trim(),
    match: typeof entry.match === 'string' ? entry.match : '',
    cause: String(entry.cause ?? '—'),
    remedy: entry.remedy.trim(),
    evidence: entry.evidence.trim(),
    severity: entry.severity === undefined ? undefined : String(entry.severity),
    notFlag: entry.notFlag === undefined ? undefined : String(entry.notFlag),
    toolchain: entry.toolchain === undefined ? undefined : String(entry.toolchain),
    addedAt: new Date().toISOString(),
  })
  const path = writeExtra(extra)
  return [
    `# prover_limits: add \`${id}\` ✅`,
    '',
    `- 症状: ${entry.symptom.trim().slice(0, 160)}`,
    `- 规避: ${entry.remedy.trim().slice(0, 160)}`,
    `- 证据: ${entry.evidence.trim().slice(0, 160)}`,
    `- 落盘: \`${path}\`（累积 ${extra.length} 条）`,
  ].join('\n')
}

/** 注册 `prover_limits` 工具。 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'prover_limits',
    description:
      '证明器/工具链限制的**经验库**（经验库视图一：按报错文本查；视图二是 `proof_oracle action:"kit-list"` 的可复用算法索引）：`list` 看索引、`query` 按编译诊断文本查（症状→根因→规避→证据）、`show` 看单条、`add` 把新撞到的限制连同**实测证据**写进库（跨天/跨会话保留于 ~/.dsh/state/math-proof/prover-limits.json）、`stats` 统计。撞到限制先 query，别把工具链固有限制当成证明失败。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'query', 'show', 'add', 'stats'],
          description: 'list 索引 / query 按诊断文本查 / show 单条 / add 新增（证据必填）/ stats 统计。',
        },
        query: { type: 'string', description: 'query 用：编译诊断文本或关键词。' },
        id: { type: 'string', description: 'show 用：条目 id。' },
        entry: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'symptom', 'remedy', 'evidence'],
          properties: {
            id: { type: 'string', description: 'kebab-case id，如 agda-heap-cap。' },
            cls: { type: 'string', description: '类别：性能/语法/归约/命名/库边界/宪法/环境/理论/语义/工具链。' },
            symptom: { type: 'string', description: '可观察症状（报错原文或现象）。' },
            match: { type: 'string', description: '匹配用正则（可选，供 proof_compile 分诊联动）。' },
            cause: { type: 'string', description: '根因。' },
            remedy: { type: 'string', description: '规避/替代策略（可执行）。' },
            evidence: { type: 'string', description: '实测证据（日期 + 命令 + 结果），必填。' },
            severity: { type: 'string', enum: ['blocker', 'degrade', 'noise'], description: '影响级别：blocker 编译/证明被挡死 / degrade 拖慢或误导 / noise 只产生噪音。' },
            notFlag: { type: 'string', description: '误判防护：什么情况下**不是**这条限制（防止把代码问题当限制）。' },
            toolchain: { type: 'string', description: '工具链版本（可选）。' },
          },
          description: 'add 的条目对象。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['report'],
        properties: { report: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.report }]
      },
    },
    async execute(args) {
      return { report: runLimits(args) }
    },
  })
}
