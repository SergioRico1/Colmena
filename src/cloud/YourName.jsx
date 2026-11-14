// «Tu nombre»: asked once, where it is first needed (creating a company, accepting an
// invitation), so the team and the bots don't greet «ana.garcia». An account made by the sign-in
// link is named after its address until then (cloud/src/directory-core.js).

export function YourName({ value, onChange, autoFocus = false }) {
  return (
    <div className="cl-field">
      <label className="cl-label" htmlFor="your-name">Tu nombre</label>
      <input id="your-name" className="cl-input" autoFocus={autoFocus} autoComplete="name" maxLength={80} required placeholder="Por ejemplo, Ana García" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby="your-name-note" />
      <span className="cl-note" id="your-name-note">Así te ven tu equipo y tus bots.</span>
    </div>
  );
}
