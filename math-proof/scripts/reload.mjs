// 数学证明模式 — 热重载状态与操作指引（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/scripts/reload.mjs
//
// 回答一个问题：**改了东西，要不要新开会话？会不会丢进度/丢缓存？**
//
// 机制（读 harness 源码得到的事实）：
//   · standing mount 只以 `agent.cordis.yml` 的 **mtime+size** 为失效依据
//     （`dsh-agent-presets` 的 `compositionStamp`）；改插件文件不会让已运行的会话重挂载。
//   · `systemPrompt.section({ text })` 的 `text` **可以是函数**，每次装配 prompt 时重新求值
//     （`dsh-system-prompt` lib/index.js:330）→ 这是「不新开会话也能改提示词」的杠杆。
//   · 工具 `execute` 每次调用都会执行 → 只要它**每次去读最新实现**，逻辑就是热的。
//
// 结论分三档：热（本进程立即生效）/ 可热（需一次性重构）/ 冷（需新会话，且必然改缓存前缀）。

import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const composition = join(PRESET, 'agent.cordis.yml')

const rows = []
const add = (level, what, how) => rows.push(`| ${level} | ${what} | ${how} |`)

const st = statSync(composition)

/**
 * 运行中的 dsh 进程启动时间。
 * **为什么需要它**：Cordis 加载器对本地行用的是**无 cache-busting 的 `import(url)`**
 * （`cordis-plugin-loader` lib/index.js:275-281），而 Node 的 ESM 缓存按 URL 进程内固化——
 * 所以**改完插件代码，同进程里再挂载也只会拿到缓存的旧模块**（实证：同进程改文件后
 * 再 `import` 仍返回旧值，只有 `?v=` 能打破）。结论：**改 plugins/ 或 hooks/ 的代码 = 必须重启 dsh 进程**，
 * 「新会话」不够。这条以前写错了，2026-09-10 实测更正（两次「模式不可用」都栽在这里）。
 */
function dshProcessStart() {
  // 用 etimes（已运行秒数）算启动时间：不依赖本地化日期格式
  const out = spawnSync('bash', ['-lc', "ps -eo pid,etimes,args | grep '[d]sh' | grep -v grep | head -5"], { encoding: 'utf8' })
  const info = []
  for (const line of (out.stdout ?? '').trim().split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m === null) continue
    info.push({ pid: Number(m[1]), startedAt: Date.now() - Number(m[2]) * 1000, cmd: m[3].slice(0, 70) })
  }
  return info.sort((a, b) => a.startedAt - b.startedAt)[0] ?? null
}

const proc = dshProcessStart()
// **凡是会被静态 import 的代码都算冷档**：plugins/*.mjs、hooks/*.mjs，以及被它们静态 import 的 impl/*.mjs。
// 漏掉 impl/ 会让判定**误报「进程内已是当前代码」**（2026-09-10 实测踩到过：
// `impl/local-paths.mjs` 比进程新，却被报成「已是当前代码」）。
function codeFiles() {
  const out = []
  for (const dir of ['plugins', 'hooks', 'impl']) {
    const abs = join(PRESET, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) {
      if (!f.endsWith('.mjs') || f.endsWith('.tmp')) continue
      out.push({ f: `${dir}/${f}`, mtimeMs: statSync(join(abs, f)).mtimeMs })
    }
  }
  const cfg = join(PRESET, 'hooks', 'hooks.json')
  if (existsSync(cfg)) out.push({ f: 'hooks/hooks.json', mtimeMs: statSync(cfg).mtimeMs })
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs)
}
const plugins = codeFiles()

function newestHookMtime() {
  const dir = join(PRESET, 'hooks')
  if (!existsSync(dir)) return 0
  let newest = 0
  for (const f of readdirSync(dir)) {
    try {
      newest = Math.max(newest, statSync(join(dir, f)).mtimeMs)
    } catch {
      /* 忽略 */
    }
  }
  return newest
}

console.log('# 热重载状态（数学证明模式）\n')
console.log(`- composition: \`${composition}\``)
console.log(`  - mtime ${new Date(st.mtimeMs).toISOString()}｜size ${st.size}`)
console.log(`- 最新代码文件: \`${plugins[0].f}\`（${new Date(plugins[0].mtimeMs).toLocaleString()}）`)
console.log(`- composition 比插件新？**${st.mtimeMs > plugins[0].mtimeMs ? '是' : '否（composition 时间戳更旧 = 新会话不会重挂）'}**`)
if (proc === null) {
  console.log('- 运行中的 dsh 进程：**未检测到**（不影响结论；改了插件代码仍要重启进程才能生效）')
} else {
  const pluginNewer = plugins[0].mtimeMs > proc.startedAt
  const hooksNewer = newestHookMtime() > proc.startedAt
  console.log(`- dsh 进程: pid ${proc.pid}｜启动于 ${new Date(proc.startedAt).toLocaleString()}`)
  console.log(`- **插件代码比进程新？${pluginNewer ? '是 → ❗必须重启 dsh 进程（ESM 缓存：新会话不够）' : '否（进程内已是当前代码）'}**`)
  console.log(
    `- **钩子脚本比进程新？${hooksNewer ? '是 → 无需重启：钩子是每次调用新起进程，改完下一次调用即生效（但同一文件若被插件 import，插件那一侧仍是旧的）' : '否'}**`,
  )
}
console.log('')
console.log('> ⚠ **实测更正（2026-09-10）**：Cordis 加载器对本地行用**无 query 的 `import(url)`**，')
console.log('> Node 的 ESM 缓存按 URL 固化在进程内 → **同进程里「新会话/重挂载」不会重新加载插件模块**。')
console.log('> 所以：改 `plugins/**`、`hooks/**`、`hooks.json` 的**代码** → **必须重启 dsh 进程**；')
console.log('> 只有「每次用时读文件」的内容（`impl/discipline.md`、`impl/ruleset.mjs`、`impl/local-paths.json` 的值）才是真热。')
console.log('')

