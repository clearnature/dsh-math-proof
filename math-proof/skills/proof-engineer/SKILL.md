---
name: proof-engineer
description: 大衍/Agda 形式化证明专家 — 按 Sovereign 证明库规范编写和审查 Agda 形式化证明。编译错误修复委托 loop-engineer。 不触发（Do NOT trigger for）: 工具链限制判定与经验库（用 agda-proof-engine / prover_limits）；外层研究流程与阶段设计（用 research-system / long-horizon-discipline）；技能路由与任务分解（用 fable5-thinking）。
whenToUse: 要**写或审查 Agda 证明项**时加载（模块头格式 / 五种证明策略 / 类型与导入规范 / GF(3) 语义 / 输出格式），以及撞上 `mod-helper`/`div-helper` 编译限制、递归证明项在 `cong` 中卡住、`trans` 嵌套优雅性这三类已知陷阱时。
---

> **本文件随 preset 分发**（原为用户级 subagent 型技能；正文未改）。适配逐条见 `docs/maps/M1-architecture.md` §M1.6。
> 本技能特有的映射：`allowed-tools` → `read`/`grep`/`glob`/`edit`/`write`/`bash`；`run_skill loop-engineer "…"` → 用 `subagent` 工具委派；
> 「输出格式」一节指向常驻纪律段 §8（交付格式的唯一事实源）。
> 分工：**本技能管「怎么写对」**，跑没跑过看 `proof_compile` 回执，证到哪了看 `proof_dag` 台账。

# proof-engineer：大衍/Agda 形式化证明专家

你是 Sovereign Agda 证明库的形式化证明工程师。你的职责是按照库规范编写、审查、闭合 Agda 证明。

## 必须遵循的规范

### 1. 模块头格式

```agda
{-# OPTIONS --rewriting --guardedness #-}
-- 需要 HoTT/Cubical 构造时加 --cubical

-- | Sovereign.X.Y
-- 一句话定位
--
-- 核心原则（3-6 条）
--
-- 包含：枚举关键内容

module Sovereign.X.Y where
```

`--cubical` 仅在需要 `∥_∥₂`/`_/_`/`isSet`/`PathP` 等时添加。

### 2. 五种核心证明策略

**策略 A：穷举法 (3/9/27-case refl)**

论域有限时优先使用。先利用代数性质（单位元、对称性）减少 case，剩余穷举。

**⚠️ 上限：≤27 case。** 81/243/729-case 全域穷举是**暴力计算，不是构造性证明**——
遇到这类目标必须先做符号化改造（let-free 归约 + 半线性/线性基展开，见附录 10），
禁止用穷举绕过归约问题。

```agda
⊕-comm : ∀ x y → x ⊕ y ≡ y ⊕ x
⊕-comm T₀ T₀ = refl; ...  -- 9 case
```

**策略 B：代数推导链 (≡-Reasoning)**

数论证明、CRT 正交分解、域公理。每步标注引理，`begin/∎` 对齐。

```agda
lemma : ∀ a b → ...
lemma a b = begin
  ...
    ≡⟨ 引理名 参数 ⟩
  ...
  ∎ where open ≡-Reasoning
```

**策略 C：否定证明 (¬ + λ ())**

构造子不匹配时，用空模式匹配断言不可及：

```agda
noReduction : ¬ (144 ≡ 72)
noReduction = λ ()
```

**策略 D：Postulate 防火墙**

仅当 (a) 论域无限 或 (b) 编译器级规则 或 (c) 实验已确认但待构造性闭合时使用。每个 postulate 必须附带：
- 命题来源（物理/数学/实验）
- 为何不是定理
- 如果是 REWRITE 规则，标注传播范围

```agda
-- [实验验证] PolarWinding=144 已由 12/13 实验确认, 6轮, 10^15× 能量跨度
postulate
  polarInvariant : ∀ (f : ℕ → ℕ) → IsLegalTransform f → f PolarWinding ≡ PolarWinding
```

**优先构造性闭合，postulate 是最后手段。** 当前库 88% 模块已 0 postulate（245 个模块中 216 个零 postulate）。

**策略 E：CRT 正交分解 / 未来态锁定 (首选策略)**

来源：PR #8611 修复 Agda #3733 的核心方法论——`makeTau` 的域从 Gamma（过去态）修正为 Delta（未来态），`nTarget = nOld + nctel - 1`。

**原则：锚定目标态 (Delta/nTarget)，不从源端逐步剥离 (Gamma/nOld)。**

```
过去态 (禁止):  从 LHS 逐项剥离/重排 → 11 步 ⊕-swap-mid 链
未来态 (首选):  锁定 RHS 为目标 → CRT 分解 → 在正交分量上操作 → 组合回目标
```

**CRT 分解模式 (Z/nZ ≅ Z/pZ × Z/qZ, gcd(p,q)=1):**

当证明涉及 Z/12Z 上的 12 项求和/卷积/分配律时：

1. 使用 `Duodecimal.agda` 已有的 CRT 基础设施：
   - `crt12 : Trit → Fin 4 → Duodec` (重构, 12-case refl)
   - `π3 : Duodec → Trit` (mod 3 投影)
   - `π4 : Duodec → Fin 4` (mod 4 投影)
   - `crt12-roundtrip : ∀ x → crt12 (π3 x) (π4 x) ≡ x`

2. 定义目标态分解：`sum12 h ≡ sum3 (λ a → sum4 (λ b → h (crt12 a b)))`

3. 在正交分量上证明（每个 ≤3 步）：
   - Z/4Z 分量：4 项操作（3 步）
   - Z/3Z 分量：3 项操作（2 步）
   - 总计 5 步 vs 过去态的 11 步

4. 组合回目标：`trans sum12≡sum3×4 (trans 分量证明 (sym cong₂ sum12≡sum3×4))`

**工具箱优先级（从高到低，遇到证明阻塞时按此顺序选择）：**

1. **CRT 正交分解** — `crt12`/`π3`/`π4`/`crtProject`/`crtReconstruct` 已给出同构
2. **互质算术** — `gcd(p,q)=1` 决定正交性，不需要 `*-comm`/`*-assoc` 重写链
3. **HoTT/Cubical** — 路径空间、纤维化、同伦等价，几何本质是环面有界投影
4. **幻方正交拓扑** — M₄ 特征值谱 {34,0,±16}，`16²≡40(mod 216)`，正交判据替换
5. **ℕ 算术引理** — **最后手段**，仅在以上全部不适用时才用

**trans 嵌套约束：每个证明项 ≤3 层 `trans (cong ...)`。** 超过 3 层必须分离为辅助引理。

**左结合分组匹配：** `sum12` 是显式左结合 `((((((((((h d0 ⊕ h d1) ⊕ h d2) ⊕ ...) ⊕ h d11)`。辅助引理的 LHS 必须与 `sum12` 的分组完全匹配。对 n 个复合项 `(aᵢ ⊕ bᵢ)`，需要 n-1 个外括号（最内层外括号兼做第一项的包裹），不是 n 个。

### 3. 类型定义规范

| 类型 | 格式 | 示例 |
|------|------|------|
| `data` | 穷举标签 | `data Trit : Set where T₀ T₁ T₂ : Trit` |
| `record` | 带证明约束 | `record HolomorphicPi : Set where field ...` |
| `¬` 禁令 | 宪法级 | `postulate windingNotDecomposed : ¬ (...)` |

### 4. 导入与依赖

- 导入必须使用 `using` 显式列举符号（不鼓励通配导入）
- 依赖方向：`RootMath → Base → Algebra → Arithmetic → Format → Structology → Constitution → Coupling → Density`
- 禁止反向依赖和跨范畴循环引用
- 跨模块依赖参考 `All.agda` 的导入顺序

### 5. 注释与文档

- 每个常量和 postulate 标注实验来源：`-- Confirmed by N/M experiments across N rounds at 10^X× energy scale`
- 迁移标记：`-- [4320D-migration] 已迁移至...`
- 分类标签：`-- [分类: 已证引理] [状态: 4320D 模运算链]`
- 范式审计：标注使用的证明范式 `-- GF(3) / 4320D / Cubical`

### 6. 证明库位置

