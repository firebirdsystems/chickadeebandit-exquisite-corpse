// Mirrors the handful of /hub-sdk.js helpers that pure logic depends on, so
// logic.js (and its tests) never import the browser-only SDK.

export function isAdult(member) {
  return !!member && member.role === "adult";
}

export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}
