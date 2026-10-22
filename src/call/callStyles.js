// Styles for the Talk now pages, built from the site's theme (COLORS and
// fonts are passed in from App.jsx), so they match the rest of the site.
export function callStyles(c, font) {
  const panel = { width: "100%", background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, padding: "18px 20px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12, textAlign: "left" };
  const btn = { fontFamily: font.display, fontSize: 15, letterSpacing: "0.04em", textTransform: "uppercase", border: "none", borderRadius: 6, padding: "12px 22px", cursor: "pointer" };
  return {
    wrap: { width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: "8px 0 20px" },
    panel,
    panelTitle: { fontFamily: font.display, fontWeight: 500, fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", color: c.accent, margin: 0 },
    text: { fontFamily: font.body, fontSize: 16, lineHeight: 1.6, color: c.ink, margin: 0 },
    small: { fontFamily: font.body, fontSize: 14.5, lineHeight: 1.55, color: c.muted, margin: 0 },
    price: { fontFamily: font.body, fontSize: 17, lineHeight: 1.6, color: c.ink, margin: 0, textAlign: "center" },
    link: { color: c.accent, textDecoration: "none" },
    badge: { display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 999, background: c.surface, border: `1px solid ${c.line}`, fontFamily: font.display, fontWeight: 500, fontSize: 15, letterSpacing: "0.04em", color: c.ink },
    dot: { width: 10, height: 10, borderRadius: "50%", flexShrink: 0 },
    label: { fontFamily: font.display, fontWeight: 500, fontSize: 13, letterSpacing: "0.05em", textTransform: "uppercase", color: c.muted, display: "flex", flexDirection: "column", gap: 6 },
    input: { fontFamily: font.body, fontSize: 16, color: c.ink, background: c.playfield, border: `1px solid ${c.fieldBorder}`, borderRadius: 8, padding: "10px 12px", width: "100%", boxSizing: "border-box", minWidth: 0 },
    row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
    btn: { ...btn, background: c.accent, color: c.onAccent, WebkitTextStroke: "var(--text-outline-on-accent)" },
    btnQuiet: { ...btn, background: "transparent", color: c.accent, border: `1px solid ${c.strongLine}` },
    btnDanger: { ...btn, background: c.bad, color: "#FFFFFF" },
    error: { fontFamily: font.body, fontSize: 15, color: c.bad, margin: 0 },
    success: { fontFamily: font.body, fontSize: 15, color: c.good, margin: 0 },
    meterTrack: { width: "100%", height: 10, borderRadius: 5, background: c.panelHover, border: `1px solid ${c.line}`, overflow: "hidden" },
    meterFill: { height: "100%", background: c.accent, transition: "width 80ms linear" },
    clock: { fontFamily: font.mono, fontWeight: 700, fontSize: 40, color: c.accent, margin: 0, textAlign: "center" },
    banner: { width: "100%", boxSizing: "border-box", borderRadius: 10, padding: "12px 14px", fontFamily: font.body, fontSize: 15.5, lineHeight: 1.5, background: c.secondary, border: `1px solid ${c.strongLine}`, color: c.ink, textAlign: "center", margin: 0 },
    notice: { fontFamily: font.body, fontSize: 14, lineHeight: 1.6, color: c.muted, margin: 0, textAlign: "center", borderTop: `1px solid ${c.line}`, paddingTop: 16, width: "100%" },
  };
}

export const STATUS_COLOR = (c) => ({ available: c.good, on_call: c.accent, away: c.faint, checking: c.faint });
