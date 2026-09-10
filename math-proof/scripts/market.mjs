// 数学证明模式 — DSH 插件市场盘点（零依赖，注册源驱动）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/market.mjs              # 概览 + 与证明相关的可装候选
//   node .../market.mjs --relevant     # 只看候选（含版本线可装性）
//   node .../market.mjs --missing      # 市场有、本地没装的全部包
//   node .../market.mjs --search lsp   # 按名字/描述在市场里搜
//   node .../market.mjs --all          # 追加长尾（按前缀分组计数）
//   node .../market.mjs --json         # 机器可读
//   node .../market.mjs --offline      # 只用本地快照（不联网）
//   node .../market.mjs --refresh      # 强制刷新快照
//   node .../market.mjs --cache <path> # 指定快照路径（测试用）
//
// ── DSH 的「插件市场」是什么（事实，不是比喻）────────────────────────────────
//   · 插件就是 npm 包；市场 = 注册源（本机 `~/.npmrc` 的 registry，默认 npmmirror）。
//   · 装：`dsh plugin --profile web add <包>@<版本>`（转发 pnpm 到 `~/.dsh/profiles/web`）。
//   · 用：在 composition 里加一行（preset 行 = agent 平面；宿主 patch = 宿主平面）。
//     宿主平面（共享服务/注册表/持久化）进 `~/.dsh/profiles/web/cordis.patch.yml`；
//     agent 平面（工具/提示段）进本 preset 的 `agent.cordis.yml`。
//   · 卸载：`dsh plugin --profile web remove <包>`；停用：patch 层里 disable，不必卸载。
//
// ── 本脚本回答的三个问题 ──────────────────────────────────────────────────
//   1. 市场上有多少 dsh 包？我们装了多少？差集是什么？（客观事实，来自注册源 + 本地商店）
//   2. 差集里哪些**与数学证明有关**？结论 / 理由 / 成本 / 依赖，逐条给。
//   3. 要装的话，**确切命令**是什么？版本线对得上吗？
//
// ⚠ 版本线陷阱（实测）：这些包的 npm `latest` dist-tag 常年停在 `0.0.1-rc.1`，
//   而本机 dsh 是 `0.1.2-rc.1`。**不带版本号 `pnpm add` 会装到错版本**。
//   本脚本只推荐「注册源里存在本机同版本线」的包，并把版本号写进命令里。
//
// 数据管理：快照落在 `state/market/registry-<host>.json`（原子写，默认 TTL 24h），
//   联网失败时**降级用旧快照并明确标注陈旧**，绝不假装数据是新的。
// 单一事实源：**已装侧**的判断表在 `scripts/plugins.mjs`，共享事实层在 `impl/dsh-inventory.mjs`，
// 本脚本不重复它们（曾经两边各写一份解析器，结果把「宿主禁用」误读成「宿主已挂」）。

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { hostSets, installedPackages, loadHostRows, presetRows, targetVersion } from '../impl/dsh-inventory.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRESET = dirname(HERE)
const STORE = join(homedir(), '.local', 'share', 'pnpm', 'global', '5', '.pnpm')
const TTL_MS = 24 * 60 * 60 * 1000
const SCOPE_QUERY = '@deepseek-ai/dsh'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const OFFLINE = has('--offline')
const REFRESH = has('--refresh')
const AS_JSON = has('--json')
const SHOW_ALL = has('--all')
const SHOW_RELEVANT = has('--relevant')
const SHOW_MISSING = has('--missing')
const SEARCH = opt('--search')

// ── 注册源与快照 ────────────────────────────────────────────────────────────

