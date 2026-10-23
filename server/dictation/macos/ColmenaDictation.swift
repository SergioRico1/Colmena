// Colmena's macOS dictation helper: Apple's Speech framework (SFSpeechRecognizer), on the Mac
// itself whenever the language's on-device model is there (requiresOnDeviceRecognition), with
// Apple's own service otherwise. No key. The server starts it and talks to it over stdio with
// the same protocol as the Windows helper (server/dictation/windows/ColmenaDictation.cs):
//
//   stdout: one JSON object per line
//     {"type":"ready","engine":"apple","lang":"es-ES","onDevice":true}
//     {"type":"level","value":0.42}     microphone loudness 0..1, about 12 times a second
//     {"type":"partial","text":"..."}   what has been said so far in this stretch, may change
//     {"type":"final","text":"..."}     a finished stretch
//     {"type":"error","code":"no-language|denied-speech|denied-microphone|no-microphone|failed","message":"..."}
//     {"type":"end"}
//   stdin: "stop" finishes what is being said and ends; "cancel" ends at once; EOF = stop.
//
// Modes: (default) listen to the microphone · --file <audio> transcribe a file · --probe say
// what this Mac can do. Built by build.sh as a universal binary with an embedded Info.plist
// (the usage strings the Speech framework requires of the process that calls it).
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

func finish(_ code: Int32) -> Never {
  emit(["type": "end"])
  exit(code)
}

func fail(_ code: String, _ message: String) -> Never {
  emit(["type": "error", "code": code, "message": message])
  finish(2)
}

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}
let lang = arg("--lang") ?? "es-ES"
let maxMs = Int(arg("--max-ms") ?? "") ?? 120000

func makeRecognizer() -> SFSpeechRecognizer? {
  let wanted = Locale(identifier: lang)
  if SFSpeechRecognizer.supportedLocales().contains(where: { $0.identifier.replacingOccurrences(of: "_", with: "-") == lang }), let r = SFSpeechRecognizer(locale: wanted) { return r }
  let prefix = String(lang.prefix(2))
  if let other = SFSpeechRecognizer.supportedLocales().first(where: { $0.identifier.hasPrefix(prefix) }) { return SFSpeechRecognizer(locale: other) }
  return nil
}

func authorizeSpeech(_ then: @escaping () -> Void) {
  SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
      switch status {
      case .authorized: then()
      case .denied, .restricted: fail("denied-speech", "Speech recognition is not allowed for Colmena.")
      default: fail("denied-speech", "Speech recognition permission was not given.")
      }
    }
  }
}

func authorizeMicrophone(_ then: @escaping () -> Void) {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: then()
  case .notDetermined:
    AVCaptureDevice.requestAccess(for: .audio) { ok in
      DispatchQueue.main.async {
        if ok { then() } else { fail("denied-microphone", "The microphone is not allowed for Colmena.") }
      }
    }
  default: fail("denied-microphone", "The microphone is not allowed for Colmena.")
  }
}

if args.contains("--probe") {
  let r = makeRecognizer()
  var out: [String: Any] = ["type": "probe", "engine": "apple", "installed": SFSpeechRecognizer.supportedLocales().map { $0.identifier }.sorted().joined(separator: ",")]
  out["lang"] = r?.locale.identifier.replacingOccurrences(of: "_", with: "-") ?? NSNull()
  out["available"] = r?.isAvailable ?? false
  if #available(macOS 10.15, *) { out["onDevice"] = r?.supportsOnDeviceRecognition ?? false }
  out["speech"] = SFSpeechRecognizer.authorizationStatus().rawValue
  out["microphone"] = AVCaptureDevice.authorizationStatus(for: .audio).rawValue
  emit(out)
  finish(0)
}

// A global constant, not a top-level «guard let» binding: the Listener class below uses it, and
// a class cannot close over a value of the script's own scope.
let recognizer: SFSpeechRecognizer = {
  guard let found = makeRecognizer() else { fail("no-language", "This Mac has no speech recognizer for \(lang).") }
  return found
}()

func configure(_ request: SFSpeechRecognitionRequest) -> Bool {
  request.shouldReportPartialResults = true
  request.taskHint = .dictation
  var onDevice = false
  if #available(macOS 10.15, *), recognizer.supportsOnDeviceRecognition {
    request.requiresOnDeviceRecognition = true
    onDevice = true
  }
  if #available(macOS 13, *) { request.addsPunctuation = true }
  return onDevice
}

