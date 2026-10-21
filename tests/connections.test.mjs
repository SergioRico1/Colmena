import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {Connections, reviewKind} from '../server/connections.mjs';
import {Store} from '../server/store.mjs';
import {Runtime} from '../server/runtime.mjs';
import {createApp} from '../server/app.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'colmena-connectors-'));
  const store = new Store(dir), effects = [];
  let kind = 'read';
  const hub = {dispatch: async (_profile, op, args) => {
    if (op === 'status') return {configured: true, provider: 'Composio'};
    if (op === 'prepare') return {proposal: 'private-proposal', tool: args.tool, toolkit: 'gmail', name: 'Consultar correo',
      account: args.account, account_alias: 'Personal', arguments: JSON.parse(args.arguments_json),
      read_scope: kind === 'read' ? 'gmail-read-v1' : null, read_grant: kind === 'read' ? 'grant-account1' : null};
    if (op === 'commit') {effects.push(args); return {ok: true, data: {messages: []}};}
    return {};
  }};
  const connections = new Connections(store, hub);
  const runtime = new Runtime(store, {respond: async () => ({output: [], text: 'Listo'})}, connections);
  const mission = runtime.create({prompt: 'Consulta mi correo', botIds: ['nora']});
  const step = runtime.steps(mission.id)[0];
  t.after(async () => {await runtime.shutdown(); store.close(); await rm(dir, {recursive: true, force: true});});
  const call = (callId = 'call1') => ({call_id: callId, name: 'apps_execute', arguments: JSON.stringify({tool: kind === 'read' ? 'GMAIL_FETCH_EMAILS' : 'GMAIL_SEND_EMAIL', account: 'account1', arguments_json: kind === 'read' ? '{}' : JSON.stringify({recipient_email: 'fixture@example.invalid', subject: 'Fixture', body: 'Fixture only'})})});
  const request = (id) => runtime.tool(mission, step, call(id), new AbortController().signal);
  return {store, runtime, connections, effects, request, mission, step, setKind: k => kind = k};
}
test('connector tool waits for exact review, private capability never enters public approval, only commits once', async t => {
  const f = await fixture(t); assert.deepEqual(await f.request(), {waiting: true});
  const a = f.store.list('approvals')[0];
  assert.equal(JSON.stringify(a).includes('private-proposal'), false); assert.equal(f.effects.length, 0);
  assert.throws(() => f.runtime.approve(a.id, 'approved'), /diálogo/);
  await assert.rejects(f.connections.decide(a.id, {decision: 'approved', revision: 'wrong'}));
  const review = await f.connections.review(a.id);
  await f.connections.decide(a.id, {decision: 'approved', revision: review.revision});
  await assert.rejects(f.connections.decide(a.id, {decision: 'approved', revision: review.revision}));
  assert.equal((await f.request()).ok, true); assert.equal(f.effects.length, 1);
});
test('remembered reads cover only whitelisted account scope; sends still require human review', async t => {
  const f = await fixture(t); await f.request(); const a = f.store.list('approvals')[0];
  const review = await f.connections.review(a.id);
  await f.connections.decide(a.id, {decision: 'approved', revision: review.revision, remember: true});
  assert.equal((await f.request('second')).ok, true); assert.equal(f.effects.length, 2);
  f.setKind('send'); assert.deepEqual(await f.request('third'), {waiting: true});
  const send = f.store.list('approvals').find(a => a.kind === 'send'); const sr = await f.connections.review(send.id);
  await assert.rejects(f.connections.decide(send.id, {decision: 'approved', revision: sr.revision, remember: true}), /siempre/);
  assert.equal(f.effects.length, 2);
});
test('denial and cancelled mission prevent effects; revoking an account clears remembered grants', async t => {
  const f = await fixture(t); await f.request(); const a = f.store.list('approvals')[0];
  await f.connections.decide(a.id, {decision: 'denied'});
  assert.equal((await f.request()).denied, true); assert.equal(f.effects.length, 0);
  await f.request('cancel'); f.runtime.stop(f.mission.id, true);
  await assert.rejects(f.connections.review(f.step.id + ':cancel'), /misión/);
  f.store.put('connectionGrants', {id: 'g', active: true});
  await f.connections.manage('disconnect', {account: 'account1'});
  assert.equal(f.store.get('connectionGrants', 'g').active, false);
});
test('restart never replays an external effect that was in flight', async t => {
  const f = await fixture(t); await f.request(); const a = f.store.list('approvals')[0];
  f.store.patch('approvals', a.id, {status: 'executing'});
  new Connections(f.store, f.connections.hub);
  assert.equal((await f.request()).uncertain, true); assert.equal(f.effects.length, 0);
});
test('mission resumes from connector approval and receives its result exactly once', async t => {
  const f = await fixture(t);
  f.store.patch('settings', 'main', {model: 'fixture', learning: false});
  let turns = 0;
  f.runtime.provider = {respond: async request => {
    turns++;
    assert.ok(request.tools.some(t => t.name === 'apps_execute'));
    if (turns === 1) return {text: '', output: [{type: 'function_call', call_id: 'integration', name: 'apps_execute', arguments: JSON.stringify({tool: 'GMAIL_FETCH_EMAILS', account: 'account1', arguments_json: '{}'})}]};
    assert.equal(request.input.filter(x => x.type === 'function_call_output').length, 1);
    return {text: 'Consulta completada.', output: []};
  }};
  await f.runtime.launch(f.mission.id);
  assert.equal(f.store.get('missions', f.mission.id).status, 'waiting');
  const a = f.store.list('approvals')[0];
  f.store.patch('approvals', a.id, {status: 'executing'});
  await f.runtime.launch(f.mission.id);
  assert.equal(f.store.get('missions', f.mission.id).status, 'waiting');
  assert.equal(turns, 1);
  f.store.patch('approvals', a.id, {status: 'pending'});
  const review = await f.connections.review(a.id);
  await f.connections.decide(a.id, {decision: 'approved', revision: review.revision});
  await f.runtime.launch(f.mission.id);
  assert.equal(f.store.get('missions', f.mission.id).status, 'completed');
  assert.equal(turns, 2); assert.equal(f.effects.length, 1);
});
test('02b covers CC/BCC; a Gmail send with HTML or attachments fails closed; other changes are reviewable writes', () => {
  const base = {tool: 'GMAIL_SEND_EMAIL', arguments: {recipient_email: 'fixture@example.invalid', subject: 's', body: 'b'}};
  assert.equal(reviewKind(base), 'send');
  assert.equal(reviewKind({...base,arguments:{...base.arguments,cc:['copy@example.invalid'],bcc:['hidden@example.invalid']}}),'send');
  for (const p of [{...base, arguments: {...base.arguments, attachments: ['private.pdf']}}, {...base, arguments: {...base.arguments, is_html: true}}])
    assert.throws(() => reviewKind(p), /revis/);
  // A change in your own account (an event without guests) is a write the bot can be allowed to do.
  assert.equal(reviewKind({...base, tool: 'GOOGLECALENDAR_CREATE_EVENT', toolkit: 'googlecalendar', arguments: {summary: 'x'}}), 'write');
});

