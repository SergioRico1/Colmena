// Writes a synthetic Slack export ZIP (server/cloud/slack-synthetic.mjs) and prints what a
// correct import of it must find, as JSON.
//
//   node cloud/scripts/slack-export.mjs --out <file.zip> [--emails a@x,b@x,c@x] [--names Ana,Beto,Gil] [--big 50000] [--seed 1]
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSyntheticExport, syntheticExpectations } from "../../server/cloud/slack-synthetic.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) throw new Error(`Unknown argument: ${argv[i]}`);
    args[m[1]] = m[2] ?? argv[++i];
    if (args[m[1]] === undefined) throw new Error(`--${m[1]} needs a value`);
  }
  return args;
}

const USAGE = "Usage: node cloud/scripts/slack-export.mjs --out <file.zip> [--emails a@x,b@x,c@x] [--names Ana,Beto,Gil] [--big 50000] [--seed 1]";

let args;
try {
  args = parseArgs(process.argv.slice(2));
  if (!args.out) throw new Error("--out is required");
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}

const list = (value) => (value ? String(value).split(",").map((s) => s.trim()).filter(Boolean) : []);
const emails = list(args.emails);
const names = list(args.names);
const opts = { seed: args.seed ? Number(args.seed) : 1, bigChannelMessages: args.big ? Number(args.big) : 0 };
if (emails.length || names.length) {
  const count = Math.max(emails.length, names.length);
  opts.people = Array.from({ length: count }, (_, i) => {
    const name = names[i] || (emails[i] ? emails[i].split("@")[0] : `Persona ${i + 1}`);
    const email = emails[i] || `${name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "")}@example.com`;
    return { name, email };
  });
}

const bytes = await buildSyntheticExport(opts);
const out = resolve(args.out);
writeFileSync(out, bytes);
console.error(`Wrote ${out} (${bytes.length} bytes)`);
console.log(JSON.stringify(syntheticExpectations(opts), null, 2));
