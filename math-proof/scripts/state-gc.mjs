// 数学证明模式 — 状态目录维护（数据管理，零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/state-gc.mjs                 # 只报告（默认 dry-run）
//   node ... --apply --archive-days 90    # 把 90 天前的回执归档成 jsonl 并删除原件
//   node ... --apply --rebuild-index      # 用回执重建每模块聚合索引
//   node ... --apply --witness-gc         # 对每个见证仓库做 git gc（压缩历史）
//   node ... --apply --graph-keep 3       # 知识图谱导出每 workspace 只留最新 3 组，其余归档
//   node ... --apply --flow-min-age-days 3 # 删掉 3 天前的流程标记（每任务一份的瞬时状态；TTL 是 2 小时）
//   node ... --json                       # 机器可读输出
//
// 状态目录里有什么、为什么要管：
//   receipts/           编译回执（内容寻址，一次编译一条）+ agg-*.json（每模块聚合）
//   oracle-receipts/    oracle 回执（脚本哈希 + stdout 哈希）
//   history-*.json      评分历史（已限 200 条）
//   witness-*/          每个 workspace 一个 git 见证仓库（每次关键变更一个 commit）
//   checkpoint-*.json   见证检查点
//   graph-<ws>.{json,md}知识图谱导出（**可重建的派生物**，会随每次 graph 调用累积）
//   flow-<ws>.json      fable5 流程标记（**每任务一份、用完即弃**；闸门侧 TTL 2 小时，之后就是死文件）
//                       2026-09-10 实测：已堆到 124 个且**没有任何清理路径**——本脚本补上
//   budget-profile.json 预算学习账本（样本/各类预算；**不清理**——清了等于把学到的忘掉）
//   budget-turn-<sid>.json 每会话「本回合实况」（覆盖重写；残留可删）
//   carryover-<ws>.json 收工信箱（Stop 写入、下轮开局取空）
// 长期运行的风险：回执无限增长、见证仓库快照累积、聚合索引与回执脱节、图谱导出堆积、流程标记堆积。
// ⚠ **会话日志不在这里**：`~/.dsh/sessions/**` 是 harness 的数据（本 preset 只读它算流量），
//    没有任何保留/轮转策略——本脚本只**报告**它的占用，绝不删（那是唯一的历史）。
// 本脚本是唯一的维护入口——**归档不删除**（数据留档，热目录瘦身）。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'

import { stateDir } from '../impl/state-dir.mjs'
import { sessionLogVersion } from '../impl/session-traffic.mjs'

const argv = process.argv.slice(2)
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i === -1 ? d : argv[i + 1]
}
const APPLY = argv.includes('--apply')
const REBUILD = argv.includes('--rebuild-index')
const WITNESS_GC = argv.includes('--witness-gc')
const DAYS = Number(flag('archive-days', 0)) || 0
const GRAPH_KEEP = Number(flag('graph-keep', 0)) || 0
/** 流程标记的 TTL：与 `hooks/fable5-gate.mjs` 的 2 小时一致（更保守地按天判断）。 */
const FLOW_TTL_MS = 2 * 60 * 60 * 1000
const FLOW_MIN_AGE_DAYS = Number(flag('flow-min-age-days', 3))
const AS_JSON = argv.includes('--json')

// 状态目录走**唯一实现**（`MATH_PROOF_STATE_DIR` 可覆盖）——否则 `--apply` 会作用在用户真实状态上，
// 测试也没法隔离（2026-09-10：本脚本是最后一个硬编码状态目录的地方）
const STATE = stateDir()
if (!existsSync(STATE)) {
  console.log('state-gc: 状态目录不存在，无事可做')
  process.exit(0)
}

const dirSize = (dir) => {
  let bytes = 0
  let files = 0
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else {
        try {
          bytes += statSync(p).size
          files += 1
        } catch {
          /* 忽略消失的文件 */
        }
      }
    }
  }
  walk(dir)
  return { bytes, files }
}

