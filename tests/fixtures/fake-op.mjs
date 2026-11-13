// A stand-in for 1Password's CLI `op` (server/managers): `account list`, `whoami`,
// `item list --categories Login --format json` and `item get <id> --fields
// label=username,label=password --reveal --format json`, answering from the JSON file in
// OP_FAKE_STATE: {accounts: [...], unlocked: bool, items: [{id, title, url, username, password}]}.
// Every call's arguments are appended to `calls` in that file.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = process.env.OP_FAKE_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
(state.calls ||= []).push(args);
writeFileSync(file, JSON.stringify(state));
const fail = (text) => { process.stderr.write("[ERROR] " + text + "\n"); process.exit(1); };
const out = (v) => process.stdout.write(JSON.stringify(v));

if (args[0] === "--version") out("2.30.0");
else if (args[0] === "account" && args[1] === "list") out(state.accounts || []);
else if (args[0] === "whoami") {
  if (!state.unlocked) fail("account is not signed in");
  out({ url: "my.1password.com", email: "persona@example.com", user_type: "HUMAN" });
} else if (args[0] === "item" && args[1] === "list") {
  if (!state.unlocked) fail("authorization prompt dismissed, please try again");
  if (args[args.indexOf("--categories") + 1] !== "Login" || args[args.indexOf("--format") + 1] !== "json") fail("bad flags");
  out((state.items || []).map((it) => ({
    id: it.id, title: it.title, version: 1, vault: { id: "v1", name: "Personal" }, category: "LOGIN",
    additional_information: it.username, urls: it.url ? [{ label: "website", primary: true, href: it.url }] : [],
  })));
} else if (args[0] === "item" && args[1] === "get") {
  if (!state.unlocked) fail("authorization prompt dismissed, please try again");
  const it = (state.items || []).find((i) => i.id === args[2]);
  if (!it) fail(`"${args[2]}" isn't an item.`);
  if (args[args.indexOf("--fields") + 1] !== "label=username,label=password" || !args.includes("--reveal")) fail("bad flags");
  out([
    { id: "username", type: "STRING", purpose: "USERNAME", label: "username", value: it.username, reference: "op://Personal/x/username" },
    { id: "password", type: "CONCEALED", purpose: "PASSWORD", label: "password", value: it.password, reference: "op://Personal/x/password" },
  ]);
} else fail("unknown command");
