// Hosted Colmena's pages before the app (docs/CLOUD.md › Phase 1 › Web): sign in by email link,
// the link itself, your companies (create, open, manage) and an invitation. A separate Vite
// entry (cloud.html) so they load without a session; the Worker serves them at /entrar,
// /entrar/verificar, /empresa and /invitacion.
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/poppins/800.css";
import "../styles/base.css";
import "./cloud.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SignIn, Verify } from "./SignIn.jsx";
import { Companies } from "./Companies.jsx";
import { Invitation } from "./Invitation.jsx";
import { ApproveDesktop, DesktopSignIn } from "./Desktop.jsx";

function Page() {
  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/entrar/verificar") return <Verify />;
  if (path === "/entrar/escritorio") return <DesktopSignIn />;
  if (path === "/entrar/escritorio/aprobar") return <ApproveDesktop />;
  if (path === "/entrar") return <SignIn />;
  if (path === "/invitacion") return <Invitation />;
  return <Companies />;
}

createRoot(document.getElementById("root")).render(<StrictMode><Page /></StrictMode>);
