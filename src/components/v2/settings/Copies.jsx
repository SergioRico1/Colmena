import { get } from "../../../lib/api.js";
import { useResource } from "../../../lib/store.jsx";
import BackupSettings from "./Backup.jsx";
import EncryptionSettings from "./Encryption.jsx";

// Ajustes › Copias y cifrado: the encrypted backups (Backup.jsx, server/backup-service.mjs) and the
// local database encryption (Encryption.jsx, server/encryption.mjs). Encrypting needs the backups'
// password first (it makes a copy before it starts), so both live together. The last copy is the
// section's status, beside its name and under its title (status.js).

export default function CopiesSection() {
  const backup = useResource("/backup");
  const enc = useResource("/encryption");
  return (
    <>
      <BackupSettings v={backup.data} setV={backup.setData} error={backup.error} />
      <EncryptionSettings s={enc.data} reload={() => get("/encryption").then(enc.setData)} />
    </>
  );
}