// ── 1. 现状盘点 ────────────────────────────────────────────────────────────
const entries = readdirSync(STATE)
const report = {
  state: STATE,
  receipts: { files: 0, bytes: 0, aggs: 0, oldest: null },
  oracle: { files: 0, bytes: 0 },
  history: { files: 0, bytes: 0 },
  witness: { repos: 0, bytes: 0 },
  checkpoints: 0,
  ledgers: 0,
  graphs: { files: 0, bytes: 0, groups: 0 },
  budgetTurns: { files: 0, bytes: 0 },
  flow: { files: 0, bytes: 0, stale: 0, oldest: null },
  sessions: { files: 0, sessions: 0, bytes: 0, oldest: null, migrated: 0, migratedFiles: 0, migratedBytes: 0 },
  budgetProfile: { bytes: 0 },
  carryover: { files: 0, bytes: 0 },
}
const graphFiles = []
for (const e of entries) {
  const p = join(STATE, e)
  const st = statSync(p)
  if (e === 'receipts' && st.isDirectory()) {
    const all = readdirSync(p)
    report.receipts.aggs = all.filter((f) => f.startsWith('agg-')).length
    let oldest = null
    for (const f of all) {
      if (!f.endsWith('.json') || f.startsWith('agg-')) continue
      report.receipts.files += 1
      report.receipts.bytes += statSync(join(p, f)).size
      try {
        const ts = JSON.parse(readFileSync(join(p, f), 'utf8')).ts
        if (typeof ts === 'string' && (oldest === null || ts < oldest)) oldest = ts
      } catch {
        /* 损坏回执 */
      }
    }
    report.receipts.oldest = oldest
  } else if (e === 'oracle-receipts' && st.isDirectory()) {
    const s = dirSize(p)
    report.oracle.files = s.files
    report.oracle.bytes = s.bytes
  } else if (e.startsWith('history-')) {
    report.history.files += 1
    report.history.bytes += st.size
  } else if (e.startsWith('budget-turn-')) {
    // 每会话一份「本回合实况」（用完即弃；钩子会覆盖重写，不是学习状态）
    report.budgetTurns.files += 1
    report.budgetTurns.bytes += st.size
  } else if (e === 'budget-profile.json') {
    // 预算学习账本（跨天保留，**不清理**，只在报告里让体积可见）
    report.budgetProfile.bytes = st.size
  } else if (e.startsWith('carryover-')) {
    report.carryover.files += 1
    report.carryover.bytes += st.size
  } else if (e.startsWith('witness-') && st.isDirectory()) {
    const s = dirSize(p)
    report.witness.repos += 1
    report.witness.bytes += s.bytes
  } else if (e.startsWith('checkpoint-')) {
    report.checkpoints += 1
  } else if (e.startsWith('dag-') && e.endsWith('.json')) {
    report.ledgers += 1
  } else if (e.startsWith('flow-')) {
    // fable5 流程标记：每任务一份，闸门侧 TTL 2 小时 → 之后就是死文件
    report.flow.files += 1
    report.flow.bytes += st.size
    let ts = null
    try {
      const parsed = JSON.parse(readFileSync(p, 'utf8'))
      ts = typeof parsed?.ts === 'number' ? parsed.ts : null
    } catch {
      /* 损坏的标记：也算陈旧 */
    }
    if (ts !== null && Date.now() - ts > FLOW_TTL_MS) report.flow.stale += 1
    else if (ts === null) report.flow.stale += 1
    if (ts !== null && (report.flow.oldest === null || ts < report.flow.oldest)) report.flow.oldest = ts
  } else if (e.startsWith('graph-')) {
    report.graphs.files += 1
    report.graphs.bytes += st.size
    graphFiles.push(e)
  }
}
report.graphs.groups = new Set(graphFiles.map((f) => f.replace(/^graph-/, '').replace(/\.[a-z]+$/, ''))).size

