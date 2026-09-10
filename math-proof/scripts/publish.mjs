// 数学证明模式 — 开源发布准备（零依赖）
//
// 用法：
//   node ~/.dsh/.agent-presets/math-proof/scripts/publish.mjs --out ~/src/dsh-math-proof
//   node .../publish.mjs --out /tmp/try --dry-run        # 只看报告，不落盘
//   node .../publish.mjs --out ~/src/dsh-math-proof --holder clearnature --json
//
// 它做三件事，顺序不能颠倒：
//   1. **盘清要发什么**：整棵 preset 树，但排除 `state/`（机器缓存：市场快照 / 宿主组合 dump）
//      与临时文件——发布树里不该有本机状态。
//   2. **体检**：扫绝对路径（`/home/<用户>`、`/data/work`）、疑似密钥、体积与文件数。
//      绝对路径不会自动改写：它们是**语义**（persona/skills 指向作者本机的库与文档），
//      机械替换会把「来源声明」变成假话——所以只报告，改写由人决定。
//   3. **按 DSH 的根扫描规则摆好目录**：`<out>/<preset-id>/agent.cordis.yml`。
//      `dsh-agent-presets` 的 `scanRoot` 只认「root 下、名字匹配 `[a-z0-9][a-z0-9-]*` 的**子目录**」，
//      且子目录里必须有 \`agent.cordis.yml\`。所以仓库根**不等于** preset 目录：
//        <repo>/                      ← 这一层配进 `roots`
//        └── math-proof/              ← preset id（= 目录名）
//            ├── agent.cordis.yml
//            └── ...
//      这样用户 `git pull` 就能更新，不需要每次往 `~/.dsh/.agent-presets/` 拷。
//
// 发布树里还会生成：`.gitignore`（挡住 state/）、`LICENSE`（MIT，与 Agda 库和 dsh 本体一致）、
// 根 `README.md`（给人看的：这是什么 / 怎么装 / 依赖什么 / 怎么自检）。

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PRESET_DIR = dirname(HERE)

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const opt = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}

const OUT = opt('--out')
const PRESET_ID = opt('--id') ?? 'math-proof'
const HOLDER = opt('--holder') ?? 'clearnature'
const DRY = has('--dry-run')
const FORCE = has('--force')
const AS_JSON = has('--json')

if (OUT === undefined && !AS_JSON) {
  console.error('用法：node scripts/publish.mjs --out <目标仓库目录> [--id math-proof] [--holder <版权人>] [--dry-run] [--force] [--json]')
  process.exit(2)
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(PRESET_ID)) {
  console.error(`preset id 必须匹配 [a-z0-9][a-z0-9-]*（它会成为目录名）：${PRESET_ID}`)
  process.exit(2)
}

// ── 1) 收集要发布的文件（排除本机状态）────────────────────────────────────

// 机器生成的产物一律不进发布树：`state/`（本机台账/缓存）、`:pycache`、.agdai 等
const EXCLUDE_DIRS = new Set(['state', 'node_modules', '.git', '__pycache__', '_build', '.agdai', '.pytest_cache'])
const EXCLUDE_FILE = /(?:\.tmp-\d+|\.corrupt-\d+|~|\.pyc|\.pyo|\.agdai|\.hi|\.o|DS_Store)$/

/** 递归收集相对路径（发布树里要保留的相对位置）。 */
function collect(dir, prefix = '') {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      files.push(...collect(join(dir, entry.name), rel))
      continue
    }
    if (EXCLUDE_FILE.test(entry.name)) continue
    files.push(rel)
  }
  return files.sort()
}

const files = collect(PRESET_DIR)
const excluded = existsSync(join(PRESET_DIR, 'state')) ? collect(join(PRESET_DIR, 'state')).length : 0

// ── 2) 体检：绝对路径 / 疑似密钥 ───────────────────────────────────────────

const ABS_PATH = /(?:\/home\/[A-Za-z0-9._-]+|\/data\/work|\/Users\/[A-Za-z0-9._-]+|\/opt\/[A-Za-z0-9._-]+)/g
const SECRET = /(sk-[A-Za-z0-9]{10,}|api[_-]?key\s*[:=]\s*\S+|secret\s*[:=]\s*\S+|password\s*[:=]\s*\S+)/gi
const TEXT = /\.(md|mjs|js|json|yml|yaml|py|sh|txt|agda)$/

