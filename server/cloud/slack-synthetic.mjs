// A synthetic Slack export (Business+ layout) for tests and the e2e of the Slack import. Every
// name, email and message is made up; the same options and seed give the same archive.
//
// `buildSyntheticExport(opts)` writes the ZIP; `syntheticExpectations(opts)` says what a correct
// importer must find in it (counted from the same plan, without zipping).

import { zipBytes } from "./zip.mjs";

const DEFAULT_PEOPLE = [
  { name: "Ana", email: "ana@example.com" },
  { name: "Beto", email: "beto@example.com" },
  { name: "Gil", email: "gil@example.com" },
];
const OUTSIDERS = [
  { name: "Dora", email: "dora@example.net", title: "Consultora" },
  { name: "Eli", email: "eli@example.net", title: "Proveedor" },
];
const PER_DAY = 1000;
const ARCHIVE_DATE = new Date(Date.UTC(2024, 2, 8, 12, 0, 0));
const HELD_FILE = { id: "F0SYN0001", name: "informe.txt", title: "Informe semanal", content: "Informe semanal\nTodo en orden.\n" };
const LINKED_FILE = { id: "F0SYN0002", name: "presupuesto.pdf", title: "Presupuesto", size: 48213 };
// Subtypes the plan uses that an importer skips (see SKIPPED_SUBTYPES in slack-export.mjs).
const PLAN_SKIPS = new Set(["channel_join", "channel_leave", "channel_purpose"]);

/** The export as a ZIP (deflated), deterministic for the options. */
export async function buildSyntheticExport(opts = {}) {
  const plan = buildPlan(opts);
  const date = ARCHIVE_DATE;
  async function* entries() {
    const json = (name, value) => ({ name, data: JSON.stringify(value, null, 2), date, deflate: true });
    yield json("users.json", plan.users);
    yield json("channels.json", plan.channels);
    yield json("groups.json", plan.groups);
    yield json("dms.json", plan.dms);
    yield json("mpims.json", plan.mpims);
    yield json("integration_logs.json", { logs: [] });
    yield json("canvases.json", []);
    for (const [folder, days] of plan.days) {
      yield { name: `${folder}/`, date };
      for (const day of days) yield json(`${folder}/${day.date}.json`, typeof day.messages === "function" ? day.messages() : day.messages);
    }
    yield { name: "__uploads/", date };
    for (const upload of plan.uploads) yield { name: `__uploads/${upload.id}/${upload.name}`, data: upload.content, date, deflate: true };
  }
  return zipBytes(entries());
}

