import http from 'node:http';
import express from 'express';
import {mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../server/store.mjs';
import {Runtime} from '../server/runtime.mjs';
import {Connections} from '../server/connections.mjs';
import {createApp} from '../server/app.mjs';

// Disposable local fixture: no credentials, provider, external requests or user data.
const directory = await mkdtemp(path.join(os.tmpdir(), 'colmena-connections-ui-'));
const store = new Store(directory), calls = [];
let alias = 'Personal', connected = true;
const hub = {dispatch: async (_profile, op, a = {}) => {
  calls.push({op, a});
  if (op === 'status') return {configured: true};
  if (op === 'accounts') return {items: connected ? [{id: 'fixture-account', toolkit: 'gmail', alias, status: 'ACTIVE'}] : [], next_cursor: null};
  if (op === 'catalogue') return {items: [{slug: 'googlecalendar', name: 'Google Calendar', description: 'Calendario de prueba'}], next_cursor: null};
  if (op === 'rename') {alias = a.alias; return {renamed: true};}
  if (op === 'disconnect') {connected = false; return {disconnected: true};}
  if (op === 'link') throw Error('Fixture: no se abre autorizacion externa.');
  if (op === 'prepare') return {proposal: 'fixture-proposal', tool: a.tool, toolkit: 'gmail', account: 'fixture-account', account_alias: alias,
    name: a.tool === 'GMAIL_SEND_EMAIL' ? 'Enviar correo de prueba' : 'Consultar correo de prueba', arguments: JSON.parse(a.arguments_json),
    read_scope: a.tool === 'GMAIL_FETCH_EMAILS' ? 'gmail-read-v1' : null, read_grant: 'fixture-read-grant'};
  if (op === 'commit') return {ok: true, data: {fixture: true}};
  return {};
}};
const connections = new Connections(store, hub);
const runtime = new Runtime(store, {respond: async () => ({output: [], text: 'Respuesta de prueba'})}, connections);
const mission = runtime.create({prompt: 'Fixture aislado', botIds: ['nora']});
store.patch('settings', 'main', {learning: false});
const step = runtime.steps(mission.id)[0];
for (const [id, tool, args] of [
  ['read', 'GMAIL_FETCH_EMAILS', {query: 'is:unread'}],
  ['send', 'GMAIL_SEND_EMAIL', {recipient_email: 'hotel@example.invalid', subject: 'Llegada tarde', body: 'Hola. Llegaremos a las 23:00. ¿Habrá alguien en recepción?'}]
]) await connections.request(mission, step, {call_id: id}, {tool, account: 'fixture-account', arguments_json: JSON.stringify(args)}, new AbortController().signal);
let origin;
const app = createApp({store, runtime, connections, session: {models: [], status: () => null}, getOrigin: () => origin});
app.get('/fixture-state', (_req, res) => res.json({calls, approvals: store.list('approvals')}));
app.use(express.static('dist'));
const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
origin = 'http://127.0.0.1:' + server.address().port;
console.log(JSON.stringify({origin, read: step.id + ':read', send: step.id + ':send', directory, pid: process.pid}));
async function close() {await runtime.shutdown(); server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); await rm(directory, {recursive: true, force: true}); process.exit(0);}
process.on('SIGTERM', close); process.on('SIGINT', close);
