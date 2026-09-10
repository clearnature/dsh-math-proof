// 数学证明模式 — 开源发布准备脚本回归（零依赖，全部在临时目录里做）
//
// 用法：node ~/.dsh/.agent-presets/math-proof/tests/publish-check.mjs
// 期望最后一行：PUBLISH_OK n/n
//
// 为什么这么测：发布脚本一旦出错，后果是**把本机状态发到公网**（市场快照、宿主组合 dump）
// 或**漏文件**（用户装不上）。所以钉死三件事：
//   1. `state/` 与临时文件必须被排除；
//   2. 目录布局必须是 `<out>/<preset-id>/agent.cordis.yml`（dsh 的 `scanRoot` 只认这一种）；
//   3. 生成物必须齐（.gitignore / LICENSE / 根 README 带安装片段），且非空目录必须拒绝覆盖。

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const HERE = new URL('.', import.meta.url).pathname.replace(/\/$/, '')
const PRESET = dirname(HERE)
const SCRIPT = join(PRESET, 'scripts', 'publish.mjs')
const ID = 'math-proof'

const results = []
let failures = 0
const ok = (name, cond, detail = '') => {
  results.push(`${cond ? '✅' : '❌'} ${name}${cond || detail === '' ? '' : ` — ${detail}`}`)
  if (!cond) failures++
}

const run = (args) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 120000 })
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() }
}

