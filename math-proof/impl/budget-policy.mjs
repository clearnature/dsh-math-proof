// 数学证明模式 — **预算策略**（零依赖；钩子、插件、测试共用同一份判定）
//
// 定位：`session-traffic.mjs` 只负责**量**（读日志、算账、分类、统计）与**账本存取**；
// 本模块负责**判**（开局给多少、什么时候拦、结算时怎么加减）。分开的理由：
//   钩子每次调用都是**新进程**，插件是**冷档**，测试要能**直接调纯函数**——
//   三处若各写一遍判定，就会出现「钩子拦了、结算却没记账」这种自相矛盾的状态。
//
// 回答用户的两个问题（2026-09-10）：
//   Q「每次预算可以让模型自己加预算吗？每次减 10% 或加 10%，直到单次任务可以很好地跑完」
//   A 可以，但**不是自由旋钮**，而是「申请制 + 记债」：
//     · 加：只有 `budget action:"topup"` 申请、理由 ≥ 20 字、每任务限 1 次才批，
//       且记 1 笔债 —— **下个已验证完成的任务先扣回 10%**。想多花，先还。
//     · 减：**只在「已验证完成」时减 10%**；没证据的「完成」不算（见 `RECEIPT`）。
//     · 加也**只在「撞到预算墙」时加 10%**；失败/中断/报错**不加**——否则一个坏构建
//       就能把预算养肥（棘轮）。再加 [0.5×, 2×] 中位数的夹紧，棘轮在物理上就到顶了。
//   Q「用什么评价每次任务的流量平均消耗？」
//   A 见 `session-traffic.mjs` 的实测口径：**工具调用次数**做主控量（能精确数、模型也能自己数），
//     `tok = Σ(input+cacheRead+output)` 做记账，按**任务类**取**中位数**（不是均值：
//     实测 p25 3.15M ↔ p90 17.63M，单个 84M 的失控能把均值拉偏 ~50%），窗口 20 条，
//     样本 < 5 条只记账不调整。

import { existsSync, readFileSync } from 'node:fs'

import { BUDGET } from './ruleset.mjs'
import {
  budgetFor,
  callFingerprint,
  fmtTok,
  classBaseline,
  classDef,
  classifyTask,
  foldLastTurn,
  foldSessionWindow,
  loadProfile,
  newReceiptsSince,
  saveProfile,
  turnReceiptText,
  turnStatePath,
} from './session-traffic.mjs'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// ────────────────────────────────────────────────────────────────────────────
// 一、开关与回合状态
// ────────────────────────────────────────────────────────────────────────────

/**
 * 生效模式（**先看环境变量**，再看账本）：
 *   `MATH_PROOF_BUDGET=off`   → 关掉（不拦也不记账）
 *   `MATH_PROOF_BUDGET=warn`  → 只提醒不拦（软模式，用于先观察几天）
 *   账本 `enabled:false`      → 同上软关（`budget action:"off"` 写它）
 *   默认 `brake`              → 两级刹车
 */
export function budgetMode(profile) {
  const env = String(process.env.MATH_PROOF_BUDGET ?? '').trim().toLowerCase()
  if (env === 'off' || env === '0' || env === 'false') return { mode: 'off', why: 'env MATH_PROOF_BUDGET=off' }
  if (env === 'warn') return { mode: 'warn', why: 'env MATH_PROOF_BUDGET=warn' }
  if (profile?.enabled === false) return { mode: 'warn', why: '账本 enabled=false（`budget action:"on"` 恢复刹车）' }
  return { mode: 'brake', why: '默认两级刹车' }
}

