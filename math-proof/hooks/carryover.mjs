// 数学证明模式 — **收工留言的搬运**（共享模块，不是钩子）
//
// 为什么需要它（2026-09-10 实测 + 源码核对得出的**硬约束**）：
//
//   **Stop 钩子输不出上下文。** 官方桥 `@deepseek-ai/dsh-hooks-claude-code` 里，
//   `agent/turn-stopping` 回调只处理 `decision === "deny"`（用来强行续跑）：
//
//       ctx.on("agent/turn-stopping", async ({ agent, turn, signal }) => {
//         const merged = await runPoint("Stop", "", stopPayload(ctx, agent), {...})
//         if (merged.decision === "deny") { agent.steer(...) }        // ← 只有这一条
//       })
//
//   对比其它三个点是**真的**会注入的（同一个文件里都调了 `contextFrom(merged)`）：
//       SessionStart     → agent.inject(context)
//       UserPromptSubmit → 追加到本步 messages
//       PostToolUse      → 追加到工具结果的 additionalContexts
//   （旁证：`hook/result` 事件只记 `turn/point/handlerId/decision/exitCode/durationMs`，
//    **不记 output**；而日志里能查到 SessionStart 的「接手简报」与 UserPromptSubmit 的
//    「fable5 开工四项」作为 `user/message`（source.plugin = hooks-claude-code）出现，
//    唯独 Stop 的文本**一次都没出现过**。）
//
//   于是本 preset 原先的两个 Stop 钩子（`stop-reminder.mjs` 与 `fable5-flow.mjs` 的 Stop 分支）
//   写的 `additionalContext` **从来没进过模型上下文**——每个回合白起两个 Node 进程。
//
// 修法（不造机制，只换投递点）：Stop 钩子只做**副作用**——把要说的话写进这里的信箱；
// 下一个回合的 UserPromptSubmit（`budget-start.mjs`）把信箱取空、连同新预算一起注入。
// 话照样说，只是**在能说话的时点说**。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { stateDir } from '../impl/session-traffic.mjs'

/** 信箱最多留几条（数据管理：状态文件必须有界）。 */
export const CARRY_MAX = 6

/** 按工作区隔离（同一 workspace 的多会话共用一封留言——收工检查本来就看同一份台账）。 */
export function carryPath(ws) {
  const hash = createHash('sha1').update(String(ws)).digest('hex').slice(0, 12)
  return `${stateDir()}/carryover-${hash}.json`
}

/** 读信箱（损坏 → 备份后当空的）。 */
export function readCarry(ws) {
  const path = carryPath(ws)
  if (!existsSync(path)) return { version: 1, items: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return { version: 1, items: Array.isArray(parsed?.items) ? parsed.items : [] }
  } catch {
    try {
      renameSync(path, `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`)
    } catch {
      /* 备份失败也不掩盖 */
    }
    return { version: 1, items: [] }
  }
}

/** 往信箱里追加一条（原子写；同一 `kind` 只留最新一条，避免堆积重复）。 */
export function appendCarry(ws, item) {
  const path = carryPath(ws)
  const current = readCarry(ws)
  const items = current.items.filter((x) => x.kind !== item.kind)
  items.push({ ...item, at: new Date().toISOString() })
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ version: 1, items: items.slice(-CARRY_MAX) }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 取空信箱（读完即清；读不到就当空的）。 */
export function takeCarry(ws) {
  const current = readCarry(ws)
  if (current.items.length > 0) {
    try {
      writeFileSync(carryPath(ws), `${JSON.stringify({ version: 1, items: [] }, null, 2)}\n`, 'utf8')
    } catch {
      /* 清不掉就算了：下轮再念一遍，不会丢信息 */
    }
  }
  return current.items
}

/**
 * 收工检查（原 `stop-reminder.mjs` 的内容，现在只**返回值**，由下轮开局时投递）：
 * 台账里还有未验证的 proven、断链、待人类裁决时，逐条点名。
 */
export function inspectLedger(ws, deps) {
  const { readLedger, diagnose } = deps
  try {
    const ledger = readLedger(ws)
    const nodes = ledger.nodes ?? {}
    if (Object.keys(nodes).length === 0) return null
    const d = diagnose(nodes, ledger.journal ?? [], ws)
    const open = (ledger.journal ?? []).filter((e) => e.kind === 'decision' && e.open === true)
    const items = []
    if (d.unverified.length > 0) items.push(`${d.unverified.length} 个 proven 无回执`)
    if (d.drift.length > 0) items.push(`${d.drift.length} 条台账↔代码断链`)
    if (open.length > 0) items.push(`${open.length} 条待人类裁决`)
    if (items.length === 0) return null
    return `【收工检查 · 上一轮遗留】${items.join('；')}。接手时先 \`proof_dag action:"brief"\`，把遗留项写进本轮计划，别当没看见。`
  } catch {
    return null
  }
}

/** fable5 收工三项（原 `fable5-flow.mjs` Stop 分支的文本，现在由 Stop 钩子存进信箱）。 */
export const FABLE5_WRAPUP = [
  '【fable5 流程 · 收工三项】',
  '- **第 7 条 持久记忆**：关键决策/教训/交接写 `proof_dag journal`（`decision` / `lesson` / `handoff`）；',
  '- **第 8 条 对抗自检**：结论自己先当反方审一遍（或用 `code-reviewer` 视角），列出最可能错的地方；',
  '- **第 9 条 防虚假完成**：**每一项「完成」都要能指到证据**（`proof_compile` 回执 / 命令输出 / 文件行号）。',
  '  没有证据的，写「未验证」或「待做」，不要写成已完成。',
].join('\n')
