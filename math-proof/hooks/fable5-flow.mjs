// fable5 流程钩子：把「九条原则」里能**机器拦截**的三条落到实处（UserPromptSubmit / Stop）。
//
// 背景：`fable5-thinking` 上游（github.com/THEBLUEGHOSTSSSS/Fable5-Thinking-Skill）**只有 README + SKILL.md**，
// 没有 hooks/commands 文件；但它的 README 明确说这是一个**九步闭环流程**（`/fable5-thinking` 调用），
// 不是一段可以「读完就算」的知识。所以本 preset 把流程里**能机械拦截**的部分做成钩子：
//
//   · 第 1 条 自主任务分解 + 第 2 条 拓扑扫描（UserPromptSubmit）
//       —— 看起来是「跨多步的新任务」时，注入一段极短的开工清单（分解 → 拓扑扫描 → 多路径 → 计划模式 + 落台账）。
//          只在新任务的第一时间提醒，**不每轮都刷**；闲聊/单步问题不打扰。
//   · 第 7 条 持久记忆 + 第 9 条 防虚假完成（原 Stop 分支，2026-09-10 **移走**）
//       —— 收工时提醒：关键决策写 journal；**完成声明必须附证据**（工具回执/编译输出），
//          没证据的不许写「已完成」。
//          ⚠ 为什么不在这里说了：官方桥在 `agent/turn-stopping` 上**不注入 additionalContext**
//          （只处理 deny→steer，见 hooks/carryover.mjs 顶部的源码依据），Stop 钩子输出的话
//          一次都没进过模型上下文。现在这段文本由 `budget-settle.mjs`（Stop，做副作用）
//          写进信箱，再由 `budget-start.mjs`（UserPromptSubmit，能投递）在下一轮开局念出来。
//
// 知识部分仍在 `skills/fable5-thinking/SKILL.md`（随 preset 分发，九条原则原文）。
// 输入/输出契约与其它钩子一致：stdin JSON（Claude Code 方言），stdout `hookSpecificOutput.additionalContext`。

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { stateDir } from '../impl/state-dir.mjs'

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}

const event = String(payload.hook_event_name ?? payload.hookEventName ?? '')
const prompt = String(payload.prompt ?? payload.user_prompt ?? '')

/**
 * 多步任务的启发式。宁可偶尔不提醒（少打扰），也不要每轮刷屏。
 * 判据（任一）：
 *   · 很长（≥120 字符）—— 基本是任务描述而不是提问；
 *   · 含「成体系动作」动词（实现/重构/解决/盘点/收尾…）且不短（≥40）；
 *   · 含并列连词表示「多件事」（顺便/然后/还要/同时/以及/并且…）。
 * 排除：短问句、以及纯应答（好/继续/嗯/ok）。
 */
const MULTI_VERB = /(实现|重构|迁移|新增|接入|改造|设计|评审|审计|优化|批量|端到端|整条|一轮|全部|解决|补齐|完成|修复|排查|梳理|盘点|落地|收尾|推进)/
const CONJ = /(顺便|然后|还要|同时|以及|并且|另外|接着|并[^列行非])/
const ACK = /^(好|好的|嗯|对|是|可以|行|ok|OK|继续|接着来|go)\s*[。.!！]?$/
function looksMultiStep(text) {
  const t = text.trim()
  if (t === '' || ACK.test(t)) return false
  if (t.length < 30 && /[？?]$/.test(t)) return false // 短问句 = 单步查询
  if (t.length >= 120) return true
  if (CONJ.test(t)) return true
  return MULTI_VERB.test(t) && t.length >= 24
}

const INTAKE = [
  '【fable5 流程 · 开工四项】这是跨多步的新任务，按顺序过一遍再动手（fable5 第 1/2/3/6 条）：',
  '1. **分解**：列出子任务与依赖，每步写明「怎么验证」；',
  '2. **拓扑扫描**：改任何文件前先看谁 import 它（`proof_graph` / grep），标出级联风险；',
  '3. **多路径**：>50 行的改动或架构选择，至少给两条路径并标复杂度/风险，选一条、留一条备选；',
  '4. **落台账**：把目标拆成 `proof_dag` 节点（`add`/`import`），再开工——长程记忆不在上下文里，在台账里。',
].join('\n')

/**
 * 写「流程标记」：`fable5-gate.mjs` 靠它做「计划绑定」——
 * 多步任务已开工但台账里还没有分解时，动文件会被拦一次（exit 2）。
 * 标记放状态目录（按工作区 hash），**不写进用户仓库**。
 */
function markTask() {
  try {
    const ws = String(payload.cwd ?? process.cwd())
    const hash = createHash('sha1').update(ws).digest('hex').slice(0, 12)
    const dir = stateDir()
    const file = join(dir, `flow-${hash}.json`)
    mkdirSync(dir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(
      tmp,
      `${JSON.stringify({ ts: Date.now(), sessionId: String(payload.session_id ?? ''), planned: false, blockedOnce: false, prompt: prompt.slice(0, 120) })}\n`,
    )
    renameSync(tmp, file)
  } catch {
    /* 写不进去就算了：闸门读到旧标记最多多拦一次，不会卡死 */
  }
}

// 只处理 UserPromptSubmit（Stop 分支见文件头：那个投递点根本不生效）
let ctx = ''
if (event !== 'Stop' && looksMultiStep(prompt)) {
  ctx = INTAKE
  markTask()
}

process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx } })}\n`)
