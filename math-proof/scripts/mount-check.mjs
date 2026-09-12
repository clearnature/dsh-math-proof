// 数学证明模式 — **真挂载体检**（用真的 dsh 宿主把这份 preset 挂一次）
//
// 用法：
//   node <preset>/scripts/mount-check.mjs                  # 挂本脚本所在的 preset
//   node <preset>/scripts/mount-check.mjs --preset demo     # 指定 preset id
//   node <preset>/scripts/mount-check.mjs --root <目录>     # 指定要挂的 preset 目录
//   node <preset>/scripts/mount-check.mjs --json
//
// 期望最后一行：`MOUNT_CHECK_OK` / `MOUNT_CHECK_FAIL` / `MOUNT_CHECK_SKIP`（没装 dsh）。
//
// ── 为什么需要它（2026-09-13 真实事故）──────────────────────────────────────
// `dsh-persona` 把必填字段从 `text` 改成 `prefix`，我们的 persona 行还用旧字段——
// 于是 **schema 校验在挂载期失败**，整份 preset 挂不起来：GUI 里「切不过去 / 开不了会话」。
// 当时能做的只有「读 schema 猜」与「让用户去点 GUI 试」，**没有一条命令能回答「这份 preset 现在挂得上吗」**。
//
// 本脚本用**真的 dsh 宿主**（web profile = 与用户同款的宿主组装）在一个**临时 DSH_HOME** 里启动，
// 插一行检查插件，调用名单服务的 `standingKeyFor(presetId)` —— 这会走 `mountPreset()`，
// 也就是**会话创建时走的同一条路**（`dsh-api-session-controller` 的 `scopeFor` 用的就是它）。
// 连不上 dsh 就 SKIP；挂载失败时**原样打印宿主自己的报错**（会指名是哪一行、什么原因）。
//
// 安全：临时 home 里只放**自造的假凭据**（不读用户凭据）、不碰用户 settings、`--port 0` 让 OS 挑端口、
// 挂载成功即退出（不做任何模型调用）；临时目录跑完即删。

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = dirname(HERE)

const argv = process.argv.slice(2)
const optOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const AS_JSON = argv.includes('--json')
const ROOT = optOf('--root') ?? DEFAULT_ROOT
const PRESET_ID = optOf('--preset') ?? basename(ROOT)
const TIMEOUT_MS = Number(optOf('--timeout-ms') ?? 180000)

/** 检查插件：插进宿主后调用名单服务，真的挂一次。 */
const CHECKER = `// 由 scripts/mount-check.mjs 生成：把 preset 真的挂一次（宿主自己的 mountPreset 路径）
export const name = 'mount-check'
export const inject = ['agentPresets']
export async function apply(ctx) {
  const id = process.env.MOUNT_CHECK_PRESET
  const limit = Number(process.env.MOUNT_CHECK_TIMEOUT_MS ?? 120000)
  const timer = setTimeout(() => {
    console.log('MOUNT_FAIL 挂载超时（' + limit + 'ms）')
    process.exit(1)
  }, limit)
  timer.unref?.()
  try {
    const key = await ctx.agentPresets.standingKeyFor(id)
    console.log('MOUNT_OK ' + JSON.stringify(key))
    process.exit(0)
  } catch (e) {
    const message = String(e?.message ?? e).replace(/\\n/g, ' ⏎ ')
    console.log('MOUNT_FAIL ' + message)
    process.exit(1)
  }
}
`

const PATCH = `# 由 scripts/mount-check.mjs 生成：往宿主组装里插一行检查插件（bundle 用的就是 insert 这种写法）
- insert:
    - id: mount-check
      name: '__CHECKER__'
`

const bin = process.env.DSH_BIN ?? 'dsh'
const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' })
if (probe.error !== undefined || probe.status !== 0) {
  const why = probe.error === undefined ? `exit ${String(probe.status)}` : String(probe.error.code ?? probe.error.message)
  if (AS_JSON) console.log(JSON.stringify({ verdict: 'MOUNT_CHECK_SKIP', preset: PRESET_ID, why }, null, 2))
  else console.log(`MOUNT_CHECK_SKIP 找不到可用的 dsh（${why}）——本项跳过`)
  process.exit(0)
}

