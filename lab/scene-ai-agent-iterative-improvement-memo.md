# 场景编辑器 · AI Agent 迭代改进备忘

**状态**：`partial`（Phase 0–1 已落地；Phase 2–3 待评估）  
**日期**：2026-06-12  
**关联**：[scene-ai-enhancement-memo.md](./scene-ai-enhancement-memo.md)、[`core/ai/sceneAgent.js`](../core/ai/sceneAgent.js)、[`tools/common/editor-single/ai/runEditorAiUpdate.js`](../tools/common/editor-single/ai/runEditorAiUpdate.js)

---

## 1. 问题摘要

用户期望 Agent 多轮：**初稿上画布 → 观察 → 逐步 patch**。  
原实现多轮主要是 **LLM 校验修复** + **object.get 探索**；命令模式 **末轮一次性 exec**；AI 调整 **未接**「阶段产物自动载入」。

## 2. 已落地改进

### Phase 0

- AI 调整复用 `buildSidebarSceneAgentOnProgress`，JSON 路径可阶段 auto-load。
- JSON 管线在 repair / capability / layout 成功后 emit `stage_preview`（及终态 `scene_ready`）。

### Phase 1

- `agent.iterativeApply`（编辑器「迭代应用到画布」）：mutating 命令通过 dry-run 后 **立即 exec**，刷新 `updateContext`，继续 LLM 轮直至 `# done` 或 `maxRefineRounds`。
- 进度事件 `commands_applied`；命令模式可选「每轮变更后自适应取景」。

## 3. 待做（Phase 2–3）

- 生成路径：generate 成功后先 `stage_preview`，layout 后再终态。
- Agent 步骤 UI、会话级 undo 分组。
- 可选 canvas 截图 / locate 高亮观测。

## 4. 相关索引

| 资源 | 路径 |
|------|------|
| Agent 核心 | [`core/ai/sceneAgent.js`](../core/ai/sceneAgent.js) |
| 编辑器编排 | [`tools/common/editor-single/ai/runEditorAiUpdate.js`](../tools/common/editor-single/ai/runEditorAiUpdate.js) |
| 命令 Prompt | [`core/ai/sceneCommandSkill.js`](../core/ai/sceneCommandSkill.js) |
| 单测 | [`tests/sceneAgent.test.mjs`](../tests/sceneAgent.test.mjs)、[`tests/runEditorAiUpdateIterative.test.mjs`](../tests/runEditorAiUpdateIterative.test.mjs) |
