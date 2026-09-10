// 数学证明模式 — 会话流量计量与预算账本（零依赖，只用 `node:` 内建模块）
//
// 为什么要有这个共享模块：**预算判定必须建立在同一把尺子上**。
//   · 钩子（每次调用都是**新进程**）要读「本回合已经花了多少」；
//   · 插件（`budget` 工具，冷档）要报「按类基线 + 历史样本」；
//   · 脚本（`scripts/traffic-report.mjs`）要对全部会话做统计与标定。
// 三处各写一份解析，就会出现「钩子说 16 步、报告说 21 步」这种不可复现的分歧。
//
// 数据源是**官方持久化产物**（`session.jsonl[.zstd]`），不是估算：
//   · 与 `@deepseek-ai/dsh-token-meter` 同源：`assistant/message.usage` 就是该步的
//     `{inputTokens, outputTokens, totalTokens, cacheReadTokens, reasoningTokens}`；
//   · 实测（2026-09-10，`session-10a4b85c` 全 14 个回合）逐回合比对：
//     `assistant/chunk` 的 usage 求和 == `assistant/message.usage` 求和，**每个回合同差 0**，
//     步数也一致 ⇒ 用 `assistant/message`（每步一条，天然不会重复计数），
//     只有某步缺 message 记录（流被打断）时才回退到该步的 chunk 求和；
//   · 日志是**多帧 zstd 容器**（`dsh-session-persistence-jsonl`），每帧独立可解码。
//     帧边界按**结构**扫描（同官方 `scanZstdFrames` 的算法：magic → frame header → block
//     header → …），所以**正在写入中的日志（尾部半帧）也能读**——这正是 Stop 钩子
//     能当场结算的前提。
//
// 口径（写进输出，禁止悄悄换单位）：
//   `tok` = Σ_step totalTokens = Σ_step(input + cacheRead + output) —— **provider 计量的流量**；
//   `steps` = 模型请求次数（= 工具轮次 + 1）——**主控量**（流量 ≈ 步数 × 每步上下文）；
//   `outTok` = 模型真正写出来的字（实测只占 0.9%，**不是杠杆**，只用于解释）。

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import * as zlib from 'node:zlib'

import { BUDGET, RECEIPT } from './ruleset.mjs'

/** Zstandard frame magic（little-endian `0xFD2FB528`）。 */
export const ZSTD_MAGIC = 4247762216

/**
 * Node 的 zstd 支持是 **22.15 / 23.8 起**才有的（`node:zlib`）。
 *
 * ⚠ 这里必须用**命名空间导入 + 运行时探测**，绝不能写成
 * `import { zstdDecompressSync } from 'node:zlib'`：在 Node 20 上那是一个
 * **链接期** SyntaxError（`does not provide an export named …`），会让**整个插件加载失败**
 * ——2026-09-10 CI 的 Node 20 作业就是这么炸的：`plugins/budget.mjs` 挂不上、第 7 个工具
 * 根本没注册。老 Node 上正确的降级是「读不了压缩日志」而不是「整个 preset 起不来」。
 */
const zstdDecompressSync = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null

/** 本进程能否解压会话日志（`status` / 报表会如实报出来，别让用户猜为什么没有数字）。 */
export const ZSTD_SUPPORTED = zstdDecompressSync !== null

/**
 * 状态目录：默认 `~/.dsh/state/math-proof`。
 * `MATH_PROOF_STATE_DIR` 可覆盖——**测试必须用它**，否则会污染用户的真实预算账本
 * （历史样本是学习状态，被测试写坏就再也回不来了）。
 */
export function stateDir() {
  return process.env.MATH_PROOF_STATE_DIR ?? join(homedir(), '.dsh', 'state', 'math-proof')
}

/** 预算账本（跨天/跨会话/跨进程保留的学习状态）。 */
export function profilePath() {
  return join(stateDir(), 'budget-profile.json')
}

/** 单会话的本回合活状态（用完即弃，不进学习账本）。 */
export function turnStatePath(sessionId) {
  const key = String(sessionId ?? '').replace(/[^\w-]/g, '').slice(0, 24) || 'nosession'
  return join(stateDir(), `budget-turn-${key}.json`)
}

