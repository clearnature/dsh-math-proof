# 有界实例化 / 陈述层 / postulate 口径 —— 三次真实事故的完整记录

> 常驻纪律（`impl/discipline.md` §4.5–4.7）只留判据与红线；**细节、事故复盘、处方清单**在本文件。
> 触发时机：引理涉及 `Fin k` / `12 ^ k` 之类**界**、陈述里出现**函数相等**、或模块含 **postulate**。

## 一、有界实例化：346s 堆爆 vs 3.4s 通过

**事故（2026-09-10）**：同一引理
- 符号版 `finite-orbit-pw : ∀ k (f : Fin k → Fin 12) → …` → **3.4s 通过**；
- 写死界 `finite-orbit-pw (12 ^ 729) …` → **346s 后 heap exhausted（exit 251，8GB）**。

**根因**：Agda 的证明项在**具体界上会被求值**。鸽巢/`any?` 这类证明项在 `Fin (12^729)` 上会真的去枚举元素（探针 `src/_ProbeHE.agda` 显示 `proj₁ (pigeonhole-fin (12^729) f)` 单独跑 3.2s 能过，放进完整证明项就被展开成枚举）。

**处方（按序）**：
1. **界保持符号化**：引理写 `∀ k …`，具体实例化推到**使用点**（`fromℕ<` / `subst` / 传入证据）。
2. **确需具体值**：用 `opaque` 包一层阻断归约，只在需要展开处 `opaque unfolding`；不要靠 `+RTS -M<n>G` 硬顶。
3. **小界探针**：先在 k=1,2,3 上确认证明项本身可过；探针文件 `_Probe*.agda` 用完删除。
4. **看结果级分诊**：`proof_compile` 失败时会给出 `agda-concrete-instantiation-eval`（堆爆）/`agda-oom-killed`（被杀）/`agda-timeout`（超时）三类处方——这些失败**没有诊断行**，只有退出码与进程输出里有线索。
5. **记进经验库**：`prover_limits add`（症状 → 判据 → 做法 → 证据）。

**相关事实（本库）**：`12^729`、`12^1728` 这类界在本库是**规模参数**，不是要枚举的载体；`_build/` 里已有 `.agdai` 时优先复用已编译模块。

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
