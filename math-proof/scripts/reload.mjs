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

import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const composition = join(PRESET, 'agent.cordis.yml')

const rows = []
const add = (level, what, how) => rows.push(`| ${level} | ${what} | ${how} |`)

const st = statSync(composition)
const plugins = ['proof-dag.mjs', 'proof-discipline.mjs', 'agda-engine.mjs', 'proof-graph.mjs', 'prover-limits.mjs', 'python-oracle.mjs']
  .map((f) => ({ f, mtimeMs: existsSync(join(PRESET, 'plugins', f)) ? statSync(join(PRESET, 'plugins', f)).mtimeMs : 0 }))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)

console.log('# 热重载状态（数学证明模式）\n')
console.log(`- composition: \`${composition}\``)
console.log(`  - mtime ${new Date(st.mtimeMs).toISOString()}｜size ${st.size}`)
console.log(`- 最新插件: \`${plugins[0].f}\`（${new Date(plugins[0].mtimeMs).toISOString()}）`)
console.log(`- composition 比插件新？**${st.mtimeMs > plugins[0].mtimeMs ? '是（新会话会挂载最新代码）' : '否（需 touch composition 才会被新会话看到）'}**`)
console.log('')

add('🔥 热', '`impl/discipline.md`（纪律文本）', '直接编辑即可；每次装配 prompt 重读（按 mtime 失效缓存）。**无需新会话、不丢进度**')
add('🔥 热', '任何「每次使用时读文件」的实现', '把易变内容放 `impl/` 下，运行时读取（见本 preset 的 `disciplineText()`）')
add('🔥 热', '**判定规则**：`impl/ruleset.mjs`（断链豁免 / 评分权重 / postulate 口径 / 编译爆炸分诊 / 草稿文件模式）', '工具每次调用带 `?v=<mtime>` 动态 import → **改规则立即生效，不重挂载、缓存不失效**；输出里带 `规则集 rN/hash` 戳，改规则请同时 bump `RULESET_VERSION`（否则两次不同规则的分数会被当成同一条曲线）')
add('🟡 可热', '工具**执行逻辑**（结构已抽出规则的部分）', '规则已抽到 `impl/ruleset.mjs`；**剩余结构改动**（新 action、字段语义、输出格式）仍属冷档，但 `proof_dag action:"doctor"` 会明确报「插件本体落后于磁盘」，不再靠人肉 diff')
add('🔥 热', '`prover_limits` / 台账 / 见证（数据，非代码）', '数据层本来就每次读写磁盘；改的是内容不是规则')
add('❄️ 冷', '工具**描述 / schema**、`agent.cordis.yml` 行、persona', '改这些 = 改缓存前缀：即使新开会话，该前缀缓存也必然失效（物理必然）。改动后需**新会话**才生效')
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
console.log('**能不新开会话的：纪律文本 + `impl/` 下的判定规则与实现；必须新会话的：描述/schema/persona/composition。**')
console.log('改完不需要任何命令——下一次模型请求即生效（热档位）。')
