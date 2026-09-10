// 数学证明模式 — budget 本地插件
//
// 注册 `budget` 工具：**每次任务的预算与流量账本**（回答「预算能不能自己加」「用什么评价消耗」）。
//
// 设计要点（口径都在这里明写，别让模型猜）：
//   · 计量单位是**工具调用次数**（不是 token）：钩子能精确数、模型也能自己数；
//     token 只在结算时出账（`tok = Σ(input+cacheRead+output)`）。
//   · 实测（本机 26 会话 / 174 个有 usage 的回合）：单回合中位 6.61M token、16 步、
//     每步上下文中位 49.2 万——**99.6% 的流量是上下文被重复读**，模型写出的字只占 0.9%。
//     所以「让模型少写字」省不了流量，主控量是**步数/调用次数 × 上下文**。
//   · 自适应 ±10% 只在两种结局上动手：**已验证完成 → 减 10%**、**撞到预算墙 → 加 10%**；
//     失败/中断**不动**（否则一个坏构建就能把预算养肥）。夹紧在 [0.5×, 2×] 中位数。
//   · **追加预算走申请制 + 记债**：`topup` 每任务限 1 次、理由 ≥20 字、批准 +50%，
//     下个已验证完成的任务扣回 10%。想多花，先还——这样「自己给自己压力」才有牙。
//
// 本行不 provide 任何 service，可裸露在 preset 里；只 import `node:` 内建与 preset 内模块。

import { BUDGET, EFFORT, SESSION } from '../impl/ruleset.mjs'
import { appendQuotaSample, fetchBalance, loadQuota, renderQuotaReport, saveQuota } from '../impl/quota.mjs'
import {
  budgetMode,
  sessionBreakdown,
  effectiveCalls,
  fmtTok,
  parseTokenAmount,
  planEffort,
  readTurn,
  sessionBudgetTokens,
  sessionRatio,
  sessionTotals,
  sessionUsed,
  wallLimitMs,
  writeTurn,
} from '../impl/budget-policy.mjs'
import {
  fmtInt,
  fmtTokenLine,
  renderUsageBlock,
  turnUsageRow,
  budgetFor,
  classBaseline,
  classDef,
  classifyTask,
  loadProfile,
  saveProfile,
  foldLastTurn,
  foldSession,
  scanSessionTurns,
  sessionLogFiles,
  ZSTD_SUPPORTED,
  summarize,
  percentile,
} from '../impl/session-traffic.mjs'

export const name = 'budget'
export const inject = ['tools']

export const ACTIONS = ['status', 'usage', 'report', 'classes', 'topup', 'calibrate', 'history', 'session', 'quota', 'explain', 'on', 'off']

/** 一行表格。 */
function table(headers, rows) {
  return [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')
}

/** 当前会话本回合的实况（只折**最后一个回合**：正在跑的这一轮）。 */
function liveStatus(state) {
  if (state === null || typeof state.transcript !== 'string' || state.transcript === '') return null
  const folded = foldLastTurn(state.transcript, { maxBytes: 8_000_000 })
  return folded.turns[folded.turns.length - 1] ?? null
}

/** `status`：本回合实况 + 账本开关 + 待结算。 */
function renderStatus(args) {
  const cwd = String(args?.cwd ?? process.cwd())
  const profile = loadProfile()
  const { mode, why } = budgetMode(profile)
  const state = args?.sessionId === undefined ? null : readTurn(String(args.sessionId))
  const lines = ['# budget: status（本任务预算实况）', '']
  lines.push(`- 模式: **${mode}**（${why}）｜账本: \`${profile.samples?.length ?? 0}\` 条样本，债务 ${profile.debt ?? 0} 笔`)
  lines.push(
    ZSTD_SUPPORTED
      ? `- 日志读取: ✅（Node ${process.version} 的 \`node:zlib\` 有 zstd，可读 \`session.jsonl.zstd\`）`
      : `- 日志读取: ⚠ **不可用**——本机 Node ${process.version} 的 \`node:zlib\` 没有 zstd（需 ≥22.15/23.8）：\`tok\`/步数读不到，预算只能靠钩子侧的调用次数计数（刹车照常工作，明细数字会缺）`,
  )
  if (state === null) {
    lines.push('- 本会话：**没有回合状态**（本任务不是走 UserPromptSubmit 开的局，或钩子未挂载/已关闭）')
  } else {
    const eff = effectiveCalls(state)
    const elapsed = Date.now() - Number(state.startedAt ?? Date.now())
    const wall = wallLimitMs(state.class)
    lines.push(
      `- 本回合: 类 \`${state.class}\`（${state.classSource === 'auto' ? '自动判定' : '显式指定'}）｜第 ${state.turn} 个任务`,
      `- 调用: **${state.used ?? 0}/${eff}** 次（追加 ${state.granted ?? 0}）｜${state.used / eff >= BUDGET.warnAt ? '⚠ 已过提醒线' : '未到提醒线'}｜被拦 ${state.denied ?? 0} 次`,
      `- 墙钟: ${(elapsed / 60000).toFixed(1)}/${(wall / 60000).toFixed(1)} min`,
      `- 起于: ${new Date(Number(state.startedAt ?? 0)).toISOString()}｜transcript: \`${String(state.transcript ?? '').slice(-48) || '（无）'}\``,
    )
    const live = liveStatus(state)
    if (live !== null) {
      lines.push(
        `- 日志实测（本回合，读到哪算哪）: 步数 **${live.steps}**｜tok **${fmtTok(live.tok)}**｜上下文峰值 ${fmtTok(live.ctxPeak)}｜模型输出 ${fmtTok(live.outTok)}｜结束原因 ${live.reason ?? '（进行中）'}｜最高重复调用 ${live.repeatMax} 次`,
      )
    }
    const budget = sessionBudgetTokens(profile)
    lines.push(
      `- **会话预算**（token，跨 provider 通用）: 已用 **${fmtTok(sessionUsed(state))} / ${fmtTok(state.sessionBudget)}**（${(sessionRatio(state, profile) * 100).toFixed(1)}%，来源 ${budget.source}）｜` +
        `${sessionRatio(state, profile) >= SESSION.hardAt ? '🛑 **已到硬线：只留收尾白名单**' : sessionRatio(state, profile) >= SESSION.warnAt ? '⚠ 已过提醒线' : '未到提醒线'}`,
      `  ${fmtTokenLine(sessionBreakdown(state))}`,
      `  （口径：已闭合回合累计 ${fmtTok(state.sessionTok)} + 最近读到的当前回合 ${fmtTok(state.liveTok)}；当前回合每 N 次调用刷新一次 → 判定可能滞后）`,
    )
    const logged = live?.effortLast ?? live?.effortAtStart ?? null
    lines.push(
      `- 思考强度: 日志记录 **${logged ?? '未记录（本机未开思考 / 尚未落 request/header）'}**${state.effortOwned === true ? `｜**调速器已介入**：档位设为 \`${state.effortSet}\`（原为 \`${state.effortBefore ?? '未知'}\`，任务结束还原）` : '｜调速器未介入'}`,
    )
    const observed = logged ?? state.effortSet ?? state.effortBefore ?? null
    if (observed !== null) {
      const next = planEffort({ state, seedEffort: observed })
      lines.push(`- 下一步档位: ${next.effort === null ? '保持' : `**${next.effort}**`}（按 \`${observed}\` 起算：${next.why}）`)
    } else {
      lines.push('- 下一步档位: 未知（看不到当前档位就不动——**看不懂就不猜**）')
    }
    if (state.error !== undefined) lines.push(`- ⚠ 钩子内部错误（已放行）: \`${state.error}\``)
    if (state.lastLiveWhy !== undefined && state.lastLiveWhy !== null) lines.push(`- 过程中不读日志的原因: ${state.lastLiveWhy}`)
  }
  const pending = profile.pending ?? []
  if (pending.length > 0) lines.push(`- 待结算回合: ${pending.length} 个（下轮开局自动补账）`)
  const base = state === null ? null : classBaseline(profile, state.class, { cwd })
  if (base !== null) {
    lines.push(
      `- 本类基线（${base.scope === 'workspace' ? '本 workspace' : '全机'}）: ${
        base.calibrated
          ? `中位 ${base.calls.median} 次 / ${fmtTok(base.tok.median)}（n=${base.n}，p90 ${base.calls.p90} 次）`
          : `样本 ${base.n}/${BUDGET.minSamples} 条（先用先验 ${classDef(state.class).calls} 次）`
      }`,
    )
  }
  return lines.join('\n')
}

