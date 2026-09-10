// PostToolUse 钩子（matcher `*`）：**过程中的预算播报**（只在要说话时才读日志）。
//
// 为什么用 PostToolUse 而不是 PreToolUse：官方桥只在 SessionStart / UserPromptSubmit /
// PostToolUse 三处把 `additionalContext` 交给模型；PreToolUse 的附加字段**不被读取**
// （它只有 `deny` / `ask` 两种处置）。所以「提醒」走这里，「拦截」走 PreToolUse。
//
// 成本纪律：本钩子每次工具调用都会跑（~100ms 进程开销）。所以
//   · 先用**纯函数** `shouldTick` 判断该不该说话，不该说就立刻退出（不读日志）；
//   · 该说才读日志（窗口只覆盖当前回合），且**读慢了就自我降级**（`LIVE_BUDGET_MS`），
//     下一轮起不再在过程中读，只在结算时读。

import { readFileSync } from 'node:fs'

import {
  budgetMode,
  classBaseline,
  liveUsage,
  loadProfile,
  readTurn,
  shouldTick,
  tickText,
  writeTurn,
} from '../impl/budget-policy.mjs'

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}

const sessionId = String(payload.session_id ?? '')
const emit = (text) =>
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } })}\n`)

try {
  const profile = loadProfile()
  const { mode } = budgetMode(profile)
  const state = readTurn(sessionId)
  if (state !== null && shouldTick(state, mode)) {
    // 需要说话 → 才读日志（当前回合窗口）
    const live = liveUsage({ state })
    let liveInfo = null
    if (live.ok && live.turn !== null) {
      const base = classBaseline(profile, state.class)
      liveInfo = {
        tok: live.turn.tok,
        steps: live.turn.steps,
        repeatMax: live.turn.repeatMax,
        baselineTok: base.calibrated ? base.tok.median : null,
      }
    }
    state.lastLiveMs = live.ok ? live.ms : (state.lastLiveMs ?? null)
    // 会话闸的「当前回合」那一半：把最近读到的 tok 记下来（硬线判定用它，可能滞后一个刷新周期）
    if (live.ok && live.turn !== null && typeof live.turn.tok === 'number') state.liveTok = live.turn.tok
    state.lastLiveWhy = live.ok ? null : live.why
    const text = tickText({ state, mode, live: liveInfo })
    writeTurn(state)
    if (typeof text === 'string' && text !== '') emit(text)
  }
} catch {
  /* 播报出错就闭嘴——不打扰，也不改状态 */
}
process.exit(0)
