// PreToolUse 钩子（matcher `*`）：**预算闸门**——数调用、查原地打转、到点刹车。
//
// 三件必须做对的事：
//   1. **便宜**：本钩子跑在**每一次工具调用**前，只读一个状态文件（<2ms，日志一概不读），
//      因为每次调用都要起一个 Node 进程（实测 hook 本身 ~100ms 是官方桥的开销）；
//   2. **失败放行**：自身异常一律 exit 0。预算坏了不能让人干不了活——但异常会写进状态文件，
//      `budget action:"status"` 会把它报出来（**不静默**）；
//   3. **刹车分级**：软线（1.0×）只掐取证类（read/glob/grep/bash/web_*），
//      硬线（1.3×）只留收尾白名单（budget/proof_dag/proof_oracle/todo_write/…）。
//      一个回合最多拦 3 次——**拦多了本身就是流量**，之后交还处置权。
//
// 原地打转与预算无关，优先判：同一「工具 + 参数」到第 4 次就拦（实测日志里最长的一回合
// 有 325 步，那正是「无限循环烧流量」的形态）。

import { readFileSync } from 'node:fs'

import { budgetMode, gateDecision, loadProfile, readTurn, writeTurn } from '../impl/budget-policy.mjs'

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}

const sessionId = String(payload.session_id ?? '')
const toolName = String(payload.tool_name ?? '')
const toolInput = payload.tool_input ?? null

let decision = { action: 'allow', kind: 'skip', state: null }
try {
  const profile = loadProfile()
  const { mode } = budgetMode(profile)
  if (mode !== 'off') {
    const state = readTurn(sessionId)
    if (state !== null) {
      decision = gateDecision({ state, mode, toolName, toolInput, now: Date.now() })
      writeTurn(decision.state)
      // 内部异常也要留痕（放行但不沉默）
      delete decision.state.error
    }
  }
} catch (e) {
  decision = { action: 'allow', kind: 'error', reason: e instanceof Error ? e.message : String(e) }
  try {
    const state = readTurn(sessionId)
    if (state !== null) writeTurn({ ...state, error: `gate: ${decision.reason}` })
  } catch {
    /* 状态也写不动就只能放行 */
  }
}

if (decision.action === 'deny') {
  process.stderr.write(`${decision.reason}\n`)
  process.exit(2)
}
process.exit(0)
