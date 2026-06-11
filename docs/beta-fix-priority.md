# Deja Beta Fix Priority

Based on beta:score results — 2026-06-10 (run ef59bea3)

---

## P0 — Must fix before any beta release

### P0-A: Compression latency overhead 1694 ms (M6 FAIL, threshold ≤800 ms)

**问题:** 每次压缩触发时，summarizer 对上游 LLM 发起同步 API 调用生成摘要，加上本地 pipeline 处理，中位延迟达 1694 ms，超标 2×。

**影响指标:** M6

**目标文件:**
- `src/compressor/summarizer.ts` — summarizer API 调用路径
- `src/proxy/server.ts` — 请求处理主循环

**修复策略:**
1. 异步预生成摘要：在上一轮响应返回后立即在后台触发下一轮摘要，用户下次请求到达时直接复用缓存结果
2. 若摘要未就绪则降级跳过压缩（passthrough），而非阻塞等待
3. 摘要缓存 key = 最后一条消息 ID；内容变化时失效

**预计工时:** 4–6 h

---

### P0-B: Auto-bypass trigger rate 50% (M4 FAIL, threshold ≤15%)

**问题:** 10 轮中 5 轮 `compressionRatio ≥ 0.75`（压缩掉 75% 以上内容），触发自动安全模式。根因是 `targetTokens=3000` 相对于 session 后期 8000–10000 token 的历史过小，导致压缩器被迫激进丢弃内容。

**影响指标:** M4（直接），M3 重复率（间接）

**目标文件:**
- `src/proxy/server.ts` — auto-bypass 触发阈值 (`≥0.75`)
- `src/proxy/config-types.ts` — `targetTokens` 默认值

**修复策略:**
1. 将 auto-bypass 触发阈值从 0.75 提高到 0.85，减少误触发
2. 将 `targetTokens` 默认值从 3000 提高到 5000，给压缩器更多空间，降低单次压缩比
3. 新增渐进压缩：先尝试轻压缩（target = maxTokens×0.7），若仍超限再深压缩，避免直接跳到激进模式

**预计工时:** 2–3 h

---

## P1 — Fix before public announcement

### P1-A: Repetition rate 10% (M3 FAIL, threshold ≤3%)

**问题:** `avgRedundancyRate=0.10`，摘要注入后上下文中存在近似重复段落。根因：summary block 作为 user 消息注入头部，而 toKeep 中的原始消息也含有相同内容片段，形成双份内容。

**影响指标:** M3

**目标文件:**
- `src/proxy/adapters/anthropic.ts` — `contextToRequest()` summary 注入逻辑
- `src/proxy/adapters/openai.ts` — 同上
- `src/compressor/summarizer.ts` — 摘要生成提示词

**修复策略:**
1. 注入 summary 时同步检查 toKeep 消息：若 toKeep 首条包含 summary 覆盖的内容（通过关键词重叠判断），截断 toKeep 的重叠部分
2. summarizer prompt 中明确要求"不要重复 toKeep 中已保留的内容"
3. `summarizer.ts` 新增 `deduplicateWithKept()` 后处理：移除摘要中与 toKeep 重叠度 >60% 的句子

**预计工时:** 3–4 h

---

## P2 — Fix before charging users

### P2-A: Token savings rate 26% (M5 FAIL, threshold ≥30%)

**问题:** 前 5 轮上下文未达压缩触发点（context < targetTokens），零压缩拉低均值至 26%，差 4pp 达标。实际触发压缩后的轮次节省 38–62%，质量良好。

**影响指标:** M5

**目标文件:**
- `src/proxy/config-types.ts` — `compressThreshold` 默认值
- `src/compressor/compressor.ts` — 触发条件判断

**修复策略:**
1. 将 `compressThreshold` 从 200 token 降低到 100 token，让更多中等长度对话也进入压缩路径，提升均值
2. 对于 200–1000 token 的中等上下文，启用轻量去重（`dropBelowThreshold` pass 独立运行），不做完整 summarize，减少延迟同时贡献节省率
3. 注意与 P0-B 协调：`compressThreshold` 降低后需同步提高 `targetTokens`，避免加剧 M4

**预计工时:** 2–3 h

---

## Summary

| 优先级 | 问题 | 指标 | 预计工时 |
|--------|------|------|---------|
| P0-A | 延迟 1694 ms → 异步摘要 | M6 | 4–6 h |
| P0-B | bypass 50% → 提高阈值+targetTokens | M4 | 2–3 h |
| P1-A | 重复率 10% → 去重注入 | M3 | 3–4 h |
| P2-A | 节省率 26% → 降低触发门槛 | M5 | 2–3 h |

**总计: 11–16 h。P0 完成后重跑 beta:score 验证 M4/M6，再处理 P1/P2。**
