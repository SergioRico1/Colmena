// A stand-in for GitHub CLI in «Código» tests: `auth status`, `pr view <branch> --json …` and
// `run view <id> --log-failed`, answering from the JSON file in GH_FAKE_STATE.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.GH_FAKE_STATE, "utf8"));
if (args[0] === "auth" && args[1] === "status") {
  process.exit(state.authed === false ? 1 : 0);
} else if (args[0] === "pr" && args[1] === "view") {
  if (!state.pr) { process.stderr.write("no pull requests found for branch\n"); process.exit(1); }
  process.stdout.write(JSON.stringify(state.pr));
} else if (args[0] === "run" && args[1] === "view") {
  process.stdout.write(state.logs?.[args[2]] || "");
} else {
  process.stderr.write("unknown command\n");
  process.exit(1);
}
