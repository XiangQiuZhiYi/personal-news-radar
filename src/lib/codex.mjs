import { spawn } from "node:child_process";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

async function isAccessible(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function newestBundledCodex(localBinRoot) {
  if (!localBinRoot) return null;
  const candidates = [];
  const direct = path.join(localBinRoot, "codex.exe");
  if (await isAccessible(direct)) candidates.push(direct);

  let entries = [];
  try {
    entries = await readdir(localBinRoot, { withFileTypes: true });
  } catch {
    return candidates[0] ?? null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(localBinRoot, entry.name, "codex.exe");
    if (await isAccessible(candidate)) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;

  const dated = await Promise.all(candidates.map(async (candidate) => {
    try {
      return { candidate, modifiedAt: (await stat(candidate)).mtimeMs };
    } catch {
      return { candidate, modifiedAt: 0 };
    }
  }));
  dated.sort((a, b) => b.modifiedAt - a.modifiedAt || a.candidate.localeCompare(b.candidate));
  return dated[0].candidate;
}

export async function resolveCodexExecutable({
  env = process.env,
  platform = process.platform,
  localBinRoot = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin") : null,
  macBundleCandidates = [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    ...(env.HOME ? [
      path.join(env.HOME, "Applications/Codex.app/Contents/Resources/codex"),
      path.join(env.HOME, "Applications/ChatGPT.app/Contents/Resources/codex")
    ] : [])
  ]
} = {}) {
  if (env.CODEX_BIN?.trim()) return env.CODEX_BIN.trim();

  const commandNames = platform === "win32" ? ["codex.exe", "codex.cmd", "codex.bat", "codex"] : ["codex"];
  const pathValue = env.PATH ?? env.Path ?? env.path ?? "";
  const delimiter = platform === "win32" ? ";" : ":";
  for (const directory of pathValue.split(delimiter).map((value) => value.trim().replace(/^"|"$/g, "")).filter(Boolean)) {
    for (const commandName of commandNames) {
      const candidate = path.join(directory, commandName);
      if (await isAccessible(candidate)) return candidate;
    }
  }

  if (platform === "win32") {
    const bundled = await newestBundledCodex(localBinRoot);
    if (bundled) return bundled;
  }

  if (platform === "darwin") {
    for (const candidate of macBundleCandidates) {
      if (await isAccessible(candidate)) return candidate;
    }
  }
  return platform === "win32" ? "codex.exe" : "codex";
}

function missingCodexDetail(executable) {
  if (process.env.CODEX_BIN) {
    const migrationHint = process.platform !== "win32" && /(?:^[A-Za-z]:\\|\.exe$)/i.test(process.env.CODEX_BIN)
      ? "这看起来是 Windows 路径；请在当前终端取消 CODEX_BIN 后重启服务。"
      : "请确认该路径在当前电脑上存在，然后重启服务。";
    return `CODEX_BIN 当前设置为：${process.env.CODEX_BIN}。${migrationHint}`;
  }
  if (process.platform === "darwin") {
    return `已尝试 ${executable}、Codex.app 和 ChatGPT.app 的内置 CLI。请确认任一桌面应用已安装并登录，然后重启服务。`;
  }
  if (process.platform === "win32") {
    return "请确认 Codex Desktop 或 Codex CLI 已安装；也可以通过 CODEX_BIN 指定当前电脑上 codex.exe 的完整路径。";
  }
  return "请确认 Codex CLI 已安装并位于 PATH 中；也可以通过 CODEX_BIN 指定当前电脑上的完整路径。";
}

export function buildPrompt(preferences) {
  const careerOpportunity = preferences.careerOpportunity ?? {};
  const sectionTargets = preferences.sectionTargets ?? [];
  const sectionTargetSummary = sectionTargets
    .map((target) => `   - ${target.section}：${target.minItems}-${target.maxItems} 条；${target.selectionStandard}`)
    .join("\n");
  const currentFields = careerOpportunity.currentFields ?? [];
  const minAdjacentItems = careerOpportunity.minAdjacentItems ?? 1;
  const maxAdjacentItems = careerOpportunity.maxAdjacentItems ?? 2;
  const minUnfamiliarItems = careerOpportunity.minUnfamiliarItems ?? 2;
  const maxUnfamiliarItems = careerOpportunity.maxUnfamiliarItems ?? 3;
  const sourceSelectionCaps = preferences.maxSelectedBySource ?? {};
  const sourceSelectionCapSummary = Object.entries(sourceSelectionCaps)
    .map(([source, limit]) => `${source}最多 ${limit} 条`)
    .join("；");

  return `你是一名严谨的个人信息编辑。请只分析标准输入中提供的候选信息，不要搜索网络、读取其他文件或运行命令。

目标：从大量候选信息中筛选真正值得用户今天阅读的内容，进行语义去重、分类和价值排序。

筛选要求：
1. 最多保留 ${preferences.maxSelectedItems} 条，宁缺毋滥。
1.1 每条入选信息必须在 contentSection 中且只能归入以下一个板块；候选充足时满足最低数量，任何情况下不得超过最高数量：
${sectionTargetSummary}
1.2 板块互斥，按以下顺序消除重叠：有 city 的候选归“关注城市”；region 为 international 的候选归“国际”；其余候选依次判断“实用提醒”“职业/收入/技术”“国家级”“热点”。一条信息不得同时占用两个板块配额，不符合六个板块中任何一个的候选直接丢弃。
2. 相同事件只保留最接近一手来源、信息量最大的一条。
3. 单一信息源最多保留 ${preferences.maxSelectedPerSource} 条，单一分类最多保留 ${preferences.maxSelectedPerCategory} 条。${sourceSelectionCapSummary ? `以下来源使用更严格的采用上限：${sourceSelectionCapSummary}。` : ""}
4. 国际来源最多保留 ${preferences.maxInternationalItems} 条，其余名额优先给国内来源；输入中的 region 标明 domestic 或 international。
4.1 “关注城市”总计保留 4-6 条。输入中的 city 标明关注城市；对 ${JSON.stringify(preferences.followedCities ?? [])}，只要该城市存在具备实际信息增量的近期候选，就至少保留 ${preferences.minSelectedPerCity ?? 1} 条、最多保留 ${preferences.maxSelectedPerCity ?? 3} 条。先让每个有合格候选的城市至少入选一条，再按价值分配剩余名额。优先政策、公共服务、机会、就业、住房、教育、医疗、交通、安全和产业风险；例行会议、领导表态、庆典、人事任免和普通宣传不得仅因属于关注城市而入选。
4.2 “职业/收入/技术”总计保留 3-5 条。用户当前领域是 ${JSON.stringify(currentFields)}，它们只用于判断能力迁移距离，不是信息边界。在候选证据充足时，选择 ${minAdjacentItems}-${maxAdjacentItems} 条“相邻领域机会”和 ${minUnfamiliarItems}-${maxUnfamiliarItems} 条“陌生领域机会”；没有合格候选时宁缺毋滥，禁止把普通行业新闻包装成机会。
4.3 “相邻领域机会”必须能复用前端开发、UI 设计或其通用能力，并存在数月内可以验证的进入路径，例如 AI 应用搭建、产品设计、低代码与自动化、数据可视化、数字化服务等；不得只因提到互联网、软件或 AI 就判为相邻机会。
4.4 “陌生领域机会”必须把视野带到当前领域之外，不能以前端开发或 UI 设计为核心工作内容；应来自新行业、新服务、新商业模式或新职业需求，并说明普通个人可通过就业、转岗、服务、产品、渠道或培训中的哪条路径参与。陌生不等于随机，只有存在真实需求信号和可验证入口才保留。
4.5 真实需求信号优先级为：已生效政策或采购、连续招聘或岗位扩张、真实订单与付费、明确成本下降、资格或培训入口。融资、发布会、企业宣传和行业预测单独出现时证据不足。“职业/收入/技术”条目必须在 topics 中加入且只加入一个标签：“相邻领域机会”或“陌生领域机会”；其他板块不得使用这两个标签。
4.6 “国家级”只收录国家层面的政策、经济、就业、住房、教育、医疗或监管变化，并明确写出通过什么规则、价格、岗位或公共服务传导到个人。普通会议、口号、表态和无法说明个人传导路径的宏观新闻不得入选。
4.7 “实用提醒”必须包含个人现在可执行的动作，例如明确截止时间、申报入口、安全处置、价格生效时间或办事规则变化；只有泛泛风险描述而没有行动信息的内容不得入选。
4.8 “国际”只收录能通过国内价格、就业、产业、技术供给、旅行或安全明确传导到用户的事件；与国内生活或工作没有清晰关系的国际大事也不入选。
4.9 “热点”只收录存在新增事实、会改变公共判断或具有长期意义的国内事件。纯情绪争议、明星话题、围观事件和没有新增事实的热搜不得入选；没有合格热点时可以为 0 条。
5. 评分综合考虑影响范围、新颖性、可信度、行动价值和长期意义。
6. 摘要使用 ${preferences.language}，说明具体新增事实，不复述空洞标题。
7. whyItMatters 必须解释这条信息可能改变什么判断或行动；无法说明价值的内容应丢弃。
8. “对普通人的影响”必须先替读者完成方向判断，再解释原因。impactForPeople 用 60-120 个汉字给出结论式总览，第一句必须明确“谁的什么变好、变差或当前不变”，不得以“可能、或将、有望、预计、存在变化、值得关注、带来影响”等模糊表述开头。
9. impactAnalysis 必须逐项完成：
   - impactLevel：依据候选信息判断是“直接”“间接”还是“当前有限”；
   - direction：必须在“有利”“不利”“分化”“当前不变”中选择一个，不得留给读者自行判断；“分化”必须分别点明谁受益、谁承压；
   - changeStatement：用一句可扫读的结论明确写出“具体人群 + 具体指标 + 方向”，方向必须使用上升、下降、增加、减少、收紧、放宽、变贵、变便宜、变快或变慢等词，不得只写“发生变化”或“受到影响”；
   - affectedGroups：列出 1-4 类最可能受影响的具体人群，不要笼统写“所有人”；
   - impactPath：说明“事件变化 → 通过什么价格、就业、服务、规则或风险渠道 → 如何落到个人”的因果路径；
   - shortTerm：分析未来数周至数月内可感知的变化；
   - mediumLongTerm：分析未来半年及更长时间可能形成的二阶影响；
   - actions：给出 1-3 条普通人现在可以执行的低风险行动；没有必要行动时，应明确写继续观察什么信号，而非勉强给建议；
   - uncertainties：区分已知事实与合理推断，指出结论成立依赖的条件、尚缺信息或可能不受影响的情况。
10. 对尚未生效、仍有前提或证据不足的变化，不得用“可能”敷衍，也不得伪造确定性。统一写成“当前不变；当/若【明确条件】发生后，【具体指标】上升/下降”。若连方向都无法从候选信息推出，应写“当前没有可确认的直接变化”，并优先考虑丢弃该条。除 uncertainties 专门说明证据边界外，impactForPeople、changeStatement、impactPath、shortTerm、mediumLongTerm 和 actions 禁止使用“可能、或将、有望、预计、大概率、存在变化、产生影响”等模糊措辞；必须改写成“条件 → 对象 → 上升/下降等明确方向”。
11. 影响分析优先考虑收入、就业、消费、住房、教育、医疗、安全、隐私、出行和时间成本。不得把行业利好直接等同于个人受益，不得编造候选内容没有支撑的数字、政策细节或确定性结论，不制造焦虑，也不提供武断的医疗、法律或投资指令。
12. “陌生领域机会”承担主动探索职责，必须覆盖当前前端开发与 UI 设计之外的真实方向，避免只迎合既有兴趣；没有合格内容时不强行补足。
13. 不得编造候选信息中不存在的事实、来源或链接。
14. items 中只能引用输入里真实存在的 candidateId。
15. brief 只概括今天的重点主题和整体可信度，不要写候选数或入选数；数量由程序单独展示。

用户偏好与规则：
${JSON.stringify(preferences, null, 2)}

请严格按照输出 JSON Schema 返回结果。`;
}

export const DEFAULT_CODEX_TIMEOUT_MS = 30 * 60 * 1000;
export const CODEX_MODEL = "gpt-5.6-terra";
export const CODEX_REASONING_EFFORT = "high";
export const CODEX_SERVICE_TIER = "default";
export const CODEX_MODEL_PROVIDER = "openai-http";
export const CODEX_OPENAI_BASE_URL = "https://chatgpt.com/backend-api/codex";

export function buildCodexExecArgs({ schemaPath, prompt }) {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--model",
    CODEX_MODEL,
    "--config",
    `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
    "--config",
    `service_tier="${CODEX_SERVICE_TIER}"`,
    "--config",
    `model_provider="${CODEX_MODEL_PROVIDER}"`,
    "--config",
    `model_providers.${CODEX_MODEL_PROVIDER}.name="OpenAI HTTPS"`,
    "--config",
    `model_providers.${CODEX_MODEL_PROVIDER}.base_url="${CODEX_OPENAI_BASE_URL}"`,
    "--config",
    `model_providers.${CODEX_MODEL_PROVIDER}.requires_openai_auth=true`,
    "--config",
    `model_providers.${CODEX_MODEL_PROVIDER}.supports_websockets=false`,
    "--sandbox",
    "read-only",
    "--json",
    "--output-schema",
    path.resolve(schemaPath),
    prompt
  ];
}

export function parseCodexJsonLine(line) {
  const event = JSON.parse(line);
  if (event.type === "item.completed" && event.item?.type === "agent_message") {
    return { event, finalMessage: event.item.text ?? "", level: null, message: null };
  }
  if (event.type === "error") {
    return { event, finalMessage: null, level: "error", message: event.message ?? "未知错误" };
  }
  if (event.type === "item.completed" && event.item?.type === "error") {
    return { event, finalMessage: null, level: "error", message: event.item.message ?? "未知错误" };
  }
  if (event.type === "thread.started") {
    return { event, finalMessage: null, level: "info", message: `会话已启动：${event.thread_id ?? "未知"}` };
  }
  if (event.type === "turn.started") {
    return { event, finalMessage: null, level: "info", message: "分析请求已提交" };
  }
  if (event.type === "turn.completed") {
    const usage = event.usage ?? {};
    return {
      event,
      finalMessage: null,
      level: "info",
      message: `分析完成：输入 ${usage.input_tokens ?? 0} tokens，输出 ${usage.output_tokens ?? 0} tokens`
    };
  }
  return { event, finalMessage: null, level: null, message: null };
}

function logCodex(level, message) {
  const line = `[Codex ${new Date().toISOString()}] ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

function tailText(value, maxLength = 4000) {
  if (value.length <= maxLength) return value;
  return value.slice(-maxLength);
}

export async function runCodexFilter({
  candidates,
  preferences,
  schemaPath,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS
}) {
  const executable = await resolveCodexExecutable();
  const prompt = buildPrompt(preferences);
  const args = buildCodexExecArgs({ schemaPath, prompt });

  const payload = JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidates
  });

  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stdoutRemainder = "";
    let stderr = "";
    let finalMessage = null;
    let settled = false;
    let timedOut = false;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const handleJsonLine = (line) => {
      if (!line.trim()) return;
      try {
        const parsed = parseCodexJsonLine(line);
        if (parsed.finalMessage !== null) finalMessage = parsed.finalMessage;
        if (parsed.message) logCodex(parsed.level, parsed.message);
      } catch (error) {
        logCodex("error", `无法解析 CLI 事件：${error.message}；原始内容：${line.slice(0, 500)}`);
      }
    };

    logCodex(
      "info",
      `后台分析已启动；模型 ${CODEX_MODEL}；推理 ${CODEX_REASONING_EFFORT}；速度 ${CODEX_SERVICE_TIER}；传输 HTTPS；超时 ${Math.round(timeoutMs / 60_000)} 分钟`
    );
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const detail = tailText(stderr.trim());
      logCodex("error", `处理超时（${Math.round(timeoutMs / 60_000)} 分钟），已终止本次分析`);
      rejectOnce(new Error(
        `Codex 处理超时（${Math.round(timeoutMs / 60_000)} 分钟）${detail ? `\n最近的 CLI 输出：\n${detail}` : ""}`
      ));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      stdoutRemainder += chunk;
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() ?? "";
      for (const line of lines) handleJsonLine(line);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        const friendlyError = new Error(`找不到 Codex CLI，无法整理消息。${missingCodexDetail(executable)}`);
        friendlyError.code = "CODEX_NOT_FOUND";
        friendlyError.cause = error;
        rejectOnce(friendlyError);
        return;
      }
      rejectOnce(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutRemainder.trim()) handleJsonLine(stdoutRemainder);
      if (timedOut) return;
      if (code !== 0) {
        rejectOnce(new Error(`Codex 执行失败（退出码 ${code}）\n${stderr.trim()}`));
        return;
      }
      if (finalMessage === null) {
        rejectOnce(new Error(`Codex 没有返回最终分析结果。\n${tailText(stdout.trim())}`));
        return;
      }
      try {
        const result = JSON.parse(finalMessage.trim());
        if (!settled) {
          settled = true;
          resolve(result);
        }
      } catch (error) {
        rejectOnce(new Error(`Codex 返回的内容不是有效 JSON：${error.message}\n${finalMessage.slice(0, 1000)}`));
      }
    });
    child.stdin.end(payload);
  });
}