// ────────────────────────────────────────────────────────────────────────────
// 一、日志读取（多帧 zstd / 明文 JSONL，容忍写入中的半帧）
// ────────────────────────────────────────────────────────────────────────────

/** 结构扫帧：只走 frame header 与 block header，不解压。坏结构按「尾部撕裂」处理。 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return { frames, tornStart: start, corrupt: true }
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) return { frames, tornStart: start, corrupt: true }
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < headerBytes) return { frames, tornStart: start }
    offset += headerBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return { frames, tornStart: start, corrupt: true }
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return { frames }
}

/**
 * 逐行读会话日志（内存有界：一帧一帧解，不把整个文件摊成一个大字符串）。
 * `lastFrames` 只解尾部 N 帧 —— Stop 钩子只需要当前回合，用它把 20MB 日志变成几百 KB。
 */
export function* sessionLines(file, options = {}) {
  if (!existsSync(file)) return
  const buf = readFileSync(file)
  if (buf.length < 4 || buf.readUInt32LE(0) !== ZSTD_MAGIC) {
    // 明文 JSONL（压缩关闭的部署）——直接按行给
    for (const line of buf.toString('utf8').split('\n')) yield line
    return
  }
  const { frames } = scanZstdFrames(buf)
  const picked = options.lastFrames === undefined ? frames : frames.slice(Math.max(0, frames.length - options.lastFrames))
  if (zstdDecompressSync === null) return // 老 Node：压缩日志读不了（调用方按「没有数据」处理）
  let carry = ''
  for (const frame of picked) {
    let text
    try {
      text = zstdDecompressSync(buf.subarray(frame.start, frame.end)).toString('utf8')
    } catch {
      continue // 坏帧跳过（尾部半帧、校验失败），不因此丢掉整个文件
    }
    const parts = `${carry}${text}`.split('\n')
    carry = parts.pop() ?? ''
    for (const line of parts) yield line
  }
  if (carry.trim() !== '') yield carry
}

/** 读会话头（`{id,cwd,parentSession,origin,agentPreset,createdAt}`）；读不到返回 null。 */
export function readSessionHeader(file) {
  for (const line of sessionLines(file, { lastFrames: 1 })) {
    const e = parseLine(line)
    if (e?.type === 'session') return e
  }
  return null
}

