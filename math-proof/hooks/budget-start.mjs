// UserPromptSubmit 钩子：**开局公告本任务预算** + 投递上一轮留言（收工检查 / fable5 收工三项）。
//
// 为什么投递点选这里：官方桥只在 SessionStart / UserPromptSubmit / PostToolUse 三处
// 把 `additionalContext` 真的交到模型手里；**Stop 钩子的话没人听**（见 `carryover.mjs` 顶部的
// 源码依据）。所以「收工检查」由 Stop 钩子写进信箱、由本钩子在下一轮开局时念出来。
//
// 契约（Claude Code 方言）：stdin JSON；stdout `hookSpecificOutput.additionalContext`。
// **任何内部错误都只降级为一行提示，绝不挡用户的消息**（钩子坏了不能让人没法干活）。

import { readFileSync } from 'node:fs'

import { budgetMode, loadProfile, readTurn, reconcilePending, sessionBudgetTokens, startTurn } from '../impl/budget-policy.mjs'
import { sessionTotals } from '../impl/session-traffic.mjs'
import { takeCarry } from './carryover.mjs'

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}

const sessionId = String(payload.session_id ?? '')
const transcript = String(payload.transcript_path ?? '')
const prompt = String(payload.prompt ?? '')
const cwd = String(payload.cwd ?? process.cwd())

const emit = (text) =>
  process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })}\n`)

try {
  const sections = []

  // 1) 上一轮的留言（与预算无关，任何模式下都投递）
  for (const item of takeCarry(cwd)) if (typeof item?.text === 'string' && item.text !== '') sections.push(item.text)

  // 2) 补上一轮没结完的账 —— 此刻那些日志都已闭合，能读到真实用量
  const profile = loadProfile()
  const { mode } = budgetMode(profile)
  if (mode !== 'off' && sessionId !== '') {
    // 不传 sessionId：把**所有**待结算回合都补上（子代理会话只跑一次，不会再发消息）
    const rec = reconcilePending({ profile })
    for (const d of rec.done) {
      if (typeof d.text === 'string' && d.text !== '') sections.push(d.text)
      else sections.push(`【补账】第 ${d.hookTurn} 个任务 → ${d.outcome}（第 ${d.attempts ?? 1} 次尝试）`)
    }

    // 3) 开局公告：会话预算 + 会话累计（首次开局时全量折叠一次；之后靠每回合增量累加）
    const previous = readTurn(sessionId)
    const budget = sessionBudgetTokens(rec.profile)
    let sessionTok = previous?.sessionTok ?? 0
    if (previous === null && transcript !== '') {
      try {
        sessionTok = sessionTotals(transcript).tok
      } catch {
        sessionTok = 0 // 读不到就从 0 起算（宁可晚一点拦，也不要报错卡住开工）
      }
    }
    const started = startTurn({
      sessionId,
      transcript,
      cwd,
      prompt,
      previous,
      profile: rec.profile,
      sessionTok,
      sessionBudget: budget.tokens,
    })
    if (started.text !== '') sections.push(started.text)
  }

  emit(sections.join('\n\n'))
} catch (e) {
  emit(`【预算】开局钩子内部错误（已放行，不拦任何调用）：${e instanceof Error ? e.message : String(e)}`)
}