/**
 * `usage`：**与界面逐字段同格式**的用量明细（本轮 + 最近若干轮 + 会话累计）。
 *
 * 为什么要有它：界面（`TurnUsagePanel`）显示的就是
 * 「本轮用量 / 提供方·模型 / 缓存命中 / 未缓存输入 / 缓存读取 / 输出（其中推理）」，
 * 而这些字段与日志里 `assistant/message.usage` 一一对应。用**同一套标签与分组数字**渲染，
 * 人可以把界面上的数字与本工具的输出**逐字符对上**——省掉「到底谁在算哪个量」的争论。
 */
function renderUsage(args) {
  const sessionId = String(args?.sessionId ?? '')
  const state = sessionId === '' ? null : readTurn(sessionId)
  const transcript = state?.transcript ?? args?.transcript
  const limit = Math.max(1, Math.min(20, Number(args?.limit ?? 5)))
  const lines = ['# budget: usage（与界面同格式：本轮 / 最近若干轮 / 会话累计）', '']
  if (typeof transcript !== 'string' || transcript === '') {
    lines.push('- 拿不到会话日志路径（没有回合状态，也没有 transcript）：本命令需要会话上下文。')
    return lines.join('\n')
  }
  let folded
  try {
    folded = foldSession(transcript)
  } catch (e) {
    lines.push(`- 读日志失败：${e instanceof Error ? e.message : String(e)}`)
    return lines.join('\n')
  }
  const turns = folded.turns.filter((t) => (t.tok ?? 0) > 0)
  if (turns.length === 0) {
    lines.push('- 日志里还没有带用量的回合。')
    return lines.join('\n')
  }
  const live = turns[turns.length - 1]
  lines.push('## 本轮（进行中的最后一轮）', '', '```', renderUsageBlock(live, { title: '本轮用量', withSteps: true }), '```', '')
  const recent = turns.slice(-limit - 1, -1).reverse()
  if (recent.length > 0) {
    lines.push(`## 最近 ${recent.length} 个已完成回合`, '')
    lines.push(
      table(
        ['轮次', '用量 tok', '缓存命中', '未缓存输入', '缓存读取', '输出（推理）', '提供方 / 模型'],
        recent.map((t) => {
          const u = turnUsageRow(t)
          return [
            String(t.turn),
            `**${fmtInt(u.total)}**`,
            u.input > 0 ? `${(u.cacheHitRate * 100).toFixed(1)}%` : '—',
            fmtInt(u.uncachedInput),
            fmtInt(u.cacheRead),
            u.reasoning > 0 ? `${fmtInt(u.output)}（${fmtInt(u.reasoning)}）` : fmtInt(u.output),
            u.provider === null ? '未记录' : `${u.provider}/${u.model ?? '—'}`,
          ]
        }),
      ),
      '',
    )
  }
  // 会话累计：用同一标签渲染（把 breakdown 当成一条「回合」）
  if (state !== null) {
    const bd = sessionBreakdown(state)
    lines.push('## 本会话累计', '', '```', renderUsageBlock({ ...bd, provider: live.provider, model: live.model }, { title: '会话累计' }), '```', '')
    const prof = loadProfile()
    lines.push(`- 会话预算：**${fmtTok(sessionUsed(state))} / ${fmtTok(state.sessionBudget)}**（${(sessionRatio(state, prof) * 100).toFixed(1)}%）`)
    lines.push('')
  }
  lines.push(`> 口径恒等式：\`本轮用量 = 未缓存输入 + 缓存读取 + 输出\`（与界面同一把尺子）；字段来自 \`assistant/message.usage\`。`)
  return lines.join('\n')
}