function parseLine(line) {
  if (line === undefined || line.trim() === '') return null
  try {
    const e = JSON.parse(line)
    return e !== null && typeof e === 'object' ? e : null
  } catch {
    return null
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 二、折叠成「每回合一条账」
// ────────────────────────────────────────────────────────────────────────────

/**
 * 折叠一个会话文件。
 * `lastFrames` 只读尾部（**粗略**，帧很小时不够用——要精确圈住某个回合用 `foldSessionWindow`）；
 * 默认全读。返回 `{ header, turns }`，`turns` 按 turn 号升序。
 */
export function foldSession(file, options = {}) {
  return foldLines(sessionLines(file, options), options)
}

/**
 * 只折叠「从 `fromTurn` 起」的窗口——Stop 钩子只需要当前回合。
 *
 * 做法：帧边界已知（不解压即可扫），于是**从尾往前解压**，直到某个帧里出现
 * `turn/start` 且回合号 < `fromTurn`（说明已经越过目标回合的起点），或解压总量到 `maxBytes`。
 * 命中字节上限仍未找到起点 → 该窗口标记 `truncated`：**样本照记，但不进基线**
 * （少算步数会让预算误判「这任务很便宜」，宁可不参与学习）。
 */
export function foldSessionWindow(file, options = {}) {
  const fromTurn = options.fromTurn
  if (typeof fromTurn !== 'number' || !existsSync(file)) return { header: null, turns: [], truncated: false }
  const buf = readFileSync(file)
  if (buf.length < 4 || buf.readUInt32LE(0) !== ZSTD_MAGIC) {
    const all = foldSession(file)
    return { ...all, turns: all.turns.filter((t) => t.turn >= fromTurn), truncated: false }
  }
  if (zstdDecompressSync === null) return { header: null, turns: [], truncated: true }
  const { frames } = scanZstdFrames(buf)
  const maxBytes = options.maxBytes ?? 8_000_000
  const texts = []
  let bytes = 0
  let found = false
  for (let i = frames.length - 1; i >= 0; i--) {
    let text
    try {
      text = zstdDecompressSync(buf.subarray(frames[i].start, frames[i].end)).toString('utf8')
    } catch {
      continue
    }
    texts.unshift(text)
    bytes += text.length
    if (turnStartBefore(text, fromTurn)) {
      found = true
      break
    }
    if (bytes >= maxBytes) break
  }
  const { header, turns } = foldLines(texts.join('').split('\n'), options)
  return { header, turns: turns.filter((t) => t.turn >= fromTurn), truncated: !found }
}

/** 这段文本里有没有「比 `fromTurn` 更早的回合」的 turn/start 标记。 */
export function turnStartBefore(text, fromTurn) {
  const marker = '"type":"turn/start"'
  let at = text.indexOf(marker)
  while (at >= 0) {
    const m = /"turn":(\d+)/.exec(text.slice(at, at + 80))
    if (m !== null && Number(m[1]) < fromTurn) return true
    at = text.indexOf(marker, at + marker.length)
  }
  return false
}

/**
 * 帧里有没有 `turn/start` 标记（判断「当前回合的起点是否已经进入窗口」）。
 * 返回命中的最后一个回合号，没命中返回 null。
 */
export function lastTurnStartIn(text) {
  const marker = '"type":"turn/start"'
  let found = null
  let at = text.indexOf(marker)
  while (at >= 0) {
    const m = /"turn":(\d+)/.exec(text.slice(at, at + 80))
    if (m !== null) found = Number(m[1])
    at = text.indexOf(marker, at + marker.length)
  }
  return found
}

/**
 * 只折叠**最后一个回合**（当前回合）——Stop / PostToolUse 钩子用。
 *
 * 从尾往前解压，**某帧里出现 `turn/start` 就停**（该回合的起点已在窗口内）。
 * 好处：正在跑的回合可能很长，但窗口只跟这一回合的长度走，不会把 20MB 日志全解一遍。
 * 命中 `maxBytes` 仍未找到起点 → `truncated: true`（少算步数会让预算误判「这任务很便宜」，
 * 所以结算时这种窗口**不进基线**）。
 */
export function foldLastTurn(file, options = {}) {
  if (!existsSync(file)) return { header: null, turns: [], truncated: false }
  const buf = readFileSync(file)
  if (buf.length < 4 || buf.readUInt32LE(0) !== ZSTD_MAGIC) {
    const all = foldSession(file)
    return { header: all.header, turns: all.turns.slice(-1), truncated: false }
  }
  if (zstdDecompressSync === null) return { header: null, turns: [], truncated: true }
  const { frames } = scanZstdFrames(buf)
  const maxBytes = options.maxBytes ?? 6_000_000
  const texts = []
  let bytes = 0
  let found = false
  for (let i = frames.length - 1; i >= 0; i--) {
    let text
    try {
      text = zstdDecompressSync(buf.subarray(frames[i].start, frames[i].end)).toString('utf8')
    } catch {
      continue
    }
    texts.unshift(text)
    bytes += text.length
    if (lastTurnStartIn(text) !== null) {
      found = true
      break
    }
    if (bytes >= maxBytes) break
  }
  const folded = foldLines(texts.join('').split('\n'), options)
  return { header: folded.header, turns: folded.turns.slice(-1), truncated: !found }
}

function blankTurn(turn) {
  return {
    turn,
    steps: 0,
    tok: 0,
    inTok: 0,
    cacheTok: 0,
    outTok: 0,
    reasoningTok: 0,
    ctxPeak: 0,
    ctxLast: 0,
    toolCalls: 0,
    repeats: 0,
    denies: 0,
    start: null,
    end: null,
    wallMs: null,
    reason: null,
    open: false,
    stepsWithUsage: 0,
    /** 本回合的**人类提示词**（第一条第 source.kind=user 的消息；用于按类标定）。 */
    prompt: null,
    /** 本回合内**被改动过**的思考强度（`request/header` 只在配置**变化**时落盘，所以这是阶跃值）。 */
    efforts: [],
    /** 回合开始/结束时生效的思考强度（跨回合延续；用于判断「本回合是否被降过档」）。 */
    effortAtStart: null,
    effortLast: null,
    effortClosed: false,
    /** 命中的回执标记（**只留标记本身，不留原文**——一个回合的工具结果可能有几百 KB）。 */
    receipts: [],
    calls: [],
    _stepUsage: new Map(),
    _chunkUsage: new Map(),
  }
}

/**
 * 折叠一段事件行。
 * 返回 `{ header, turns }`，`turns` 按 turn 号升序。
 */
export function foldLines(lines, options = {}) {
  const turns = new Map()
  let header = null
  const turnOf = (t) => {
    if (!turns.has(t)) turns.set(t, blankTurn(t))
    return turns.get(t)
  }
  let current = null
  /** 当前生效的思考强度（`request/header` 只在变化时落盘 → 需要跨行记住上一个值）。 */
  let lastEffort = null
  for (const line of lines) {
    const e = parseLine(line)
    if (e === null) continue
    if (e.type === 'session') {
      header ??= e
      continue
    }
    const t = e.data?.turn
    if (typeof t === 'number') current = t
    if (e.type === 'request/header') {
      // 每一步的真实请求配置都会落盘（`data.header.config`），但**记录里没有 turn 字段**
      // → 按「最近一次出现的回合号」归属。这是「思考强度真的被改了吗」的**审计痕迹**，
      // 也是事后按档位分组统计（每步 reasoning vs 步数/流量）的唯一数据源。
      // ⚠ `header` 里含完整系统提示词，**只取 config.reasoningEffort 这一个标量**，绝不整条序列化。
      const effort = e.data?.header?.config?.reasoningEffort ?? e.data?.config?.reasoningEffort
      if (typeof effort === 'string' && effort !== '') {
        lastEffort = effort
        if (current !== null) turnOf(current).efforts.push(effort)
      }
      continue
    }
    if (e.type === 'user/message') {
      // 人类提示词在日志里**没有 turn 字段**（实测：source.kind=user，data 里只有 content/source）
      // → 按「最近一次出现的回合号」归属；钩子注入的消息是 source.kind=plugin，天然被排除。
      if (current !== null) {
        const tr0 = turnOf(current)
        const kind = e.data?.source?.kind
        if (tr0.prompt === null && (kind === undefined || kind === 'user')) {
          const text = blocksText(e.data?.content)
          if (text.trim() !== '') tr0.prompt = text.slice(0, 400)
        }
      }
      continue
    }
    if (typeof t !== 'number') continue
    const tr = turnOf(t)
    switch (e.type) {
      case 'turn/start':
        tr.start = e.time ?? tr.start
        tr.effortAtStart = lastEffort
        break
      case 'turn/end':
        tr.end = e.time ?? tr.end
        tr.reason = e.data?.reason?.kind ?? tr.reason
        // 回合结束时**当场**记下生效档位（`lastEffort` 是折叠过程中的运行值，
        // 若留到最后统一取，前面每个回合都会拿到折叠末尾的值——那是错的）
        tr.effortLast = lastEffort
        tr.effortClosed = true // 用独立标志区分「回合结束时刻档位是 null」与「回合没结束」
        break
      case 'assistant/message': {
        const usage = e.data?.usage
        if (usage !== undefined && usage !== null) {
          tr._stepUsage.set(e.data.step ?? tr._stepUsage.size, usage)
        }
        for (const block of e.data?.message?.content ?? []) {
          if (block?.type === 'tool-call' || block?.type === 'tool_use') {
            tr.toolCalls++
            tr.calls.push({ name: String(block.name ?? ''), args: String(block.arguments ?? '') })
          }
        }
        break
      }
      case 'assistant/chunk': {
        const chunk = e.data?.chunk
        if (chunk?.type === 'usage' && chunk.usage !== undefined) {
          const step = e.data.step ?? 0
          const prev = tr._chunkUsage.get(step) ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 }
          tr._chunkUsage.set(step, {
            inputTokens: prev.inputTokens + (chunk.usage.inputTokens ?? 0),
            outputTokens: prev.outputTokens + (chunk.usage.outputTokens ?? 0),
            totalTokens: prev.totalTokens + (chunk.usage.totalTokens ?? 0),
            cacheReadTokens: prev.cacheReadTokens + (chunk.usage.cacheReadTokens ?? 0),
            reasoningTokens: prev.reasoningTokens + (chunk.usage.reasoningTokens ?? 0),
          })
        }
        break
      }
      case 'tool/result': {
        // 只判定「有没有回执标记」，**不留原文**：一回合的工具结果可达数百 KB，
        // 钩子要在 15s 内跑完且不能把内存吃满。
        const text = blocksText(e.data?.message?.content)
        const hit = RECEIPT.patterns.find((p) => text.includes(p))
        if (hit !== undefined && !tr.receipts.includes(hit)) tr.receipts.push(hit)
        break
      }
      case 'hook/result': {
        if (e.data?.decision === 'deny') tr.denies++
        break
      }
      default:
        break
    }
  }

  const out = []
  for (const tr of [...turns.values()].sort((a, b) => a.turn - b.turn)) {
    // 每步一条：message 记录优先；缺 message 的步才用 chunk 求和
    const steps = new Set([...tr._stepUsage.keys(), ...tr._chunkUsage.keys()])
    for (const step of steps) {
      const u = tr._stepUsage.get(step) ?? tr._chunkUsage.get(step)
      if (u === undefined) continue
      tr.stepsWithUsage++
      tr.inTok += u.inputTokens ?? 0
      tr.outTok += u.outputTokens ?? 0
      tr.cacheTok += u.cacheReadTokens ?? 0
      tr.reasoningTok += u.reasoningTokens ?? 0
      tr.tok += u.totalTokens ?? 0
      tr.ctxPeak = Math.max(tr.ctxPeak, u.totalTokens ?? 0)
      tr.ctxLast = u.totalTokens ?? 0
    }
    tr.steps = tr.stepsWithUsage
    tr.wallMs = tr.start !== null && tr.end !== null ? tr.end - tr.start : null
    tr.open = tr.end === null
    tr.repeatMax = maxRepeat(tr.calls)
    if (tr.effortClosed !== true) tr.effortLast = lastEffort // 未闭合的回合（通常是最后一个）用折叠末尾的值
    tr.effortDowngraded = tr.effortAtStart !== null && tr.effortLast !== null && tr.effortAtStart !== tr.effortLast
    // 类别只按「本回合第一条用户消息」判——与运行时钩子的判据一致
    delete tr._stepUsage
    delete tr._chunkUsage
    delete tr.effortClosed
    out.push(tr)
  }
  return { header, turns: out }
}

/** 从 content blocks 里取文本（工具结果 / 用户消息通用）。 */
export function blocksText(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block?.text === 'string') parts.push(block.text)
    else if (Array.isArray(block?.content)) parts.push(blocksText(block.content))
  }
  return parts.join('\n')
}