// 扫描器自身内嵌了这些模式（正则字面量），跳过它——否则报告永远是「有密钥」的假阳性
const SELF = relative(PRESET_DIR, fileURLToPath(import.meta.url))
const absHits = []
const secretHits = []
for (const rel of files) {
  if (!TEXT.test(rel) || rel === SELF) continue
  let text = ''
  try {
    text = readFileSync(join(PRESET_DIR, rel), 'utf8')
  } catch {
    continue
  }
  if (text.includes('\u0000')) continue
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(ABS_PATH)) absHits.push({ file: rel, line: i + 1, hit: m[0] })
    for (const m of line.matchAll(SECRET)) secretHits.push({ file: rel, line: i + 1, hit: m[0].slice(0, 40) })
  })
}
const absFiles = [...new Set(absHits.map((h) => h.file))].sort()

// ── 3) 生成发布树 ──────────────────────────────────────────────────────────

const meta = { name: PRESET_ID, description: '' }
try {
  const yml = readFileSync(join(PRESET_DIR, 'preset.yml'), 'utf8')
  meta.name = /^name:\s*(.+)$/m.exec(yml)?.[1]?.trim() ?? PRESET_ID
  meta.description = /^description:\s*(.+)$/m.exec(yml)?.[1]?.trim() ?? ''
} catch {
  /* 无 preset.yml */
}

const GITIGNORE = `# 机器状态与缓存：不进版本库（发布树本来就不含它们）
state/
node_modules/
__pycache__/
*.pyc
*.agdai
*.tmp-*
*.corrupt-*
.DS_Store
`

const LICENSE = `MIT License

Copyright (c) 2026 ${HOLDER}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const ROOT_README = `# ${PRESET_ID} — ${meta.name}（DSH agent preset）

> ${meta.description}

一个 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)（dsh）的 **agent preset**：
把它装进 dsh，会话就按「依赖类型论 + 先算后验证 + 长程台账 + 反刷分」的方式做形式化证明。

## 装（两条路，选一条）

**A. 克隆 + 配一个 root（推荐，\`git pull\` 即可更新）**

\`\`\`bash
git clone https://github.com/${HOLDER}/dsh-math-proof.git ~/src/dsh-math-proof
\`\`\`

然后在 dsh 的宿主 patch 层（\`~/.dsh/profiles/web/cordis.patch.yml\`）加一项：

\`\`\`yaml
- id: agent-presets
  config:
    roots:
      - path: ~/src/dsh-math-proof
        trust: user
\`\`\`

**B. 拷进用户目录**（一次性快照，升级要手动重拷）

\`\`\`bash
cp -r dsh-math-proof/${PRESET_ID} ~/.dsh/.agent-presets/${PRESET_ID}
\`\`\`

两条路都需要**重启/重挂 dsh**，然后新建会话时选 \`${PRESET_ID}\`。

> 为什么仓库根不是 preset 目录：dsh 的 \`scanRoot\` 只认「root 下、名字匹配 \`[a-z0-9][a-z0-9-]*\`
> 的子目录」，且子目录里必须有 \`agent.cordis.yml\`。

## 依赖什么

| 依赖 | 用途 | 缺失后果 |
| --- | --- | --- |
| dsh（\`@deepseek-ai/dsh\`，版本线见仓库） | 宿主 | 装不上 |
| Agda（项目补丁版，路径可配） | **唯一裁决器**：exit 0 + 0 postulate/hole | \`proof_compile\` 不可用 |
| Python 3（零外部依赖） | 先算后验证的 oracle（精确整数） | \`proof_oracle\` 不可用 |
| 你自己的数学仓库（工作目录） | 证明目标 | 工具可用，但没有可证的库 |

**注意**：仓库里有些文本引用作者本机的绝对路径（\`/data/work/...\`、\`/home/<用户>/文档/...\`），
它们指向**作者的本地资料**（数学 wiki、类型论文档、dype 源码）。换成你的路径即可——
工具本身按工作目录工作，不受影响。

## 自检

\`\`\`bash
node ${PRESET_ID}/scripts/check-all.mjs      # 期望 CHECK_ALL_OK（全部门禁）
node ${PRESET_ID}/scripts/plugins.mjs        # 三平面插件盘点（宿主 / preset / 缺口）
\`\`\`

## 目录

| 路径 | 内容 |
| --- | --- |
| \`${PRESET_ID}/agent.cordis.yml\` | 组合：persona + 纪律段 + 工具行 + 技能索引 |
| \`${PRESET_ID}/preset.yml\` | 名册元数据（显示名 / 描述 / order） |
| \`${PRESET_ID}/plugins/\` | 工具实现（零依赖，只 import \`node:\` 内建模块） |
| \`${PRESET_ID}/skills/\` | 按需加载的领域知识（不进常驻前缀） |
| \`${PRESET_ID}/hooks/\` | 流程钩子（SessionStart 简报 / PreToolUse 拦截 / Stop 提醒） |
| \`${PRESET_ID}/tests/\` \`scripts/\` | 门禁与运维脚本 |
| \`${PRESET_ID}/audit/\` \`AUDIT.md\` | 逐轮审计记录（含**被否证的判断**） |

## 许可证

MIT（见 \`LICENSE\`）。与 Agda 证明库（\`clearnature/discrete-mathematics\`）和 dsh 本体同许可。
`

