/** One ledger spans generation and quality work; profiles never reset a user's budget. */
export function createCreationBudget(input = {}) {
  const configured = input.videoOptions?.budget || input.modelBudget || input.agentOptions?.modelBudget || {};
  const startedAt = Date.now(), state = { tokens: 0, cost: 0, unknownCost: false, unknownTokens: false, calls: 0, requests: 0 };
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : undefined;
  const maxTokens = positive(configured.maxTokens), maxCost = positive(configured.maxCost), maxTimeMs = positive(configured.maxTimeMs), maxRequests = positive(configured.maxRequests);
  const observe = (metadata = {}, provider = {}) => {
    const usage = metadata.usage || {};
    const tokens = Number(usage.totalTokens ?? usage.total_tokens ?? usage.estimatedCompletionTokens ?? usage.completionTokens);
    const reported = usage.cost ?? metadata.cost;
    const cost = reported == null ? provider.estimateModelCost?.(metadata) ?? provider.providerAdapter?.estimateCost?.(metadata, provider) : Number(reported);
    if (Number.isFinite(tokens) && tokens >= 0) state.tokens += tokens; else state.unknownTokens = true;
    if (Number.isFinite(cost) && cost >= 0) state.cost += cost; else state.unknownCost = true;
    state.calls++;
  };
  const assertRemaining = () => {
    let message;
    if (maxTimeMs && Date.now() - startedAt >= maxTimeMs) message = "本次创作的时间预算已用完";
    else if (maxRequests && Math.max(state.calls, state.requests) >= maxRequests) message = "本次创作的请求次数预算已用完";
    else if (maxTokens && (state.tokens >= maxTokens || state.unknownTokens)) message = "本次创作的 token 预算不足或无法核算";
    else if (maxCost && (state.cost >= maxCost || state.unknownCost)) message = "本次创作的费用预算不足或供应商没有返回可核算费用";
    if (message) throw Object.assign(new Error(`${message}；保留已有结果，未继续付费精修。`), { code: "QUALITY_BUDGET_UNAVAILABLE" });
  };
  return { state, observe, assertRemaining,
    begin(limits) { const options = this.requestOptions(limits); state.requests++; return options; },
    requestOptions(provider = {}, requestedMaxTokens) {
      assertRemaining();
      const limit = positive(requestedMaxTokens ?? provider.maxTokens);
      const remaining = maxTokens ? Math.max(1, Math.floor(maxTokens - state.tokens)) : undefined;
      return { ...provider, maxTokens: remaining ? Math.min(remaining, limit || remaining) : limit,
        ...(maxTimeMs ? { turnDeadlineAt: Math.min(provider.turnDeadlineAt || Infinity, startedAt + maxTimeMs) } : {}) };
    }
  };
}
