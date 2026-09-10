# 有界实例化 / 陈述层 / postulate 口径 —— 三次真实事故的完整记录

> 常驻纪律（`impl/discipline.md` §4.5–4.7）只留判据与红线；**细节、事故复盘、处方清单**在本文件。
> 触发时机：引理涉及 `Fin k` / `12 ^ k` 之类**界**、陈述里出现**函数相等**、或模块含 **postulate**。

## 一、有界实例化：真凶是「定义体展开」，不是「字面量界」

**曾经写错的归因（已被实测否证）**：以为是「字面量界触发 stdlib `pigeonhole` 里的 `any?` 枚举」。
实测：`proj₁ (pigeonhole-fin (12 ^ 729) f)` 单独编译 **3.2s exit 0** —— 字面量界本身不爆（Agda 不强制它）。

**探针链（P1/P2/P3，用完即删）**：

| 配置 | 结果 |
| --- | --- |
| 字面量界 + 未封装编码 | **346s heap exhausted**（exit 251，8GB） |
| 只封界 `abstract N729` + 未封装编码 | **仍 339s heap exhausted** |
| P1：`abstract` 界 + **postulate 玩具编码** | 3s exit 0 |
| P3：`abstract` 界 + **真实 `stateEnc`**、注入用 postulate | **>75s 超时** |

P1 快而 P3 慢 ⇒ 代价在**编码的定义体**：`stateEnc = fromℕ< … (suc≤12 729 …)` 里的 `enc12 729`
一旦被展开就是 **729 层递归展开**。

**修法（承重，已验证）**：把界与所有相关定义**连同它们的体**封进**同一个 `abstract` 块**，
只对外暴露类型，块内 `refl` 证 `N729 ≡ 12 ^ 729` 供块外 `subst`：

```agda
abstract
  N729 : ℕ
  N729 = 12 ^ 729
  N729≡ : N729 ≡ 12 ^ 729
  N729≡ = refl
  stateEnc : PresField → Fin N729
  stateEnc ψ = …
  toℕ-stateEnc : ∀ ψ → toℕ (stateEnc ψ) ≡ observe ψ
  stateEnc-injective-pw : ∀ {ψ φ} → stateEnc ψ ≡ stateEnc φ → ∀ x → ψ x ≡ φ x
  stateEnc-injective-pw = …
```

结果：`NSEFinalClosure.agda` **3.2s exit 0**，0 postulate / 0 hole；NSE.T13 + NSE.T15 → proven。

**两条歧路（别走）**：
1. **抬内存**（`+RTS -M12G`，机器 61G）：这不是 OOM，是求值——上限越高，枚举/展开只会跑更久；
2. **只封界**：`abstract N729` 而未封装编码，实测仍 339s 堆爆。

**两类超时必须分开算**：

| 来源 | 证据 | 性质 |
| --- | --- | --- |
| stdlib 接口重建 | 日志尾部在检查 `Data.Unit` / `Data.List.Properties`…；`_build` 下 20 分钟内有 174 个 `.agdai` 被重写 | **环境**（沙箱 `workspace-write` 写不了 stdlib 目录 → 接口失效）→ `prover_limits: sandbox-stdlib-write` |
| 编码体的 729 层展开 | 日志干净的一轮（直奔你的模块）仍 339s heap exhausted | **真问题** → 本节的 abstract-体 封装 |

`proof_compile` 的**结果级分诊**会分别给出 `sandbox-stdlib-write` 与 `agda-abstract-body-729-unfold`
两条处方，并各带一句「**不是这条**」的反例（防止过度归因）。

**经验库条目**：`prover_limits: agda-abstract-body-729-unfold`（带 notFlag：编码用 postulate 占位、
或体不含具体数字递归时本来就快，不是这条）。

## 二、陈述层：NSE.T15 的 funExt 陷阱

**事故**：陈述写成「编码注入（任意 step）」，但无 `funext` 时：
- 注入只能**逐点**给出：`∀ x → s x ≡ t x`；
- 而要从逐点相等推出 `step s ≡ step t`，**正是函数外延性**（`funext`）——原陈述不可证。

**正确形式**：把逐点性作为**假设**写进陈述：
```agda
∀ s t → (∀ x → s x ≡ t x) → (∀ x → step s x ≡ step t x)
```
对邻域型离散算子，这一步由 `cong` 直接给出（不需要 `funext`）。已落 `diagnosis: statement_wrong`。

**推广**：任何「两个函数相等 / 算子相等 / 态射相等」的陈述，先问「这里有没有 `funext`」。
本库 Cubical 只在少数模块用于 `∥_∥₂` / `_/_` / `_≃_`；默认 `PropositionalEquality` 下**没有** `funext`。
逐点形式通常还更好用：它把 `≡` 降级成每个点上的判定，`refl`/`cong` 就能闭合。

## 三、postulate 口径：`proven` 不要求「0 postulate」，要求「0 未声明」

**事故**：`T6.agda` 含 3 个 postulate（`div3k` / `mod3k` / `gf3Toℕ-A4-inv`），它们是 `--rewriting` 承载的
**REWRITE 规则族**（合法性论述：wiki C.3.1），不是证明缺口；但旧口径「proven 需 0 postulate」把整个
对象节点压成 `blocked`，还得请人类裁决。

**现行口径（`impl/ruleset.mjs` 的 `POSTULATE`）**：

| kind | 含义 | 能否 proven |
| --- | --- | --- |
| `rewrite` | 项目已论证的 REWRITE 语义设计（如 `div3k`/`mod3k`/`gf3Toℕ-A4-inv`） | ✅（需人类裁决流水） |
| `unreachable` | Agda 强制检查下的已知无害项（如 `UnreachableClauses` 关联辅助） | ✅（需人类裁决流水） |
| `gap` | **真缺口**：尚未证的断言（如 `T6.agda:976` 的 `φ-respects`） | ❌ 标 `blocked` + `diagnosis` |

**工具怎么做**：`proof_dag` 按**源码**扫 `postulate` 块核对你的声明——
- 声明了模块里不存在的名字 → 报「记录不实」；
- 模块里有而未声明 → 标 `proven` 时**直接拒收**（「用公理冒充证明」不允许静默）；
- `kind:"gap"` 却标 `proven` → 拒收；
- `rewrite`/`unreachable` 声明后仍算「待人类裁决」，`check` 打 `postulate 豁免裁决` 行，用
  `journal`（`kind:"decision"`，`node` 指向该节点）记一次裁决即消。

**注意**：豁免**不能自己发给自己**。声明是模型做的，裁决是人做的——这条界线与「分数不能自己提」同源。

## 四、探针与草稿文件的收尾

诊断期间写的 `_Probe*.agda` / `_test_*.agda` / `*.bak` **用完删除**。`proof_dag check` 会列
`工作区草稿/探针文件`；确有保留价值（例如长期回归用）就在 `journal` 记一条说明，别让它静默留在库里
（本库历史上有 `src/_test_irrelevant.agda` 这类未跟踪草稿）。