const tmp = mkdtempSync(join(tmpdir(), 'math-proof-publish-'))
const out = join(tmp, 'repo')
try {
  // ── 1) dry-run：只报告，不落盘 ───────────────────────────────────────────
  const dry = run(['--out', out, '--dry-run', '--json'])
  ok('dry-run 退出 0', dry.code === 0, `exit ${dry.code} ${dry.err.slice(0, 200)}`)
  let j = null
  try {
    j = JSON.parse(dry.out)
    ok('dry-run JSON 可解析', true)
  } catch (err) {
    ok('dry-run JSON 可解析', false, String(err.message))
  }
  if (j !== null) {
    ok('dry-run 不落盘', !existsSync(out))
    ok('dry-run 报告要发布的文件数 > 40', j.files > 40, String(j.files))
    // 新克隆 / CI 里没有 `state/`（它本来就不进版本库）→ 期望值随文件系统走，不写死
    const hasState = existsSync(join(PRESET, 'state'))
    ok(
      hasState ? '排除 state/ 机器状态文件' : '无 state/ 可排除（新克隆，符合预期）',
      hasState ? j.excludedStateFiles >= 1 : j.excludedStateFiles === 0,
      String(j.excludedStateFiles),
    )
    ok('无密钥假阳性（跳过扫描器自身）', j.secretHits === 0, `hits=${j.secretHits}`)
    ok('绝对路径清单里没有扫描器自身', !j.absolutePathFiles.includes('scripts/publish.mjs'), j.absolutePathFiles.join(','))
    // 路径集中化之后：唯一配置处 + 历史/快照（不改写）之外，不应再有文件含机器绝对路径
    const pathReal = j.absolutePathFiles.filter(
      (f) => f === 'impl/local-paths.json' || f === 'AUDIT.md' || f === 'audit/rounds.md' || f.startsWith('docs/releases/'),
    )
    ok(
      '绝对路径只出现在唯一配置处与历史记录里',
      pathReal.length === j.absolutePathFiles.length && j.absolutePathFiles.includes('impl/local-paths.json'),
      j.absolutePathFiles.join(','),
    )
  }

  // ── 2) 真发布：布局与生成物 ─────────────────────────────────────────────
  const real = run(['--out', out, '--json'])
  ok('发布退出 0', real.code === 0, `exit ${real.code} ${real.err.slice(0, 200)}`)
  const made = JSON.parse(real.out)
  ok('实际写入文件数 = 清单文件数', made.written === made.files, `${made.written}/${made.files}`)

  ok('布局：<out>/<preset-id>/agent.cordis.yml 存在', existsSync(join(out, ID, 'agent.cordis.yml')))
  ok('布局：preset.yml 存在', existsSync(join(out, ID, 'preset.yml')))
  ok('布局：plugins 目录存在', existsSync(join(out, ID, 'plugins')))
  ok('布局：preset 目录在仓库根之下（根不是 preset 目录）', !existsSync(join(out, 'agent.cordis.yml')))

  const gates = existsSync(join(out, '.github', 'workflows', 'gates.yml')) ? readFileSync(join(out, '.github', 'workflows', 'gates.yml'), 'utf8') : ''
  const wfAll = ['gates.yml', 'release.yml'].map((f) => (existsSync(join(out, '.github', 'workflows', f)) ? readFileSync(join(out, '.github', 'workflows', f), 'utf8') : '')).join('\n')
  ok('工作流不依赖已弃用的 action 主版本（v4 目标 Node 20）', !/@v4\b/.test(wfAll), (wfAll.match(/actions\/[a-z-]+@v\d+/g) ?? []).join(' '))
  ok('生成 CI 工作流（仓库骨架可复现）', existsSync(join(out, '.github', 'workflows', 'gates.yml')) && readFileSync(join(out, '.github', 'workflows', 'gates.yml'), 'utf8').includes('check-all.mjs'))
  const pkg = existsSync(join(out, 'package.json')) ? JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')) : null
  ok('生成 package.json（scoped 名 + files 白名单）', pkg !== null && pkg.name.startsWith('@') && Array.isArray(pkg.files) && pkg.files.includes(`${ID}/`), JSON.stringify(pkg?.name))
  ok('package.json 声明零运行时依赖', pkg !== null && Object.keys(pkg.dependencies).length === 0)
  ok('package.json 为 private（禁止误发 npm）', pkg?.private === true && pkg?.publishConfig === undefined, JSON.stringify({ private: pkg?.private, publishConfig: pkg?.publishConfig }))
  // npm 账号受限 → 不发 npm：工作流里不得有 npm publish，且 package.json 必须 private
  const relWf = existsSync(join(out, '.github', 'workflows', 'release.yml')) ? readFileSync(join(out, '.github', 'workflows', 'release.yml'), 'utf8') : ''
  ok('生成 release 工作流（打离线包附 Release）', relWf.includes('gh release upload') && relWf.includes('sha256sum'))
  ok('release 工作流不含 npm publish', !/^\s*run:.*npm publish/m.test(relWf))
  ok('release 工作流自带「禁止 npm publish」检查', relWf.includes('不得出现未授权的 npm 发布'))
  ok('不再生成 publish.yml', !existsSync(join(out, '.github', 'workflows', 'publish.yml')))
  ok('生成 .npmignore（挡住 state/ 与机器生成物）', existsSync(join(out, '.npmignore')) && readFileSync(join(out, '.npmignore'), 'utf8').includes('state/'))
  ok('生成 .gitignore', existsSync(join(out, '.gitignore')) && readFileSync(join(out, '.gitignore'), 'utf8').includes('state/'))
  const lic = existsSync(join(out, 'LICENSE')) ? readFileSync(join(out, 'LICENSE'), 'utf8') : ''
  ok('生成 MIT LICENSE', lic.startsWith('MIT License'), lic.slice(0, 40))
  const readme = existsSync(join(out, 'README.md')) ? readFileSync(join(out, 'README.md'), 'utf8') : ''
  ok('根 README 说明装法（roots 片段）', readme.includes('- id: agent-presets') && readme.includes('roots:'))
  ok('根 README 说明依赖（Agda / Python）', readme.includes('Agda') && readme.includes('Python'))
  ok('根 README 说明绝对路径需替换', readme.includes('绝对路径'))

  // ── 3) 不发布本机状态：递归确认 ─────────────────────────────────────────
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  const all = walk(out)
  ok('发布树里没有 state/ 目录', !all.some((f) => f.includes(`/${'state'}/`)), all.filter((f) => f.includes('state')).join(','))
  ok('发布树里没有临时文件', !all.some((f) => /\.tmp-\d+$/.test(f)))
  ok('发布树里没有机器生成物（__pycache__ / .pyc / .agdai）', !all.some((f) => /__pycache__|\.pyc$|\.agdai$/.test(f)), all.filter((f) => /__pycache__|\.pyc$/.test(f)).join(','))
  ok('.gitignore 挡住机器生成物', readFileSync(join(out, '.gitignore'), 'utf8').includes('__pycache__'))
  ok('发布树里有 check-all（用户可自检）', all.some((f) => f.endsWith('scripts/check-all.mjs')))

  // ── 4) 非空目录必须拒绝覆盖 ─────────────────────────────────────────────
  const again = run(['--out', out])
  ok('非空目录拒绝覆盖（需 --force）', again.code !== 0 && /非空/.test(`${again.out}${again.err}`), `exit ${again.code}`)

  // ── 5) preset id 校验（目录名规则）──────────────────────────────────────
  const badId = run(['--out', join(tmp, 'x'), '--id', 'Math_Proof', '--dry-run'])
  ok('非法 preset id 被拒（[a-z0-9][a-z0-9-]*）', badId.code !== 0 && /preset id/.test(`${badId.out}${badId.err}`), `exit ${badId.code}`)
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log('# 开源发布准备回归（临时目录，零依赖）\n')
console.log(results.join('\n'))
console.log(`\n${failures === 0 ? 'PUBLISH_OK' : 'PUBLISH_FAIL'} ${results.length - failures}/${results.length}`)
process.exit(failures === 0 ? 0 : 1)