test('editing a send persists exact new fields, revokes the old approval and never sends',async t=>{
  const f=await fixture(t);f.setKind('send');await f.request();const a=f.store.list('approvals')[0];const old=await f.connections.review(a.id);
  const edited=await f.connections.edit(a.id,{revision:old.revision,to:['changed@example.invalid'],cc:['copy@example.invalid'],cco:['hidden@example.invalid'],subject:'Changed',body:'Exact edited body'});
  assert.notEqual(edited.revision,old.revision);assert.equal(f.effects.length,0);
  assert.equal(edited.review.arguments.body,'Exact edited body');assert.deepEqual(edited.review.arguments.bcc,['hidden@example.invalid']);
  await assert.rejects(f.connections.decide(a.id,{decision:'approved',revision:old.revision}),/revisión/);
  await assert.rejects(f.connections.edit(a.id,{revision:old.revision,to:[],cc:[],cco:[],subject:'stale',body:'stale'}),/revisión/);
  await f.connections.decide(a.id,{decision:'approved',revision:edited.revision});assert.equal(f.effects.length,1);
  await assert.rejects(f.connections.edit(a.id,{revision:edited.revision,to:[],cc:[],cco:[],subject:'late',body:'late'}),/pendiente/);
});
test('public API has no credential configuration or generic commit endpoint, and masks provider identity', async t => {
  const f = await fixture(t); let origin;
  const server = http.createServer(createApp({store: f.store, runtime: f.runtime, connections: f.connections,
    session: {status: () => null, models: []}, getOrigin: () => origin}));
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {server.closeAllConnections(); await new Promise(r => server.close(r));});
  assert.deepEqual(await (await fetch(origin + '/api/connections/status')).json(), {available: true});
  const {csrf} = await (await fetch(origin + '/api/bootstrap')).json();
  for (const op of ['configure', 'commit', 'prepare']) {
    const response = await fetch(origin + '/api/connections/' + op, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Colmena-Token': csrf}, body: '{}'});
    assert.equal(response.status, 404);
  }
});
