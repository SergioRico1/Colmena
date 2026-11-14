// The accessibility snapshot and blocker detection of the bots' browser are the desktop's own
// (desktop/axsnapshot.cjs: pure functions, no Electron). The cloud browser (browser-cloud.mjs)
// uses them as they are, so a page reads the same to a bot in either place.
import axsnapshot from "../../desktop/axsnapshot.cjs";

export const snapshotTools = () => ({ buildSnapshot: axsnapshot.buildSnapshot, detectBlocker: axsnapshot.detectBlocker });
