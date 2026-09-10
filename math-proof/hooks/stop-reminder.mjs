// Stop hook：收工前提醒（附加上下文，不强制续跑）。
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
  if (Object.keys(nodes).length > 0) {
    const d = dag.diagnose(nodes, ledger.journal ?? [], ws)
    const open = (ledger.journal ?? []).filter((e) => e.kind === 'decision' && e.open === true)
    const items = []
    if (d.unverified.length > 0) items.push(`${d.unverified.length} 个 proven 无回执`)
    if (d.drift.length > 0) items.push(`${d.drift.length} 条台账↔代码断链`)
    if (open.length > 0) items.push(`${open.length} 条待人类裁决`)
    if (items.length > 0) {
      ctx = `【收工检查】${items.join('；')}。收工前请 \`proof_dag action:"journal" entry:{kind:"handoff", …}\` 写交接，把卡点与下一步留给下一天。`
    }
  }
} catch {
  /* 读取失败不打扰 */
}
process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: ctx } })}\n`)
