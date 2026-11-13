import InviteSheetBase from "../../people/InviteSheet.jsx";
import JoinSheet from "../../people/JoinSheet.jsx";

// The old names of «Personas», kept for the screens that open them: both are now the one
// «Invitar» sheet (people/InviteSheet.jsx, here without a room or a team: a code to talk to
// someone who is not in Colmena with you yet) and «Unirme con un código» (people/JoinSheet.jsx).
export function InviteSheet({ onClose, initialName = "" }) {
  return <InviteSheetBase context={null} initialName={initialName} onClose={onClose} />;
}

export function AcceptSheet({ onClose }) {
  return <JoinSheet onClose={onClose} />;
}
