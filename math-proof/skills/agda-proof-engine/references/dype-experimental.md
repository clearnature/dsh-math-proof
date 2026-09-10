# dype（大衍 DY-PE）实验性内核 — 源码地图与现状

> **定位**：dype 是项目自研的**实验性内核**，尚不完善，**不能替代 Agda 的地位**。
> 本文件是它的源码地图与阻塞现状，供需要了解/调试 dype 时查阅；
> **验证与裁决一律以 Agda 为准**（见 `agda-proof-engine/SKILL.md`）。
>
> **源码根：`dype 源码（`impl/local-paths.json` 的 `dypeRoot`）`**（Haskell，cabal 包名 `dype` + `dype-core`）。
> 与 `本库工作区（`impl/local-paths.json` 的 `workspace`）` 是双轨关系：dype 生成并检查证明项，**Agda 库是证明目标与裁决器**。

## 0. 一句话定位

dype = **Agda 内核替换**（`dype-core`，可执行文件 `dype`，`--version` 输出 `Agda version 2.9.0-dype`）
\+ **大衍证明生成引擎**（`Dayan.*` Haskell 库：解析 `.dy` → 生成 `.agda` → 调 agda 验证）。

- 可执行入口：`src/main/Main.hs` → `Agda.Main.runAgda`（`src/dype-core.cabal:947` 定义 `executable dype`）。
- 后端/生成器：`src/Dayan/`（`src/Dayan.hs` 汇总导出）。
- `.dy` 示例：`test/T6Lattice.dy`、`test/DetVerify.dy`、`test/DetPerf.dy`、`test/Det9x9Full.dy`。

## 1. 模块地图（`src/Dayan/`）

| 模块 | 作用 |
| --- | --- |
| `Core/Trit.hs` | GF(3) 三进制 |
| `Core/Tryte.hs` | Fin 729（6-trit 编码） |
| `Core/Torus.hs` | 离散环面 T⁶ |
| `Core/Constants.hs` | 144 / 46 / 6624 / LCM |
| `Compute/CRT.hs` | CRT 全局查表（6624 项，规范代表元） |
| `Compute/Orbit.hs` | Orbit–Stabilizer 分解 |
| `Compute/Cascade.hs` | 极限环级联 |
| `Compute/ModArith.hs` | mod 3/12/46 快速算术 |
| `Compute/Det.hs` | CRT 行列式引擎（det2/det3 Sarrus/det4 Laplace + 19683 项查表；对齐 `jac_CRTDet`/`jac_NMatrix`） |
| `Kernel/Conversion.hs` | 三极等价判定（代数/几何/拓扑极），替代 Agda βη |
| `Parse/Lexer.hs` `Parse/Dy.hs` `Parse/Agda.hs` | `.dy` 前端（Agda 语法真子集 + 大衍扩展）与 `.agda` 解析 |
| `Adapter/Agda.hs` | `dyToAgda` / `dyToAgdaFile` / `writeAgdaFile` |
| `ProofGen/AST.hs` `Emit.hs` `Templates.hs` `Jacobian.hs` | Agda AST（GADT）→ `.agda` 发射；模板（div3k/mod3k/CRT）；行列式等式证明 + `λ()` 空模式 |
| `Algebra/GF9.hs` | GF(9)（`i²+1²=0²` 幻方正交表示） |
| `Verify/Agda.hs` | `verify :: AgdaFile -> IO VerifyResult` |
| `Verify/Pipeline.hs` | `runPipeline` / `runPipelineWithInclude` / `report`；`.dy → parse → emit → agda verify` |

管线签名（`Verify/Pipeline.hs`）：

```haskell
runPipeline          :: Text -> IO (Text, Text, VerifyResult)
runPipelineWithInclude :: [FilePath] -> Text -> IO (Text, Text, VerifyResult)
agdaStdLibPath       :: FilePath   -- "stdlib 源码（`impl/local-paths.json` 的 `agdaStdlib`）"
report               :: Text -> Text -> VerifyResult -> Text
```

注意：`runPipelineWithInclude` 用 `readProcessWithExitCode "agda"` —— **它调用的是 PATH 上的 `agda`**，不是 `dype`。

## 2. 内核补丁（与 `proof-engineer` 附录 8 模式 4 对应）

