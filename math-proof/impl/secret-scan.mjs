// 数学证明模式 — **硬编码密钥扫描**（零依赖；`publish.mjs` 与门禁共用一份实现）
//
// 目标只有一个：**找出写死在源码里的密钥字面量**。
//
// ⚠ 2026-09-10 收紧过一次（真实事故）：
//   加额度监控后，原正则 `api[_-]?key\s*[:=]\s*\S+` 把 `apiKey = String(process.env.X ?? '')`
//   这类**取凭据的代码**也当成了密钥，一次报 17 处假阳性。假阳性一多，门禁就会被当成噪音忽略——
//   那比没有门禁更危险。所以赋值类规则改为**要求右侧是带引号的字面量且长度 ≥12**；
//   `sk-` 前缀规则保留（那才是真密钥的形状）。
//
// 安全性没有放松，而且**由门禁证明**：`tests/publish-check.mjs` 会人为种两种假密钥
// （真前缀形状 / 引号字面量赋值）并断言扫描器**仍然报警**，同时断言「取环境变量」不报警。
//
// 实现细节：种进测试里的字符串用**拼接**构造（`'sk-' + 'abc…'`），
// 这样测试文件本身在整树扫描时不构成命中——否则「扫描器测试」会把自己的夹具当成泄漏。

/** 命中模式（全局、忽略大小写）。 */
export const SECRET_PATTERN = /(sk-[A-Za-z0-9]{10,}|(?:api[_-]?key|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-\.\+\/]{12,}['"])/gi

/**
 * 扫描一段文本，返回命中片段（去重前后顺序保留，最多 `limit` 条）。
 * @param text - 待扫描文本
 * @param limit - 最多返回多少条（默认 50）
 */
export function scanSecretText(text, limit = 50) {
  const hits = []
  const source = String(text ?? '')
  for (const m of source.matchAll(SECRET_PATTERN)) {
    hits.push(m[0].slice(0, 60))
    if (hits.length >= limit) break
  }
  return hits
}

/**
 * 扫描整份多行文本，返回 `{ line, hit }`（行号从 1 开始）。
 */
export function scanSecretLines(text) {
  const out = []
  const lines = String(text ?? '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const hit of scanSecretText(lines[i], 5)) out.push({ line: i + 1, hit })
  }
  return out
}
