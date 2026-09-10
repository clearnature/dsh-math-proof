// 数学证明模式 — proof-graph 本地插件
//
// 注册 `proof_graph` 工具：把一组 Agda 模块的 `open import` 关系解析成**证明图（DAG）**，
// 输出拓扑序（leaf-first 编译顺序）、环检测、未解析节点与外部依赖计数。
//
// 这是「第 4 层：证明图」的可执行落法：
//   节点 = 可验证命题（模块），边 = 依赖，拓扑序 = 单点健康信号的编译顺序。
//
// 本行不 provide 任何 service，可裸露在 preset 里；文件只 import `node:` 内建模块。

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'

export const name = 'proof-graph'
export const inject = ['tools']

/** 从源码文本提取模块名。 */
export function moduleNameOf(text) {
  const m = /^\s*module\s+([\w.]+)/m.exec(text)
  return m === null ? '' : m[1]
}

/** 从源码文本提取 import 的模块名（含 `open import` / `import`）。 */
export function importsOf(text) {
  const out = []
  const re = /^\s*(?:open\s+)?import\s+([\w.]+)/gm
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

/** 模块名 → 相对源码根的文件路径。 */
export function modulePath(srcRoot, moduleName) {
  return join(srcRoot, `${moduleName.replace(/\./g, '/')}.agda`)
}

/**
 * 建证明图。
 * @param files - 已读取的 `{ path, module, imports }` 列表。
 * @param srcRoot - 源码根（用于解析集合外的本地依赖）。
 * @returns 图结构。
 */
export function buildGraph(files, srcRoot) {
  const byModule = new Map()
  for (const f of files) if (f.module !== '') byModule.set(f.module, f)
  const nodes = new Set(byModule.keys())
  const edges = new Map() // module -> Set(dep)
  const unresolved = new Map() // module -> Set(import)
  const external = new Map() // module -> Set(import)

  for (const f of byModule.values()) {
    const deps = new Set()
    const miss = new Set()
    const ext = new Set()
    for (const imp of new Set(f.imports)) {
      if (byModule.has(imp)) {
        deps.add(imp)
        continue
      }
      const candidate = modulePath(srcRoot, imp)
      if (existsSync(candidate)) {
        nodes.add(imp)
        deps.add(imp)
        continue
      }
      if (imp.startsWith('Sovereign.')) miss.add(imp)
      else ext.add(imp)
    }
    edges.set(f.module, deps)
    if (miss.size > 0) unresolved.set(f.module, miss)
    if (ext.size > 0) external.set(f.module, ext)
  }
  for (const n of nodes) if (!edges.has(n)) edges.set(n, new Set())

  // 拓扑序（依赖优先）：inDegree = 依赖数
  const inDegree = new Map()
  const dependents = new Map()
  for (const n of nodes) {
    inDegree.set(n, 0)
    dependents.set(n, new Set())
  }
  for (const [n, deps] of edges) {
    for (const d of deps) {
      if (!nodes.has(d)) continue
      inDegree.set(n, (inDegree.get(n) ?? 0) + 1)
      dependents.get(d).add(n)
    }
  }
  const queue = [...nodes].filter((n) => (inDegree.get(n) ?? 0) === 0).sort()
  const order = []
  while (queue.length > 0) {
    const n = queue.shift()
    order.push(n)
    for (const d of [...(dependents.get(n) ?? [])].sort()) {
      const next = (inDegree.get(d) ?? 0) - 1
      inDegree.set(d, next)
      if (next === 0) queue.push(d)
    }
  }
  const cyclic = [...nodes].filter((n) => !order.includes(n)).sort()
  const roots = [...nodes].filter((n) => (dependents.get(n)?.size ?? 0) === 0).sort()
  return { nodes: [...nodes].sort(), edges, unresolved, external, order, cyclic, roots, byModule }
}

/** 生成 markdown 报告。 */
export function renderGraph(graph, requested) {
  const lines = []
  const edgeCount = [...graph.edges.values()].reduce((n, s) => n + s.size, 0)
  lines.push('# proof_graph：证明图（DAG）')
  lines.push('')
  lines.push(`- 节点（可验证命题 / 模块）: **${graph.nodes.length}**`)
  lines.push(`- 边（import 依赖）: **${edgeCount}**`)
  lines.push(`- 环: ${graph.cyclic.length === 0 ? '无 ✅' : `**${graph.cyclic.length} 个** ❌ ${graph.cyclic.join(', ')}`}`)
  lines.push(`- 顶层节点（无人依赖）: ${graph.roots.length === 0 ? '（无）' : graph.roots.join(', ')}`)
  lines.push(`- 请求入口: ${requested.join(', ')}`)
  lines.push('')
  lines.push('## 编译顺序（leaf-first：依赖优先）')
  lines.push('')
  if (graph.order.length === 0) {
    lines.push('（空）')
  } else {
    graph.order.forEach((n, i) => {
      const deps = [...(graph.edges.get(n) ?? [])].filter((d) => graph.nodes.includes(d))
      lines.push(`${i + 1}. \`${n}\`${deps.length === 0 ? '  ← 叶子' : `  (依赖 ${deps.length}: ${deps.join(', ')})`}`)
    })
  }
  if (graph.cyclic.length > 0) {
    lines.push('')
    lines.push('## ⚠️ 环内节点（拓扑序不可定义）')
    for (const n of graph.cyclic) lines.push(`- \`${n}\` → ${[...(graph.edges.get(n) ?? [])].join(', ')}`)
  }
  if (graph.unresolved.size > 0) {
    lines.push('')
    lines.push('## 未解析的 Sovereign 依赖（可能路径/命名有误）')
    for (const [n, miss] of graph.unresolved) lines.push(`- \`${n}\` 缺: ${[...miss].join(', ')}`)
  }
  const extCount = [...graph.external.values()].reduce((n, s) => n + s.size, 0)
  lines.push('')
  lines.push(`## 外部依赖（stdlib / cubical 等）: ${extCount} 条`)
  lines.push('')
  lines.push('## 用法')
  lines.push('- 按上面的编译顺序逐个 `proof_compile`，每节点独立 exit 0 才是单点健康信号。')
  lines.push('- 每条 import 边做「精确强度」审计：恰好是证明所需，不缺、不过强。')
  return lines.join('\n')
}

/**
 * 注册 `proof_graph` 工具。
 * @param ctx - preset 行上下文。
 */
export function apply(ctx) {
  ctx.tools.register({
    name: 'proof_graph',
    description:
      '把一组 Agda 模块的 open import 关系解析成证明图（DAG）：节点=可验证命题（模块），边=依赖；输出 leaf-first 编译顺序、环检测、未解析 Sovereign 依赖、外部依赖计数。静态解析，不编译。用于「第 4 层：证明图」的依赖纪律与逐节点验证规划。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['paths'],
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Agda 模块路径（绝对或相对 session workspace）。可传目录以外的任意一组模块，例如 src/Sovereign/Problem/Fermat/*.agda 里的 6 个。',
        },
        srcRoot: {
          type: 'string',
          description: '源码根，用于解析集合外的 Sovereign 依赖。默认 <cwd>/src。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['report'],
        properties: { report: { type: 'string' } },
      },
      render(_args, value) {
        return [{ type: 'text', text: value.report }]
      },
    },
    async execute(args, exec) {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const input = args === null || typeof args !== 'object' ? {} : args
      const paths = Array.isArray(input.paths) ? input.paths.filter((p) => typeof p === 'string' && p !== '') : []
      if (paths.length === 0) throw new Error('proof_graph: `paths` must be a non-empty array of file paths')
      const srcRoot = isAbsolute(input.srcRoot ?? '') ? input.srcRoot : resolvePath(cwd, input.srcRoot ?? 'src')
      const files = []
      const missing = []
      for (const p of paths) {
        const target = isAbsolute(p) ? p : resolvePath(cwd, p)
        let text
        try {
          if (statSync(target).isDirectory()) continue
          text = readFileSync(target, 'utf8')
        } catch (error) {
          missing.push(`${p} (${error?.message ?? String(error)})`)
          continue
        }
        files.push({ path: target, module: moduleNameOf(text), imports: importsOf(text) })
      }
      if (files.length === 0) {
        throw new Error(`proof_graph: no readable Agda files among ${paths.length} path(s): ${missing.join('; ')}`)
      }
      const graph = buildGraph(files, srcRoot)
      const report = [
        renderGraph(graph, files.map((f) => f.module === '' ? f.path : f.module)),
        missing.length === 0 ? '' : `\n> 跳过 ${missing.length} 个不可读路径：\n${missing.map((m) => `> - ${m}`).join('\n')}`,
      ].join('\n')
      return { report }
    },
  })
}