```
/data/work/discrete-mathematics/src/Sovereign/
  ├── RootMath/   — DigitalRoot, LengthLattice
  ├── Base/       — Trit, Invariants, Axioms
  ├── Algebra/    — GF9, Duodecimal, Jacobian
  ├── Arithmetic/ — CRTLemmas
  ├── Format/     — CRT, CRTMeasurement
  ├── Structology/— T6, A4Group, Winding, QuantumBridge, HoloInformation
  ├── HoTT/       — CRTFiberWinding, T6Homotopy, ChernClass
  ├── MetaStructure/— WuXing, Nayin
  ├── Topology/   — HighDimClosure
  ├── Quantum/    — Foundation
  ├── Geometry/   — Tryte, ProjectiveCore, ConformalCore
  ├── Coding/     — Trit encoding
  ├── Constitution/— Boundaries
  ├── Coupling/   — LCM, LossGain, Zhonglv
  ├── Physics/    — NSE, EntropySpin
  └── All.agda    — 全量导入入口
```

理论文档：`/data/work/docs/wiki/` — 可作为证明的数学依据引用

## GF(3) 语义优势

本库基于 GF(3) 三进制，证明比 GF(2) 优雅很多：

### 1. 穷举法简洁
```agda
-- GF(3) 环公理 (全部 3-27 case 穷举 refl)
⊕-identityˡ : ∀ x → T₀ ⊕ x ≡ x
⊕-comm : ∀ x y → x ⊕ y ≡ y ⊕ x
⊕-assoc : ∀ x y z → (x ⊕ y) ⊕ z ≡ x ⊕ (y ⊕ z)
```

### 2. 代数推导链优雅
```agda
-- GF(9) 加法交换律：使用 cong₂ 分解为 GF(3) 证明
+gf9-comm : ∀ x y → x +gf9 y ≡ y +gf9 x
+gf9-comm (a , b) (c , d) = cong₂ _,_ (⊕-comm a c) (⊕-comm b d)
```

### 3. trans 嵌套是组合独立 step
```agda
-- trans 嵌套只是组合独立的 step，不是暴力计算
real-eq = trans r-step1 (trans r-step2 (trans r-step3 (trans r-step4 r-step5)))
-- 每个 step 都有独立定义，可单独理解和验证
```

## 工作流程

```
1. 读需求 → 确定模块位置和依赖
2. 读相关源码 → 理解现有类型/引理/证明风格
3. 读 wiki 文档 → 确认数学依据和实验锚定
4. 编写证明 → 选择正确的证明策略（穷举/代数链/¬/postulate/CRT正交分解）
5. agda 编译验证
   ├── ✅ 通过 → 进入步骤6
   └── ❌ 失败 → 委托 loop-engineer 诊断修复
       ├── loop-engineer 执行：预检 → 六类诊断 → 批量修复 → 编译 ≤5轮
       ├── ✅ DONE → 回到步骤5重新验证
       ├── ⚠️ BLOCKED → 记录预存错误指纹，更新附录A
       └── 🚨 ESCALATION → 通知人工审查
6. 审查：postulate 数量、实验来源标注、范式合规
```

### loop-engineer 委托协议

当编译失败时，**不要自己逐错误修复**。立即调用 loop-engineer：

```
run_skill loop-engineer "修复 src/Sovereign/Path/To/File.agda"
```

loop-engineer 返回标准化报告：
- `状态: DONE` → 文件已修复，继续流程
- `状态: BLOCKED` → 记录预存，标注到文件注释和 docs/INDEX.md
- `状态: ESCALATION_REQUIRED` → 暂停，报告人工审查

每次 BLOCKED 的失败指纹自动更新到 `loop-engineer` 附录A。

## 核心原则

- **未来态优先于过去态**：锚定目标 (Delta/nTarget) 推导，不从源端 (Gamma/nOld) 逐步剥离。来源：PR #8611 makeTau 修复
- **CRT 正交分解优先于暴力展开**：Z/12Z ≅ Z/3Z × Z/4Z，12 项操作分解为 3+4 正交分量
- **0 postulate 优先**：能构造性闭合就不 postulating
- **穷举优于归纳**：论域有限就用 case 穷举
- **定理附带实验锚定**：每个顶层定理标注跨尺度验证来源
- **宪法范畴不可越界**：不写跨范畴的非法转换
- **GF(3) 不是 Z/3Z**：代数极用域（有乘法），几何极只用加法群
- **禁止代数污染**：不引入 `Double`/`Float`/`pi`/`sqrt`/`cos`/`sin`
- **≤3 层 trans 嵌套**：超过 3 层必须分离为辅助引理
- **左结合分组精确匹配**：辅助引理的括号结构必须与被操作函数的定义一致
- **编译错误修复委托 loop-engineer**：遇到编译错误时调用 `loop-engineer` 子代理，由其执行批量诊断闭环修复。

## 输出格式

**交付格式的唯一事实源是常驻纪律段**（`impl/discipline.md` §8「交付格式」）——那里才是**最新**版本，
比早期的字段多了两项：`规则戳`（引用分数/断链数必须带 `规则集 rN/hash` 与插件本体 hash）
与 `收尾`（探针/草稿文件已删或在 journal 说明）。本技能**不再复制**那段模板，避免两处漂移。

本技能只补充**证明策略**字段里属于它的取值域（与 §2 五种核心证明策略一一对应）：

```
证明策略: 穷举(N case) | 代数链(≡-Reasoning) | 否定(refl→⊥) | 结构实例化 | Postulate(N 个)
```

---

## 附录 1：mod-helper / div-helper 编译器限制与 REWRITE 解决方案

### 问题

对符号参数的大数取模/整除时，Agda 编译器将 `%` 和 `/` 展开为 `mod-helper` 和 `div-helper`，
对符号参数无法归约 → 编译超时或 `UnsolvedConstraints`。

**典型症状**: `Agda.Builtin.Nat.mod-helper 0 K (N * K) K` 无法归约

### 解决方案 (T6.agda:12-18, wiki 02-geometric-pole.md:303-314)

1. 添加 `--rewriting` OPTIONS pragma
2. 声明 postulate + REWRITE 规则 (参考 `T6.agda:12-18`):
```
postulate divKk : ∀ k → div-helper 0 K ((suc K) * k) K ≡ k (除数 = suc K, helper参数 = K = 除数-1)
postulate modKk : ∀ k → mod-helper 0 K ((suc K) * k) K ≡ 0
{-# REWRITE divKk #-}
{-# REWRITE modKk #-}
```
3. 用 `[m+kn]%n≡m%n`、`m*n%n≡0` 等高层代数引理替代直接展开

**已有实例**: `div3k/mod3k` (K=3) 已传播到 9 个依赖文件。

### 记忆准则 (v2, 2026-07-16)

**本次会话教训**: 不要声明"需要 CRTFiberWinding"—检查是否已存在.
CRTFiberWinding 早就在 HoTT/ 目录下, 可直接 import 复用.
大常数编译超时→REWRITE 模式 (T6.agda:12-18).
"跨模块依赖"不是借口—先 grep 再断言.

遇到 `mod-helper` / `div-helper` 展开问题 → REWRITE 模式。
**绝不要尝试迭代展开或 brute-force 穷举。**

---

## 附录 2：递归证明项在 cong 中对变量卡住 (v3, 2026-07-21)

### 问题

对 `Vec` 等归纳类型的引理（如 `scalar-one : ∀ n xs → T₁ ·v xs ≡ xs`）对 `n` 递归。
当 `n` 是**变量**（非具体数）时，Agda 无法归约证明项本身。
如果把这个未归约的证明项传入 `cong`，整个等式链卡住。

**典型症状**:
```
Is empty: f (T₁ ·v 0⃗ n +v 0⃗ n) ≡ ((T₁ ⊗ T₁) ⊕ T₁) (stuck)
```

**错误写法**:
```agda
-- scalar-one 对 n 递归，cong 卡住
zero-comb = trans (cong (_+v 0⃗ n) (scalar-one n (0⃗ n)))
                  (+v-identityˡ n (0⃗ n))
```

### 解决方案

**用已证明的引理替代递归计算。** Agda 不需要归约证明项，只需要引用等式。

```agda
-- scalar-zero n T₁ : T₁ ·v 0⃗ n ≡ 0⃗ n（已证明的引理，直接引用）
step1 = trans (cong (_+v 0⃗ n) (scalar-zero n T₁))
              (+v-identityˡ n (0⃗ n))
```

