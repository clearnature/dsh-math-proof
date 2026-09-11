// 数学证明模式 — proof-dag 本地插件
//
// 注册 `proof_dag` 工具：一个**持久化的证明 DAG 台账 + 状态机 + 调度器**
// （Prove2Me 的核心能力的本地最小实现）：
//   · 节点 = 可验证命题（statement 必填），边 = deps
//   · 状态机：pending → active → proven | refuted | blocked | needs_review
//   · 所有权：每个节点可指派 owner（agent 名），避免重复劳动
//   · 调度：`next` 返回「依赖已 proven 的 pending 节点」= 当前可开工集合
//   · 体检：`check` 做环检测 / 悬空依赖 / 证据完整性 / **台账↔代码断链** / 诊断统计
//   · 溯源：节点可带 `source`（文献 / 人类学者 / 定理名），`journal` 记决策与来源流水
//   · 长程：`brief` 生成跨天接手简报（frontier / 卡点 / 待裁决 / 下一步）
//
// 长程任务的持久记忆就是这份台账：它必须能在上下文压缩、进程重启、跨天接手之后
// 独立重建「现在在哪、下一步做什么、什么被卡住、谁裁决过什么」。
//
// **git 本地见证**：每次改动都把台账快照 / 流水 / 引用到的回执提交进
// `~/.dsh/state/math-proof/witness-<hash>/`（独立 git 仓库），并把 HEAD 记进
// `checkpoint-<hash>.json`（仓库之外）。`check` 校验：上次 HEAD 是否为当前 HEAD 的祖先、
// 提交数是否只增不减、工作树是否干净、reflog 有无 reset/amend。任何「删记录 / 回退历史」
// 都会留下不一致。注意：有完全写权限的模型仍可连 .git 一起重写——本地见证提高成本并留下
// 痕迹，不等于不可篡改（真正的不可篡改需要外部只追加日志）。
//
// 台账落盘在 ~/.dsh/state/math-proof/dag-<workspace-hash>.json，
// **不写进项目仓库**（避免污染 git status）；按 workspace 路径分桶。
//
// **判定规则**（断链豁免 / 评分权重 / postulate 分类 / 编译爆炸处方）在 `impl/ruleset.mjs`，
// **静态 import（冷档）**：改规则要**重启 dsh 进程**（ESM 缓存，新会话不够）。
// 本次结果按进程内加载的那一版规则解释，输出带 `规则集 rN/hash` 戳；`doctor` 会报「磁盘 vs 进程内」哈希差。
// 每次输出带 `ruleset rN/hash` 戳；`action:"doctor"` 报「插件本体是否落后于磁盘」，
// 避免再次出现「本会话实例用旧规则算出 85/100、磁盘新规则算出 0 条」那种无法自证的尴尬。
//
// 本行不 provide 任何 service，可裸露在 preset 里；文件只 import `node:` 内建模块。

import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { stateDir, statePath } from '../impl/state-dir.mjs'
import { dirname, isAbsolute, join } from 'node:path'
import { compileHistory, compileHotspots, verifyReceipt } from './agda-engine.mjs'
import * as RULESET from '../impl/ruleset.mjs'
import { PLAN_DISCLAIMER, analyzeStatement, obligationId, planItemsToNodes, validatePlan } from '../impl/obligation.mjs'
import { importsOf } from './proof-graph.mjs'
import { readOracleReceipt, verifyOracleReceipt } from './python-oracle.mjs'

export const name = 'proof-dag'
export const inject = ['tools']

// **挂载时快照**：插件本体与判定规则的哈希。工具跑起来之后磁盘若被改动，doctor 能立刻指出来——
// 这正是 2026-09-10 那次「会话里用旧规则算出 85/100、磁盘新规则算出 0 条」无法自证的根因。
const PLUGIN_FILE = fileURLToPath(import.meta.url)
const LOADED_PLUGIN_HASH = RULESET.moduleHash(PLUGIN_FILE)
const LOADED_RULESET = { version: RULESET.RULESET_VERSION, hash: RULESET.moduleHash(RULESET.RULESET_PATH) }
const LOADED_LIVE_FALLBACK = { rules: RULESET, version: RULESET.RULESET_VERSION, hash: LOADED_RULESET.hash }

/** postulate 分类（口径见 `impl/ruleset.mjs` 的 POSTULATE）。 */
export const POSTULATE_KINDS = RULESET.POSTULATE.kinds

/** 节点状态机（合法取值）。 */
export const STATES = ['pending', 'active', 'proven', 'refuted', 'blocked', 'needs_review', 'abandoned']

/** 失败诊断（Goedel-Architect 的两种失败信号）。 */
export const DIAGNOSES = ['statement_wrong', 'proof_too_hard']

/** 流水条目类型（长程任务的可审计记忆）。 */
export const JOURNAL_KINDS = ['decision', 'source', 'limit', 'milestone', 'handoff', 'lesson']

/** 节点种类（信息完整对象层的核心区分：对象 vs 命题）。 */
export const NODE_KINDS = ['object', 'lemma', 'theorem', 'bridge']

/** 关系词表（`relations` 用 `前缀:目标` 形式，导出知识图谱时按前缀分桶）。 */
export const RELATION_KINDS = ['acts_on', 'represents', 'invariant', 'embeds', 'quotient_of', 'extends', 'isomorphic_to']

/**
 * 关系目标的语义分两类（引用完整性的判据）：
 *   · **节点目标**：目标应当是一个已登记对象/命题（acts_on / embeds / extends / quotient_of / isomorphic_to）
 *   · **属性标签**：目标是性质名，不是节点（invariant）——不参与「未登记」判定
 * 这样既保留表达能力，又让「指向幽灵对象」无所遁形。
 */
export const NODE_TARGET_RELATIONS = ['acts_on', 'embeds', 'extends', 'quotient_of', 'isomorphic_to']

/** 终态：不再需要工作。 */
const TERMINAL = new Set(['proven', 'refuted', 'abandoned'])

/**
 * 工具输出上限（行数）。依据「工具结果有界化」经验：输出体积固定，旧消息字节不随
 * 台账规模漂移，重放/摘要时才不会改变前缀。**不是删数据**——完整内容在台账文件里，
 * 报告会写明路径与「另有 N 条」。
 */
const MAX_TABLE_ROWS = 40
const MAX_ORDER_ROWS = 60

/** 台账路径（按 workspace 分桶，不写进仓库）。 */
export function ledgerPath(workspace) {
  const hash = createHash('sha1').update(String(workspace)).digest('hex').slice(0, 12)
  return statePath(`dag-${hash}.json`)
}

/** 读台账（不存在则返回空台账；损坏则备份后报错，绝不静默重置）。 */
export function readLedger(workspace) {
  const path = ledgerPath(workspace)
  if (!existsSync(path)) return { workspace, createdAt: new Date().toISOString(), nodes: {}, journal: [] }
  const quarantine = (why) => {
    // 静默重置 = 下次写入直接覆盖 = 数据全丢。先留证据，再报错。
    const bak = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(path, bak)
    } catch {
      /* 备份失败也不掩盖原始错误 */
    }
    throw new Error(`proof_dag: 台账损坏（${why}）→ 已备份到 \`${bak}\`。请人工核对后再重建，不要静默重置。`)
  }
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    return quarantine(`JSON 解析失败: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.nodes !== 'object' || parsed.nodes === null) {
    return quarantine('结构不符合 { nodes: {...} }')
  }
  return {
    workspace,
    createdAt: parsed.createdAt ?? new Date().toISOString(),
    nodes: parsed.nodes,
    journal: Array.isArray(parsed.journal) ? parsed.journal : [],
  }
}

/** 写台账（原子：临时文件 + rename，避免半截 JSON）。 */
export function writeLedger(ledger) {
  const path = ledgerPath(ledger.workspace)
  mkdirSync(dirname(path), { recursive: true })
  ledger.updatedAt = new Date().toISOString()
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 同步休眠（仅用于锁竞争，Node 主线程可用 Atomics.wait）。 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 咨询锁：防止并发 fan-out（workflow 多 agent）下的读-改-写丢更新。
 * 锁文件用 `wx` 独占创建；超过 5s 视为陈旧锁并抢占。
 */
export function withLedgerLock(workspace, fn) {
  const path = ledgerPath(workspace)
  mkdirSync(dirname(path), { recursive: true })
  const lock = `${path}.lock`
  const softDeadline = Date.now() + 5000
  const hardDeadline = Date.now() + 60000
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      // 写入持有者身份：陈旧抢占要能判断「进程是否还活着」
      try {
        writeFileSync(lock, JSON.stringify({ pid: process.pid, ts: Date.now() }), 'utf8')
      } finally {
        closeSync(fd)
      }
      break
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const now = Date.now()
      if (now > softDeadline) {
        let holder = null
        try {
          holder = JSON.parse(readFileSync(lock, 'utf8'))
        } catch {
          holder = null
        }
        const age = (() => {
          try {
            return now - statSync(lock).mtimeMs
          } catch {
            return 0
          }
        })()
        let alive = false
        if (holder !== null && Number.isInteger(holder.pid)) {
          try {
            process.kill(holder.pid, 0)
            alive = true
          } catch {
            alive = false
          }
        }
        // 只有「持有者进程已死」或「无 PID 且超过 30s」才抢占——不再单纯按 5s 抢
        if ((!alive && holder !== null) || (holder === null && age > 30000)) {
          try {
            unlinkSync(lock)
          } catch {
            /* 已被别人释放 */
          }
          continue
        }
        if (now > hardDeadline) {
          throw new Error(
            `proof_dag: 台账锁被占用超过 60s（holder pid=${holder?.pid ?? '?'}）→ 拒绝写入以免双写；确认无并发后删除 ${lock}`,
          )
        }
      }
      sleepSync(20)
    }
  }
  try {
    return fn()
  } finally {
    try {
      unlinkSync(lock)
    } catch {
      /* 已被陈旧锁清理逻辑移除 */
    }
  }
}

/** 拓扑序（依赖优先）；返回 `{ order, cyclic }`。 */
export function topoOrder(nodes) {
  const ids = Object.keys(nodes)
  const indeg = new Map(ids.map((id) => [id, 0]))
  const dependents = new Map(ids.map((id) => [id, []]))
  for (const id of ids) {
    for (const dep of nodes[id].deps ?? []) {
      if (!Object.hasOwn(nodes, dep)) continue
      indeg.set(id, (indeg.get(id) ?? 0) + 1)
      dependents.get(dep).push(id)
    }
  }
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort()
  const order = []
  while (queue.length > 0) {
    const id = queue.shift()
    order.push(id)
    for (const d of dependents.get(id).sort()) {
      const next = (indeg.get(d) ?? 0) - 1
      indeg.set(d, next)
      if (next === 0) queue.push(d)
    }
  }
  return { order, cyclic: ids.filter((id) => !order.includes(id)).sort() }
}

/** 当前可开工集合：pending 且全部依赖已 proven。 */
export function schedulable(nodes) {
  return Object.keys(nodes)
    .filter((id) => nodes[id].state === 'pending')
    .filter((id) => (nodes[id].deps ?? []).every((d) => nodes[d]?.state === 'proven'))
    .sort()
}

/** 状态统计。 */
export function stats(nodes) {
  const out = Object.fromEntries(STATES.map((s) => [s, 0]))
  for (const n of Object.values(nodes)) if (out[n.state] !== undefined) out[n.state] += 1
  const total = Object.keys(nodes).length
  const done = out.proven + out.refuted
  return { total, ...out, progress: total === 0 ? 0 : Math.round((done / total) * 100) }
}

/**
 * 读取某 Agda 模块的源码与 import 列表（断链检测用）。
 * 依次尝试 `<workspace>/src/<mod>.agda` 与 `<workspace>/<mod>.agda`。
 * @returns `{ found, imports }`；文件不存在时 `found=false`。
 */
export function moduleImports(workspace, moduleName) {
  const rel = `${String(moduleName).replace(/\./g, '/')}.agda`
  for (const base of [join(workspace, 'src', rel), join(workspace, rel)]) {
    if (!existsSync(base)) continue
    // import 解析复用 proof-graph 的 `importsOf`（单一事实源，避免两套正则漂移）
    return { found: true, imports: importsOf(readFileSync(base, 'utf8')) }
  }
  return { found: false, imports: [] }
}

/** 见证仓库目录（独立 git 仓库，按 workspace 分桶）。 */
export function witnessDir(workspace) {
  const hash = createHash('sha1').update(String(workspace)).digest('hex').slice(0, 12)
  return statePath(`witness-${hash}`)
}

/** 见证检查点（存在 git 仓库**之外**，防止「连仓库一起重写」时两边一起改）。 */
export function checkpointPath(workspace) {
  const hash = createHash('sha1').update(String(workspace)).digest('hex').slice(0, 12)
  return statePath(`checkpoint-${hash}.json`)
}

/**
 * 跑一条 git 命令（经 ctx.shell，套用 session 的 sandbox 策略）。
 * `runtime` = `{ shell, sandboxPolicy }`；没有 shell 时见证整体降级，不影响台账功能。
 */
async function git(runtime, exec, workdir, command, timeoutMs = 30000) {
  const policy = runtime.sandboxPolicy
  const sandboxPolicy =
    policy === undefined ? undefined : policy.resolve(exec?.agent === undefined ? {} : { session: exec.agent.session })
  const spec = runtime.shell.resolve({
    command,
    workdir,
    timeoutMs,
    stdoutMaxBytes: 256 * 1024,
    signal: exec?.signal,
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
  })
  const r = await runtime.shell.run(spec)
  return {
    code: r.exitCode,
    out: (r.stdout?.text ?? '').trim(),
    err: (r.stderr?.text ?? '').trim(),
    denied: r.sandbox?.denied === true,
  }
}

/** 把当前台账 / 流水 / 回执提交进见证仓库；返回 `{ head, count }`，失败返回 null。 */
async function witnessCommit(runtime, exec, workspace, ledger, message) {
  const dir = witnessDir(workspace)
  try {
    mkdirSync(dir, { recursive: true })
    if (!existsSync(join(dir, '.git'))) {
      const init = await git(runtime, exec, dir, 'git init -q')
      if (init.code !== 0) return null
      await git(runtime, exec, dir, "git config user.email witness@math-proof.local")
      await git(runtime, exec, dir, 'git config user.name math-proof-witness')
    }
    // 快照：台账 + 流水（jsonl，便于 diff）+ 被引用的回执副本
    writeFileSync(join(dir, 'ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
    const lines = (ledger.journal ?? []).map((e) => JSON.stringify(e)).join('\n')
    writeFileSync(join(dir, 'journal.jsonl'), lines === '' ? '' : `${lines}\n`, 'utf8')
    const rdir = join(dir, 'receipts')
    mkdirSync(rdir, { recursive: true })
    const { readReceipt } = await import('./agda-engine.mjs')
    for (const n of Object.values(ledger.nodes ?? {})) {
      const id = n.evidenceReceipt
      if (typeof id !== 'string' || id === '') continue
      const rec = readReceipt(id)
      if (rec !== null) writeFileSync(join(rdir, `${id}.json`), `${JSON.stringify(rec, null, 2)}\n`, 'utf8')
    }
    await git(runtime, exec, dir, 'git add -A')
    const safe = String(message).replace(/["`$\\]/g, '').slice(0, 120)
    await git(runtime, exec, dir, `git commit -q --allow-empty -m "${safe}"`)
    const head = await git(runtime, exec, dir, 'git rev-parse HEAD')
    const count = await git(runtime, exec, dir, 'git rev-list --count HEAD')
    if (head.code !== 0 || !/^[0-9a-f]{40}$/.test(head.out)) return null
    const n = Number.parseInt(count.out, 10)
    return { head: head.out, count: Number.isFinite(n) ? n : 0 }
  } catch {
    return null
  }
}

