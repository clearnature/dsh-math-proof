// 数学证明模式 — 热重载认知门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/reload-check.mjs
// 期望最后一行：RELOAD_OK n/n
//
// 为什么要有它（真实事故 2026-09-10）：
//   我们（和文档）一直以为「改完插件 → 开新会话就能生效」。**错**：
//   Cordis 加载器对本地行用**无 cache-busting 的 `import(url)`**（`cordis-plugin-loader` lib/index.js:275-281），
//   而 Node 的 ESM 缓存按 URL 在进程内固化 → 同进程里重新挂载只会拿到**缓存的旧模块**。
//   于是「修好了磁盘上的插件、用户重启会话后仍然报同一个错」，白白浪费一轮。
//
// 本门禁钉死三件事：
//   1. `scripts/reload.mjs` 能跑，且**给出「必须重启进程」的判定**（含 code mtime vs 进程启动时间）；
//   2. 冷档覆盖 `plugins/**`、`hooks/**`（以及被静态 import 的 `impl/*.mjs`）——漏一个就会误判；
//   3. **文档不得再写「新会话即可」**：README / M5 / 组合头里必须出现「重启（进程）」这条更正。

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

const run = spawnSync(process.execPath, [join(PRESET, 'scripts', 'reload.mjs')], { encoding: 'utf8', timeout: 60000 })
const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`

ok('reload.mjs 退出 0', run.status === 0, `exit ${run.status}`)
ok('reload 报告有「最新代码文件」行（含 impl/ 与 hooks/）', /最新代码文件/.test(out), out.split('\n')[3] ?? '')
ok('reload 判定含「必须重启」语义', /必须重启|进程内已是当前代码/.test(out))
ok('reload 说明 ESM 缓存这一机制', /ESM 缓存/.test(out) && /import\(url\)|import\(.*\)/.test(out))
ok('reload 冷档列出 plugins/** 与 hooks/**', /plugins\/\*\*/.test(out) && /hooks\/\*\*/.test(out))

// 判定逻辑本身可测：把「代码文件收集」覆盖三个目录（通过输出行数间接验证太弱，这里直接查源码）
const src = readFileSync(join(PRESET, 'scripts', 'reload.mjs'), 'utf8')
ok('codeFiles() 覆盖 plugins / hooks / impl 三目录', /for \(const dir of \['plugins', 'hooks', 'impl'\]\)/.test(src), '')
ok('codeFiles() 把 hooks.json 也算进冷档', /hooks\/hooks\.json/.test(src))

// 规则已退回冷档（2026-09-10 决策「冷的」）：reload 输出里不得再把规则说成热读
ok('reload 不再把 impl/ruleset.mjs 说成热读', !/ruleset\.mjs[^\n]*热读|热读[^\n]*ruleset/.test(out), '')
ok('reload 把规则列为冷档（需重启）', /❄️ 冷[^\n]*ruleset\.mjs/.test(out.replace(/\n/g, '\n')) || /判定规则[^\n]*静态 import/.test(out), '')
{
  const src = readFileSync(join(PRESET, 'scripts', 'reload.mjs'), 'utf8')
  // 只查**肯定式**：规则那行不得再说「动态 import → 立即生效」（历史说明允许保留）
  // 只取**档位表那一行**（以 add(' 开头），不要误取说明性段落
  const ruleRow = src.split('\n').find((l) => l.trim().startsWith("add('") && l.includes('ruleset.mjs')) ?? ''
  ok('reload.mjs 的规则行是冷档口径（静态 import + 重启）', ruleRow.includes('静态 import') && ruleRow.includes('重启'), ruleRow.slice(0, 60))
  ok('reload.mjs 的规则行不再宣称「立即生效」', !/立即生效/.test(ruleRow), ruleRow.slice(0, 60))
}

// 文档更正：不得再出现「新会话即可」的旧说法
for (const rel of ['README.md', 'docs/maps/M5-lifecycle.md', 'agent.cordis.yml']) {
  const text = readFileSync(join(PRESET, rel), 'utf8')
  const mentionsRestart = /重启( dsh)? ?进程|必须重启/.test(text)
  ok(`${rel} 写明「改代码需重启进程」`, mentionsRestart, '')
}

// 反面：README 的旧口径若残留「需新会话」描述插件代码即失败
{
  const readme = readFileSync(join(PRESET, 'README.md'), 'utf8')
  // 只在**肯定式**（「需要新会话」）时失败——该行同时出现「新会话」是校正括注（「新会话在这里不够」）
  const bad = /(plugins|hooks)\/\*\*[^\n]*需要新会话|插件[^\n]{0,20}需要新会话|插件代码[^\n]{0,12}新会话即可/.test(readme)
  ok('README 没有再把「插件代码改动」说成「新会话即可」', !bad, bad ? '仍写着新会话' : '')
}

console.log('# 热重载认知门禁（ESM 缓存 / 冷档覆盖 / 文档更正）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'RELOAD_OK' : 'RELOAD_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
