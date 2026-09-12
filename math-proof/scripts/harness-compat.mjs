// 数学证明模式 — **DSH 版本兼容核验**（零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/harness-compat.mjs          # 核对本机已装的 DSH 契约
//   node ... --json                                                          # 机器可读
//   node ... --expect 0.1.5-rc.2                                             # 额外断言版本线（版本不对就红）
//
// 为什么要有它：本 preset 深度依赖 host 的若干**具体契约**——钩子方言的载荷与投递点、
// `agent/request` 瀑布、会话日志的多帧 zstd 容器与 `usage` 字段、`tokenUsage` 投影、
// 原子写的权限行为、preset 扫描与挂载时间戳。**DSH 一升级就要能一条命令验完**，
// 而不是靠人回忆「我们当初依赖了什么」。
//
// 判据：对每一条契约，在**本机实际安装的**包里找它的实现痕迹（正则）；找不到就报红并指出影响面。
// 没有安装 DSH（裸 CI）时打印 `COMPAT_SKIP` 并退出 0（与 refs-check 的 SKIP 同语义）。
//
// ⚠ 这只核验「host 侧契约还在不在」；**我们自己的解析器**对新会话格式的行为由
// `tests/compat-check.mjs`（含 v3 形状样本）负责。

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 本 preset 的根（脚本在 `<preset>/scripts/` 下）。 */
const PRESET_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const optOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const AS_JSON = has('--json')
const EXPECT = optOf('--expect')

/** pnpm store：优先环境变量，其次从 `which dsh` 推断，最后用默认全局路径。 */
function storeRoot() {
  const candidates = [
    process.env.DSH_STORE_ROOT,
    join(homedir(), '.local/share/pnpm/global/5/.pnpm'),
    join(homedir(), '.pnpm-store'),
  ].filter((x) => typeof x === 'string' && x !== '')
  return candidates.find((p) => existsSync(p)) ?? null
}

/** 选出某个包在 store 里**版本最高**的那份实现文件。 */
function packageFile(store, pkg) {
  const dirs = readdirSync(store).filter((d) => d.startsWith(`@deepseek-ai+${pkg}@`))
  const scored = []
  for (const d of dirs) {
    const m = /@([0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[0-9]+)?)_?/.exec(d.slice(`@deepseek-ai+${pkg}`.length))
    const libDir = join(store, d, 'node_modules', '@deepseek-ai', pkg, 'lib')
    // 入口不一定是 index.js（`dsh` 主包只有 bin.js）→ 取 lib/ 下任何一个 .js 作为「实现痕迹」载体
    const entry = existsSync(libDir)
      ? ['index.js', 'bin.js', ...readdirSync(libDir).filter((f) => f.endsWith('.js'))].map((f) => join(libDir, f)).find((f) => existsSync(f))
      : undefined
    if (m !== null && entry !== undefined) scored.push({ version: m[1], file: entry, dir: d })
  }
  scored.sort((a, b) => compareVersions(a.version, b.version))
  return scored[scored.length - 1] ?? null
}

function compareVersions(a, b) {
  const parse = (v) => v.split('-')[0].split('.').map(Number)
  const [A, B] = [parse(a), parse(b)]
  for (let i = 0; i < 3; i++) if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0)
  return 0
}

/**
 * 我们依赖的 host 契约。`probe` 是**实现痕迹**（不是接口名）：
 * 它必须在源码里真的出现，否则说明这条契约的实现变了/搬走了。
 */