| 文件 | 位置 | 内容 |
| --- | --- | --- |
| `src/full/Agda/TypeChecking/Empty.hs` | 89 | `blocker <- unblockOnAnyMetaIn <$> instantiateFull tel`（归约元变量后再分裂） |
| `src/full/Agda/TypeChecking/Rules/LHS/Unify.hs` | 690, 766 | `NoUnify $ UnifyConflict …`（不同 Def 节点立即判空，不再无限展开） |

这就是「record 类型不等判定」能通过的原因。**不要随手改这两个文件**：改动会同时影响 Agda 全量测试（`make succeed`/`make fail`）。

## 3. 构建与测试

```bash
cd dype 源码（`impl/local-paths.json` 的 `dypeRoot`）
cabal build all            # 或 stack build（GHC 9.14.1）
make build                 # = cabal build all
make dev-link              # 链接 ~/.local/bin/dype → dist-newstyle 产物
make install-bin           # CI Step 1
make test-quick            # dype-test(hspec) + agda-compat，60s 内
make det-test              # Det 行列式专项
cabal test dype-test       # hspec 15 套件（含 Det 19683 项穷举）
make test                  # 全量串行（CI 等价，耗时长）
```

`Makefile:43` 的检查器定位：`AGDA_BIN ?= $(shell cabal list-bin dype-core:exe:dype || command -v dype)`。

## 4. ⚠ 当前阻塞：`dype` 二进制 data-dir 指向 `/src/data`

实测（2026-09-09）：

- `~/.local/bin/dype` 是**悬空相对软链**（指向 `dist-newstyle/...`，按链接所在目录解析 → 断链）。
- 真正的二进制有三处（dist-newstyle / src/.stack-work / .stack-work/install），均可执行，但 `--print-agda-data-dir` 都输出 **`/src/data`**（Docker 内以 `/src` 为源码根构建时烙入），而 `Agda.Interaction.Library:117` 的 `getPrimitiveLibDir` 会硬性检查该目录：
  `The lib directory /src/data/lib does not exist` → 任何编译都失败（exit 1）。
- `dype_core_datadir` 环境变量、`~/.cabal/share/...` 补齐、`-i` 包含路径都**无效**（该二进制的 Paths 模块是旧的）。
- `cabal build` 需要先构建 `boxes`/`regex-tdfa` 并重编整个 `dype-core`（全量 Agda 构建，数十分钟），不要顺手触发。

**绕行方案（按代价排序）**

1. **用 `proof_compile` 工具**：它自动探测并跳过不可用的 dype，回退到 `项目补丁版 Agda（`impl/local-paths.json` 的 `agdaBin`）`（项目补丁版，实测可用），报告里列出被跳过的原因。日常编译验证走这条。
2. 以 root 建软链：`sudo ln -s dype 源码（`impl/local-paths.json` 的 `dypeRoot`）/src /src`（最省事，但改系统根目录）。
3. 重建并重新链接：`make build && make dev-link`（会重新烙入本地 data-dir，需联网取 `regex-tdfa`）。
   *已备好一半*：`~/.cabal/share/x86_64-linux-ghc-9.14.1-inplace/dype-core-2.9.0/lib` 已软链到
   `dype/src/data/lib`，因此**重建后**的新二进制若沿用该 data-dir 即可直接找到 `lib/prim`。
4. 仅跑纯 Haskell 前端（不依赖 dype 二进制）：`make test-quick` / `cabal test dype-test`。

## 5. 诚实边界（README 宣言 vs 当前源码）

- README 的 `--dayan` / `dy` / `dayan` 命令名：**当前二进制没有 `--dayan` 旗标**（`--print-options` 无此项），可执行文件叫 `dype`。以源码与 `--help` 为准。
- README 的「MAlonzo-DY 零开销真理生成机」、`.dy` 独立语言「彻底平替 Agda」：属路线图/宣言，`Verify/Pipeline` 目前仍调用 `agda` 做最终验证。
- `Dayan.Compute.Det` 等模块的规模（19683 项查表）来自 README 与测试名，**引用具体数字前先 grep 源码**。
- 双轨事实：`discrete-mathematics` 的群论/CRT/T⁶ 证明当前由 `agda` 编译通过；dype 是生成与加速通道，不是已替代的默认检查器。