// CI 工作流也由生成器产出：仓库骨架必须**可从 preset 复现**，不能靠手工往里放文件
const GATES_WORKFLOW = `# 全部门禁：15 个入口（schema 自检 + 14 套回归，含架构文档漂移门禁 docs-check）
#
# 这些门禁是**纯 node 内建模块**实现的（零依赖），所以在裸 CI 里也能跑：
# 没有 dsh 安装、没有市场快照、没有 Agda 仓库时，相关断言会显式 SKIP（⏭）而不是假绿。
name: gates

on:
  push:
    branches: ['main']
  pull_request:
    branches: ['main']
  workflow_dispatch:

jobs:
  check-all:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node: ['20', '22', '24']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '\${{ matrix.node }}'
      - name: 一键门禁（期望 CHECK_ALL_OK 15/15）
        run: node ${PRESET_ID}/scripts/check-all.mjs
`

// npm 包清单：**仓库骨架的一部分**，由生成器产出（同 .gitignore / LICENSE / README / CI）
// 为什么用 scoped 名：避免与官方 `@deepseek-ai/dsh-*` 混淆，也避免无 scope 名被抢注
const PKG_NAME = opt('--pkg-name') ?? `@${HOLDER}/dsh-math-proof`
const PACKAGE_JSON = {
  name: PKG_NAME,
  version: opt('--version') ?? '0.1.0',
  description: `${meta.name}：DeepSeek Harness（dsh）的数学证明 agent preset —— Agda 内核为唯一裁决，先算后验证，长程证明台账`,
  keywords: ['dsh', 'deepseek-harness', 'agent-preset', 'agda', 'formal-verification', 'dependent-types', 'theorem-proving', 'mathematics'],
  license: 'MIT',
  repository: { type: 'git', url: `git+https://github.com/${HOLDER}/dsh-math-proof.git` },
  homepage: `https://github.com/${HOLDER}/dsh-math-proof#readme`,
  bugs: { url: `https://github.com/${HOLDER}/dsh-math-proof/issues` },
  // 只发 preset 目录 + 两个根文件：state/、__pycache__ 等由 .gitignore/.npmignore 语义排除
  files: [`${PRESET_ID}/`, 'README.md', 'LICENSE'],
  engines: { node: '>=20' },
  // 显式说明：本包**不依赖**任何 npm 运行时依赖（插件只 import node: 内建模块）；
  // 真正的外部依赖是宿主的 dsh 版本线与 Agda / Python，见 README。
  dependencies: {},
  peerDependencies: {},
  publishConfig: { access: 'public' },
}

const PUBLISH_WORKFLOW = `# npm 发布（Tag / Release 触发；**先跑门禁再发**）
#
# 认证用 **npm Trusted Publishing（OIDC）**：在 npmjs.com 的包设置里登记本仓库与本工作流后，
# 不需要长期 NPM_TOKEN 秘密。若尚未配置 trusted publisher，可退回 NPM_TOKEN：
#   - env: { NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }} }
#
# provenance：\`--provenance\` 让 npm 生成可验证的来源证明（等价 SLSA v3），
# 因此**不要**再加 "SLSA Generic generator"（那是另一套，重复且更弱）。
name: publish

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      dry-run:
        description: 只做 npm publish --dry-run（不真的发布）
        type: boolean
        default: true

permissions:
  contents: read
  id-token: write   # Trusted Publishing / provenance 需要

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          registry-url: 'https://registry.npmjs.org'
      - name: 门禁必须全绿才允许发布
        run: node ${PRESET_ID}/scripts/check-all.mjs
      - name: 检查将要发布的文件清单
        run: npm pack --dry-run
      - name: 发布（Trusted Publishing + provenance）
        if: \${{ github.event_name == 'release' || inputs.dry-run == false }}
        run: npm publish --provenance --access public
      - name: 干跑（手工触发且勾选 dry-run）
        if: \${{ github.event_name == 'workflow_dispatch' && inputs.dry-run != false }}
        run: npm publish --provenance --access public --dry-run
`

