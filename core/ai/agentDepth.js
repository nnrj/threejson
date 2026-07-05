/**
 * Agent depth presets: map user-facing depth to step budgets and token limits.
 */

const DEPTH_PRESETS = {
  simple: {
    maxSteps: 2,
    maxRefineRounds: 2,
    outlineMaxTokens: 0,
    generateMaxTokens: 6000,
    repairMaxTokens: 5000,
    reviewMaxTokens: 0,
    layoutReviewMaxTokens: 0,
    runOutline: false,
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: false,
    runTextureReview: false,
    maxCapabilityReviewAttempts: 1,
    maxRepairAttempts: 1
  },
  medium: {
    maxSteps: 4,
    maxRefineRounds: 4,
    outlineMaxTokens: 1200,
    generateMaxTokens: 6000,
    repairMaxTokens: 5000,
    layoutReviewMaxTokens: 5000,
    reviewMaxTokens: 0,
    runOutline: true,
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: true,
    runTextureReview: false,
    maxCapabilityReviewAttempts: 1,
    maxRepairAttempts: 2
  },
  deep: {
    maxSteps: 6,
    maxRefineRounds: 6,
    outlineMaxTokens: 1500,
    generateMaxTokens: 8000,
    repairMaxTokens: 6000,
    layoutReviewMaxTokens: 6000,
    reviewMaxTokens: 800,
    runOutline: true,
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: true,
    runTextureReview: true,
    maxCapabilityReviewAttempts: 2,
    maxRepairAttempts: 2
  },
  auto: {
    maxSteps: 7,
    maxRefineRounds: 6,
    outlineMaxTokens: 1500,
    generateMaxTokens: 8000,
    repairMaxTokens: 6000,
    layoutReviewMaxTokens: 6000,
    reviewMaxTokens: 800,
    runOutline: true,
    runRepair: true,
    runCapabilityReview: true,
    runLayoutReview: true,
    runTextureReview: true,
    stopWhenValid: true,
    maxCapabilityReviewAttempts: 2,
    maxRepairAttempts: 3
  }
};

/**
 * @param {string} [depth]
 * @returns {typeof DEPTH_PRESETS.simple}
 */
function resolveAgentDepth(depth) {
  const key = String(depth || "simple").toLowerCase();
  return DEPTH_PRESETS[key] || DEPTH_PRESETS.simple;
}

export { DEPTH_PRESETS, resolveAgentDepth };
