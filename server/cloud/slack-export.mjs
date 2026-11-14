// Reading a Slack export: pure functions over entry names and parsed JSON, no I/O, so the
// importer (which reads the ZIP with server/cloud/zip.mjs, in chunks driven by Durable Object
// alarms) can call them anywhere.
//
// Layout of an export ZIP: `users.json`, `channels.json` (public channels) and, on
// Business+/Enterprise exports, `groups.json` (private channels), `dms.json` (1:1 DMs, whose
// folder is the DM id) and `mpims.json` (group DMs, whose folder is the mpim name). Each
// conversation is a folder of day files `YYYY-MM-DD.json`, each an array of messages. Some exports
// also hold the uploaded files, as `__uploads/<FILE_ID>/<file name>`.
//
// Colmena stores message text in a deliberately Slack-compatible format (mentions `<@id>`,
// `<!here>`, links `<url|label>`, HTML entities escaped), so `convertText` only maps ids and
// turns emoji shortcodes into Unicode.

const DAY_FILE = /^([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/;
const UPLOAD = /^__uploads\/([^/]+)\/(.+[^/])$/;
const ROOT_FILES = ["users.json", "channels.json", "groups.json", "dms.json", "mpims.json"];

/**
 * What an export holds, from its entry names. Exports re-zipped by hand often sit inside one top
 * folder; that folder is detected and returned as `root` (entry names in the result keep it).
 */
export function classifyExport(names) {
  const list = [...names].map(String);
  let root = "";
  if (!list.includes("users.json") && !list.includes("channels.json")) {
    const nested = list.filter((n) => /^[^/]+\/(users|channels)\.json$/.test(n));
    if (nested.length) root = nested[0].slice(0, nested[0].indexOf("/") + 1);
  }
  const found = Object.fromEntries(ROOT_FILES.map((f) => [f, null]));
  const conversations = new Map();
  const uploads = new Map();
  for (const name of list) {
    if (root && !name.startsWith(root)) continue;
    const path = name.slice(root.length);
    if (!path || path.endsWith("/")) continue;
    if (Object.hasOwn(found, path)) {
      found[path] = name;
      continue;
    }
    const upload = UPLOAD.exec(path);
    if (upload) {
      if (!uploads.has(upload[1])) uploads.set(upload[1], name);
      continue;
    }
    const day = DAY_FILE.exec(path);
    if (day && !day[1].startsWith("__")) {
      if (!conversations.has(day[1])) conversations.set(day[1], []);
      conversations.get(day[1]).push({ date: day[2], name });
    }
  }
  for (const [folder, days] of conversations) {
    days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    conversations.set(
      folder,
      days.map((d) => d.name),
    );
  }
  const business = !!(found["groups.json"] || found["dms.json"] || found["mpims.json"]);
  return {
    format: business ? "business" : "standard",
    root,
    users: found["users.json"],
    channels: found["channels.json"],
    groups: found["groups.json"],
    dms: found["dms.json"],
    mpims: found["mpims.json"],
    conversations,
    uploads,
  };
}

/** The date ("YYYY-MM-DD") of a day file's entry name, or null. */
export function dayOf(entryName) {
  const m = /(\d{4}-\d{2}-\d{2})\.json$/.exec(String(entryName));
  return m ? m[1] : null;
}

/** The people of `users.json` (parsed array, or its text). */
export function parseUsers(json) {
  const list = asArray(json);
  return list
    .filter((u) => u && typeof u === "object" && u.id)
    .map((u) => {
      const profile = u.profile || {};
      const email = typeof profile.email === "string" && profile.email.trim() ? profile.email.trim().toLowerCase() : null;
      return {
        slackId: String(u.id),
        name: firstText(profile.real_name, profile.display_name, u.real_name, u.name) || String(u.id),
        handle: u.name ? String(u.name) : null,
        email,
        title: firstText(profile.title) || null,
        tz: u.tz || null,
        deleted: !!u.deleted,
        isBot: !!(u.is_bot || u.is_app_user || u.id === "USLACKBOT"),
        avatarColor: u.color ? `#${String(u.color).replace(/^#/, "")}` : null,
        image: firstText(profile.image_192, profile.image_72, profile.image_48) || null,
      };
    });
}

/**
 * Every conversation of the export, from the parsed `channels.json`, `groups.json`, `dms.json`
 * and `mpims.json` (any may be null). `folder` is where its day files are.
 */
export function parseConversations({ channels = null, groups = null, dms = null, mpims = null } = {}) {
  const out = [];
  const add = (list, kind) => {
    for (const c of asArray(list)) {
      if (!c || typeof c !== "object" || !c.id) continue;
      const isDm = kind === "dm";
      const name = isDm ? null : c.name ? String(c.name) : null;
      out.push({
        slackId: String(c.id),
        folder: isDm ? String(c.id) : name || String(c.id),
        kind,
        name,
        topic: topicOf(c),
        purpose: purposeOf(c),
        createdAt: Number.isFinite(Number(c.created)) && c.created ? Number(c.created) * 1000 : null,
        archived: !!c.is_archived,
        general: !!c.is_general,
        creator: c.creator || null,
        members: Array.isArray(c.members) ? c.members.map(String) : [],
      });
    }
  };
  add(channels, "public");
  add(groups, "private");
  add(dms, "dm");
  add(mpims, "group");
  return out;
}

/** A conversation's topic text ("" when none). */
export function topicOf(conv) {
  return typeof conv?.topic === "string" ? conv.topic : conv?.topic?.value || "";
}

/** A conversation's purpose text ("" when none). */
export function purposeOf(conv) {
  return typeof conv?.purpose === "string" ? conv.purpose : conv?.purpose?.value || "";
}

// ---------------------------------------------------------------------------------------------
// Text

const CODE = /```[\s\S]*?```|`[^`\n]+`/g;
const ANGLE = /<([^<>\s][^<>]*)>/g;
const SHORTCODE = /:([a-z0-9_+'-]+):((?::skin-tone-[2-6]:)?)/gi;

/**
 * Slack markup → Colmena's stored text. `user(slackId, label)` and `channel(slackId, label)`
 * return what replaces a user or channel mention (label is null when the markup had none); when
 * not given, mentions stay as they are. Special mentions become `<!channel>` / `<!here>`, user
 * groups their `@handle`, dates their fallback text; links stay as they are; HTML entities stay
 * escaped. Emoji shortcodes become Unicode when known, except inside backtick code.
 */
export function convertText(text, { user, channel } = {}) {
  const source = String(text ?? "");
  let out = "";
  let last = 0;
  for (const m of source.matchAll(CODE)) {
    out += convertPlain(source.slice(last, m.index), user, channel, true);
    out += convertPlain(m[0], user, channel, false);
    last = m.index + m[0].length;
  }
  return out + convertPlain(source.slice(last), user, channel, true);
}

function convertPlain(text, user, channel, emoji) {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(ANGLE)) {
    const before = text.slice(last, m.index);
    out += emoji ? convertEmoji(before) : before;
    out += convertMarkup(m[0], m[1], user, channel);
    last = m.index + m[0].length;
  }
  const rest = text.slice(last);
  return out + (emoji ? convertEmoji(rest) : rest);
}

function convertMarkup(whole, inner, user, channel) {
  const bar = inner.indexOf("|");
  const head = bar < 0 ? inner : inner.slice(0, bar);
  const label = bar < 0 ? null : inner.slice(bar + 1);
  if (head.startsWith("@")) {
    const id = head.slice(1);
    return user && id ? String(user(id, label) ?? whole) : whole;
  }
  if (head.startsWith("#")) {
    const id = head.slice(1);
    return channel && id ? String(channel(id, label) ?? whole) : whole;
  }
  if (head.startsWith("!")) {
    const command = head.slice(1);
    if (command === "channel" || command === "everyone" || command === "group") return "<!channel>";
    if (command === "here") return "<!here>";
    if (command.startsWith("subteam^")) return label || `@${command.slice(8)}`;
    if (command.startsWith("date^")) return label ?? whole;
    return label ?? whole;
  }
  return whole; // links: <https://x>, <https://x|label>, <mailto:a@b|a@b>
}

function convertEmoji(text) {
  if (!text.includes(":")) return text;
  let out = "";
  let last = 0;
  SHORTCODE.lastIndex = 0;
  for (let m = SHORTCODE.exec(text); m; m = SHORTCODE.exec(text)) {
    const emoji = emojiFor(m[1]);
    if (!emoji) {
      SHORTCODE.lastIndex = m.index + 1; // the closing colon may open the next shortcode
      continue;
    }
    out += text.slice(last, m.index) + emoji;
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

/** The Unicode emoji for a Slack shortcode (without colons; skin tones fall back to the base), or null. */
export function emojiFor(name) {
  const key = String(name ?? "")
    .replace(/^:|:$/g, "")
    .replace(/::skin-tone-[2-6]$/, "")
    .toLowerCase();
  return EMOJI.get(key) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Messages

/** Message subtypes that are not conversation (joins, renames, pins…): the importer skips them. */
export const SKIPPED_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "group_join",
  "group_leave",
  "channel_purpose",
  "channel_topic",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_purpose",
  "group_topic",
  "group_name",
  "group_archive",
  "group_unarchive",
  "channel_convert_to_private",
  "channel_convert_to_public",
  "pinned_item",
  "unpinned_item",
  "bot_add",
  "bot_remove",
  "tombstone",
  "message_deleted",
  "message_changed",
  "joiner_notification_for_inviter",
]);

/** A Slack timestamp ("1709546400.123456") in milliseconds, or null. */
export function tsToMs(ts) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(ts ?? ""));
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] || "").padEnd(3, "0").slice(0, 3));
}

/** One raw message of a day file → what the importer stores, or null when it is to be skipped. */
export function normalizeMessage(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type && raw.type !== "message") return null;
  if (raw.hidden || SKIPPED_SUBTYPES.has(raw.subtype)) return null;
  const ts = raw.ts == null ? null : String(raw.ts);
  const at = tsToMs(ts);
  if (at === null) return null;
  const threadTs = raw.thread_ts == null ? null : String(raw.thread_ts);
  const isBot = raw.subtype === "bot_message" || (!!raw.bot_id && !raw.user);
  const files = [];
  for (const f of [...(Array.isArray(raw.files) ? raw.files : []), ...(raw.file && typeof raw.file === "object" ? [raw.file] : [])]) {
    if (!f || typeof f !== "object" || !f.id || f.mode === "tombstone") continue;
    files.push({
      id: String(f.id),
      name: f.name || f.title || String(f.id),
      title: f.title || f.name || null,
      mimetype: f.mimetype || null,
      size: Number.isFinite(f.size) ? f.size : null,
      url: f.url_private || f.permalink || null,
      external: !!(f.is_external || f.mode === "external"),
    });
  }
  return {
    ts,
    at,
    user: raw.user ? String(raw.user) : null,
    botName: isBot ? firstText(raw.username, raw.bot_profile?.name) || null : null,
    text: typeof raw.text === "string" ? raw.text : "",
    subtype: raw.subtype || null,
    threadTs: threadTs && threadTs !== ts ? threadTs : null,
    isRoot: !!threadTs && threadTs === ts && (Number(raw.reply_count) > 0 || (Array.isArray(raw.replies) && raw.replies.length > 0)),
    broadcast: raw.subtype === "thread_broadcast",
    editedAt: raw.edited?.ts ? tsToMs(raw.edited.ts) : null,
    reactions: (Array.isArray(raw.reactions) ? raw.reactions : [])
      .filter((r) => r && r.name)
      .map((r) => ({
        name: String(r.name),
        emoji: emojiFor(r.name) ?? `:${String(r.name).replace(/::skin-tone-[2-6]$/, "")}:`,
        users: Array.isArray(r.users) ? r.users.map(String) : [],
      })),
    files,
    pinned: Array.isArray(raw.pinned_to) && raw.pinned_to.length > 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers

function asArray(json) {
  if (json == null) return [];
  const value = typeof json === "string" ? JSON.parse(json) : json;
  if (!Array.isArray(value)) throw new Error("Expected a JSON array");
  return value;
}

function firstText(...values) {
  for (const v of values) if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}

// Common Slack shortcodes (Slack's names and the usual aliases). Unknown ones stay ":name:".
const EMOJI = new Map(
  `+1=👍 thumbsup=👍 -1=👎 thumbsdown=👎 heart=❤️ joy=😂 smile=😄 smiley=😃 grinning=😀 grin=😁 laughing=😆
  satisfied=😆 sweat_smile=😅 rolling_on_the_floor_laughing=🤣 rofl=🤣 slightly_smiling_face=🙂 upside_down_face=🙃
  wink=😉 blush=😊 innocent=😇 heart_eyes=😍 star-struck=🤩 kissing_heart=😘 kissing=😗 relaxed=☺️ yum=😋
  stuck_out_tongue=😛 stuck_out_tongue_winking_eye=😜 zany_face=🤪 money_mouth_face=🤑 hugging_face=🤗 hugs=🤗
  thinking_face=🤔 thinking=🤔 shushing_face=🤫 zipper_mouth_face=🤐 face_with_raised_eyebrow=🤨 neutral_face=😐
  expressionless=😑 no_mouth=😶 smirk=😏 unamused=😒 face_with_rolling_eyes=🙄 roll_eyes=🙄 grimacing=😬
  relieved=😌 pensive=😔 sleepy=😪 sleeping=😴 mask=😷 face_with_thermometer=🤒 nauseated_face=🤢
  sneezing_face=🤧 hot_face=🥵 cold_face=🥶 dizzy_face=😵 exploding_head=🤯 cowboy_hat_face=🤠 partying_face=🥳
  sunglasses=😎 nerd_face=🤓 face_with_monocle=🧐 confused=😕 worried=😟 slightly_frowning_face=🙁
  white_frowning_face=☹️ open_mouth=😮 hushed=😯 astonished=😲 flushed=😳 pleading_face=🥺 fearful=😨
  cold_sweat=😰 cry=😢 sob=😭 scream=😱 confounded=😖 persevere=😣 disappointed=😞 sweat=😓 weary=😩
  tired_face=😫 yawning_face=🥱 triumph=😤 rage=😡 angry=😠 skull=💀 poop=💩 hankey=💩 clown_face=🤡 ghost=👻
  alien=👽 robot_face=🤖 robot=🤖 smiling_face_with_3_hearts=🥰 melting_face=🫠 saluting_face=🫡
  face_with_hand_over_mouth=🤭 lying_face=🤥 drooling_face=🤤 face_vomiting=🤮 woozy_face=🥴
  smiling_face_with_tear=🥲 smiling_imp=😈 imp=👿 see_no_evil=🙈 hear_no_evil=🙉 speak_no_evil=🙊
  joy_cat=😹 smile_cat=😸 heart_eyes_cat=😻 scream_cat=🙀 crying_cat_face=😿 wave=👋 raised_back_of_hand=🤚
  hand=✋ raised_hand=✋ raised_hand_with_fingers_splayed=🖐️ vulcan_salute=🖖 ok_hand=👌 pinching_hand=🤏 v=✌️
  crossed_fingers=🤞 love_you_gesture=🤟 the_horns=🤘 call_me_hand=🤙 point_left=👈 point_right=👉
  point_up_2=👆 point_down=👇 point_up=☝️ fist=✊ facepunch=👊 punch=👊 raised_hands=🙌 clap=👏 open_hands=👐
  palms_up_together=🤲 handshake=🤝 pray=🙏 writing_hand=✍️ nail_care=💅 selfie=🤳 muscle=💪 eyes=👀 eye=👁️
  brain=🧠 ear=👂 nose=👃 tongue=👅 lips=👄 footprints=👣 bust_in_silhouette=👤 busts_in_silhouette=👥
  baby=👶 boy=👦 girl=👧 man=👨 woman=👩 older_man=👴 older_woman=👵 shrug=🤷 man-shrugging=🤷‍♂️
  woman-shrugging=🤷‍♀️ man_shrugging=🤷‍♂️ woman_shrugging=🤷‍♀️ face_palm=🤦 facepalm=🤦 man-facepalming=🤦‍♂️
  woman-facepalming=🤦‍♀️ bow=🙇 raising_hand=🙋 information_desk_person=💁 ok_woman=🙆 no_good=🙅 dancer=💃
  man_dancing=🕺 runner=🏃 walking=🚶 santa=🎅 angel=👼 superhero=🦸 ninja=🥷 technologist=🧑‍💻 mage=🧙
  zombie=🧟 orange_heart=🧡 yellow_heart=💛 green_heart=💚 blue_heart=💙 purple_heart=💜 black_heart=🖤
  white_heart=🤍 broken_heart=💔 two_hearts=💕 sparkling_heart=💖 heartpulse=💗 heartbeat=💓
  revolving_hearts=💞 cupid=💘 gift_heart=💝 heavy_heart_exclamation_mark_ornament=❣️ kiss=💋 love_letter=💌
  100=💯 anger=💢 boom=💥 collision=💥 dizzy=💫 sweat_drops=💦 dash=💨 zzz=💤 speech_balloon=💬
  thought_balloon=💭 fire=🔥 sparkles=✨ star=⭐ star2=🌟 zap=⚡ rainbow=🌈 sunny=☀️ cloud=☁️ umbrella=☔
  snowflake=❄️ snowman=⛄ droplet=💧 ocean=🌊 earth_americas=🌎 earth_africa=🌍 globe_with_meridians=🌐
  crescent_moon=🌙 full_moon=🌕 sun_with_face=🌞 sunrise=🌅 rocket=🚀 airplane=✈️ car=🚗 bike=🚲 ship=🚢
  house=🏠 office=🏢 tada=🎉 party_popper=🎉 confetti_ball=🎊 balloon=🎈 gift=🎁 birthday=🎂 fireworks=🎆
  christmas_tree=🎄 jack_o_lantern=🎃 trophy=🏆 medal=🏅 first_place_medal=🥇 soccer=⚽ basketball=🏀
  dart=🎯 video_game=🎮 game_die=🎲 jigsaw=🧩 musical_note=🎵 notes=🎶 microphone=🎤 headphones=🎧 guitar=🎸
  art=🎨 clapper=🎬 movie_camera=🎥 camera=📷 tv=📺 computer=💻 keyboard=⌨️ desktop_computer=🖥️ iphone=📱
  phone=☎️ telephone_receiver=📞 battery=🔋 electric_plug=🔌 bulb=💡 flashlight=🔦 wrench=🔧 hammer=🔨
  hammer_and_wrench=🛠️ gear=⚙️ nut_and_bolt=🔩 toolbox=🧰 magnet=🧲 link=🔗 paperclip=📎 pushpin=📌
  round_pushpin=📍 scissors=✂️ lock=🔒 unlock=🔓 key=🔑 shield=🛡️ mag=🔍 mag_right=🔎 memo=📝 pencil=📝
  pencil2=✏️ page_facing_up=📄 page_with_curl=📃 bookmark_tabs=📑 clipboard=📋 calendar=📆 date=📅
  spiral_calendar_pad=🗓️ card_index=📇 chart_with_upwards_trend=📈 chart_with_downwards_trend=📉
  bar_chart=📊 file_folder=📁 open_file_folder=📂 books=📚 book=📖 notebook=📓 ledger=📒 newspaper=📰
  email=📧 e-mail=📧 envelope=✉️ inbox_tray=📥 outbox_tray=📤 package=📦 mailbox=📫 moneybag=💰 dollar=💵
  euro=💶 credit_card=💳 hourglass=⌛ hourglass_flowing_sand=⏳ alarm_clock=⏰ stopwatch=⏱️ watch=⌚
  coffee=☕ tea=🍵 beer=🍺 beers=🍻 wine_glass=🍷 cocktail=🍸 champagne=🍾 clinking_glasses=🥂 pizza=🍕
  hamburger=🍔 fries=🍟 taco=🌮 burrito=🌯 sushi=🍣 ramen=🍜 cake=🍰 doughnut=🍩 cookie=🍪 chocolate_bar=🍫
  popcorn=🍿 apple=🍎 banana=🍌 avocado=🥑 croissant=🥐 bread=🍞 cheese_wedge=🧀 egg=🥚
  white_check_mark=✅ heavy_check_mark=✔️ ballot_box_with_check=☑️ x=❌ negative_squared_cross_mark=❎
  heavy_multiplication_x=✖️ heavy_plus_sign=➕ heavy_minus_sign=➖ warning=⚠️ no_entry=⛔ no_entry_sign=🚫
  stop_sign=🛑 construction=🚧 rotating_light=🚨 exclamation=❗ heavy_exclamation_mark=❗ question=❓
  grey_question=❔ bangbang=‼️ interrobang=⁉️ red_circle=🔴 large_blue_circle=🔵 large_green_circle=🟢
  large_yellow_circle=🟡 white_circle=⚪ black_circle=⚫ arrow_right=➡️ arrow_left=⬅️ arrow_up=⬆️
  arrow_down=⬇️ arrows_counterclockwise=🔄 repeat=🔁 new=🆕 free=🆓 ok=🆗 cool=🆒 sos=🆘 top=🔝 soon=🔜
  recycle=♻️ information_source=ℹ️ bell=🔔 no_bell=🔕 loudspeaker=📢 mega=📣 mute=🔇 loud_sound=🔊
  checkered_flag=🏁 triangular_flag_on_post=🚩 crown=👑 gem=💎 ring=💍 eyeglasses=👓 dark_sunglasses=🕶️
  necktie=👔 mortar_board=🎓 briefcase=💼 shopping_trolley=🛒 moyai=🗿 crystal_ball=🔮 pill=💊 dna=🧬
  microscope=🔬 telescope=🔭 satellite=📡 test_tube=🧪 abacus=🧮 bomb=💣 hole=🕳️ scales=⚖️ broom=🧹
  thermometer=🌡️ dog=🐶 cat=🐱 mouse=🐭 rabbit=🐰 fox_face=🦊 bear=🐻 panda_face=🐼 koala=🐨 tiger=🐯
  lion_face=🦁 cow=🐮 pig=🐷 frog=🐸 monkey_face=🐵 chicken=🐔 penguin=🐧 bird=🐦 unicorn_face=🦄 bee=🐝
  honeybee=🐝 bug=🐛 butterfly=🦋 snail=🐌 turtle=🐢 snake=🐍 octopus=🐙 whale=🐳 dolphin=🐬 fish=🐟 crab=🦀
  sloth=🦥 seedling=🌱 evergreen_tree=🌲 deciduous_tree=🌳 palm_tree=🌴 cactus=🌵 herb=🌿
  four_leaf_clover=🍀 maple_leaf=🍁 fallen_leaf=🍂 tulip=🌷 rose=🌹 sunflower=🌻 cherry_blossom=🌸
  bouquet=💐 mushroom=🍄 zero=0️⃣ one=1️⃣ two=2️⃣ three=3️⃣ four=4️⃣ five=5️⃣ six=6️⃣ seven=7️⃣ eight=8️⃣
  nine=9️⃣ keycap_ten=🔟 hash=#️⃣`
    .split(/\s+/)
    .filter(Boolean)
    .map((pair) => {
      const at = pair.indexOf("=");
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
);
