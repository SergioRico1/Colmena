import { useEffect, useMemo } from "react";
import Shell from "../components/v2/Shell.jsx";
import Conversacion from "./Conversacion.jsx";
import { useStore } from "../lib/store.jsx";
import { navigate } from "../lib/router.jsx";
import { chatsTarget, readLastConversation, sidebarModel } from "../lib/sidebar.js";

// /chats (and the older /conversaciones). «Chats» is no longer a place of the sidebar
// (docs/PLAN-equipo-y-salas.md): the address opens the last conversation you had — a room, a
// chat with a bot or a person — or the first room. With nothing to open, or when a link asks
// for «Nuevo chat» / «Nueva sala» (?nuevo=chat|sala), it shows the list of chats as before.
export default function Chats({ params = {}, query = {} }) {
  const store = useStore();
  const asked = query.nuevo === "chat" || query.nuevo === "sala";
  const target = useMemo(() => (asked || !store.ready ? null : chatsTarget(sidebarModel(store), readLastConversation())), [asked, store]);
  useEffect(() => { if (target) navigate(target, { replace: true }); }, [target]);
  // The sidebar stays while the state loads or the conversation opens: no blank window.
  if (!asked && (!store.ready || target)) return <Shell active="chats">{null}</Shell>;
  return <Conversacion params={params} query={query} />;
}
