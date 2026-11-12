// A screen with unsaved work (the note editor) may hold a navigation: `guard(to)` returns
// false to stop it and asks the person; a forced navigation goes through once they answer
// (lib/router.jsx navigate(to, { force: true })).
let leaveGuard = null;

/** Sets the guard and returns how to remove it. Only the last one set is asked. */
export function setLeaveGuard(guard) {
  leaveGuard = guard;
  return () => { if (leaveGuard === guard) leaveGuard = null; };
}
/** May the app go to `to` now? (true when no screen holds it). */
export const mayLeave = (to) => !leaveGuard || leaveGuard(to) !== false;