/** 同一「工具 + 参数」的最大重复次数（原地打转的度量）。 */
export function maxRepeat(calls) {
  const seen = new Map()
  let worst = 0
  for (const c of calls) {
    const key = `${c.name}\u0000${normalizeArgs(c.args)}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > worst) worst = n
  }
  return worst
}

/** 参数归一化：只用来判「同一次调用」，不参与语义。 */
export function normalizeArgs(args) {
  const text = String(args ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= 200) return text
  return `${text.slice(0, 200)}#${createHash('sha1').update(text).digest('hex').slice(0, 8)}`
}

/** 工具调用的短指纹（钩子侧用同一个函数，保证两边判据一致）。 */
export function callFingerprint(name, args) {
  return createHash('sha1').update(`${name}\u0000${normalizeArgs(args)}`).digest('hex').slice(0, 12)
}

// ────────────────────────────────────────────────────────────────────────────
// 三、证据（弱证据：文本；强证据：回执文件）
// ────────────────────────────────────────────────────────────────────────────

/** 弱证据：文本里出现机器回执标记。 */
export function hasReceiptText(text) {
  const t = String(text ?? '')
  return RECEIPT.patterns.some((p) => t.includes(p))
}

/** 本回合的弱证据（只看该回合的工具结果里命中的标记）。 */
export function turnReceiptText(turn) {
  return (turn?.receipts ?? []).length > 0
}

/** 强证据：时间窗内**新落盘**的编译/oracle 回执文件（文件系统事实，抄文本抄不出来）。 */
export function newReceiptsSince(sinceMs) {
  const dirs = RECEIPT.dirs.map((d) => join(stateDir(), d))
  let count = 0
  const names = []
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    let entries = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      try {
        if (statSync(join(dir, name)).mtimeMs >= sinceMs) {
          count++
          if (names.length < 5) names.push(name.slice(0, 12))
        }
      } catch {
        /* 竞态：文件刚被删/换，不计 */
      }
    }
  }
  return { count, names }
}

