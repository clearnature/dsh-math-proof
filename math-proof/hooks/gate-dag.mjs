// PreToolUse hook（matcher: proof_dag）：**拦截越过步骤**。
// 规则：把节点标成 proven 时，必须 (a) 全部依赖已 proven，(b) 给出 proof_compile 回执。
// 违反 → exit 2（stderr 作为理由回给模型）；其余一律放行（exit 0，无输出）。
import { readFileSync } from 'node:fs'
const dag = await import(new URL('../plugins/proof-dag.mjs', import.meta.url).href)

let payload = {}
try {
  payload = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}
const input = payload.tool_input ?? {}
const ws = payload.cwd ?? process.cwd()
const action = typeof input.action === 'string' ? input.action : 'list'

const fail = (msg) => {
  process.stderr.write(`${msg}\n`)
  process.exit(2)
}

try {
  const ledger = dag.readLedger(ws)
  const nodes = ledger.nodes ?? {}

  // 目标：要标 proven 的节点 + 其依赖
  let target = null
  let deps = []
  if (action === 'update' && input.state === 'proven' && typeof input.id === 'string') {
    target = input.id
    deps = nodes[target]?.deps ?? []
    if (typeof input.receipt !== 'string' || input.receipt.trim() === '') {
      if (!nodes[target]?.evidenceVerified) {
        fail(`🛑 步骤拦截：把 \`${target}\` 标为 proven 必须带 \`receipt\`（\`proof_compile\` 签发的回执）。先编译拿回执，不要手写 evidence。`)
      }
    }
  } else if (action === 'add' && input.node?.state === 'proven') {
    target = String(input.node?.id ?? '新节点')
    deps = Array.isArray(input.node?.deps) ? input.node.deps : []
    if (typeof input.node?.receipt !== 'string' || input.node.receipt.trim() === '') {
      fail(`🛑 步骤拦截：新增节点 \`${target}\` 直接标 proven 必须带 \`receipt\`。先 \`proof_compile\`。`)
    }
  } else {
    process.exit(0)
  }

  const unproven = deps.filter((x) => nodes[x]?.state !== 'proven')
  if (unproven.length > 0) {
    const detail = unproven.map((x) => `${x}（${nodes[x]?.state ?? '未登记'}）`).join('、')
    fail(`🛑 步骤拦截：\`${target}\` 的依赖尚未 proven：${detail}。\n先证依赖（或用 \`proof_dag action:"next"\` 看可开工集合），不要跳过依赖直接标 proven。`)
  }
} catch (e) {
  // 台账损坏等异常不阻塞工具（工具自身会报错）
  process.stderr.write(`hook gate-dag 异常（放行）：${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(0)
}
process.exit(0)
