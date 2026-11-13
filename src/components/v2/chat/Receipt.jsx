import { Clock } from "lucide-react";
import { BotMark } from "./Mark.jsx";
import { findBot } from "../../room/common.jsx";

// What became of a message you sent while a bot was working (src/lib/receipts.js), as a
// small mark under it: it waits for a pause, the bot read it (its shape), or it is held
// until you give your OK. `receipt` is «wait», «hold» or «read:<botId>».

const LINE = { display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "var(--t-caption)", lineHeight: "16px", color: "#5C606C", whiteSpace: "nowrap" };

export default function Receipt({ receipt, bots = [] }) {
  if (!receipt) return null;
  if (receipt === "wait") {
    return (
      <span role="status" data-receipt="wait" title="Lo leerá en cuanto haga una pausa en lo que está haciendo" style={LINE}>
        <span aria-hidden="true" style={{ width: "10px", height: "10px", flex: "none", borderRadius: "50%", border: "1.5px solid rgba(18,19,26,.16)", borderTopColor: "#5C606C", animation: "spin 1.1s linear infinite" }} />
        {"Espera una pausa"}
      </span>
    );
  }
  if (receipt === "hold") {
    return (
      <span role="status" data-receipt="hold" title="Lo leerá cuando decidas lo que te ha pedido" style={LINE}>
        <Clock size={12} strokeWidth={2.2} aria-hidden="true" style={{ flex: "none" }} />
        {"Espera tu OK"}
      </span>
    );
  }
  const bot = findBot(bots, receipt.slice(5) || null);
  return (
    <span data-receipt="read" title={bot?.name ? `${bot.name} lo ha leído` : "Leído"} style={LINE}>
      <BotMark bot={bot} size={12} />
      {"Leído"}
    </span>
  );
}
