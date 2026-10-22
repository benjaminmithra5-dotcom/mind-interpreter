import { useEffect, useId, useMemo, useRef, useState } from "react";
import { allZones } from "./timezones.js";

// A searchable list of every time zone, each with its current UTC offset.
// Type a city, region or offset ("kolkata", "london", "+05:30") to filter.
export function TimeZonePicker({ ui, c, value, onChange }) {
  const zones = useMemo(() => allZones(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const id = useId();
  const current = zones.find((z) => z.id === value);

  const filtered = useMemo(() => {
    const terms = query.trim().toLowerCase().replace(/[−]/g, "-").split(/\s+/).filter(Boolean);
    if (!terms.length) return zones;
    return zones.filter((z) => terms.every((t) => z.search.includes(t)));
  }, [query, zones]);

  function choose(zone) {
    onChange(zone.id);
    setOpen(false);
    setQuery("");
  }
  function openList() {
    setOpen(true);
    setQuery("");
    const i = Math.max(0, zones.findIndex((z) => z.id === value));
    setActive(i);
  }
  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); openList(); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }
  // Keep the highlighted zone in view while moving with the arrow keys.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }} data-testid="tz-picker">
      <label style={ui.label} htmlFor={`${id}-input`}>Your time zone</label>
      <input
        id={`${id}-input`}
        style={ui.input}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck="false"
        placeholder="Type a city or region"
        value={open ? query : current ? current.label : value}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={onKeyDown}
        data-testid="tz-input"
      />
      {open && (
        <ul
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          aria-label="Time zones"
          style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 260, overflowY: "auto", border: `1px solid ${c.fieldBorder}`, borderRadius: 8, background: c.surface }}
          data-testid="tz-list"
        >
          {filtered.length === 0 && <li style={{ ...ui.small, padding: "8px 10px" }}>No matching time zone.</li>}
          {filtered.map((z, i) => (
            <li
              key={z.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={z.id === value}
              data-zone={z.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(z)}
              onMouseEnter={() => setActive(i)}
              style={{
                ...ui.text, fontSize: 15, padding: "7px 10px", borderRadius: 6, cursor: "pointer", overflowWrap: "anywhere",
                background: i === active ? c.panelHover : "transparent", fontWeight: z.id === value ? 700 : 400,
              }}
            >
              {z.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
