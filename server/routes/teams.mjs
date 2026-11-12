// /api/teams…: teams of people (server/peers/teams.mjs; docs/PEOPLE.md › Equipos).
// GET  /api/teams                              [{id, name, people, bots, admin, current}]; alone, one «solo» entry
// GET  /api/teams/pending                      teams you asked to join and are not in yet
// PUT  /api/teams/current {id}                 the team the sidebar shows (settings.currentTeam)
// POST /api/teams {name}                       create one (you administer it)
// POST /api/teams/join {code}                  with a team's invitation code
// GET  /api/teams/:id                          name, members with their bots, presence and status; open codes for admins
// PATCH /api/teams/:id {name}                  rename (admins)
// POST /api/teams/:id/invite {name?}           → {code, text, expiresAt}: one person, 24 hours (admins)
// POST /api/teams/:id/leave                    you go (its creator closes it for everyone)
// DELETE /api/teams/:id/members/:address       take someone out (admins)
// PUT|DELETE /api/teams/:id/admins/:address    name or unname an admin (admins)
// POST /api/teams/:id/members/:address/dm      a direct conversation with a teammate, without a code
import { z } from "zod";
import { PeerError, PEER_LIMITS } from "../peers/service.mjs";
import { soloView, teamsList, TEAM_LIMITS } from "../peers/teams.mjs";
import { HttpError, check } from "./shared.mjs";

/** Teams: the list, the one the sidebar shows, and what its admins and members can do. */
export function registerTeamRoutes(app, { store, getPeers }) {
  const teams = () => {
    const p = getPeers();
    if (!p?.identity || !p.teams) throw new HttpError(503, "«Personas» se está preparando. Prueba en unos segundos.");
    return p.teams;
  };
  // Service errors keep their status (404, 409…); the app's handler turns them into JSON.
  const run = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      if (error instanceof PeerError) throw new HttpError(error.status, error.message);
      throw error;
    }
  };
  const teamId = z.string().trim().min(4).max(64);
  const address = z.string().trim().length(43);
  const name = z.object({ name: z.string().trim().min(1).max(TEAM_LIMITS.name) }).strict();

  // These two answer before «Personas» has its keys: alone, the sidebar still has a header.
  app.get("/api/teams", run(() => teamsList(store, getPeers())));
  app.get("/api/teams/pending", run(() => teams().pending()));
  app.put("/api/teams/current", run((req) => {
    const { id } = check(z.object({ id: teamId }).strict(), req.body);
    const p = getPeers();
    return id === "solo" && !(p?.identity && p.teams) ? teamsList(store, p) : teams().setCurrent(id);
  }));
  app.post("/api/teams", run((req) => teams().create(check(name, req.body).name)));
  app.post("/api/teams/join", run((req) => teams().join(check(z.object({ code: z.string().trim().min(16).max(60) }).strict(), req.body).code)));
  app.get("/api/teams/:id", run((req) => {
    const p = getPeers();
    return req.params.id === "solo" && !(p?.identity && p.teams) ? soloView(store, p) : teams().view(teamId.parse(req.params.id));
  }));
  app.patch("/api/teams/:id", run((req) => teams().rename(teamId.parse(req.params.id), check(name, req.body).name)));
  app.post("/api/teams/:id/invite", run((req) => teams().invite(teamId.parse(req.params.id), check(z.object({ name: z.string().trim().max(PEER_LIMITS.name).optional() }).strict(), req.body ?? {}).name || "")));
  app.post("/api/teams/:id/leave", run((req) => teams().leave(teamId.parse(req.params.id))));
  app.delete("/api/teams/:id/members/:address", run((req) => teams().remove(teamId.parse(req.params.id), address.parse(req.params.address))));
  app.put("/api/teams/:id/admins/:address", run((req) => teams().setAdmin(teamId.parse(req.params.id), address.parse(req.params.address), true)));
  app.delete("/api/teams/:id/admins/:address", run((req) => teams().setAdmin(teamId.parse(req.params.id), address.parse(req.params.address), false)));
  app.post("/api/teams/:id/members/:address/dm", run((req) => teams().openDm(teamId.parse(req.params.id), address.parse(req.params.address))));
}