/** What a correct importer finds in `buildSyntheticExport(opts)`. */
export function syntheticExpectations(opts = {}) {
  const plan = buildPlan(opts);
  const emails = new Set(plan.people.map((p) => p.email.toLowerCase()));
  const conversations = { public: plan.channels.length, private: plan.groups.length, dm: plan.dms.length, group: plan.mpims.length };
  conversations.total = conversations.public + conversations.private + conversations.dm + conversations.group;
  const out = {
    users: plan.users.length,
    people: plan.people.length,
    matchedByEmail: plan.users.filter((u) => u.profile?.email && emails.has(u.profile.email.toLowerCase())).length,
    outsiders: OUTSIDERS.length,
    bots: plan.users.filter((u) => u.is_bot).length,
    deleted: plan.users.filter((u) => u.deleted).length,
    conversations,
    dayFiles: 0,
    messages: 0,
    messagesByFolder: {},
    skipped: 0,
    threads: 0,
    replies: 0,
    broadcasts: 0,
    reactions: 0,
    reactionUsers: 0,
    edited: 0,
    pinned: 0,
    botMessages: 0,
    files: { total: 0, held: 0, linked: 0 },
    uploads: plan.uploads.length,
  };
  const held = new Set(plan.uploads.map((u) => u.id));
  for (const [folder, days] of plan.days) {
    out.messagesByFolder[folder] = 0;
    for (const day of days) {
      out.dayFiles++;
      for (const m of typeof day.messages === "function" ? day.messages() : day.messages) {
        if (PLAN_SKIPS.has(m.subtype)) {
          out.skipped++;
          continue;
        }
        out.messages++;
        out.messagesByFolder[folder]++;
        if (m.thread_ts && m.thread_ts === m.ts && m.reply_count > 0) out.threads++;
        if (m.thread_ts && m.thread_ts !== m.ts) out.replies++;
        if (m.subtype === "thread_broadcast") out.broadcasts++;
        if (m.subtype === "bot_message") out.botMessages++;
        if (m.edited) out.edited++;
        if (m.pinned_to?.length) out.pinned++;
        for (const r of m.reactions || []) {
          out.reactions++;
          out.reactionUsers += r.users.length;
        }
        for (const f of m.files || []) {
          out.files.total++;
          if (held.has(f.id)) out.files.held++;
          else out.files.linked++;
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

function buildPlan({ people = DEFAULT_PEOPLE, bigChannelMessages = 0, seed = 1 } = {}) {
  if (!Array.isArray(people) || people.length === 0) throw new Error("buildSyntheticExport needs at least one person");
  const big = Math.max(0, Math.floor(Number(bigChannelMessages) || 0));
  const rng = mulberry32(Number(seed) >>> 0 || 1);
  const pick = (list) => list[Math.floor(rng() * list.length)];
  const handles = new Set();
  const handleOf = (name, email) => {
    const base =
      String(name || email.split("@")[0])
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ".")
        .replace(/^\.|\.$/g, "") || "persona";
    let handle = base;
    for (let i = 2; handles.has(handle); i++) handle = `${base}${i}`;
    handles.add(handle);
    return handle;
  };
  const COLORS = ["9f69e7", "4bbe2e", "e7392d", "3c989f", "e96699", "db3150", "5b89d5", "e0a729"];
  const person = (id, p, i, extra = {}) => {
    const handle = handleOf(p.name, p.email);
    return {
      id,
      team_id: "T0SYN0001",
      name: handle,
      deleted: false,
      color: COLORS[i % COLORS.length],
      real_name: p.name,
      tz: "Europe/Madrid",
      tz_label: "Central European Time",
      tz_offset: 3600,
      profile: { title: p.title || "", real_name: p.name, display_name: handle, email: p.email, team: "T0SYN0001" },
      is_admin: i === 0,
      is_owner: i === 0,
      is_bot: false,
      is_app_user: false,
      updated: 1709546400,
      ...extra,
    };
  };

  const workspace = people.map((p) => ({ name: String(p.name || p.email.split("@")[0]), email: String(p.email).toLowerCase() }));
  const users = workspace.map((p, i) => person(`U0SYN${pad(i + 1)}`, p, i));
  const outsiders = OUTSIDERS.map((p, i) => person(`U0EXT${pad(i + 1)}`, p, users.length + i));
  const bot = {
    id: "U0BOT0001",
    team_id: "T0SYN0001",
    name: "informes",
    deleted: false,
    real_name: "Informes",
    profile: { real_name: "Informes", display_name: "", bot_id: "B0BOT0001", team: "T0SYN0001" },
    is_bot: true,
    is_app_user: false,
    updated: 1709546400,
  };
  const gone = { ...person("U0DEL0001", { name: "Fran", email: "fran@example.org" }, 7), deleted: true };
  const allUsers = [...users, ...outsiders, bot, gone];

  const [A, B, C] = [users[0], users[1] || outsiders[0], users[2] || outsiders[1]].map((u) => u.id);
  const [X1, X2] = outsiders.map((u) => u.id);
  const DEL = gone.id;
  const handleById = new Map(allUsers.map((u) => [u.id, u.name]));
  const everyone = [...new Set([...users.map((u) => u.id), X1, X2])];

  const created = 1704103200; // 2024-01-01 10:00 UTC
  const conv = (id, name, members, extra = {}) => ({
    id,
    name,
    created,
    creator: A,
    is_archived: false,
    is_general: false,
    members,
    topic: { value: "", creator: "", last_set: 0 },
    purpose: { value: "", creator: "", last_set: 0 },
    ...extra,
  });
  const general = conv("C0SYN0001", "general", everyone, {
    is_general: true,
    topic: { value: "Avisos de todo el equipo", creator: A, last_set: created },
    purpose: { value: "Lo que nos afecta a todos", creator: A, last_set: created },
  });
  const random = conv("C0SYN0002", "random", [...new Set([A, B, X1])], { purpose: { value: "Lo demás", creator: A, last_set: created } });
  const historico = big ? conv("C0SYN0003", "historico", [...new Set(users.map((u) => u.id))], { is_archived: true }) : null;
  const channels = [general, random, ...(historico ? [historico] : [])];
  const groups = [conv("G0SYN0001", "direccion", [...new Set([A, B])], { purpose: { value: "Solo dirección", creator: A, last_set: created } })];
  const dms = [{ id: "D0SYN0001", created, members: [A, B] }];
  const mpimName = `mpdm-${[A, B, C].map((id) => handleById.get(id)).join("--")}-1`;
  const mpims = [conv("G0MPI0001", mpimName, [...new Set([A, B, C])], { is_mpim: true })];

  // Clock: increasing ts inside one day.
  const clockFor = (date) => {
    const start = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), 8) / 1000;
    let n = 0;
    let lastSec = 0;
    return () => {
      const sec = Math.max(start + n++ * 300 + Math.floor(rng() * 200), lastSec + 1);
      lastSec = sec;
      return `${sec}.${String(Math.floor(rng() * 1e6)).padStart(6, "0")}`;
    };
  };
  const dayOf = (folder, date) => {
    const clock = clockFor(date);
    const messages = [];
    const say = (user, text, extra = {}) => {
      const m = { type: "message", ...(user ? { user } : {}), text, ts: clock(), ...extra };
      if (user && !extra.subtype) m.team = "T0SYN0001";
      messages.push(m);
      return m;
    };
    const join = (user) => say(user, `<@${user}> has joined the channel`, { subtype: "channel_join" });
    return { folder, date, messages, say, join };
  };

  // #general: the rich conversation.
  const g1 = dayOf("general", "2024-03-04");
  [A, B, C].forEach(g1.join);
  g1.say(A, `${pick(["Hola a todos", "Buenos días a todos", "¡Hola, equipo!"])} :wave: Lo que no sea trabajo, en <#${random.id}|random>`);
  g1.say(B, `Gracias <@${A}>! :tada:`, {
    reactions: [
      { name: "+1", users: [A, C], count: 2 },
      { name: "tada", users: [A], count: 1 },
    ],
  });
  const root = g1.say(A, `¿Revisamos <https://example.com/doc|el documento> hoy? <@${B}|${handleById.get(B)}> <@${C}>`);
  const g2 = dayOf("general", "2024-03-05");
  const replies = [
    g2.say(B, "Sí, lo miro ahora :eyes:", { thread_ts: root.ts, parent_user_id: A }),
    g2.say(C, "Hecho, todo correcto :white_check_mark:", { subtype: "thread_broadcast", thread_ts: root.ts, parent_user_id: A }),
    g2.say(A, "Perfecto :+1::skin-tone-3:", { thread_ts: root.ts, parent_user_id: A }),
  ];
  Object.assign(root, {
    thread_ts: root.ts,
    reply_count: replies.length,
    reply_users_count: new Set(replies.map((r) => r.user)).size,
    latest_reply: replies.at(-1).ts,
    reply_users: [...new Set(replies.map((r) => r.user))],
    replies: replies.map((r) => ({ user: r.user, ts: r.ts })),
  });
  const meeting = g2.say(C, `<!here> reunión a las 10:30 :coffee:`);
  meeting.edited = { user: C, ts: `${Number(meeting.ts.split(".")[0]) + 90}.000000` };
  g2.say(null, "Informe diario listo :bar_chart:", { subtype: "bot_message", bot_id: "B0BOT0001", username: "informes" });
  g2.say(A, "Os dejo el informe de la semana", {
    subtype: "file_share",
    files: [
      {
        id: HELD_FILE.id,
        created: created,
        name: HELD_FILE.name,
        title: HELD_FILE.title,
        mimetype: "text/plain",
        filetype: "text",
        user: A,
        size: new TextEncoder().encode(HELD_FILE.content).length,
        mode: "hosted",
        is_external: false,
        url_private: `https://files.example.com/files-pri/T0SYN0001-${HELD_FILE.id}/${HELD_FILE.name}`,
        permalink: `https://synthetic.example.com/files/${A}/${HELD_FILE.id}/${HELD_FILE.name}`,
      },
    ],
  });
  const g3 = dayOf("general", "2024-03-06");
  g3.say(B, "Y aquí el presupuesto", {
    subtype: "file_share",
    files: [
      {
        id: LINKED_FILE.id,
        created: created,
        name: LINKED_FILE.name,
        title: LINKED_FILE.title,
        mimetype: "application/pdf",
        filetype: "pdf",
        user: B,
        size: LINKED_FILE.size,
        mode: "hosted",
        is_external: false,
        url_private: `https://files.example.com/files-pri/T0SYN0001-${LINKED_FILE.id}/${LINKED_FILE.name}`,
      },
    ],
  });
  g3.say(A, "<!channel> recordad revisar el `:memo: borrador` antes del viernes :memo: &lt;importante&gt;", {
    pinned_to: [general.id],
    reactions: [{ name: "partyparrot", users: [B], count: 1 }],
  });
  g3.say(X2, `<@${X2}> has left the channel`, { subtype: "channel_leave" });
  g3.say(X1, `Saludos desde fuera :rocket: escribidme a <mailto:${OUTSIDERS[0].email}|${OUTSIDERS[0].email}>`);
  g3.say(DEL, "Mensaje antiguo de alguien que ya no está");

  // #random
  const r1 = dayOf("random", "2024-03-04");
  r1.join(X1);
  r1.say(A, `¿${pick(["Café", "Un café", "Café rápido"])}? :coffee:`, { reactions: [{ name: "heart", users: [B], count: 1 }] });
  r1.say(B, "Vamos :beers:");
  r1.say(X1, "Me apunto :raised_hands:");

  // Private channel, DM and group DM.
  const p1 = dayOf("direccion", "2024-03-05");
  p1.say(A, "set the channel purpose: Solo dirección", { subtype: "channel_purpose", purpose: "Solo dirección" });
  p1.say(A, "Presupuesto del trimestre :memo:");
  p1.say(B, "Visto :ok_hand:");
  const d1 = dayOf(dms[0].id, "2024-03-05");
  d1.say(A, "Hola, ¿tienes un momento?");
  d1.say(B, `Claro <@${A}>`);
  const m1 = dayOf(mpimName, "2024-03-06");
  m1.say(A, "¿Comemos juntos? :pizza:");
  m1.say(B, "Sí :+1:", { reactions: [{ name: "+1", users: [C], count: 1 }] });
  m1.say(C, "Vale");

  const days = new Map();
  for (const day of [g1, g2, g3, r1, p1, d1, m1]) {
    if (!days.has(day.folder)) days.set(day.folder, []);
    days.get(day.folder).push({ date: day.date, messages: day.messages });
  }

  // #historico: `big` plain messages, ≤ PER_DAY per day file, built when written.
  if (historico) {
    const authors = users.map((u) => u.id);
    const list = [];
    const startDay = Date.UTC(2023, 0, 2) / 1000;
    for (let d = 0; d * PER_DAY < big; d++) {
      const first = d * PER_DAY;
      const count = Math.min(PER_DAY, big - first);
      const dayStart = startDay + d * 86400;
      const date = new Date(dayStart * 1000).toISOString().slice(0, 10);
      const daySeed = (Number(seed) >>> 0) + d;
      list.push({
        date,
        messages: () => {
          const r = mulberry32(daySeed * 7919 + 17);
          const out = [];
          for (let k = 0; k < count; k++) {
            const i = first + k;
            out.push({
              type: "message",
              user: authors[i % authors.length],
              text: i % 7 === 0 ? `Mensaje histórico ${i + 1} :memo:` : `Mensaje histórico ${i + 1}`,
              ts: `${dayStart + 6 * 3600 + k * 60 + Math.floor(r() * 50)}.${String(i % 1e6).padStart(6, "0")}`,
              team: "T0SYN0001",
            });
          }
          return out;
        },
      });
    }
    days.set("historico", list);
  }

  return {
    people: workspace,
    users: allUsers,
    channels,
    groups,
    dms,
    mpims,
    days,
    uploads: [{ id: HELD_FILE.id, name: HELD_FILE.name, content: HELD_FILE.content }],
  };
}

function pad(n) {
  return String(n).padStart(4, "0");
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