/**
 * 见证体检：上次检查点是否仍是当前历史的祖先、提交数是否只增不减、工作树是否干净、
 * reflog 里有没有 reset/amend。
 */
export async function witnessStatus(runtime, exec, workspace) {
  const dir = witnessDir(workspace)
  if (!existsSync(join(dir, '.git'))) return { available: false, why: '尚无见证仓库' }
  const version = await git(runtime, exec, dir, 'git --version', 10000)
  if (version.code !== 0) return { available: false, why: version.denied ? '沙箱拒绝执行 git' : 'git 不可用' }
  const head = await git(runtime, exec, dir, 'git rev-parse HEAD')
  const count = await git(runtime, exec, dir, 'git rev-list --count HEAD')
  const porcelain = await git(runtime, exec, dir, 'git status --porcelain')
  const reflog = await git(runtime, exec, dir, 'git reflog --format=%gs')
  const current = head.code === 0 ? head.out : null
  const commits = Number.parseInt(count.out, 10)
  let recorded = null
  if (existsSync(checkpointPath(workspace))) {
    try {
      recorded = JSON.parse(readFileSync(checkpointPath(workspace), 'utf8'))
    } catch {
      recorded = { broken: true }
    }
  }
  const suspicious = /reset:|amend/i.test(reflog.out)
  let ancestor = true
  if (recorded !== null && !recorded.broken && typeof recorded.head === 'string' && current !== null) {
    const check = await git(runtime, exec, dir, `git merge-base --is-ancestor ${recorded.head} HEAD`)
    ancestor = check.code === 0
  }
  return {
    available: true,
    head: current,
    count: Number.isFinite(commits) ? commits : 0,
    dirty: porcelain.out !== '',
    recorded,
    rewritten: recorded !== null && !recorded.broken && (current === null || !ancestor),
    shrunk: recorded !== null && !recorded.broken && Number.isFinite(commits) && commits < (recorded.count ?? 0),
    suspicious,
  }
}

/** 写见证检查点（仓库之外）。 */
export function writeCheckpoint(workspace, info) {
  const path = checkpointPath(workspace)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ ...info, at: new Date().toISOString() }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 渲染见证体检。 */
/**
 * doctor：本实例自证。回答「现在跑的是哪版规则、插件本体有没有落后于磁盘」——
 * 让分数与断链数**可追溯**，而不是靠人肉 diff 工具输出与源码。
 */
export function renderDoctor(workspace, live) {
  const diskPlugin = RULESET.moduleHash(PLUGIN_FILE)
  const bodyStale = diskPlugin !== LOADED_PLUGIN_HASH
  const diskRulesHash = RULESET.moduleHash(RULESET.RULESET_PATH)
  const rulesStale = diskRulesHash !== null && diskRulesHash !== LOADED_RULESET.hash
  const ledger = readLedger(workspace)
  const nodes = ledger.nodes ?? {}
  const st = stats(nodes)
  const receipts = listReceiptIds()
  const others = ['agda-engine.mjs', 'python-oracle.mjs', 'prover-limits.mjs', 'proof-graph.mjs', 'proof-discipline.mjs']
    .map((f) => {
      const h = RULESET.moduleHash(join(dirname(PLUGIN_FILE), f))
      return h === null ? null : `  - \`${f}\`: 磁盘 ${h}`
    })
    .filter((x) => x !== null)
  return [
    '# proof_dag: doctor（本实例自证）',
    '',
    `- 插件本体 \`proof-dag.mjs\`: 本实例 **${LOADED_PLUGIN_HASH ?? 'unknown'}** / 磁盘 **${diskPlugin ?? 'unknown'}**${
      bodyStale ? ' ⚠ **落后于磁盘**' : ' ✅ 一致'
    }`,
    `- 判定规则 \`impl/ruleset.mjs\`: **${live.version}/${live.hash ?? 'unknown'}**（静态 import，冷档；${
      rulesStale ? `⚠ **磁盘上是 ${diskRulesHash}** → 改过规则但**没重启进程**，本次结果仍按进程内那一版解释` : '✅ 与磁盘一致'
    }）`,
    `- 台账: \`${ledgerPath(workspace)}\`｜节点 ${st.total}（proven ${st.proven} / refuted ${st.refuted} / blocked ${st.blocked} / needs_review ${st.needs_review} / pending ${st.pending}）`,
    `- 工具签发回执: **${receipts.length}** 条｜状态目录: \`${stateDir()}\``,
    '',
    '## 其他 preset 插件的磁盘版本（仅供参考，工具无法自报它们的加载版本）',
    ...others,
    '',
    bodyStale
      ? '> ⚠ **插件本体落后**：本实例的结构/schema/输出格式是旧版——**必须重启 dsh 进程**才会加载新代码（Cordis 用无 query 的 `import(url)`，Node 的 ESM 缓存按 URL 在进程内固化；「新会话」不够）。在此之前，引用分数请连同上面的哈希一起引用。'
      : '> ✅ 插件本体与磁盘一致；判定规则为冷档（改规则需重启进程）。本实例输出可以放心引用。',
  ].join('\n')
}

/** 回执 id 列表（doctor 用；只数目录，不读内容）。 */
function listReceiptIds() {
  const dir = statePath('receipts')
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
}

export function renderWitness(st) {
  if (!st.available) return `- git 见证: — ${st.why}（不影响评分；无 git 时降级）`
  const short = st.head === null ? '（无提交）' : `\`${st.head.slice(0, 8)}\``
  const bits = [`- git 见证: ${short}（第 ${st.count} 次提交）`]
  if (st.rewritten) bits.push('- ❌ **历史被改写**：上次检查点已不是当前 HEAD 的祖先（删/回退提交）')
  if (st.shrunk) bits.push(`- ❌ **提交数倒退**：${st.recorded?.count ?? '?'} → ${st.count}`)
  if (st.dirty) bits.push('- ⚠ 工作树有未提交改动（台账被改但未进见证）')
  if (st.suspicious) bits.push('- ⚠ reflog 出现 reset/amend 痕迹')
  if (bits.length === 1) bits.push('- 见证链完整 ✅')
  return bits.join('\n')
}

/** 评分历史路径（按 workspace 分桶）。 */
export function historyPath(workspace) {
  const hash = createHash('sha1').update(String(workspace)).digest('hex').slice(0, 12)
  return statePath(`history-${hash}.json`)
}

/** 读评分历史（损坏则视为空，不抛错——历史只是趋势，不是裁决依据）。 */
export function readHistory(workspace) {
  const path = historyPath(workspace)
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed?.runs) ? parsed.runs : []
  } catch {
    return []
  }
}

/** 追加一条评分记录（保留最近 200 条，原子写）。 */
export function appendHistory(workspace, record) {
  const path = historyPath(workspace)
  const runs = [...readHistory(workspace), record].slice(-200)
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify({ version: 1, runs }, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/**
 * 完整性评分（0–100）：依赖图与证据链的健康度。
 * 扣分项全部可解释（reason + points），不做黑箱打分——**评分低不等于证明错，等于「经不起考验」**。
 */
/**
 * 把 `postulates` 参数规范化：`[{name, kind, reason}]`，丢弃空项，kind 非法直接报错。
 * @returns {Array<{name:string,kind:string,reason:string|undefined}>|undefined}
 */
export function normalizePostulates(value) {
  if (!Array.isArray(value) || value.length === 0) return undefined
  const out = []
  for (const raw of value) {
    const name = String(raw?.name ?? '').trim()
    if (name === '') throw new Error('proof_dag: `postulates[].name` required')
    const kind = String(raw?.kind ?? '').trim()
    if (!POSTULATE_KINDS.includes(kind)) {
      throw new Error(`proof_dag: invalid postulate kind "${kind}" (expected ${POSTULATE_KINDS.join(' | ')})`)
    }
    out.push({ name, kind, reason: typeof raw?.reason === 'string' && raw.reason.trim() !== '' ? raw.reason.trim() : undefined })
  }
  return out
}

/**
 * `proven` 门禁：模块里的每个 postulate 都必须被声明种类。
 *   · 有未声明 → 拒绝（「用公理冒充证明」不允许静默）
 *   · 有 kind:"gap" → 拒绝（真缺口不能标 proven）
 * 返回 null 表示放行，否则返回拒绝理由。
 */
export function postulateGate(workspace, moduleName, declarations) {
  const mod = String(moduleName ?? '').trim()
  if (mod === '') return null
  const text = moduleText(workspace, mod)
  if (text === null) return null
  const inModule = postulateNames(text)
  if (inModule.length === 0) return null
  const declared = new Map((Array.isArray(declarations) ? declarations : []).map((p) => [String(p?.name ?? ''), p]))
  const gaps = inModule.filter((n) => declared.get(n)?.kind === 'gap')
  if (gaps.length > 0) {
    return `模块 \`${mod}\` 里这些 postulate 被声明为 **真缺口（gap）**，不能标 proven：${gaps.map((g) => `\`${g}\``).join('、')}——要么补证，要么标 blocked 并写 diagnosis`
  }
  const backed = rewritePostulateNames(text)
  const unbacked = inModule.filter((n) => declared.get(n)?.kind === 'rewrite' && !backed.has(n))
  if (unbacked.length > 0) {
    return (
      `模块 \`${mod}\` 里 ${unbacked.map((g) => `\`${g}\``).join('、')} 被声明为 \`rewrite\`，但源码里**没有对应的 \`{-# REWRITE … #-}\` 指令**。` +
      '`rewrite` 必须是项目实际生效的重写规则（有语法依据）；没有依据的就是真缺口（`gap`，不能 proven）或 `unreachable`。**豁免不能自己发给自己。**'
    )
  }
  const undeclared = inModule.filter((n) => !declared.has(n))
  if (undeclared.length > 0) {
    return (
      `模块 \`${mod}\` 含 postulate ${undeclared.map((g) => `\`${g}\``).join('、')}，台账未声明种类。` +
      '标 proven 前必须逐个声明：`postulates:[{name,kind,reason}]`，kind ∈ rewrite（项目已论证的 REWRITE 语义设计）/ unreachable（Agda 强制检查下的已知无害项）/ gap（真缺口，不能 proven）。' +
      '声明豁免还要有一条人类裁决流水（`journal` 的 decision 条目，node 指向本节点）'
    )
  }
  return null
}

export function diagnose(nodes, journal, workspace, witness = null, rules = RULESET, untracked = null) {
  const DRIFT_RULES = rules.DRIFT ?? RULESET.DRIFT
  const W = rules.SCORE ?? RULESET.SCORE
  const { order, cyclic } = topoOrder(nodes)
  const dangling = Object.entries(nodes)
    .flatMap(([id, n]) => (n.deps ?? []).filter((d) => !Object.hasOwn(nodes, d)).map((d) => `${id} → ${d}`))
  const unowned = Object.keys(nodes).filter((id) => nodes[id].state === 'active' && nodes[id].owner === undefined)
  // 证据分三档：工具回执（可验证）/ 无回执声明（模型自报）/ 无证据
  const provenIds = Object.keys(nodes).filter((id) => nodes[id].state === 'proven')
  const noEvidence = []
  const unverified = []
  const staleReceipts = []
  let verifiedCount = 0
  for (const id of provenIds) {
    const n = nodes[id]
    const mod = String(n.module ?? '').trim()
    const text = mod === '' ? '' : moduleText(workspace, mod)
    if (n.evidenceReceipt !== undefined) {
      const v = verifyReceipt(n.evidenceReceipt, text === null ? '' : text)
      if (v.ok) {
        verifiedCount++
        continue
      }
      staleReceipts.push(`${id}（${v.why}）`)
      unverified.push(id)
      continue
    }
    if (String(n.evidence ?? '').trim() === '') noEvidence.push(id)
    else unverified.push(id)
  }
  const undiagnosed = Object.keys(nodes)
    .filter((id) => (nodes[id].state === 'refuted' || nodes[id].state === 'blocked') && nodes[id].diagnosis === undefined)
    .sort()
  const missingModules = []
  const drift = []
  const transitiveDeps = []
  const unregisteredImports = []
  // `extends:X` 是**结构性依赖**：X 被用于构造本对象，按依赖参与断链核对
  // （让对象层的关系反过来喂养依赖图，而不是两套说法各说各话）
  const declaredDepsOf = (n) => {
    const out = new Set(n.deps ?? [])
    for (const r of n.relations ?? []) {
      const [k, ...rest] = String(r).split(':')
      if (DRIFT_RULES.structuralRelationPrefixes.includes(k)) out.add(rest.join(':'))
    }
    return [...out]
  }
  for (const [id, n] of Object.entries(nodes)) {
    const mod = String(n.module ?? '').trim()
    if (mod === '') continue
    const rel = `${mod.replace(/\./g, '/')}.agda`
    if (!existsSync(join(workspace, 'src', rel)) && !existsSync(join(workspace, rel))) {
      missingModules.push(`${id} → ${mod}`)
      continue
    }
    const { imports } = moduleImports(workspace, mod)
    const depModules = declaredDepsOf(n)
      .map((d) => String(nodes[d]?.module ?? '').trim())
      .filter((x) => x !== '')
    for (const dm of depModules) {
      // 同模块豁免：节点声明依赖的模块就是它自己的模块（对象节点常见）→ 不是断链
      if (DRIFT_RULES.exemptSameModule && dm === mod) continue
      if (imports.includes(dm)) continue
      // 传递依赖不算断链：`NSE.T13` 声明 3 个模块，其模块只 import NSEPresentation，
      // 而 NSEPresentation 再 import 那 3 个——这是**传递依赖**，不是纸面依赖。
      if (transitivelyImports(workspace, mod, dm, DRIFT_RULES.transitiveDepth)) {
        transitiveDeps.push(`${id} → \`${dm}\`（经 ${mod} 的传递 import）`)
        continue
      }
      drift.push(`${id} 声明依赖 \`${dm}\`，但 ${mod} 既未直接也未传递 import`)
    }
    const registered = new Set(depModules)
    for (const imp of new Set(imports)) {
      if (!imp.startsWith('Sovereign.') || registered.has(imp)) continue
      // 分两种：目标**已是台账节点**却没登记为依赖 = 真遗漏；
      // 目标**没有节点** = 未登记模块（台账不可能对不存在的东西声明依赖），单独报告
      if (Object.values(nodes).some((x) => String(x.module ?? '').trim() === imp)) {
        drift.push(`${id} 的 ${mod} import 了 \`${imp}\`，但台账未登记该依赖`)
      } else {
        unregisteredImports.push(`${id} 的 ${mod} import 了 \`${imp}\`（该模块尚无台账节点）`)
      }
    }
  }
  // 信息完整对象层：object 节点必须带 construction，并尽量给 relations
  const objectIds = Object.keys(nodes).filter((id) => nodes[id].kind === 'object')
  const objectNoConstruction = objectIds.filter((id) => String(nodes[id].construction ?? '').trim() === '')
  const objectNoRelations = objectIds.filter((id) => !Array.isArray(nodes[id].relations) || nodes[id].relations.length === 0)
  const objectNoCarrier = objectIds.filter((id) => String(nodes[id].carrier ?? '').trim() === '')
  const objectNoOps = objectIds.filter((id) => !Array.isArray(nodes[id].operations) || nodes[id].operations.length === 0)
  const kindCount = {}
  for (const n of Object.values(nodes)) {
    const k = n.kind ?? 'lemma'
    kindCount[k] = (kindCount[k] ?? 0) + 1
  }
  // 编译预算闸门：同一模块累计失败 ≥3 次 → 必须委托，不许继续 whack-a-mole
  const compileBudget = []
  for (const [id, n] of Object.entries(nodes)) {
    const mod = String(n.module ?? '').trim()
    if (mod === '') continue
    const h = compileHistory(mod)
    if (h.failures >= 3) compileBudget.push({ id, module: mod, ...h })
  }
  // 先算后验证闸门：oracle 覆盖（回执存在 + exit 0 + 覆盖完整 + 脚本未改）
  const noOracle = []
  const staleOracle = []
  let oracleVerified = 0
  for (const [id, n] of Object.entries(nodes)) {
    if (n.oracle === undefined) {
      if (n.state === 'active') noOracle.push(id)
      continue
    }
    const r = readOracleReceipt(n.oracle)
    const scriptText = r !== null && typeof r.script === 'string' && existsSync(r.script) ? readFileSync(r.script, 'utf8') : ''
    const v = verifyOracleReceipt(n.oracle, scriptText)
    if (v.ok) oracleVerified++
    else staleOracle.push(`${id}（${v.why}）`)
  }
  // ── postulate 分类（回答「proven 是否要求 0 postulate」）─────────────────
  // 口径：模块可以有 postulate，但**每一个**都必须在台账里声明种类与理由；
  //   rewrite / unreachable = 项目已论证的语义设计（如 REWRITE 规则族），仍需人类裁决一次；
  //   gap                  = 真缺口 → 该节点不能是 proven。
  // 未声明的 postulate 按「用公理冒充证明」重罚。
  const POST = rules.POSTULATE ?? RULESET.POSTULATE
  const postulateDeclared = []
  const postulateUndeclared = []
  /** 只有 **proven** 节点的未声明才扣分（blocked 节点本来就该带着缺口） */
  const postulateUndeclaredProven = []
  /** 声明为 rewrite、但源码里没有对应 REWRITE 指令（自封豁免） */
  const postulateUnbackedRewrite = []
  const postulatePhantom = []
  const gapDeclaredProven = []
  const postulateRulings = []
  for (const [id, n] of Object.entries(nodes)) {
    const mod = String(n.module ?? '').trim()
    if (mod === '') continue
    const text = moduleText(workspace, mod)
    if (text === null) continue
    const inModule = postulateNames(text)
    const rewriteBacked = rewritePostulateNames(text)
    const declared = new Map((Array.isArray(n.postulates) ? n.postulates : []).map((p) => [String(p?.name ?? ''), p]))
    for (const name of inModule) {
      const p = declared.get(name)
      if (p === undefined) {
        postulateUndeclared.push(`${id}: \`${name}\`（${mod} 的 postulate，台账未声明种类）`)
        if (n.state === 'proven') postulateUndeclaredProven.push(`${id}: \`${name}\``)
        continue
      }
      const kind = String(p.kind ?? '')
      postulateDeclared.push(`${id}: \`${name}\` = ${kind}${kind === 'rewrite' ? (rewriteBacked.has(name) ? '（源码有 REWRITE ✅）' : '（⚠ 源码**没有** REWRITE 指令）') : ''}`)
      if (kind === 'rewrite' && !rewriteBacked.has(name)) postulateUnbackedRewrite.push(`${id}: \`${name}\``)
      if (kind === 'gap' && n.state === 'proven') gapDeclaredProven.push(`${id}: \`${name}\``)
    }
    // 声明了模块里并不存在的 postulate = 记录不实，也要报
    for (const [name] of declared) if (name !== '' && !inModule.includes(name)) postulatePhantom.push(`${id}: 声明了 \`${name}\`，但 ${mod} 里没有这个 postulate`)
    if (declared.size > 0 && POST.requireHumanRuling) {
      const ruled = journal.some((e) => e.kind === 'decision' && e.node === id)
      if (!ruled) postulateRulings.push(`${id}（${declared.size} 个已声明豁免，无人类裁决流水）`)
    }
  }
  // ── 工作区草稿/探针文件（诊断用过的临时件不该留在库里）──────────────────
  const scratch = scratchFiles(workspace, rules.SCRATCH ?? RULESET.SCRATCH, untracked)
  // 编译热点：时间花在哪，用回执里的 wallMs 说话
  const hotspots = compileHotspots(3)
  const openDecisions = journal.filter((e) => e.kind === 'decision' && e.open === true)
  const deductions = []
  const add = (reason, points) => {
    if (points > 0) deductions.push({ reason, points })
  }
  add(`环 ${cyclic.length} 个（拓扑序不可定义）`, cyclic.length === 0 ? 0 : W.cyclic)
  add(`悬空依赖 ${dangling.length} 条`, dangling.length === 0 ? 0 : W.dangling)
  add(`proven 无证据 ${noEvidence.length} 个`, Math.min(W.provenNoEvidenceCap, noEvidence.length * W.provenNoEvidence))
  add(`未验证声明（无回执/回执失效）${unverified.length} 个`, Math.min(W.unverifiedCap, unverified.length * W.unverified))
  add(`模块文件缺失 ${missingModules.length} 个`, Math.min(W.missingModuleCap, missingModules.length * W.missingModule))
  add(`台账↔代码断链 ${drift.length} 条`, Math.min(W.driftCap, drift.length * W.driftPer))
  add(`待人类裁决 ${openDecisions.length} 条`, Math.min(W.openDecisionCap, openDecisions.length * W.openDecision))
  add(`失败未诊断 ${undiagnosed.length} 个`, Math.min(W.undiagnosedCap, undiagnosed.length * W.undiagnosed))
  add(`active 无 owner ${unowned.length} 个`, Math.min(W.unownedCap, unowned.length * W.unowned))
  add(
    `proven 但模块含**未声明** postulate ${postulateUndeclaredProven.length} 个`,
    Math.min(W.undeclaredPostulateCap, postulateUndeclaredProven.length * W.undeclaredPostulatePer),
  )
  add(`自封 rewrite 豁免（源码无 REWRITE 指令）${postulateUnbackedRewrite.length} 个`, Math.min(W.unverifiedCap, postulateUnbackedRewrite.length * W.unverified))
  add(`声明为真缺口仍标 proven ${gapDeclaredProven.length} 个`, gapDeclaredProven.length * W.declaredGapProven)
  add(`postulate 豁免待人类裁决 ${postulateRulings.length} 个`, Math.min(W.openDecisionCap, postulateRulings.length * W.openDecision))
  add(`声明了不存在的 postulate ${postulatePhantom.length} 个`, Math.min(W.unverifiedCap, postulatePhantom.length * W.unverified))
  if (witness !== null && witness.available === true) {
    add('git 见证：历史被改写（删/回退提交）', witness.rewritten === true ? W.witnessRewritten : 0)
    add('git 见证：提交数倒退', witness.shrunk === true ? W.witnessShrunk : 0)
    add('git 见证：工作树有未提交改动', witness.dirty === true ? W.witnessDirty : 0)
    add('git 见证：reflog 出现 reset/amend 痕迹', witness.suspicious === true ? W.witnessSuspicious : 0)
  }
  const penalty = deductions.reduce((n, d) => n + d.points, 0)
  return {
    score: Math.max(0, 100 - penalty),
    deductions,
    order,
    cyclic,
    dangling,
    unowned,
    noEvidence,
    unverified,
    staleReceipts,
    verifiedCount,
    totalProven: provenIds.length,
    undiagnosed,
    missingModules,
    drift,
    transitiveDeps,
    unregisteredImports,
    openDecisions,
    compileBudget,
    objectIds,
    objectNoConstruction,
    objectNoCarrier,
    objectNoOps,
    objectNoRelations,
    kindCount,
    noOracle,
    staleOracle,
    oracleVerified,
    hotspots,
    postulateDeclared,
    postulateUndeclared,
    postulateUndeclaredProven,
    postulateUnbackedRewrite,
    postulatePhantom,
    gapDeclaredProven,
    postulateRulings,
    scratch,
    scratchChecked: untracked !== null,
  }
}

