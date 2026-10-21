import test from "node:test";
import assert from "node:assert/strict";
import { transcriptionAvailable, decodeAudio, transcribe, audioType, MAX_AUDIO_BYTES, OPENAI_TRANSCRIPTIONS } from "../server/voice.mjs";

const hub = (apikey = { hint: "abcd" }, key = "sk-test-123") => ({ config: () => ({ apikey }), loadKey: async () => key });
const audio = Buffer.from("fake opus audio bytes").toString("base64");

test("transcription is offered only with a saved OpenAI API key", () => {
  assert.equal(transcriptionAvailable(null), false);
  assert.equal(transcriptionAvailable({ respond() {} }), false, "plain ChatGPT provider");
  assert.equal(transcriptionAvailable(hub(null)), false, "hub without a key");
  assert.equal(transcriptionAvailable(hub()), true);
  assert.equal(transcriptionAvailable({ config: () => { throw Error("x"); }, loadKey() {} }), false);
});

test("audio is checked: format, size (≤ 2 min) and base64", () => {
  assert.deepEqual(audioType("audio/webm;codecs=opus"), { mime: "audio/webm", ext: "webm" });
  assert.equal(audioType("video/mp4"), null);
  assert.throws(() => decodeAudio({ audio, mime: "text/plain" }), /formato/);
  assert.throws(() => decodeAudio({ audio, mime: "audio/webm", durationMs: 200000 }), /2 minutos/);
  assert.throws(() => decodeAudio({ audio: "%%%", mime: "audio/webm" }), /No se recibió/);
  assert.throws(() => decodeAudio({ audio: Buffer.alloc(MAX_AUDIO_BYTES + 10).toString("base64"), mime: "audio/webm" }), /demasiado largo/);
  const ok = decodeAudio({ audio: "data:audio/webm;base64," + audio, mime: "audio/webm", durationMs: 4000 });
  assert.equal(ok.bytes.toString(), "fake opus audio bytes");
});

test("transcribe posts Spanish audio to OpenAI with the key and returns the text", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ text: "  Hola, prepara el informe.  " }) };
  };
  const out = await transcribe({ provider: hub(), audio, mime: "audio/webm;codecs=opus", durationMs: 3000, fetchImpl });
  assert.deepEqual(out, { text: "Hola, prepara el informe." });
  assert.equal(calls[0].url, OPENAI_TRANSCRIPTIONS);
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test-123");
  const form = calls[0].init.body;
  assert.equal(form.get("language"), "es");
  assert.ok(form.get("model"));
  assert.equal(form.get("file").type, "audio/webm");

  await assert.rejects(transcribe({ provider: hub(null), audio, mime: "audio/webm", fetchImpl }), (e) => e.status === 501 && /clave de OpenAI/.test(e.message));
  await assert.rejects(transcribe({ provider: hub(), audio, mime: "audio/webm", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) }), /no es válida/);
  await assert.rejects(transcribe({ provider: hub(), audio, mime: "audio/webm", fetchImpl: async () => { throw Error("offline"); } }), /conectar/);
});