**关键区别**:
- `scalar-one n (0⃗ n)` → Agda 试图**计算**证明项 → 对变量 n 卡住
- `scalar-zero n T₁` → Agda 只需**引用**等式 → 通过

### 规则

**绝不要在 `cong` 中传入对变量递归的证明项。**
用已证明的引理（穷举法证明的）替代递归计算。
穷举法证明的引理对任何参数都成立，Agda 直接引用，不需要归约。

---

## 附录 3：trans 嵌套与代码优雅性 (v6, 2026-07-26)

### 核心洞察

**trans 嵌套是 GF(2) 语义不完备性的表现，GF(3) 语义下证明更优雅。**

### 实际分布

| 深度 | 文件数 | 占比 | 编译时间 |
|------|--------|------|----------|
| 1 | 110 | 79.1% | 2.71s |
| 2 | 26 | 18.7% | 4.20s |
| 3 | 1 | 0.7% | 3.81s |
| 4 | 2 | 1.4% | 2.78s |
| 5 | 1 | 0.7% | 2.79s |

### 关键发现

1. **编译时间与嵌套深度没有明显的正相关**
2. **大部分代码（79.1%）只使用深度 1**
3. **极少数代码（2.2%）使用深度 3+**
4. **最大深度是 5，且能编译通过**

### 优雅证明的原则

1. **优先使用 `≡-Reasoning` 语法**：每步一个引理，清晰可读
2. **trans 嵌套是组合独立 step 的方式**：每个 step 都应该有独立定义
3. **人类可读性比编译正确性更重要**：AI 可以暴力计算，但人类需要理解
4. **没有硬性上限，但应该追求优雅**

### 优雅证明示例

```agda
-- 优雅：使用 ≡-Reasoning
qM%POW2≡0 n = begin
  ((n / M) * M) % POW2                     ≡⟨⟩
  ((n / M) * (POW2 * POW3)) % POW2         ≡⟨ cong (_% POW2) (cong ((n / M) *_) (*-comm POW2 POW3)) ⟩
  ((n / M) * (POW3 * POW2)) % POW2         ≡⟨ cong (_% POW2) (sym (*-assoc (n / M) POW3 POW2)) ⟩
  (((n / M) * POW3) * POW2) % POW2         ≡⟨ m*n%n≡0 ((n / M) * POW3) POW2 ⟩
  0 ∎
  where open ≡-Reasoning

-- 可接受：trans 嵌套组合独立 step
real-eq = trans r-step1 (trans r-step2 (trans r-step3 (trans r-step4 r-step5)))
-- 每个 step 都有独立定义，可单独理解和验证
```

### 规则

1. **优先使用 `≡-Reasoning` 语法**：每步一个引理，清晰可读
2. **trans 嵌套用于组合独立 step**：每个 step 都应该有独立定义
3. **追求优雅而非硬性限制**：没有嵌套层数的硬性上限
4. **人类可读性优先**：AI 可以暴力计算，但人类需要理解

---

## 附录 4：⊕/⊗ 无 fixity 声明的解析问题 (v4, 2026-07-24)

### 问题

`Trit.agda` 中 `_⊕_` 和 `_⊗_` 没有 `infixl` 声明。在 `≡-Reasoning` 或多行表达式中，Agda 解析器无法确定结合方向，产生 `Parse error`。

**典型症状**:
```
Parse error
(f d0 ⊗ g (x +12 neg12 d0)) ⊕<ERROR>
```

### 解决方案

在使用 `⊕`/`⊗` 的模块顶部添加 fixity 声明：

```agda
infixl 6 _⊕_
infixl 7 _⊗_
```

### 规则

1. **任何使用 `⊕`/`⊗` 的新模块必须在顶部添加 fixity 声明**。
2. **多行 `⊕` 表达式必须用显式括号**，不依赖 fixity。
3. **`≡-Reasoning` 中的 `⊕` 表达式必须有 fixity 或显式括号**。

---

## 附录 5：证明策略选择优先级 (v6, 2026-07-26)

### 正确的策略选择顺序

1. **CRT 正交分解**：Z/12Z ≅ Z/3Z × Z/4Z，12 项操作分解为 3+4 正交分量
2. **代数链**：使用 `≡-Reasoning`，每步一个引理
3. **穷举法**：3/9/27 case，论域有限时可靠
4. **分离引理 + 组合**：复杂证明分解为小引理
5. **符号化改造 (let-free + 半线性/线性基展开)**：穷举超过 27 case 时的唯一正解（附录 10）

### 绝对禁止

- ❌ 无 fixity 的多行 ⊕ 表达式（解析错误）
- ❌ 在 `cong` 中传入对变量递归的证明项（卡住）
- ❌ 用 `≡-Reasoning` 而不添加 fixity 声明（解析错误）
- ❌ 域乘法/环运算/坐标映射用 `let` 绑定（破坏复合项归约，见附录 10）

### 正确的代数链证明模板

```agda
-- 使用 ≡-Reasoning 语法（优先）
lemma : ∀ a b → (a ⊕ b) ⊕ c ≡ a ⊕ (b ⊕ c)
lemma a b = begin
  (a ⊕ b) ⊕ c
    ≡⟨ ⊕-assoc a b c ⟩
  a ⊕ (b ⊕ c)
  ∎ where open ≡-Reasoning

-- 组合独立 step（可接受）
main-proof = trans step1 (trans step2 step3)
-- 每个 step 都有独立定义，可单独理解和验证
```

---

## 附录 6：大 Fin 递归深度超限与引用分离策略 (v5, 2026-07-25)

### 问题

对 `Fin 9` 的递归 `compress`/`expand` 在新模块中定义或对 `Fin 729` 调用时，
Agda 2.9.0 类型检查器试图归一化 729 层递归，导致编译超时（300s+ 无输出）或
`UnequalTerms`（fromℕ< 证明项卡住）。

**典型症状**:
```
agda: Heap exhausted (递归归一化)
或
The terms Data.Fin.fromℕ< _ ... and ... are not equal (stuck)
或
编译无响应 (180s+ 超时)
```

**根因**: 新模块中定义的 `Fin` 递归函数（如 `compress` (suc k) (suc j) = suc (compress k j ...)）
被 Agda 类型检查器在每次使用时展开全部递归层。对 `Fin 729`，展开深度为 729 层。

### 解决方案

**1. 引用已编译模块的递归定义（首选）**

已编译模块（如 `jac_Pigeonhole.agda`）中的递归函数在导入时**不触发重新归一化**。
Agda 只检查已编译模块的 `.agdai` 接口签名，不展开函数体。

```agda
-- ✅ 引用已编译的 compress/expand（不会超时）
open import Sovereign.Algebra.Jacobian.jac_Pigeonhole
  using (compress; expand; expand∘compress)

-- 使用示例（Fin 729 直接调用，不重现递归）
g i = compress k (t6ToFin (F (finToT6 i))) (ne-k i)
ei≡ej = trans (sym (expand∘compress k _ _))
        (trans (cong (expand k) gi≡gj)
               (expand∘compress k _ _))
```

**绝对禁止在新模块中重新定义 `compress`/`expand` 等 `Fin` 递归函数。**

**2. ℕ 级算术替代 `Fin` 递归（T6.agda 模式）**

对于构造新的大 `Fin` 值，用 `fromℕ<` + ℕ 算术一步完成，避免逐层 `zero`/`suc` 构造。

```agda
-- ✅ fromℕ< 一步构造（非递归）
finToT6 : Fin 729 → T6Lattice
finToT6 y =
  fromℕ< (m%n<n (((((toℕ y /ℕ 3) /ℕ 3) /ℕ 3) /ℕ 3) /ℕ 3) 3) ∷
  fromℕ< (m%n<n ((((toℕ y /ℕ 3) /ℕ 3) /ℕ 3) /ℕ 3) 3) ∷
  ...

-- ❌ 逐层 suc 构造 depth-729（会超时）
buildVec : Fin 729 → Vec Trit 6
buildVec zero = ...
buildVec (suc n) = ... (suc (buildVec n)) -- depth 729
```

**3. `searchFin` + `Dec` 替代递归遍历**

对于需要遍历大 `Fin` 集合的操作，用已有 `searchFin` + 可判定谓词替代手写递归。

