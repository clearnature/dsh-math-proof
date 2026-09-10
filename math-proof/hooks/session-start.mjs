// SessionStart hook：把台账现状作为上下文注入新会话（跨天接手的自动化）。
// 输入：stdin JSON（含 cwd）；输出：hookSpecificOutput.additionalContext。
import { readFileSync } from 'node:fs'
const dag = await import(new URL('../plugins/proof-dag.mjs', import.meta.url).href)

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  payload = {}
}
const ws = payload.cwd ?? process.cwd()
let ctx = ''
try {
  const ledger = dag.readLedger(ws)
  const nodes = ledger.nodes ?? {}
  const total = Object.keys(nodes).length
  if (total === 0) {
    ctx = '【数学证明模式】本 workspace 台账为空。开工顺序：① `proof_dag init`；② 用 `kind:"object"` 登记对象（`construction` 必填）或用 `action:"import"` 批量导入；③ 每条陈述先跑 `proof_oracle` 再写 Agda。'
  } else {
    const d = dag.diagnose(nodes, ledger.journal ?? [], ws)
    const s = dag.stats(nodes)
    const ready = dag.schedulable(nodes)
    const open = (ledger.journal ?? []).filter((e) => e.kind === 'decision' && e.open === true)
    ctx = [
      `【数学证明模式 · 接手简报】workspace \`${ws}\``,
      `进度 ${s.progress}%（共 ${total} 节点｜proven ${s.proven} / refuted ${s.refuted} / blocked ${s.blocked} / needs_review ${s.needs_review}）｜完整性评分 ${d.score}/100`,
      `证据可信度 ${d.verifiedCount}/${d.totalProven}｜对象信息完整度 ${d.objectIds.length === 0 ? '无 object' : `${d.objectIds.length - new Set([...d.objectNoConstruction, ...d.objectNoRelations]).size}/${d.objectIds.length}`}｜断链 ${d.drift.length} 条｜未验证声明 ${d.unverified.length}`,
      ready.length === 0 ? '可开工：无（依赖未齐或全部终态）' : `可开工（${ready.length}）：${ready.slice(0, 6).join(', ')}${ready.length > 6 ? ' …' : ''}`,
      open.length === 0 ? '待人类裁决：无' : `待人类裁决（${open.length}）：${open.slice(0, 3).map((e) => String(e.text).slice(0, 40)).join('；')}`,
      '继续工作前先跑 `proof_dag action:"brief"` 看完整简报；不要凭记忆重建上下文。',
    ].join('\n')
  }
} catch (e) {
  ctx = `【数学证明模式】台账读取失败（${e instanceof Error ? e.message : String(e)}）——先确认 workspace 与权限，再跑 proof_dag init。`
}
process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } })}\n`)
