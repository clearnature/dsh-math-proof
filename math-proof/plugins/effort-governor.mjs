// 数学证明模式 — 思考强度调速器（`agent/request` 瀑布）
//
// 回答用户的要求：「让模型自动调节思考强度」。
//
// 用的官方缝：`agent/request` 是**每次模型请求**都会走的瀑布（waterfall）。
// 官方事件契约（`cordis_inspect_query` → `Event.listEvents`）：
//
//   'agent/request'(payload: { agent, turn, step, signal },
//                   next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
//   描述：Replace the frozen call configuration. `await next()` yields the config the machine
//        would use (agent options on the first request, the logged header afterwards);
//        return a replacement to switch.
//
// 也就是说：**每次请求都可以换一套调用配置**，而 `LlmCallConfig` 里有 `reasoningEffort`。
// 我们在预算过半后逐步降档（`high → low → off`），任务结束后**精确还原**到改之前那一档。
//
// ⚠ 先说清楚它**不是**什么（2026-09-10 实测，见 `docs/maps/M7-budget.md`）：
//   reasoning token 只占全部流量的 **0.12%**（中位回合 0.078%），而且**高思考回合反而更省**
//   （每步 ≥1000 reasoning 的回合步数中位 15.5 / tok 4.05M；<300 的回合 17 步 / 9.32M）。
//   所以它不是「省流量的旋钮」，而是**「预算吃紧时强制收敛」的旋钮**：
//   流量 ≈ 调用次数 × 每步上下文，真正决定花销的是**还要跑多少轮**。
//
// 安全纪律（**违反任何一条都可能把正常请求打挂**）：
//   1. 先 `await next()` 拿机器本来要用的配置，**只在它之上改一个字段**；
//   2. **只降不升**：绝不超过改之前那一档（否则就成了「多想」旋钮，反而涨流量）；
//   3. 看不见档位（`reasoningEffort` 缺失）/ 未知档位 → **不动**；
//      DeepSeek 适配器只认 `off|low|high|max`，传别的会**抛 `UNSUPPORTED_REASONING_EFFORT`**；
//   4. 任何异常 → 返回机器原本的配置（**绝不因为调速让一次请求失败**）；
//   5. `next()` 自己的异常**原样抛出**，不吞（吞掉会把「模型路由错误」变成莫名其妙的行为）。
//
// 每个请求只读一个状态文件（几百字节，~50µs），不读会话日志。
// 效果**可审计**：每次配置变化都会落 `request/header`，其中就有 `config.reasoningEffort`。

import { budgetMode, loadProfile, noteEffort, planEffort, readTurn, writeTurn } from '../impl/budget-policy.mjs'

export const name = 'effort-governor'

/** 一次请求的处置（纯函数便于测试）：给定 seed 配置与回合状态，返回要用的配置。 */
export function govern(seed, state, mode) {
  if (mode !== 'brake') return { config: seed, plan: { effort: null, why: `模式 ${mode} 不调速` } }
  const plan = planEffort({ state, seedEffort: seed?.reasoningEffort })
  if (plan.effort === null) return { config: seed, plan }
  return { config: { ...seed, reasoningEffort: plan.effort }, plan }
}

export function apply(ctx) {
  ctx.on('agent/request', async (payload, next) => {
    const seed = await next() // 机器本来要用的配置（不要吞它的异常）
    let state = null
    try {
      const sessionId = String(payload?.agent?.id ?? '')
      const { mode } = budgetMode(loadProfile())
      if (sessionId === '') return seed
      state = readTurn(sessionId)
      const { config, plan } = govern(seed, state, mode)
      const before = state === null ? null : state.effortOwned === true
      const after = noteEffort(state, plan, seed?.reasoningEffort)
      // 只有「真的改了档」或「所有权发生了变化」才写盘（每步都写文件没有意义）
      if (after !== null && (config !== seed || (after.effortOwned === true) !== (before === true))) writeTurn(after)
      return config
    } catch {
      // 兜底：任何意外都退回机器原本的配置（调速失败不应该影响一次请求）
      return seed
    }
  })
}