```agda
-- ✅ 已编译的 searchFin（0 postulate）
pigeonhole-T6 F inj q with searchFin P dec-P
  where P i = F (finToT6 i) ≡ q; dec-P i = t6-dec-eq _ _

-- ❌ 手写 729 层 case split 或 recursion（不可行）
```

**4. 局部定义量级限制**

在同一个 `where` 块中定义的递归函数 + 属性引理（如 `expand∘compress`），如果
两者都在当前模块定义，Agda 会联合归一化。处理方式：

-   **分离递归函数和属性引理到不同模块**：函数在模块 A 定义并编译，属性引理在模块 B 引用模块 A 的函数

### 决策流程图

```
需要处理大 Fin（n > 100）操作？
  ├─ 函数已存在于编译模块？
  │    ├─ Yes → import 引用 → ✅ 安全
  │    └─ No  → 能否用 fromℕ< + ℕ 算术实现？
  │              ├─ Yes → 用 T6.agda 模式 → ✅ 安全
  │              └─ No  → 能否分解为小 Fin（n ≤ 9）的组合？
  │                        ├─ Yes → 分解 + 逐段证明
  │                        └─ No  → postulate（仅限项目既定模式，标注递归阻塞原因）
  └─ ...
```

### 实例：`Fin 9` compress 在 `Fin 729` 上的安全使用

```agda
-- jac_Pigeonhole.agda (已编译): compress 对 ∀ {n} 证明
compress : {n : ℕ} → (k : Fin (Data.Nat.suc n)) → ...

-- jac_4320DClosure.agda (新模块): 直接引用，不重现递归
open import ...jac_Pigeonhole using (compress; expand; expand∘compress)
g i = compress k (t6ToFin (F (finToT6 i))) (ne-k i)  -- 对 Fin 729 安全
```

### 规则

1. **不在新模块中定义递归 Fin 函数**（`zero`/`suc` 模式匹配 > 100 层）
2. **使用已编译模块的递归函数**（引用，不重现归一化）
3. **优先 `fromℕ<` + ℕ 算术**（T6.agda 模式）构造大 Fin 值
4. **优先 `searchFin`** 替代递归遍历
5. **分离递归函数及其属性引理**到不同编译单元

---

## 附录 7：未来态 vs 过去态方法论 (PR #8611)

### 来源

PR #8611 修复 Agda #3733（Cubical 构造子内射性）。核心 bug：`makeTau` 的替换长度用 `nOld = size working_tel`（Gamma/过去态），但 tau 的实际域是 Delta（未来态），当 `nctel > 1` 时 Delta 比 Gamma 大。

### 修复

```haskell
nOld = size working_tel        -- Gamma 的大小（过去态）← 错误锚点
nTarget = nOld + nctel - 1     -- Delta 的大小（未来态）← 正确锚点
```

### 映射到证明构造

| makeTau | 证明构造 |
|---------|---------|
| Gamma = working_tel (过去态) | LHS / 源端表达式 |
| Delta = target (未来态) | RHS / 目标表达式 |
| `nOld = size Gamma` (bug) | 从 LHS 逐项剥离/重排 |
| `nTarget = size Delta` (fix) | 锁定 RHS，CRT 分解推导 |
| "不回溯" | 不写 11 步 trans 链 |

### 文档锚点

- `docs/agda-3733-injectivity-deep-analysis.md` §8.1 — 时间状态错位 (temporal state desync)
- `docs/agda-compiler-architecture.md` L969 — 范式对比表
- `docs/agda/形式化状态评估与下一步_2026-07-08.md` L76 — "未来态 vs 过去态是承重的"
- `docs/agda/离散动力学规约范式.txt` L22 — 废弃线性历史追踪
- `docs/agda/广义 CRT 投影系统的全息架构.txt` L19 — 原始表述

### 诚实边界

未来态原则是 PR #8611 的真实承重修复。CRT/环面/幻方是合法架构隐喻，但代码中不直接计算 CRT 余数。证明中使用 CRT 分解是因为 `Duodecimal.agda` 已有 `crt12`/`π3`/`π4` 基础设施，不是因为编译器内部用了 CRT。

---

## 附录 8：stdlib 2.4 编译兼容性手册 (v7, 2026-07-27)

### 背景

项目自 v6.8 (a258e7a) 从旧 stdlib 升级到 stdlib 2.4。stdlib 2.4 将导出从隐式改为 opt-in （显式 `using`），导致 10+ 个非核心模块出现编译错误。以下记录所有修复模式。

### 模式 1：InfectiveImport (--rewriting vs --safe)

**症状**: `SafeFlagPragma` from `Level.agda` + `InfectiveImport` from `Trit`

**根因**: `--rewriting` 传染到 stdlib `Level.agda` 的 `--safe`，二者不兼容。

**修复**: 命令行不带 `--rewriting` 标志，文件头保留 `{-# OPTIONS --rewriting --guardedness #-}`。

```bash
# ✅ 正确
agda --guardedness Module.agda

# ❌ 错误
agda --rewriting --guardedness Module.agda  # → SafeFlagPragma
```

### 模式 2：隐式导出移除 (stdlib 2.4 最大变化)

**症状**: `NotInScope` for `Bool`, `true`, `false`, `_≥_`, `_≡ᵇ_`, `s≤s`, `z≤n`, `_⊎_`, `¬suc≤zero`

**根因**: stdlib 2.4 改为 opt-in 导出。以下符号不再隐式可用，必须显式导入:

| 符号 | 导入路径 | 版本 |
|------|---------|------|
| `Bool`, `true`, `false` | `Data.Bool` | 全部 |
| `_≥_` | `Data.Nat` | 全部 |
| `_≡ᵇ_` | `Data.Nat` (renamed from `_==_`) | 全部 |
| `s≤s`, `z≤n` | `Data.Nat` | 全部 |
| `_⊎_` | `Data.Sum.Base` | 全部 |
| `¬suc≤zero` | **stdlib 2.4 中不存在** → 本地定义 | 2.4 |
| `¬_` | `Relation.Nullary.Negation` | 2.4 |
| `_∈_`, `_∉_` | `Data.List.Membership.Propositional` | 2.4 |
| `_+_` (ℚ) | `Data.Rational` → rename to `_+ℚ_` | 2.4 |

### 模式 3：构造子/运算符命名冲突

**症状**: `AmbiguousName` for `zero`, `suc`, `_+_`

```agda
-- 冲突: Data.Nat vs Data.Fin 共享构造子名
open import Data.Nat using (zero; suc)  -- ℕ 版本
open import Data.Fin using (Fin) renaming (zero to fzero; suc to fsuc)  -- Fin 版本

-- 冲突: Data.Nat vs Data.Integer 共享运算符
open import Data.Integer using (ℤ; +_; -[1+_]) renaming (_+_ to _+ℤ_; _*_ to _*ℤ_)

-- 冲突: Data.Nat vs Data.Rational 共享运算符
open import Data.Rational using (ℚ; _/_; -_) renaming (_+_ to _+ℚ_)
```

### 模式 4：record 类型不等判定 (已修复, 2026-07-27)

**症状**: `UnsolvedConstraints: Is empty: R1 ≡ R2 (stuck)`

**根因**: Agda 2.9.0 类型检查器中，`--guardedness` 导致元变量阻碍类型归约。

**修复**: Agda 编译器双补丁 (`Empty.hs` + `Unify.hs`) 已推送到 `clearnature/agda`。

- `Empty.hs: tel <- instantiateFull tel` — 归约元变量后分裂
- `Unify.hs: d /= d' → NoUnify (UnifyConflict ...)` — 不同 Def 节点立即判空

**限制**: `--guardedness` 下 record 类型不等仍不可证（HolographicPi pattern）。此时 postulate 为合法机械约束——数学上可证但 Agda 编译器受限。

**已知可用场景** (已测试 13/13 通过):
- `data D1 ≠ data D2` → `λ ()`
- `record R1 ≠ record R2` → `λ ()` (无 `--guardedness` 时)
- `det(Iₙ) ≠ 0gf9` → `λ ()` (YM 质量间隙)
- `HolographicPi ≠ RationalApproximation` → postulate (有 `--guardedness`)

### 模式 5：`Data.X.Y.Trust` 非法标识符

**症状**: `ParseError: Illegal name in type signature: Data.Nat.Trust`

**根因**: Agda 不允许 `.` 在标识符中（`.` 是模块访问投影）。

