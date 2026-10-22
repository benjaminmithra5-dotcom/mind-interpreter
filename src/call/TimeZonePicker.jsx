import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { allZones, searchZones } from "./timezones.js";

// A searchable list of every time zone, each labelled with today's offset,
// abbreviation, name, city and country ("(UTC+05:30) IST · India Standard
// Time · Kolkata, India"). Type an abbreviation, name, country, city, zone
// id or offset ("ist", "india", "chicago", "+5:30") to filter.
// data: the zone names (loaded lazily by the page); until it arrives the
// labels show only the offset and the zone id.
export function TimeZonePicker({ ui, c, value, onChange, data }) {
  const zones = useMemo(() => allZones(new Date(), data), [data]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Leaving the field closes the list a moment later (so a click on an
  // option still lands). Coming back or typing cancels that pending close.
  const closeTimer = useRef(null);
  const cancelClose = () => { clearTimeout(closeTimer.current); closeTimer.current = null; };
  useEffect(() => cancelClose, []);
  const listRef = useRef(null);
  const id = useId();
  const current = zones.find((z) => z.id === value);

  const filtered = useMemo(() => searchZones(zones, query), [query, zones]);
  const inputRef = useRef(null);

  function choose(zone) {
    onChange(zone.id);
    setOpen(false);
    setQuery("");
  }
  function openList() {
    cancelClose();
    setOpen(true);
    setQuery("");
    const i = Math.max(0, zones.findIndex((z) => z.id === value));
    setActive(i);
  }
  function onKeyDown(e) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); openList(); return; }
    if (e.key === "Enter") e.preventDefault(); // never a new line
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === "Tab") setOpen(false);
    else if (e.key === "Escape") { setOpen(false); setQuery(""); }
  }
  // The field is a textarea so a long label can wrap onto a second line;
  // it grows to fit its text and never takes a new line from Enter.
  const shown = open ? query : current ? current.label : value;
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [shown]);

  // Keep the highlighted zone in view while moving with the arrow keys.
  useEffect(() => {
    if (open) listRef.current?.children[active]?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }} data-testid="tz-picker">
      <label style={ui.label} htmlFor={`${id}-input`}>Your time zone</label>
      <textarea
        id={`${id}-input`}
        ref={inputRef}
        rows={1}
        style={{ ...ui.input, resize: "none", overflow: "hidden", lineHeight: 1.4, display: "block" }}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        spellCheck="false"
        placeholder="Type a city, country or abbreviation"
        value={shown}
        onFocus={openList}
        onClick={() => !open && openList()}
        onBlur={() => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 120); }}
        onChange={(e) => { cancelClose(); setQuery(e.target.value); setActive(0); setOpen(true); }}
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