add('🔥 热', '`impl/discipline.md`（纪律文本）', '直接编辑即可；每次装配 prompt 重读（按 mtime 失效缓存）。**无需重启、不丢进度**')
add('🔥 热', '`impl/path-section.md`（「本机路径」小节的**文字模板**）', '每次装配同步读盘 + mtime 缓存 → **改这段文字不用重启进程**（真实事故：这段文字曾写在代码里，一个 `{{key}}` 示例让整轮运行失败，且因 ESM 缓存必须重启才能修；搬到模板文件后同类问题改文件即生效）。占位符 `{paths}` 展开成键值清单；模板里也可用 `{{键名}}` 引用真值')
add('🔥 热', '任何「每次使用时读文件」的实现', '把易变内容放 `impl/` 下，运行时读取（见本 preset 的 `disciplineText()`）')
add('❄️ 冷', '**判定规则**：`impl/ruleset.mjs`（断链豁免 / 评分权重 / postulate 口径 / 编译爆炸分诊 / 草稿文件模式）', '**静态 import**：改规则要**重启 dsh 进程**（2026-09-10 决策：「冷的」——原先用 `?v=<mtime>` 动态 import 即时生效，那个 cache-busting 是本 preset 唯一自造的机制，已删除）。改规则请 bump `RULESET_VERSION`；`proof_dag action:"doctor"` 会报「磁盘 hash vs 进程内 hash」，落后就说明没重启')
add('🟡 可热', '工具**执行逻辑**（结构已抽出规则的部分）', '规则已抽到 `impl/ruleset.mjs`；**剩余结构改动**（新 action、字段语义、输出格式）仍属冷档，但 `proof_dag action:"doctor"` 会明确报「插件本体落后于磁盘」，不再靠人肉 diff')
add('🔥 热', '`prover_limits` / 台账 / 见证（数据，非代码）', '数据层本来就每次读写磁盘；改的是内容不是规则')
add('❄️ 冷', '`plugins/**`、`hooks/**`、`hooks.json` 的**代码**', '**必须重启 dsh 进程**——Cordis 用无 query 的 `import(url)`，Node 的 ESM 缓存按 URL 固化：同进程重挂载拿到的仍是旧模块（实测：改文件后再 import 仍是旧值，只有 `?v=` 能打破）。**「新会话」在这里不够**（2026-09-10 更正）')
add('❄️ 冷', '工具**描述 / schema**、`agent.cordis.yml` 行、persona', '改这些既改缓存前缀、又要重挂载：需**重启进程**（顺带解决上面的 ESM 缓存问题）。前缀缓存失效是物理必然')
add('❄️ 冷', '技能正文（`skills/**`）', '技能是**按需加载**的：已加载的技能正文进入消息历史后不会变；改文件只影响**之后**新加载的技能')
console.log('| 档位 | 对象 | 做法 |')
console.log('| --- | --- | --- |')
console.log(rows.join('\n'))
console.log('')
console.log('## 缓存与进度的代价（必须说清）')
console.log('- 改**工具逻辑**（不动描述/schema）→ 前缀字节不变 → **缓存完全不失效**。')
console.log('- 改**纪律 / persona / 工具描述**→ 前缀字节变 → 下一轮**前缀缓存失效**（这是物理必然，不是缺陷）；')
console.log('  但**会话与进度保留**：对话历史、台账、见证仓库都不动。')
console.log('- 改**插件源码**（非 impl/ruleset）→ 已运行的会话看不到（standing mount 不重挂）；要么改成热加载，要么新开会话。')
console.log('  **判断方法：先跑 `proof_dag action:"doctor"`**——它报「本实例 vs 磁盘」的插件本体哈希与规则集版本；')
console.log('  规则集不一致 = 本次结果已按新规则算（热）；插件本体落后 = 结构是旧的（引用分数必须连同哈希一起说）。')
console.log('')
console.log('## 一句话')
console.log('**真热（同进程立即生效）：①`impl/discipline.md` / `impl/path-section.md` 的文本；②`impl/local-paths.json` 的值；')
console.log('③ `hooks/*.mjs` 与它们 import 的模块（钩子每次调用都是新起进程加载）。**')
console.log('**必须重启 dsh 进程：`plugins/**` 代码、`impl/ruleset.mjs`（静态 import 的冷档）、`hooks/hooks.json`、')
console.log('工具描述/schema、persona、`agent.cordis.yml`**——它们经 Cordis 的无 query `import(url)` 在进程内固化。')
console.log('注意：`impl/session-traffic.mjs` / `impl/budget-policy.mjs` 同时被钩子（热）与 `plugins/budget.mjs`（冷）引用，')
console.log('所以「钩子行为立刻变、`budget` 工具要重启才变」是正常现象，不是没生效。')