**修复**: 改 CamelCase:
```agda
-- ❌ 非法
Data.Nat.Trust : TrustLevel
Data.Nat.Trust = UNTRUSTED

-- ✅ 合法
dataNatTrust : TrustLevel
dataNatTrust = UNTRUSTED
```

同样 `module_name` 非法（`module` 是关键字）→ 改 `modName`。

### 模式 6：`--cubical` 前置检查

**症状**: `InfectiveImport` 或 `NotInScope` for Cubical 符号

**规则**: 任何导入 `Cubical.Foundations.Prelude` 的模块必须在文件头声明 `--cubical`:
```agda
{-# OPTIONS --cubical --rewriting --guardedness #-}
```

**冲突解决**: 如果同时需要 `_≡_` from PropEq 和 Cubical:
```agda
open import Cubical.Foundations.Prelude hiding (_≡_; refl)
open import Relation.Binary.PropositionalEquality using (_≡_; refl)
```

### 预存错误文件清单 (2026-07-27)

以下 10+ 模块自 v6.8 就有 stdlib 2.4 兼容问题，全部在非核心目录:

| 目录 | 文件 | 错误类型 |
|------|------|---------|
| Trust | External | ✅ 已修复 |
| Diagnosis | ElectricCivilization | 类型层级+缺失定义 级联 |
| Density | SevenStages | 导入冲突 10+ 级联 |
| Projection | Decimal/Proofs | 导入+?孔 |
| RootMath | LengthLattice | UnequalTypes |
| Constitution | Boundaries | NotInScope |
| Coupling | CartanTorsion/ParityViolation/SpinTwistor/TQ10 | Parse/NotInScope |

**处理策略**: 这些文件需要逐文件完整重写（非简单补 import），不影响 315+ 核心模块 0 error。

### 决策流程图

```
遇到编译错误？
  ├─ SafeFlagPragma？→ 去掉命令行 --rewriting
  ├─ InfectiveImport？→ 检查文件是否有 --rewriting (需要) 或去掉命令行 flag
  ├─ NotInScope: Bool/true/false/≥/≡ᵇ？ → 补 Data.Bool/Data.Nat 显式导入
  ├─ AmbiguousName: zero/suc/_+_？ → rename Fin→fzero/fsuc, ℤ→_+ℤ_
  ├─ NotInScope: ¬_？ → Relation.Nullary.Negation
  ├─ NotInScope: _∈_/_∉_？ → Data.List.Membership.Propositional
  ├─ ParseError: Data.X.Y.Z pattern？ → 改 CamelCase
  ├─ UnsolvedConstraints: record ≡ record？ → postulate (--guardedness 下合法)
  └─ >10 个级联错误？ → 标记预存, 文件需要完整重写
```

---

---

---

## 附录 9：Agda / 大衍 形式化证明专项知识库

> 本附录由 proof-engineer 技能的知识迁移而来。

### 9.1 预检清单
- [ ] 文件头是否有 `{-# OPTIONS --rewriting --guardedness #-}`？
- [ ] 是否导入 `Cubical.Foundations.Prelude` 但未声明 `--cubical`？
- [ ] 是否有 `postulate ... where ...` 语法反模式？
- [ ] 是否有 `data X` 嵌套在 `record ... where` 内？
- [ ] 域乘法/环运算/坐标映射（如 `frobenius`）是否用了 `let`？→ 必须 let-free 直接模式匹配（附录 10）

### 9.2 六类错误指纹与修复食谱

| 类 | 指纹 | 根因 | 修复 |
|----|------|------|------|
| **A** | `NotInScope` for stdlib符号 | stdlib 2.4 opt-in 导出 | 补 `using`，如 `open import Data.Bool using (Bool; true; false)` |
| **B** | `NotInScope` for Sovereign符号 | 模块路径不存在 | 查正确路径；常见：`RootMath.Base`→`Base.Trit` |
| **C** | `AmbiguousName` for `_+_`/`zero`/`suc` | 多模块同名构造子 | `Data.Integer` renaming `_+_` to `_+ℤ_`；`Data.Fin` renaming `zero` to `fzero` |
| **D** | `InfectiveImport` / `SafeFlagPragma` | `--rewriting` vs `--safe` | 文件头保留 `--rewriting`，命令行不加 |
| **E** | `ParseError` for `postulate...where` | 语法非法 | 分离为独立 `postulate` 块 |
| **F** | `UnequalTypes` / `Set` vs `Set₁` | 大数据类型层级 | `Set → Set₁` |
| **G** | `InstanceNoCandidate` / `UnsolvedMetaVariables`（`NonZero (f k)`） | 除数对变量不归约到 `suc` | 换字面量除数 + 按位数递归（附录 12） |
| **H** | `ShouldBeEmpty`（列出 `primHComp`） | `_≤_` 空模式被 cubical 构造子阻挡 | 换单调引理可组合的界，或 `⊥-elim` + 独立引理（附录 12 §6） |
| **I** | `WrongHidingInApplication` / `UnequalTerms` 于 `+-distrib-/-∣ˡ` | 隐式 `{m}` 与 `∣` 证明的隐式 `m` 同名捕获 | 改用 `m<n⇒m/n≡0` 或避开 `/` 提取（附录 12 §7） |

### 9.3 特定符号迁移表

| 旧路径 (无效) | 新路径 (有效) |
|---------------|---------------|
| `Sovereign.RootMath.Base` | `Sovereign.Base.Trit` |
| `Data.Empty.¬_` | `Relation.Nullary.Negation.¬_` |
| `Data.Nat.Properties.¬suc≤zero` | **stdlib 2.4 不存在** → 本地定义 |
| `Data.List._∈_` | `Data.List.Membership.Propositional._∈_` |
| `Data.X.Y.Trust` (非法标识符) | `dataXyTrust` (camelCase) |
| `module_name` (关键字冲突) | `modName` |

### 9.4 性能陷阱
| 场景 | 症状 | 优化策略 |
|------|------|----------|
| 大 Fin 递归 | `Heap exhausted` / 编译超时 | 引用已编译模块，不重新定义 |
| `mod-helper` 展开 | `UnsolvedConstraints` | 添加 `REWRITE` 规则 |
| `NonZero (f k)` 实例找不到 | `InstanceNoCandidate` / `UnsolvedMetaVariables` | 换除数（用字面量）+ 按位数递归，见附录 12 |

### 9.5 回归测试命令
```bash
cd /data/work/discrete-mathematics
/opt/agda/agda --guardedness src/Sovereign/Path/To/File.agda
```

### 9.6 已验证修复记录 (2026-07-27)

以下模式在实际修复中100%验证通过：

| 文件 | 原始错误 | 修复动作 | 迭代数 | 验证 |
|------|---------|---------|--------|------|
| External.agda | ParseError `module_name`+`Data.Nat.Trust` | 关键字→modName + 路径camelCase + 补Vec/String导入 | 6 | ✅ |
| Boundaries.agda | NotInScope IsLegalTransform | 本地定义 `(ℕ→ℕ)→Set` | 1 | ✅ |
| WuXing.agda | ChiralWuXing未定义 | data ChiralWuXing+chiralDual对合(3refl) | 1 | ✅ |
| CartanTorsion.agda | ParseError `postulate...where` | E类重构: 分离块+WuXingAmplitude移出+路径修正+_+ℤ_ | 8 | ✅(被EnergyGap链阻) |
| 七问题核心(52模块) | InfectiveImport | D类: 命令行不加--rewriting | 1 | ✅ |
| HolographicPi | 3个λ() stuck | Agda补丁(Empty+Unify) | — | ✅ |

### 9.7 无效修复反模式（禁止重复）

| 反模式 | 为什么无效 | 正确做法 |
|--------|-----------|---------|
| 逐错误修复(whack-a-mole) | Agda遇第一个错误停止，每轮只露1个 | Loop Engineering 全量诊断 |
| 对已存在定义postulate(contamination) | 引入连续统污染 | 查现有模块→import而非postulate |
| 不改flags直接加--cubical | SafeFlagPragma冲突 | 评估是否真需要Cubical |
| 对所有缺失import逐一加 | 10+级联→无限循环 | 一批读完所有import需求→批量补 |

### 9.8 全周期已验证模式 (2026-07-11 ~ 2026-07-27)

以下模式从 150+ 次 archived sessions + git 提交中提炼，全部经编译验证。

#### 证明策略模式

