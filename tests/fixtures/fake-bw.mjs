// A stand-in for Bitwarden's CLI `bw` (server/managers): `status`, `unlock --raw`, `list items`
// and `get username|password <id>`, answering from the JSON file in BW_FAKE_STATE:
// {loggedIn: bool, sessionKey: "…", items: [{id, name, uri, username, password}]}.
// It is unlocked when BW_SESSION equals sessionKey. `unlock --raw` prints sessionKey (the fake
// asks for nothing). Every call's arguments are appended to `calls` in that file.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = process.env.BW_FAKE_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
(state.calls ||= []).push(args);
writeFileSync(file, JSON.stringify(state));
const fail = (text) => { process.stderr.write(text + "\n"); process.exit(1); };
const unlocked = state.loggedIn !== false && !!process.env.BW_SESSION && process.env.BW_SESSION === state.sessionKey;

if (args[0] === "--version") process.stdout.write("2025.1.0\n");
else if (args[0] === "status")
  process.stdout.write(JSON.stringify({ serverUrl: null, lastSync: null, userEmail: "persona@example.com", userId: "u1", status: state.loggedIn === false ? "unauthenticated" : unlocked ? "unlocked" : "locked" }));
else if (args[0] === "unlock") {
  if (state.loggedIn === false || state.wrongPassword) fail("Invalid master password.");
  process.stdout.write(state.sessionKey + (args.includes("--raw") ? "" : "\n"));
} else if (args[0] === "list" && args[1] === "items") {
  if (!unlocked) fail("Vault is locked.");
  process.stdout.write(JSON.stringify((state.items || []).map((it) => ({
    object: "item", id: it.id, organizationId: null, folderId: null, type: 1, name: it.name, notes: null, favorite: false,
    login: { uris: it.uri ? [{ match: null, uri: it.uri }] : [], username: it.username, password: it.password, totp: null },
  }))));
} else if (args[0] === "get" && (args[1] === "username" || args[1] === "password")) {
  if (!unlocked) fail("Vault is locked.");
  const it = (state.items || []).find((i) => i.id === args[2]);
  if (!it) fail("Not found.");
  process.stdout.write(String(it[args[1]]));
} else fail("unknown command");
