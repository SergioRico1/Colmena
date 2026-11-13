import test from "node:test";
import assert from "node:assert/strict";
import { mediaCaps } from "../server/media.mjs";
import { toChatMessages } from "../server/providers/completions.mjs";

const hub = (vision, pdf) => ({
  config: () => ({}),
  resolveModel: (m) => m,
  supportsVision: () => vision,
  supportsPdf: () => pdf,
});

test("API-key engines take images and PDFs only when their catalogue says the model reads them", () => {
  assert.deepEqual(mediaCaps(hub(true, false), "gemini/gemini-3.8-flash"), { images: true, pdf: false });
  assert.deepEqual(mediaCaps(hub(false, false), "deepseek/deepseek-v4-pro"), { images: false, pdf: false });
  assert.deepEqual(mediaCaps(hub(true, true), "openrouter/some/model"), { images: true, pdf: true });
});

test("a PDF goes once: as a file part where the model reads PDFs, else as its read_file note", () => {
  const input = [{ role: "user", content: [{ type: "input_text", text: "Mira esto" }, { type: "input_file", filename: "a.pdf", file_data: "data:application/pdf;base64,AAAA" }] }];
  const withPdf = toChatMessages(input, { pdf: true });
  const user = withPdf.find((m) => m.role === "user");
  assert.ok(Array.isArray(user.content));
  assert.equal(user.content.filter((p) => p.type === "file").length, 1);
  assert.doesNotMatch(user.content[0].text, /read_file/);

  const noPdf = toChatMessages(input, { pdf: false });
  const plain = noPdf.find((m) => m.role === "user");
  assert.equal(typeof plain.content, "string");
  assert.match(plain.content, /a\.pdf/);
});
