import { useState } from "react";
import {
  siAirtable, siAsana, siAtlassian, siClickup, siCloudflare, siDropbox, siFigma, siGithub, siGmail, siGooglecalendar,
  siGoogledrive, siGooglesheets, siHubspot, siIntercom, siLinear, siMiro, siNotion, siPaypal, siSentry, siSquare,
  siStripe, siSupabase, siVercel, siWebflow, siWix, siZapier,
} from "simple-icons";

// Each app's logo: simple-icons (CC0) in its brand colour; for brands that are not there the
// site's own icon (server/mcp/routes.mjs) or Composio's; a monogram as the last resort.
const ICONS = {
  airtable: siAirtable, asana: siAsana, atlassian: siAtlassian, clickup: siClickup, cloudflare: siCloudflare, dropbox: siDropbox,
  figma: siFigma, github: siGithub, gmail: siGmail, googlecalendar: siGooglecalendar, googledrive: siGoogledrive,
  googlesheets: siGooglesheets, hubspot: siHubspot, intercom: siIntercom, linear: siLinear, miro: siMiro, notion: siNotion,
  paypal: siPaypal, sentry: siSentry, square: siSquare, stripe: siStripe, supabase: siSupabase, vercel: siVercel,
  webflow: siWebflow, wix: siWix, zapier: siZapier,
};
// Brand colours too light to read on white get a darker shade of themselves.
const ON_WHITE = { miro: "#050038", square: "#3E4348" };

export default function AppLogo({ id, name, logo = null, size = 36 }) {
  const [broken, setBroken] = useState(false);
  const tile = { width: size + "px", height: size + "px", flexShrink: "0", borderRadius: Math.round(size * 0.3) + "px", display: "flex", alignItems: "center", justifyContent: "center" };
  const icon = ICONS[id];
  if (icon)
    return (
      <span aria-hidden="true" style={{ ...tile, background: "#F6F6F3" }}>
        <svg width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} viewBox="0 0 24 24" fill={ON_WHITE[id] || "#" + icon.hex}><path d={icon.path} /></svg>
      </span>
    );
  if (logo && !broken)
    return (
      <span aria-hidden="true" style={{ ...tile, background: "#F6F6F3" }}>
        <img src={logo} alt="" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} onError={() => setBroken(true)} style={{ objectFit: "contain" }} />
      </span>
    );
  return <span aria-hidden="true" style={{ ...tile, background: "#EEEEE9", fontSize: Math.round(size * 0.4) + "px", fontWeight: "600", color: "#12131A" }}>{(name || "?").charAt(0).toUpperCase()}</span>;
}