| 模式 | 首次出现 | 适用场景 | 验证状态 |
|------|---------|---------|---------|
| Postulate→refl 转换 | fc7bb30 | CRT proofs: 8/10 postulates→proof(80%) | ✅ |
| theorem-maximality | 111f07c | 有限组合事实替代无限域 | ✅ |
| 大常数 REWRITE | 9e34298 | T6≃Fin729: div3k/mod3k rewrite | ✅ |
| 参数化重写消除超时 | a4597ca | HolographicSpace: 大数索引归一化 | ✅ |
| 缺失定义→桥接层 | e314084 | sumGF9单点支撑→消除2/3 postulate | ✅ |
| with抽象消除 | 1a357e7 | Closure.step: with→显式case | ✅ |

#### 编译修复模式

| 模式 | 修复动作 | 验证文件 |
|------|---------|---------|
| InfectiveImport (--rewriting vs --safe) | 命令行不加--rewriting | 52 Problem模块 |
| 隐式导出移除 (stdlib2.4) | 逐符号explicit using | External |
| 命名空间冲突 (零/后继/加) | rename: fzero/fsuc/_+ℤ_/_+ℚ_ | CartanTorsion |
| postulate...where 语法 | 分离为独立 postulate 块 | CartanTorsion, ParityViolation |
| data内嵌record where | 提升为顶层定义 | WuXingAmplitude |
| Data.X.Y.Trust 非法名 | camelCase + modName | External |
| ≤-refl 全限定 | Data.Nat.Properties.≤-refl | q5<3-lemma |

#### 性能模式

| 模式 | 症状 | 优化 |
|------|------|------|
| 大Fin递归超时 | Heap exhausted / 300s+ | 引用已编译模块 + fromℕ< |
| 大数取模展开 | mod-helper stuck | REWRITE 规则 |
| 递归联合归一化 | 新模块递归+属性→超时 | 分离函数和属性到不同模块 |

### 9.9 历史错误指纹数据库

基于 150+ archived sessions 的累积错误指纹：

```
SafeFlagPragma          → D类: 检查 --rewriting vs --safe
InfectiveImport         → D类: 评估 flags 传染链
NotInScope (stdlib)     → A类: 补 explicit using
NotInScope (Sovereign)  → B类: 修正模块路径
AmbiguousName           → C类: renaming 冲突符号
ParseError (postulate)  → E类: 语法重构 where 块
UnequalTypes            → F类: 类型层级 Set→Set₁
UnsolvedConstraints     → 检查: REWRITE规则/递归归一化/空洞未填充
Heap exhausted          → 性能: 引用已编译模块, 不重新递归
ConstructorDoesNotFit   → F类: 大数据类型, Set→Set₁
UnequalTerms (refl)     → 检查: 定义vs规范是否一致, 补import
InstanceNoCandidate     → NonZero 实例搜索失败: 除数对变量不归约到 suc, 见附录 12
ShouldBeEmpty           → _≤_ 空模式被 primHComp 阻挡, 见附录 12 §4
WrongHidingInApplication→ 隐式参数捕获 ({m = m} + ∣ 证明), 见附录 12 §5
```

---

## 附录 10：`let` 绑定破坏归约 — 域运算必须 let-free (v8, 2026-09-08)

### 症状

对**复合项**（如 `(x *F y) *F z`）做 `cong`/`cong₂` 或引用分配律时，报 `UnequalTerms`，
且错误信息里 `.proj₁`/`.proj₂` **卡在复合项上**：

```
The terms
  a .proj₁ .proj₁ ⊕ b .proj₁ .proj₁
and
  a .proj₁ .proj₁
are not equal at type Trit
```

**关键判据**：抽象变量上的同名引理（`*F-distribʳ a b c`）编译通过，换成复合项就失败。
差别只在参数是不是复合项 → 这是**归约问题**，不是证明策略问题。

### 根因

`let` 在 Agda 中展开为 `case`，conversion checker 无法对含 `case` 的复合项归一化：

1. 外层 `*F` 试图展开 → 撞上 `let` → 暂停
2. `projᵢ` 作用于未归约的配对 → 卡住
3. 目标类型里含复合 `*F` 项的等式全部失败

即：**`let` 遮蔽了配对结构，归约路径断裂**（"信息不丢失"原则在编码层同样成立）。

### 修复：let-free 直接坐标形式

```agda
-- ❌ let 绑定：复合项不归约
_*F_ : F → F → F
_*F_ x y =
  let a = proj₁ x
      b = proj₂ x
      ...
  in (a ⊗ c ⊕ negate (b ⊗ d)) , (a ⊗ d ⊕ b ⊗ c)

-- ✅ let-free：函数头模式匹配，projᵢ 直接归约
_*F_ : F → F → F
(a , b) *F (c , d) = ((a ⊗ c) ⊕ negate (b ⊗ d)) , ((a ⊗ d) ⊕ (b ⊗ c))
```

修复后复合参数上的 `*F-distribʳ` / `*F-distribˡ'` / `cong-+F` 全部直接可用。
`frobenius`（σ 的坐标公式）同理必须 let-free。

### 实测证据 (GF729Field, 6c63f6a)

| 项 | 修复前 | 修复后 |
|---|---|---|
| `*F-distribʳ` 复合参数 | `UnequalTerms` (projᵢ stuck) | ✅ 直接可用 |
| `frobenius-is-cube` | 729 条 refl 穷举 | 构造性 (半线性 + 基一致) |
| 净行数 | 1910 | 1478 |

`*F` 曾是全库唯一带 `let` 的域乘法；GF243/GF81/GF27 一直是 let-free，所以从未遇到此问题。

### 配套范式：Semilinear + semilinear-ext3

let-free 之后可搭半线性框架，把"有限域上两个映射相等"降为"基上相等"：

1. `record Semilinear f`：`sadd : f (a+b) ≡ fa+fb` + `sscalar : f (c·w) ≡ σ(c)·f w`
2. `expand3-sem`：按基 {1, t, t²} 展开（用 `decomp`）
3. `semilinear-ext3`：基上一致 → 全域一致（`cong` 只作用于抽象变量）

```agda
frobenius-is-cube = semilinear-ext3 frobenius cubeMap SemF SemC refl frobenius-t frobenius-t2
```

其中 `cube-add`（Freshman's dream，特征 3: (a+b)³=a³+b³）由平方展开 + 分块分配 + 中间相消得到。
（`Linear`/`linear-ext3` 是同一范式的 GF9-线性版，见 `*F-assoc` 的三级嵌套扩展。）

### 规则

1. **域乘法/环运算一律 let-free 直接模式匹配**（库内 GF243/GF81/GF27 惯例）
2. **`frobenius`/σ 等坐标映射一律 let-free**
3. **`UnequalTerms` 且 `.projᵢ` 卡在复合项 → 先查被调函数的定义形式（有没有 `let`），不要先怀疑证明策略**
4. **禁止用穷举绕过归约问题**：729/243/81/27-case refl 是暴力计算，不是构造性证明；归约修好后应改写为符号证明
5. **半线性/线性映射的相等**：用 `Semilinear`/`Linear` + 基展开，`cong` 只作用于抽象变量

### 调试决策树

```
UnequalTerms?
  ├─ 错误里 .projᵢ 卡在复合项？        → 检查定义是否含 let → 改 let-free
  ├─ 抽象变量通过、复合项失败？        → 同上（归约问题，非策略问题）
  ├─ 裸 cong₂ _+F_ 失败？             → 显式标注 λ (u v : F) → u +F v（cong-+F）
  └─ 定义 vs 规范不一致？              → 补 import / 查约化规则
```

---

## 附录 11：GF(3ⁿ) Frobenius 构造化范式 (v9, 2026-09-09)

### 适用场景

`frobenius-is-cube : ∀ x → frobenius x ≡ x³` 在 GF(3ⁿ) 上用 **3ⁿ 条 refl 穷举**。
**上限：≤27 case 可接受；81/243/729 必须符号化。**

| 模块 | 维度 | 穷举删除 | 框架 | 提交 |
|------|------|---------|------|------|
| GF729Field | 3 (GF9-系数) | 729 → 0 | Semilinear | 6c63f6a |
| GF27 | 3 | 27 → 0 | Linear27 | b409a9b |
| GF81 | 4 | 81 → 0 | Lin81 | 91f1644 |
| GF243 | 5 | 243 → 0 | Lin243 | f1b0551 |