const home = mkdtempSync(join(tmpdir(), 'math-proof-mount-'))
let verdict = 'MOUNT_CHECK_FAIL'
let detail = ''
try {
  // 临时 home：只放**自造假凭据** + 指向「preset 所在目录」的名单根（不读用户凭据、不碰用户 settings）
  mkdirSync(home, { recursive: true })
  symlinkSync(dirname(ROOT), join(home, '.agent-presets'))
  mkdirSync(join(home, 'sessions'), { recursive: true })
  mkdirSync(join(home, 'state'), { recursive: true })
  const creds = join(home, '.credentials.yaml')
  writeFileSync(
    creds,
    ['version: 1', 'records:', '  client-connection/browser-session:', '    kind: grant', '    payload:', '      version: 1', "      secret: 'mc-local'", 'refs:', '  DEEPSEEK_API_KEY: MOUNT_CHECK_PLACEHOLDER_NOT_A_KEY', ''].join('\n'),
  )
  chmodSync(creds, 0o600) // credentials-local 要求仅属主可读

  const checker = join(home, 'mount-check.mjs')
  writeFileSync(checker, CHECKER)
  const patch = join(home, 'mount-check.patch.yml')
  writeFileSync(patch, PATCH.replace('__CHECKER__', checker))

  // `--patch` 是 dsh 的全局选项：必须在 `--profile` 之前（放后面会被当成 web app 的参数）
  const run = spawnSync(bin, ['--patch', patch, '--profile', 'web', '--port', '0', '--no-open'], {
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, DSH_HOME: home, MOUNT_CHECK_PRESET: PRESET_ID, MOUNT_CHECK_TIMEOUT_MS: String(Math.max(30000, TIMEOUT_MS - 30000)) },
  })
  const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`
  const okLine = out.split('\n').find((l) => l.startsWith('MOUNT_OK '))
  const failLine = out.split('\n').find((l) => l.startsWith('MOUNT_FAIL '))
  if (okLine !== undefined) {
    verdict = 'MOUNT_CHECK_OK'
    detail = `${PRESET_ID} 真挂载通过（scope key ${okLine.slice('MOUNT_OK '.length)}）`
  } else if (failLine !== undefined) {
    detail = failLine.slice('MOUNT_FAIL '.length)
  } else if (run.error?.code === 'ETIMEDOUT') {
    detail = `dsh 启动超时（${TIMEOUT_MS}ms）——挂载未完成`
  } else {
    // 没有检查插件的输出：多半是宿主启动就失败了——把宿主的报错尾部原样带出来（不吞）
    const tail = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('dsh: all_proxy'))
      .slice(-4)
      .join(' ⏎ ')
    detail = `没等到检查插件的输出（宿主退出码 ${String(run.status)}）：${tail.slice(0, 600)}`
  }
} finally {
  try {
    rmSync(home, { recursive: true, force: true })
  } catch {
    /* 清理失败不影响判定 */
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ verdict, preset: PRESET_ID, root: ROOT, detail }, null, 2))
} else {
  console.log('# 真挂载体检（用真的 dsh 宿主把 preset 挂一次）\n')
  console.log(`- preset: \`${PRESET_ID}\`（${ROOT}）`)
  console.log(`- 宿主: \`${bin} --profile web --port 0\`（临时 DSH_HOME，假凭据，不做模型调用）`)
  console.log('')
  console.log(`${verdict === 'MOUNT_CHECK_OK' ? '✅' : '❌'} ${detail}`)
  console.log('')
  console.log(verdict === 'MOUNT_CHECK_OK' ? 'MOUNT_CHECK_OK 1/1（这份 preset 在真宿主上挂得起来）' : 'MOUNT_CHECK_FAIL 0/1')
}
process.exit(verdict === 'MOUNT_CHECK_OK' ? 0 : 1)
