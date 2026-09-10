// 数学证明模式 — DSH 插件盘点的共享事实层（零依赖，只 import `node:` 内建模块）
//
// 为什么单独抽出来：`scripts/plugins.mjs`（已装/宿主侧）与 `scripts/market.mjs`（注册源侧）
// 都要回答同一个问题——**这一行插件到底是谁在提供、现在是启用还是禁用**。两个脚本各写一份
// 解析就会漂移（曾经漂移过一次：把「宿主显式禁用、交给 preset 接管」的行误报成「宿主已挂」）。
// 所以事实只有一个来源：本文件。
//
// ── 三个平面（DSH 的真实分层，读 `dsh --profile web --dump-config` 得到）─────────
//   1. 宿主平面（host plane）：`base` + `web` 两个 bundle 的组合。注册表、持久化、沙箱、
//      审批栈、token 计量、spill、检查点策略等**跨会话**的东西在这里。
//   2. agent 平面（agent plane）：一个 preset 的 `agent.cordis.yml`。工具、提示段、技能。
//      web 面**故意禁用**了宿主里的这些行（见 web bundle patch 的
//      「the agent plane moves behind agent presets」段），交给每个会话挂的 preset 提供。
//   3. 出厂预设：`dsh-agent-presets/presets/{standard,cordis,minimal,ptc}`——用于判断
//      「某行宿主禁用了，本该谁提供」。**宿主禁用 ≠ 我们缺失**：standard 也不提供的行
//      （如 `tool-str-replace-editor`，只有 minimal 用）属预期。
//
// 关键事实：**宿主组合 dump 里带 `disabled: true` 的行必须按禁用处理**。只按名字统计会把
// 26 个「等 preset 接管」的行算成「已挂载」，从而得出相反结论。

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** pnpm 全局商店（多版本取第一个匹配）。 */
export function storeRoot() {
  const base = join(homedir(), '.local', 'share', 'pnpm', 'global', '5', '.pnpm')
  return existsSync(base) ? base : null
}

/** 在本机商店里定位一个 `@deepseek-ai/<name>` 包目录（找不到返回 null）。 */
export function locatePackage(shortName) {
  const root = storeRoot()
  if (root === null) return null
  for (const entry of readdirSync(root)) {
    const m = /^@deepseek-ai\+([a-z0-9-]+)@([^_]+)(?:_|$)/.exec(entry)
    if (m === null || m[1] !== shortName) continue
    const dir = join(root, entry, 'node_modules', '@deepseek-ai', shortName)
    return existsSync(dir) ? { dir, version: m[2] } : null
  }
  return null
}

/** 已装 dsh 包：name → { version, desc }。desc 取包 README frontmatter 的 description。 */
export function installedPackages() {
  const root = storeRoot()
  const out = new Map()
  if (root === null) return out
  for (const entry of readdirSync(root)) {
    // 商店目录名形如 `@deepseek-ai+dsh-x@1.2.3_hash`；无依赖的包没有 `_hash` 后缀
    const m = /^@deepseek-ai\+(dsh[a-z0-9-]*)@([^_]+)(?:_|$)/.exec(entry)
    if (m === null || out.has(m[1])) continue
    const dir = join(root, entry, 'node_modules', '@deepseek-ai', m[1])
    let desc = ''
    try {
      desc = (/^description:\s*"?(.+?)"?\s*$/m.exec(readFileSync(join(dir, 'README.md'), 'utf8'))?.[1] ?? '').slice(0, 160)
    } catch {
      /* 无 README */
    }
    out.set(`@deepseek-ai/${m[1]}`, { version: m[2], desc })
  }
  return out
}

/** 本机 dsh 版本线（以 dsh-base 为准）——市场推荐与行核对都必须对齐它。 */
export function targetVersion(installed = installedPackages()) {
  return installed.get('@deepseek-ai/dsh-base')?.version ?? installed.get('@deepseek-ai/dsh')?.version ?? ''
}

/**
 * 解析一份 Cordis 组合文本（宿主 dump 是扁平的，preset 文件是嵌套的，同一个解析器都吃）。
 * 返回 [{ id, name, disabled }]，顺序即出现顺序。
 */