/** `report`：账本聚合（便宜）；`scan:true` 时顺带重扫日志（贵，几秒到几十秒）。 */
function renderReport(args, cwd) {
  const profile = loadProfile()
  const lines = ['# budget: report（预算与流量账本）', '']
  const classes = BUDGET.classes
  const rows = []
  for (const cls of classes) {
    const base = classBaseline(profile, cls.id, { cwd })
    const { calls } = budgetFor(profile, cls.id)
    rows.push([
      `\`${cls.id}\``,
      cls.label,
      base.calibrated ? `${base.n}` : `${base.n}（不足）`,
      base.calibrated ? String(base.calls.median) : `先验 ${cls.calls}`,
      base.calibrated ? String(base.calls.p90 ?? '—') : '—',
      base.calibrated ? fmtTok(base.tok.median) : '—',
      `**${calls}**`,
      base.scope === 'workspace' ? '本 workspace' : '全机',
    ])
  }
  lines.push(table(['类', '含义', '样本', '中位调用', 'p90', '中位 tok', '当前预算', '基线口径'], rows))
  lines.push('', `- 全部样本 ${profile.samples?.length ?? 0} 条｜可计数 ${(profile.samples ?? []).filter((s) => s.countable !== false).length} 条｜债务 ${profile.debt ?? 0} 笔`)
  if (profile.calibration !== null && profile.calibration !== undefined) {
    lines.push(`- 上次标定: ${profile.calibration.at}（扫了 ${profile.calibration.files} 个日志 / ${profile.calibration.turns} 个回合）`)
  } else {
    lines.push('- 尚未标定：当前各类预算数字是**先验**，跑 `budget action:"calibrate"` 用本机真实日志标定')
  }
  const budget = sessionBudgetTokens(profile)
  lines.push('', '## 会话预算（跨回合的总闸）', '')
  lines.push(
    table(
      ['项', '值'],
      [
        ['当前预算', `**${fmtTok(budget.tokens)}**`],
        ['来源', budget.source],
        ['提醒线 / 硬线', `${Math.round(SESSION.warnAt * 100)}% / ${Math.round(SESSION.hardAt * 100)}%`],
        ['覆盖方式', `\`${SESSION.env}=500M\` 或 \`budget action:"session" tokens:"1B"\``],
        ['实测参照', '单会话累计 tok：中位 1.25M｜p90 89M｜max 832M（26 个会话，2026-09-10）'],
      ],
    ),
  )
  // ── 本会话 / 按 provider 的 token 账（跨 provider 通用）──────────────────
  const files = sessionLogFiles()
  const perProvider = new Map()
  const perModel = new Map()
  let machine = { tok: 0, inTok: 0, cacheTok: 0, outTok: 0, reasoningTok: 0 }
  let scanned = 0
  for (const f of files) {
    try {
      const s2 = sessionTotals(f)
      scanned++
      for (const k of ['tok', 'inTok', 'cacheTok', 'outTok', 'reasoningTok']) machine[k] += s2[k] ?? 0
      for (const [k, v] of Object.entries(s2.byProvider)) {
        const cur = perProvider.get(k) ?? { tok: 0, inTok: 0, cacheTok: 0, outTok: 0, turns: 0 }
        perProvider.set(k, { tok: cur.tok + v.tok, inTok: cur.inTok + v.inTok, cacheTok: cur.cacheTok + v.cacheTok, outTok: cur.outTok + v.outTok, turns: cur.turns + v.turns })
      }
      for (const [k, v] of Object.entries(s2.byModel)) {
        const cur = perModel.get(k) ?? { tok: 0, inTok: 0, cacheTok: 0, outTok: 0, turns: 0 }
        perModel.set(k, { tok: cur.tok + v.tok, inTok: cur.inTok + v.inTok, cacheTok: cur.cacheTok + v.cacheTok, outTok: cur.outTok + v.outTok, turns: cur.turns + v.turns })
      }
    } catch {
      /* 坏日志跳过 */
    }
  }
  lines.push('', '## Token 账（跨 provider 通用；数据来自各适配器的 `assistant/message.usage`）', '')
  lines.push(`- 全机 ${scanned} 个会话：${fmtTokenLine(machine)}`)
  if (perProvider.size > 0) {
    lines.push(
      '',
      table(
        ['provider', '回合', '输入', '（缓存命中）', '输出', '总 tok'],
        [...perProvider.entries()]
          .sort((a, b) => b[1].tok - a[1].tok)
          .map(([k, v]) => [`\`${k}\``, String(v.turns), fmtTok(v.inTok + v.cacheTok), fmtTok(v.cacheTok), fmtTok(v.outTok), `**${fmtTok(v.tok)}**`]),
      ),
    )
  }
  if (perModel.size > 0) {
    lines.push(
      '',
      table(
        ['model', '回合', '输入', '输出', '总 tok'],
        [...perModel.entries()]
          .sort((a, b) => b[1].tok - a[1].tok)
          .slice(0, 8)
          .map(([k, v]) => [`\`${k}\``, String(v.turns), fmtTok(v.inTok + v.cacheTok), fmtTok(v.outTok), `**${fmtTok(v.tok)}**`]),
      ),
    )
  }
  const sessionState = args?.sessionId === undefined || String(args.sessionId) === '' ? null : readTurn(String(args.sessionId))
  if (sessionState !== null) {
    lines.push('', `- **本会话**：${fmtTokenLine(sessionBreakdown(sessionState))}（上限 ${fmtTok(sessionState.sessionBudget)}，已用 ${(sessionRatio(sessionState, profile) * 100).toFixed(1)}%）`)
  }

  const recent = (profile.samples ?? []).slice(-8).reverse()
  if (recent.length > 0) {
    lines.push('', '## 最近 8 个结算')
    lines.push(
      table(
        ['时间', '类', 'provider', '调用', '步数', '输入', '输出', '结局'],
        recent.map((s) => [
          String(s.at).slice(5, 16),
          `\`${s.class}\``,
          String(s.provider ?? '—'),
          String(s.calls),
          String(s.steps ?? '—'),
          fmtTok((s.inTok ?? 0) + (s.cacheTok ?? 0)),
          fmtTok(s.outTok),
          s.outcome,
        ]),
      ),
    )
  }
  if (args?.scan === true) {
    lines.push('', '## 重扫日志（本次现算）', '', ...scanSection(cwd))
  }
  return lines.join('\n')
}