/**
 * 从 Agda 源码里扫 `postulate` 块里的名字（启发式，不是解析器）。
 * 只认「单独一行 `postulate` + 缩进更深、形如 `名字 :` 的行」这种标准写法；
 * 输出会标注这是启发式扫描，扫不到的写法请显式声明。
 */
export function postulateNames(text) {
  const lines = String(text ?? '').split('\n')
  const found = []
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*postulate\s*$/.test(lines[i])) continue
    const base = /^\s*/.exec(lines[i])[0].length
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '') continue
      const indent = /^\s*/.exec(line)[0].length
      if (indent <= base) break
      // Agda 标识符含大量 Unicode 字母（`gf3Toℕ-A4-inv`、`φ-respects`）→ 必须用 Unicode 属性类，
      // 否则真实库里的 postulate 会被漏扫（本库 T6 的第三个名字就是这样漏掉的）
      const m = /^\s*(?:\{[^}]*\}\s*)?([\p{L}_][\p{L}\p{N}_'₀-₉-]*)\s*:/u.exec(line)
      if (m !== null) found.push(m[1])
    }
  }
  return [...new Set(found)]
}

/**
 * 工作区草稿/探针文件（相对路径；跳过 `_build` `.git` 等）。
 * @param {Set<string>|null} untracked `git status --porcelain` 得到的未跟踪集合；
 *   **非 null 时只报未跟踪的**（被跟踪的 `test/_test_*.agda` 是有意保留的真实模块，不是草稿）；
 *   null 表示没核对（非 git 仓库 / 无 shell）→ 调用方必须标注「未核对」。
 */
/**
 * 模块里**有 `{-# REWRITE <name> #-}` 语法支持**的记号集合。
 * 这是「声明为 rewrite」的**源码依据**：光在台账里写 `kind:"rewrite"` 不算，
 * 模块里必须真有那条 REWRITE 指令——否则就是自己给自己发豁免，工具拒收。
 */
export function rewritePostulateNames(text) {
  const out = new Set()
  for (const m of String(text ?? '').matchAll(/\{-#\s*REWRITE\s+([\p{L}_][\p{L}\p{N}_'₀-₉-]*)\s*#-\}/gu)) out.add(m[1])
  return out
}

export function scratchFiles(workspace, spec = RULESET.SCRATCH, untracked = null) {
  const skip = new Set(['_build', '.git', 'node_modules', 'dist-newstyle', '.stack-work', '.agdai'])
  const hits = []
  const walk = (dir, depth) => {
    if (depth > (spec.maxDepth ?? 4)) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (skip.has(e.name)) continue
        walk(join(dir, e.name), depth + 1)
        continue
      }
      if (!spec.patterns.some((re) => re.test(e.name))) continue
      const rel = join(dir, e.name).slice(workspace.length + 1).split('\\').join('/')
      if (spec.allow.includes(rel)) continue
      if (untracked !== null && !untracked.has(rel)) continue
      hits.push(rel)
    }
  }
  for (const root of spec.roots) walk(join(workspace, root), 0)
  return [...new Set(hits)].sort()
}

/** 趋势行：与上一条记录比较。 */
export function trendLine(history) {
  if (history.length === 0) return '首跑 — 无趋势数据'
  const lastRun = history[history.length - 1]
  const last = lastRun.score
  if (history.length === 1) return `首跑 ${last}/100`
  const prevRun = history[history.length - 2]
  // **跨规则集的分数不可比**：判定规则（断链豁免、评分权重、postulate 口径）一改，
  // 同样的台账会算出不同分数。历史里记了 `ruleset`，比较前先看它——否则会把「换规则」
  // 误报成「回退」（2026-09-10 真事故：旧规则算 85 分，被记成「回退（上次 100）」）。
  if (lastRun.ruleset !== prevRun.ruleset) {
    const from = prevRun.ruleset ?? 'legacy（早于规则集戳）'
    const to = lastRun.ruleset ?? 'legacy（早于规则集戳）'
    return `跨规则集不可比（${from} → ${to}）：${prevRun.score}/100 → ${last}/100，请按规则集切开看`
  }
  const prev = prevRun.score
  const delta = last - prev
  if (delta === 0) return `稳定在 ${last}/100（最近 ${Math.min(history.length, 3)} 次）`
  return `${prev} → ${last}（${delta > 0 ? '+' : ''}${delta}）最近 ${Math.min(history.length, 3)} 次`
}

/** 上一次记录是否用了**不同**的规则集（用于避免假回退）。 */
export function rulesetChangedSinceLastRun(history, current) {
  if (history.length === 0 || current === undefined) return null
  const last = history[history.length - 1]
  // 旧记录没有规则集戳（本字段是后加的）→ 同样不可比，但原因不同：叫「legacy」而不是某个版本号
  if (last.ruleset === undefined) return { from: 'legacy（该记录早于规则集戳）', to: current, prevScore: last.score, legacy: true }
  return last.ruleset === current ? null : { from: last.ruleset, to: current, prevScore: last.score, legacy: false }
}

/** 读某模块的源码文本（找不到返回 null）。 */
export function moduleText(workspace, moduleName) {
  const rel = `${String(moduleName).replace(/\./g, '/')}.agda`
  for (const base of [join(workspace, 'src', rel), join(workspace, rel)]) {
    if (existsSync(base)) return readFileSync(base, 'utf8')
  }
  return null
}

/**
 * 传递 import 判定：`from` 是否经 import 链可达 `target`（深度上限防环/防爆）。
 * 结果按 `from` 缓存；只读工作区源码，不写任何东西。
 */
const transitiveCache = new Map()
export function transitivelyImports(workspace, from, target, maxDepth = 8) {
  if (from === target) return true
  const key = `${workspace}\u0000${from}`
  let seen = transitiveCache.get(key)
  if (seen === undefined) {
    // BFS 到上限，收集可达集合
    const visited = new Set([from])
    let frontier = [from]
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next = []
      for (const m of frontier) {
        const { found, imports } = moduleImports(workspace, m)
        if (!found) continue
        for (const imp of imports) {
          if (visited.has(imp)) continue
          visited.add(imp)
          next.push(imp)
        }
      }
      frontier = next
    }
    seen = visited
    transitiveCache.set(key, seen)
  }
  return seen.has(target)
}

/** 渲染节点表。 */
/**
 * 渲染分解方案（`plan` 的报告）。
 * 表格列固定：义务 / 为什么 / **怎么验证** / 依赖——「怎么验证」是分解纪律，不许空着。
 */
