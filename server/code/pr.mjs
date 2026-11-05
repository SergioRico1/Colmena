// Pull request actions of «Código» that go out to GitHub (service.mjs runs them with gh):
// merging with a head-SHA guard, marking a draft ready, posting Código's P0–P3 review as one
// GitHub review, and the sign-in hint before pushing. These helpers are pure (no gh calls).

/** «https://github.com/a/b/pull/7» → «a/b» (null when it is not a GitHub PR address). */
export function prRepo(url) {
  const m = /github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/\d+/i.exec(String(url || ""));
  return m ? m[1] + "/" + m[2] : null;
}

/**
 * Automated reviewers (Copilot, CodeRabbit…) are fallible input, not an authority: each one
 * wakes Bruno for at most BOT_ROUNDS review runs per PR (DeepSeek's dsh-superagent rule).
 * A run is that bot's feedback on one head commit, however many comments it leaves.
 */
export const BOT_ROUNDS = 3;

/** «copilot-pull-request-reviewer[bot]» and «copilot-pull-request-reviewer» are one bot. */
export const botName = (login) => String(login || "").replace(/\[bot\]$/i, "");

/**
 * New PR feedback split into people's and bots' (gh pr view `comments`/`reviews` as `said`,
 * the REST line comments as `lines`). `bots` is the Set of bot names; `rounds` maps each bot
 * to the head commits it has reviewed so far, `capped` the bots that used up their rounds.
 * A bot over its rounds is dropped (and named once in `newlyCapped`).
 */
export function sortFeedback({ said = [], lines = [], bots = new Set(), rounds = {}, capped = [], head = null }) {
  const people = { said: [], lines: [] };
  const fromBots = new Map(); // name → {said, lines}
  const nextRounds = { ...rounds };
  const nextCapped = new Set(capped);
  const newlyCapped = [];
  const place = (c, kind) => {
    const name = botName(kind === "lines" ? c.user?.login : c.author?.login);
    if (!name || !bots.has(name)) { people[kind].push(c); return; }
    const commit = (kind === "lines" ? c.commit_id : c.commit?.oid) || head || "?";
    const runs = nextRounds[name] || [];
    if (!runs.includes(commit)) {
      if (runs.length >= BOT_ROUNDS) {
        if (!nextCapped.has(name)) { nextCapped.add(name); newlyCapped.push(name); }
        return;
      }
      nextRounds[name] = [...runs, commit];
    }
    const entry = fromBots.get(name) || { said: [], lines: [] };
    entry[kind].push(c);
    fromBots.set(name, entry);
  };
  for (const c of said) place(c, "said");
  for (const c of lines) place(c, "lines");
  return { people, bots: fromBots, rounds: nextRounds, capped: [...nextCapped], newlyCapped };
}

/** What git says when the remote does not know who you are (push and ls-remote alike). */
export const AUTH_FAIL = /could not read (Username|Password)|Authentication failed|terminal prompts disabled|Permission denied|access denied|denied to|\b40[13]\b|Invalid username or password|Repository not found/i;

/** How to sign in, depending on what GitHub CLI says ({installed, authed} of ghStatus). */
export function signInHint(gh = {}) {
  if (gh.authed) return "GitHub no te deja subir desde este ordenador. Ya tienes sesión en gh: ejecuta «gh auth setup-git» en una terminal para que Git la use, y vuelve a intentarlo.";
  if (gh.installed) return "Inicia sesión en GitHub antes de subir: ejecuta «gh auth login» en una terminal y vuelve a intentarlo.";
  return "GitHub no te reconoce en este ordenador. Instala GitHub CLI (gh) y ejecuta «gh auth login» en una terminal, o haz un push desde una terminal una vez.";
}

/** gh's refusal to merge, in plain Spanish (the PR's state is refreshed right after). */
export function mergeRefusal(said, { number, base = "main" } = {}) {
  const s = String(said || "");
  const n = "#" + number;
  if (/head branch was modified|match-head-commit|head commit|expected head sha|sha .*(does not match|mismatch)/i.test(s)) return `Han subido cambios a la PR ${n} después de que la miraras, así que no se ha fusionado. Mira lo nuevo y vuelve a intentarlo.`;
  if (/draft/i.test(s)) return `La PR ${n} es un borrador: márcala como lista antes de fusionarla.`;
  if (/conflict|not mergeable|merge conflict/i.test(s)) return `La PR ${n} tiene conflictos con ${base}: pídele a Bruno que traiga lo último de ${base} y los resuelva.`;
  if (/status check|checks? (are|is) (expected|required|failing|pending)|required.*check|approving review|review.*required|base branch policy|protected branch/i.test(s)) return `GitHub aún no deja fusionar la PR ${n}: faltan comprobaciones o aprobaciones que pide el repositorio.`;
  if (/not authenticated|auth login|HTTP 401/i.test(s)) return "Inicia sesión en GitHub con «gh auth login» en una terminal y vuelve a intentarlo.";
  const last = s.trim().split(/\r?\n/).filter(Boolean).at(-1) || "";
  return `GitHub no ha fusionado la PR ${n}` + (last ? ": " + last.slice(0, 300) : ".");
}

/** The lines a review comment may point at, per file: every line of the new side in the PR diff. */
export function rightLines(patch) {
  const files = new Map();
  let file = null, line = 0, last = "";
  for (const raw of String(patch || "").split(/\r?\n/)) {
    const prev = last;
    last = raw;
    if (raw.startsWith("diff --git ")) { file = null; line = 0; continue; }
    if (raw.startsWith("+++ ") && prev.startsWith("--- ")) {
      const to = raw.slice(4).trim();
      file = to === "/dev/null" ? null : to.replace(/^b\//, "");
      if (file && !files.has(file)) files.set(file, new Set());
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (!file || !line) continue;
    if (raw.startsWith("+") || raw.startsWith(" ")) files.get(file).add(line++);
  }
  return files;
}

/** A finding's file as it is named in the PR diff (the reviewer may add «./», «a/» or «b/»). */
function diffPath(file, lines) {
  const f = String(file || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^[ab]\//, "");
  if (!f) return null;
  if (lines.has(f)) return f;
  const ends = [...lines.keys()].filter((p) => p.endsWith("/" + f));
  return ends.length === 1 ? ends[0] : null;
}

const findingText = (f) => `**${f.severity}** ${f.title}` + (f.detail ? "\n\n" + f.detail : "");

/**
 * One GitHub review (event COMMENT) from a «review» item: findings on a line of the PR diff
 * go as inline comments; the rest, with the summary, in the body.
 */
export function reviewPayload(item, { commit, lines = new Map() }) {
  const comments = [], rest = [];
  for (const f of item.findings || []) {
    const at = f.line ? diffPath(f.file, lines) : null;
    if (at && lines.get(at).has(Number(f.line))) comments.push({ path: at, line: Number(f.line), side: "RIGHT", body: findingText(f) });
    else rest.push(f);
  }
  const total = (item.findings || []).length;
  const body = [
    "**Revisión de Código (Colmena)**",
    item.summary || null,
    !total ? "No ha encontrado problemas." : comments.length ? (comments.length === 1 ? "1 comentario en las líneas." : comments.length + " comentarios en las líneas.") : null,
    rest.length ? rest.map((f) => `- **${f.severity}** ${f.title}` + (f.file ? ` (\`${f.file}${f.line ? ":" + f.line : ""}\`)` : "") + (f.detail ? ": " + f.detail : "")).join("\n") : null,
  ].filter(Boolean).join("\n\n");
  return { commit_id: commit, event: "COMMENT", body, comments };
}