/** 读本会话的回合状态（不存在返回 null）。 */
export function readTurn(sessionId) {
  const path = turnStatePath(sessionId)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** 原子写回合状态。 */
export function writeTurn(state) {
  const path = turnStatePath(state.session)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 有效预算 = 本类预算 + 本回合已批准的追加。 */
export function effectiveCalls(state) {
  return Math.max(1, Number(state?.budget ?? 1) + Number(state?.granted ?? 0))
}

/** token 显示（k/M）——实现在 `session-traffic.mjs`，这里再导出给插件用。 */
export { fmtTok }

/**
 * 门面再导出：钩子与插件**只 import 这一个模块**就够（量的口径仍只有一份实现）。
 * 注意：这些名字由 `export ... from` 直接转出，不在本模块另建绑定（否则与上面的 import 冲突）。
 */
export {
  blankProfile,
  budgetFor,
  callFingerprint,
  classBaseline,
  classDef,
  classifyTask,
  foldLastTurn,
  foldSession,
  foldSessionWindow,
  loadProfile,
  logPathForSession,
  median,
  newReceiptsSince,
  percentile,
  profilePath,
  saveProfile,
  scanSessionTurns,
  sessionLogFiles,
  stateDir,
  summarize,
  turnReceiptText,
  turnStatePath,
} from './session-traffic.mjs'

// ────────────────────────────────────────────────────────────────────────────
// 二、开局：公告本任务预算
// ────────────────────────────────────────────────────────────────────────────

/** 计量口径说明（进公告，也进 `budget action:"explain"`）。 */
export const COUNTER_NOTE =
  '计量用**工具调用次数**（不是 token）：钩子在每次工具调用前数一次，你也能自己数；' +
  'token 只在回合结算时出账（`tok = Σ(input+cacheRead+output)`；实测 99.6% 的流量是**上下文被重复读**）。'

/** 墙钟上限：按类取，缺省用 default；0 = 不限。 */
export function wallLimitMs(classId) {
  const per = BUDGET.wallMs?.[classId]
  return typeof per === 'number' ? per : (BUDGET.wallMs?.default ?? 0)
}

/**
 * 开一个新回合：分类 → 取预算 → 重置计数 → 渲染公告。
 * @returns `{ state, profile, mode, reason, text }`（`text` 为空串表示本回合不公告）
 */
export function startTurn(input) {
  const now = input.now ?? Date.now()
  const profile = input.profile ?? loadProfile()
  const { mode, why } = budgetMode(profile)
  const previous = input.previous === undefined ? readTurn(input.sessionId) : input.previous
  const classId = input.classId ?? classifyTask(input.prompt)
  const { cls, calls } = budgetFor(profile, classId)
  const state = {
    session: String(input.sessionId ?? ''),
    turn: Number(previous?.turn ?? 0) + 1,
    class: cls.id,
    classSource: input.classId === undefined ? 'auto' : 'declared',
    budget: calls,
    granted: 0,
    used: 0,
    denied: 0,
    budgetDenied: 0,
    repeat: {},
    repeatDenied: 0,
    startedAt: now,
    transcript: String(input.transcript ?? previous?.transcript ?? ''),
    cwd: String(input.cwd ?? ''),
    prompt: String(input.prompt ?? '').slice(0, 200),
    tickAt: 0,
    warned: false,
    lastLiveMs: previous?.lastLiveMs ?? null,
    topup: 0,
  }
  if (input.persist !== false) {
    writeTurn(state)
    // 首次使用就把账本落盘，让人能看见它、能改 `enabled`
    if (profile.updatedAt === null) saveProfile(profile)
  }
  if (mode === 'off') return { state, profile, mode, reason: why, text: '' }
  return { state, profile, mode, reason: why, text: renderAnnouncement(state, profile, mode) }
}

/** 开局公告（每回合都进上下文，所以要短）。 */
export function renderAnnouncement(state, profile, mode) {
  const eff = effectiveCalls(state)
  const base = classBaseline(profile, state.class, { cwd: state.cwd })
  const def = classDef(state.class)
  const wall = wallLimitMs(state.class)
  const lines = [
    `【本任务预算】类 \`${state.class}\`（${def.label}）｜预算 **${eff} 次工具调用**｜第 ${state.turn} 个任务`,
    `- ${COUNTER_NOTE}`,
    `- 基线（${base.scope === 'workspace' ? '本 workspace' : '全机'}）：${
      base.calibrated
        ? `本机近 ${base.n} 条同类样本**中位 ${base.calls.median} 次**（p90 ${base.calls.p90}，中位流量 ${fmtTok(base.tok.median)}）`
        : `样本 ${base.n}/${BUDGET.minSamples} 条 → 先用**先验 ${def.calls} 次**（够 ${BUDGET.minSamples} 条后才自适应；先验不是实测）`
    }`,
    `- 提醒线 ${Math.round(eff * BUDGET.warnAt)} 次（只提醒）｜${Math.round(eff * BUDGET.softAt)} 次起**禁取证类**工具（read/glob/grep/bash/web_*）｜${Math.round(eff * BUDGET.hardAt)} 次起只留收尾路径（${BUDGET.allowlist.slice(0, 4).join(' / ')} …）`,
    '- 被拦**不是失败**：停下取证，把已得结论与**未完成项**写进台账（`proof_dag action:"journal"`）就是合格交付——信息只许收敛，不许丢；',
    `- 确需追加：\`budget action:"topup" reason:"…（≥${BUDGET.topup.minReasonChars} 字）"\` —— 每任务限 ${BUDGET.topup.maxPerTask} 次，批 +${Math.round(BUDGET.topup.grantRatio * 100)}%，**记债**（下个已验证完成的任务扣回 ${Math.round(BUDGET.topup.debtRepayRatio * 100)}%）；`,
    `- 墙钟上限 ${(wall / 60000).toFixed(1)} min｜随时自查 \`budget action:"status"\`。`,
  ]
  if (mode === 'warn') lines.push('- ⚠ 当前是 **warn 模式**（只提醒不拦）——`budget action:"explain"` 看口径。')
  return lines.join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// 三、拦截判定（**纯函数**，测试直接调它）
// ────────────────────────────────────────────────────────────────────────────

/** 工具是否属于「收尾路径」（预算耗尽后仍允许）。 */
export function isAllowlisted(toolName) {
  return BUDGET.allowlist.includes(String(toolName))
}

/** 工具是否属于「取证类」（软刹车先掐这类）。 */
export function isEvidenceTool(toolName) {
  return BUDGET.evidenceTools.includes(String(toolName))
}

/** 原地打转判定时豁免的元工具（它们本来就会重复调用）。 */
const REPEAT_EXEMPT = ['todo_write', 'budget']

/**
 * 判定一次工具调用。纯函数：只就地更新传入的 `state`，返回处置结果。
 * @returns `{ action: 'allow'|'deny', kind, reason, state }`
 */
export function gateDecision(input) {
  const state = input.state
  if (state === null || state === undefined) return { action: 'allow', kind: 'no-state', state: null }
  const now = input.now ?? Date.now()
  const mode = input.mode ?? 'brake'
  const tool = String(input.toolName ?? '')
  const wall = input.wallLimitMs ?? wallLimitMs(state.class)

  state.used = Number(state.used ?? 0) + 1
  const eff = effectiveCalls(state)
  const ratio = state.used / eff
  const elapsed = now - Number(state.startedAt ?? now)

  // ── 1) 原地打转：与预算无关，最先查（「无限循环」的典型形态） ─────────────
  const fingerprint = callFingerprint(tool, JSON.stringify(input.toolInput ?? {}))
  const repeat = state.repeat ?? {}
  const keys = Object.keys(repeat)
  if (keys.length > 400) {
    const trimmed = {}
    for (const k of keys.slice(-200)) trimmed[k] = repeat[k]
    state.repeat = trimmed
  }
  const n = Number((state.repeat ?? {})[fingerprint] ?? 0) + 1
  state.repeat = { ...(state.repeat ?? {}), [fingerprint]: n }
  if (n > BUDGET.repeatAt && !REPEAT_EXEMPT.includes(tool) && mode === 'brake' && Number(state.repeatDenied ?? 0) < 3) {
    state.repeatDenied = Number(state.repeatDenied ?? 0) + 1
    state.denied = Number(state.denied ?? 0) + 1
    return {
      action: 'deny',
      kind: 'repeat',
      reason: [
        `【原地打转 · 第 ${n} 次】\`${tool}\` 用**完全相同的参数**已调用 ${n} 次（阈值 ${BUDGET.repeatAt}）。`,
        '同一输入不会给出新结果。二选一：',
        '① 换**真正不同**的证据源（别的模块 / 别的命令 / 别的文件），或先 `prover_limits action:"query"` 查这是不是已知工具链限制；',
        '② 把结论与**卡点**写进 `proof_dag action:"journal"`，写明「未解决 + 已排除什么」，收工。',
      ].join('\n'),
      state,
    }
  }

  if (mode !== 'brake') return { action: 'allow', kind: mode === 'off' ? 'off' : 'warn-mode', state }

  // ── 2) 墙钟到点 → 按硬线处理（调用次数没超但一步卡很久也要收） ────────────
  const overWall = wall > 0 && elapsed > wall
  // ── 3) 两级刹车：软线只掐取证类；硬线只留白名单 ────────────────────────
  let kind = null
  if (!isAllowlisted(tool) && (overWall || ratio > BUDGET.hardAt)) kind = overWall ? 'wall' : 'hard'
  else if (isEvidenceTool(tool) && ratio > BUDGET.softAt) kind = 'soft'

  // 拦多了本身就是流量：一个回合最多拦 3 次，之后放行（把处置权交还给模型/人类）
  if (kind !== null && Number(state.budgetDenied ?? 0) < 3) {
    state.budgetDenied = Number(state.budgetDenied ?? 0) + 1
    state.denied = Number(state.denied ?? 0) + 1
    return { action: 'deny', kind, reason: brakeReason({ state, kind, eff, ratio, elapsed, tool }), state }
  }
  return { action: 'allow', kind: 'pass', state }
}

/** 刹车理由：摆数字 + 给出**唯一可执行**的收尾路径。 */
export function brakeReason(input) {
  const { state, kind, eff, ratio, elapsed, tool } = input
  const head =
    kind === 'wall'
      ? `【墙钟到点】本任务已跑 ${(elapsed / 60000).toFixed(1)} min（上限 ${(wallLimitMs(state.class) / 60000).toFixed(1)} min）`
      : kind === 'hard'
        ? `【预算用尽】已用 ${state.used}/${eff} 次工具调用（${Math.round(ratio * 100)}%），越过硬线 ${BUDGET.hardAt}×`
        : `【停止取证】已用 ${state.used}/${eff} 次（${Math.round(ratio * 100)}%），越过软线 ${BUDGET.softAt}×——\`${tool}\` 属取证类`
  return [
    head,
    `本类 \`${state.class}\`。现在只做这三件事：`,
    '① `proof_dag action:"journal"` 落盘：已确立什么（**带证据**）、未完成什么、下一步从哪开始；',
    '② `todo_write` 列出未完成项（不留「回头再说」的暗账）；',
    `③ 确需追加：\`budget action:"topup" reason:"…"\`（每任务限 ${BUDGET.topup.maxPerTask} 次，记债 ${Math.round(BUDGET.topup.debtRepayRatio * 100)}%）。`,
    '**不要用「已完成」蒙过去**：交付里必须写明未验证的部分。被拦即停，就是本任务的正确收尾。',
  ].join('\n')
}

// ────────────────────────────────────────────────────────────────────────────
// 四、过程中的提醒（PostToolUse 附加上下文，**不拦**）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 该不该在工具结果后回一句（**纯函数**，让调用方能先判「要不要读日志」再读）。
 * 命中条件：跨过提醒线（每回合只念一次）或距上次播报满 `tickEvery` 次调用。
 */
export function shouldTick(state, mode = 'brake') {
  if (state === null || state === undefined) return false
  if (mode === 'off') return false
  const eff = effectiveCalls(state)
  const used = Number(state.used ?? 0)
  if (used / eff >= BUDGET.warnAt && state.warned !== true) return true
  return used - Number(state.tickAt ?? 0) >= BUDGET.tickEvery
}

/**
 * 渲染播报文本（会就地更新 `state.tickAt` / `state.warned`）；不该播报时返回 null。
 * `live` 是可选的实时用量（读日志有成本，由调用方按需提供，见 `liveUsage`）。
 */
export function tickText(input) {
  const state = input.state
  const mode = input.mode ?? 'brake'
  if (!shouldTick(state, mode)) return null
  const eff = effectiveCalls(state)
  const used = Number(state.used ?? 0)
  const now = input.now ?? Date.now()
  const elapsed = now - Number(state.startedAt ?? now)
  const wall = wallLimitMs(state.class)
  const ratio = used / eff
  const crossedWarn = ratio >= BUDGET.warnAt && state.warned !== true

  const live = input.live ?? null
  const parts = [`【预算】\`${state.class}\` ${used}/${eff} 次`]
  if (live !== null && typeof live.tok === 'number' && live.tok > 0) {
    parts.push(`已烧 **${fmtTok(live.tok)}** token（${live.steps} 步${live.baselineTok === null || live.baselineTok === undefined ? '' : `；本类中位 ${fmtTok(live.baselineTok)}`}）`)
  }
  parts.push(`墙钟 ${(elapsed / 60000).toFixed(1)}/${(wall / 60000).toFixed(1)} min`)
  if (live !== null && Number(live.repeatMax ?? 0) > 1) parts.push(`重复调用最高 ${live.repeatMax} 次`)
  if (crossedWarn) {
    parts.push(
      `⚠ 过 ${Math.round(BUDGET.warnAt * 100)}% 提醒线：**开始收敛**——先落盘结论（\`proof_dag journal\`），再只补最关键的那一件证据；到 ${Math.round(eff * BUDGET.softAt)} 次就只剩收尾路径`,
    )
  }
  state.tickAt = used
  if (crossedWarn) state.warned = true
  return parts.join('｜')
}

// ────────────────────────────────────────────────────────────────────────────
// 五、实时用量（读日志；慢就自己降级）
// ────────────────────────────────────────────────────────────────────────────

/** 读日志超过这个耗时（毫秒）就**不再**在过程中读它（结算时照读）。 */
export const LIVE_BUDGET_MS = 700

/**
 * 读「当前回合」的实时用量。
 * 自适应降级：本会话上次读超过 `LIVE_BUDGET_MS` → 本次直接不读（状态里记住），
 * 宁可少显示一个数字，也不让每次工具调用都卡半秒。
 */
export function liveUsage(input) {
  const state = input.state
  const transcript = input.transcript ?? state?.transcript
  if (typeof transcript !== 'string' || transcript === '' || !existsSync(transcript)) {
    return { ok: false, why: '无 transcript 路径' }
  }
  const last = state?.lastLiveMs
  if (typeof last === 'number' && last > LIVE_BUDGET_MS) {
    return { ok: false, why: `上次读用 ${last}ms（>${LIVE_BUDGET_MS}ms），已降级` }
  }
  const t0 = Date.now()
  let folded
  try {
    folded = input.lastTurn === false
      ? foldSessionWindow(transcript, { fromTurn: input.fromTurn, maxBytes: input.maxBytes ?? 6_000_000 })
      : readLastTurnFromLog(transcript, { maxBytes: input.maxBytes ?? 6_000_000 })
  } catch (e) {
    return { ok: false, why: `读日志失败：${e instanceof Error ? e.message : String(e)}` }
  }
  const ms = Date.now() - t0
  return { ok: true, ms, truncated: folded.truncated, turn: folded.turns[folded.turns.length - 1] ?? null }
}

// ────────────────────────────────────────────────────────────────────────────
// 六、结算：记账 + 自适应 ±10%
// ────────────────────────────────────────────────────────────────────────────

/**
 * 读**指定回合号**在日志里的账。
 *
 * 语义必须是「按号取」而不是「取窗口最后一条」：补账时（`reconcilePending`）日志里
 * 可能已经有更新的回合，取最后一条就会把**新回合**当成待补的那个，账目全错
 * （实测踩过：补账把 turn 3 当成 turn 2 结算，于是永远 pending）。
 */
export function readTurnFromLog(transcript, fromTurn, options = {}) {
  const folded = foldSessionWindow(transcript, { fromTurn, maxBytes: options.maxBytes ?? 8_000_000 })
  const exact = folded.turns.find((t) => t.turn === fromTurn) ?? null
  return { turn: exact, truncated: folded.truncated && exact === null, header: folded.header }
}

/**
 * 读日志里的**最后一个回合**（当前正在跑/刚跑完的那一轮）。
 * Stop 钩子与 `budget status` 用它：按「最后一条」而不是按号取。
 */
export function readLastTurnFromLog(transcript, options = {}) {
  const folded = foldLastTurn(transcript, { maxBytes: options.maxBytes ?? 8_000_000 })
  return { turn: folded.turns[folded.turns.length - 1] ?? null, truncated: folded.truncated, header: folded.header }
}

/**
 * 判定结局——**决定加减预算的唯一依据**（口径不许含糊）：
 *   · `verified`      —— 完成**且**有机器证据、且**没撞墙** → 唯一会**减**预算的结局；
 *   · `wall-verified` —— 撞墙但完成且有证据 → **不动**（说明预算刚好卡住）；
 *   · `wall`          —— 撞墙且没完成 → 唯一会**加**预算的结局；
 *   · `ok-unevidenced`—— 完成了但没证据 → **不动**（没证据的完成不算数，也不惩罚）；
 *   · `failed`        —— 报错/中断 → **不动**（不是预算的问题，不能拿它养预算）；
 *   · `pending`       —— 未闭合或窗口截断 → **不动，下轮补账**。
 */
export function classifyOutcome(input) {
  const { turn, state, truncated, receipts } = input
  if (truncated || turn === null || turn.open === true) {
    return { outcome: 'pending', why: truncated ? '窗口截断' : '回合未闭合（日志还没落 turn/end）' }
  }
  const reason = turn.reason ?? 'unknown'
  const hitWall = Number(state?.denied ?? 0) > 0 || Number(turn.denies ?? 0) > 0
  const def = classDef(state?.class ?? 'chat')
  const evidence = receipts ?? { text: turnReceiptText(turn), files: 0, names: [] }
  const verified = def.requireReceipt === true ? evidence.files > 0 || evidence.text === true : reason === 'completed'
  if (reason !== 'completed') return { outcome: hitWall ? 'wall' : 'failed', why: `回合以 ${reason} 结束` }
  if (verified) {
    return hitWall
      ? { outcome: 'wall-verified', why: '撞墙但完成且有证据——预算刚好卡住，先不动' }
      : { outcome: 'verified', why: '完成且有证据' }
  }
  return {
    outcome: 'ok-unevidenced',
    why: def.requireReceipt === true ? '完成但**无机器证据**（无新回执文件、文本无回执标记）' : '完成（该类不要求回执）',
  }
}

/**
 * 结算一个回合：读日志 → 判定结局 → 写样本 → 按证据加减 → 还债 → 落盘。
 * @returns `{ profile, sample, adjustment, outcome, text }`
 */
export function settleTurn(input) {
  const now = input.now ?? Date.now()
  const state = input.state
  const profile = input.profile ?? loadProfile()
  const transcript = input.transcript ?? state?.transcript ?? ''
  const window = input.lastTurn === true
    ? readLastTurnFromLog(transcript, { maxBytes: input.maxBytes })
    : readTurnFromLog(transcript, input.fromTurn ?? 1, { maxBytes: input.maxBytes })
  const turn = window.turn
  const files = newReceiptsSince(Number(state?.startedAt ?? now) - 1000)
  const receipts = { text: turn === null ? false : turnReceiptText(turn), files: files.count, names: files.names }
  const verdict = classifyOutcome({ turn, state, truncated: window.truncated, receipts })

  const hookUsed = Number(state?.used ?? 0)
  const calls = turn?.toolCalls ?? hookUsed
  const sample = {
    at: new Date(now).toISOString(),
    session: String(state?.session ?? ''),
    cwd: String(state?.cwd ?? ''),
    logTurn: turn?.turn ?? null,
    hookTurn: Number(state?.turn ?? 0),
    class: state?.class ?? 'chat',
    calls,
    hookUsed,
    steps: turn?.steps ?? null,
    tok: turn?.tok ?? null,
    outTok: turn?.outTok ?? null,
    ctxPeak: turn?.ctxPeak ?? null,
    wallMs: turn?.wallMs ?? now - Number(state?.startedAt ?? now),
    reason: turn?.reason ?? null,
    denies: Number(state?.denied ?? 0),
    repeatMax: turn?.repeatMax ?? null,
    outcome: verdict.outcome,
    receipts,
    // 进基线的条件：闭合、窗口完整、有 tok、且钩子计数与日志计数一致（±2）
    countable: false,
    why: verdict.why ?? null,
  }
  sample.countable =
    verdict.outcome !== 'pending' && typeof sample.tok === 'number' && sample.tok > 0 && Math.abs(calls - hookUsed) <= 2
  if (!sample.countable && sample.why === null) {
    sample.why =
      typeof sample.tok !== 'number' || sample.tok === 0
        ? '读不到 usage（日志不可读/回合无模型步）'
        : `钩子计数 ${hookUsed} 与日志计数 ${calls} 不一致`
  }
  sample.verified = sample.outcome === 'verified' || sample.outcome === 'wall-verified'

  const adjustment = adjustBudget({ profile, sample })
  profile.samples = [...(profile.samples ?? []), sample]
  if (adjustment.applied) {
    profile.budgets = {
      ...(profile.budgets ?? {}),
      [sample.class]: { calls: adjustment.next, at: sample.at, why: adjustment.why },
    }
  }
  const others = (profile.pending ?? []).filter((p) => !(p.session === sample.session && p.hookTurn === sample.hookTurn))
  if (input.trackPending !== false) {
    profile.pending =
      sample.outcome === 'pending'
        ? [...others, {
            session: sample.session,
            hookTurn: sample.hookTurn,
            logTurn: sample.logTurn,
            class: sample.class,
            startedAt: state?.startedAt ?? null,
            used: hookUsed,
            denied: Number(state?.denied ?? 0),
            transcript,
            attempts: 1,
          }].slice(-20)
        : others
  }
  if (input.persist !== false) saveProfile(profile)
  return { profile, sample, adjustment, outcome: verdict.outcome, text: renderSettlement(sample, adjustment, profile) }
}

/**
 * 自适应：**只在这三种结局上动手**（整套设计的核心纪律）。
 * 夹紧基准 = 该类**实测中位**（样本够）或**先验**（样本不够）。
 */
export function adjustBudget(input) {
  const { profile, sample } = input
  const base = classBaseline(profile, sample.class, { cwd: sample.cwd })
  const current = budgetFor(profile, sample.class).calls
  const no = (why) => ({ applied: false, next: current, why })
  if (sample.countable !== true) return no(`样本不可计数（${sample.why ?? '未闭合/截断/计数不一致'}）——只记账不动手`)
  if (base.n < BUDGET.minSamples) return no(`该类样本 ${base.n}/${BUDGET.minSamples} 条，数据不足 → 只记账不动手`)

  const floor = Math.max(1, Math.round(base.base * BUDGET.clamp.min))
  const ceiling = Math.max(floor, Math.round(base.base * BUDGET.clamp.max))

  if (sample.outcome === 'wall') {
    const next = Math.min(ceiling, Math.max(current + 1, Math.round(current * (1 + BUDGET.adjust))))
    if (next === current) return no(`已到夹紧上限 ${ceiling} 次（= 中位 ${base.base} × ${BUDGET.clamp.max}）`)
    return { applied: true, next, why: `撞墙（拦了 ${sample.denies} 次）→ +${Math.round(BUDGET.adjust * 100)}%（上限 ${ceiling}）` }
  }

  if (sample.outcome === 'verified') {
    let next = Math.max(floor, Math.round(current * (1 - BUDGET.adjust)))
    const parts = [`已验证完成 → −${Math.round(BUDGET.adjust * 100)}%（下限 ${floor}）`]
    const debt = Number(profile.debt ?? 0)
    if (debt > 0) {
      next = Math.max(floor, Math.round(next * (1 - BUDGET.topup.debtRepayRatio)))
      profile.debt = debt - 1
      parts.push(`还债 1 笔（剩 ${profile.debt}）`)
    }
    if (next === current) return no(parts[0])
    return { applied: true, next, why: parts.join('；') }
  }

  if (sample.outcome === 'wall-verified') return no('撞墙但完成且有证据——预算刚好卡住，先不动')
  if (sample.outcome === 'ok-unevidenced') return no('完成但无机器证据 → 不动（没证据的完成不算数）')
  return no(`以 ${sample.reason ?? '未知'} 结束 → 不动（失败不养预算）`)
}

/** 结算播报（Stop 时进上下文；人类也看得见）。 */
export function renderSettlement(sample, adjustment, profile) {
  const base = classBaseline(profile, sample.class, { cwd: sample.cwd })
  const ratio = base.calibrated && typeof sample.calls === 'number' && base.calls.median !== null ? sample.calls / base.calls.median : null
  const verdict = {
    pending: '⏳ 待结算（日志未闭合/窗口截断，下轮补账）',
    wall: '🛑 撞到预算墙',
    'wall-verified': '✅ 撞墙但完成且有证据',
    verified: '✅ 完成且有证据',
    'ok-unevidenced': '⚠ 完成但**无机器证据**（不计入「减预算」）',
    failed: `ℹ 以 ${sample.reason ?? '未知'} 结束`,
  }[sample.outcome] ?? `ℹ ${sample.outcome}`
  const lines = [
    `【结算】\`${sample.class}\` 第 ${sample.hookTurn} 个任务：${verdict}`,
    `- 工具调用 **${sample.calls}** 次（钩子计 ${sample.hookUsed}）｜步数 ${sample.steps ?? '—'}｜tok **${fmtTok(sample.tok)}**${sample.ctxPeak === null ? '' : `（上下文峰值 ${fmtTok(sample.ctxPeak)}）`}｜墙钟 ${(Number(sample.wallMs ?? 0) / 60000).toFixed(1)} min`,
    `- 本类基线（${base.scope === 'workspace' ? '本 workspace' : '全机'}）：${base.calibrated ? `中位 ${base.calls.median} 次（n=${base.n}）` : `样本不足（${base.n}/${BUDGET.minSamples}）`}${ratio === null ? '' : `｜本次为中位的 ${ratio.toFixed(2)}×`}`,
    adjustment.applied ? `- 下个同类任务预算：**${adjustment.next} 次**（${adjustment.why}）` : `- 预算不变：${adjustment.why}`,
  ]
  if (sample.receipts.files > 0) lines.push(`- 本回合新落盘回执 ${sample.receipts.files} 份（**强证据**）：${sample.receipts.names.join(', ')}`)
  else if (sample.receipts.text === true) lines.push('- 命中回执标记（**弱证据**：文本匹配，可能被抄写）')
  return lines.join('\n')
}

/** 未闭合回合的补账（下轮开局时调用；日志此时已闭合）。 */
export function reconcilePending(input) {
  const profile = input.profile ?? loadProfile()
  // 默认补**所有**待结算回合（不只本会话）：子代理会话只跑一次、不会再发下一条消息，
  // 若只补自己，那些回合的流量就永远不入账——那正是最容易被忽视的开销。
  const targets = (profile.pending ?? []).filter((p) => input.sessionId === undefined || p.session === input.sessionId)
  if (targets.length === 0) return { profile, done: [] }
  const done = []
  const survivors = []
  for (const p of targets) {
    const transcript = p.transcript ?? input.transcript ?? ''
    let fromTurn = p.logTurn
    if (typeof fromTurn !== 'number') {
      const retry = readTurnFromLog(transcript, 1, { maxBytes: input.maxBytes })
      if (retry.turn === null || retry.turn.open === true) {
        const attempts = Number(p.attempts ?? 0) + 1
        if (attempts < 3) survivors.push({ ...p, attempts })
        done.push({ hookTurn: p.hookTurn, outcome: 'pending-again', attempts })
        continue
      }
      fromTurn = retry.turn.turn
    }
    const state = {
      session: p.session,
      turn: p.hookTurn,
      class: p.class,
      startedAt: p.startedAt ?? Date.now(),
      used: Number(p.used ?? 0),
      denied: Number(p.denied ?? 0),
      transcript,
    }
    const result = settleTurn({ profile, state, transcript, fromTurn, persist: false, now: input.now, trackPending: false })
    if (result.outcome === 'pending') {
      const attempts = Number(p.attempts ?? 0) + 1
      if (attempts < 3) survivors.push({ ...p, logTurn: fromTurn, attempts })
      done.push({ hookTurn: p.hookTurn, outcome: 'pending-again', attempts })
    } else {
      done.push({ hookTurn: p.hookTurn, outcome: result.outcome, calls: result.sample.calls, text: result.text })
    }
  }
  // 试过 3 次还补不上的（日志被清、会话被删）→ 丢弃，不留永远的尾巴
  profile.pending = [...(profile.pending ?? []).filter((p) => !targets.includes(p)), ...survivors]
  saveProfile(profile)
  return { profile, done }
}