function renderPlan({ goalId, statement, items, verdict, notes, committed }) {
  const lines = []
  lines.push(`# proof_dag: plan${committed === true ? '（已落盘）' : ''}`)
  lines.push('')
  lines.push(`- 目标: \`${goalId}\` — ${statement === '' ? '（未给 statement：按调用方给的 items 校验）' : statement.slice(0, 200)}`)
  lines.push(`- 义务: **${items.length}** 条（全部 \`pending\`——分解阶段不产生结论）`)
  lines.push('')
  if (verdict.problems.length > 0) {
    lines.push('## ❌ 阻断问题（先修这些）')
    for (const p of verdict.problems) lines.push(`- ${p}`)
    lines.push('')
  }
  if (verdict.warnings.length > 0) {
    lines.push('## ⚠ 提醒')
    for (const w of verdict.warnings) lines.push(`- ${w}`)
    lines.push('')
  }
  lines.push('| # | id | 义务（可验证命题） | 为什么需要 | 怎么验证 | 依赖 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const [i, it] of items.slice(0, MAX_TABLE_ROWS).entries()) {
    const dep = (it.deps ?? []).length === 0 ? '—' : (it.deps ?? []).join(', ')
    lines.push(`| ${i + 1} | \`${it.id}\` | ${String(it.statement ?? '').slice(0, 90)} | ${String(it.why ?? '').slice(0, 40)} | ${String(it.verify ?? '').slice(0, 60)} | ${dep.slice(0, 60)} |`)
  }
  if (items.length > MAX_TABLE_ROWS) {
    lines.push('')
    lines.push(`（其余 ${items.length - MAX_TABLE_ROWS} 条未显示）`)
  }
  lines.push('')
  if (notes.length > 0) {
    lines.push('## 形状说明（这些形状最容易漏什么）')
    for (const n of notes) lines.push(n)
    lines.push('')
  }
  lines.push('## 诚实边界')
  for (const d of PLAN_DISCLAIMER) lines.push(`- ${d}`)
  lines.push('')
  lines.push(
    verdict.ok
      ? committed === true
        ? '- 下一步：`proof_dag action:"next"` 看待开工的叶子义务；每条拿到 `proof_compile` 回执后用 `update` 标 `proven`。'
        : '- 下一步：确认无误后带 `commit: true` 再跑一次即可落盘（**先看后写**：默认不写台账）。'
      : '- 先修完上面的阻断问题（缺 `verify` / 悬空依赖 / 成环 / 自带结论 / 没有组合节点），再考虑落盘。',
  )
  return lines.join('\n')
}

function renderTable(nodes) {
  const all = Object.keys(nodes).sort()
  if (all.length === 0) return '（台账为空）'
  // 截断只丢「已完成」的节点：关键状态（待复核/卡住/进行中）永远排在前面
  const priority = { needs_review: 0, blocked: 1, active: 2, pending: 3, refuted: 4, proven: 5, abandoned: 6 }
  const ranked = [...all].sort((a, b) => {
    const pa = priority[nodes[a]?.state] ?? 9
    const pb = priority[nodes[b]?.state] ?? 9
    return pa === pb ? a.localeCompare(b) : pa - pb
  })
  const ids = ranked.slice(0, MAX_TABLE_ROWS)
  const lines = ['| id | 状态 | owner | 依赖 | 陈述 |', '| --- | --- | --- | --- | --- |']
  for (const id of ids) {
    const n = nodes[id]
    const deps = (n.deps ?? []).map((d) => `${d}${nodes[d]?.state === 'proven' ? '✅' : '⏳'}`).join(', ') || '—'
    const stmt = String(n.statement ?? '').replace(/\|/g, '\\|').slice(0, 60)
    lines.push(`| \`${id}\` | ${n.state} | ${n.owner ?? '—'} | ${deps} | ${stmt} |`)
  }
  if (all.length > ids.length) {
    lines.push(`| … | | | | 另有 ${all.length - ids.length} 条（完整表见台账文件） |`)
  }
  return lines.join('\n')
}

/**
 * 执行一次台账操作。
 * @param workspace - session workspace（分桶键）。
 * @param args - `{ action, node?, id?, state?, owner?, note?, evidence?, statement?, deps? }`。
 */
export async function runDag(workspace, args, runtime, exec) {
  const raw = args?.action
  const action = typeof raw === 'string' && raw !== '' ? raw : 'list'
  const hasShell = runtime?.shell !== undefined
  // 规则来自**进程内静态 import**（冷档）：不再动态重载，改了规则必须重启进程
  const diskHash = RULESET.moduleHash(RULESET.RULESET_PATH)
  const live = { version: RULESET.RULESET_VERSION, hash: LOADED_RULESET.hash, diskHash }
  const rulesetLine = `- 规则集: \`${live.version}/${live.hash ?? 'unknown'}\`${
    diskHash !== null && diskHash !== live.hash ? ' ⚠ **磁盘上的规则与进程内不同**（改规则后需**重启 dsh 进程**才生效）' : ''
  }`
  if (action === 'doctor') return renderDoctor(workspace, live)
  // check / brief 先取见证状态（读操作，不持锁），让它进入评分与简报
  const witness = (action === 'check' || action === 'brief') && hasShell ? await witnessStatus(runtime, exec, workspace) : null
  // 草稿文件核对需要「未跟踪」集合：被跟踪的文件不是草稿（本项目 test/_test_*.agda 是有意保留的真实模块）
  const untracked = (action === 'check' || action === 'brief') && hasShell ? await untrackedFiles(runtime, exec, workspace) : null
  // 读-改-写整体串行化：并发 fan-out 下不会丢节点。
  const report = withLedgerLock(workspace, () => runDagLocked(workspace, args, witness, live, untracked))
  // 版本戳**任何路径都要带上**（包括没有 shell 的只读场景）——引用分数必须能看到适用范围
  const stamped = `${report}\n${rulesetLine}`
  if (!hasShell) return stamped
  const MUTATING = ['init', 'add', 'update', 'journal']
  if (MUTATING.includes(action)) {
    // 见证节流：非关键变更在 20s 内合并到下一次提交，避免高频小改动把仓库撑爆。
    // 关键变更（init / journal / 终态或诊断）永远立即提交——篡改检测的粒度靠它们保证。
    const terminal = new Set(['proven', 'refuted', 'blocked', 'needs_review'])
    const critical =
      action === 'init' ||
      action === 'journal' ||
      (action === 'update' && (terminal.has(String(args?.state ?? '')) || args?.diagnosis !== undefined || args?.receipt !== undefined)) ||
      (action === 'add' && terminal.has(String(args?.node?.state ?? '')))
    if (!critical && existsSync(checkpointPath(workspace))) {
      try {
        const last = JSON.parse(readFileSync(checkpointPath(workspace), 'utf8'))
        const age = Date.now() - Date.parse(String(last.at ?? ''))
        if (Number.isFinite(age) && age < 20000) {
          return `${stamped}\n\n- git 见证: ⏱ 20s 内已提交过一次，本次合并到下一次（关键变更不受节流影响）`
        }
      } catch {
        /* 检查点损坏：照常提交 */
      }
    }
    const ledger = readLedger(workspace)
    const label = `${action} ${args?.id ?? args?.node?.id ?? ''}`.trim()
    const w = await witnessCommit(runtime, exec, workspace, ledger, `math-proof: ${label}`)
    if (w === null) return `${stamped}\n\n- git 见证: ⚠ 提交失败（见证不可用；台账已写入）`
    writeCheckpoint(workspace, w)
    return `${stamped}\n\n- git 见证: \`${w.head.slice(0, 8)}\`（第 ${w.count} 次提交）`
  }
  if (witness !== null) {
    // 节流可能留下未提交的台账快照：读操作顺手补齐（保证「最终一致」，不靠定时器）
    if (witness.available === true && witness.dirty === true) {
      const ledger = readLedger(workspace)
      const w = await witnessCommit(runtime, exec, workspace, ledger, 'math-proof: flush (read-time catch-up)')
      if (w !== null) writeCheckpoint(workspace, w)
    }
    return `${stamped}\n${renderWitness(witness)}`
  }
  return stamped
}

/**
 * 工作区**未跟踪**文件集合（`git status --porcelain` 的 `??` 行）。
 * 非 git 仓库 / git 不可用 / 被沙箱拒绝 → 返回 null（调用方标注「未核对」，绝不假装准确）。
 */
async function untrackedFiles(runtime, exec, workspace) {
  try {
    const r = await git(runtime, exec, workspace, 'git status --porcelain --untracked-files=all')
    if (r.code !== 0) return null
    const out = new Set()
    for (const line of r.out.split('\n')) {
      if (!line.startsWith('?? ')) continue
      // 未跟踪目录会以 `dir/` 结尾：展开成目录本身（我们只按文件比，命中不了就退化为不报）
      out.add(line.slice(3).trim().replace(/^"|"$/g, ''))
    }
    return out
  } catch {
    return null
  }
}

