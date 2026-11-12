import BlockCard from "./BlockCard.jsx";
import RowBoundary from "../RowBoundary.jsx";
import { useResource } from "../../lib/store.jsx";
import { useHidden } from "../../lib/undoToast.js";
import { blockIdOf } from "../../lib/blocks.js";

// A live block in the conversation where it was first posted (a message of kind «block», id
// `block:<id>`: server/blocks.mjs). The message only says which block; its values are asked
// for here and again whenever the server says something changed, so a later run updates this
// same card instead of adding a message.

/** @param {{message: {id: string, kind: string, text?: string}}} p */
export default function ChatBlock({ message }) {
  const id = blockIdOf(message);
  const { data, error } = useResource(id ? "/blocks/" + encodeURIComponent(id) : null);
  const hidden = useHidden("block");
  if (!id || hidden(id)) return null;
  // Removed since (by you, from its menu): one muted line where the card was.
  if (!data?.id || data.id !== id)
    return error ? <p data-block-gone="" style={{ margin: "0", textAlign: "center", fontSize: "13px", color: "#6B6F7A" }}>{"Aquí había un dato que ya se quitó."}</p> : <div aria-busy="true" className="colmena-skeleton" style={{ alignSelf: "stretch", maxWidth: "560px", height: "132px", borderRadius: "20px" }} />;
  return (
    <div data-chat-block="" style={{ alignSelf: "stretch", maxWidth: data.type === "table" ? "100%" : "560px" }}>
      <RowBoundary label="No se ha podido mostrar este dato" resetKey={id + ":" + data.updatedAt}>
        <BlockCard block={data} where="chat" />
      </RowBoundary>
    </div>
  );
}