/** 注册源地址：环境变量 > npm 环境变量 > ~/.npmrc > npmjs 官方。 */
function registryUrl() {
  if (process.env.DSH_MARKET_REGISTRY) return process.env.DSH_MARKET_REGISTRY
  if (process.env.npm_config_registry) return process.env.npm_config_registry
  try {
    const m = /^registry\s*=\s*(\S+)/m.exec(readFileSync(join(homedir(), '.npmrc'), 'utf8'))
    if (m !== null) return m[1]
  } catch {
    /* 无 .npmrc */
  }
  return 'https://registry.npmjs.org'
}

const REGISTRY = registryUrl().replace(/\/$/, '')
const hostKey = REGISTRY.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_')
const CACHE_FILE = opt('--cache') ?? join(PRESET, 'state', 'market', `registry-${hostKey}.json`)

function readCache() {
  try {
    const snap = JSON.parse(readFileSync(CACHE_FILE, 'utf8'))
    if (typeof snap?.packages !== 'object' || snap.packages === null) return null
    return snap
  } catch {
    return null
  }
}

function writeCache(snap) {
  mkdirSync(dirname(CACHE_FILE), { recursive: true })
  const tmp = `${CACHE_FILE}.tmp-${process.pid}`
  writeFileSync(tmp, `${JSON.stringify(snap, null, 2)}\n`)
  renameSync(tmp, CACHE_FILE) // 原子替换：崩在写一半也不会留坏快照
}

/** 拉取市场清单（分页 250/页）。返回 {registry, fetchedAt, total, packages}。 */
async function fetchRegistry() {
  const packages = new Map()
  let total = 0
  for (let from = 0; from < 4000; from += 250) {
    const url = `${REGISTRY}/-/v1/search?text=${encodeURIComponent(SCOPE_QUERY)}&size=250&from=${from}`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`注册源 ${REGISTRY} 返回 HTTP ${res.status}`)
    const body = await res.json()
    const objs = Array.isArray(body?.objects) ? body.objects : []
    total = Number(body?.total ?? objs.length)
    for (const o of objs) {
      const p = o?.package
      if (typeof p?.name !== 'string' || !p.name.startsWith('@deepseek-ai/dsh')) continue
      packages.set(p.name, {
        latest: String(p.version ?? ''),
        versions: Array.isArray(p.versions) ? p.versions.map(String) : [],
        description: String(p.description ?? '').replace(/\s+/g, ' ').trim(),
        date: String(p.date ?? ''),
      })
    }
    if (objs.length === 0 || from + objs.length >= total) break
  }
  return { registry: REGISTRY, fetchedAt: new Date().toISOString(), total, packages: Object.fromEntries([...packages].sort()) }
}

/** 快照优先：新鲜就用，过期就刷，刷不动就降级（标注陈旧）。 */
async function loadMarket() {
  const cached = readCache()
  const age = cached === null ? Infinity : Date.now() - Date.parse(cached.fetchedAt)
  const fresh = cached !== null && Number.isFinite(age) && age < TTL_MS
  if (OFFLINE) {
    if (cached === null) throw new Error(`--offline 但没有快照：${CACHE_FILE}`)
    return { snap: cached, stale: !fresh, age, source: 'cache' }
  }
  if (fresh && !REFRESH) return { snap: cached, stale: false, age, source: 'cache' }
  try {
    const snap = await fetchRegistry()
    writeCache(snap)
    return { snap, stale: false, age: 0, source: 'network' }
  } catch (err) {
    if (cached === null) throw err
    return { snap: cached, stale: true, age, source: 'cache-fallback', error: String(err.message ?? err) }
  }
}

// ── 本地事实：已装 / 已声明 / 宿主已挂 ──────────────────────────────────────

// 已装 / 版本线 / preset 行 / 宿主组合：全部来自 `impl/dsh-inventory.mjs`（唯一事实源）。

/** preset composition 里显式声明的包名。 */
function declaredPackages() {
  return new Set(presetRows(PRESET).map((r) => r.name).filter((n) => n.startsWith('@deepseek-ai/')))
}

