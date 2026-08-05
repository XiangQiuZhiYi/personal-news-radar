export function cleanSpeechText(value = "") {
  return String(value ?? "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[~～]+/g, "至")
    .replace(/[|｜]+/g, "，")
    .replace(/\s+/g, " ")
    .trim();
}

function itemSegments(item, index, total, mode) {
  const shared = {
    itemId: item.id ?? item.url ?? `item-${index}`,
    itemIndex: index,
    itemTotal: total,
    mode
  };
  const title = cleanSpeechText(item.title);
  const summary = cleanSpeechText(item.summary);
  const analysis = item.impactAnalysis && typeof item.impactAnalysis === "object" ? item.impactAnalysis : {};
  const affectedGroups = Array.isArray(analysis.affectedGroups) ? analysis.affectedGroups.filter(Boolean).join("、") : "";
  const actions = Array.isArray(analysis.actions) ? analysis.actions.filter(Boolean).join("；") : "";
  const impact = cleanSpeechText([
    analysis.direction && `变化方向。${analysis.direction}`,
    analysis.changeStatement && `变化结论。${analysis.changeStatement}`,
    item.impactForPeople,
    analysis.impactLevel && `影响程度。${analysis.impactLevel}`,
    affectedGroups && `更可能受影响的人。${affectedGroups}`,
    analysis.impactPath && `影响路径。${analysis.impactPath}`,
    analysis.shortTerm && `短期变化。${analysis.shortTerm}`,
    analysis.mediumLongTerm && `中长期变化。${analysis.mediumLongTerm}`,
    actions && `现在可以做什么。${actions}`,
    analysis.uncertainties && `仍需确认。${analysis.uncertainties}`
  ].filter(Boolean).join("。"));
  return [
    title && { ...shared, kind: "title", text: mode === "continuous" ? `第${index + 1}条。${title}` : title },
    summary && { ...shared, kind: "summary", text: `摘要。${summary}` },
    impact && { ...shared, kind: "impact", text: `对普通人的影响。${impact}` }
  ].filter(Boolean);
}

export function buildContinuousSpeechQueue({ brief = "", items = [] } = {}) {
  const queue = [];
  const cleanBrief = cleanSpeechText(brief);
  if (cleanBrief) {
    queue.push({
      kind: "brief",
      text: `今日概览。${cleanBrief}`,
      itemId: null,
      itemIndex: -1,
      itemTotal: items.length,
      mode: "continuous"
    });
  }
  items.forEach((item, index) => queue.push(...itemSegments(item, index, items.length, "continuous")));
  return queue;
}

export function buildSingleSpeechQueue(item) {
  return item ? itemSegments(item, 0, 1, "single") : [];
}

export function chooseSpeechVoice(voices = []) {
  const chineseVoices = voices.filter((voice) => String(voice.lang ?? "").toLowerCase().startsWith("zh"));
  return chineseVoices.find((voice) => voice.localService)
    ?? chineseVoices[0]
    ?? voices.find((voice) => voice.default)
    ?? null;
}

export class SpeechController {
  constructor({
    synthesis = globalThis.speechSynthesis,
    Utterance = globalThis.SpeechSynthesisUtterance,
    onStateChange = () => {}
  } = {}) {
    this.synthesis = synthesis;
    this.Utterance = Utterance;
    this.onStateChange = onStateChange;
    this.supported = Boolean(synthesis && Utterance && typeof synthesis.speak === "function");
    this.status = "idle";
    this.rate = 1;
    this.queue = [];
    this.cursor = 0;
    this.errorCount = 0;
    this.currentEntry = null;
    this.playbackId = 0;
    this.voice = this.supported ? chooseSpeechVoice(synthesis.getVoices?.() ?? []) : null;
    this.handleVoicesChanged = () => {
      this.voice = chooseSpeechVoice(this.synthesis.getVoices?.() ?? []);
    };
    this.synthesis?.addEventListener?.("voiceschanged", this.handleVoicesChanged);
  }

  setRate(value) {
    const rate = Number(value);
    this.rate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2, rate)) : 1;
    return this.rate;
  }

  snapshot(extra = {}) {
    return {
      supported: this.supported,
      status: this.status,
      rate: this.rate,
      entry: this.currentEntry,
      queueLength: this.queue.length,
      cursor: this.cursor,
      errorCount: this.errorCount,
      ...extra
    };
  }

  emit(extra) {
    this.onStateChange(this.snapshot(extra));
  }

  play(queue) {
    if (!this.supported) {
      this.status = "error";
      this.emit({ error: "当前浏览器不支持语音朗读" });
      return false;
    }
    const entries = (queue ?? []).filter((entry) => cleanSpeechText(entry.text));
    if (entries.length === 0) {
      this.status = "error";
      this.emit({ error: "当前内容没有可朗读的信息" });
      return false;
    }

    this.stop({ silent: true });
    this.queue = entries;
    this.cursor = 0;
    this.errorCount = 0;
    this.currentEntry = null;
    this.status = "preparing";
    const playbackId = this.playbackId;
    this.emit();
    this.speakCurrent(playbackId);
    return true;
  }

  speakCurrent(playbackId) {
    if (playbackId !== this.playbackId) return;
    if (this.cursor >= this.queue.length) {
      const hadErrors = this.errorCount > 0;
      const allFailed = this.errorCount === this.queue.length;
      this.currentEntry = null;
      this.status = allFailed ? "error" : "completed";
      this.emit({
        error: allFailed ? "语音播放失败" : null,
        warning: hadErrors && !allFailed ? "部分内容未能播放" : null
      });
      return;
    }

    const entry = this.queue[this.cursor];
    const utterance = new this.Utterance(entry.text);
    utterance.lang = "zh-CN";
    utterance.rate = this.rate;
    if (this.voice) utterance.voice = this.voice;
    let settled = false;
    utterance.onstart = () => {
      if (playbackId !== this.playbackId) return;
      this.currentEntry = entry;
      this.status = "playing";
      this.emit();
    };
    const finish = (failed) => {
      if (settled || playbackId !== this.playbackId) return;
      settled = true;
      if (failed) this.errorCount += 1;
      this.cursor += 1;
      this.speakCurrent(playbackId);
    };
    utterance.onend = () => finish(false);
    utterance.onerror = () => finish(true);

    try {
      this.synthesis.speak(utterance);
    } catch {
      finish(true);
    }
  }

  pause() {
    if (!this.supported || this.status !== "playing") return false;
    this.synthesis.pause();
    this.status = "paused";
    this.emit();
    return true;
  }

  resume() {
    if (!this.supported || this.status !== "paused") return false;
    this.synthesis.resume();
    this.status = "playing";
    this.emit();
    return true;
  }

  stop({ silent = false } = {}) {
    this.playbackId += 1;
    this.synthesis?.cancel?.();
    this.queue = [];
    this.cursor = 0;
    this.errorCount = 0;
    this.currentEntry = null;
    this.status = silent ? "idle" : "stopped";
    if (!silent) this.emit();
  }

  destroy() {
    this.stop({ silent: true });
    this.synthesis?.removeEventListener?.("voiceschanged", this.handleVoicesChanged);
  }
}
