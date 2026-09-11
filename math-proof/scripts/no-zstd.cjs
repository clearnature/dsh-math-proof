// 数学证明模式 — **Node 20 模拟器**（把 `node:zlib` 的 zstd 拿掉）
//
// 用法：
//   NODE_OPTIONS="--require <preset>/scripts/no-zstd.cjs" node scripts/check-all.mjs
//
// 为什么需要它：CI 的 Node 20 那一格是**本机装不出来的版本**，而 2026-09-10 真出过事故——
// `import { zstdDecompressSync } from 'node:zlib'` 在 Node 20 上是**链接期** SyntaxError，
// 会让整个插件挂不上（不是运行时才报）。后来只靠「等 CI 红」来发现这类回归太慢，
// 所以本地留一个**真的能让 zstd 消失**的开关：
//   · 本文件在 `--require` 预加载时改的是 **CJS 的 `node:zlib` 对象**；
//   · ESM 的 `import * as zlib from 'node:zlib'` 命名空间在首次加载时**快照**这个对象，
//     所以预加载必须早于任何 import —— `--require` 满足这一点（实测 ESM 侧探测也变成 undefined）。
// 子进程会继承 `NODE_OPTIONS`，因此 `check-all.mjs` 派生出来的每个套件都会在同一条件下跑。
const zlib = require('node:zlib')
for (const k of ['zstdCompressSync', 'zstdDecompressSync', 'zstdCompress', 'zstdDecompress', 'createZstdCompress', 'createZstdDecompress']) {
  try {
    delete zlib[k]
  } catch {
    /* 不可配置就退回 defineProperty */
  }
  try {
    Object.defineProperty(zlib, k, { value: undefined, configurable: true, writable: true })
  } catch {
    /* 实在改不动就跳过这一项 */
  }
}