/** 宿主平面**启用**的包名（禁用行不算「已挂」——这是上一版最大的分类错误）。 */
function hostEnabledPackages(presetDir) {
  const { rows } = loadHostRows(presetDir)
  const { enabled, disabled } = hostSets(rows)
  return { enabled, disabled: disabled.size, total: rows.length }
}

// ── 相关性判断表（注册源侧，人工核过；已装侧的判断表在 scripts/plugins.mjs）──

// verdict: 建议加 / 待评估 / 不建议 / 需宿主
// need:    用起来还需要什么（依赖事实）
// cost:    进常驻前缀的成本（工具定义/提示段）
const MARKET = [
  {
    name: '@deepseek-ai/dsh-lsp',
    trio: ['@deepseek-ai/dsh-lsp', '@deepseek-ai/dsh-lsp-stdio', '@deepseek-ai/dsh-tool-lsp'],
    verdict: '待评估',
    why: '`ctx.lsp` 能力缝 + 通用 stdio 语言服务器后端 + 一个只读 `lsp` 工具（goToDefinition 等）。对证明工作价值高：跳进 stdlib 定义不用全文读文件。',
    need: '**本机 Agda 没有 LSP**：`agda --help` 只有 `--interaction-json`，没有 `--lsp`，也没有 `als`（agda-language-server 是独立 Haskell 二进制，未安装）。要用得先装 als 再配 `dsh-lsp-stdio` 的服务器表。',
    cost: '+1 工具定义（≈0.3–0.5k 字符前缀）',
  },
  {
    name: '@deepseek-ai/dsh-tool-session-query',
    verdict: '待评估',
    why: '5 个会话检索工具（`session_search` / `session_event_search` / `session_trace` / `session_event_trace` / `session_event_read`），走 `ctx.sessionQuery`。长程证明工作想查「上次怎么证的」时有用。',
    need: '**两件事都要做**：装这个工具包 **且** 宿主把 `dsh-session-query-sqlite` 从 `openAt: never` 改成 `first-search`。只装包不开后端，工具没数据。',
    cost: '+5 工具定义（≈1.5–2k 字符前缀）',
  },
  {
    name: '@deepseek-ai/dsh-code-runtime-python',
    verdict: '待评估',
    why: '代码执行缝的 CPython 实现（子进程）。',
    need: '我们自己的 `proof_oracle` 已经跑 python3 且**签发回执**（脚本哈希 + stdout 哈希 + ORACLE-MANIFEST 覆盖清单）。通用缝没有证据档位 → 换过去等于降级证据链，除非要它的隔离语义。',
    cost: '工具名/数量取决于宿主组合，未知',
  },
  {
    name: '@deepseek-ai/dsh-subagent-claude-code',
    verdict: '待评估',
    why: '跨厂商子代理（官方 Claude Code SDK）。可做**对抗交叉验证**：让另一家模型独立复核关键引理——与我们「三方定位」研究（Claude 走形式化既有路线 / OpenAI 走 forcing 变体 / 我们走有限离散展示）呼应。',
    need: '需要外部 Claude Code CLI + 账号；产出证据档位仍要我们自己的回执体系兜底。',
    cost: '不注册模型工具（子代理后端）',
  },
  {
    name: '@deepseek-ai/dsh-subagent-codex',
    verdict: '待评估',
    why: '同上，OpenAI Codex 侧（官方 app-server 协议）。',
    need: '需要外部 Codex CLI + 账号。',
    cost: '不注册模型工具',
  },
  {
    name: '@deepseek-ai/dsh-session-persistence-sqlite',
    verdict: '需宿主',
    why: '会话持久化换 SQLite 后端。',
    need: '宿主平面决策（持久化归宿主），且**注册源里没有 0.1.2-rc.1 版本线**（只到 0.1.2-alpha.2）→ 跨线风险。',
    cost: '无（宿主服务）',
  },
  {
    name: '@deepseek-ai/dsh-storage-sqlite',
    verdict: '需宿主',
    why: '存储枢纽的 SQLite kv 后端。',
    need: '宿主平面决策（存储归宿主）。版本线有 0.1.2-rc.1，但换后端要连带评估会话格式迁移（`dsh-session-format*` 一族）。',
    cost: '无（宿主服务）',
  },
  {
    name: '@deepseek-ai/dsh-tool-present',
    verdict: '不建议',
    why: '显式交付声明工具（`present`）：把最终文件声明进会话文件系统，用户可直接在默认应用打开。',
    need: '**只有 0.1.5-alpha.2**，无 0.1.2-rc.1 版本线。',
    cost: '+1 工具定义',
  },
  {
    name: '@deepseek-ai/dsh-tool-terminal',
    verdict: '不建议',
    why: '6 个持久 PTY 工具（`tool-bash-persistent` 的替代路径，带 owner 隔离与后台任务集成）。',
    need: '我们的编译/oracle 调用是自包含一次性命令，持久 shell 收益小、成本大（+6 工具定义）。',
    cost: '+6 工具定义（≈2–3k 字符前缀）',
  },
  {
    name: '@deepseek-ai/dsh-llm-replay',
    verdict: '不建议',
    why: '用录制的 session JSONL 重放模型输出，做无 API key 的确定性快照测试。',
    need: '入口依赖 vitest / 测试运行时（`dsh-session-snapshot` 明确「只在 vitest 里可用」）。我们的门禁是**零依赖纯 node**，接进来要引入整套测试基建。',
    cost: '无（测试期）',
  },
  {
    name: '@deepseek-ai/dsh-llm-mock-server',
    verdict: '不建议',
    why: '脚本化 OpenAI 兼容 HTTP/SSE 故障服务器，测 LLM 恢复路径。',
    need: '同上，属 harness 自测基建，不是我们的证明流程。',
    cost: '无（测试期）',
  },
  {
    name: '@deepseek-ai/dsh-web-search-exa',
    verdict: '不建议',
    why: '换 Exa 作 web 搜索供应商。',
    need: '需要 Exa API key；现有内置搜索够用。',
    cost: '无（替换供应商）',
  },
  {
    name: '@deepseek-ai/dsh-web-search-perplexity',
    verdict: '不建议',
    why: '换 Perplexity 作 web 搜索供应商。',
    need: '需要 Perplexity API key。',
    cost: '无（替换供应商）',
  },
  {
    name: '@deepseek-ai/dsh-e2b',
    verdict: '不建议',
    why: '远端 E2B 沙箱（含 fs / subprocess 实现）。',
    need: '本机已有本地沙箱与本地 Agda 2.9.0 定制版；远端沙箱没有 Agda，也拿不到 `_build/`。',
    cost: '无（执行后端）',
  },
  {
    name: '@deepseek-ai/dsh-host-open-in-app',
    verdict: '待评估',
    why: '「在本地应用打开」的宿主半边（应用目录 + 图标 + 启动端点）。',
    need: '配套客户端半边 `dsh-client-ui-open-in-app`；属 GUI 便利，不增强证明能力。',
    cost: '无（Web 路由）',
  },
  {
    name: '@deepseek-ai/dsh-api-workspace-files',
    verdict: '待评估',
    why: '工作区文件服务 + 客户端资源提供者（有界读、目录列举、实时元数据）。',
    need: '配套右侧边栏一族（`dsh-client-ui-sidebar-*`）；版本线为 alpha（0.1.5-alpha.x），与本机 0.1.2-rc.1 不同线。',
    cost: '无（Web 层）',
  },
  {
    name: '@deepseek-ai/dsh-client-file-upload',
    verdict: '待评估',
    why: '浏览器侧文件上传 / 流式接收 / 暂存回执。',
    need: '把外部资料（论文 PDF、Agda 片段）拖进会话时有用；alpha 线。',
    cost: '无（Web 层）',
  },
  {
    name: '@deepseek-ai/dsh-http-proxy',
    verdict: '不建议',
    why: '进程级出网代理策略。',
    need: '我们以本地编译为主，出网只走 web 搜索/注册源。',
    cost: '无',
  },
]

