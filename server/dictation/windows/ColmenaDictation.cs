// Colmena's Windows dictation helper: the offline speech recognizer that ships with Windows
// (System.Speech, the desktop SAPI engine, installed with the language's «Reconocimiento de
// voz» feature). No network, no key. The server compiles this file once with the csc.exe of
// .NET Framework 4 (part of every Windows 10/11) and talks to it over stdio:
//
//   stdout: one JSON object per line
//     {"type":"ready","engine":"sapi","lang":"es-ES","name":"..."}
//     {"type":"level","value":0.42}     microphone loudness 0..1, about 12 times a second
//     {"type":"partial","text":"..."}   the phrase being spoken, may still change
//     {"type":"final","text":"..."}     a finished phrase
//     {"type":"error","code":"no-language|no-microphone|denied-microphone|failed","message":"...","installed":"..."}
//     {"type":"end"}
//   stdin: "stop" finishes the current phrase and ends; "cancel" ends at once; EOF = stop.
//
// Modes: (default) listen to the default microphone · --wav <file> transcribe a WAV file ·
// --probe list the installed recognizers · --say <text> --out <file> write a WAV with the
// Spanish Windows voice (used by the automatic test).
using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Speech.AudioFormat;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;
using Microsoft.Win32;

static class ColmenaDictation
{
    static readonly object Gate = new object();
    static readonly ManualResetEvent Done = new ManualResetEvent(false);

    static void Emit(string json)
    {
        lock (Gate)
        {
            Console.Out.Write(json + "\n");
            Console.Out.Flush();
        }
    }

