"use strict";
// Windows side of «Pregunta rápida» (OpenClaw Quick Chat on macOS, ported): which window you
// were in when you pressed the shortcut, the readable text of that window (UI Automation,
// never password fields) and pasting the answer back into it. One PowerShell process is
// started once and kept warm, so each request takes milliseconds (no native modules).
const { spawn } = require("node:child_process");

// Limits as in OpenClaw's focused-text capture: depth 12, 800 elements, 20 000 characters,
// a 3 s walk deadline (the request itself gives up at 5 s).
const LIMITS = { depth: 12, elements: 800, chars: 20000, deadlineMs: 3000 };
// Never read or paste into these (password managers, consoles, Colmena itself).
const BLOCKED = /^(keepass(xc)?|1password|bitwarden|dashlane|lastpass|enpass|nordpass|keeper|roboform|cmd|powershell|pwsh|windowsterminal|wt|electron|colmena|cua-driver|credentialuibroker|consent|lockapp|logonui)$/i;

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ColmenaWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@
function Info($h) {
  $procId = 0
  [void][ColmenaWin]::GetWindowThreadProcessId($h, [ref]$procId)
  $name = ''; $label = ''
  try { $p = [System.Diagnostics.Process]::GetProcessById([int]$procId); $name = $p.ProcessName; try { $label = $p.MainModule.FileVersionInfo.FileDescription } catch {} } catch {}
  @{ hwnd = [string]$h.ToInt64(); pid = [int]$procId; exe = $name; app = $(if ($label) { $label } else { $name }); title = [ColmenaWin]::Title($h) }
}
function ReadText($h, $lim) {
  $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$h)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $deadline = [DateTime]::UtcNow.AddMilliseconds($lim.deadlineMs)
  $sb = New-Object System.Text.StringBuilder
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($root, 0, ''))
  $count = 0; $truncated = $false
  while ($stack.Count -gt 0) {
    if ([DateTime]::UtcNow -gt $deadline -or $count -ge $lim.elements) { $truncated = $true; break }
    $item = $stack.Pop(); $el = $item[0]; $depth = $item[1]; $parent = $item[2]
    $count++
    $own = ''
    try {
      $c = $el.Current
      if ($c.IsPassword) { continue }
      # Window chrome (title bar, scroll bars, menus) is not content: skip it with its children.
      $kind = $c.ControlType.ProgrammaticName
      if ($kind -match 'TitleBar|ScrollBar|Thumb|MenuBar|StatusBar') { continue }
      $texts = @()
      $pattern = $null
      if ($el.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { $texts += $pattern.DocumentRange.GetText($lim.chars) }
      elseif ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { $texts += $pattern.Current.Value }
      # Controls are labels, not text («Cerrar», «Negrita»…): only content keeps its name.
      if ($kind -notmatch 'Button|MenuItem|SplitButton|CheckBox|RadioButton|ToolBar|Tab|TabItem|ComboBox|Separator') { $texts += $c.Name }
      foreach ($t in $texts) {
        if ($null -eq $t) { continue }
        $t = $t.Trim()
        if ($t.Length -eq 0 -or $t -eq $parent -or -not $seen.Add($t)) { continue }
        if ($sb.Length -gt 0) { [void]$sb.Append([char]10) }
        $room = $lim.chars - $sb.Length
        if ($t.Length -ge $room) { [void]$sb.Append($t.Substring(0, [Math]::Max(0, $room))); $truncated = $true; break }
        [void]$sb.Append($t); $own = $t
      }
      if ($sb.Length -ge $lim.chars) { $truncated = $true; break }
    } catch { continue }
    if ($depth -lt $lim.depth) {
      $kids = New-Object System.Collections.ArrayList
      try { $k = $walker.GetFirstChild($el); while ($k -ne $null -and $kids.Count -lt 200) { [void]$kids.Add($k); $k = $walker.GetNextSibling($k) } } catch {}
      for ($i = $kids.Count - 1; $i -ge 0; $i--) { $stack.Push(@($kids[$i], ($depth + 1), $own)) }
    }
  }
  @{ text = $sb.ToString(); truncated = $truncated; elements = $count }
}
function Paste($h) {
  if (-not [ColmenaWin]::IsWindow($h)) { return @{ ok = $false; reason = 'gone' } }
  if ([ColmenaWin]::IsIconic($h)) { [void][ColmenaWin]::ShowWindow($h, 9) }
  # An Alt tap lets a background process bring another window to the front.
  [ColmenaWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [ColmenaWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [void][ColmenaWin]::SetForegroundWindow($h)
  for ($i = 0; $i -lt 50 -and [ColmenaWin]::GetForegroundWindow() -ne $h; $i++) { Start-Sleep -Milliseconds 20 }
  if ([ColmenaWin]::GetForegroundWindow() -ne $h) { return @{ ok = $false; reason = 'focus' } }
  [ColmenaWin]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [ColmenaWin]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
  [ColmenaWin]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero); [ColmenaWin]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  @{ ok = $true }
}
[Console]::Out.WriteLine('{"ready":true}'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $h = [IntPtr]::Zero
    if ($req.hwnd) { $h = [IntPtr][Int64]$req.hwnd }
    switch ($req.op) {
      'foreground' { $result = Info([ColmenaWin]::GetForegroundWindow()) }
      'text' { $result = ReadText $h $req.limits }
      'paste' { $result = Paste $h }
      'alive' { $result = @{ alive = [ColmenaWin]::IsWindow($h) } }
      default { throw "unknown op" }
    }
    $out = @{ id = $req.id; ok = $true; result = $result }
  } catch {
    $out = @{ id = $(if ($req) { $req.id } else { $null }); ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush()
}
`;

class WinHelper {
  constructor() {
    this.proc = null;
    this.pending = new Map();
    this.seq = 0;
    this.buffer = "";
    this.ready = null;
  }
  get available() { return process.platform === "win32"; }
  start() {
    if (!this.available || this.proc) return this.ready;
    const proc = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    this.proc = proc;
    this.ready = new Promise((resolve) => { this.onReady = resolve; });
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let i;
      while ((i = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, i).trim();
        this.buffer = this.buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) { this.onReady?.(true); continue; }
        const job = this.pending.get(msg.id);
        if (!job) continue;
        this.pending.delete(msg.id);
        clearTimeout(job.timer);
        if (msg.ok) job.resolve(msg.result);
        else job.reject(Error(msg.error || "No se pudo."));
      }
    });
    const gone = () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.onReady?.(false);
      for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(Error("El ayudante de Windows se cerró.")); }
      this.pending.clear();
    };
    proc.on("exit", gone);
    proc.on("error", gone);
    // The script is sent through stdin, then requests follow, one JSON object per line.
    proc.stdin.write(SCRIPT.replace(/\r?\n/g, "\r\n") + "\r\n");
    return this.ready;
  }
  async request(op, args = {}, timeoutMs = 5000) {
    if (!this.available) throw Error("Solo en Windows.");
    if (!this.proc) this.start();
    const ok = await Promise.race([this.ready, new Promise((r) => setTimeout(() => r(false), timeoutMs))]);
    if (!ok || !this.proc) throw Error("El ayudante de Windows no está listo.");
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error("La ventana no responde.")); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, op, ...args }) + "\r\n");
    });
  }
  /** The window you were in: {hwnd, pid, exe, app, title}, or null when it is Colmena or blocked. */
  async foreground(timeoutMs = 400) {
    try {
      const w = await this.request("foreground", {}, timeoutMs);
      if (!w || !w.hwnd || w.hwnd === "0" || w.pid === process.pid || BLOCKED.test(String(w.exe || ""))) return null;
      return { hwnd: String(w.hwnd), pid: w.pid, exe: w.exe || "", app: friendlyApp(w), title: String(w.title || "").slice(0, 200) };
    } catch {
      return null;
    }
  }
  async text(hwnd) {
    const r = await this.request("text", { hwnd: String(hwnd), limits: LIMITS }, LIMITS.deadlineMs + 2000);
    return { text: String(r?.text || ""), truncated: !!r?.truncated };
  }
  async paste(hwnd) {
    return await this.request("paste", { hwnd: String(hwnd) }, 3000);
  }
  stop() {
    try { this.proc?.kill(); } catch {}
    this.proc = null;
  }
}

// «WINWORD» → «Word»: the names people use for the apps they work with.
const NAMES = { winword: "Word", excel: "Excel", powerpnt: "PowerPoint", outlook: "Outlook", olk: "Outlook", onenote: "OneNote", msedge: "Edge", chrome: "Chrome", firefox: "Firefox", notepad: "Bloc de notas", explorer: "Explorador de archivos", teams: "Teams", "ms-teams": "Teams", acrobat: "Acrobat", acrord32: "Acrobat Reader", code: "Visual Studio Code", slack: "Slack", whatsapp: "WhatsApp" };
function friendlyApp(w) {
  const exe = String(w.exe || "").toLowerCase();
  if (NAMES[exe]) return NAMES[exe];
  const label = String(w.app || "").replace(/^Microsoft\s+/i, "").trim();
  return (label || w.exe || "la app").slice(0, 60);
}

module.exports = { WinHelper, LIMITS, BLOCKED, friendlyApp };