const MARKET_BY_NAME = new Map()
for (const row of MARKET) {
  for (const n of row.trio ?? [row.name]) MARKET_BY_NAME.set(n, row)
}

// ── 渲染 ────────────────────────────────────────────────────────────────────

const installed = installedPackages()
const target = targetVersion(installed)
const declared = declaredPackages()
const host = hostEnabledPackages(PRESET)

const { snap, stale, age, source, error } = await loadMarket()
const market = new Map(Object.entries(snap.packages ?? {}))
const missing = [...market.keys()].filter((n) => !installed.has(n)).sort()
const sameLine = (n) => target !== '' && (market.get(n)?.versions ?? []).includes(target)
const missingSameLine = missing.filter(sameLine)

const installedNotDeclared = [...installed.keys()].filter((n) => !declared.has(n) && !host.enabled.has(n)).sort()
const relevantNames = new Set([...MARKET_BY_NAME.keys()])
const relevantRows = MARKET.filter((r) => {
  const names = r.trio ?? [r.name]
  return names.some((n) => market.has(n) || installed.has(n))
})

const short = (n) => n.replace('@deepseek-ai/', '')
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - [...String(s)].length))

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        registry: snap.registry,
        fetchedAt: snap.fetchedAt,
        stale,
        cache: CACHE_FILE,
        targetVersion: target,
        counts: {
          market: market.size,
          installed: installed.size,
          declared: declared.size,
          hostEnabled: host.enabled.size,
          hostDisabled: host.disabled,
          missing: missing.length,
          missingSameLine: missingSameLine.length,
        },
        missing: missing.map((n) => ({
          name: n,
          latest: market.get(n)?.latest ?? '',
          sameLine: sameLine(n),
          description: market.get(n)?.description ?? '',
        })),
        relevant: relevantRows.map((r) => ({
          name: r.name,
          trio: r.trio ?? null,
          verdict: r.verdict,
          inMarket: (r.trio ?? [r.name]).every((n) => market.has(n)),
          installed: (r.trio ?? [r.name]).filter((n) => installed.has(n)),
          sameLine: sameLine(r.name),
          cost: r.cost,
          need: r.need,
          why: r.why,
        })),
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (SEARCH !== undefined) {
  const kw = SEARCH.toLowerCase()
  const hits = [...market.entries()]
    .filter(([n, p]) => n.toLowerCase().includes(kw) || p.description.toLowerCase().includes(kw))
    .sort((a, b) => a[0].localeCompare(b[0]))
  console.log(`# 市场搜索 "${SEARCH}"（注册源 ${snap.registry}，命中 ${hits.length}）\n`)
  if (hits.length === 0) console.log('（无命中）')
  for (const [n, p] of hits) {
    const tags = [installed.has(n) ? '已装' : '未装', sameLine(n) ? `同版本线 ${target}` : `无 ${target} 版本线`]
    console.log(`- \`${short(n)}\` [${tags.join(' / ')}] latest=${p.latest}`)
    if (p.description !== '') console.log(`  ${p.description}`)
  }
  process.exit(0)
}