// ── 1.5 会话日志（**只报告，绝不删**：那是 harness 的数据、也是唯一的历史）──────
{
  const root = join(homedir(), '.dsh', 'sessions')
  if (existsSync(root)) {
    for (const ws of readdirSync(root)) {
      const wsDir = join(root, ws)
      let ids = []
      try {
        ids = readdirSync(wsDir)
      } catch {
        continue
      }
      for (const id of ids) {
        // ⚠ 这里**故意数全部日志文件**（含 0.1.5 迁移后留下的旧文件）——这是磁盘占用的实话。
        // 算流量时不能这么做：同一会话的两份会重复计数，所以那条路径用 `pickSessionLog`
        // 只取版本最高的一份。两者口径不同、各有各的用途。
        let names = []
        try {
          names = readdirSync(join(wsDir, id))
        } catch {
          continue
        }
        const logs = names
          .map((n) => ({ n, v: sessionLogVersion(n) }))
          .filter((x) => x.v !== null)
          .sort((a, b) => a.v.version - b.v.version) // 旧 → 新
        if (logs.length === 0) continue
        report.sessions.sessions = (report.sessions.sessions ?? 0) + 1
        for (const { n } of logs) {
          const f = join(wsDir, id, n)
          const st2 = statSync(f)
          report.sessions.files += 1
          report.sessions.bytes += st2.size
          const t = st2.mtimeMs
          if (report.sessions.oldest === null || t < report.sessions.oldest) report.sessions.oldest = t
        }
        // 迁移残留：同一会话里**除最新一份**之外的旧日志（0.1.5 迁移不删旧文件）
        if (logs.length > 1) {
          report.sessions.migrated += 1
          for (const { n } of logs.slice(0, -1)) {
            report.sessions.migratedFiles += 1
            report.sessions.migratedBytes += statSync(join(wsDir, id, n)).size
          }
        }
      }
    }
  }
}

// ── 2. 归档旧回执（默认不动）───────────────────────────────────────────────
const archived = { receipts: 0, oracle: 0 }
if (APPLY && DAYS > 0) {
  const cutoff = Date.now() - DAYS * 86400000
  const archive = (dir, prefix) => {
    if (!existsSync(dir)) return 0
    mkdirSync(join(dir, 'archive'), { recursive: true })
    let n = 0
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('agg-')) continue
      const p = join(dir, f)
      let ts = null
      try {
        ts = Date.parse(String(JSON.parse(readFileSync(p, 'utf8')).ts ?? ''))
      } catch {
        continue
      }
      if (!Number.isFinite(ts) || ts >= cutoff) continue
      const month = new Date(ts).toISOString().slice(0, 7)
      const target = join(dir, 'archive', `${prefix}-${month}.jsonl`)
      appendFileSync(target, `${readFileSync(p, 'utf8').trim()}\n`, 'utf8')
      rmSync(p, { force: true })
      n += 1
    }
    return n
  }
  archived.receipts = archive(join(STATE, 'receipts'), 'compile')
  archived.oracle = archive(join(STATE, 'oracle-receipts'), 'oracle')
}

// ── 2.5 清理陈旧流程标记（默认不动；只删**已过期**的瞬时状态）────────────────
// `flow-<ws>.json` 是 fable5 钩子「每任务一份」的标记（闸门侧 TTL 2 小时）——
// 实测已堆到 124 个且**没有任何清理路径**，所以补在这里；只删超过 `--flow-min-age-days` 天的。
let flowRemoved = 0
if (APPLY && FLOW_MIN_AGE_DAYS > 0) {
  const cutoff = Date.now() - FLOW_MIN_AGE_DAYS * 86400000
  for (const f of readdirSync(STATE)) {
    if (!f.startsWith('flow-') || !f.endsWith('.json')) continue
    let ts = null
    try {
      const parsed = JSON.parse(readFileSync(join(STATE, f), 'utf8'))
      ts = typeof parsed?.ts === 'number' ? parsed.ts : null
    } catch {
      ts = null // 损坏 → 视为陈旧
    }
    if (ts === null || ts < cutoff) {
      rmSync(join(STATE, f), { force: true })
      flowRemoved += 1
    }
  }
}

