import { randomUUID } from 'node:crypto';
import { now } from './store.mjs';
import { deniedResult } from './denial.mjs';

import { TOOLKITS } from './triggers.mjs';
import { asksForSelf, explicitlyAsked, namesFor, saysSend } from './appactions.mjs';
import { draftFields } from './gmaildrafts.mjs';

// A send you asked for in so many words leaves on its own after this long (cancel in the chat).
export const AUTO_SEND_MS = 10000;
// A Gmail send as it can be reviewed: optional fields left empty are dropped.
const SEND_KEYS = ['recipient_email', 'subject', 'body', 'user_id', 'is_html', 'cc', 'bcc', 'extra_recipients', 'include_signature'];
const sendArgs = (args = {}) => Object.fromEntries(Object.entries(args).filter(([, v]) => !(v === null || v === '' || v === false || (Array.isArray(v) && !v.length))));
// A reply in its thread, reviewed like any send (the subject is the thread's own).
const REPLY_KEYS = ['thread_id', 'recipient_email', 'message_body', 'user_id', 'is_html', 'cc', 'bcc', 'extra_recipients', 'include_signature'];
const REPLY_SUBJECT = /^\s*(re|rv|fw|fwd|reenviado)\s*:/i;
const recipientsOf = (args = {}) => [args.recipient_email, args.extra_recipients, args.cc, args.bcc].flatMap((v) => Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : []).map((x) => String(x).trim()).filter(Boolean);
// Gmail's own draft update can still drop the thread: say so instead of «updated».
function leftThread(a, result) {
  const want = String(a.review?.tool || '').toUpperCase() === 'GMAIL_UPDATE_DRAFT' && a.review?.arguments?.thread_id;
  const got = result?.ok && result.data?.message?.threadId;
  if (!want || !got || got === want) return result;
  return {...result, aviso: 'Gmail ha sacado el borrador de su hilo al cambiarlo. Créalo de nuevo en el hilo (GMAIL_CREATE_EMAIL_DRAFT con thread_id ' + want + ' y el asunto vacío) y dile a la persona que el borrador anterior, fuera del hilo, sigue en Borradores para que lo borre ella.'};
}
const parse = (s) => { try { return JSON.parse(s || '{}'); } catch { return {}; } };

// What a prepared app action is, so the right thing happens without a pointless question:
//  read  → looking at your data (search, list, get). Connecting the app already allowed it.
//  write → changing something in your own account (create an event, a note, a row).
//  send  → a Gmail send, reviewed and editable in full.
// redLine: it leaves your account or cannot be undone (send, reply, invite, share, publish,
// delete, pay, transfer): it always waits for your OK, whatever the bot may do.
const RED_LINE_TOOL = /(?:^|_)(?:SEND|REPLY|FORWARD|INVITE|SHARE|PUBLISH|POST|TWEET|DELETE|REMOVE|TRASH|DESTROY|PURGE|ARCHIVE|PAY|PAYOUT|CHARGE|REFUND|TRANSFER|PURCHASE|ORDER|CANCEL)(?:_|$)/;
const MESSAGE_TOOLKITS = new Set(['slack', 'microsoft_teams', 'discord', 'telegram', 'whatsapp', 'googlechat']);

/** Which «Qué app usa cada bot» column an app action belongs to (null: none of them). */
export function categoryOf(p) {
  const toolkit = String(p.toolkit || '').toLowerCase();
  const tool = String(p.tool || '').toUpperCase();
  if (/CALENDAR|EVENT/.test(tool) && TOOLKITS.calendario.includes(toolkit)) return 'calendario';
  for (const [key, list] of Object.entries(TOOLKITS)) if (list.includes(toolkit)) return key;
  return null;
}