console.log('# DSH 插件市场盘点（数学证明模式视角）\n')
console.log(`- 注册源：\`${snap.registry}\`（快照 ${snap.fetchedAt.slice(0, 19).replace('T', ' ')}，来源 ${source}${stale ? `，**陈旧 ${Math.round(age / 3600000)}h**` : ''}）`)
if (error !== undefined) console.log(`- ⚠ 联网失败已降级用旧快照：${error}`)
console.log(
  `- 本机 dsh 版本线：**${target || '未知'}**｜市场包：**${market.size}**｜已装：**${installed.size}**｜preset 声明：**${declared.size}**｜宿主启用行：**${host.enabled.size}**（禁用 ${host.disabled} / 共 ${host.total}）`,
)
console.log(`- 可装未装：**${missing.length}**（其中与本机同版本线 **${missingSameLine.length}**）`)
console.log(
  `- 已装未声明且非宿主启用：**${installedNotDeclared.length}**（三平面 provenance 见 \`scripts/plugins.mjs\`，那是已装侧唯一事实源）`,
)
console.log('')
console.log(`## 与证明工作相关的市场候选（${relevantRows.length} 条）\n`)
console.log('| 包 | 结论 | 版本线 | 成本 | 它是什么 / 还缺什么 |')
console.log('| --- | --- | --- | --- | --- |')
for (const r of relevantRows) {
  const names = r.trio ?? [r.name]
  const label = r.trio ? names.map(short).join(' + ') : short(r.name)
  const inMarket = names.every((n) => market.has(n))
  const verLine = inMarket ? (sameLine(r.name) ? `✅ ${target}` : `⚠ 无 ${target}`) : '不在市场'
  const desc = (market.get(r.name)?.description ?? installed.get(r.name)?.desc ?? '').slice(0, 120)
  const body = [r.why, r.need !== '' ? `**还缺**：${r.need}` : '', desc !== '' ? `**市场描述**：${desc}` : '']
    .filter((s) => s !== '')
    .join(' ')
  console.log(`| \`${label}\` | **${r.verdict}** | ${verLine} | ${r.cost} | ${body} |`)
}
console.log('')