const CONTRACTS = [
  { pkg: 'dsh-hooks-claude-code', what: '钩子载荷: session_id / transcript_path / cwd', probe: /transcript_path:/, why: '流量账目读会话日志的入口（没有它 → 算不了流量）' },
  { pkg: 'dsh-hooks-claude-code', what: 'PreToolUse 载荷: tool_name / tool_input', probe: /tool_name:/, why: '预算闸门与打转检测靠它' },
  { pkg: 'dsh-hooks-claude-code', what: 'PostToolUse 载荷: tool_response', probe: /tool_response:/, why: '过程播报靠它' },
  { pkg: 'dsh-hooks-claude-code', what: 'SessionStart → agent.inject(context)', probe: /agent\.inject\(context\)/, why: '接手简报的投递点' },
  { pkg: 'dsh-hooks-claude-code', what: 'UserPromptSubmit → 追加 messages', probe: /messages: \[\.\.\.downstream\.messages, ours\]/, why: '预算公告 / 信箱投递的投递点' },
  { pkg: 'dsh-hooks-claude-code', what: 'PostToolUse → additionalContexts', probe: /additionalContexts:/, why: '预算播报的投递点' },
  { pkg: 'dsh-hooks-claude-code', what: 'PreToolUse deny → kind:"deny"', probe: /kind: "deny"/, why: '预算闸门/流程闸门的拦截语义' },
  { pkg: 'dsh-hooks-claude-code', what: 'Stop **只**处理 deny（不注入 additionalContext）', probe: /turn-stopping/, why: '我们的「Stop 只做副作用 + 信箱」设计前提' },
  { pkg: 'dsh-hook-protocol', what: '退出码 2 = 阻止决策', probe: /BLOCKING_EXIT_CODE/, why: '钩子拦截靠 exit 2' },
  { pkg: 'dsh-hook-protocol', what: '被拦在日志里记作 block', probe: /output\.decision = "block"/, why: '我们数「被拦次数」时要认这个标签' },

  { pkg: 'dsh-agent-loop', what: 'agent/request 瀑布（可换调用配置）', probe: /waterfall\("agent\/request"/, why: '思考强度调速器的挂载点' },
  { pkg: 'dsh-agent-loop', what: 'agent/request-error 瀑布', probe: /waterfall\("agent\/request-error"/, why: '失败恢复/熔断类扩展的挂载点' },
  { pkg: 'dsh-agent-loop', what: '回合结束后按 inbox 决定是否续跑', probe: /if \(!this\.inbox\.hasPending\) return false;/, why: '「失败回合仍可能续跑」这一风险判断的依据' },
  { pkg: 'dsh-llm', what: '重试上限默认 5 / 可重试码 / jitter 0.1', probe: /DEFAULT_MAX_RETRIES = 5/, why: '我们不重复造重试的理由（文档引用过）' },
  { pkg: 'dsh-llm-retry', what: '重试预算在 step/turn 边界重置', probe: /event\.type === "step\/start" \|\| event\.type === "turn\/end"/, why: '「每步都能再烧 5 次重试」的结论依据' },
  { pkg: 'dsh-llm-retry', what: '遵循 providerRetryAfterMs', probe: /providerRetryAfterMs/, why: '同上' },

  { pkg: 'dsh-session-persistence-jsonl', what: '会话日志 = 多帧 zstd（结构扫帧）', probe: /scanZstdFrames/, why: '我们直接读原始 JSONL，容器格式一变就全瞎' },
  { pkg: 'dsh-session-persistence-jsonl', what: '扩展名 .jsonl.zstd', probe: /\.jsonl\.zstd/, why: '日志定位' },
  { pkg: 'dsh-session', what: '会话格式版本常量（0.1.5 = v3）', probe: /SESSION_FORMAT_VERSION = \d+/, why: '新会话在盘上是 v3 —— 我们的解析器要认识它' },
  { pkg: 'dsh-session-format-v2-to-v3', what: 'v3 迁移器存在（说明格式会演进）', probe: /releasedV3SessionFormatCodec/, why: '升级时最可能影响我们的一层' },

  { pkg: 'dsh-token-meter', what: 'tokenUsage 投影（累计桶）', probe: /uncachedInputTokens/, why: '与界面同格式的字段来源' },
  { pkg: 'dsh-token-meter', what: 'contextPressure 投影', probe: /pressureTokens/, why: '上下文压力监控' },
  { pkg: 'dsh-tools', what: '工具注册 register(definition)', probe: /register\(definition\)/, why: '8 个工具靠它' },
  { pkg: 'dsh-fs-local', what: '原子写暂存文件 0600（新文件落 0600 的根因）', probe: /handle\.chmod\(384\)/, why: '文件权限那一节的结论依据' },
  { pkg: 'dsh-agent-presets', what: 'preset 扫描与挂载时间戳', probe: /compositionStamp/, why: '「改了插件要重启」的判定依据' },
  // 2026-09-13 真实事故：`dsh-persona` 的必填字段从 `text` 改成 `prefix`，
  // 我们的 persona 行还用旧字段 → 挂载期 `$.prefix missing required value` → 整份 preset 起不来
  // （GUI 里表现为「切不过去 / 开不了会话」）。**行 config 的字段名也是 host 契约的一部分。**
  { pkg: 'dsh-persona', what: 'persona 配置必填字段 = prefix（不再是 text）', probe: /prefix:\s*z\.string\(\)\.required\(\)/, why: '用旧字段会在挂载期直接失败，整个 preset 用不了' },
]

const store = storeRoot()
if (store === null) {
  console.log('# DSH 版本兼容核验\n')
  console.log('COMPAT_SKIP：本机没有 pnpm store（裸 CI / 没装 DSH）——本项跳过。')
  process.exit(0)
}

const rows = []
let broken = 0
const seen = new Map()
for (const c of CONTRACTS) {
  const found = packageFile(store, c.pkg)
  if (found === null) {
    rows.push({ ok: false, pkg: c.pkg, what: c.what, note: '本机没装这个包（或以别的形态提供）' })
    broken++
    continue
  }
  seen.set(c.pkg, found.version)
  const text = readFileSync(found.file, 'utf8')
  const ok = c.probe.test(text)
  if (!ok) broken++
  rows.push({ ok, pkg: c.pkg, version: found.version, what: c.what, why: c.why, note: ok ? '' : `在 ${c.pkg}@${found.version} 里找不到实现痕迹` })
}

// ── 行 config 校验：我们自己组合里每一条 @deepseek-ai/* 行的 config ──────────────
// 为什么必须有这一段：契约探测只证明「host 提供了某个能力」，**不证明「我们的行写法还对」**。
// 2026-09-13 的事故就是这样漏过去的：能力都在，但 persona 行的字段名过期了。
// 判据：用**装在本机的那版包**导出的 `Config` schema 真解析一遍我们的 config。
const ROW_AUDIT = { checked: 0, failed: 0, noSchema: 0, rows: [] }
{
  const yamlLib = (() => {
    try {
      const dirs = readdirSync(store).filter((d) => d.startsWith('js-yaml@')).sort()
      for (const d of dirs.reverse()) {
        for (const rel of ['node_modules/js-yaml/index.js', 'node_modules/js-yaml/dist/js-yaml.mjs']) {
          const f = join(store, d, rel)
          if (existsSync(f)) return f
        }
      }
    } catch {
      /* 没装 yaml：本段静默跳过（契约部分仍然有效） */
    }
    return null
  })()
  const composition = join(PRESET_ROOT, 'agent.cordis.yml')
  if (yamlLib !== null && existsSync(composition)) {
    const jsyaml = await import(pathToFileURL(yamlLib).href)
    const JsType = new jsyaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: () => '<js>' })
    const parsed = jsyaml.load(readFileSync(composition, 'utf8'), { schema: jsyaml.DEFAULT_SCHEMA.extend([JsType]) })
    // 行里的包名从**profile 的 node_modules** 解析（harness 就是这么解析 preset 行的）
    const bases = [
      process.env.DSH_PROFILE_MODULES,
      join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'profiles', 'node_modules', '@deepseek-ai'),
      join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai'),
    ].filter((x) => typeof x === 'string' && x !== '' && existsSync(x))
    const base = bases[0]
    const walkRows = async (list, depth) => {
      for (const row of list ?? []) {
        if (row?.group === true) {
          await walkRows(row.config, `${depth}  `)
          continue
        }
        const name = row?.name
        if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) continue
        const pkg = name.split('/')[1]
        const dir = base === undefined ? null : join(base, pkg)
        if (dir === null || !existsSync(dir)) {
          ROW_AUDIT.rows.push({ ok: true, pkg, id: row.id, note: '本机解析不到该包（跳过结构校验）' })
          continue
        }
        let mod
        try {
          const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
          const entry = join(dir, pj.module ?? pj.exports?.['.']?.import ?? pj.main ?? 'lib/index.js')
          mod = await import(pathToFileURL(entry).href)
        } catch (e) {
          ROW_AUDIT.rows.push({ ok: true, pkg, id: row.id, note: `import 失败（跳过）：${String(e.message).slice(0, 60)}` })
          continue
        }
        const Config = mod.Config ?? mod.default?.Config
        if (typeof Config !== 'function') {
          ROW_AUDIT.noSchema++
          continue
        }
        ROW_AUDIT.checked++
        try {
          Config(row.config ?? {})
          ROW_AUDIT.rows.push({ ok: true, pkg, id: row.id, note: '' })
        } catch (e) {
          ROW_AUDIT.failed++
          broken++
          ROW_AUDIT.rows.push({ ok: false, pkg, id: row.id, note: String(e.message).replace(/\n/g, ' | ').slice(0, 160) })
        }
      }
    }
    await walkRows(parsed, '')
  }
}

