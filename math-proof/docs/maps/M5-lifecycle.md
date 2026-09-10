# M5 · 会话生命周期（从挂载到跨天接手）

> 这张图回答：**一次会话从哪开始、什么时候注入什么、上下文压缩后靠什么接上、改东西要不要新开会话。**
> 事实来源：`hooks/*.mjs`、`plugins/proof-dag.mjs`、`scripts/reload.mjs`、dsh 的 `dsh-agent-presets`。

## M5.1 生命周期全景

```mermaid
sequenceDiagram
  autonumber
  participant U as 人类
  participant R as dsh 名册（agent-presets）
  participant S as 会话（agent）
  participant H as 钩子
  participant T as 工具（proof_*）
  participant G as 见证 git

  R->>R: 扫描 roots（shipped → 配置的 roots → 用户根）
  U->>R: 新建会话并选 preset = math-proof
  R->>S: standing mount 组合（每进程一次，多会话共享同一代）
  S->>H: SessionStart
  H-->>S: 注入接手简报（进度 / 评分 / 证据 / 对象完整度 / 待裁决 / 可开工）
  loop 工作循环
    S->>T: proof_oracle（先算后验证）
    T-->>S: oracle 回执 + 覆盖清单
    S->>T: proof_compile（写 Agda 后）
    T-->>S: 编译回执 / 指纹分诊 / 结果级处方
    S->>H: PreToolUse(proof_dag)
    H-->>S: 越步则 exit 2 拦截（无回执 / 依赖未证）
    S->>T: proof_dag add/update/check
    T->>G: 关键变更立即提交（其余节流 20s）
  end
  S->>H: Stop
  H-->>U: 有未决项 → 提醒写 handoff
  U->>R: 跨天：新会话（同一 preset）→ 回到 SessionStart 简报
```

## M5.2 上下文压缩之后靠什么接上

| 承接物 | 内容 | 谁写 | 什么时候读 |
| --- | --- | --- | --- |
| **台账** `dag-<ws>.json` | 命题/状态/依赖/证据/对象字段 | 工具 | `brief` / `check` / `next` |
| **流水** `journal` | 决策、来源、限制、里程碑、教训、交接 | 模型 + 工具 | `brief` 列待裁决 |
| **见证 git** | 台账快照历史 | 工具 | `check` 核篡改 |
| **回执** | 编译 / oracle 证据 | 工具 | `check` 核证据档位 |
| **接手简报** `brief` | frontier / 卡点 / 待裁决 / 下一步 | 工具 | `SessionStart` 钩子自动注入 |

**核心事实**：长程记忆不在上下文里，**在台账与回执里**。压缩、重启、换天都不影响——
所以「压缩前赶紧写完」是错误策略，正确的是**随时把状态落进台账**。

## M5.3 热 / 可热 / 冷：改什么需要新开会话

```mermaid
graph LR
  subgraph HOT["🔥 热（立即生效，缓存不失效）"]
    H1["impl/discipline.md<br/>（纪律文本，每次装配 prompt 重读）"]
    H2["impl/ruleset.mjs<br/>（判定规则：断链豁免/评分权重/postulate 口径/编译分诊）"]
    H3["impl/dsh-inventory.mjs<br/>（共享事实层）"]
  end
  subgraph COLD["❄️ 冷（需新会话；且必然改缓存前缀）"]
    C1["plugins/*.mjs 的结构 / schema / 输出格式"]
    C2["agent.cordis.yml 行 / persona"]
    C3["技能描述（frontmatter）——正文改动只影响之后新加载的技能"]
  end
  HOT -->|不用新会话| OK1["改规则/纪律：下一次模型请求即生效"]
  COLD -->|要新会话| OK2["standing mount 只在 composition 的 mtime+size 变化时重挂"]
```

**判断眼前这个会话跑的是哪版**：`proof_dag action:"doctor"` —— 报「插件本体 本实例 hash vs 磁盘 hash」
与「规则集 rN/hash」，并把「本会话启动后规则已变更」显式标出来。**引用分数前先跑它。**

运行 `node scripts/reload.mjs` 可看当前状态与逐档操作说明。

## M5.4 跨天/换人接手的标准动作

1. 收工前：`proof_dag journal` 写一条 `handoff`（今天到哪、明天从哪开始、卡在哪、等谁裁决）；
2. 新会话开起来：`SessionStart` 钩子自动注入 `brief`，**不要靠记忆复述**；
3. 先跑 `proof_dag action:"doctor"` 确认版本，再跑 `check` 看评分与扣分表；
4. `next` 拿可开工集合（依赖已 proven 的 pending），别从中间挑。

> 相关：`M1 架构`（组件边界）、`M3 数据流`（证据怎么来）、`CACHE.md`（缓存代价）、
> `scripts/reload.mjs`（逐档操作说明）。
