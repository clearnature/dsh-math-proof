// 数学证明模式 — **挂载副本体检**（零依赖）
//
// 用法：
//   node <preset>/scripts/doctor.mjs                 # 体检「本脚本所在的这份 preset」
//   node <preset>/scripts/doctor.mjs --vs <仓库目录>  # 再加一项：挂载副本 vs 源仓库有没有漂移
//   node <preset>/scripts/doctor.mjs --json          # 机器可读
//   node <preset>/scripts/doctor.mjs --allow-drift    # 漂移只报不判红（默认漂移=红）
//
// 期望最后一行：`DOCTOR_OK n/n` 或 `DOCTOR_FAIL n/n`。
//
// ── 为什么需要它（真实事故，不是假想）──────────────────────────────────────
//   2026-09-10：安装副本里 `hooks/hooks.json` 仍指向**已删除**的 `hooks/stop-reminder.mjs`
//   （仓库侧删了、更新了 hooks.json，副本只同步了一半）——
//   结果 **Stop 钩子连续失败 38 次**（`exit 1 / Cannot find module`），而仓库里那一套门禁
//   **全绿**：因为仓库是自洽的，`hooks-check` 检查的是仓库自己。
//   **仓库自测看不见安装副本** —— 所以「脚本能不能跑」和「现在挂载的这份能不能用」是两个问题。
//
// 本脚本只**读**，不改任何东西：它回答一句话——「现在这份 preset 是完整的吗」。

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = dirname(HERE)

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : (argv[i + 1] ?? '')
}
const has = (name) => argv.includes(`--${name}`)

const ROOT = flag('root') ?? DEFAULT_ROOT
const VS = flag('vs')
const AS_JSON = has('json')
const ALLOW_DRIFT = has('allow-drift')

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push({ ok: cond === true, name, detail: String(detail).slice(0, 200) })
  if (cond !== true) failures++
}

// ── 1) 骨架：这份 preset 有没有「缺胳膊少腿」 ───────────────────────────────
const SKELETON = ['preset.yml', 'agent.cordis.yml', 'hooks/hooks.json', 'plugins', 'impl', 'skills']
for (const rel of SKELETON) ok(`骨架存在：${rel}`, existsSync(join(ROOT, rel)), join(ROOT, rel))

// ── 2) 钩子：hooks.json 里每一条命令的**目标文件**都必须真的在 ──────────────
// （这正是上面那次事故的检查点）
const HOOK_POINTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']
let hookCount = 0
{
  const file = join(ROOT, 'hooks', 'hooks.json')
  let cfg = null
  try {
    cfg = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    ok('hooks.json 能解析', false, e instanceof Error ? e.message : String(e))
  }
  if (cfg !== null) {
    ok('hooks.json 能解析', true)
    const points = Object.keys(cfg.hooks ?? {})
    for (const p of points) ok(`hooks.json 的事件名是官方认识的（${p}）`, HOOK_POINTS.includes(p), `认识：${HOOK_POINTS.join('/')}`)
    for (const [point, groups] of Object.entries(cfg.hooks ?? {})) {
      for (const group of groups ?? []) {
        for (const h of group.hooks ?? []) {
          hookCount++
          const cmd = String(h.command ?? '')
          const m = /\$\{CLAUDE_PLUGIN_ROOT\}\/(\S+?)"/.exec(cmd)
          ok(`[${point}] 钩子命令用 \${CLAUDE_PLUGIN_ROOT} 且以 node 起`, cmd.startsWith('node "') && m !== null, cmd.slice(0, 90))
          if (m !== null) ok(`[${point}] 钩子目标文件存在：${m[1]}`, existsSync(join(ROOT, m[1])), join(ROOT, m[1]))
          ok(`[${point}] 钩子 timeout 是正整数`, Number.isInteger(h.timeout) && h.timeout > 0, String(h.timeout))
        }
      }
    }
    ok('hooks.json 至少挂了一个钩子', hookCount > 0, String(hookCount))
  }
}

// ── 3) 组合：agent.cordis.yml 里引用的**本地文件**必须都在 ──────────────────
// 两种写法（本 preset 都用）：`name: './plugins/x.mjs'` 与 `new URL('hooks/hooks.json', baseUrl)`
{
  const file = join(ROOT, 'agent.cordis.yml')
  if (existsSync(file)) {
    const yml = readFileSync(file, 'utf8')
    const refs = new Set()
    for (const m of yml.matchAll(/^\s*name:\s*'(\.\/[^']+)'/gm)) refs.add(m[1].replace(/^\.\//, ''))
    for (const m of yml.matchAll(/new URL\('([^']+)',\s*baseUrl\)/g)) refs.add(m[1])
    ok('组合里引用了本地文件（不是空壳）', refs.size > 0, [...refs].join(', '))
    for (const rel of [...refs].sort()) ok(`组合引用存在：${rel}`, existsSync(join(ROOT, rel)), join(ROOT, rel))
  }
}

// ── 4) 插件：每个 plugins/*.mjs 都要能**加载**且导出 `name` + `apply` ────────
// （挂载期报错就是整个会话起不来——这是「无法使用」最硬的一种）
{
  const dir = join(ROOT, 'plugins')
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()
    ok('plugins/ 里有插件', files.length > 0, String(files.length))
    for (const f of files) {
      let mod = null
      try {
        mod = await import(pathToFileURL(join(dir, f)).href)
      } catch (e) {
        ok(`插件可加载：${f}`, false, e instanceof Error ? e.message : String(e))
        continue
      }
      ok(`插件可加载：${f}`, true)
      ok(`插件导出 name：${f}`, typeof mod.name === 'string' && mod.name !== '', String(mod.name))
      ok(`插件导出 apply()：${f}`, typeof mod.apply === 'function', typeof mod.apply)
    }
  }
}

