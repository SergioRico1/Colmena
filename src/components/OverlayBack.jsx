import { ArrowLeft } from "./Icon.js";
import { useBreakpoint } from "../lib/breakpoint.js";

// The way back out of a side panel that covers the conversation (.r-overlay, styles/responsive.css):
// on a phone or a tablet a panel beside the chat (the room's details, a bot's profile, the side
// dock, the inspector) lies over it, so its first row says where you return. On a laptop the
// panel sits beside the conversation with its own controls and this draws nothing.
export default function OverlayBack({ onClose, label = "Volver a la conversación" }) {
  const bp = useBreakpoint();
  if (bp === "laptop" || !onClose) return null;
  return (
    <div className="r-overlay-back">
      <button type="button" onClick={onClose}>
        <ArrowLeft size={20} />
        <span>{label}</span>
      </button>
    </div>
  );
}