// ────────────────────────────────────────────────────────────────────────────
// 四、分类与稳健统计
// ────────────────────────────────────────────────────────────────────────────

/** 任务分类：按 `BUDGET.classes` 顺序取第一条命中；没命中按长度兜底。 */
export function classifyTask(prompt) {
  const text = String(prompt ?? '')
  for (const cls of BUDGET.classes) {
    if (cls.match === '' || cls.match === undefined) continue
    if (new RegExp(cls.match, 'i').test(text)) return cls.id
  }
  const t = text.trim()
  if (t.length >= BUDGET.longPromptChars) return BUDGET.longDefaultClass
  return BUDGET.defaultClass
}

/** 取类定义（未知类回退到默认类）。 */
export function classDef(id) {
  return BUDGET.classes.find((c) => c.id === id) ?? BUDGET.classes.find((c) => c.id === BUDGET.defaultClass) ?? BUDGET.classes[BUDGET.classes.length - 1]
}

/** token 显示（k/M，别堆一长串数字）。 */
export function fmtTok(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  return String(Math.round(n))
}

/** 升序百分位（最近邻取整，不插值——样本少时插值会给出不存在的值）。 */
export function percentile(values, p) {
  const arr = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (arr.length === 0) return null
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))
  return arr[idx]
}

/** 中位数（零依赖；偶数个取中间两个的平均）。 */
export function median(values) {
  const arr = values.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b)
  if (arr.length === 0) return null
  const mid = arr.length >> 1
  return arr.length % 2 === 1 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
}