/** {kind, redLine} of a prepared action. Throws only for a malformed Gmail send. */
export function classify(p) {
  const tool = String(p.tool || '').toUpperCase();
  const args = p.arguments || {};
  if (p.read_scope || (tool === 'GMAIL_GET_PROFILE' &&
      Object.keys(args).every(k => k === 'user_id') && (args.user_id ?? 'me') === 'me')) return {kind: 'read', redLine: false};
  if (tool === 'GMAIL_SEND_EMAIL') {
    // The direct tool fills every optional field («attachment: []», «from_email: ""»,
    // «include_signature: false»…): empty ones change nothing and are fine.
    const a = sendArgs(args);
    const bad = Object.keys(a).find(k => !SEND_KEYS.includes(k));
    if (a.attachment !== undefined) throw Error('Este envío lleva un adjunto, que no puedo enseñarte para revisarlo. Envíalo sin adjunto (attachment vacío) o prepara un borrador.');
    if (a.from_email !== undefined) throw Error('Este envío sale de otra dirección (from_email), que no puedo revisar contigo. Envíalo sin from_email.');
    if (a.is_html) throw Error('Escribe el cuerpo como texto normal (is_html: false) para que se pueda revisar.');
    // A new email titled «Re: …» lands outside the conversation it answers.
    if (REPLY_SUBJECT.test(String(a.subject || ''))) throw Error('Esto responde a un correo: envíalo con GMAIL_REPLY_TO_THREAD (thread_id del hilo, recipient_email y message_body) para que salga dentro de esa conversación, no como un correo nuevo.');
    if (!bad && ['recipient_email', 'subject', 'body'].every(k => typeof a[k] === 'string') &&
        ['cc', 'bcc', 'extra_recipients'].every(k => a[k] === undefined || Array.isArray(a[k]) && a[k].every(v => typeof v === 'string')) &&
        (a.user_id ?? 'me') === 'me') return {kind: 'send', redLine: true};
    throw Error('Este envío tiene un formato que no puedo revisar contigo' + (bad ? ` (campo «${bad}»)` : '') + '. Usa solo recipient_email, subject, body y, si hace falta, cc, bcc o extra_recipients.');
  }
  if (tool === 'GMAIL_REPLY_TO_THREAD') {
    const a = sendArgs(args);
    const bad = Object.keys(a).find(k => !REPLY_KEYS.includes(k));
    if (a.attachment !== undefined) throw Error('Esta respuesta lleva un adjunto, que no puedo enseñarte para revisarlo. Envíala sin adjunto o prepara un borrador.');
    if (a.is_html) throw Error('Escribe el cuerpo como texto normal (is_html: false) para que se pueda revisar.');
    if (!bad && ['thread_id', 'recipient_email', 'message_body'].every(k => typeof a[k] === 'string' && a[k].trim()) &&
        ['cc', 'bcc', 'extra_recipients'].every(k => a[k] === undefined || Array.isArray(a[k]) && a[k].every(v => typeof v === 'string')) &&
        (a.user_id ?? 'me') === 'me') return {kind: 'send', redLine: true};
    throw Error('Esta respuesta tiene un formato que no puedo revisar contigo' + (bad ? ` (campo «${bad}»)` : '') + '. Usa thread_id, recipient_email, message_body y, si hace falta, cc, bcc o extra_recipients.');
  }
  // A reply draft outside its thread is one the person will not find where they expect it.
  if (tool === 'GMAIL_CREATE_EMAIL_DRAFT' && REPLY_SUBJECT.test(String(args.subject || '')) && !args.thread_id)
    throw Error('Este borrador responde a un correo: añade el thread_id de ese hilo para que quede dentro de la conversación.');
  // Sending a draft is reviewed with the draft's own recipients and text (Connections#request).
  if (tool === 'GMAIL_SEND_DRAFT' && typeof args.draft_id === 'string' && (args.user_id ?? 'me') === 'me' &&
      Object.keys(sendArgs(args)).every(k => ['draft_id', 'user_id'].includes(k))) return {kind: 'send', redLine: true};
  // An event with guests notifies people outside your account.
  const guests = [args.attendees, args.attendee_emails, args.guests].some(v => Array.isArray(v) ? v.length : typeof v === 'string' && v.trim());
  const notifies = guests && !['none', 'false', false].includes(args.send_updates ?? args.sendUpdates ?? 'all');
  const redLine = RED_LINE_TOOL.test(tool) || notifies || (MESSAGE_TOOLKITS.has(String(p.toolkit || '').toLowerCase()) && /MESSAGE|CHAT/.test(tool));
  return {kind: 'write', redLine};
}
/** Kept for callers that only need the kind. */
export const reviewKind = (p) => classify(p).kind;

/**
 * Whether an action can run without asking, given what the bot may do in that app
 * (bot.tools[category]: none | lee | pide | escribe; undefined when the app has no column).
 * Connecting an app is the permission to read it; changing something needs «escribe».
 */
