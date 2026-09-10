---
name: agda-proof-engine
description: Agda 验证纪律与工具链 — **Agda 是唯一裁决器**（项目补丁版 项目补丁版 Agda（`impl/local-paths.json` 的 `agdaBin`））；含 proof_compile 检查器优先级（agda 优先）、--guardedness 旗标纪律、六类错误指纹分诊与经验库联动、回执签发与证据、沙箱/堆限制陷阱；dype（项目自研实验性内核，尚不完善，不能替代 Agda）的源码地图见 references/dype-experimental.md。 不触发（Do NOT trigger for）: 工具链固有限制的判定（用 prover_limits query）、证明架构与阶段设计（用 long-horizon-discipline）。
whenToUse: 需要编译验证 Agda 证明、修编译错误、选择检查器、理解回执与证据、或遇到 --rewriting/沙箱/堆限制等工具链问题时加载；涉及 dype 源码/构建时先读 references/dype-experimental.md。
---

# agda-proof-engine：Agda 验证纪律与工具链

## 0. 一句话

**Agda 是唯一裁决器。** 证明通过 = 项目补丁版 Agda 编译 exit 0 + 0 postulate/hole/sorry。
dype 是项目自研的**实验性内核**（尚不完善），当前只作生成/加速通道，**不能替代 Agda 的地位**。

## 1. 检查器与旗标（硬纪律）

- **优先级**：`agda`（`项目补丁版 Agda（`impl/local-paths.json` 的 `agdaBin`）`，项目补丁版）→ 仅当 Agda 不可用时才回退 dype；
  dype 只在你**显式**传 `checker:"dype"` 时使用，且报告会标「非权威，需 Agda 复核」。
- 命令行**只加 `--guardedness`**，**绝不加 `--rewriting`**（重写规则由文件头 pragma 承载）。
- 编译验证用 `proof_compile`（自动发现 + data-dir 校验 + 指纹分诊 + 签发回执）；
  交付前用 `proof_audit` 做静态合规审计。
- **没有编译证据不要声称证明通过**；`postulate` 可编译通过但语义未证。

## 2. 六类指纹分诊（错误 → 类别 → 经验库）

`proof_compile` 把 `error: [ClassName]` 映射为 A–F 与性能/规则类，并在命中工具链限制时
标注「经验库: `<id>`」——**先 `prover_limits query "<报错原文>"`，不要把限制当成自己的证明失败**。

| 类 | 指纹 | 典型修法 |
| --- | --- | --- |
| A/B | `NotInScope` / `FileNotFound` | 补 `using`；修模块路径 |
| C | `AmbiguousName` | `renaming`（`zero/suc`、`_+_`） |
| D | `InfectiveImport` | 命令行不加 `--rewriting`，文件头保留 pragma |
| E | `ParseError` / `NoParseForLHS` | 补 `import Data.Product using (_,_)`；算子补 `infixl` |
| F | `UnequalTypes` / `ConstructorDoesNotFit` | 宇宙层级；`.projᵢ` 卡住 → 被调函数含 `let`，改 let-free |
| R/P | `UnsolvedConstraints` / `Heap exhausted` | 补 REWRITE 规则；大 Fin 递归引用已编译模块 + `fromℕ<`；堆上限按基线 RSS 标定 |

## 3. 回执与证据（反刷分）

`proof_compile` 成功时签发**回执**（源文件 sha256 + 检查器 + 退出码 + 时间，落 `~/.dsh/state/math-proof/receipts/`）。
`proof_dag` 只认回执为「已验证」证据：伪造回执报错、**编译后改文件回执即失效**、手写 `evidence` 一律标「未验证」。
因此**别用改记录的方式提高分数**（见纪律 §0.6）。

## 4. 环境陷阱（限制 ≠ 你的失败）

- **沙箱**：链闸门写 stdlib `_build` 被拒 → `exit=42`（权限问题，不是类型错误）；改用 `proof_compile` 逐模块验证。
- **堆限制**：`+RTS -M<n>G` 上限必须按机器基线 RSS 标定（本机 `-M6G` 误杀、`-M8G` 起通过）。
- 限制条目与证据见 `prover_limits`；新限制用 `prover_limits add`（**evidence 必填**）。

## 5. dype（实验性内核，不可替代 Agda）

- dype = Agda 内核替换 + 大衍证明生成引擎（`.dy → .agda → agda verify`）。
- 当前**不可用于日常验证**：二进制 data-dir 烙死为 `/src/data`（不存在）→ 任何编译 exit 1；
  且 `Verify/Pipeline` 最终仍调用 PATH 上的 `agda` 做验证。
- 所以：**生成/加速可以看 dype，裁决必须用 Agda**。
- 源码地图、内核补丁位置、构建命令、阻塞详情与诚实边界：
  → `references/dype-experimental.md`

## 5.5 有界实例化 / 陈述层 / postulate 口径

- 界（`Fin k`、`12 ^ k`）**保持符号化**，具体实例化推到使用点；堆爆先怀疑「证明项在具体界上被求值」。
- 无 `funext` 时函数相等只能写逐点形式；「任意 step」这类陈述不可证。
- `proven` 要求 **0 未声明 postulate**（不是 0 postulate）：逐个声明 `rewrite`/`unreachable`/`gap`。
- 三次事故复盘、处方清单、工具核对规则：
  → `references/bounded-instantiation-and-postulates.md`

## 6. 工具分工

| 工具 | 用途 |
| --- | --- |
| `proof_compile` | 编译 + 指纹分诊 + 签发回执（Agda 优先） |
| `proof_audit` | 静态合规审计（postulate/hole/浮点/fixity/`let`/`trans` 深度） |
| `prover_limits` | 工具链限制经验库（先 query 再决定） |
| `proof_dag` | 台账/证据/评分/见证（回执写进 `receipt` 字段） |

编译错误闭环委托 `loop-engineer`；证明策略见 `proof-engineer` 技能。