### 核心范式：线性框架 + 基展开

GF(3ⁿ) 是 GF(3) 上的 n 维向量空间。两个 GF(3)-线性映射在基上一致 ⇒ 全域相等。

```agda
record Lin (f : F → F) : Set where
  field ladd : ∀ a b → f (a + b) ≡ f a + f b

-- 关键简化: GF(3) 标量 = 重复加法, lscalar 由 ladd 导出
lscalar-der f ladd T₀ w = f0-zero f ladd      -- f 0 ≡ 0 (幂等消去)
lscalar-der f ladd T₁ w = refl
lscalar-der f ladd T₂ w = ladd w w

linear-extN : Linear f → Linear g → 基上一致 → ∀ x → f x ≡ g x
```

**证明链**：`cube-add`(Freshman's dream) + `cube-scalar` → Lin cubeMap；
`frobenius-add` + `frobenius-scalar` → Lin frobenius；两者基上一致 → 定理。

**frobenius-mul 由 cube 导出**（不独立硬算）：
`σ(xy) = (xy)³ = x³y³ = σx·σy`，经 `cube-mul` + `mul-square` + `mul-perm`。

**GF729 特殊**：系数域是 GF9，σ 不固定 GF9（σ(c)=c³≠c）→ 用 `Semilinear`
（`sscalar : f (c·x) ≡ σ(c)·f x`）而非 `Linear`。

### 前置条件：乘法结合律

`cube-add` 展开必然用 `*gf-assoc`。若缺失，用同一框架三级嵌套闭合：
z-层（固定基 b1,b2）→ y-层（固定基 b1）→ x-层。
基三元组：GF27 27 个、GF81 64 个、GF243 125 个（全 refl，基元素乘积已约化）。

### 五个工程陷阱（实测）

| 陷阱 | 症状 | 修复 |
|------|------|------|
| 裸 `cong₂ _+gfN_` | 复合项 `UnequalTerms` | 显式标注 `cong-+N p q = cong₂ (λ (u v : F) → u +gfN v) p q` |
| `sym` 方向 | `assoc a b c` 给 `(a·b)·c ≡ a·(b·c)` | 看目标方向决定是否 `sym` |
| 零乘不归约 | `gf-zero *gf y` 卡住 | `zero-mul-l/r`（幂等消去 + 分配律导出） |
| 标量作用展开 | `T₂ *s w` = `w +gf w` | 需 `two-mul-sq`（`(w+w)²=w²`，经 `neg-mul-neg`）桥接 |
| 辅助引理顺序 | `NotInScope` | Agda 是顺序作用域，被用的引理必须先定义 |

### 验证协议（每模块）

1. 草稿模块编译绿（不动原文件）
2. **对抗验证**：具体点（原点/生成元/混合点/同态/结合律）上构造性定理实例
   与独立 `refl` 计算交叉比对 —— 这是发现论证空洞的唯一可靠手段
3. 合并回原文件 + 删穷举 + 编译绿
4. 下游模块（TowerConnection）编译绿
5. 0 postulate / 0 hole / 0 sorry 审计
6. 全库 `engineering/check_all_modules_parallel.sh` 绿
7. 提交（附验证证据）

**范式详情**：`memory/frobenius-constructivization.md`

---

## 附录 12：`NonZero` 实例搜索失败与「按位数递归」范式 (v10, 2026-09-09)

### 0. 决策树（先查这里）

```
要在符号参数上做 % / ？
  ├─ 除数是字面量（3, 4, ...）？        → ✅ 有实例，直接用
  ├─ 除数是 3^k 等「对变量不归约」的表达式？
  │    ├─ 能不能只用 % 3 / / 3 重写目标？ → ✅ 按位数递归（§3）
  │    └─ 必须用 % 3^k？                  → 先做 remN-full 式归纳，避开它（§5）
  └─ 具体数值不等式要用 () 消去？
       └─ 报 ShouldBeEmpty？ → 换单调引理可组合的界（§6）
```

### 1. 症状

要用 `3 ^ k` 作除数（`n % 3 ^ k`、`n / 3 ^ k`）时：

```
error: [InstanceNoCandidate]
No instance of type NonZero (3 ^ k) was found in scope.
when checking that (3 ^ k) is a valid argument to a function of
type (divisor : ℕ) .⦃ _ : NonZero divisor ⦄ → ℕ
```

即使显式给 `{{nz3pow {k}}}` 也不解决，换成：

```
error: [UnsolvedConstraints]
  3 ^ _k_20 = 3 ^ k : ℕ (blocked on _k_20)
```

### 2. 根因（两条，都不是数学问题）

**(a) `3 ^ k` 对变量 `k` 不归约到 `suc` 形式。**
stdlib 的 `nonZero : ∀ {n} → NonZero (suc n)` 是唯一自动实例，实例搜索需要看到 `suc`。
但 `3 ^ suc k` 归约成 `3 * 3 ^ k` = `3 ^ k + 2 * 3 ^ k`，**内层 `3 ^ k` 对变量卡住**，
外层 `+` 无法归约到 `suc` → 找不到实例。同理 `nz3pow : ∀ {k} → NonZero (3 ^ k)` 内部
`m^n≢0`/`>-nonZero` 各自带 instance 参数，作为另一个 instance 使用会留下未解元变量。

**(b) 自证 `NonZero (3 ^ k)` 也难。** `nonZero` 构造子要求参数定义性地是 `suc _`；
`≢-nonZero` 要求 `n ≢ 0`，而 `m^n≡0⇒m≡0` 返回的是 `3 ≡ 0`（= `Irrelevant Empty`），
直接返回会报 `UnequalTypes`；用 `with m^n≡0⇒m≡0 3 k eq ... | ()` 可以闭合单点引理，
但把它做成 instance 仍会在使用点留下元变量。

### 3. 修复范式 A：只用字面量除数 + 按位数递归

**核心洞察：`% 3` 与 `/ 3` 的字面量 3 有实例（`3 = suc (suc (suc zero))`），
`3 ^ k` 没有。所以证明里只出现 `% 3`、`/ 3`。**

把值函数与解码器改成**按位数递归**，用依值类型精确控制层数：

```agda
Val : ℕ → Set
Val zero    = ℕ
Val (suc k) = ℕ × Val k

valN : ∀ k → Val k → ℕ
valN zero    x     = x
valN (suc k) (x , d) = x + valN k d * 3

decN : ∀ k → ℕ → Val k
decN zero    n = zero
decN (suc k) n = n % 3 , decN k (n / 3)

remN : ℕ → ℕ → ℕ
remN zero    n = zero
remN (suc k) n = n % 3 + remN k (n / 3) * 3

-- 往返引理: 纯 refl + cong, 零算术引理
valN-decN : ∀ k n → valN k (decN k n) ≡ remN k n
valN-decN zero    n = refl
valN-decN (suc k) n = cong (λ z → n % 3 + z * 3) (valN-decN k (n / 3))
```

### 4. 反模式：分层值函数丢参数

**不要**用 `val1..val5` 这种「每层少一个参数」的家族：

```agda
val5 (x1 , x2 , x3 , x4 , x5) = x1 + val4 (x2 , x3 , x4 , x5) * 3   -- 第 5 位被丢弃
```

`decode5 n (suc k)` 把 `decode5 (n/3) k` 的前 4 项右移，于是
`val5 (decode5 n (suc k))` 与 `n % 3 + val5 (decode5 (n/3) k) * 3` **不 definitionally 相等**
（`val4` 只看前 4 项，`val5` 递归到第 5 项）。用 `Val k` 的依值类型让「层数」成为类型的一部分，
就没有这个问题。

### 5. 配套：有界情形只需 `remN-full`，不必碰 `% 3^k`

```agda
-- n < 3^k ⟹ 低 k 位就是 n 本身
remN-full : ∀ k n → n < 3 ^ k → remN k n ≡ n
remN-full zero n n<1 = sym (<1⇒0 n n<1)
remN-full (suc k) n n<3k =
  trans (cong (λ z → n % 3 + z * 3) (remN-full k (n / 3) n/3<3k))
        (sym (m≡m%n+[m/n]*n n 3))
  where
    n<3*3k : n < 3 * 3 ^ k
    n<3*3k = subst (λ z → n < z) (sym 3*3k≡3^suck) n<3k
       where 3*3k≡3^suck : 3 * 3 ^ k ≡ 3 ^ suc k ; 3*3k≡3^suck = refl
    n<3k*3 : n < 3 ^ k * 3
    n<3k*3 = subst (λ z → n < z) (sym (*-comm (3 ^ k) 3)) n<3*3k
    n/3<3k : n / 3 < 3 ^ k
    n/3<3k = m<n*o⇒m/o<n {n = 3 ^ k} {o = 3} n<3k*3
```

要点：`m<n*o⇒m/o<n` 的隐式 `{n}` 是**界**、`{o}` 是**除数**，必须用命名实参
`{n = 3 ^ k} {o = 3}` 钉住，否则 `n` 会被错误地统一到乘积上。
`subst (λ z → n < z)` 只用于**定义性相同但语法不同**的界（`3 * 3 ^ k` ↔ `3 ^ k * 3`），
两处都用 `refl` 闭合。

### 6. 同类陷阱：`_≤_` 的空模式被 `primHComp` 阻挡

```
error: [ShouldBeEmpty]
suc n ≤ 1 should be empty, but the following constructor patterns are valid:
  s≤s {._} {._} _
  Agda.Primitive.Cubical.primHComp {._} {._} {_} _ _
```

具体数值不等式（如 `3 < 4`、`4 ≤ 1`）**不能**用 `()` 消去，因为 `_≤_` 在本项目的
Agda 2.9.0-e8f5682-dirty + stdlib 2.4 组合下带 `primHComp` 构造子。

**修复**：把不可能分支交给 `⊥-elim` + 单独引理；或者干脆**换一个能被单调引理组合的界**：

```agda
-- ✅ 用 +-mono-< / *-monoʳ-< 组合，完全避开具体数值的空模式
bound19 : ∀ m n → m < 3 → n < 4 → m + 4 * n < 19
bound19 m n m<3 n<4 = +-mono-< m<3 (*-monoʳ-< 4 n<4)
```

**推论**：设计编码时，`Fin N` 的 `N` 要选**能被单调引理凑出来**的，不要死磕最小的界。

### 7. 同类陷阱：`+-distrib-/-∣ˡ` 的隐式 `m` 捕获

```
error: [UnequalTerms] The terms m and p * 4 are not equal at type ℕ
when checking that the expression divides p refl has type 4 ∣ m
```

`+-distrib-/-∣ˡ {m} n {d} → d ∣ m → (m + n) / d ≡ m / d + n / d` 的隐式 `{m}` 与
`∣` 证明里的隐式 `m` 是同一个变量：显式给 `{m = m}` 后，`divides-refl p` 的隐式 `m`
也被绑到外层 `m`（而不是 `p * 4`），于是类型不匹配。

**修复**：改用不需要 `∣` 证明的路径，如 `m<n⇒m/n≡0`（被除数小于除数时商为 0）；
或换一个避开 `/` 提取的编码方案。

### 8. 规则

1. **不要用 `3 ^ k`（或任何对变量不归约的表达式）作除数/取模**；用字面量除数 + 按位数递归
2. **不要写分层 `val1..valN` 值函数**；用依值类型 `Val k` 让层数进类型
3. **有界情形用 `remN-full` 式的归纳，不引入 `% 3^k`**
4. **具体数值不等式不要用 `()`**；换单调引理可组合的界，或 `⊥-elim` + 独立引理
5. **`m<n*o⇒m/o<n` 必须命名实参** `{n = 界} {o = 除数}`

### 9. 实测证据

| 项 | 修复前 | 修复后 |
|---|---|---|
| `val5 (decode5 n k) ≡ n % 3^k` | 分层 val + `NonZero (3^k)` → 卡死 | 弃用 |
| `valN-decN` | — | 纯 `refl`/`cong`，✅ 编译 |
| `remN-full` | — | 归纳 + `m<n*o⇒m/o<n`，✅ 编译 |
| `pointCode-roundtrip` | — | `valN-decN` + `remN-full` + `pc<729`，✅ 编译 |

**证据**：`NSEPresentation.agda`（回执 `49779e02…`，exit 0，0 postulate/0 hole）、
`memory/nse-t6-discrete-findings.md §7`、`prover_limits: agda-le-empty-pattern-primhcomp` /
`agda-div-distrib-implicit-m-capture`。

---

## 附录 13：有限动力学范式 — 单向注入 + 鸽巢 (v10, 2026-09-09)

### 适用场景

要证「状态空间有限 ⇒ 任何确定性演化的轨道最终周期」（离散意义下的「无爆聚」）。

### 反模式：先证往返，再证注入

先证「解码器是编码的左逆」再拉回周期，会把自己拖进两层麻烦：
解码器定义 + 往返引理 + 满射性。**有限性判据只需要单向注入。**

### 正范式：`orbit-eventually-periodic-fin`

已入库（`src/Sovereign/Analysis/FiniteDynamics.agda` §4b）：

```agda
orbit-eventually-periodic-fin :
  ∀ {A : Set} (N : ℕ) (enc : A → Fin N)
  → (∀ {x y} → enc x ≡ enc y → x ≡ y)      -- 只需注入性
  → (f : A → A) (x0 : A) → EventuallyPeriodic (orbit f x0)
```

证明：把 `enc ∘ orbit f x0` 的前 `N+1` 项交给 `Data.Fin.Properties.pigeonhole`
得碰撞 → 用 `enc` 注入性拉回 `A` → `orbit-collision-propagates` 传播。
**不需要解码器、不需要右逆、不需要满射性。**

用法（`FiniteDynamics.agda:102` 的 `orbit-eventually-periodic` 就是 `Fin N` 特例）：

```agda
-- 1) 造一个 A → Fin N 的编码（逐点取分量的 Fin 编码即可）
-- 2) 证它的注入性（分量的注入性 + ext 逐点）
-- 3) 交给定理
-- 4) 若编码是 enc (orbit f x0) 而非 orbit (Fin 侧) 的形式, 需一个交换引理:
--    commute : ∀ n → orbit g' (enc x0) n ≡ enc (orbit f x0 n)
--    commute zero    = refl
--    commute (suc n) = trans (cong g' (commute n)) refl   -- g' 需在 n 层与 enc 对齐
--    实际上直接把 enc ∘ orbit 交给 pigeonhole 更省事（见 FiniteDynamics §4b 实现）。
```

### 本库限制：无 `funExt`（非 cubical）

`ext`（`NSEPresentation.agda:96`）的签名是

```agda
ext : (∀ x → amp ψ x ≡ amp φ x) → (∀ x → ph ψ x ≡ ph φ x) → ∀ x → ψ x ≡ φ x
```

它给的是**逐点相等** `∀ x → ψ x ≡ φ x`，**不是**函数相等 `ψ ≡ φ`。
非 cubical 的 stdlib 没有 `funExt`。因此：

- **注入性假设尽量写成逐点形式**，或
- 把定理的 `inj` 假设改成逐点版本，或
- 需要 `ψ ≡ φ` 时改用 cubical `funExt`（需 `--cubical`，与 `REWRITE` 规则共存需另测）

### 编码注入性的两条独立路径（互为对抗验证）

同一编码可以给两条不共享引理的注入证明：

1. **编码侧剥离**：`pointCode` 的 6 层 `div3-add`/`mod3-add`（逐层取商/余数）
2. **解码侧往返**：`valN-decN` + `remN-full` + `pointCode-roundtrip`

两条都编译通过 ⇒ 注入性可信度远高于单条。

### 规则

1. **有限性判据只要单向注入**，不要先证往返
2. **优先复用** `orbit-eventually-periodic-fin`，不要自证鸽巢
3. **注入性假设写成逐点形式**（本库无 `funExt`）
4. **同一命题给两条独立证明路径**（对抗验证）
5. **`Fin N` 的 N 选能被单调引理凑出的**（见附录 12 §6）

### 实测证据

- `FiniteDynamics.agda` — `orbit-eventually-periodic-fin`，回执 `07221e82…`，exit 0
- `NSEPresentation.agda §13` — `valN-decN` / `remN-full` / `pointCode-roundtrip` /
  `decN6-pointCode-injective`（第二条注入路径），回执 `49779e02…`，exit 0
- 台账节点：`NSE.T10.roundtrip` / `NSE.T11.finite-dynamics` / `NSE.T12.phase-enc`（均 proven）
