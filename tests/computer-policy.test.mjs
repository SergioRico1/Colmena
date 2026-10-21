import test from "node:test";
import assert from "node:assert/strict";
import {
  computerPolicy, classifyCommand, fileOpenProblem, describeForApproval, verbForComputer, COMPUTER_VERBS, announces,
} from "../server/computer/policy.mjs";

const bot = (autonomy) => ({ id: "nora", name: "Nora", autonomy });
const LEVELS = ["sugiere", "avisa", "solo"];

test("reading the web is free at every autonomy", () => {
  for (const level of LEVELS)
    for (const name of ["browser_open", "browser_read", "browser_screenshot"])
      assert.equal(computerPolicy(name, {}, bot(level)), "free", name + " " + level);
});

test("browsing never asks (act, fill, download); opening files asks only with 'sugiere'", () => {
  const cases = [
    ["browser_act", { kind: "click", ref: "e1", text: "" }],
    ["browser_act", { kind: "escribir", ref: "e2", text: "hola" }],
    ["browser_fill", { fields: [{ ref: "e1", value: "x" }] }],
    ["browser_download", { ref: "e3" }],
    ["open_file", { folderId: "f1", path: "a.pdf" }],
  ];
  for (const [name, args] of cases) {
    assert.equal(computerPolicy(name, args, bot("sugiere")), name === "open_file" ? "approval" : "free", name);
    assert.equal(computerPolicy(name, args, bot("avisa")), "free", name);
    assert.equal(computerPolicy(name, args, bot("solo")), "free", name);
    assert.equal(announces(name, args), true, name + " is announced when free");
  }
  // Scrolling and waiting change nothing.
  assert.equal(computerPolicy("browser_act", { kind: "desplazar", ref: "", text: "abajo" }, bot("sugiere")), "free");
  assert.equal(announces("browser_act", { kind: "esperar" }), false);
});

test("an autonomy override never makes browsing ask; files still follow it", () => {
  assert.equal(computerPolicy("browser_act", { kind: "click" }, bot("solo"), { autonomy: "sugiere" }), "free");
  assert.equal(computerPolicy("open_file", { folderId: "f1", path: "a.pdf" }, bot("solo"), { autonomy: "sugiere" }), "approval");
});

test("submitting is always a red line, even with 'solo'", () => {
  for (const level of LEVELS) assert.equal(computerPolicy("browser_submit", { ref: "e1", summary: "Comprar" }, bot(level)), "redline");
});

test("apps open on their own unless the bot only suggests", () => {
  assert.equal(computerPolicy("open_app", { app: "excel" }, bot("sugiere")), "approval");
  assert.equal(computerPolicy("open_app", { app: "excel" }, bot("avisa")), "free");
  assert.equal(computerPolicy("open_app", { app: "excel" }, bot("solo")), "free");
});

test("ordinary commands run on their own unless the bot only suggests; dangerous ones are red lines", () => {
  assert.equal(computerPolicy("run_command", { program: "git", args: ["status"] }, bot("sugiere")), "approval");
  for (const level of ["avisa", "solo"]) assert.equal(computerPolicy("run_command", { program: "git", args: ["status"] }, bot(level)), "free");
  const red = [
    ["winget", ["install", "x"]], ["choco", ["install", "x"]], ["msiexec", ["/i", "a.msi"]], ["del", ["a.txt"]], ["rmdir", ["/s", "x"]],
    ["rm", ["-rf", "x"]], ["Remove-Item", ["x"]], ["format", ["d:"]], ["reg", ["add", "HKCU\\x"]], ["sc", ["stop", "x"]], ["net", ["user", "a", "b"]],
    ["python", ["-c", "print(1)"]], ["python3.exe", ["-c", "1"]], ["node", ["-e", "1"]], ["node.exe", ["--eval", "1"]],
    ["powershell", ["-Command", "Get-ChildItem"]], ["powershell.exe", ["-EncodedCommand", "AAAA"]], ["pwsh", ["-c", "x"]], ["cmd", ["/c", "dir"]],
    ["C:\\Windows\\System32\\cmd.exe", ["/c", "echo"]], ["pip", ["install", "x"]], ["npm", ["install"]], ["npx", ["x"]], ["git", ["push"]],
    ["git", ["reset", "--hard"]], ["curl", ["-d", "a=1", "https://x.y"]], ["taskkill", ["/im", "x.exe"]], ["schtasks", ["/create"]], ["script.bat", []],
  ];
  for (const [program, args] of red) {
    assert.equal(classifyCommand(program, args).redLine, true, program + " " + args.join(" "));
    assert.equal(computerPolicy("run_command", { program, args }, bot("solo")), "redline", program);
  }
  for (const [program, args] of [["git", ["status"]], ["python", ["informe.py"]], ["node", ["--version"]], ["curl", ["https://example.com"]], ["ffmpeg", ["-i", "a.mp4", "b.mp3"]]])
    assert.equal(classifyCommand(program, args).redLine, false, program + " " + args.join(" "));
});

test("open_file refuses executables, scripts, shortcuts and tricks", () => {
  for (const name of ["a.exe", "a.bat", "a.cmd", "a.ps1", "a.lnk", "a.msi", "a.vbs", "a.js", "a.jar", "a.scr", "a.com", "A.EXE", "x.hta", "m.xlsm", "r.reg", "u.url", "s.cpl"])
    assert.ok(fileOpenProblem(name), name);
  assert.ok(fileOpenProblem("factura.pdf."), "trailing dot");
  assert.ok(fileOpenProblem("factura.pdf:evil.exe"), "alternate data stream");
  assert.ok(fileOpenProblem("sin-extension"));
  for (const name of ["factura.pdf", "datos.xlsx", "carta.docx", "foto.JPG", "notas.txt", "carpeta/sub/plan.csv"]) assert.equal(fileOpenProblem(name), null, name);
});

test("approval cards explain the scope in plain words", () => {
  const card = describeForApproval("browser_submit", { ref: "e4", summary: "Pedido de 3 cajas" }, { botName: "Nora", domain: "tienda.es", fields: [{ label: "Nombre", value: "Ana" }], button: "Comprar", shot: "capturas/x.jpg" });
  assert.equal(card.title, "Enviar formulario en tienda.es");
  assert.match(card.summary, /Nora quiere pulsar «Comprar» en tienda\.es: Pedido de 3 cajas/);
  assert.match(card.scope, /Dominio externo/);
  assert.equal(card.image, "capturas/x.jpg");
  const cmd = describeForApproval("run_command", { program: "git", args: ["log", "--oneline"], reason: "ver cambios" }, { botName: "Bruno" });
  assert.match(cmd.summary, /no hay un entorno aislado/);
});

test("live verbs", () => {
  assert.equal(verbForComputer("browser_open", {}), "navegando");
  assert.equal(verbForComputer("browser_act", { kind: "escribir" }), "rellenando un formulario");
  assert.equal(verbForComputer("browser_fill", {}), "rellenando un formulario");
  assert.equal(COMPUTER_VERBS.open_app, "usando el ordenador");
  assert.equal(COMPUTER_VERBS.open_file, "usando el ordenador");
  assert.equal(COMPUTER_VERBS.run_command, "ejecutando una tarea");
});