if (SHOW_RELEVANT || SHOW_MISSING) {
  const list = SHOW_MISSING ? missing : missingSameLine
  console.log(`## 可装未装（${SHOW_MISSING ? '全部' : '同版本线'} ${list.length}）\n`)
  for (const n of list) {
    const p = market.get(n)
    console.log(`- \`${short(n)}\` ${p.latest}${relevantNames.has(n) ? ' ★' : ''} — ${p.description.slice(0, 110)}`)
  }
  console.log('')
}

console.log('## 要装的话，确切命令\n')
console.log('```bash')
console.log(`# 1) 装进 web profile（版本必须钉住：这些包的 latest dist-tag 常停在 0.0.1-rc.1）`)
const example = relevantRows.find((r) => r.verdict === '待评估' && sameLine(r.name))
console.log(`dsh plugin --profile web add ${(example?.trio ?? [example?.name ?? '@deepseek-ai/dsh-lsp']).map((n) => `${n}@${target}`).join(' ')}`)
console.log(`# 2) agent 平面加一行（工具/提示段）→ 编辑 agent.cordis.yml；宿主平面加一行 → ~/.dsh/profiles/web/cordis.patch.yml`)
console.log(`# 3) 冷档：装完要新开会话（composition 变了 → 缓存前缀失效，见 scripts/reload.mjs）`)
console.log('```')
console.log('')

if (SHOW_ALL) {
  const rest = missing.filter((n) => !relevantNames.has(n))
  const groups = new Map()
  for (const n of rest) {
    const g = /^@deepseek-ai\/dsh-([a-z]+)/.exec(n)?.[1] ?? 'other'
    groups.set(g, [...(groups.get(g) ?? []), n])
  }
  console.log(`## 其余可装未装（${rest.length}，按前缀分组——多为 harness 自测/UI/传输层）\n`)
  for (const [g, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`- **${g}** (${list.length})：${list.map(short).join(', ')}`)
  }
  console.log('')
}

console.log('> 结论：市场里**真正能加强证明流程的只有少数几个**（LSP 一族、会话检索、跨厂商子代理），')
console.log('> 而且每个都带前置条件（als 二进制 / 宿主开 sqlite 后端 / 外部账号）。')
console.log('> 装之前先看「还缺」列——**缺前置条件的包，装了也用不起来**。')