/** 现算一段：扫全部会话，给出总体与分类统计（贵）。 */
function scanSection(cwd) {
  const files = sessionLogFiles()
  const turns = scanSessionTurns(files)
  const usable = turns.filter((t) => t.tok > 0)
  const overall = summarize(usable.map((t) => t.tok))
  const steps = summarize(usable.map((t) => t.steps))
  const calls = summarize(usable.map((t) => t.toolCalls))
  const byClass = new Map()
  for (const t of usable) {
    const c = classifyTask(t.prompt ?? '')
    const bucket = byClass.get(c) ?? []
    bucket.push(t)
    byClass.set(c, bucket)
  }
  const lines = [
    `- 日志: ${files.length} 个｜有 usage 的回合 ${usable.length} 个｜所属 workspace: \`${cwd}\``,
    `- 单回合 tok: 中位 **${fmtTok(overall.median)}**｜p25 ${fmtTok(percentile(usable.map((t) => t.tok), 0.25))}｜p75 ${fmtTok(percentile(usable.map((t) => t.tok), 0.75))}｜p90 ${fmtTok(overall.p90)}｜max ${fmtTok(overall.max)}`,
    `- 单回合步数: 中位 ${steps.median}｜p90 ${steps.p90}｜max ${steps.max}｜工具调用中位 ${calls.median}（p90 ${calls.p90}）`,
    `- 拆分: input ${fmtTok(summarize(usable.map((t) => t.inTok)).median)} / cacheRead ${fmtTok(summarize(usable.map((t) => t.cacheTok)).median)} / output ${fmtTok(summarize(usable.map((t) => t.outTok)).median)}`,
    '',
    table(
      ['类', '回合', '中位调用', 'p90 调用', '中位 tok', '中位步数'],
      [...byClass.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([c, list]) => [
          `\`${c}\``,
          String(list.length),
          String(summarize(list.map((t) => t.toolCalls)).median),
          String(summarize(list.map((t) => t.toolCalls)).p90),
          fmtTok(summarize(list.map((t) => t.tok)).median),
          String(summarize(list.map((t) => t.steps)).median),
        ]),
    ),
  ]
  return lines
}

/** `classes`：分类表 + 判定用的正则（让模型知道自己是按什么被归类的）。 */
function renderClasses(cwd) {
  const profile = loadProfile()
  return [
    '# budget: classes（任务分类与当前预算）',
    '',
    table(
      ['类', '含义', '判定正则（优先级从上到下）', '先验', '当前预算', '要回执'],
      BUDGET.classes.map((c) => {
        const { calls } = budgetFor(profile, c.id)
        return [`\`${c.id}\``, c.label, c.match === '' ? '（兜底）' : `\`${c.match}\``, String(c.calls), `**${calls}**`, c.requireReceipt === true ? '是' : '否']
      }),
    ),
    '',
    `- 一条都没命中：短提示词 → \`${BUDGET.defaultClass}\`；长提示词（≥${BUDGET.longPromptChars} 字）→ \`${BUDGET.longDefaultClass}\``,
    `- 「要回执」= 该类任务的「完成」必须有机器证据才算数（`+"`"+"RECEIPT`；chat/docs/diagnose 本质上没有回执，故为否）",
    `- 当前 workspace: \`${cwd}\``,
  ].join('\n')
}

