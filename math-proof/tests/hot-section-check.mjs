// 数学证明模式 — 提示段「文字可热」门禁（零依赖）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/hot-section-check.mjs
// 期望最后一行：HOT_SECTION_OK n/n
//
// 为什么要有它（真实事故 2026-09-10）：
//   「本机路径」小节的**文字**原先写在 `impl/local-paths.mjs` 的代码里。文字里一个示例 `{{key}}`
//   被 dsh-system-prompt 当成未注册变量 → **整轮运行失败**；而我修好磁盘后仍然报同样的错，
//   因为 Cordis 用**无 cache-busting 的 `import(url)`**、Node 的 ESM 缓存按 URL 固化 ——
//   **改代码必须重启进程**。
//
//   根治办法：把「文字」从代码里搬到**每次装配都读盘**的模板 `impl/path-section.md`。
//   Cordis 的 section text 是**同步**调用（不能 `?v=` 动态 import），所以「读文件」是唯一可行的热路径。
//
// 本门禁证明三件事：
//   1. 模板文件存在且被真正使用（改默认模板 → 输出跟着变）；
//   2. **同进程内**改模板 → 再取一次立刻是新文字（不重启、不重挂载）；
//   3. 渲染结果里**不残留任何花括号**（否则整轮装配会失败）。

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

// ── 同进程热读实验：env 指向临时模板（必须在 import 之前设置）────────────────
const tmp = mkdtempSync(join(tmpdir(), 'math-proof-hot-'))
const tpl = join(tmp, 'tpl.md')
writeFileSync(tpl, '### 临时小节 A\n\n{paths}\n\n> 标记：AAA\n')
process.env.MATH_PROOF_PATH_SECTION = tpl

const lp = await import(join(PRESET, 'impl', 'local-paths.mjs'))
const first = lp.renderPathSection({})

ok('模板 A 生效（含标记 AAA）', first.includes('AAA'), first.slice(0, 60))
ok('{paths} 被展开成键值清单', first.includes('**workspace**') && first.includes('**wiki**'), '')
ok('渲染结果不含花括号', !first.includes('{{') && !first.includes('}}'), '')

// **同进程**改模板 — 关键：不重启、不重新 import 模块
writeFileSync(tpl, '### 临时小节 B\n\n{paths}\n\n> 标记：BBB 第二版文字\n')
const second = lp.renderPathSection({})
ok('同进程改模板后立刻是新文字（无需重启/重挂载）', second.includes('BBB') && !second.includes('AAA'), second.slice(0, 60))
ok('改文字后键值清单仍在（值也是每次重读）', second.includes('**workspace**'), '')

// 值也要热：改 JSON 里的什么？这里用 env 覆盖验证「值来自运行时解析」
const withEnv = lp.renderPathSection({ SOVEREIGN_REPO: '/tmp/hot-repo' })
ok('值可用 env 覆盖且当次生效', withEnv.includes('/tmp/hot-repo'), '')

// ── 默认真身：仓库里的模板 ────────────────────────────────────────────────
delete process.env.MATH_PROOF_PATH_SECTION
const cfgTemplate = join(PRESET, 'impl', 'path-section.md')
ok('仓库自带模板 impl/path-section.md 存在', existsSync(cfgTemplate))
if (existsSync(cfgTemplate)) {
  const wording = readFileSync(cfgTemplate, 'utf8')
  ok('模板含 {paths} 占位符', wording.includes('{paths}'), '')
  // 用一个独立子进程加载模块（避免上面的 env 影响），断言默认模板真的被用上
  const { spawnSync } = await import('node:child_process')
  // 子进程里**必须把 MATH_PROOF_PATH_SECTION 去掉**（置空串会走 '' 路径 → 落到内置兜底模板）
  const cleanEnv = { ...process.env }
  delete cleanEnv.MATH_PROOF_PATH_SECTION
  const r = spawnSync(
    process.execPath,
    ['-e', `import(${JSON.stringify(join(PRESET, 'impl', 'local-paths.mjs'))}).then(m=>console.log(m.renderPathSection({})))`],
    { encoding: 'utf8', env: cleanEnv },
  )
  const outText = r.stdout ?? ''
  const marker = wording.split('\n').find((l) => l.startsWith('> ') && l.length > 20)
  ok('默认模板内容出现在渲染结果里', marker !== undefined && outText.includes(marker.trim()), marker?.slice(0, 40) ?? '')
  ok('默认渲染同样不含花括号', !outText.includes('{{'), '')
}

// ── 集成：纪律段（注入真身）——同样在**干净环境**的子进程里验，避免本文件顶部的
//    env 覆盖与 ESM 模块缓存互相干扰（本进程里的 local-paths 模块已绑定到临时模板）
{
  const { spawnSync } = await import('node:child_process')
  const cleanEnv = { ...process.env }
  delete cleanEnv.MATH_PROOF_PATH_SECTION
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      `import(${JSON.stringify(join(PRESET, 'plugins', 'proof-discipline.mjs'))}).then(m=>{const t=m.disciplineWithPaths();console.log(JSON.stringify({hasSection:t.includes('本机路径'),braces:/\{\{|\}\}/.test(t),len:t.length}))})`,
    ],
    { encoding: 'utf8', env: cleanEnv },
  )
  let j = null
  try {
    j = JSON.parse((r.stdout ?? '').trim().split('\n').pop())
  } catch {
    /* 解析失败按下面的断言报错 */
  }
  ok('纪律段包含「本机路径」小节', j?.hasSection === true, JSON.stringify(j))
  ok('纪律段注入文本无花括号（否则整轮装配失败）', j?.braces === false, JSON.stringify(j))
}

rmSync(tmp, { recursive: true, force: true })

console.log('# 提示段文字可热门禁（模板热读 / 同进程生效 / 无花括号）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'HOT_SECTION_OK' : 'HOT_SECTION_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
