/** Cheap authoring evidence for chat feedback. No renderer, codecs or model calls. */
export function getMediaProductionSummary(document) {
  if (typeof document === "string") {
    // Preserve lazy history loading for ordinary (possibly very dense) scenes.
    if (!/"documentType"\s*:\s*"composition"/.test(document)) return null;
    try { document = JSON.parse(document); } catch { return null; }
  }
  if (document?.documentType !== "composition") return null;
  const active = items => (items || []).filter(item => item.enabled !== false);
  const production = document.production || {};
  let audio = active(document.timeline?.audio).length, captions = active(document.timeline?.captions).length;
  const shots = active(document.timeline?.clips).map(clip => {
    const scene = typeof clip.source === "string" ? document.scenes?.[clip.source] : clip.source;
    const metadata = production.shots?.[clip.id] || {};
    const count = records => (records || []).reduce((sum, record) => sum + count(record.children) + (record.objType && !/^(group|scene|camera|renderer|controls|renderLoop|audio|.*light)$/i.test(record.objType) ? 1 : 0), 0);
    const objects = count(scene?.objectList) || Object.entries(scene?.worldInfo || {}).reduce((sum, [key, value]) => sum + (Array.isArray(value) && !/light|camera|control|pass|audio/i.test(key) ? value.length : 0), 0);
    const shotCaptions = active(scene?.timeline?.captions).length;
    audio += active(scene?.timeline?.audio).length; captions += shotCaptions;
    const overlay = active(document.timeline?.captions).some(item => (item.start || 0) < (clip.start || 0) + clip.duration && (item.start || 0) + (item.duration || 0) > (clip.start || 0));
    const animatedBackground = scene?.timeline?.tracks?.some(track => track.target === "$scene" && track.property?.startsWith("background"));
    return { id: clip.id, title: metadata.title || clip.id, start: clip.start || 0, duration: clip.duration, stage: metadata.stage,
      produced: metadata.stage !== "planned" && Boolean(objects || shotCaptions || overlay || animatedBackground || metadata.intentionalBlank || !scene), objects };
  });
  return { documentType: "composition", state: production.state, stopReason: production.stopReason, lastError: production.lastError || "",
    duration: document.timeline?.duration ?? shots.reduce((end, shot) => Math.max(end, shot.start + shot.duration), 0),
    totalShots: shots.length, producedShots: shots.filter(shot => shot.produced).length, shots, audio, captions,
    awaitingApproval: production.stopReason === "storyboard_approval_required" };
}

export function formatMediaProductionSummary(summary, language = "zh-CN") {
  if (!summary) return "";
  const en = /^(en|english)/i.test(language), text = (zh, english) => en ? english : zh;
  const { totalShots: total, producedShots: produced } = summary;
  let message = summary.awaitingApproval
    ? text(`已规划 ${total} 个镜头，等待确认分镜后开始制作。`, `${total} shots planned; awaiting storyboard approval before production.`)
    : produced === 0
      ? text(`仅完成 ${total} 个镜头的分镜规划，尚未生成可播放画面。分镜已保留，可以继续制作。`, `Only the ${total}-shot storyboard is available; no playable visuals have been produced. The plan is saved for continuation.`)
      : summary.state === "complete" && produced === total
        ? text(`视频内容已生成：${total} 个镜头，${summary.duration} 秒。`, `Video content generated: ${total} shots, ${summary.duration} seconds.`)
        : text(`视频尚未完成：已生成 ${produced}/${total} 个镜头的内容，已完成内容和分镜均已保留。`, `Video unfinished: content is available for ${produced}/${total} shots. Completed content and the storyboard are preserved.`);
  message += text(summary.audio ? ` 已写入 ${summary.audio} 条音轨。` : " 尚未生成音轨。", summary.audio ? ` ${summary.audio} audio track(s) authored.` : " No audio track has been generated.");
  const reasons = {
    repeated_invalid_output: text("模型连续返回无法解析的操作命令", "The model repeatedly returned invalid operation commands"),
    repeated_operations: text("模型重复相同操作，未能继续推进", "The model repeated the same operations without progress"),
    provider_output_truncated: text("供应商截断了镜头操作输出", "The provider truncated the shot operation output"),
    provider_or_execution_failed: text("供应商请求或操作执行失败", "A provider request or operation failed"),
    empty_provider_output: text("供应商返回了空内容", "The provider returned empty content"),
    postconditions_not_satisfied: text("镜头内容或结构检查未通过", "Shot content or structural checks did not pass"),
    budget_exhausted: text("已用完您配置的生成预算", "The configured generation budget was exhausted"),
    budget_usage_unavailable: text("供应商未返回显式预算所需的用量信息", "Provider usage required for the configured budget is unavailable"),
    cancelled: text("生成已取消", "Generation was cancelled")
  };
  if (summary.state !== "complete" && reasons[summary.stopReason]) message += `\n${text("暂停原因：", "Paused: ")}${reasons[summary.stopReason]} (${summary.stopReason})。`;
  return message;
}

export function getMediaContinuation(document, language = "zh-CN") {
  const summary = getMediaProductionSummary(document);
  if (!summary) return null;
  const en = /^(en|english)/i.test(language);
  return { label: summary.awaitingApproval ? (en ? "Approve and produce video" : "确认分镜并制作") : (en ? "Continue video production" : "继续制作视频"),
    prompt: en ? "Continue producing the current video from its saved storyboard. Preserve completed shots, fill the unfinished shots with actual scene content, animation and captions, and complete the audio requested in the original brief. Do not restart the plan or treat its placeholders as a finished film."
      : "继续制作当前视频，沿用已保存的分镜，保留已完成的镜头，为未完成镜头生成实际场景内容、动画和字幕，并完成原始要求中的音轨。不要重新规划整个项目，也不要把空白分镜当作已完成视频。" };
}
