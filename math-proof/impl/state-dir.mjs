// 数学证明模式 — **状态目录解析**（零依赖；唯一实现）
//
// 为什么单独立一个模块：状态目录（`~/.dsh/state/math-proof`）原先在 `proof-dag` / `agda-engine`
// 里各自硬编码 `homedir()`，于是：
//   · 测试没法隔离——`tests/run.mjs` 的「编译热点」把假回执写进**用户真实回执目录**，
//     还断言自己是「最贵的 3 条」；用户那边出现 345.9s / 169.0s 的真实编译后，假回执被挤掉，
//     门禁就红了（**同一份代码在 CI 上绿、在本机红**——因为 CI 的状态目录是空的）。
//   · 换机器/多环境没法覆盖。
//
// 现在统一走这里：**`MATH_PROOF_STATE_DIR` 优先**，未设置时回落到 `~/.dsh/state/math-proof`。
// 生产行为不变（默认值与过去逐字符相同），但测试可以把状态全部指向临时目录。

import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 状态目录。
 * @returns `MATH_PROOF_STATE_DIR` 的值（若设置了非空值），否则 `~/.dsh/state/math-proof`
 */
export function stateDir() {
  const override = process.env.MATH_PROOF_STATE_DIR
  if (typeof override === 'string' && override.trim() !== '') return override
  return join(homedir(), '.dsh', 'state', 'math-proof')
}

/** 状态目录下的某个路径。 */
export function statePath(...parts) {
  return join(stateDir(), ...parts)
}