/** 一组数字的稳健摘要（中位/p90/最大/样本数）。 */
export function summarize(values) {
  const arr = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  return {
    n: arr.length,
    median: median(arr),
    p90: percentile(arr, 0.9),
    max: arr.length === 0 ? null : Math.max(...arr),
    sum: arr.reduce((a, b) => a + b, 0),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 五、账本（profile）读写
// ────────────────────────────────────────────────────────────────────────────

/** 空账本。 */
export function blankProfile() {
  return {
    version: 1,
    updatedAt: null,
    /** 学习样本（环形，上限 `BUDGET.historyMax`）。 */
    samples: [],
    /** 各类当前预算（步数）+ 为什么。 */
    budgets: {},
    /** 尚未结算的回合（Stop 时日志还没落盘 → 下轮补）。 */
    pending: [],
    /** 记债：追加过预算，尚未还。 */
    debt: 0,
    /** 开关：`false` 时钩子只记账不拦。 */
    enabled: true,
    /** 标定来源（哪一天、多少样本）——数字必须能追到证据。 */
    calibration: null,
  }
}

/** 读账本；损坏则备份后返回空（**不静默重置**：备份文件留着，人能查）。 */
export function loadProfile(path = profilePath()) {
  if (!existsSync(path)) return blankProfile()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed === null || typeof parsed !== 'object') return blankProfile()
    return { ...blankProfile(), ...parsed }
  } catch {
    const bak = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
    try {
      renameSync(path, bak)
    } catch {
      /* 备份失败也不掩盖 */
    }
    return blankProfile()
  }
}

/** 原子写账本。 */
export function saveProfile(profile, path = profilePath()) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  const next = { ...profile, version: 1, updatedAt: new Date().toISOString() }
  if (next.samples.length > BUDGET.historyMax) next.samples = next.samples.slice(-BUDGET.historyMax)
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(tmp, path)
  return path
}

/** 读某类的当前预算（**工具调用次数**；无记录时用先验）。 */
export function budgetFor(profile, classId) {
  const def = classDef(classId)
  const record = profile.budgets?.[def.id]
  const calls = typeof record?.calls === 'number' ? record.calls : def.calls
  return { cls: def, calls, record }
}

