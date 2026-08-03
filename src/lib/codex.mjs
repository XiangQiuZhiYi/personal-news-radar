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
  localBinRoot = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "OpenAI", "Codex", "bin") : null
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
  return platform === "win32" ? "codex.exe" : "codex";
}

export function buildPrompt(preferences) {
  return `你是一名严谨的个人信息编辑。请只分析标准输入中提供的候选信息，不要搜索网络、读取其他文件或运行命令。

目标：从大量候选信息中筛选真正值得用户今天阅读的内容，进行语义去重、分类和价值排序。

筛选要求：
1. 最多保留 ${preferences.maxSelectedItems} 条，宁缺毋滥。
2. 相同事件只保留最接近一手来源、信息量最大的一条。
3. 单一信息源最多保留 ${preferences.maxSelectedPerSource} 条，单一分类最多保留 ${preferences.maxSelectedPerCategory} 条。
4. 国际来源最多保留 ${preferences.maxInternationalItems} 条，其余名额优先给国内来源；输入中的 region 标明 domestic 或 international。
5. 评分综合考虑影响范围、新颖性、可信度、行动价值和长期意义。
6. 摘要使用 ${preferences.language}，说明具体新增事实，不复述空洞标题。
7. whyItMatters 必须解释这条信息可能改变什么判断或行动；无法说明价值的内容应丢弃。
8. impactForPeople 必须从普通个人或家庭视角说明影响，明确可能受影响的人群，优先考虑收入、就业、消费、住房、教育、医疗、安全、隐私、出行或时间成本，并区分直接与间接影响；若短期直接影响有限，应明确说明，不得强行制造焦虑，也不要重复 summary 或 whyItMatters。
9. 至少约 ${Math.round(preferences.explorationRatio * 100)}% 的名额可用于高价值的陌生或相邻领域，避免只迎合既有兴趣；没有合格内容时不强行补足。
10. 不得编造候选信息中不存在的事实、来源或链接。
11. items 中只能引用输入里真实存在的 candidateId。
12. brief 只概括今天的重点主题和整体可信度，不要写候选数或入选数；数量由程序单独展示。

用户偏好与规则：
${JSON.stringify(preferences, null, 2)}

请严格按照输出 JSON Schema 返回结果。`;
}

export async function runCodexFilter({ candidates, preferences, schemaPath, timeoutMs = 10 * 60 * 1000 }) {
  const executable = await resolveCodexExecutable();
  const prompt = buildPrompt(preferences);
  const args = [
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--output-schema",
    path.resolve(schemaPath),
    prompt
  ];

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
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex 处理超时（${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (error.code === "ENOENT") {
        const detail = process.env.CODEX_BIN
          ? `CODEX_BIN 当前设置为：${process.env.CODEX_BIN}`
          : "请确认 Codex Desktop 或 Codex CLI 已安装；也可以通过 CODEX_BIN 指定 codex.exe 的完整路径。";
        const friendlyError = new Error(`找不到 Codex CLI，无法整理消息。${detail}`);
        friendlyError.code = "CODEX_NOT_FOUND";
        friendlyError.cause = error;
        reject(friendlyError);
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Codex 执行失败（退出码 ${code}）\n${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`Codex 返回的内容不是有效 JSON：${error.message}\n${stdout.slice(0, 1000)}`));
      }
    });
    child.stdin.end(payload);
  });
}