// ── 5) 技能：每个 skills/*/SKILL.md 要有 name/description，且 name == 目录名 ──
// （技能名不符 = 模型 `skill` 调用报「unknown or no longer available」，实测发生过 2 次）
{
  const dir = join(ROOT, 'skills')
  if (existsSync(dir)) {
    const dirs = readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort()
    ok('skills/ 里有技能', dirs.length > 0, String(dirs.length))
    for (const d of dirs) {
      const f = join(dir, d, 'SKILL.md')
      if (!existsSync(f)) {
        ok(`技能有 SKILL.md：${d}`, false, f)
        continue
      }
      const text = readFileSync(f, 'utf8')
      const fm = /^---\n([\s\S]*?)\n---/.exec(text)
      const name = fm === null ? undefined : /^name:\s*(.+)$/m.exec(fm[1])?.[1]?.trim()
      const desc = fm === null ? undefined : /^description:\s*(.+)$/m.exec(fm[1])?.[1]?.trim()
      ok(`技能有 frontmatter name/description：${d}`, typeof name === 'string' && name !== '' && typeof desc === 'string' && desc !== '', `name=${name ?? '无'}`)
      ok(`技能名与目录名一致：${d}`, name === d, `目录=${d} name=${name ?? '无'}`)
    }
  }
}

// ── 6) preset.yml：名册元数据能被宿主读到（显示名/描述） ────────────────────
{
  const file = join(ROOT, 'preset.yml')
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8')
    ok('preset.yml 有 name', /^name:\s*\S/m.test(text), '')
    ok('preset.yml 有 description', /^description:\s*\S/m.test(text), '')
  }
}

// ── 7) 漂移（可选）：挂载副本 vs 源仓库 ─────────────────────────────────────
// 上面那次事故的本质就是「副本落后于仓库」→ 这一项直接量它。
if (VS !== undefined && VS !== '') {
  const SKIP = new Set(['state', '__pycache__', 'node_modules', '.git'])
  const walk = (base, dir = '') => {
    const out = []
    const abs = join(base, dir)
    if (!existsSync(abs)) return out
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const rel = dir === '' ? e.name : `${dir}/${e.name}`
      if (e.isDirectory()) out.push(...walk(base, rel))
      else out.push(rel)
    }
    return out
  }
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
  const a = new Set(walk(ROOT))
  const b = new Set(walk(VS))
  const missing = [...b].filter((f) => !a.has(f)) // 仓库有、副本没有 = 漏同步
  const extra = [...a].filter((f) => !b.has(f)) // 副本有、仓库没有 = 陈旧残留
  const changed = [...a].filter((f) => b.has(f) && sha(join(ROOT, f)) !== sha(join(VS, f))).slice(0, 40)
  const drift = missing.length > 0 || extra.length > 0 || changed.length > 0
  ok(
    `与源仓库一致（${relative(process.cwd(), VS) || VS}）`,
    !drift || ALLOW_DRIFT,
    drift ? `漏同步 ${missing.length}｜残留 ${extra.length}｜内容不同 ${changed.length}${missing.length > 0 ? `｜例：${missing.slice(0, 5).join(', ')}` : ''}${extra.length > 0 ? `｜残留例：${extra.slice(0, 5).join(', ')}` : ''}` : '',
  )
}

// ── 输出 ───────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length
const verdict = failures === 0 ? 'DOCTOR_OK' : 'DOCTOR_FAIL'
if (AS_JSON) {
  process.stdout.write(`${JSON.stringify({ root: ROOT, vs: VS ?? null, verdict, passed, total: results.length, results }, null, 2)}\n`)
} else {
  console.log(`# 挂载副本体检（doctor）\n\n- 体检对象：\`${ROOT}\`${VS === undefined ? '' : `\n- 对照仓库：\`${VS}\``}\n- 钩子 ${hookCount} 条｜检查项 ${results.length} 条\n`)
  for (const r of results) console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.detail === '' || r.ok ? '' : ` — ${r.detail}`}`)
  console.log(`\n${verdict} ${passed}/${results.length}`)
}
process.exit(failures === 0 ? 0 : 1)