    static string Str(string s)
    {
        var b = new StringBuilder("\"");
        foreach (var c in s ?? "")
        {
            if (c == '"') b.Append("\\\"");
            else if (c == '\\') b.Append("\\\\");
            else if (c == '\n') b.Append("\\n");
            else if (c == '\r') b.Append("\\r");
            else if (c == '\t') b.Append("\\t");
            else if (c < 0x20) b.Append("\\u" + ((int)c).ToString("x4"));
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }

    static void Error(string code, string message, string installed)
    {
        Emit("{\"type\":\"error\",\"code\":" + Str(code) + ",\"message\":" + Str(message) + ",\"installed\":" + Str(installed) + "}");
    }

    static string Arg(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.InputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Contains("--say")) return Say(Arg(args, "--say"), Arg(args, "--out"), Arg(args, "--lang") ?? "es-ES");
            var installed = SpeechRecognitionEngine.InstalledRecognizers();
            var list = string.Join(",", installed.Select(r => r.Culture.Name).ToArray());
            if (args.Contains("--probe"))
            {
                Emit("{\"type\":\"probe\",\"engine\":\"sapi\",\"installed\":" + Str(list) + ",\"microphoneBlocked\":" + (MicrophoneBlocked() ? "true" : "false") + "}");
                return 0;
            }
            var lang = Arg(args, "--lang") ?? "es-ES";
            var prefix = lang.Split('-')[0];
            var info = installed.FirstOrDefault(r => r.Culture.Name.Equals(lang, StringComparison.OrdinalIgnoreCase))
                ?? installed.FirstOrDefault(r => r.Culture.TwoLetterISOLanguageName.Equals(prefix, StringComparison.OrdinalIgnoreCase));
            if (info == null)
            {
                Error("no-language", "Windows has no speech recognizer for " + lang + ".", list);
                Emit("{\"type\":\"end\"}");
                return 2;
            }
            return Listen(info, Arg(args, "--wav"), list, Int(Arg(args, "--max-ms"), 120000));
        }
        catch (Exception e)
        {
            Error("failed", e.Message, "");
            Emit("{\"type\":\"end\"}");
            return 1;
        }
    }

    static int Int(string s, int fallback)
    {
        int n;
        return int.TryParse(s, out n) && n > 0 ? n : fallback;
    }

    static int Listen(RecognizerInfo info, string wav, string list, int maxMs)
    {
        using (var engine = new SpeechRecognitionEngine(info))
        {
            engine.LoadGrammar(new DictationGrammar());
            if (wav != null) engine.SetInputToWaveFile(wav);
            else
            {
                if (MicrophoneBlocked())
                {
                    Error("denied-microphone", "Windows privacy settings block the microphone for desktop apps.", list);
                    Emit("{\"type\":\"end\"}");
                    return 3;
                }
                try { engine.SetInputToDefaultAudioDevice(); }
                catch (Exception e)
                {
                    Error("no-microphone", e.Message, list);
                    Emit("{\"type\":\"end\"}");
                    return 3;
                }
            }
            // A pause of ~0.8 s closes a phrase; silence alone never ends the dictation.
            engine.EndSilenceTimeout = TimeSpan.FromMilliseconds(800);
            engine.EndSilenceTimeoutAmbiguous = TimeSpan.FromMilliseconds(1000);
            var lastLevel = DateTime.MinValue;
            engine.AudioLevelUpdated += (s, e) =>
            {
                var now = DateTime.UtcNow;
                if ((now - lastLevel).TotalMilliseconds < 80) return;
                lastLevel = now;
                Emit("{\"type\":\"level\",\"value\":" + (Math.Min(100, Math.Max(0, e.AudioLevel)) / 100.0).ToString("0.00", CultureInfo.InvariantCulture) + "}");
            };
            engine.SpeechHypothesized += (s, e) => { if (e.Result != null && e.Result.Text.Length > 0) Emit("{\"type\":\"partial\",\"text\":" + Str(e.Result.Text) + "}"); };
            engine.SpeechRecognized += (s, e) => { if (e.Result != null && e.Result.Text.Length > 0) Emit("{\"type\":\"final\",\"text\":" + Str(e.Result.Text) + "}"); };
            engine.RecognizeCompleted += (s, e) =>
            {
                if (e.Error != null) Error("failed", e.Error.Message, list);
                Done.Set();
            };
            Emit("{\"type\":\"ready\",\"engine\":\"sapi\",\"lang\":" + Str(info.Culture.Name) + ",\"name\":" + Str(info.Description) + "}");
            engine.RecognizeAsync(RecognizeMode.Multiple);
            if (wav == null)
            {
                var reader = new Thread(() =>
                {
                    try
                    {
                        string line;
                        while ((line = Console.In.ReadLine()) != null)
                        {
                            line = line.Trim();
                            if (line == "cancel") { engine.RecognizeAsyncCancel(); return; }
                            if (line == "stop") break;
                        }
                        engine.RecognizeAsyncStop();
                    }
                    catch { }
                });
                reader.IsBackground = true;
                reader.Start();
            }
            if (!Done.WaitOne(maxMs + 1500))
            {
                engine.RecognizeAsyncStop();
                if (!Done.WaitOne(3000)) engine.RecognizeAsyncCancel();
            }
        }
        Emit("{\"type\":\"end\"}");
        return 0;
    }

    // «Permitir que las aplicaciones de escritorio accedan al micrófono» (or the whole microphone)
    // turned off: the device still opens but only hears silence, so say it plainly instead.
    static bool MicrophoneBlocked()
    {
        const string store = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
        try
        {
            if (Denied(Registry.LocalMachine, store) || Denied(Registry.CurrentUser, store)) return true;
            return Denied(Registry.CurrentUser, store + @"\NonPackaged");
        }
        catch { return false; }
    }

    static bool Denied(RegistryKey root, string path)
    {
        using (var key = root.OpenSubKey(path))
            return key != null && "Deny".Equals(key.GetValue("Value") as string, StringComparison.OrdinalIgnoreCase);
    }

    static int Say(string text, string output, string lang)
    {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(output)) throw new ArgumentException("--say needs a text and --out a file.");
        using (var synth = new SpeechSynthesizer())
        {
            var voice = synth.GetInstalledVoices().Select(v => v.VoiceInfo).FirstOrDefault(v => v.Culture.Name.Equals(lang, StringComparison.OrdinalIgnoreCase))
                ?? synth.GetInstalledVoices().Select(v => v.VoiceInfo).FirstOrDefault(v => v.Culture.TwoLetterISOLanguageName == lang.Split('-')[0]);
            if (voice == null) throw new InvalidOperationException("No voice for " + lang + ".");
            synth.SelectVoice(voice.Name);
            synth.SetOutputToWaveFile(output, new SpeechAudioFormatInfo(16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            synth.Speak(text);
        }
        Emit("{\"type\":\"said\",\"file\":" + Str(Path.GetFullPath(output)) + "}");
        return 0;
    }
}
