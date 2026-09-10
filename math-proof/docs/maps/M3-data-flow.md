# M3 · 数据流（一次证明任务，从猜想到证据）

> 这张图回答：**一个命题从「想法」到「已证」经过哪些数据、每步留下什么、哪一步可能失效。**
> 事实来源：`plugins/proof-dag.mjs`、`plugins/agda-engine.mjs`、`plugins/python-oracle.mjs`、`hooks/*.mjs`。

## M3.1 主链路

```mermaid
sequenceDiagram
  autonumber
  participant M as 模型（agent）
  participant O as proof_oracle（Python）
  participant A as Agda 内核
  participant C as proof_compile
  participant D as proof_dag（台账）
  participant G as witness git（见证）

  Note over M: ① 陈述层自检（funExt / 逐点 / 边界点）
  M->>O: 先算后验证：穷举 / 找反例（精确整数）
  O-->>M: stdout + ORACLE-MANIFEST + oracle 回执
  M->>D: add 节点（statement / deps / module / oracle=回执）
  Note over D,G: 每次写操作：台账原子写 + 锁 → 见证提交（关键变更立即，其余节流 20s）
  D-->>G: commit（台账快照 + 流水 + 引用到的回执）
  M->>A: 写 Agda 证明项
  M->>C: proof_compile 模块
  A-->>C: exit code + diagnostics
  C-->>M: 编译回执（源码 sha256 + exit + wallMs + 结果级指纹）
  C-->>M: 失败时：指纹分诊 + 结果级分诊处方
  M->>D: update state=proven, receipt=回执
  Note over D: 回执核验：源码哈希未变才认（改一个字符即失效）
  D-->>M: 拒绝？→ 未声明 postulate / gap / 依赖未 proven
  M->>D: check（体检 + 评分 + 扣分表）
  D-->>M: 环 / 悬空 / 证据档位 / 断链 / postulate 分类 / 草稿 / 预算闸门
  M->>D: graph（导出知识图谱 JSON + MD）
  Note over D: SessionStart 钩子注入 brief；Stop 钩子提醒写 handoff
```

## M3.2 每一步留下什么数据

| 步 | 产物 | 落在哪 | 可否重建 |
| --- | --- | --- | --- |
| 先算后验证 | oracle 回执（脚本哈希 + stdout 哈希 + 覆盖清单） | `state/math-proof/oracle-receipts/` | 否（重跑会得到新回执 id） |
| 编译 | 编译回执（源码 sha256 + exit + 耗时 + 指纹） | `state/math-proof/receipts/` | 否（重编译得到新回执，源码不变则内容一致） |
| 台账写 | 节点（statement/state/deps/证据引用/对象字段/postulate 分类） | `state/math-proof/dag-<ws>.json` | **否——这是主数据** |
| 见证 | git 提交（台账快照 + 流水） | `state/math-proof/witness-<ws>/` | 否（历史本身就是证据） |
| 体检 | 评分 + 扣分表 → 历史曲线 | `state/math-proof/history-<ws>.json` | 可（由台账重算） |
| 图谱导出 | `graph-<ws>.json`（带 `$schema`）+ `.md` | `state/math-proof/` | 可（由台账重建，**导出物可清理**） |
| 编译聚合 | `agg-<sha1>.json`（每模块累计次数/耗时） | `state/math-proof/receipts/` | 可（由全量回执重建） |
| 经验 | 限制条目（症状→判据→做法→证据） | `state/math-proof/prover-limits.json` | 否（人工经验） |

## M3.3 证据的三档与失效条件（数据流的诚信底线）

```mermaid
graph LR
  R["工具回执<br/>（可验证）"] -->|源码哈希一致| OK["计为已验证 ✅"]
  R -->|源码改过一个字符| STALE["回执失效 ❌ → 扣分"]
  S["模型自报 evidence 字符串"] --> UNV["一律标「未验证」⚠"]
  N["无证据"] --> MISS["proven 但无证据 ❌ 重罚"]
```

- **回执绑定源码哈希**：`proof_compile` 的回执与文件内容 sha256 绑定；**改文件即失效**（防「改文件冒充已证」）。
- **oracle 回执绑定脚本哈希 + stdout**：`points < domain` 判为抽样，**不算验证**（线性场上 `Δf ≡ 0` 会骗过你）。
- **见证 git 绑定历史**：删记录/回退提交会在 `check` 里以「历史被改写/提交数倒退」暴露。
  诚实边界：本地见证提高成本并留痕，**不等于不可篡改**（真不可篡改需要外部只追加日志）。

## M3.4 两条闸门在数据流里的位置

| 闸门 | 位置 | 触发后的动作 |
| --- | --- | --- |
| **先算后验证** | Agda 之前 | `points < domain` 或 oracle 不过 → **禁止开 Agda**，回退改陈述/算法 |
| **编译预算** | 同一模块累计失败 ≥3 次 | 停止逐条改错，**委托 `loop-engineer`**（`check` 与 `proof_compile` 都会打出 🛑） |
| **PreToolUse 拦截** | `proof_dag` 调用前 | 标 `proven` 无回执 / 依赖未 proven → **exit 2**，工具根本不执行 |
| **postulate 门禁** | 标 `proven` 时 | 模块里的 postulate 未逐个声明种类 → **拒收**；声明 `gap` → 拒收；`rewrite` 无 `{-# REWRITE #-}` 依据 → 拒收 |

## M3.5 失败时的数据流（诊断也是产出）

```mermaid
graph LR
  F["编译失败"] --> T{"有诊断行？"}
  T -->|有| FP["指纹分诊（六类 + 性能类）"]
  T -->|没有（堆爆/被杀/超时）| RT["结果级分诊 → 处方"]
  FP --> L["prover_limits 记一条（证据必填）"]
  RT --> L
  F --> DG["节点 diagnosis: statement_wrong / proof_too_hard"]
  DG --> J["journal 记 lesson / limit"]
```

- `statement_wrong` = 陈述有误 → **改形式化**，不要硬证；
- `proof_too_hard` = 证明太难 → 拆子引理；
- 工具链限制（堆爆、沙箱拒绝、编译器传染性 flag）**不计入能力评价**，但必须记进 `prover_limits` / `journal(kind:"limit")`。

> 相关：`M4 状态与数据管理`（这些文件怎么管）、`M6 证据链与反刷分`（评分怎么算、什么算作弊）。