// ── 3. 重建聚合索引 ───────────────────────────────────────────────────────
let rebuilt = 0
if (APPLY && REBUILD) {
  const dir = join(STATE, 'receipts')
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (f.startsWith('agg-')) rmSync(join(dir, f), { force: true })
    }
    const byModule = new Map()
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.startsWith('agg-')) continue
      let r
      try {
        r = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      } catch {
        continue
      }
      const key = String(r.relPath ?? r.path ?? '')
        .replace(/\.agda$/, '')
        .replace(/^.*?\/src\//, '')
        .replace(/^src\//, '')
        .replace(/\./g, '/')
      if (key === '') continue
      if (!byModule.has(key)) byModule.set(key, { module: key, label: r.relPath ?? `${key}.agda`, attempts: 0, failures: 0, totalMs: 0, maxMs: 0, lastTs: null, lastExit: null })
      const a = byModule.get(key)
      const ms = Number(r.wallMs) || 0
      a.attempts += 1
      if (r.exitCode !== 0) a.failures += 1
      a.totalMs += ms
      a.maxMs = Math.max(a.maxMs, ms)
      if (a.lastTs === null || String(r.ts) > String(a.lastTs)) {
        a.lastTs = r.ts ?? null
        a.lastExit = r.exitCode ?? null
      }
    }
    for (const [key, a] of byModule) {
      const hash = createHash('sha1').update(key).digest('hex').slice(0, 12)
      const tmp = join(dir, `agg-${hash}.json.tmp`)
      writeFileSync(tmp, `${JSON.stringify(a)}\n`, 'utf8')
      renameSync(tmp, join(dir, `agg-${hash}.json`))
      rebuilt += 1
    }
  }
}

// ── 3.5 图谱导出瘦身（派生物；按 workspace 保留最新 N 组，其余归档）──────────
let graphsArchived = 0
if (APPLY && GRAPH_KEEP > 0 && graphFiles.length > 0) {
  const byGroup = new Map()
  for (const f of graphFiles) {
    const key = f.replace(/^graph-/, '').replace(/\.[a-z]+$/, '')
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key).push({ f, mtimeMs: statSync(join(STATE, f)).mtimeMs })
  }
  mkdirSync(join(STATE, 'graph-archive'), { recursive: true })
  for (const [, list] of byGroup) {
    list.sort((a, b) => b.mtimeMs - a.mtimeMs)
    for (const { f } of list.slice(GRAPH_KEEP)) {
      renameSync(join(STATE, f), join(STATE, 'graph-archive', f))
      graphsArchived += 1
    }
  }
}

// ── 4. 见证仓库压缩 ───────────────────────────────────────────────────────
let witnessGc = 0
if (APPLY && WITNESS_GC) {
  for (const e of entries) {
    if (!e.startsWith('witness-')) continue
    const dir = join(STATE, e)
    if (!existsSync(join(dir, '.git'))) continue
    spawnSync('git', ['reflog', 'expire', '--expire=90.days', '--all'], { cwd: dir, stdio: 'ignore' })
    const r = spawnSync('git', ['gc', '--prune=now', '--quiet'], { cwd: dir, stdio: 'ignore' })
    if (r.status === 0) witnessGc += 1
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ ...report, applied: APPLY, archived, rebuilt, witnessGc, graphsArchived }, null, 2))
  process.exit(0)
}