export function parseComposition(text) {
  const rows = []
  let cur = null
  for (const line of text.split('\n')) {
    const idm = /^\s*- id:\s*(.+?)\s*$/.exec(line)
    if (idm !== null) {
      cur = { id: idm[1].replace(/^['"]|['"]$/g, ''), name: '', disabled: false }
      rows.push(cur)
      continue
    }
    if (cur === null) continue
    const nm = /^\s*name:\s*(.+?)\s*$/.exec(line)
    if (nm !== null) {
      cur.name = nm[1].replace(/^['"]|['"]$/g, '')
      continue
    }
    if (/^\s*disabled:\s*true\s*$/.test(line)) cur.disabled = true
  }
  return rows
}

/** 宿主组合 dump 的缓存位置。 */
export function hostDumpPath(presetDir) {
  return join(presetDir, 'state', 'host', 'web-composition.yml')
}

/**
 * 宿主平面行。优先用缓存的组合 dump；`refresh` 时重跑 `dsh --profile web --dump-config`。
 *
 * 降级链（必须如实标注，不能假装数据是新的）：
 *   1. dump 可用            → source: 'dump'（唯一权威，含 `disabled` 标志）
 *   2. dump 重跑成功        → source: 'dump-live'
 *   3. dump 与重跑都不可用  → source: 'bundle-patch'（只读 base/web 的 patch 文件；
 *      **只能看到该层自己的 disabled**，被后续层禁用的行会误读成启用 → 分类必须标注乐观）
 */
export function loadHostRows(presetDir, { refresh = false, dumpPath = null } = {}) {
  const file = dumpPath ?? hostDumpPath(presetDir)
  if (!refresh && existsSync(file)) {
    try {
      return { rows: parseComposition(readFileSync(file, 'utf8')), source: 'dump', path: file, error: null }
    } catch (err) {
      /* 坏缓存 → 继续尝试重跑 */
      void err
    }
  }
  if (dumpPath === null) {
    const r = spawnSync('dsh', ['--profile', 'web', '--dump-config'], { encoding: 'utf8', timeout: 180000 })
    const out = r.stdout ?? ''
    if (r.status === 0 && out.includes('- id:')) {
      try {
        mkdirSync(dirname(file), { recursive: true })
        const tmp = `${file}.tmp-${process.pid}`
        writeFileSync(tmp, out)
        renameSync(tmp, file)
      } catch {
        /* 写缓存失败不影响本次结果 */
      }
      return { rows: parseComposition(out), source: 'dump-live', path: file, error: null }
    }
    if (existsSync(file)) {
      return { rows: parseComposition(readFileSync(file, 'utf8')), source: 'dump-stale', path: file, error: r.stderr?.trim() ?? null }
    }
  }
  // 兜底：直接读 bundle patch（诚实标注精度下降）
  const rows = []
  for (const pkg of ['dsh-base', 'dsh-web-app']) {
    const found = locatePackage(pkg)
    if (found === null) continue
    const patch = join(found.dir, 'cordis.patch.yml')
    if (!existsSync(patch)) continue
    rows.push(...parseComposition(readFileSync(patch, 'utf8')))
  }
  return { rows, source: 'bundle-patch', path: null, error: '未能取得宿主组合 dump：分类基于 bundle patch，可能把被上层禁用的行读成启用' }
}

/**
 * 宿主平面的启用 / 禁用集合（按包名去重；同名多行时「任一启用即启用」）。
 * `dshOnly` 默认 true：只统计 `@deepseek-ai/dsh-*`，把 `cordis:group` 与
 * `@deepseek-ai/cordis-plugin-*` 排除在计数之外——两个脚本报同一组数字靠它。
 */
export function hostSets(rows, { dshOnly = true } = {}) {
  const want = (n) => n.startsWith('@deepseek-ai/dsh-') || (!dshOnly && n.startsWith('@deepseek-ai/'))
  const enabled = new Set()
  const disabled = new Set()
  for (const r of rows) {
    if (!want(r.name)) continue
    if (r.disabled) {
      if (!enabled.has(r.name)) disabled.add(r.name)
    } else {
      enabled.add(r.name)
      disabled.delete(r.name)
    }
  }
  return { enabled, disabled }
}

/** 出厂预设各自提供哪些包：name → Set(presetId)。用于判断「宿主禁用后本该谁提供」。 */
export function shippedPresetProviders() {
  const out = new Map()
  const found = locatePackage('dsh-agent-presets')
  if (found === null) return out
  const presets = join(found.dir, 'presets')
  if (!existsSync(presets)) return out
  for (const id of readdirSync(presets)) {
    const file = join(presets, id, 'agent.cordis.yml')
    if (!existsSync(file)) continue
    for (const row of parseComposition(readFileSync(file, 'utf8'))) {
      if (!row.name.startsWith('@deepseek-ai/')) continue
      if (!out.has(row.name)) out.set(row.name, new Set())
      out.get(row.name).add(id)
    }
  }
  return out
}

/** 一个 preset 的 composition 行。 */
export function presetRows(presetDir) {
  const file = join(presetDir, 'agent.cordis.yml')
  if (!existsSync(file)) return []
  return parseComposition(readFileSync(file, 'utf8'))
}

/** 文件 mtime（ISO 秒），用于报告「这套东西最后一次动是什么时候」。 */
export function mtimeOf(file) {
  try {
    return new Date(statSync(file).mtimeMs).toISOString().slice(0, 19).replace('T', ' ')
  } catch {
    return ''
  }
}
