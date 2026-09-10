// Stop 钩子：**只做副作用**——把该回合标记为待结算 + 往信箱里放「收工检查 / fable5 收工三项」。
//
// ⚠ 硬约束（源码 + 日志双重核对，见 `carryover.mjs` 顶部）：官方桥在 `agent/turn-stopping`
// 上只处理 `decision === "deny"`（强行续跑），**不注入 additionalContext**。所以在 Stop 里
// 「输出一段话提醒模型」是**无效**的——本 preset 原先的 `stop-reminder.mjs` 就是这样白跑了很久
// （日志里它的文本一次都没作为注入消息出现过）。要说话就写进信箱，由下一轮开局投递。
//
// 另一个硬事实：Stop 触发时 `turn/end` **还没落盘**（桥要等所有 Stop 钩子都放行才结束回合），
// 所以此处**必然结算不了**，只登记「待结算 + 回合号」；真正的结算在下一轮开局（`budget-start.mjs`
// 的 `reconcilePending`）完成——那时日志已闭合，读到的是完整用量。
//
// **绝不在 Stop 里 deny**：那会 steer 出一个新回合 = 直接把流量翻倍，与预算的目的相反。

import { readFileSync } from 'node:fs'

import { budgetMode, loadProfile, readTurn, settleTurn, writeTurn } from '../impl/budget-policy.mjs'
import { FABLE5_WRAPUP, appendCarry, inspectLedger } from './carryover.mjs'

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}

const sessionId = String(payload.session_id ?? '')
const transcript = String(payload.transcript_path ?? '')
const cwd = String(payload.cwd ?? process.cwd())

try {
  const profile = loadProfile()
  const { mode } = budgetMode(profile)
  if (mode !== 'off') {
    const state = readTurn(sessionId)
    if (state !== null) {
      // 登记待结算（通常 outcome=pending：此刻日志还没落 turn/end）。它会把
      // `logTurn`（日志里的回合号）存下来，下一轮补账时**按号取窗口**，
      // 不会被「新回合已经开始」干扰。
      const r = settleTurn({ profile, state, transcript: transcript === '' ? state.transcript : transcript, lastTurn: true })
      writeTurn(r.sample?.outcome === 'pending' ? state : r.sample === undefined ? state : { ...state, sessionTok: state.sessionTok, liveTok: 0 })
    }
  }

  // 信箱（任何模式都投递：这是修 Stop 投递失效的补丁，与预算开关无关）
  appendCarry(cwd, { kind: 'wrapup', text: FABLE5_WRAPUP })
  if (cwd !== '') {
    // 台账遗留检查：只有真有问题时才留言（没问题不啰嗦）
    const dag = await import(new URL('../plugins/proof-dag.mjs', import.meta.url).href)
    const text = inspectLedger(cwd, { readLedger: dag.readLedger, diagnose: dag.diagnose })
    if (text !== null) appendCarry(cwd, { kind: 'ledger', text })
  }
} catch {
  /* Stop 钩子出错就静默（它没有任何必须成功的职责；结算下轮还会再试一次） */
}
process.exit(0)