const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`
console.log(`# 状态目录维护（${STATE}）\n`)
console.log(`| 类别 | 数量 | 体积 | 说明 |`)
console.log(`| --- | --- | --- | --- |`)
console.log(`| 编译回执 | ${report.receipts.files} 条（聚合 ${report.receipts.aggs} 个） | ${mb(report.receipts.bytes)} | 最旧 ${report.receipts.oldest?.slice(0, 10) ?? '—'} |`)
console.log(`| oracle 回执 | ${report.oracle.files} 条 | ${mb(report.oracle.bytes)} | 脚本 + stdout 哈希 |`)
console.log(`| 评分历史 | ${report.history.files} 个 | ${mb(report.history.bytes)} | 每 workspace 上限 200 条 |`)
console.log(`| 见证仓库 | ${report.witness.repos} 个 | ${mb(report.witness.bytes)} | 每次关键变更一个 commit |`)
console.log(`| 检查点 / 台账 | ${report.checkpoints} / ${report.ledgers} | — | — |`)
console.log(`| 知识图谱导出 | ${report.graphs.files} 个文件（${report.graphs.groups} 组） | ${mb(report.graphs.bytes)} | **派生物**（可由台账重建，可归档） |`)
console.log(`| 预算账本 | 1 份 | ${mb(report.budgetProfile.bytes)} | 学习状态（各类中位/预算/样本，**不清理**） |`)
console.log(`| 流程标记 | ${report.flow.files} 个（陈旧 ${report.flow.stale}） | ${mb(report.flow.bytes)} | fable5 每任务一份（TTL 2h）；陈旧可用 \`--apply --flow-min-age-days 3\` 删 |`)
console.log(`| 回合实况 | ${report.budgetTurns.files} 个 | ${mb(report.budgetTurns.bytes)} | 钩子每回合覆盖重写（可安全删除） |`)
console.log(`| 收工信箱 | ${report.carryover.files} 个 | ${mb(report.carryover.bytes)} | 取空即清（残留下轮会被覆盖） |`)
console.log(
  `| **会话日志** | ${report.sessions.files} 个文件 / ${report.sessions.sessions ?? 0} 个会话 | ${mb(report.sessions.bytes)} | harness 的数据（本 preset 只读它算流量）：最旧 ${
    report.sessions.oldest === null ? '—' : new Date(report.sessions.oldest).toISOString().slice(0, 10)
  }；**没有任何保留策略**，本脚本只报告、绝不删 |`,
)
if (report.sessions.migrated > 0) {
  console.log(
    `| ↳ 迁移残留 | ${report.sessions.migrated} 个会话有迁移残留（共 ${report.sessions.migratedFiles} 份旧日志） | ${mb(report.sessions.migratedBytes)} | 0.1.5 迁移把老日志变成 \`session.v3.jsonl.zstd\` 但**不删**旧的 \`session.jsonl.zstd\`；算流量时只取版本最高的一份，这里的体积是**真实占用**（清理与否由人决定） |`,
  )
}
console.log('')
if (!APPLY) {
  console.log('（dry-run）常用维护：')
  console.log('  --apply --archive-days 90   归档 90 天前的回执（写入 receipts/archive/*.jsonl，不删数据）')
  console.log('  --apply --rebuild-index     用回执重建每模块聚合索引（聚合与回执脱节时用）')
  console.log('  --apply --witness-gc        压缩见证仓库历史（reflog expire + git gc）')
  console.log('  --apply --graph-keep 3      图谱导出每 workspace 只留最新 3 组，其余移到 graph-archive/（不删）')
  console.log('  --apply --flow-min-age-days 3 删掉 3 天前的流程标记（每任务一份的瞬时状态，闸门 TTL 只有 2 小时）')
} else {
  console.log(
    `已执行：归档编译回执 ${archived.receipts} 条 / oracle 回执 ${archived.oracle} 条｜重建聚合 ${rebuilt} 个｜见证仓库压缩 ${witnessGc} 个｜图谱导出归档 ${graphsArchived} 个`,
  )
}
console.log(`\nSTATE_GC_OK（${APPLY ? '已应用' : 'dry-run'}）`)