const versions = Object.fromEntries([...seen.entries()].sort())
const dsh = packageFile(store, 'dsh')
const expectBroken = EXPECT !== undefined && dsh !== null && dsh.version !== EXPECT

if (AS_JSON) {
  console.log(JSON.stringify({ store, dsh: dsh?.version ?? null, expect: EXPECT ?? null, versions, broken, contracts: rows, rowAudit: ROW_AUDIT }, null, 2))
} else {
  console.log('# DSH 版本兼容核验（我们依赖的 host 契约）\n')
  console.log(`- store: \`${store}\``)
  console.log(`- 本机 dsh: **${dsh?.version ?? '未找到'}**${EXPECT === undefined ? '' : `｜期望 ${EXPECT}${expectBroken ? ' ⚠ 不一致' : ' ✅'}`}`)
  console.log(`- 涉及的包版本: ${Object.entries(versions).map(([k, v]) => `${k}@${v}`).join('、')}`)
  console.log('')
  for (const r of rows) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.pkg.padEnd(30)} ${r.what}${r.ok ? '' : `\n     ↳ ${r.note}｜影响：${r.why ?? ''}`}`)
  }
  console.log('')
  console.log(`## 我们的组合行 config（用装在本机的包真解析）`)
  console.log(`- 校验了 ${ROW_AUDIT.checked} 条（另有 ${ROW_AUDIT.noSchema} 条未导出 schema）｜失败 ${ROW_AUDIT.failed}`)
  for (const r of ROW_AUDIT.rows) {
    if (r.ok && r.note === '') continue
    console.log(`${r.ok ? '·' : '❌'} ${r.pkg.padEnd(30)} 行 ${String(r.id ?? '').padEnd(24)}${r.note === '' ? '' : ` ${r.note}`}`)
  }
  console.log('')
}

const failed = broken > 0 || expectBroken
console.log(failed ? `\nCOMPAT_FAIL ${rows.length - broken}/${rows.length} 契约在位${expectBroken ? `（版本期望不匹配：本机 ${dsh?.version} ≠ ${EXPECT}）` : ''}` : `\nCOMPAT_OK ${rows.length}/${rows.length} 契约在位（dsh ${dsh?.version ?? '?'}）`)
process.exit(failed ? 1 : 0)
