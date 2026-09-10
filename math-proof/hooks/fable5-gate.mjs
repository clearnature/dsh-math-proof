// fable5 流程闸门：PreToolUse 上的两道机器拦截。
//
// ① **计划绑定**（fable5 第 1/3 条）：`UserPromptSubmit` 判定为「跨多步的新任务」后，
//    动文件之前必须先把计划落到台账（`proof_dag add`/`import`）或提交计划（`exit_plan_mode`）。
//    没落就写文件 → **拦一次**（exit 2 + 理由），重试即过——是减速带，不是墙。
// ② **防虚假完成**（fable5 第 9 条）：写入/编辑的内容里出现「完成宣称」却没有**任何证据标记**时拦住：
//    没证据的不许写成已完成，改成「未验证 / 待做」或补上回执/命令输出/行号。
//
// 状态文件（按工作区）放 `~/.dsh/state/math-proof/flow-<wsHash>.json`——**不写进用户仓库**。
// 逃生开关：环境变量 `MATH_PROOF_FLOW_GATE=off` 时本闸门完全放行（人在赶工时不必被流程绑住）。
//
// 输入：stdin JSON（Claude Code PreToolUse 方言：tool_name / tool_input / cwd / session_id）。
// 输出契约：**exit 2 + stderr 理由 = 拦住本次工具调用**；exit 0 = 放行（可顺带输出 additionalContext）。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}

/** 工具调用被拦住：exit 2 + stderr 理由（hook 协议：stderr 即模型看到的 reason）。 */
function block(reason) {
  process.stderr.write(reason)
  process.exit(2)
}

if (process.env.MATH_PROOF_FLOW_GATE === 'off') process.exit(0)

const ws = String(payload.cwd ?? process.cwd())
const wsHash = createHash('sha1').update(ws).digest('hex').slice(0, 12)
const STATE_DIR = join(homedir(), '.dsh', 'state', 'math-proof')
const MARKER = join(STATE_DIR, `flow-${wsHash}.json`)
const STALE_MS = 2 * 60 * 60 * 1000 // 2 小时没动静 → 标记过期，不拦

function readMarker() {
  try {
    const m = JSON.parse(readFileSync(MARKER, 'utf8'))
    if (typeof m?.ts !== 'number' || Date.now() - m.ts > STALE_MS) return null
    return m
  } catch {
    return null
  }
}

function writeMarker(m) {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    const tmp = `${MARKER}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(m)}\n`)
    renameSync(tmp, MARKER)
  } catch {
    /* 状态写不进去也不该拦住工具 */
  }
}

const tool = String(payload.tool_name ?? '')
const input = payload.tool_input ?? {}

// ── 达成「已出计划」的动作：落台账 / 提交计划 ─────────────────────────────
const PLANNED_TOOLS = new Set(['proof_dag', 'exit_plan_mode'])
if (PLANNED_TOOLS.has(tool)) {
  const action = String(input.action ?? '')
  const plannedAction = tool === 'exit_plan_mode' || ['add', 'import', 'journal', 'update'].includes(action)
  if (plannedAction) {
    const m = readMarker()
    if (m !== null) writeMarker({ ...m, planned: true, plannedAt: Date.now(), plannedBy: `${tool}${action === '' ? '' : `:${action}`}` })
  }
  process.exit(0)
}

// 只对「会改文件」的工具做拦截
if (!['write', 'edit'].includes(tool)) process.exit(0)

// ── ② 防虚假完成：内容里有完成宣称，却没有任何证据标记 ─────────────────────
// 只认**强完成宣称**（避免把「已完成：A、B」这类普通叙述也拦下）
const CLAIM = /(状态\s*[:：]\s*(DONE|完成|已完成))|(全部(通过|闭合|完成))|(任务(已)?完成)|(已证明(完毕)?)|(✅\s*(完成|全绿|全部通过))/
const EVIDENCE =
  /(回执|receipt|exit\s*0|exit code 0|编译通过|ALL_PASS|BENCHMARK_PASS|CHECK_ALL_OK|\d+\.\d+\s*s\b|行号|:\d+[-\d]*\b|证据|已验证|oracle|stdout|输出如下|命令输出)/i
const text = `${String(input.content ?? '')}\n${String(input.new_string ?? '')}`
if (CLAIM.test(text) && !EVIDENCE.test(text)) {
  block(
    [
      '【fable5 第 9 条 · 防虚假完成】这次写入里有「完成」宣称，但**没有任何证据标记**。',
      '',
      '本 preset 的规矩：**完成声明必须能指到证据**——`proof_compile` 回执 id、`exit 0`、命令输出片段、文件行号，',
      '或者 `proof_dag check` 的输出。没有证据的项请写成「未验证 / 待做 / BLOCKED」，不要写成已完成。',
      '',
      '改完这段文本再重试即可（这是内容问题，不会被「只拦一次」豁免）。',
      '',
      '（若确属误判，可设 `MATH_PROOF_FLOW_GATE=off` 关闭本闸门。）',
    ].join('\n'),
  )
}

// ── ① 计划绑定：跨多步任务还没落计划/台账就动文件 → 拦一次 ─────────────────
const marker = readMarker()
if (marker !== null && marker.planned !== true) {
  if (marker.blockedOnce === true) process.exit(0) // 减速带：每任务只拦一次
  writeMarker({ ...marker, blockedOnce: true, blockedAt: Date.now() })
  block(
    [
      '【fable5 第 1/3 条 · 计划绑定】你在做的是一个**跨多步**的任务，但台账里还没有它的分解。',
      '',
      '先做这一件事再改文件（任选其一）：',
      '  · `proof_dag` 的 `add` / `import`：把目标拆成节点（每步写明「怎么验证」）——推荐；',
      '  · 或提交计划（`exit_plan_mode`）。',
      '',
      '为什么：长程记忆不在上下文里，在台账里；没有分解就动手，改动方向无法核对、断链无法追踪。',
      `（本条只拦一次，且只在 2 小时内的新任务上生效。若你确认这是单步小改，直接重试即可。环境变量 \`MATH_PROOF_FLOW_GATE=off\` 可整体关闭。）`,
    ].join('\n'),
  )
}

process.exit(0)