/**
 * 该类样本的中位调用数 / 中位流量（数据不足返回 null 计数）。
 * `countable === false` 的样本（截断、未闭合、无证据的一次性事故）**不进基线**。
 *
 * 口径（数据卫生）：**优先用同一 workspace 的样本**——不同仓库的任务形态差得很远，
 * 拿别处的历史管本地的预算就是「预设别人的环境和自己一样」。本 workspace 样本不足
 * `minSamples` 时才回退到全机样本，并在 `scope` 里如实标出来。
 */
export function classBaseline(profile, classId, options = {}) {
  const all = (profile.samples ?? []).filter((s) => s.class === classId)
  const usable = all.filter((s) => s.countable !== false)
  const want = options.scope ?? 'auto'
  const scoped = options.cwd === undefined ? [] : usable.filter((s) => s.cwd === options.cwd)
  const useScoped = want === 'workspace' || (want === 'auto' && options.cwd !== undefined && scoped.length >= BUDGET.minSamples)
  const pool = want === 'all' ? usable : useScoped ? scoped : usable
  const window = pool.slice(-BUDGET.window)
  return {
    n: window.length,
    raw: all.length,
    scope: useScoped && want !== 'all' ? 'workspace' : 'all',
    calls: summarize(window.map((s) => s.calls)),
    steps: summarize(window.map((s) => s.steps)),
    tok: summarize(window.map((s) => s.tok)),
    /** 夹紧基准：样本够就用实测中位，否则退回先验（**先验不是实测，输出里要标明**）。 */
    base: window.length >= BUDGET.minSamples ? median(window.map((s) => s.calls)) : classDef(classId).calls,
    calibrated: window.length >= BUDGET.minSamples,
  }
}

/**
 * 扫一批会话日志，返回**紧凑的**逐回合记录（用于标定与报表）。
 * 丢掉 `calls` 明细（可能上千条带参数的长字符串）——报表只要统计量。
 */
export function scanSessionTurns(files, options = {}) {
  const out = []
  for (const file of files) {
    let folded
    try {
      folded = foldSession(file)
    } catch {
      continue
    }
    for (const tr of folded.turns) {
      const { calls, receiptText, ...rest } = tr
      out.push({
        ...rest,
        ...(options.keepCalls === true ? { calls } : {}),
        file,
        origin: folded.header?.origin ?? 'main',
        preset: folded.header?.agentPreset ?? '',
        session: folded.header?.id ?? '',
        cwd: folded.header?.cwd ?? '',
      })
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// 六、会话日志发现（跨 workspace）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 一个会话的**累计**用量（整份日志折叠求和）。
 * 只在「会话第一次开局」时读一次全量日志（约 2s / 20MB），之后靠每回合增量累加。
 */
export function sessionTotals(file) {
  const { header, turns } = foldSession(file)
  let tok = 0
  let steps = 0
  let calls = 0
  for (const tr of turns) {
    tok += tr.tok || 0
    steps += tr.steps || 0
    calls += tr.toolCalls || 0
  }
  return { tok, steps, calls, turns: turns.length, session: header?.id ?? null, preset: header?.agentPreset ?? null }
}

/** 会话存储根。 */
export function sessionsRoot() {
  return process.env.MATH_PROOF_SESSIONS_ROOT ?? join(homedir(), '.dsh', 'sessions')
}

/** 列出全部会话日志（只看 `session.jsonl*`，不递归别的文件）。 */
export function sessionLogFiles(root = sessionsRoot()) {
  if (!existsSync(root)) return []
  const out = []
  for (const ws of readdirSync(root)) {
    const wsDir = join(root, ws)
    let ids = []
    try {
      ids = readdirSync(wsDir)
    } catch {
      continue
    }
    for (const id of ids) {
      for (const name of ['session.jsonl.zstd', 'session.jsonl']) {
        const file = join(wsDir, id, name)
        if (existsSync(file)) {
          out.push(file)
          break
        }
      }
    }
  }
  return out
}

/** 按会话 id 找日志（跨 workspace；找不到返回 null）。 */
export function logPathForSession(sessionId, root = sessionsRoot()) {
  const target = String(sessionId ?? '')
  if (target === '') return null
  for (const file of sessionLogFiles(root)) {
    if (dirname(file).endsWith(target)) return file
  }
  return null
}
