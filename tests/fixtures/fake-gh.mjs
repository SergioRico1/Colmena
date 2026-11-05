// A stand-in for GitHub CLI in «Código» tests: `auth status`, `pr view <branch> --json …`,
// `run view <id> --log-failed`, `pr merge|ready|diff <n>` and `api …` (the signed-in user, a
// PR's line comments, posting a review, whether a login is a GitHub App), answering from the
// JSON file in GH_FAKE_STATE.
// What changes GitHub (merge, ready, a posted review) is written back to that file under
// `calls` (the arguments) and `posted` (the review payloads).
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = process.env.GH_FAKE_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
const save = () => writeFileSync(file, JSON.stringify(state));
const fail = (text) => { process.stderr.write(text + "\n"); process.exit(1); };
const record = () => { (state.calls ||= []).push(args); save(); };

if (args[0] === "auth" && args[1] === "status") {
  process.exit(state.authed === false ? 1 : 0);
} else if (args[0] === "pr" && args[1] === "view") {
  if (!state.pr) fail("no pull requests found for branch");
  process.stdout.write(JSON.stringify(state.pr));
} else if (args[0] === "pr" && args[1] === "merge") {
  record();
  if (state.mergeError) fail(state.mergeError);
  const sha = args[args.indexOf("--match-head-commit") + 1];
  if (args.includes("--match-head-commit") && sha !== state.pr.headRefOid) fail("GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)");
  state.pr = { ...state.pr, state: "MERGED" };
  save();
} else if (args[0] === "pr" && args[1] === "ready") {
  record();
  state.pr = { ...state.pr, isDraft: false };
  save();
} else if (args[0] === "pr" && args[1] === "diff") {
  process.stdout.write(state.diff || "");
} else if (args[0] === "run" && args[1] === "view") {
  process.stdout.write(state.logs?.[args[2]] || "");
} else if (args[0] === "api" && args[1] === "user") {
  process.stdout.write((state.login || "yo") + "\n");
} else if (args[0] === "api" && args[1].startsWith("users/")) {
  // «<login>[bot]»: a GitHub App (listed in `bots`) answers type Bot, anyone else 404.
  (state.lookups ||= []).push(args[1]);
  save();
  const login = decodeURIComponent(args[1].slice(6)).replace(/\[bot\]$/, "");
  if (!(state.bots || []).includes(login)) fail("gh: Not Found (HTTP 404)");
  process.stdout.write("Bot\n");
} else if (args[0] === "api" && /\/pulls\/\d+\/comments/.test(args[1])) {
  process.stdout.write(JSON.stringify(state.lineComments || []));
} else if (args[0] === "api" && /\/pulls\/\d+\/reviews$/.test(args[1]) && args.includes("POST")) {
  record();
  if (state.reviewError) fail(state.reviewError);
  const payload = JSON.parse(readFileSync(args[args.indexOf("--input") + 1], "utf8"));
  (state.posted ||= []).push(payload);
  save();
  process.stdout.write(JSON.stringify({ id: 555, html_url: state.pr.url + "#pullrequestreview-555" }));
} else {
  fail("unknown command");
}