/** `topup`：申请追加预算（每任务限次、要有理由、记债）。 */
function runTopup(args) {
  const reason = String(args?.reason ?? '').trim()
  const sessionId = String(args?.sessionId ?? '')
  const cwd = String(args?.cwd ?? process.cwd())
  const profile = loadProfile()
  const { mode } = budgetMode(profile)
  const state = sessionId === '' ? null : readTurn(sessionId)
  if (state === null) throw new Error('budget topup: 本会话没有回合状态（钩子未开局）——先正常开工，再申请')
  if (mode === 'off') throw new Error('budget topup: 预算已关闭（`budget action:"explain"` 看开关）')
  if (reason.length < BUDGET.topup.minReasonChars) {
    throw new Error(`budget topup: 理由太短（${reason.length} 字 < ${BUDGET.topup.minReasonChars}）——必须写清「还缺哪一件关键证据、拿到它就能收工」`)
  }
  if (Number(state.topup ?? 0) >= BUDGET.topup.maxPerTask) {
    throw new Error(`budget topup: 本任务已申请过 ${state.topup} 次（上限 ${BUDGET.topup.maxPerTask}）——请按 `+'`proof_dag journal`'+` 收尾，把缺口写明`)
  }
  const before = effectiveCalls(state)
  const grant = Math.max(1, Math.round(Number(state.budget) * BUDGET.topup.grantRatio))
  state.granted = Number(state.granted ?? 0) + grant
  state.topup = Number(state.topup ?? 0) + 1
  state.topupReasons = [...(state.topupReasons ?? []), reason.slice(0, 200)]
  writeTurn(state)
  profile.debt = Number(profile.debt ?? 0) + 1
  saveProfile(profile)
  return [
    '# budget: topup ✅ 已批准',
    '',
    `- 预算: **${before} → ${effectiveCalls(state)}** 次工具调用（+${grant}，类 \`${state.class}\`）`,
    `- 已用: ${state.used ?? 0}｜本任务申请次数 ${state.topup}/${BUDGET.topup.maxPerTask}`,
    `- **记债 ${profile.debt} 笔**：下个「已验证完成」的任务按 −${Math.round(BUDGET.topup.debtRepayRatio * 100)}% 扣回。`,
    '- 这笔追加**不是免罚**：请在拿到那一件关键证据后立刻收尾（`proof_dag journal` 落盘），别把它当成新一轮探索的起点。',
    '- 理由已入账：',
    `  > ${reason}`,
  ].join('\n')
}

/** `calibrate`：扫本机全部会话日志 → 按类算中位调用 → 写回预算（带出处）。 */
function runCalibrate(args, cwd) {
  const files = sessionLogFiles()
  const turns = scanSessionTurns(files)
  const usable = turns.filter((t) => t.tok > 0 && t.open !== true && t.reason === 'completed')
  const byClass = new Map()
  for (const t of usable) {
    const c = classifyTask(t.prompt ?? '')
    const bucket = byClass.get(c) ?? []
    bucket.push(t)
    byClass.set(c, bucket)
  }
  const profile = loadProfile()
  const dry = args?.dryRun === true
  const rows = []
  const next = { ...(profile.budgets ?? {}) }
  for (const cls of BUDGET.classes) {
    const list = (byClass.get(cls.id) ?? []).filter((t) => (cls.requireReceipt === true ? t.receipts.length > 0 || t.denies > 0 : true))
    const stats = summarize(list.map((t) => t.toolCalls))
    const tok = summarize(list.map((t) => t.tok))
    const enough = stats.n >= BUDGET.minSamples
    const headroom = 1.25
    const calls = enough ? Math.max(1, Math.ceil((stats.median ?? cls.calls) * headroom)) : cls.calls
    rows.push([
      `\`${cls.id}\``,
      String(stats.n),
      enough ? String(stats.median) : `先验 ${cls.calls}`,
      enough ? String(stats.p90 ?? '—') : '—',
      enough ? fmtTok(tok.median) : '—',
      `**${calls}**`,
      enough ? '实测标定' : '样本不足 → 保留先验',
    ])
    if (!dry && enough) next[cls.id] = { calls, at: new Date().toISOString(), why: `calibrate：本机 ${stats.n} 个同类回合中位 ${stats.median} 次 × ${headroom} 余量` }
  }
  if (!dry) {
    profile.budgets = next
    profile.calibration = { at: new Date().toISOString(), files: files.length, turns: usable.length, perClass: Object.fromEntries([...byClass].map(([c, l]) => [c, l.length])) }
    saveProfile(profile)
  }
  return [
    `# budget: calibrate${dry ? '（dryRun，未写盘）' : ' ✅'}`,
    '',
    `- 扫描: ${files.length} 个会话日志 → 可用回合 ${usable.length} 个（已闭合 + completed + 有 usage）`,
    `- 规则: 中位调用数 × 1.25 余量；样本 < ${BUDGET.minSamples} 的类**保留先验**（不假装标定）`,
    '',
    table(['类', '样本', '中位调用', 'p90', '中位 tok', '写回预算', '说明'], rows),
    '',
    `- 口径: 只统计**已闭合且正常完成**的回合；预算写进 \`${process.env.MATH_PROOF_STATE_DIR ?? ''}~/.dsh/state/math-proof/budget-profile.json\``,
  ].join('\n')
}

/** `history`：最近 N 条样本（默认 12）。 */
function renderHistory(args) {
  const profile = loadProfile()
  const n = Math.max(1, Math.min(60, Number(args?.limit ?? 12)))
  const rows = (profile.samples ?? []).slice(-n).reverse()
  if (rows.length === 0) return '# budget: history\n\n（还没有样本：跑一个任务、`budget action:"calibrate"`，或等 Stop 钩子结算）'
  return [
    `# budget: history（最近 ${rows.length} 条结算样本）`,
    '',
    table(
      ['时间', '类', '调用', '钩子计', '步数', 'tok', '结束', '证据', '结局', '可计数'],
      rows.map((s) => [
        String(s.at).slice(5, 16),
        `\`${s.class}\``,
        String(s.calls),
        String(s.hookUsed ?? '—'),
        String(s.steps ?? '—'),
        fmtTok(s.tok),
        String(s.reason ?? '—'),
        s.receipts?.files > 0 ? `文件 ${s.receipts.files}` : s.receipts?.text === true ? '文本' : '—',
        s.outcome,
        s.countable === false ? `否（${String(s.why ?? '').slice(0, 18)}）` : '是',
      ]),
    ),
  ].join('\n')
}