const target = OUT === undefined ? null : join(OUT, PRESET_ID)
let written = 0
if (!DRY && target !== null) {
  if (existsSync(OUT) && readdirSync(OUT).length > 0 && !FORCE) {
    console.error(`目标目录非空：${OUT}\n（要覆盖请加 --force；先 --dry-run 看清单）`)
    process.exit(1)
  }
  mkdirSync(target, { recursive: true })
  for (const rel of files) {
    const dest = join(target, rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(PRESET_DIR, rel), dest)
    written++
  }
  writeFileSync(join(OUT, '.gitignore'), GITIGNORE)
  writeFileSync(join(OUT, 'LICENSE'), LICENSE)
  writeFileSync(join(OUT, 'README.md'), ROOT_README)
  mkdirSync(join(OUT, '.github', 'workflows'), { recursive: true })
  writeFileSync(join(OUT, '.github', 'workflows', 'gates.yml'), GATES_WORKFLOW)
  writeFileSync(join(OUT, '.github', 'workflows', 'publish.yml'), PUBLISH_WORKFLOW)
  writeFileSync(join(OUT, 'package.json'), `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`)
  // npm 打包白名单（双保险：即便有人改了 package.json，npmignore 仍挡住机器状态）
  writeFileSync(join(OUT, '.npmignore'), 'state/\n__pycache__/\n*.pyc\n*.agdai\n.github/\n')
}

const bytes = files.reduce((sum, rel) => sum + statSync(join(PRESET_DIR, rel)).size, 0)

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        out: OUT ?? null,
        presetId: PRESET_ID,
        presetName: meta.name,
        dryRun: DRY,
        files: files.length,
        bytes,
        excludedStateFiles: excluded,
        written,
        absolutePathFiles: absFiles,
        absolutePathHits: absHits.length,
        secretHits: secretHits.length,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

console.log('# 开源发布准备报告\n')
console.log(`- preset id：**${PRESET_ID}**（显示名「${meta.name}」）｜目标：\`${OUT}\`${DRY ? '（**dry-run，未落盘**）' : ''}`)
console.log(`- 要发布：**${files.length}** 个文件 / ${(bytes / 1024).toFixed(0)} KB｜排除 \`state/\` **${excluded}** 个机器状态文件${DRY ? '' : `｜已写入 ${written} 个`}`)
console.log(`- 布局：\`<repo>/${PRESET_ID}/agent.cordis.yml\`（仓库根这一层配进 \`roots\`）`)
console.log('')
console.log(`## 体检\n`)
console.log(`- 绝对路径：**${absHits.length}** 处，分布在 **${absFiles.length}** 个文件（已跳过扫描器自身 \`${SELF}\`）`)
for (const f of absFiles) console.log(`  - \`${f}\``)
console.log(`- 疑似密钥：**${secretHits.length}** 处${secretHits.length === 0 ? ' ✅' : ' ❗（发之前必须清掉）'}` + (secretHits.length === 0 ? '' : '——先人工确认是真密钥还是文档里的占位符'))
for (const h of secretHits.slice(0, 10)) console.log(`  - \`${h.file}:${h.line}\` ${h.hit}`)
console.log('')
console.log('> 绝对路径**不自动改写**：它们是语义（persona/skills 的「来源声明」指向作者本机的库与文档），')
console.log('> 机械替换会把来源变成假话。发布前自己决定：改成可配置变量，或在 README 里说明。')
console.log('')
console.log('## 发布后怎么装（写进 README 的同一段）\n')
console.log('```yaml')
console.log('# ~/.dsh/profiles/web/cordis.patch.yml')
console.log('- id: agent-presets')
console.log('  config:')
console.log('    roots:')
console.log(`      - path: ~/src/${OUT === null ? 'dsh-math-proof' : relative(dirname(OUT), OUT) === '' ? OUT : OUT.split('/').pop()}`)
console.log('        trust: user')
console.log('```')
console.log('')
console.log('## 下一步\n')
console.log('```bash')
console.log(`cd ${OUT ?? '<out>'}`)
console.log('git init -b main && git add -A && git commit -m "feat: math-proof agent preset for dsh"')
console.log(`git remote add origin https://github.com/${HOLDER}/dsh-math-proof.git`)
console.log('git push -u origin main')
console.log('```')
console.log('')
console.log(`> 仓库名建议用 \`dsh-math-proof\`：\`dsh-\` 前缀把仓库归进 dsh 生态（与官方 \`@deepseek-ai/dsh-*\` 同风格），`)
console.log('> 后半段说明它是什么（数学证明 agent 模式），且与数学库仓库 `discrete-mathematics` 区分得开。')