/** 持锁执行的实现体。 */
function runDagLocked(workspace, args, witness = null, live = LOADED_LIVE_FALLBACK, untracked = null) {
  const raw = args?.action
  const action = typeof raw === 'string' && raw !== '' ? raw : 'list'
  const rules = live.rules ?? RULESET
  const ACTIONS = ['init', 'add', 'update', 'plan', 'import', 'search', 'list', 'next', 'check', 'brief', 'journal', 'graph', 'doctor']
  if (!ACTIONS.includes(action)) {
    throw new Error(`proof_dag: unknown action "${action}" (expected one of ${ACTIONS.join(' | ')})`)
  }
  const ledger = readLedger(workspace)
  const nodes = ledger.nodes
  const journal = ledger.journal ?? []

  if (action === 'init') {
    const path = writeLedger(ledger)
    return `# proof_dag: init\n\n- 台账: \`${path}\`\n- 节点数: ${Object.keys(nodes).length}\n- 状态机: ${STATES.join(' → ')}`
  }

  if (action === 'add') {
    const node = args?.node
    if (node === null || typeof node !== 'object') throw new Error('proof_dag add: `node` object required')
    const id = String(node.id ?? '').trim()
    if (id === '') throw new Error('proof_dag add: `node.id` required')
    if (typeof node.statement !== 'string' || node.statement.trim() === '') {
      throw new Error('proof_dag add: `node.statement` required（节点必须是可验证命题，不能是「证明 X」）')
    }
    if (Object.hasOwn(nodes, id)) throw new Error(`proof_dag add: node "${id}" already exists (use update)`)
    const state = node.state ?? 'pending'
    if (!STATES.includes(state)) throw new Error(`proof_dag add: invalid state "${state}"`)
    if (node.diagnosis !== undefined && node.diagnosis !== null && !DIAGNOSES.includes(node.diagnosis)) {
      throw new Error(`proof_dag add: invalid diagnosis "${node.diagnosis}" (expected ${DIAGNOSES.join(' | ')})`)
    }
    const kind = node.kind === undefined ? 'lemma' : String(node.kind)
    if (!NODE_KINDS.includes(kind)) throw new Error(`proof_dag add: invalid kind "${kind}" (expected ${NODE_KINDS.join(' | ')})`)
    if (kind === 'object' && String(node.construction ?? '').trim() === '') {
      throw new Error('proof_dag add: kind="object" 必须给 `construction`（由什么生成：载体 + 生成元 + 关系）——对象层不允许「只有公理」')
    }
    nodes[id] = {
      id,
      kind,
      construction: typeof node.construction === 'string' && node.construction.trim() !== '' ? node.construction.trim() : undefined,
      carrier: typeof node.carrier === 'string' && node.carrier.trim() !== '' ? node.carrier.trim() : undefined,
      operations: Array.isArray(node.operations) ? node.operations.map(String) : undefined,
      relations: Array.isArray(node.relations) ? node.relations.map(String) : undefined,
      statement: node.statement.trim(),
      deps: Array.isArray(node.deps) ? node.deps.map(String) : [],
      state,
      owner: typeof node.owner === 'string' ? node.owner : undefined,
      evidence: typeof node.evidence === 'string' ? node.evidence : undefined,
      note: typeof node.note === 'string' ? node.note : undefined,
      diagnosis: node.diagnosis ?? undefined,
      module: typeof node.module === 'string' && node.module.trim() !== '' ? node.module.trim() : undefined,
      postulates: normalizePostulates(node.postulates),
      source: typeof node.source === 'string' && node.source.trim() !== '' ? node.source.trim() : undefined,
      evidenceReceipt: typeof node.receipt === 'string' && node.receipt.trim() !== '' ? node.receipt.trim() : undefined,
      evidenceVerified: false,
      oracle: typeof node.oracle === 'string' && node.oracle.trim() !== '' ? node.oracle.trim() : undefined,
      oracleVerified: false,
      updatedAt: new Date().toISOString(),
    }
    // add 也校验 oracle 回执：必须存在、exit 0、覆盖完整、脚本未改
    if (nodes[id].oracle !== undefined) {
      const v = verifyOracleReceipt(nodes[id].oracle, '')
      if (!v.ok) throw new Error(`proof_dag add: oracle 回执无效（${v.why}）→ 用 \`proof_oracle\` 重跑`)
      nodes[id].oracleVerified = true
    }
    // add 也校验回执：伪造/过期的回执一律拒绝
    if (nodes[id].evidenceReceipt !== undefined) {
      const mod = String(nodes[id].module ?? '').trim()
      const text = mod === '' ? '' : moduleText(workspace, mod)
      const v = verifyReceipt(nodes[id].evidenceReceipt, text === null ? '' : text)
      if (!v.ok) {
        throw new Error(`proof_dag add: 回执无效（${v.why}）→ 先跑 \`proof_compile\` 拿新回执，不要手写 evidence`)
      }
      nodes[id].evidenceVerified = true
      const prevEv = String(nodes[id].evidence ?? '').trim()
      const stamp = `回执 \`${String(nodes[id].evidenceReceipt).slice(0, 12)}…\` exit 0（工具签发）`
      // 回执**追加**到已有证据之后，绝不覆盖人类/agent 写下的反例说明（信息不丢）
      nodes[id].evidence = prevEv === '' ? stamp : `${prevEv}；${stamp}`
    }
    if (nodes[id].state === 'proven') {
      const reason = postulateGate(workspace, nodes[id].module, nodes[id].postulates)
      if (reason !== null) throw new Error(`proof_dag add: ${reason}`)
    }
    writeLedger(ledger)
    const missing = nodes[id].deps.filter((d) => !Object.hasOwn(nodes, d))
    return [
      `# proof_dag: add \`${id}\``,
      '',
      `- 状态: ${state}`,
      `- 依赖: ${nodes[id].deps.join(', ') || '—'}${missing.length > 0 ? `  ⚠ 悬空: ${missing.join(', ')}` : ''}`,
      '',
      '## 台账',
      renderTable(nodes),
    ].join('\n')
  }

  if (action === 'update') {
    const id = String(args?.id ?? '').trim()
    if (id === '') throw new Error('proof_dag update: `id` required')
    if (!Object.hasOwn(nodes, id)) throw new Error(`proof_dag update: unknown node "${id}"`)
    if (args.diagnosis !== undefined && args.diagnosis !== null) {
      if (!DIAGNOSES.includes(args.diagnosis)) {
        throw new Error(`proof_dag update: invalid diagnosis "${args.diagnosis}" (expected ${DIAGNOSES.join(' | ')})`)
      }
      nodes[id].diagnosis = args.diagnosis
    }
    // 签名变更（陈述 / 依赖）→ 该节点及其下游 proven/active 全部退回 needs_review
    // （Goedel-Architect 的 blueprint refinement：上游签名改动使下游证明失效）
    // 签名变更 = 陈述变了，或**依赖集合发生实质变化**。
    // 「把模块本来就 import 的依赖补登记」属于**记账**，不使证明失效——
    // 否则机械修断链会把一批已证节点误降级（2026-09-10 实测发生）。
    let signatureChanged = args.statement !== undefined
    if (args.deps !== undefined) {
      if (!Array.isArray(args.deps)) throw new Error('proof_dag update: `deps` must be an array')
      const before = new Set(nodes[id].deps ?? [])
      const after = new Set(args.deps.map(String))
      const removed = [...before].filter((d) => !after.has(d))
      const mod = String(nodes[id].module ?? '').trim()
      const { imports } = mod === '' ? { imports: [] } : moduleImports(workspace, mod)
      const addedNotImported = [...after].filter((d) => !before.has(d)).filter((d) => {
        const dm = String(nodes[d]?.module ?? '').trim()
        return dm === '' || !imports.includes(dm)
      })
      signatureChanged = removed.length > 0 || addedNotImported.length > 0
    }
    const staleDependents = []
    if (signatureChanged) {
      if (nodes[id].state === 'proven' || nodes[id].state === 'active') {
        nodes[id].state = 'needs_review'
        staleDependents.push(id)
      }
      const reverse = new Map()
      for (const [nid, n] of Object.entries(nodes)) {
        for (const dep of n.deps ?? []) {
          if (!reverse.has(dep)) reverse.set(dep, [])
          reverse.get(dep).push(nid)
        }
      }
      const seen = new Set([id])
      const queue = [id]
      while (queue.length > 0) {
        const cur = queue.shift()
        for (const dep of reverse.get(cur) ?? []) {
          if (seen.has(dep)) continue
          seen.add(dep)
          queue.push(dep)
          if (nodes[dep].state === 'proven' || nodes[dep].state === 'active') {
            nodes[dep].state = 'needs_review'
            nodes[dep].note = `上游 \`${id}\` 的陈述/依赖已变更 → 需复核（blueprint refinement）`
            staleDependents.push(dep)
          }
        }
      }
    }
    if (args.state !== undefined) {
      if (!STATES.includes(args.state)) throw new Error(`proof_dag update: invalid state "${args.state}"`)
      // abandoned = 主动放弃（不删记录，保留理由）；必须写清为什么放弃
      if (args.state === 'abandoned' && String(args.note ?? '').trim() === '') {
        throw new Error('proof_dag update: state=abandoned 必须带 `note`（放弃理由）——记录不删，只标记')
      }
      nodes[id].state = args.state
    }
    if (args.owner !== undefined) nodes[id].owner = String(args.owner)
    if (args.evidence !== undefined) nodes[id].evidence = String(args.evidence)
    if (args.note !== undefined) nodes[id].note = String(args.note)
    if (args.module !== undefined) nodes[id].module = String(args.module)
    if (args.kind !== undefined) {
      if (!NODE_KINDS.includes(String(args.kind))) throw new Error(`proof_dag update: invalid kind "${args.kind}"`)
      nodes[id].kind = String(args.kind)
    }
    if (args.construction !== undefined) nodes[id].construction = String(args.construction)
    if (args.carrier !== undefined) nodes[id].carrier = String(args.carrier)
    if (args.operations !== undefined) {
      if (!Array.isArray(args.operations)) throw new Error('proof_dag update: `operations` must be an array')
      nodes[id].operations = args.operations.map(String)
    }
    if (args.relations !== undefined) {
      if (!Array.isArray(args.relations)) throw new Error('proof_dag update: `relations` must be an array')
      nodes[id].relations = args.relations.map(String)
    }
    if (nodes[id].kind === 'object' && String(nodes[id].construction ?? '').trim() === '') {
      throw new Error(`proof_dag update: 节点 \`${id}\` 是 object，必须保留 \`construction\``)
    }
    if (args.source !== undefined) nodes[id].source = String(args.source)
    if (args.receipt !== undefined) nodes[id].evidenceReceipt = String(args.receipt)
    if (args.oracle !== undefined) {
      const v = verifyOracleReceipt(String(args.oracle), '')
      if (!v.ok) throw new Error(`proof_dag update: oracle 回执无效（${v.why}）→ 用 \`proof_oracle\` 重跑`)
      nodes[id].oracle = String(args.oracle)
      nodes[id].oracleVerified = true
    }
    // 只有工具签发的回执能证明「已证」：回执必须存在、exit 0、且源码未变
    if (args.receipt !== undefined) {
      const mod = String(nodes[id].module ?? '').trim()
      const text = mod === '' ? '' : moduleText(workspace, mod)
      const v = verifyReceipt(String(args.receipt), text === null ? '' : text)
      if (!v.ok) {
        throw new Error(`proof_dag update: 回执无效（${v.why}）→ 先跑 \`proof_compile\` 拿新回执，不要手写 evidence`)
      }
      nodes[id].evidenceVerified = true
      const prevEv2 = String(nodes[id].evidence ?? '').trim()
      const stamp2 = `回执 \`${String(args.receipt).slice(0, 12)}…\` exit 0（工具签发）`
      // 同样追加，不覆盖既有证据文本
      nodes[id].evidence = prevEv2 === '' ? stamp2 : `${prevEv2}；${stamp2}`
    }
    if (args.postulates !== undefined) nodes[id].postulates = normalizePostulates(args.postulates)
    if (String(args.state ?? '') === 'proven') {
      const reason = postulateGate(workspace, args.module ?? nodes[id].module, nodes[id].postulates)
      if (reason !== null) throw new Error(`proof_dag update: ${reason}`)
    }
    if (args.statement !== undefined) nodes[id].statement = String(args.statement)
    if (args.deps !== undefined) nodes[id].deps = args.deps.map(String)
    nodes[id].updatedAt = new Date().toISOString()
    writeLedger(ledger)
    return [
      `# proof_dag: update \`${id}\``,
      '',
      `- 状态: ${nodes[id].state}${nodes[id].owner ? `（owner: ${nodes[id].owner}）` : ''}`,
      `- 诊断: ${nodes[id].diagnosis ?? '—'}${nodes[id].diagnosis === 'statement_wrong' ? '（陈述有误 → 修形式化，不要硬证）' : nodes[id].diagnosis === 'proof_too_hard' ? '（证明太难 → 拆子引理）' : ''}`,
      `- 证据: ${nodes[id].evidence ?? '—'}`,
      ...(staleDependents.length === 0 ? [] : ['', `## ⚠ 已退回 needs_review（${staleDependents.length}）`, ...staleDependents.map((s) => `- \`${s}\``)]),
      '',
      '## 可开工',
      schedulable(nodes).map((s) => `- \`${s}\``).join('\n') || '（无：等待依赖或全部终态）',
    ].join('\n')
  }

  if (action === 'next') {
    const ready = schedulable(nodes)
    const s = stats(nodes)
    return [
      '# proof_dag: next（当前可开工集合）',
      '',
      `- 进度: ${s.progress}%（proven ${s.proven} / refuted ${s.refuted} / active ${s.active} / pending ${s.pending} / blocked ${s.blocked} / needs_review ${s.needs_review}，共 ${s.total}）`,
      '',
      ready.length === 0
        ? '（无 pending 且依赖齐备的节点——要么已完成，要么被 blocked/needs_review 卡住）'
        : ready.map((id, i) => `${i + 1}. \`${id}\` — ${String(nodes[id].statement).slice(0, 80)}`).join('\n'),
      '',
      '> 调度规则：只派发依赖已 `proven` 的 `pending` 节点；一个节点同时只应有一个 owner。',
    ].join('\n')
  }

  if (action === 'check') {
    const d = diagnose(nodes, journal, workspace, witness, rules, untracked)
    const s = stats(nodes)
    const diag = { statement_wrong: 0, proof_too_hard: 0, none: 0 }
    for (const n of Object.values(nodes)) {
      if (n.diagnosis === 'statement_wrong') diag.statement_wrong++
      else if (n.diagnosis === 'proof_too_hard') diag.proof_too_hard++
      else if (n.state === 'refuted' || n.state === 'blocked' || n.state === 'needs_review') diag.none++
    }
    // 评分历史（长程趋势：证明链是在变强还是变弱）
    const history = readHistory(workspace)
    const record = {
      ts: new Date().toISOString(),
      // **规则集戳**：分数只有在同一规则集下才可比（改规则=改口径，不是退步）
      ruleset: `${live.version}/${live.hash ?? 'unknown'}`,
      score: d.score,
      blockers: d.cyclic.length + d.dangling.length + d.noEvidence.length,
      warnings: d.drift.length + d.openDecisions.length + d.undiagnosed.length,
      nodes: s.total,
      proven: s.proven,
    }
    const runs = [...history, record]
    appendHistory(workspace, record)
    const prev = history.length === 0 ? null : history[history.length - 1].score
    const switched = rulesetChangedSinceLastRun(history, record.ruleset)
    return [
      '# proof_dag: check',
      '',
      `- **完整性评分: ${d.score}/100**${
        switched !== null ? `（上次 ${switched.prevScore} 用的是规则集 \`${switched.from}\`）` : ''
      }${switched === null && prev !== null && d.score < prev ? `  ⚠ 回退（上次 ${prev}）` : ''}`,
      ...(switched === null ? [] : [`- ⚠ **规则集已变**：\`${switched.from}\` → \`${record.ruleset}\` —— 两次分数**不可直接比较**，本条不计入回退`]),
      `- 趋势: ${trendLine(runs)}`,
      ...(d.deductions.length === 0
        ? ['- 扣分: 无 ✅']
        : ['- 扣分:', ...d.deductions.map((x) => `  - ${x.reason}（−${x.points}）`)]),
      '',
      `- 节点: ${s.total}｜边: ${Object.values(nodes).reduce((n, x) => n + (x.deps ?? []).length, 0)}`,
      `- 环: ${d.cyclic.length === 0 ? '无 ✅' : `**${d.cyclic.length}** ❌ ${d.cyclic.join(', ')}`}`,
      `- 悬空依赖: ${d.dangling.length === 0 ? '无 ✅' : `**${d.dangling.length}** ❌ ${d.dangling.join('; ')}`}`,
      `- active 但无 owner: ${d.unowned.length === 0 ? '无 ✅' : `⚠ ${d.unowned.join(', ')}`}`,
      `- 证据可信度: ${d.verifiedCount}/${d.totalProven}（工具签发回执）${d.unverified.length === 0 ? ' ✅' : `｜⚠ 未验证 ${d.unverified.length}`}`,
      `- proven 但无证据: ${d.noEvidence.length === 0 ? '无 ✅' : `❌ ${d.noEvidence.join(', ')}（proven 必须有内核证据，否则只是声称）`}`,
      `- 未验证声明: ${d.unverified.length === 0 ? '无 ✅' : `⚠ ${d.unverified.join(', ')}（模型自报 evidence 不算数，须给 \`proof_compile\` 回执）`}`,
      ...(d.staleReceipts.length === 0 ? [] : [`- 回执失效: ❌ ${d.staleReceipts.join('; ')}`]),
      `- 模块文件缺失: ${d.missingModules.length === 0 ? '无 ✅' : `❌ ${d.missingModules.join('; ')}`}`,
      `- 台账↔代码断链: ${d.drift.length === 0 ? '无 ✅' : `⚠ ${d.drift.length} 条`}`,
      `- 传递依赖（不算断链）: ${d.transitiveDeps.length === 0 ? '无' : `${d.transitiveDeps.length} 条`}`,
      `- 未登记模块依赖（目标尚无节点，不计断链）: ${d.unregisteredImports.length === 0 ? '无 ✅' : `${d.unregisteredImports.length} 条`}`,
      `- 失败未诊断: ${d.undiagnosed.length === 0 ? '无 ✅' : `⚠ ${d.undiagnosed.join(', ')}`}`,
      `- 诊断: statement_wrong ${diag.statement_wrong} / proof_too_hard ${diag.proof_too_hard} / 未诊断 ${diag.none}`,
      `- 待裁决决策: ${d.openDecisions.length === 0 ? '无 ✅' : `⚠ ${d.openDecisions.length} 条`}｜流水: ${journal.length} 条`,
      `- 编译预算闸门: ${d.compileBudget.length === 0 ? '无超限 ✅' : `🛑 ${d.compileBudget.length} 个模块累计失败 ≥3 次 → 走批量修复协议（agda-proof-engine 技能 §5.9；若环境存在 loop-engineer 技能亦可委托，它不随本仓库分发）`}`,
      `- postulate 分类: ${
        d.postulateDeclared.length === 0 && d.postulateUndeclared.length === 0
          ? '无 postulate ✅'
          : `已声明 ${d.postulateDeclared.length}｜**未声明 ${d.postulateUndeclared.length}**（其中 proven 节点 ${d.postulateUndeclaredProven.length}）${
              d.postulateUndeclared.length === 0 ? ' ✅' : ' ⚠'
            }${
              d.postulateUnbackedRewrite.length === 0 ? '｜自封 rewrite 0 ✅' : `｜❌ 自封 rewrite（源码无 REWRITE 指令）: ${d.postulateUnbackedRewrite.join('; ')}`
            }${d.gapDeclaredProven.length === 0 ? '' : `｜❌ 真缺口却标 proven: ${d.gapDeclaredProven.join('; ')}`}${
              d.postulatePhantom.length === 0 ? '' : `｜⚠ 声明了不存在的: ${d.postulatePhantom.join('; ')}`
            }`
      }`,
      `- postulate 豁免裁决: ${d.postulateRulings.length === 0 ? '无待裁决 ✅' : `⚠ ${d.postulateRulings.length} 个（${d.postulateRulings.join('; ')}）→ 用 \`journal\` 记一条 decision（node 指向该节点）`}`,
      `- 工作区草稿/探针文件: ${
        !d.scratchChecked
          ? `未核对（工作区不是 git 仓库或 git 不可用）${d.scratch.length === 0 ? '' : `｜命名启发式候选: ${d.scratch.join(', ')}`}`
          : d.scratch.length === 0
            ? '无 ✅'
            : `⚠ ${d.scratch.join(', ')}（未跟踪的诊断草稿——用完删除；确有用途就在 journal 记一条说明）`
      }`,
      `- 对象信息完整度: ${d.objectIds.length === 0 ? '无 object 节点' : `${d.objectIds.length - new Set([...d.objectNoConstruction, ...d.objectNoRelations]).size}/${d.objectIds.length}`}（构造 ${d.objectIds.length - d.objectNoConstruction.length}｜载体 ${d.objectIds.length - d.objectNoCarrier.length}｜运算 ${d.objectIds.length - d.objectNoOps.length}｜关系 ${d.objectIds.length - d.objectNoRelations.length}）${d.objectNoConstruction.length === 0 && d.objectNoRelations.length === 0 ? ' ✅' : `｜⚠ 缺构造: ${d.objectNoConstruction.join(', ') || '—'}｜缺关系: ${d.objectNoRelations.join(', ') || '—'}`}`,
      `- 节点种类: ${Object.entries(d.kindCount).map(([k, v]) => `${k} ${v}`).join(' / ')}`,
      `- oracle 覆盖: ${d.oracleVerified} 个节点有有效 oracle 回执${d.noOracle.length === 0 ? ' ✅' : `｜⚠ active 未跑 oracle: ${d.noOracle.join(', ')}`}${d.staleOracle.length === 0 ? '' : `｜❌ 回执失效: ${d.staleOracle.join('; ')}`}`,
      ...(d.hotspots.length === 0 ? [] : ['- 编译热点（累计耗时 Top ' + d.hotspots.length + '）:', ...d.hotspots.map((h) => `  - \`${h.module}\`：${(h.totalMs / 1000).toFixed(1)}s / ${h.attempts} 次${h.failures > 0 ? `（失败 ${h.failures}）` : ''}｜单次最慢 ${(h.maxMs / 1000).toFixed(1)}s`)]),
      ...d.compileBudget.map((x) => `  - \`${x.id}\`（${x.module}）：失败 ${x.failures}/${x.attempts} 次｜累计 ${(x.totalMs / 1000).toFixed(1)}s`),
      `- 进度: ${s.progress}%（proven ${s.proven} / refuted ${s.refuted} / pending ${s.pending} / active ${s.active} / blocked ${s.blocked} / needs_review ${s.needs_review}）`,
      ...(d.drift.length === 0 ? [] : ['', '## 断链明细（依赖图必须经得起考验）', ...d.drift.slice(0, 8).map((x) => `- ${x}`), ...(d.drift.length > 8 ? [`- …另有 ${d.drift.length - 8} 条`] : [])]),
      '',
      '## 拓扑序（依赖优先）',
      d.order.length === 0
        ? '（空）'
        : [
            ...d.order.slice(0, MAX_ORDER_ROWS).map((id, i) => `${i + 1}. \`${id}\` [${nodes[id].state}]`),
            ...(d.order.length > MAX_ORDER_ROWS
              ? [
                  `…另有 ${d.order.length - MAX_ORDER_ROWS} 个节点（完整见台账）`,
                  // 被截掉但**还没完成**的节点必须点名，否则关键节点会被藏起来
                  ...(() => {
                    const hidden = d.order.slice(MAX_ORDER_ROWS).filter((id) => !['proven', 'refuted', 'abandoned'].includes(nodes[id].state))
                    return hidden.length === 0 ? [] : [`⚠ 被截断的未完成节点（${hidden.length}）：${hidden.slice(0, 20).map((id) => `\`${id}\`[${nodes[id].state}]`).join(', ')}${hidden.length > 20 ? ' …' : ''}`]
                  })(),
                ]
              : []),
          ].join('\n'),
      d.cyclic.length === 0 ? '' : `\n## 环内节点\n${d.cyclic.map((id) => `- \`${id}\``).join('\n')}`,
    ].join('\n')
  }

  if (action === 'brief') {
    const s = stats(nodes)
    const d = diagnose(nodes, journal, workspace, witness, rules, untracked)
    const ready = schedulable(nodes)
    const dependents = new Map()
    for (const [id, n] of Object.entries(nodes)) {
      for (const dep of n.deps ?? []) {
        if (!dependents.has(dep)) dependents.set(dep, [])
        dependents.get(dep).push(id)
      }
    }
    const roots = Object.keys(nodes).filter((id) => (dependents.get(id) ?? []).length === 0).sort()
    const { cyclic, dangling, noEvidence, undiagnosed, openDecisions } = d
    const blocked = Object.keys(nodes).filter((id) => nodes[id].state === 'blocked').sort()
    const review = Object.keys(nodes).filter((id) => nodes[id].state === 'needs_review').sort()
    const recent = journal.slice(-5).reverse()
    // 超期提醒：待裁决只增不减是负债；挂 ≥3 天标记 ⏰
    const nowMs = Date.now()
    const ageDays = (ts) => {
      const t = Date.parse(String(ts ?? ''))
      return Number.isFinite(t) ? Math.floor((nowMs - t) / 86400000) : null
    }
    const overdue = openDecisions.filter((e) => (ageDays(e.ts) ?? 0) >= 3)
    const next = []
    if (openDecisions.length > 0) {
      next.push(`先请人类裁决 ${openDecisions.length} 条未决决策（\`journal\` 可见），不要自行选边`)
      if (overdue.length > 0) next.push(`⏰ 其中 ${overdue.length} 条已挂 ≥3 天：**停下来问人**，不要绕过去继续做下游节点`)
    }
    if (cyclic.length > 0) next.push(`修环：${cyclic.join(', ')}（拓扑序不可定义）`)
    if (dangling.length > 0) next.push(`补悬空依赖：${dangling.join(', ')}`)
    if (noEvidence.length > 0) next.push(`给 ${noEvidence.join(', ')} 补内核证据（\`proof_compile\` exit 0），否则退回 active`)
    if (undiagnosed.length > 0) next.push(`给失败节点 ${undiagnosed.join(', ')} 落诊断（statement_wrong / proof_too_hard）`)
    if (review.length > 0) next.push(`复核 needs_review：${review.slice(0, 5).join(', ')}（上游签名变更后必须重验）`)
    if (next.length === 0 && ready.length > 0) next.push(`派发 \`${ready[0]}\`（依赖已 proven），一次只做一个节点，做完立刻记证据`)
    if (next.length === 0 && ready.length === 0) next.push('无可开工节点：要么全部终态（交付审计），要么补节点把目标拆细')
    return [
      '# proof_dag: brief（跨天接手简报）',
      '',
      `- 台账: \`${ledgerPath(workspace)}\`｜更新于 ${ledger.updatedAt ?? '—'}`,
      `- **完整性评分: ${d.score}/100**｜趋势: ${trendLine(readHistory(workspace))}`,
      ...(rulesetChangedSinceLastRun(readHistory(workspace), `${live.version}/${live.hash ?? 'unknown'}`) === null
        ? []
        : [
            `- ⚠ 上次记录用的是**另一个规则集**（${
              rulesetChangedSinceLastRun(readHistory(workspace), `${live.version}/${live.hash ?? 'unknown'}`).from
            }）→ 分数不可直接比较，别当成回退`,
          ]),
      `- 规则集: \`${live.version}/${live.hash ?? 'unknown'}\`｜插件本体: \`${LOADED_PLUGIN_HASH ?? 'unknown'}\`${
        RULESET.moduleHash(PLUGIN_FILE) === LOADED_PLUGIN_HASH ? '' : ' ⚠ **落后于磁盘**（跑 \`doctor\` 看详情）'
      }`,
      `- postulate: 已声明 ${d.postulateDeclared.length} / 未声明 ${d.postulateUndeclared.length}${
        d.postulateUndeclared.length === 0 ? ' ✅' : ' ⚠'
      }｜草稿文件 ${d.scratch.length === 0 ? '无 ✅' : `⚠ ${d.scratch.join(', ')}`}`,
      `- 证据可信度: ${d.verifiedCount}/${d.totalProven}（工具回执）${d.unverified.length === 0 ? ' ✅' : `｜⚠ 未验证 ${d.unverified.length}`}`,
      `- 编译预算闸门: ${d.compileBudget.length === 0 ? '无超限 ✅' : `🛑 ${d.compileBudget.map((x) => `${x.id}（失败 ${x.failures} 次）`).join('、')} → 走批量修复协议（agda-proof-engine §5.9；若环境存在 loop-engineer 技能亦可委托）`}`,
      `- oracle 覆盖: ${d.oracleVerified} 个节点有有效回执${d.noOracle.length === 0 ? ' ✅' : `｜⚠ active 未跑 oracle: ${d.noOracle.join(', ')}`}`,
      `- postulate 分类: ${
        d.postulateDeclared.length === 0 && d.postulateUndeclared.length === 0
          ? '无 postulate ✅'
          : `已声明 ${d.postulateDeclared.length}｜**未声明 ${d.postulateUndeclared.length}**（其中 proven 节点 ${d.postulateUndeclaredProven.length}）${
              d.postulateUndeclared.length === 0 ? ' ✅' : ' ⚠'
            }${
              d.postulateUnbackedRewrite.length === 0 ? '｜自封 rewrite 0 ✅' : `｜❌ 自封 rewrite（源码无 REWRITE 指令）: ${d.postulateUnbackedRewrite.join('; ')}`
            }${d.gapDeclaredProven.length === 0 ? '' : `｜❌ 真缺口却标 proven: ${d.gapDeclaredProven.join('; ')}`}${
              d.postulatePhantom.length === 0 ? '' : `｜⚠ 声明了不存在的: ${d.postulatePhantom.join('; ')}`
            }`
      }`,
      `- postulate 豁免裁决: ${d.postulateRulings.length === 0 ? '无待裁决 ✅' : `⚠ ${d.postulateRulings.length} 个（${d.postulateRulings.join('; ')}）→ 用 \`journal\` 记一条 decision（node 指向该节点）`}`,
      `- 工作区草稿/探针文件: ${
        !d.scratchChecked
          ? `未核对（工作区不是 git 仓库或 git 不可用）${d.scratch.length === 0 ? '' : `｜命名启发式候选: ${d.scratch.join(', ')}`}`
          : d.scratch.length === 0
            ? '无 ✅'
            : `⚠ ${d.scratch.join(', ')}（未跟踪的诊断草稿——用完删除；确有用途就在 journal 记一条说明）`
      }`,
      `- 对象信息完整度: ${d.objectIds.length === 0 ? '无 object 节点' : `${d.objectIds.length - new Set([...d.objectNoConstruction, ...d.objectNoRelations]).size}/${d.objectIds.length}`}${d.objectNoConstruction.length === 0 && d.objectNoRelations.length === 0 ? ' ✅' : '｜⚠ 有 object 缺构造或关系'}`,
      `- 进度: ${s.progress}%（proven ${s.proven} / refuted ${s.refuted} / pending ${s.pending} / active ${s.active} / blocked ${s.blocked} / needs_review ${s.needs_review}，共 ${s.total}）`,
      '',
      `## 目标（无下游依赖的节点，${roots.length}）`,
      roots.length === 0 ? '（空）' : roots.map((id) => `- \`${id}\` — ${String(nodes[id].statement).slice(0, 100)}`).join('\n'),
      '',
      `## 可开工（${ready.length}）`,
      ready.length === 0 ? '（无）' : ready.map((id) => `- \`${id}\` — ${String(nodes[id].statement).slice(0, 100)}`).join('\n'),
      '',
      '## 卡点',
      `- blocked: ${blocked.join(', ') || '无'}`,
      `- needs_review: ${review.join(', ') || '无'}`,
      `- 失败未诊断: ${undiagnosed.join(', ') || '无'}`,
      ...(review.length === 0 ? [] : review.slice(0, 5).map((id) => `  - \`${id}\`: ${String(nodes[id].note ?? '（无说明）').slice(0, 100)}`)),
      '',
      `## 待人类裁决（${openDecisions.length}）`,
      openDecisions.length === 0
        ? '无'
        : openDecisions
            .map((e) => {
              const d = ageDays(e.ts)
              const tag = d !== null && d >= 3 ? ` ⏰ 已挂 ${d} 天` : ''
              return `- [${String(e.ts).slice(0, 10)}]${tag} ${e.text}${e.source ? `（来源: ${e.source}）` : ''}`
            })
            .join('\n'),
      '',
      `## 最近流水（${journal.length} 条中最近 ${recent.length}）`,
      recent.length === 0 ? '（无）' : recent.map((e) => `- [${e.ts.slice(0, 10)}] ${e.kind}: ${String(e.text).slice(0, 120)}${e.source ? `（来源: ${e.source}）` : ''}`).join('\n'),
      '',
      '## 建议下一步',
      next.map((t, i) => `${i + 1}. ${t}`).join('\n'),
    ].join('\n')
  }

  if (action === 'journal') {
    // 裁决：关闭一条 open 决策（长程任务必须有闭环，否则待裁决只增不减）
    const resolve = String(args?.resolve ?? '').trim()
    if (resolve !== '') {
      const target =
        resolve === 'last'
          ? [...journal].reverse().find((e) => e.kind === 'decision' && e.open === true)
          : journal.find((e) => e.ts === resolve)
      if (target === undefined) {
        throw new Error(`proof_dag journal: no open decision matching "${resolve}"`)
      }
      target.open = false
      target.resolvedAt = new Date().toISOString()
      target.resolution = String(args?.note ?? '已裁决（未记结论）')
      ledger.journal = journal
      writeLedger(ledger)
      const left = journal.filter((e) => e.kind === 'decision' && e.open === true).length
      return [
        '# proof_dag: journal 裁决 ✅',
        '',
        `- 条目: ${target.text}`,
        `- 结论: ${target.resolution}`,
        `- 剩余待裁决: ${left}`,
      ].join('\n')
    }
    const entry = args?.entry
    if (entry === undefined || entry === null) {
      const filter = String(args?.id ?? '').trim()
      const list = filter === '' ? journal : journal.filter((e) => e.node === filter)
      return [
        '# proof_dag: journal',
        '',
        `- 条目: ${list.length}｜类型: ${JOURNAL_KINDS.join(' / ')}${filter === '' ? '' : `｜过滤 node=\`${filter}\``}`,
        '',
        list.length === 0
          ? '（无）'
          : list
              .slice()
              .reverse()
              .map((e) => `- [${e.ts}] **${e.kind}**${e.open === true ? ' ⚠待裁决' : ''}${e.node ? ` \`${e.node}\`` : ''}: ${e.text}${e.source ? `（来源: ${e.source}）` : ''}`)
              .join('\n'),
      ].join('\n')
    }
    if (typeof entry !== 'object') throw new Error('proof_dag journal: `entry` must be an object')
    const kind = String(entry.kind ?? '').trim()
    if (!JOURNAL_KINDS.includes(kind)) {
      throw new Error(`proof_dag journal: invalid kind "${kind}" (expected ${JOURNAL_KINDS.join(' | ')})`)
    }
    const text = String(entry.text ?? '').trim()
    if (text === '') throw new Error('proof_dag journal: `entry.text` required')
    const node = entry.node === undefined ? undefined : String(entry.node)
    if (node !== undefined && !Object.hasOwn(nodes, node)) {
      throw new Error(`proof_dag journal: unknown node "${node}"（先 add，再记流水）`)
    }
    journal.push({
      ts: new Date().toISOString(),
      kind,
      text,
      source: entry.source === undefined ? undefined : String(entry.source),
      node,
      open: entry.open === true,
    })
    ledger.journal = journal
    writeLedger(ledger)
    return [
      `# proof_dag: journal +1（${kind}）`,
      '',
      `- 已记录: ${text.slice(0, 200)}`,
      `- 来源: ${entry.source ?? '—'}`,
      `- 待裁决: ${entry.open === true ? '是 ⚠' : '否'}`,
      `- 流水总数: ${journal.length}`,
    ].join('\n')
  }

  if (action === 'plan') {
    // ── 证明义务分解：**先看后写**。默认只渲染骨架与校验结果，`commit:true` 才落盘 ────
    // 两种用法：① 给 `statement`（目标命题原文）→ 机器按形状表给骨架；
    //          ② 给 `items`（你自己的分解）→ 机器只做结构与纪律校验（缺 verify / 悬空依赖 /
    //             成环 / 自带结论 / 没有组合节点 / id 已存在）。
    // 边界写在 impl/obligation.mjs 头部：机器做的是**形状识别与漏项检查**，不是替你想数学。
    const planRules = rules.PLAN ?? RULESET.PLAN
    const statement = String(args?.statement ?? '').replace(/\s+/g, ' ').trim()
    const rawGoalId = String(args?.goalId ?? args?.id ?? '').trim()
    const given = Array.isArray(args?.items) ? args.items : null
    let items = []
    let notes = []
    let goalId = rawGoalId === '' ? '' : obligationId(rawGoalId)
    if (given === null) {
      const analyzed = analyzeStatement(statement, rawGoalId, { rules: planRules })
      items = analyzed.items
      notes = analyzed.notes
      goalId = analyzed.goalId
      if (statement === '') throw new Error('proof_dag plan: 给 `statement`（目标命题原文）让机器拆，或给 `items`（你自己的分解）让机器校验')
    } else {
      // 显式 id 一律**原样保留**（空 id 交给校验去报「缺 id」，不要偷偷改名）
      items = given.map((it) => ({ ...(it ?? {}), id: String(it?.id ?? '').trim() }))
    }
    const knownIds = Object.keys(nodes)
    const verdict = validatePlan(items, { rules: planRules, knownIds, goalId: goalId === '' ? undefined : goalId })
    // 分解是**建骨架**：已存在的 id 不许被悄悄覆盖（import 是「更新」语义，plan 不是）
    const clashes = items.map((it) => it.id).filter((id) => id !== '' && Object.hasOwn(nodes, id))
    if (clashes.length > 0) {
      verdict.problems.push(`这些 id 台账里已经有了：${clashes.join(', ')} → 分解只建骨架；改用 \`update\` 改已有节点，或换 id`)
    }
    verdict.ok = verdict.problems.length === 0
    if (args?.commit !== true) {
      return renderPlan({ goalId, statement, items, verdict, notes, committed: false })
    }
    if (!verdict.ok) {
      return `${renderPlan({ goalId, statement, items, verdict, notes, committed: false })}\n\n**未落盘**：先修完上面的阻断问题（骨架写进去也只会变成假证据）。`
    }
    // 复用 **import** 那条路（同一份证据纪律、同一份报告）——不另写一套写盘逻辑
    const importedReport = runDagLocked(workspace, { action: 'import', items: planItemsToNodes(items) }, witness, live, untracked)
    // ⚠ import 已经写过盘了：**必须重新读**再补流水，绝不能用旧引用覆盖（会丢刚落的节点）
    const after = readLedger(workspace)
    const journalAfter = after.journal ?? []
    journalAfter.push({
      ts: new Date().toISOString(),
      kind: 'milestone',
      text: `拆解 \`${goalId || '(未命名目标)'}\` 为 ${items.length} 条义务（全部 pending，待逐条取回执）：${items
        .slice(0, 6)
        .map((it) => it.id)
        .join(', ')}${items.length > 6 ? ' …' : ''}`,
      source: 'proof_dag plan',
      open: false,
    })
    after.journal = journalAfter
    writeLedger(after)
    return `${renderPlan({ goalId, statement, items, verdict, notes, committed: true })}\n\n${importedReport}`
  }

  if (action === 'import') {
    // 批量登记：从 JSON 文件或 items 数组导入对象/命题（登记既有对象层的入口）
    let items = args?.items
    const file = String(args?.file ?? '').trim()
    if ((items === undefined || items === null) && file !== '') {
      const path = isAbsolute(file) ? file : join(workspace, file)
      if (!existsSync(path)) throw new Error(`proof_dag import: no such file: ${path}`)
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'))
        items = Array.isArray(parsed) ? parsed : (parsed?.nodes ?? parsed?.items)
      } catch (e) {
        throw new Error(`proof_dag import: 无法解析 ${path}（${e instanceof Error ? e.message : String(e)}）`)
      }
    }
    if (!Array.isArray(items)) throw new Error('proof_dag import: `items`（数组）或 `file`（JSON 路径）必给其一')
    const added = []
    const updated = []
    const errors = []
    const unevidenced = [] // 经 allowUnevidencedProven 放行的「proven 但无回执」节点
    for (const raw of items) {
      if (raw === null || typeof raw !== 'object') {
        errors.push('非对象条目已跳过')
        continue
      }
      const id = String(raw.id ?? '').trim()
      if (id === '') {
        errors.push('缺 id 的条目已跳过')
        continue
      }
      const kind = raw.kind === undefined ? 'lemma' : String(raw.kind)
      if (!NODE_KINDS.includes(kind)) {
        errors.push(`${id}: 非法 kind "${kind}"`)
        continue
      }
      if (kind === 'object' && String(raw.construction ?? '').trim() === '') {
        errors.push(`${id}: object 缺 construction（对象层不允许「只有公理」）`)
        continue
      }
      const fields = {
        kind,
        statement: raw.statement === undefined ? undefined : String(raw.statement),
        construction: raw.construction === undefined ? undefined : String(raw.construction),
        carrier: raw.carrier === undefined ? undefined : String(raw.carrier),
        operations: Array.isArray(raw.operations) ? raw.operations.map(String) : undefined,
        relations: Array.isArray(raw.relations) ? raw.relations.map(String) : undefined,
        deps: Array.isArray(raw.deps) ? raw.deps.map(String) : undefined,
        module: raw.module === undefined ? undefined : String(raw.module),
        source: raw.source === undefined ? undefined : String(raw.source),
        state: raw.state === undefined ? undefined : String(raw.state),
        // `note` / `owner` 原本**不在**批量通道的字段集里——于是 `plan` 落盘时
        // 「为什么需要这条义务 / 怎么验证它」被判据性地丢掉了（2026-09-11 由 plan-check 抓出）。
        // 判据必须随节点走：离开聊天记录后，下一个接手的人只看得到台账。
        note: raw.note === undefined ? undefined : String(raw.note),
        owner: raw.owner === undefined ? undefined : String(raw.owner),
      }
      // ── 证据字段：批量通道**不许绕过**证据纪律 ──────────────────────────
      // 真实事故（2026-09-10，另一会话）：`import` 原先**不接受** receipt/oracle/evidence，
      // 却允许直接写 state:"proven" → 9 个节点变成「proven 但无证据」，评分从 100 掉到 55，
      // 而报告只写「更新 9」，看不出原因。现在：给了就校验，写 proven 必须有有效回执。
      const existing = Object.hasOwn(nodes, id) ? nodes[id] : null
      const allowUnevidenced = args?.allowUnevidencedProven === true
      const modName = String(fields.module ?? existing?.module ?? '').trim()
      const modText = modName === '' ? null : moduleText(workspace, modName)

      let newReceipt = null
      if (raw.receipt !== undefined && raw.receipt !== null && String(raw.receipt).trim() !== '') {
        const rid = String(raw.receipt).trim()
        if (modText === null) {
          errors.push(`${id}: 给了 receipt 但 module 读不到（无法核对源码哈希）→ 先补 module 或该模块文件`)
          continue
        }
        const v = verifyReceipt(rid, modText)
        if (!v.ok) {
          errors.push(`${id}: receipt 无效（${v.why}）→ 先跑 proof_compile 拿新回执，不要手写`)
          continue
        }
        newReceipt = rid
      }
      let newOracle = null
      if (raw.oracle !== undefined && raw.oracle !== null && String(raw.oracle).trim() !== '') {
        const oid = String(raw.oracle).trim()
        const v = verifyOracleReceipt(oid, '')
        if (!v.ok) {
          errors.push(`${id}: oracle 回执无效（${v.why}）→ 用 proof_oracle 重跑`)
          continue
        }
        newOracle = oid
      }
      let newPostulates = existing?.postulates
      if (raw.postulates !== undefined) {
        try {
          newPostulates = normalizePostulates(raw.postulates)
        } catch (e) {
          errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
          continue
        }
      }
      const hasEvidence = newReceipt !== null || existing?.evidenceReceipt !== undefined
      if (fields.state === 'proven') {
        if (modText !== null) {
          const reason = postulateGate(workspace, modName, newPostulates)
          if (reason !== null) {
            errors.push(`${id}: ${reason}`)
            continue
          }
        }
        if (!hasEvidence && !allowUnevidenced) {
          errors.push(
            `${id}: state="proven" 但**没有有效回执** → 批量通道不豁免证据。三选一：` +
              '① 条目里带 `receipt`（proof_compile 签发）；② 先按 `active`/`needs_review` 导入，再用 `update` 带回执；' +
              '③ 确属历史数据迁移，调用时加 `allowUnevidencedProven: true`（会照常在 check 里扣分并被单独列出）',
          )
          continue
        }
        if (!hasEvidence) unevidenced.push(id)
      }

      if (existing !== null) {
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) existing[k] = v
        if (newPostulates !== undefined) existing.postulates = newPostulates
        if (newReceipt !== null) {
          existing.evidenceReceipt = newReceipt
          existing.evidenceVerified = true
          const prev = String(existing.evidence ?? '').trim()
          const stamp = `回执 \`${newReceipt.slice(0, 12)}…\` exit 0（工具签发）`
          existing.evidence = prev === '' ? stamp : `${prev}；${stamp}` // 追加，不覆盖人类写的反例说明
        }
        if (newOracle !== null) {
          existing.oracle = newOracle
          existing.oracleVerified = true
        }
        existing.updatedAt = new Date().toISOString()
        updated.push(id)
      } else {
        if (fields.statement === undefined || fields.statement.trim() === '') {
          errors.push(`${id}: 新节点缺 statement`)
          continue
        }
        nodes[id] = {
          id,
          kind: fields.kind,
          statement: fields.statement.trim(),
          construction: fields.construction,
          carrier: fields.carrier,
          operations: fields.operations,
          relations: fields.relations,
          deps: fields.deps ?? [],
          module: fields.module,
          owner: fields.owner,
          note: fields.note,
          postulates: newPostulates,
          source: fields.source,
          state: fields.state !== undefined && STATES.includes(fields.state) ? fields.state : 'pending',
          evidence: newReceipt === null ? undefined : `回执 \`${newReceipt.slice(0, 12)}…\` exit 0（工具签发）`,
          evidenceReceipt: newReceipt ?? undefined,
          evidenceVerified: newReceipt !== null,
          oracle: newOracle ?? undefined,
          oracleVerified: newOracle !== null,
          updatedAt: new Date().toISOString(),
        }
        added.push(id)
      }
    }
    writeLedger(ledger)
    return [
      '# proof_dag: import',
      '',
      `- 新增: **${added.length}**${added.length === 0 ? '' : `（${added.slice(0, 12).join(', ')}${added.length > 12 ? ' …' : ''}）`}`,
      `- 更新: **${updated.length}**${updated.length === 0 ? '' : `（${updated.slice(0, 12).join(', ')}${updated.length > 12 ? ' …' : ''}）`}`,
      `- 跳过/报错: ${errors.length === 0 ? '无 ✅' : `⚠ ${errors.length}`}`,
      ...errors.slice(0, 8).map((e) => `  - ${e}`),
      ...(unevidenced.length === 0
        ? []
        : ['', `- ⚠ **proven 但无回执（按 allowUnevidencedProven 放行）** ${unevidenced.length} 个：${unevidenced.slice(0, 8).join(', ')}${unevidenced.length > 8 ? ' …' : ''}（action:"check" 会扣分）`]),
      '',
      '> 导入后跑 `action:"check"` 看对象信息完整度与断链；再 `action:"graph"` 导出知识图谱。',
    ].join('\n')
  }

  if (action === 'search') {
    // 复用优先：写新引理前先查「库/台账里有没有现成的」
    const q = String(args?.query ?? '').trim()
    if (q === '') throw new Error('proof_dag search: `query` required（关键词 / 符号名 / 模块名）')
    const needle = q.toLowerCase()
    const scored = []
    for (const [id, n] of Object.entries(nodes)) {
      const hay = [id, n.statement, n.construction, n.carrier, n.module, n.source, ...(n.operations ?? []), ...(n.relations ?? [])]
        .filter((x) => typeof x === 'string')
        .join(' ')
        .toLowerCase()
      if (!hay.includes(needle)) continue
      // 相关度：id 命中 > 陈述命中；已证优先
      let score = 0
      if (id.toLowerCase().includes(needle)) score += 10
      if (String(n.statement ?? '').toLowerCase().includes(needle)) score += 5
      if (String(n.module ?? '').toLowerCase().includes(needle)) score += 3
      if (n.state === 'proven') score += 4
      if (n.evidenceVerified === true) score += 2
      scored.push({ id, score, node: n })
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    const top = scored.slice(0, 20)
    return [
      `# proof_dag: search \`${q}\``,
      '',
      `- 命中: **${scored.length}**${scored.length > top.length ? `（显示前 ${top.length}）` : ''}`,
      '',
      ...(top.length === 0
        ? ['（无命中）→ 这可能是**新引理**：先跑 `proof_oracle` 排除假命题，再写 Agda；不要重复实现库里已有的东西。']
        : top.map((r) => `- \`${r.id}\` [${r.node.state}${r.node.evidenceVerified ? '/回执' : ''}] ${String(r.node.statement ?? '').slice(0, 90)}${r.node.module ? ` — \`${r.node.module}\`` : ''}`)),
      '',
      '> **复用优先**：命中里若有 `proven` 的引理，直接用（`cong`/`subst` 引用）比重新证明快得多；',
      '> 若只有 `refuted`，说明该方向已被否证，别重走。',
    ].join('\n')
  }

  if (action === 'graph') {
    // AI 接口：把台账导出为**信息完整对象**的结构化知识图谱（JSON 落盘，报告只给摘要）
    const objects = []
    const claims = []
    const edges = []
    const relOther = []
    for (const [id, n] of Object.entries(nodes)) {
      const buckets = Object.fromEntries(RELATION_KINDS.map((k) => [k, []]))
      buckets.other = []
      for (const raw of n.relations ?? []) {
        const [k, ...rest] = String(raw).split(':')
        const target = rest.join(':')
        if (buckets[k] !== undefined) {
          buckets[k].push(target)
          edges.push({ from: id, to: target, kind: k })
        } else {
          buckets.other.push(String(raw))
          relOther.push(`${id}:${raw}`)
        }
      }
      const entry = {
        id,
        kind: n.kind ?? 'lemma',
        statement: n.statement,
        module: n.module ?? null,
        state: n.state,
        construction: n.construction ?? null,
        carrier: n.carrier ?? null,
        operations: n.operations ?? [],
        relations: buckets,
        deps: n.deps ?? [],
        source: n.source ?? null,
        evidence: n.evidenceVerified === true ? 'verified-receipt' : String(n.evidence ?? '').trim() === '' ? null : 'unverified',
      }
      if ((n.kind ?? 'lemma') === 'object') objects.push(entry)
      else claims.push(entry)
      for (const d of n.deps ?? []) edges.push({ from: id, to: d, kind: 'depends_on' })
    }
    const known = new Set(Object.keys(nodes))
    // 引用完整性：关系目标分「已登记（内部）」与「未登记（库外概念）」——不一律报错，
    // 但必须显式暴露，否则知识图谱可以指向幽灵节点而无人发现。
    const unregisteredRelations = edges
      .filter((e) => NODE_TARGET_RELATIONS.includes(e.kind) && !known.has(e.to))
      .map((e) => `${e.from} --${e.kind}--> ${e.to}`)
    const relationIndex = {}
    for (const e of edges) {
      if (e.kind === 'depends_on') continue
      if (!relationIndex[e.to]) relationIndex[e.to] = []
      relationIndex[e.to].push({ from: e.from, kind: e.kind })
    }
    const gaps = {
      objectsMissingConstruction: objects.filter((o) => o.construction === null).map((o) => o.id),
      objectsMissingRelations: objects.filter((o) => RELATION_KINDS.every((k) => o.relations[k].length === 0)).map((o) => o.id),
      unverifiedEvidence: [...objects, ...claims].filter((o) => o.evidence === 'unverified').map((o) => o.id),
      danglingDeps: edges.filter((e) => e.kind === 'depends_on' && !Object.hasOwn(nodes, e.to)).map((e) => `${e.from}→${e.to}`),
      unregisteredRelations,
    }
    const graph = {
      $schema: './schema/knowledge-graph.schema.json',
      schema: 'math-proof/knowledge-graph@1',
      generatedAt: new Date().toISOString(),
      workspace,
      ontology: {
        objectFields: ['id', 'kind', 'statement', 'construction', 'carrier', 'operations', 'relations', 'deps', 'source', 'evidence'],
        relationKinds: RELATION_KINDS,
        nodeTargetRelations: NODE_TARGET_RELATIONS,
        nodeKinds: NODE_KINDS,
      },
      objects,
      claims,
      edges,
      relationIndex,
      gaps,
    }
    const file = join(dirname(ledgerPath(workspace)), `graph-${createHash('sha1').update(String(workspace)).digest('hex').slice(0, 12)}.json`)
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(graph, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
    // 人类可读视图（AI 用 JSON、人用 Markdown——同一份事实，两种读法）
    const md = join(dirname(ledgerPath(workspace)), `graph-${createHash('sha1').update(String(workspace)).digest('hex').slice(0, 12)}.md`)
    const mdLines = ['# 数学对象图谱', '', `> 生成于 ${graph.generatedAt}｜workspace: \`${workspace}\``, '']
    mdLines.push(`## 对象（${objects.length}）`, '', '| id | 载体 | 生成方式 | 关系 |', '| --- | --- | --- | --- |')
    for (const o of objects) {
      const rels = Object.entries(o.relations).filter(([, v]) => v.length > 0).map(([k, v]) => `${k}: ${v.join(', ')}`).join('；')
      mdLines.push(`| \`${o.id}\` | ${(o.carrier ?? '—').replace(/\|/g, '\\|')} | ${(o.construction ?? '—').replace(/\|/g, '\\|').slice(0, 80)} | ${rels.replace(/\|/g, '\\|')} |`)
    }
    mdLines.push('', `## 命题（${claims.length}）`, '', '| id | 种类 | 状态 | 陈述 | 依赖 |', '| --- | --- | --- | --- | --- |')
    for (const c of claims) {
      mdLines.push(`| \`${c.id}\` | ${c.kind} | ${c.state} | ${String(c.statement).replace(/\|/g, '\\|').slice(0, 80)} | ${c.deps.join(', ') || '—'} |`)
    }
    mdLines.push('', '## 缺口', '')
    mdLines.push(`- 缺构造: ${gaps.objectsMissingConstruction.join(', ') || '无 ✅'}`)
    mdLines.push(`- 缺关系: ${gaps.objectsMissingRelations.join(', ') || '无 ✅'}`)
    mdLines.push(`- 未验证证据: ${gaps.unverifiedEvidence.join(', ') || '无 ✅'}`)
    mdLines.push(`- 悬空依赖: ${gaps.danglingDeps.join(', ') || '无 ✅'}`)
    mdLines.push(`- 未登记关系目标（库外概念）: ${gaps.unregisteredRelations.join('；') || '无 ✅'}`)
    mdLines.push('', '> 机器接口：同目录 `.json`（`$schema` 指向 `schema/knowledge-graph.schema.json`）。')
    const mdTmp = `${md}.${process.pid}.tmp`
    writeFileSync(mdTmp, `${mdLines.join('\n')}\n`, 'utf8')
    renameSync(mdTmp, md)
    return [
      '# proof_dag: graph（知识图谱导出）',
      '',
      `- JSON（机器接口）: \`${file}\``,
      `- Markdown（人类视图）: \`${md}\``,
      `- 对象: **${objects.length}**（缺构造 ${gaps.objectsMissingConstruction.length}｜缺关系 ${gaps.objectsMissingRelations.length}）`,
      `- 命题: ${claims.length}（lemma / theorem / bridge）`,
      `- 边: ${edges.length}（依赖 ${edges.filter((e) => e.kind === 'depends_on').length}｜关系 ${edges.filter((e) => e.kind !== 'depends_on').length}）`,
      `- 未验证证据: ${gaps.unverifiedEvidence.length === 0 ? '无 ✅' : `⚠ ${gaps.unverifiedEvidence.join(', ')}`}`,
      `- 悬空依赖: ${gaps.danglingDeps.length === 0 ? '无 ✅' : `❌ ${gaps.danglingDeps.join(', ')}`}`,
      `- 未登记关系目标（库外概念）: ${gaps.unregisteredRelations.length === 0 ? '无 ✅' : `⚠ ${gaps.unregisteredRelations.slice(0, 8).join('；')}${gaps.unregisteredRelations.length > 8 ? ' …' : ''}`}`,
      ...(relOther.length === 0 ? [] : ['', `- ⚠ 未归类关系（不在词表 ${RELATION_KINDS.join('/')}）: ${relOther.slice(0, 10).join(', ')}${relOther.length > 10 ? ' …' : ''}`]),
      '',
      '> 图谱是**给 AI 消费的结构化事实**：对象带 `construction` 与分桶 `relations`（acts_on/represents/invariant/embeds/…），命题带依赖与证据档位。',
      '> 报告只给摘要，完整 JSON 在文件里（有界化纪律）。',
    ].join('\n')
  }

  // list（默认）
  const s = stats(nodes)
  return [
    '# proof_dag: list',
    '',
    `- 台账: \`${ledgerPath(workspace)}\``,
    `- 进度: ${s.progress}%（共 ${s.total}）`,
    '',
    renderTable(nodes),
    '',
    `## 可开工 (${schedulable(nodes).length})`,
    schedulable(nodes).map((id) => `- \`${id}\``).join('\n') || '（无）',
  ].join('\n')
}

/**
 * 注册 `proof_dag` 工具。
 * @param ctx - preset 行上下文。
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'proof_dag',
    description:
      '持久化证明 DAG 台账（长程任务的可审计记忆）：节点=可验证命题或**信息完整对象**（`kind:"object"` 必须带 `construction` 生成方式与 `relations` 关系）、边=deps、状态机 pending→active→proven|refuted|blocked|needs_review|abandoned（放弃需理由，记录不删）、owner 指派、`source` 溯源。**先算后验证闸门**：`oracle` 字段写 `proof_oracle` 回执 id，`check` 报 oracle 覆盖与失效；**编译预算闸门**：同一模块失败 ≥3 次自动报警并提示委托。**证据分档**：只有 `proof_compile` 签发的 `receipt` 算「已验证」（回执与源码哈希绑定，改文件即失效）；模型自报的 `evidence` 字符串一律标「未验证」，照样扣分——分数不可通过改记录提高。`next` 派发依赖已证的待办；`check` 做环/悬空/证据/模块/**台账↔代码断链**体检；`brief` 生成跨天接手简报；`journal` 记决策与来源流水（`open:true` = 待人类裁决）；`graph` 把台账导出为**信息完整对象**的知识图谱 JSON（AI 接口，落盘 + 摘要）。**postulate 口径**：模块可以有 postulate，但标 proven 前必须用 `postulates` 逐个声明 kind（rewrite/unreachable/gap）——`gap` 不能 proven，rewrite/unreachable 要有人类裁决流水；未声明的按「用公理冒充证明」重罚。`doctor` 自证本实例跑的是哪版插件与规则（引用分数前先跑）。**批量登记（`import`）不豁免证据**：条目可带 `receipt`/`oracle`/`postulates`，写 `state:"proven"` 必须带有效回执，否则该条目被拒（真实事故：早期 import 静默丢掉 receipt，9 个 proven 变「无证据」→ 评分从 100 掉到 55 且看不出原因）。失败必须落 `diagnosis`：statement_wrong（陈述有误→修形式化）/ proof_too_hard（证明太难→拆子引理）。改 `statement`/`deps` = 改签名 → 该节点与全部下游退回 needs_review（blueprint refinement）。台账在 ~/.dsh/state/math-proof/（不写进项目仓库）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['init', 'add', 'update', 'plan', 'import', 'search', 'list', 'next', 'check', 'brief', 'journal', 'graph', 'doctor'],
          description:
            'init 初始化 / add 加节点 / update 改状态 / **plan 证明义务分解**（给 `statement` 让机器按形状表出骨架，或给 `items` 让机器校验你自己的分解；默认只渲染不落盘，`commit:true` 才写）/ import 批量登记（items 或 file）/ search 复用查找（写新引理前先查）/ list 全表 / next 可开工集合 / check 体检（含台账↔代码断链）/ brief 跨天接手简报 / journal 记或看决策与来源流水 / graph 导出知识图谱 JSON（AI 接口）/ **doctor 本实例自证**（跑的是哪版插件与规则、有没有落后于磁盘——引用分数前先跑它）。',
        },
        node: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'statement'],
          properties: {
            id: { type: 'string', description: '节点 id（短名，如 FermatL4.even-3abc）。' },
            statement: { type: 'string', description: '可验证命题（不是「证明 X」）。' },
            kind: { type: 'string', enum: NODE_KINDS, description: 'object 数学对象（必须给 construction）/ lemma 引理 / theorem 定理 / bridge 桥接公理。' },
            construction: { type: 'string', description: 'object 必填：由什么生成（载体 + 生成元 + 关系），如 `Trit → GF(9)=GF(3)[x]/(x²+1) → DC`。' },
            carrier: { type: 'string', description: 'object 载体（元素是什么），如 `A4 的 12 个偶置换`。' },
            operations: { type: 'array', items: { type: 'string' }, description: 'object 的运算（可多个），如 `compose`、`inverse`。' },
            relations: { type: 'array', items: { type: 'string' }, description: '与其他对象的关系，用 `前缀:目标` 形式：acts_on / represents / invariant / embeds / quotient_of / extends / isomorphic_to（如 `acts_on:tetrahedron`）。' },
            deps: { type: 'array', items: { type: 'string' }, description: '依赖的节点 id。' },
            state: { type: 'string', enum: STATES, description: '初始状态，默认 pending。' },
            owner: { type: 'string', description: '负责的 agent 名。' },
            note: { type: 'string', description: '备注。' },
            diagnosis: { type: 'string', enum: DIAGNOSES, description: '失败诊断（可选）。' },
            module: { type: 'string', description: '对应的 Agda 模块名（如 Sovereign.Algebra.Pi4Homomorphism），用于台账↔代码链接核对。' },
            source: { type: 'string', description: '命题来源（文献 / 人类学者 / 定理名，如 `T6.agda:1065 orbitStabilizer-path`）。' },
            receipt: { type: 'string', description: '`proof_compile` 签发的回执 id（工具签发的事实；只有它能让 proven 抵扣扣分）。' },
            oracle: { type: 'string', description: '`proof_oracle` 签发的回执 id（先算后验证闸门：证明该节点确实跑过 oracle 且覆盖完整）。' },
            postulates: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'kind'],
                properties: {
                  name: { type: 'string', description: '模块里确实存在的 postulate 名字（工具会按源码核对，声明了不存在的会报）。' },
                  kind: { type: 'string', enum: POSTULATE_KINDS, description: 'rewrite = 项目已论证的 REWRITE 语义设计（如 div3k/mod3k/gf3Toℕ-A4-inv）；unreachable = Agda 强制检查下的已知无害项；gap = 真缺口（该节点不能标 proven）。' },
                  reason: { type: 'string', description: '为什么它是这一类（写清依据，便于人类复核）。' },
                },
              },
              description: '模块含 postulate 时的**逐个分类声明**。标 proven 前必须声明；rewrite/unreachable 还需一条人类裁决流水（journal 的 decision）。',
            },
          },
          description: 'add 时的节点对象。',
        },
        id: { type: 'string', description: 'update 的目标节点 id。' },
        state: { type: 'string', enum: STATES, description: 'update 的新状态。' },
        owner: { type: 'string', description: 'update 的 owner。' },
        evidence: { type: 'string', description: 'update 的证据（如 `proof_compile exit 0, 0 postulate`）。' },
        diagnosis: { type: 'string', enum: DIAGNOSES, description: '失败诊断：statement_wrong（陈述有误→改形式化）/ proof_too_hard（证明太难→拆子引理）。' },
        note: { type: 'string', description: 'update 的备注。' },
        module: { type: 'string', description: 'update 的 Agda 模块名。' },
        source: { type: 'string', description: 'update 的命题来源（文献 / 人类学者 / 定理名）。' },
        receipt: { type: 'string', description: 'update 的 `proof_compile` 回执 id；标记 proven 时用它，回执无效会报错。' },
        postulates: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'kind'],
            properties: {
              name: { type: 'string' },
              kind: { type: 'string', enum: POSTULATE_KINDS, description: 'rewrite / unreachable / gap（gap 不能标 proven）。' },
              reason: { type: 'string' },
            },
          },
          description: 'update 用：模块里 postulate 的逐个分类声明（标 proven 前必填，工具会按源码核对名字）。',
        },
        oracle: { type: 'string', description: 'update 的 `proof_oracle` 回执 id；回执无效（不存在/退出非 0/抽样/脚本已改）会报错。' },
        resolve: { type: 'string', description: 'journal 用：裁决并关闭一条待裁决决策——条目 ts 或 `last`（最近一条 open 决策）。' },
        items: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description:
            'import 用：节点对象数组（与 add 的 node 同形，另接受 receipt / oracle / postulates / evidence）。注意：批量通道**不豁免证据** —— 条目写 state:"proven" 必须带有效 receipt（或该节点已有有效回执），否则该条目被拒。plan 用：你自己的分解方案；每条必须给 `statement` 与 `verify`（怎么验证），可带 `why`/`deps`/`kind`/`construction`/`module`；**不许带 state:"proven"**（结论只能来自回执）。',
        },
        allowUnevidencedProven: {
          type: 'boolean',
          description:
            'import 用：显式放行「proven 但无回执」的条目（历史数据迁移才用）。放行的节点会在报告里单独列出、并照常在 check 里扣分——**不要用它绕过证据纪律**。',
        },
        query: { type: 'string', description: 'search 用：关键词 / 符号名 / 模块名（大小写不敏感）。' },
        file: { type: 'string', description: 'import 用：JSON 文件路径（内容为数组或 `{nodes:[…]}`）。' },
        entry: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'text'],
          properties: {
            kind: { type: 'string', enum: JOURNAL_KINDS, description: 'decision 裁决/取舍 / source 文献来源 / limit 工具链限制命中 / milestone 阶段交付 / handoff 跨天接手 / lesson 策略教训（症状→判据→做法→证据）。' },
            text: { type: 'string', description: '条目正文（写清结论与理由，不是「做完了」）。' },
            source: { type: 'string', description: '来源（文件:行、论文名、人类学者建议）。' },
            node: { type: 'string', description: '关联节点 id（可选）。' },
            open: { type: 'boolean', description: 'decision 条目：true = 待人类裁决。' },
          },
          description: 'journal 要追加的流水条目；省略则列出流水（配合 `resolve` 则裁决关闭）。',
        },
        statement: { type: 'string', description: 'update 的命题文本；plan 用：目标命题原文（机器据此识别形状并给义务骨架）。' },
        goalId: { type: 'string', description: 'plan 用：目标在台账里的 id（给了就用它当组合/根节点 id，如 FermatsLastTheorem.L4）。' },
        commit: { type: 'boolean', description: 'plan 用：默认 false 只渲染骨架与校验结果（**先看后写**）；true 才把骨架落盘（一律 pending，不产生任何结论）。' },
        kind: { type: 'string', enum: NODE_KINDS, description: 'update 的节点种类。' },
        construction: { type: 'string', description: 'update 的生成方式（object 必填）。' },
        carrier: { type: 'string', description: 'update 的载体。' },
        operations: { type: 'array', items: { type: 'string' }, description: 'update 的运算列表。' },
        relations: { type: 'array', items: { type: 'string' }, description: 'update 的关系列表。' },
        deps: { type: 'array', items: { type: 'string' }, description: 'update 的依赖列表。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['report'],
        properties: { report: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.report }]
      },
    },
    async execute(args, exec) {
      const workspace = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const shell = ctx.get('shell')
      const runtime = shell === undefined ? null : { shell, sandboxPolicy: ctx.get('sandboxPolicy') }
      return { report: await runDag(workspace, args === null || typeof args !== 'object' ? {} : args, runtime, exec) }
    },
  })
}
