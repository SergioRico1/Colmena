// The one live region of a conversation: what lib/useAnnouncer.js decides to say, read
// politely by a screen reader and never shown. Everything else in the conversation stays
// silent (the message list is a log with aria-live="off"; text being written is not live).
const hidden = { position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: 0, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0 };

export default function Announcer({ text }) {
  return <p role="status" aria-live="polite" aria-atomic="true" data-announcer="" style={hidden}>{text}</p>;
}