func ready(_ onDevice: Bool) {
  emit(["type": "ready", "engine": "apple", "lang": recognizer.locale.identifier.replacingOccurrences(of: "_", with: "-"), "onDevice": onDevice])
}

// "No speech detected" (1110) and a cancelled task (216, 301) are a quiet end, not a failure.
func quiet(_ error: Error) -> Bool {
  let e = error as NSError
  return [1110, 216, 301, 203].contains(e.code)
}

// ───────────── a file
if let path = arg("--file") {
  authorizeSpeech {
    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    ready(configure(request))
    var last = ""
    _ = recognizer.recognitionTask(with: request) { result, error in
      if let result = result {
        let text = result.bestTranscription.formattedString
        if result.isFinal {
          if !text.isEmpty { emit(["type": "final", "text": text]) }
          finish(0)
        }
        if !text.isEmpty && text != last { last = text; emit(["type": "partial", "text": text]) }
      }
      if let error = error {
        if !last.isEmpty { emit(["type": "final", "text": last]) }
        if quiet(error) { finish(0) }
        fail("failed", error.localizedDescription)
      }
    }
  }
  dispatchMain()
}

// ───────────── the microphone
final class Listener {
  let engine = AVAudioEngine()
  var request: SFSpeechAudioBufferRecognitionRequest?
  var task: SFSpeechRecognitionTask?
  var last = ""
  var stopping = false
  var onDevice = false

  func start() {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    if format.channelCount == 0 || format.sampleRate == 0 { fail("no-microphone", "No microphone is connected.") }
    var lastLevel = Date.distantPast
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
      let now = Date()
      guard now.timeIntervalSince(lastLevel) >= 0.08, let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
      lastLevel = now
      var sum: Float = 0
      for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
      let rms = (sum / Float(buffer.frameLength)).squareRoot()
      // About -50 dB (silence) to -10 dB (loud speech) → 0…1, like the Windows helper.
      let db = 20 * log10(max(rms, 0.000_01))
      let level = min(1, max(0, (db + 50) / 40))
      DispatchQueue.main.async { emit(["type": "level", "value": (Double(level) * 100).rounded() / 100]) }
    }
    engine.prepare()
    do { try engine.start() } catch { fail("no-microphone", error.localizedDescription) }
    begin()
    ready(onDevice)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(maxMs)) { [weak self] in self?.stop() }
  }

  // One recognition request per stretch: Apple's service ends a request after about a minute,
  // so a final result while still listening starts the next one on the same microphone.
  func begin() {
    let request = SFSpeechAudioBufferRecognitionRequest()
    onDevice = configure(request)
    self.request = request
    last = ""
    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      DispatchQueue.main.async { self?.handle(result, error, request) }
    }
  }

  func handle(_ result: SFSpeechRecognitionResult?, _ error: Error?, _ from: SFSpeechAudioBufferRecognitionRequest) {
    guard from === request else { return }
    if let result = result {
      let text = result.bestTranscription.formattedString
      if result.isFinal {
        if !text.isEmpty { emit(["type": "final", "text": text]) }
        last = ""
        if stopping { finish(0) }
        begin()
        return
      }
      if !text.isEmpty && text != last { last = text; emit(["type": "partial", "text": text]) }
    }
    if let error = error {
      if !last.isEmpty { emit(["type": "final", "text": last]) }
      last = ""
      if stopping || quiet(error) {
        if stopping { finish(0) }
        begin()
        return
      }
      fail("failed", error.localizedDescription)
    }
  }

  func stop() {
    if stopping { return }
    stopping = true
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    // The last words arrive as a final result; never wait for them more than three seconds.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
      if let text = self?.last, !text.isEmpty { emit(["type": "final", "text": text]) }
      finish(0)
    }
  }

  func cancel() {
    task?.cancel()
    finish(0)
  }
}

let listener = Listener()
authorizeSpeech {
  authorizeMicrophone {
    listener.start()
    Thread.detachNewThread {
      while let line = readLine() {
        let command = line.trimmingCharacters(in: .whitespaces)
        if command == "cancel" { DispatchQueue.main.async { listener.cancel() }; return }
        if command == "stop" { break }
      }
      DispatchQueue.main.async { listener.stop() }
    }
  }
}
dispatchMain()