/** Grant id for «always» on a change in an app without a column (bot + account + action). */
const writeGrant = (botId, p) => 'write:' + botId + ':' + String(p.account || '').split(' · ').pop() + ':' + p.tool;

// A change that stays in your own account (a draft, an event without guests, a row) runs on
// its own where the bot may write, and in apps without a «Qué app usa cada bot» column;
// «Lee», «Pide para escribir» and «No» keep asking. Red lines always ask.
export function runsWithoutAsking({kind, redLine}, access) {
  if (redLine) return false;
  if (kind === 'read') return access !== 'none';
  return access === 'escribe' || access === undefined;
}

export class Connections {
  constructor(store, hub) {
    this.store = store;
    this.hub = hub;
    this.proposals = new Map();
    this.busy = new Set();
    for (const a of store.list('approvals')) {
      if (a.tool === 'apps_execute' && a.status === 'executing') {
        store.patch('approvals', a.id, {status: 'executed', result: {
          ok: false, uncertain: true, error: 'Colmena se cerró durante la acción. Comprueba el resultado en la app; no se repetirá.'
        }});
      }
    }
  }
  async call(op, args = {}) {
    try {
      const result = await this.hub.dispatch('default', op, args);
      if (typeof result?.error === 'string')
        result.error = result.error.replaceAll('Composio', 'el servicio de conexiones');
      return result;
    }
    catch (error) {
      if (/clave|configura|conecta composio/i.test(error.message))
        throw Error('El servicio de conexiones no está disponible. Contacta con el administrador.');
      throw Error(error.message.replaceAll('Composio', 'el servicio de conexiones'));
    }
  }
  async manage(op, args) {
    if (['configure', 'disconnect'].includes(op) && this.busy.size)
      throw Error('Espera a que termine la acción en curso.');
    const result = await this.call(op, args);
    if (['configure', 'disconnect'].includes(op)) {
      this.proposals.clear();
      for (const g of this.store.list('connectionGrants'))
        this.store.patch('connectionGrants', g.id, {active: false});
    }
    return result;
  }
  current(id) {
    const a = this.store.get('approvals', id);
    if (!a || a.tool !== 'apps_execute') throw Error('Solicitud de conexión no encontrada.');
    const mission = this.store.get('missions', a.missionId);
    if (!mission || ['cancelled', 'completed'].includes(mission.status))
      throw Error('La misión ya no admite esta acción.');
    return a;
  }
  async request(mission, step, call, args, signal) {
    const id = step.id + ':' + call.call_id;
    let a = this.store.get('approvals', id);
    if (a?.status === 'executed') return a.result;
    if (a?.status === 'denied') return deniedResult(a);
    if (!a) {
      args = await this.keepDraftThread(mission, args);
      const p = await this.call('prepare', {...args, scope: mission.id});
      let kind, redLine;
      try { ({kind, redLine} = classify(p)); } catch (e) {
        await this.call('discard', {proposal: p.proposal}); throw e;
      }
      signal.throwIfAborted();
      const {proposal, ...review} = p;
      // «Envíalo» on a draft: you review who it goes to and what it says, as with any send.
      if (String(p.tool).toUpperCase() === 'GMAIL_SEND_DRAFT') {
        const d = await this.readDraft(mission, args.account, p.arguments?.draft_id);
        if (d?.to.length) review.draft = {to: d.to, cc: d.cc, subject: d.subject, body: d.body, thread: d.threadId};
        else kind = 'write';
      }
      // A reply shows the conversation it goes into (it has no subject of its own).
      if (String(p.tool).toUpperCase() === 'GMAIL_REPLY_TO_THREAD') {
        const t = await this.readGmail(mission, args.account, 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID', {user_id: 'me', thread_id: p.arguments?.thread_id});
        if (t?.subject) review.thread = {subject: /^\s*re\s*:/i.test(t.subject) ? t.subject : 'Re: ' + t.subject};
      }
      const category = categoryOf(p);
      a = this.store.put('approvals', {id, missionId: mission.id, botId: step.botId,
        tool: 'apps_execute', args, review, kind, redLine, category, status: 'pending', createdAt: now()});
      const ticket = {proposal, revision: randomUUID(), expiresAt: Date.now() + 110000};
      this.proposals.set(id, ticket);
      const access = category ? this.store.get('bots', step.botId)?.tools?.[category] : undefined;
      const granted = kind === 'read' ? this.store.get('connectionGrants', review.read_grant)?.active
        : !redLine && this.store.get('connectionGrants', writeGrant(step.botId, p))?.active;
      if (granted || runsWithoutAsking({kind, redLine}, access))
        return this.decide(id, {decision: 'approved', revision: ticket.revision, remember: false, auto: true});
      if (kind === 'send') {
        const to = review.draft ? [...review.draft.to, ...review.draft.cc] : recipientsOf(review.arguments);
        // «Envíalo» about the draft it prepared here, which you have seen: that is the OK.
        const ownDraft = review.draft && this.preparedHere(mission.id, p.arguments?.draft_id);
        const asked = ownDraft ? saysSend(this.store, mission.id)
          : explicitlyAsked(this.store, mission.id, to, {names: namesFor(this.store, step.id, to)}) ||
            // «Envíamelo»: to yourself, as Codex does, with no second OK.
            (asksForSelf(this.store, mission.id) && await this.isOwnAddress(mission, args.account, to));
        if (asked) this.autoSend(id);
      }
      this.store.event(mission.id, 'approval_requested', {botId: step.botId, text: p.name});
    }
    return {waiting: true};
  }
  /**
   * One read, run at once (apps_table walks dozens of emails or rows): only for an action
   * that only looks, and only when the bot may read that app. Nothing is stored as an
   * approval — reading never asks — and anything else is refused, never executed.
   */
  async readNow(mission, step, args) {
    const p = await this.call('prepare', {...args, scope: mission.id});
    let kind = 'write', redLine = true;
    try { ({kind, redLine} = classify(p)); } catch {}
    const category = categoryOf(p);
    const access = category ? this.store.get('bots', step.botId)?.tools?.[category] : undefined;
    // Gmail and Calendar reads are vetted lists; elsewhere the action's own name must only look.
    const tool = String(p.tool || '').toUpperCase();
    const looks = kind === 'read' || (!redLine && /_(FETCH|LIST|GET|FIND|SEARCH|BATCH_GET|READ|QUERY)/.test(tool) && !/_(CREATE|UPDATE|INSERT|ADD|MOVE|DRAFT|SET|PATCH|WRITE|APPEND|CLEAR|RENAME|COPY|UPLOAD)/.test(tool));
    if (!looks || access === 'none') {
      await this.call('discard', {proposal: p.proposal}).catch(() => {});
      throw Error(!looks ? 'apps_table solo puede leer: esa acción cambia algo.' : 'Este bot no puede leer esa app («Qué app usa cada bot»).');
    }
    return this.call('commit', {proposal: p.proposal});
  }
  /** Whether a bot created or changed this Gmail draft in this mission. */
  preparedHere(missionId, draftId) {
    if (!draftId) return false;
    return this.store.where('approvals', 'missionId', missionId).some((x) => x.status === 'executed' && x.result?.ok &&
      ['GMAIL_CREATE_EMAIL_DRAFT', 'GMAIL_UPDATE_DRAFT'].includes(String(x.review?.tool || '').toUpperCase()) &&
      (x.result?.data?.id === draftId || x.review?.arguments?.draft_id === draftId));
  }
  /** One vetted Gmail read, raw ({ok, data}) or null; never anything that changes mail. */
  async readGmailRaw(mission, account, tool, json) {
    try {
      const p = await this.call('prepare', {tool, account, arguments_json: JSON.stringify(json), scope: mission.id});
      if (classify(p).kind !== 'read') { await this.call('discard', {proposal: p.proposal}).catch(() => {}); return null; }
      const r = await this.call('commit', {proposal: p.proposal});
      return r?.ok ? r : null;
    } catch { return null; }
  }
  /** {to, cc, subject, body, threadId, messageId} of a draft or thread read, or null. */
  async readGmail(mission, account, tool, json) {
    const r = await this.readGmailRaw(mission, account, tool, json);
    return r ? draftFields(r.data) : null;
  }
  /** A Gmail draft as it stands, or null. */
  readDraft(mission, account, draftId) {
    if (typeof draftId !== 'string' || !draftId) return Promise.resolve(null);
    return this.readGmail(mission, account, 'GMAIL_GET_DRAFT', {user_id: 'me', draft_id: draftId, format: 'full'});
  }
  /** Whether every recipient is the address of that Gmail account itself. */
  async isOwnAddress(mission, account, to = []) {
    if (!to.length) return false;
    const r = await this.readGmailRaw(mission, account, 'GMAIL_GET_PROFILE', {user_id: 'me'});
    const own = String(r?.data?.emailAddress || r?.data?.email_address || '').trim().toLowerCase();
    return !!own && to.every((x) => (String(x).match(/[^<\s]+@[^>\s]+/)?.[0] || '').toLowerCase() === own);
  }
  /**
   * Gmail's update replaces the whole draft: without thread_id a reply draft leaves its
   * conversation (and the person no longer finds it there). It keeps the thread it was in.
   */
  async keepDraftThread(mission, args) {
    if (String(args?.tool || '').toUpperCase() !== 'GMAIL_UPDATE_DRAFT') return args;
    const json = parse(args.arguments_json);
    if (json.thread_id || !json.draft_id) return args;
    const d = await this.readDraft(mission, args.account, json.draft_id);
    if (!d?.threadId || d.threadId === d.messageId) return args;
    return {...args, arguments_json: JSON.stringify({...json, thread_id: d.threadId})};
  }
  /** You asked for this send yourself: it goes in AUTO_SEND_MS unless you cancel it (denied). */
  autoSend(id) {
    const at = Date.now() + AUTO_SEND_MS;
    this.store.patch('approvals', id, {autoSendAt: new Date(at).toISOString(), askedByYou: true});
    clearTimeout(this.timers?.get(id));
    this.timers ??= new Map();
    this.timers.set(id, setTimeout(async () => {
      this.timers.delete(id);
      const a = this.store.get('approvals', id);
      if (!a || a.status !== 'pending' || !a.autoSendAt) return;
      try {
        const {revision} = await this.review(id);
        await this.decide(id, {decision: 'approved', revision, auto: true});
        this.onDecided?.(a.missionId);
      } catch (e) {
        // Could not leave on its own (expired, edited…): it waits for you as any other send.
        this.store.patch('approvals', id, {autoSendAt: null, autoError: e.message});
      }
    }, AUTO_SEND_MS).unref?.() ?? null);
  }
  async review(id) {
    const a = this.current(id);
    if (a.status !== 'pending') return {status: a.status, result: a.result};
    let ticket = this.proposals.get(id);
    if (!ticket || ticket.expiresAt < Date.now()) {
      const p = await this.call('prepare', {...a.args, scope: a.missionId});
      const kind = reviewKind(p);
      const {proposal, ...review} = p;
      // A draft send keeps the draft it showed you.
      if (a.review?.draft) review.draft = a.review.draft;
      this.store.patch('approvals', id, {review, kind: a.review?.draft ? 'send' : kind});
      ticket = {proposal, revision: randomUUID(), expiresAt: Date.now() + 110000};
      this.proposals.set(id, ticket);
    }
    const fresh = this.current(id);
    return {id, status: fresh.status, kind: fresh.kind, review: fresh.review,
      revision: ticket.revision, expiresAt: ticket.expiresAt};
  }
  async decide(id, {decision, revision, remember = false, auto = false}) {
    if (this.busy.has(id)) throw Error('Esta acción ya se esta resolviendo.');
    const a = this.current(id);
    if (a.status !== 'pending') throw Error('Esta solicitud ya está resuelta.');
    const ticket = this.proposals.get(id);
    clearTimeout(this.timers?.get(id));
    if (a.autoSendAt) this.store.patch('approvals', id, {autoSendAt: null});
    if (decision === 'denied') {
      this.store.patch('approvals', id, {status: 'denied', decidedAt: now()});
      this.proposals.delete(id);
      if (ticket) await this.call('discard', {proposal: ticket.proposal});
      return {denied: true};
    }
    if (!ticket || ticket.revision !== revision || ticket.expiresAt < Date.now())
      throw Error('La revisión caducó. Abre de nuevo la solicitud antes de aprobar.');
    if (remember && (a.redLine || a.kind === 'send')) throw Error('Esto te lo preguntará siempre: sale de tu cuenta o no se puede deshacer.');
    this.busy.add(id);
    this.proposals.delete(id);
    // Durable intent precedes the network effect. A crash must never replay it.
    this.store.patch('approvals', id, {status: 'executing', decidedAt: now(), decidedBy: auto ? 'automático' : 'tú'});
    let result;
    try {
      result = await this.call('commit', {proposal: ticket.proposal});
      result = leftThread(a, result);
      if (remember && result.ok) this.remember(a);
    } catch (e) { result = {ok: false, error: e.message}; }
    finally { this.busy.delete(id); }
    this.store.patch('approvals', id, {status: 'executed', result});
    this.store.event(a.missionId, 'connection_result', {botId: a.botId,
      text: result.ok ? 'Accion completada en ' + a.review.toolkit : result.error || 'Resultado sin confirmar'});
    return result;
  }
  // «Siempre»: a read is remembered for that account and scope; a change in an app with a
  // «Qué app usa cada bot» column gives the bot «escribe» there; any other change is
  // remembered for that bot, account and action.
  remember(a) {
    if (a.kind === 'read') {
      if (a.review.read_grant) this.store.put('connectionGrants', {id: a.review.read_grant, active: true, createdAt: now()});
      // A bot with no access to that app now reads it for good (it keeps asking to change it).
      if (a.category && a.botId && (this.store.get('bots', a.botId)?.tools?.[a.category] || 'none') === 'none')
        this.store.patch('bots', a.botId, (old) => ({tools: {...(old.tools || {}), [a.category]: 'lee'}}));
      return;
    }
    if (a.category && a.botId && this.store.get('bots', a.botId)) {
      this.store.patch('bots', a.botId, (old) => ({tools: {...(old.tools || {}), [a.category]: 'escribe'}}));
      return;
    }
    this.store.put('connectionGrants', {id: writeGrant(a.botId, a.review), active: true, kind: 'write', botId: a.botId, tool: a.review.tool, createdAt: now()});
  }
  async edit(id, {revision, to, cc, cco, subject, body}) {
    if (this.busy.has(id)) throw Error('Esta acción ya se esta resolviendo.');
    const a=this.current(id), old=this.proposals.get(id);
    if (a.status !== 'pending' || a.kind !== 'send') throw Error('Solo puedes editar un envio pendiente.');
    // Editing it means you are reviewing it: it no longer leaves on its own.
    clearTimeout(this.timers?.get(id));
    if (a.autoSendAt) this.store.patch('approvals', id, {autoSendAt: null});
    if (!old || old.revision !== revision || old.expiresAt < Date.now()) throw Error('La revisión caducó. Vuelve a abrir el envio.');
    this.busy.add(id);
    let prepared;
    try {
      const tool=String(a.review.tool||'').toUpperCase();
      if(tool==='GMAIL_SEND_DRAFT') throw Error('Es un borrador de Gmail: cámbialo en Gmail o pídeselo al bot, y luego envíalo.');
      // A reply keeps its thread and its subject; only who it goes to and the text change.
      const argumentsValue=tool==='GMAIL_REPLY_TO_THREAD'?{...a.review.arguments,recipient_email:to.join(', '),message_body:body}:{...a.review.arguments,recipient_email:to.join(', '),subject,body};
      // «Para» in the editor already lists everyone (extra_recipients included).
      delete argumentsValue.cc; delete argumentsValue.bcc; delete argumentsValue.extra_recipients;
      if(cc.length)argumentsValue.cc=cc;
      if(cco.length)argumentsValue.bcc=cco;
      const args={...a.args,arguments_json:JSON.stringify(argumentsValue)};
      prepared=await this.call('prepare',{...args,scope:a.missionId});
      const kind=reviewKind(prepared);
      if(kind!=='send' || this.current(id).status!=='pending' || this.proposals.get(id)!==old) throw Error('La solicitud cambio mientras editabas. Vuelve a abrirla.');
      const {proposal,...review}=prepared;
      this.store.patch('approvals',id,{args,review,kind,editedAt:now()});
      this.proposals.set(id,{proposal,revision:randomUUID(),expiresAt:Date.now()+110000});
      await this.call('discard',{proposal:old.proposal});
      this.store.event(a.missionId,'send_edited',{botId:a.botId,text:'Borrador corregido por el usuario. Todavia sin enviar.'});
      return await this.review(id);
    } catch(error) {
      if(prepared?.proposal && this.proposals.get(id)?.proposal!==prepared.proposal) await this.call('discard',{proposal:prepared.proposal});
      throw error;
    } finally {this.busy.delete(id);}
  }
}