/** `session`：看/设会话 token 预算。 */
function runSession(args, profile) {
  const raw = args?.tokens
  const current = sessionBudgetTokens(profile)
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return [
      '# budget: session（会话 token 预算）',
      '',
      `- 当前预算: **${fmtTok(current.tokens)}**（来源 ${current.source}）`,
      `- 提醒线/硬线: ${Math.round(SESSION.warnAt * 100)}% / ${Math.round(SESSION.hardAt * 100)}%`,
      '',
      '设新值：`budget action:"session" tokens:"1B"`（支持 `500M` / `1B` / 纯数字）；`tokens:"0"` 或 `reset` 恢复默认。',
      '',
      '> ⚠ 实测提醒：本机单会话累计 tok 中位 1.25M、p90 89M、**max 832M**；而**单个中位回合**就是 6.61M。',
      '> 所以「100 万 token 一次会话」在这个负载下会在**第一次模型调用**就撞线——想当成本闸，默认 5e8 起。',
    ].join('\n')
  }
  if (String(raw).trim() === 'reset') {
    const next = { ...profile, sessionBudget: { tokens: SESSION.defaultTokens, at: new Date().toISOString(), why: 'reset → 默认' } }
    saveProfile(next)
    return `# budget: session ✅ 已恢复默认（${fmtTok(SESSION.defaultTokens)}）`
  }
  const tokens = parseTokenAmount(raw)
  if (tokens === null) throw new Error(`budget session: 无法解析 tokens "${raw}"（支持 500M / 1B / 纯数字）`)
  saveProfile({ ...profile, sessionBudget: { tokens, at: new Date().toISOString(), why: 'budget action:"session"' } })
  const wasTiny = tokens <= 10_000_000
  return [
    `# budget: session ✅ 已设为 ${fmtTok(tokens)}`,
    '',
    `- 生效: 下一个回合开局时生效（钩子每回合开局重读）`,
    wasTiny ? `- ⚠ ${fmtTok(tokens)} 低于本机**单个中位回合**（6.61M）的量级——它会在很早期就拦下工具调用，只适合当「硬性成本闸」或测试。` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * `quota`：DeepSeek **余额**（钱）采样与趋势。
 *
 * 设计取向：**默认不联网**（只读本机采样缓存）——回合中途做网络 I/O 会让工具调用变慢且不可预期；
 * 要拉新数据必须显式 `refresh:true`。
 * 凭据走 harness 自己的解析（`ctx.credentials.resolve`），本工具**不碰**密钥文件；
 * 只有在 harness 里拿不到时才回退到 `DEEPSEEK_API_KEY` 环境变量。
 */
function runQuota(args, ctx) {
  if (args?.refresh === true) {
    // 联网拉取是**异步**的：同步入口不接这条路（避免同步/异步混合返回）
    throw new Error('budget quota: refresh:true 需要异步入口（工具内部会 await；测试用 runBudgetAsync）')
  }
  return renderQuotaCache(args)
}

/** 只读本机采样缓存渲染（不联网、可同步调用）。 */
function renderQuotaCache(args) {
  const parts = []
  const state = loadQuota()
  if (typeof args?.baseline === 'number' && args.baseline > 0) {
    saveQuota({ ...state, baseline: args.baseline, baselineSource: `budget action:"quota" baseline=${args.baseline}` })
    parts.push(`基线已设为 ${args.baseline}（百分比将按它算；官方接口没有「总量」字段）`)
  }
  const fresh = loadQuota()
  const head = renderQuotaReport(fresh, { available: fresh.samples.at(-1)?.available })
  if (parts.length === 0) return head
  return [head, '', '## 本次动作', ...parts.map((x) => `- ${x}`)].join('\n')
}

/**
 * `quota` 的**异步**路径：允许 `refresh:true` 去拉官方余额。
 * `deps.fetchImpl` 是**测试注入**用的（生产走全局 fetch），不暴露给模型。
 */
export async function runQuotaAsync(args, ctx, deps = {}) {
  const notes = []
  // `deps.apiKey` 是**测试/高级用法**的显式注入；生产按「harness 凭据 → 环境变量」解析
  let apiKey = String(deps.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '')
  let source = apiKey === '' ? null : deps.apiKey !== undefined ? '注入' : 'env DEEPSEEK_API_KEY'
  const credentials = ctx !== null && typeof ctx?.get === 'function' ? ctx.get('credentials') : undefined
  if (credentials !== undefined && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
      if (resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') {
        apiKey = resolved.value
        source = `credentials(${resolved.source})`
      }
    } catch (e) {
      notes.push(`⚠ 凭据解析失败（回退环境变量）：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const result = await fetchBalance({ apiKey, fetchImpl: deps.fetchImpl })
  if (!result.ok) {
    notes.push(`❌ 拉取失败：${result.why}${result.keys === undefined ? '' : `｜响应顶层键：${result.keys.join(',')}`}`)
  } else {
    const p = result.primary
    appendQuotaSample({ currency: p.currency, total: p.total, granted: p.granted, toppedUp: p.toppedUp, source: source ?? 'unknown', available: result.available })
    notes.push(`✅ 已采样：${p.currency} ${p.total.toFixed(2)}（来源 ${source ?? 'unknown'}）`)
    if (result.available === false) notes.push('⚠ 官方 is_available=false：当前账户不能调用（先充值）')
  }
  const head = renderQuotaCache({ ...(args ?? {}), refresh: false })
  return [head, '', '## 本次动作', ...notes.map((x) => `- ${x}`)].join('\n')
}

/** `explain`：口径与机制（回答「用什么评价」「能不能自己加」）。 */
function renderExplain() {
  return [
    '# budget: explain（口径、机制、开关）',
    '',
    '## 用什么评价「每次任务的流量消耗」',
    '- **主控量：工具调用次数**（钩子在每次调用前数一次；模型自己也能数）。理由：实测流量 ≈ **调用次数 × 每步上下文**，',
    '  单回合中位 16 步 / 每步 49.2 万 token；模型的输出只占 **0.9%**，所以「少写字」不是杠杆。',
    '- **记账量：`tok = Σ_step(input + cacheRead + output)`**，直接取官方 `assistant/message.usage`（与 `dsh-token-meter` 同源）。',
    '- **统计口径：按任务类取窗口内中位数**（不用均值：实测 p25 3.15M ↔ p90 17.63M，单个 84M 的失控能把均值拉偏 ~50%）；',
    `  窗口 ${BUDGET.window} 条、样本 < ${BUDGET.minSamples} 条只记账不调整；同一 workspace 样本优先。`,
    '',
    '## 预算怎么自己加减（±10%）',
    `- **加**：只在**撞到预算墙**（被拦过）时 +${Math.round(BUDGET.adjust * 100)}%；`,
    `- **减**：只在**已验证完成**时 −${Math.round(BUDGET.adjust * 100)}%（有债先扣）；`,
    '- **不动**：失败/中断/无证据的「完成」——失败不养预算，没证据的完成不算数；',
    `- **夹紧**：[${BUDGET.clamp.min}×, ${BUDGET.clamp.max}×] 该类中位调用数（棘轮的物理上限）；`,
    `- **追加**：\`budget action:"topup"\` 每任务限 ${BUDGET.topup.maxPerTask} 次、理由 ≥${BUDGET.topup.minReasonChars} 字、批 +${Math.round(BUDGET.topup.grantRatio * 100)}%、**记债**（下个已验证完成的任务扣回 ${Math.round(BUDGET.topup.debtRepayRatio * 100)}%）。`,
    '',
    '## 思考强度（自动调节；`agent/request` 瀑布）',
    `- 实测：reasoning token 只占全部流量的 **0.12%**（中位回合 0.078%），而且**高思考回合反而更省**`,
    '  （每步 ≥1000 reasoning 的回合步数中位 15.5 / tok 4.05M；<300 的回合 17 步 / 9.32M）。',
    '  ⇒ 它**不是省流量的旋钮**，是**「预算吃紧时强制收敛」的旋钮**：流量 ≈ 调用次数 × 每步上下文。',
    `- 规则：预算过 ${Math.round(EFFORT.rungs[EFFORT.rungs.length - 1].atRatio * 100)}% 降到 \`low\`，过 ${Math.round(EFFORT.rungs[0].atRatio * 100)}% 降到 \`off\`；**只降不升**、任务结束**还原**到改之前那一档；`,
    '  看不见档位（部署关了思考/换适配器）或档位未知 → **不动**；任何异常 → 退回原配置（绝不因为调速让请求失败）。',
    '- 效果可审计：每次配置变化都会落 `request/header`（里面有 `config.reasoningEffort`）。',
    '',
    '## 监控口径：**token 账是主，余额是 DeepSeek 特例**',
    '- **主监控 = token**（跨 provider 通用）：数据来自每个适配器都必须给的 `assistant/message.usage`，按**输入（缓存命中/未缓存）/ 输出（其中思考）**分开看；',
    '  ``budget action:"report"`` 的「Token 账」一节给出**按 provider / model** 的全机汇总。**积分制服务（MiMo / Qwen 等）只看这个**——那边「钱」没有意义，也没有余额接口。',
    '- **会话预算也按 token**（`SESSION`）：这才是能跨 provider 对齐的额度单位。',
    '',
    '## 余额（DeepSeek 专属）：`GET /user/balance`',
    '- 官方接口给的是**钱**（`{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}`，金额是**字符串**），',
    '  **没有「总量」字段** ⇒ 「剩余/总量=百分比」在官方接口上算不出来（社区流传的 `total_quota/remaining_quota/used_quota` 并不存在）。',
    '- 能做且做了：**采样 → 燃烧速率（¥/小时，只看最近单调下降区间，充值不算负消耗）→ ETA**；百分比只在**自定基线**（`baseline:`）或历史最高余额时给，并标注来源。',
    '- 命令：`budget action:"quota"`（默认**不联网**，读本机采样）｜`refresh:true` 拉一次（凭据走 harness 的 `credentials`，本工具不碰密钥文件）｜`node scripts/quota.mjs --refresh`（可挂 cron）。',
    '- token 侧的额度由 `SESSION` 管（用官方 usage，精确且免费）；余额这边是**钱**的维度，两者互补。',
    '',
    '## 会话 token 预算（跨回合的总闸；`SESSION` 表）',
    `- 默认 **${fmtTok(SESSION.defaultTokens)}**，可用 \`${SESSION.env}=500M\` 或 \`budget action:"session" tokens:"1B"\` 覆盖；提醒 ${Math.round(SESSION.warnAt * 100)}%、硬线 ${Math.round(SESSION.hardAt * 100)}%（到线只留收尾白名单）。`,
    '- 实测（26 个会话）：单会话累计 tok 中位 **1.25M**、p90 **89M**、max **832M**；**单个中位回合 6.61M**。',
    '  ⇒ 「100 万 token 一次会话」在数学证明这种负载下**不成立**（一次调用就会撞线），默认值按「成本闸」取 5e8。',
    '- 口径：`会话已用 = 已闭合回合累计 + 最近读到的当前回合 tok`；当前回合每 N 次调用刷新一次 → **判定可能滞后一个刷新周期**（宁可晚拦，也不每步读日志）。',
    '',
    '## 刹车（`brake` 模式）',
    `- ${Math.round(BUDGET.warnAt * 100)}% 提醒（PostToolUse 附加上下文，不拦）｜${BUDGET.softAt}× 起禁取证类（${BUDGET.evidenceTools.slice(0, 6).join('/')}…）｜${BUDGET.hardAt}× 起只留收尾白名单（${BUDGET.allowlist.slice(0, 5).join('/')}…）；`,
    `- 同一「工具+参数」到第 ${BUDGET.repeatAt + 1} 次就拦（原地打转与预算无关，优先判）；`,
    '- 一个回合最多拦 3 次（拦多了本身就是流量）；被拦**不是失败**，正确动作是 `proof_dag journal` 落盘 + 写明未完成项。',
    '',
    '## 开关',
    '- `MATH_PROOF_BUDGET=off` 全关；`=warn` 只提醒不拦；账本 `enabled:false` 等同 `warn`；',
    '- `budget action:"off"` / `"on"` 改账本开关；',
    '- 状态文件：`~/.dsh/state/math-proof/budget-profile.json`（学习账本）、`budget-turn-<会话>.json`（本回合实况）。',
  ].join('\n')
}

/** 执行一次预算操作。 */
export function runBudget(args, ctx) {
  const input = args === null || typeof args !== 'object' ? {} : args
  const action = typeof input.action === 'string' && input.action !== '' ? input.action : 'status'
  if (!ACTIONS.includes(action)) throw new Error(`budget: unknown action "${action}" (expected ${ACTIONS.join(' | ')})`)
  const cwd = String(input.cwd ?? process.cwd())
  const sessionId = input.sessionId === undefined ? '' : String(input.sessionId)

  if (action === 'status') return renderStatus({ sessionId, cwd })
  if (action === 'usage') return renderUsage({ sessionId, transcript: input.transcript, limit: input.limit })
  if (action === 'report') return renderReport(input, cwd)
  if (action === 'classes') return renderClasses(cwd)
  if (action === 'topup') return runTopup({ ...input, sessionId, cwd })
  if (action === 'calibrate') return runCalibrate(input, cwd)
  if (action === 'history') return renderHistory(input)
  if (action === 'session') return runSession(input, loadProfile())
  if (action === 'quota') return runQuota(input, ctx)
  if (action === 'explain') return renderExplain()

  // on / off
  const profile = loadProfile()
  profile.enabled = action === 'on'
  saveProfile(profile)
  const { mode, why } = budgetMode(profile)
  return [
    `# budget: ${action} ✅`,
    '',
    `- 账本开关: enabled=${profile.enabled}｜当前生效模式: **${mode}**（${why}）`,
    action === 'off' ? '- 已改为**只提醒不拦**（仍会记账、仍会标定——想完全不记请用 `MATH_PROOF_BUDGET=off` 重启）' : '- 已恢复两级刹车。',
  ].join('\n')
}

/**
 * 异步入口（工具执行用这个）：只有 `quota refresh:true` 需要联网，其余走同步实现。
 */
export async function runBudgetAsync(args, ctx) {
  const input = args === null || typeof args !== 'object' ? {} : args
  if (input.action === 'quota' && input.refresh === true) return runQuotaAsync(input, ctx)
  return runBudget(input, ctx)
}

/** 注册 `budget` 工具。 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'budget',
    description:
      '**本任务预算与流量账本**：`status` 看本回合实况（已用/剩余调用数、日志实测 tok、墙钟、被拦次数）；`report` 看按类基线（样本/中位/p90/tok，`scan:true` 顺带重扫全部日志现算）；`classes` 看任务分类与判定正则；`topup` **申请追加预算**（每任务限 1 次、理由 ≥20 字、批 +50%、记债，下个已验证完成的任务扣回 10%）；`calibrate` 用本机真实日志标定各类预算（`dryRun:true` 只算不写）；`history` 看最近结算样本；`explain` 看计量口径、±10% 自适应纪律与开关；`on`/`off` 切刹车。' +
      '用法要点：预算按**工具调用次数**计（流量 ≈ 调用次数 × 每步上下文；实测 99.6% 的流量是上下文重复读，模型输出只占 0.9%）；到提醒线会收到不拦截的提示，到软/硬线会拦取证类工具并给出收尾路径——**被拦不是失败，落盘未完成项才是合格交付**。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: 'status 本回合实况（含会话预算）/ usage **与界面同格式**的用量明细（本轮 + 最近若干轮 + 会话累计）/ report 按类基线 / classes 分类表 / topup 申请追加（需 reason）/ calibrate 标定（可 dryRun）/ history 历史样本 / session 看设会话 token 预算 / quota 余额采样与趋势（默认不联网，refresh:true 才拉）/ explain 口径与开关 / on,off 切刹车。',
        },
        reason: { type: 'string', description: `topup 用：追加理由（≥${BUDGET.topup.minReasonChars} 字，写清还缺哪一件关键证据、拿到就能收工）。` },
        limit: { type: 'number', description: 'history 用：返回多少条（1–60，默认 12）；usage 用：最近多少轮（1–20，默认 5）。' },
        tokens: { type: 'string', description: 'session 用：会话 token 预算（如 "1B" / "500M" / 纯数字）；留空=查看，reset=恢复默认。' },
        refresh: { type: 'boolean', description: 'quota 用：真的去拉一次官方 GET /user/balance（默认 false，只读本机采样缓存，不联网）。' },
        baseline: { type: 'number', description: 'quota 用：自定百分比基线（官方接口没有「总量」字段）。' },
        dryRun: { type: 'boolean', description: 'calibrate 用：只算不写盘。' },
        scan: { type: 'boolean', description: 'report 用：顺带重扫全部会话日志现算一遍（慢，几秒到几十秒）。' },
        cwd: { type: 'string', description: '可选：覆盖工作区路径（默认取本会话 cwd）。' },
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
    async execute(args, exec) {
      // 会话身份由工具桥给出（与 proof_dag 同一口径），不靠模型自己传
      const header = exec?.agent?.session?.header
      const merged = {
        ...(args === null || typeof args !== 'object' ? {} : args),
        cwd: header?.cwd ?? process.cwd(),
        sessionId: header?.id ?? '',
      }
      return { report: runBudget(merged) }
    },
  })
}
