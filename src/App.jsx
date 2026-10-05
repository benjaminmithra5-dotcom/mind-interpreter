import { Fragment, useState, useEffect, useRef, useMemo, createContext, useContext } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import * as Tone from "tone";
import { marked } from "marked";
import { parseArticle, sortArticles, formatArticleDate } from "./articleFormat.js";

// =================================================================
// Theme, dark and warm on purpose. Nothing in this game should sit
// at the same visual weight as anything else, tiles need to pop.
// =================================================================
const COLORS = {
  bg: "#06131B",
  secondary: "#091B24",
  surface: "#0C202A",
  playfield: "#040D13",
  panel: "#0C202A",
  ink: "#E9E5DA",
  muted: "#A8B5BA",
  faint: "#71838B",
  good: "#58B49F",
  bad: "#C96B5B",
  gold: "#E2AA3B",
  goldHover: "#F0BD4D",
  goldDark: "#B98220",
  line: "#29414B",
  strongLine: "#3A5661",
  cardBg: "#121526",
  cardBorder: "#302F4D",
};
const ThemeContext = createContext(COLORS);
function useColors() {
  return useContext(ThemeContext);
}

const font = {
  display: `'Oswald', 'Arial Narrow', sans-serif`,
  body: `'Source Serif 4', Georgia, serif`,
  mono: `'Space Mono', monospace`,
  bio: `'Source Serif 4', Georgia, serif`,
};
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Space+Mono:wght@400;700&display=swap');`;

// =================================================================
// Sound. Lazy synths, started on first real user gesture.
// =================================================================
let synths = null;
function ensureAudio() {
  if (!synths) {
    synths = {
      correct: new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 } }).toDestination(),
      miss: new Tone.Synth({ oscillator: { type: "triangle" }, envelope: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.1 } }).toDestination(),
      level: new Tone.PolySynth(Tone.Synth, { envelope: { attack: 0.001, decay: 0.2, sustain: 0.05, release: 0.3 } }).toDestination(),
    };
  }
}
async function playCorrect() {
  try { await Tone.start(); ensureAudio(); synths.correct.triggerAttackRelease("C6", "16n"); } catch (e) {}
}
async function playMiss() {
  try { await Tone.start(); ensureAudio(); synths.miss.triggerAttackRelease("G2", "8n"); } catch (e) {}
}
async function playLevelUp() {
  try { await Tone.start(); ensureAudio(); const now = Tone.now(); synths.level.triggerAttackRelease(["C5", "E5", "G5"], "8n", now); } catch (e) {}
}

// =================================================================
// Pools and helpers
// =================================================================
const EMOJI_POOL = ["🍎","🍌","🍇","🍉","🍒","🍋","🥝","🍑","🍍","🥕","🌽","🍄","🐝","🐞","🦋","🐢","🐬","🐳","🦉","🦊","🐨","🐼","🦁","🐯","🐴","🐔","🐟","⚽","🏀","🎲","🎧","📚","🔑","💡","🕯️","⌛","🧭","🪙","📎","✂️"];
const WORD_POOL = [
  "tree","river","chair","quiet","bridge","window","mountain","silver","garden","ocean",
  "candle","forest","pencil","shadow","harbor","cotton","whisper","blanket","thunder","orange",
  "valley","castle","ribbon","pepper","ladder","feather","journey","whistle","meadow","compass",
  "lantern","granite","hollow","marble","cinder","brook","quarry","copper","violet","anchor",
  "canyon","pillow","signal","autumn","cradle","gravel","harvest","kindle","linen","maple",
  "needle","orchard","pebble","quilt","raven","satin","tunnel","umbrella","velvet","willow",
];
const CELEBRATIONS = ["On a roll.", "Locked in.", "Sharp.", "Dialed in.", "Clean.", "Nice streak."];

const CARD_SUITS = [
  { sym: "♠", red: false }, { sym: "♥", red: true },
  { sym: "♦", red: true }, { sym: "♣", red: false },
];
const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
function buildDeck() {
  const deck = [];
  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) {
      deck.push({ id: `${rank}${suit.sym}`, rank, suit: suit.sym, red: suit.red });
    }
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function kimsLayoutRows(n) {
  const table = { 3: [3], 4: [4], 5: [3, 2], 6: Math.random() < 0.5 ? [3, 3] : [4, 2], 7: [4, 3], 8: [4, 4] };
  return table[n] || null;
}
function pick(pool) { return pool[randInt(0, pool.length - 1)]; }
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function formatStopwatch(ms) {
  const clamped = Math.max(0, ms);
  const hh = Math.floor(clamped / 3600000);
  const mm = Math.floor((clamped % 3600000) / 60000);
  const ss = Math.floor((clamped % 60000) / 1000);
  const cs = Math.floor((clamped % 1000) / 10);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(hh)}:${p(mm)}:${p(ss)}:${p(cs)}`;
}

// A small running clock, shared shape used by Card / Word / Number
// Memory. Keeps counting from the moment a screen mounts until the
// caller stops it, so the badge in the corner always reads true.
// pause()/resume() freeze and continue the same running total,
// unlike start() which always resets back to zero.
function useRunningClock() {
  const [ms, setMs] = useState(0);
  const startRef = useRef(Date.now());
  const intervalRef = useRef(null);
  const accumulatedRef = useRef(0);
  const tick = () => setMs(accumulatedRef.current + (Date.now() - startRef.current));
  const start = () => {
    accumulatedRef.current = 0;
    startRef.current = Date.now();
    setMs(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(tick, 30);
  };
  const stop = () => {
    let total = accumulatedRef.current;
    if (intervalRef.current) { total += Date.now() - startRef.current; clearInterval(intervalRef.current); intervalRef.current = null; }
    return total;
  };
  const pause = () => {
    if (!intervalRef.current) return;
    accumulatedRef.current += Date.now() - startRef.current;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setMs(accumulatedRef.current);
  };
  const resume = () => {
    if (intervalRef.current) return;
    startRef.current = Date.now();
    intervalRef.current = setInterval(tick, 30);
  };
  useEffect(() => { start(); return () => { if (intervalRef.current) clearInterval(intervalRef.current); }; }, []);
  return { ms, start, stop, pause, resume };
}

// =================================================================
// Games list (Everyday Memory)
// =================================================================
const GAMES = [
  { key: "numbers", label: "Digit Span" },
  { key: "verbal", label: "Word Recall" },
  { key: "kims", label: "Kim's Game" },
  { key: "sequence", label: "Pattern Recall" },
  { key: "chimp", label: "Flash Grid" },
  { key: "detective", label: "Detective Case" },
];
const GAME_LABEL = Object.fromEntries(GAMES.map((g) => [g.key, g.label]));
const GAME_DESCRIPTION = {
  numbers: "Memorize the string of digits shown, then type it back exactly before time runs out.",
  verbal: "Decide whether each word is new or one you've already seen earlier in the round.",
  kims: "Study the objects on display, then pick out every one of them again from a larger set.",
  sequence: "Watch the tiles flash in order, then repeat the exact sequence back by clicking them in turn.",
  chimp: "Memorize where each number sits on the grid, then tap them back in order starting from 1.",
  detective: "Read through the case details, then name who did it and explain the reasoning behind your answer.",
};

// =================================================================
// Numbers Memory (Digit Span, part of Everyday Memory)
// =================================================================
function NumbersMemory({ onFail, onProgress }) {
  const c = useColors();
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const level = roundsCompleted + 1;
  const totalSeconds = level + 3;
  const digits = useMemo(() => Array.from({ length: level + 2 }, () => randInt(0, 9)).join(""), [roundsCompleted]);
  const [phase, setPhase] = useState("view");
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [input, setInput] = useState("");
  const [shake, setShake] = useState(false);

  useEffect(() => { setPhase("view"); setSecondsLeft(totalSeconds); setInput(""); setShake(false); }, [roundsCompleted]);

  useEffect(() => {
    if (phase !== "view") return;
    if (secondsLeft <= 0) { setPhase("input"); return; }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  const submit = () => {
    if (input.trim() === digits) {
      playLevelUp(); onProgress(); setRoundsCompleted((r) => r + 1);
    } else {
      playMiss(); setShake(true);
      setTimeout(() => onFail(roundsCompleted), 320);
    }
  };

  return (
    <div style={styles(c).gameBox}>
      {phase === "view" ? (
        <>
          <p style={{ ...styles(c).digitDisplay, ...(shake ? styles(c).shakeAnim : {}) }}
            onCopy={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()} onDragStart={(e) => e.preventDefault()}>
            {digits}
          </p>
          <div style={styles(c).timerTrack}><div style={{ ...styles(c).timerFill, width: `${(secondsLeft / totalSeconds) * 100}%` }} /></div>
        </>
      ) : (
        <>
          <p style={styles(c).instruction}>Type it back.</p>
          <input style={{ ...styles(c).textInput, ...(shake ? styles(c).shakeAnim : {}) }} value={input}
            onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ""))} autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button style={styles(c).btnPrimary} onClick={submit}>Submit</button>
        </>
      )}
    </div>
  );
}

// =================================================================
// Verbal Memory
// =================================================================
function VerbalMemory({ onFail, onProgress }) {
  const c = useColors();
  const bank = useRef(shuffle(WORD_POOL)).current;
  const bankIdx = useRef(0);
  const shown = useRef([]);
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [shake, setShake] = useState(false);

  const generateNext = () => {
    const canRepeat = shown.current.length > 1;
    const doRepeat = canRepeat && Math.random() < 0.45;
    if (doRepeat) {
      const word = shown.current[randInt(0, shown.current.length - 1)];
      return { word, isRepeat: true };
    }
    const word = bank[bankIdx.current % bank.length];
    bankIdx.current++;
    shown.current.push(word);
    return { word, isRepeat: false };
  };

  const [current, setCurrent] = useState(() => generateNext());

  const answer = (saysRepeat) => {
    if (saysRepeat === current.isRepeat) {
      playCorrect(); onProgress(); setRoundsCompleted((r) => r + 1); setCurrent(generateNext());
    } else {
      playMiss(); setShake(true);
      setTimeout(() => onFail(roundsCompleted), 320);
    }
  };

  return (
    <div style={styles(c).gameBox}>
      <p style={{ ...styles(c).wordDisplay, ...(shake ? styles(c).shakeAnim : {}) }}>{current.word}</p>
      <div style={styles(c).rowButtons}>
        <button style={styles(c).btnGhost} onClick={() => answer(false)}>New word</button>
        <button style={styles(c).btnGhost} onClick={() => answer(true)}>Seen it</button>
      </div>
    </div>
  );
}

// =================================================================
// Kim's Game
// =================================================================
function KimsGame({ onFail, onProgress }) {
  const c = useColors();
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const level = roundsCompleted + 1;
  const n = level + 2;
  const totalSeconds = 10;
  const [phase, setPhase] = useState("view");
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [found, setFound] = useState(new Set());
  const [bounce, setBounce] = useState(null);
  const [shake, setShake] = useState(false);
  const [locked, setLocked] = useState(false);

  const data = useMemo(() => {
    const pool = shuffle(EMOJI_POOL);
    const originalsArr = pool.slice(0, n);
    const originalsSet = new Set(originalsArr);
    const distractors = pool.slice(n, n * 2);
    const choices = shuffle([...originalsArr, ...distractors]);
    const rows = kimsLayoutRows(n);
    let scatterPositions = null;
    if (!rows) {
      const cols = Math.ceil(Math.sqrt(n * 1.6));
      const rowCount = Math.ceil(n / cols);
      const cells = shuffle(Array.from({ length: cols * rowCount }, (_, i) => i)).slice(0, n);
      scatterPositions = cells.map((cell) => {
        const cx = cell % cols; const cy = Math.floor(cell / cols);
        const jx = Math.random() * 0.5 - 0.25; const jy = Math.random() * 0.5 - 0.25;
        return { left: ((cx + 0.5 + jx) / cols) * 100, top: ((cy + 0.5 + jy) / rowCount) * 100 };
      });
    }
    return { originalsSet, originalsArr, choices, rows, scatterPositions };
  }, [roundsCompleted]);

  useEffect(() => { setPhase("view"); setSecondsLeft(totalSeconds); setFound(new Set()); setShake(false); setLocked(false); }, [roundsCompleted]);

  useEffect(() => {
    if (phase !== "view") return;
    if (secondsLeft <= 0) { setPhase("answer"); return; }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, secondsLeft]);

  const click = (item) => {
    if (locked || found.has(item)) return;
    if (data.originalsSet.has(item)) {
      playCorrect(); setBounce(item);
      setTimeout(() => setBounce((b) => (b === item ? null : b)), 150);
      const next = new Set(found); next.add(item); setFound(next);
      if (next.size === data.originalsSet.size) { playLevelUp(); onProgress(); setRoundsCompleted((r) => r + 1); }
    } else {
      playMiss(); setShake(true); setLocked(true);
      setTimeout(() => onFail(roundsCompleted), 320);
    }
  };

  return (
    <div style={styles(c).gameBox}>
      {phase === "view" ? (
        <>
          {data.rows ? (
            <div style={styles(c).emojiRowsWrap}>
              {(() => {
                let idx = 0;
                return data.rows.map((count, ri) => {
                  const slice = data.originalsArr.slice(idx, idx + count); idx += count;
                  return (<div key={ri} style={styles(c).emojiRow}>{slice.map((e, i) => (<span key={i} style={styles(c).emojiTile}>{e}</span>))}</div>);
                });
              })()}
            </div>
          ) : (
            <div style={styles(c).scatterWrap}>
              {data.originalsArr.map((e, i) => (
                <span key={i} style={{ ...styles(c).emojiTile, ...styles(c).scatterTile, left: `${data.scatterPositions[i].left}%`, top: `${data.scatterPositions[i].top}%` }}>{e}</span>
              ))}
            </div>
          )}
          <div style={styles(c).timerTrack}><div style={{ ...styles(c).timerFill, width: `${(secondsLeft / totalSeconds) * 100}%` }} /></div>
        </>
      ) : (
        <div style={{ ...styles(c).emojiGrid, ...(shake ? styles(c).shakeAnim : {}) }}>
          {data.choices.map((e, i) => (
            <button key={i} className="tile-btn" onClick={(ev) => { ev.currentTarget.blur(); click(e); }}
              style={{ ...styles(c).emojiTile, ...styles(c).emojiChoice, ...(found.has(e) ? styles(c).emojiChosen : {}), ...(bounce === e ? styles(c).bounceAnim : {}) }}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// =================================================================
// Sequence Memory
// =================================================================
function SequenceMemory({ onFail, onProgress }) {
  const c = useColors();
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const level = roundsCompleted + 1;
  const dim = level <= 2 ? 3 : level <= 5 ? 4 : level <= 9 ? 5 : level <= 14 ? 6 : 7;
  const total = dim * dim;
  const seqLength = level + 2;

  const sequence = useMemo(() => Array.from({ length: seqLength }, () => randInt(0, total - 1)), [roundsCompleted]);
  const [phase, setPhase] = useState("show");
  const [activeTile, setActiveTile] = useState(null);
  const [bounce, setBounce] = useState(null);
  const [shake, setShake] = useState(false);
  const [locked, setLocked] = useState(false);
  const [expected, setExpected] = useState(0);

  useEffect(() => {
    setPhase("show"); setExpected(0); setBounce(null); setShake(false); setLocked(false);
    let cancelled = false; let idx = 0;
    function step() {
      if (cancelled) return;
      if (idx >= sequence.length) { setPhase("input"); return; }
      setActiveTile(sequence[idx]);
      setTimeout(() => {
        if (cancelled) return;
        setActiveTile(null);
        setTimeout(() => { if (!cancelled) { idx++; step(); } }, 450);
      }, 800);
    }
    step();
    return () => { cancelled = true; };
  }, [roundsCompleted]);

  const click = (tile) => {
    if (phase !== "input" || locked) return;
    if (tile === sequence[expected]) {
      playCorrect(); setBounce(tile);
      setTimeout(() => setBounce((b) => (b === tile ? null : b)), 150);
      const next = expected + 1;
      if (next === sequence.length) { playLevelUp(); onProgress(); setRoundsCompleted((r) => r + 1); } else { setExpected(next); }
    } else {
      playMiss(); setShake(true); setLocked(true);
      setTimeout(() => onFail(roundsCompleted), 320);
    }
  };

  return (
    <div style={styles(c).gameBox}>
      <div style={{ ...styles(c).visualGrid, gridTemplateColumns: `repeat(${dim}, 1fr)`, gap: 12, maxWidth: Math.min(520, dim * 112), ...(shake ? styles(c).shakeAnim : {}) }}>
        {Array.from({ length: total }).map((_, i) => (
          <button key={i} className="tile-btn" onClick={(ev) => { ev.currentTarget.blur(); click(i); }}
            style={{ ...styles(c).sqTile, aspectRatio: "1 / 1", width: "100%", height: "auto", ...(activeTile === i ? styles(c).sqTileActive : {}), ...(bounce === i ? styles(c).bounceAnim : {}) }} />
        ))}
      </div>
    </div>
  );
}

// =================================================================
// Chimp Test
// =================================================================
function ChimpTest({ onFail, onProgress }) {
  const c = useColors();
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const level = roundsCompleted + 1;
  const count = level + 3;
  const cols = Math.ceil(Math.sqrt(count * 1.3));

  const tiles = useMemo(() => shuffle(Array.from({ length: count }, (_, i) => i + 1)), [roundsCompleted]);
  const [revealed, setRevealed] = useState(true);
  const [nextExpected, setNextExpected] = useState(1);
  const [used, setUsed] = useState(new Set());
  const [bounce, setBounce] = useState(null);
  const [shake, setShake] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => { setRevealed(true); setNextExpected(1); setUsed(new Set()); setShake(false); setLocked(false); }, [roundsCompleted]);

  const click = (value) => {
    if (locked || used.has(value)) return;
    if (value === nextExpected) {
      playCorrect(); setBounce(value);
      setTimeout(() => setBounce((b) => (b === value ? null : b)), 150);
      if (nextExpected === 1) setRevealed(false);
      const nextUsed = new Set(used); nextUsed.add(value); setUsed(nextUsed);
      if (nextExpected === count) { playLevelUp(); onProgress(); setRoundsCompleted((r) => r + 1); } else { setNextExpected(nextExpected + 1); }
    } else {
      playMiss(); setShake(true); setLocked(true);
      setTimeout(() => onFail(roundsCompleted), 320);
    }
  };

  return (
    <div style={styles(c).gameBox}>
      <div style={{ ...styles(c).visualGrid, gridTemplateColumns: `repeat(${cols}, 1fr)`, maxWidth: cols * 60, ...(shake ? styles(c).shakeAnim : {}) }}>
        {tiles.map((v) => (
          <button key={v} className="tile-btn" onClick={(ev) => { ev.currentTarget.blur(); click(v); }} disabled={used.has(v)}
            style={{ ...styles(c).numTile, ...(used.has(v) ? styles(c).numTileUsed : {}), ...(bounce === v ? styles(c).bounceAnim : {}) }}>
            {revealed || used.has(v) ? (used.has(v) ? "" : v) : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

// =================================================================
// Detective Case
// =================================================================
const CASE_NAMES = ["Nadia","Elliot","Priya","Marcus","Sana","Devon","Farah","Milo","Talia","Rohan","Ines","Kwame","Owen","Celeste","Andre","Miriam","Victor","Noor","Callum","Josie","Petra","Simon","Lena","Reuben"];

function pickTwoDistinct(pool) { const a = pick(pool); const b = pick(pool.filter((x) => x !== a)); return [a, b]; }

function templateSelfContradiction() {
  const [culprit, witness] = pickTwoDistinct(CASE_NAMES);
  const relation = pick(["brother","sister","business partner","neighbor","assistant","cousin","tenant","housemate"]);
  const witnessRelation = pick(["wife","husband","colleague","assistant","housekeeper"]);
  const scene = pick(["home office","study","garage workshop","back porch","private study","workshop"]);
  const alibiPlace = pick(["the gym","the pharmacy","a dentist appointment","the hardware store","a coffee shop nearby","the post office","a barber appointment"]);
  const time1 = pick(["7:30 a.m.","8 a.m.","8:15 a.m.","8:30 a.m.","9 a.m."]);
  const witnessTime = pick(["7:45 a.m.","8:10 a.m.","8:20 a.m.","6:50 a.m."]);
  return {
    statements: [
      `A body was found ${pick(["in the morning", "just after dawn"])} in the ${scene}.`,
      "The police questioned everyone who had been nearby.",
      `The ${witnessRelation}, ${witness}, said they left the house around ${witnessTime}, and everything seemed normal.`,
      `The ${relation}, ${culprit}, said they arrived at the ${scene} at ${time1}, and found the body right when they got there.`,
      `${culprit} also said they had been at ${alibiPlace} that whole morning, and only found out what happened when someone called to tell them.`,
      "The detective made an arrest without asking another question.",
    ],
    answer: `The ${relation}, ${culprit}.`,
    explanation: `${culprit} gave two different accounts of the same morning, once saying they found the body themselves at ${time1}, once saying they were at ${alibiPlace} and only heard about it over the phone. Someone who was really only in one place doesn't end up with two different stories about where that place was.`,
    keywords: [relation.toLowerCase(), culprit.toLowerCase()],
  };
}
function templateWrongItem() {
  const culpritName = pick(CASE_NAMES);
  const witnessName = pick(CASE_NAMES.filter((n) => n !== culpritName));
  const scene = pick(["backyard pool","garden shed area","driveway","back patio"]);
  const time1 = pick(["9:30 p.m.","10 p.m.","11 p.m."]);
  const alibi = pick(["a business dinner across town","a work event downtown","a late meeting at the office"]);
  const weather = pick([{ cond: "rain", item: "a raincoat", ground: "dry" }, { cond: "snow", item: "a pair of snow boots", ground: "bare, with no snow on it at all" }]);
  const culpritRole = pick(["gardener","handyman","pool cleaner","landscaper","the neighbor's teenage son"]);
  const reason = pick([`had been caught in ${weather.cond} earlier that day while working, and left the item behind, forgetting to take it home`, `had borrowed the item from the shed that morning and never returned it`, `had left the item drying near the shed after an errand two days before`]);
  return {
    statements: [
      `Someone was found dead near the ${scene} at around ${time1}.`,
      `The spouse said they were at ${alibi} until well after ${time1}, confirmed by several people who were with them.`,
      `A neighbor, ${witnessName}, said they heard a noise around ${time1}, then saw someone wearing ${weather.item} leave through the side gate a few minutes later.`,
      `It had not ${weather.cond === "rain" ? "rained" : "snowed"} at all that day. The ground around the house was completely ${weather.ground}.`,
      `The ${culpritRole}, ${culpritName}, said they ${reason}.`,
      "The detective made an arrest without asking another question.",
    ],
    answer: `The ${culpritRole}, ${culpritName}.`,
    explanation: `Nobody had a real reason to be wearing ${weather.item} that night, since it hadn't ${weather.cond === "rain" ? "rained" : "snowed"} at all. The only one placed anywhere near that item was ${culpritName}. The spouse's alibi holds up, so the real question isn't who couldn't have been there, it's who had that item sitting within reach.`,
    keywords: [culpritRole.replace("the neighbor's teenage son", "son").toLowerCase(), culpritName.toLowerCase()],
  };
}
function templateGuiltyKnowledge() {
  const secret = pick([{ thing: "the safe combination", vague: "probably one of the partners' birthdays", specific: "old Mr. Whitfield's birthday", dropped: "Whitfield" },{ thing: "the security code", vague: "something to do with the founder's old address", specific: "427 Larch Street, the founder's childhood home", dropped: "Larch Street" },{ thing: "the vault password", vague: "a mash of someone's initials", specific: "J.K.M., the retired director's initials", dropped: "J.K.M." }]);
  const setting = pick(["a small law office","a family jewelry shop","a private accounting firm","an antique dealership"]);
  const internName = pick(CASE_NAMES);
  const culpritRole = pick(["junior partner","office manager's nephew","new accountant","assistant manager"]);
  const culpritName = pick(CASE_NAMES.filter((n) => n !== internName));
  return {
    statements: [
      `Cash went missing from a locked safe overnight at ${setting}. Nothing else was touched.`,
      `The person in charge said they had never shared ${secret.thing} with anyone, for security reasons.`,
      `An intern, ${internName}, said they had once overheard two staff joking that ${secret.thing} was ${secret.vague}, though they said they never caught any more than that.`,
      `The ${culpritRole}, ${culpritName}, said they had never had reason to open the safe themselves.`,
      `When asked about it, ${culpritName} said, almost offhand, "well, it wouldn't be hard, it's ${secret.specific}."`,
      `No one else in the room had mentioned ${secret.dropped} that day.`,
      "The detective made an arrest without asking another question.",
    ],
    answer: `The ${culpritRole}, ${culpritName}.`,
    explanation: `The rumor the intern overheard was vague, just "${secret.vague}", nothing specific. ${culpritName} supplied a detail nobody in the room had given them: ${secret.specific}. Knowing that much, while claiming they never needed it, is the kind of thing only someone who actually knew ${secret.thing} would say without thinking.`,
    keywords: [culpritRole.toLowerCase(), culpritName.toLowerCase()],
  };
}
function templatePreparedAlibi() {
  const item = pick(["a rare painting","an antique clock","a first edition manuscript","a piece of estate jewelry"]);
  const entry = pick(["a small window, high on the wall","a side door with a broken latch","a skylight that hadn't been used in years"]);
  const trace = pick([{ text: "a specialty oil based solvent used only in fine art restoration", role: "art restorer" },{ text: "a faint smear of a rare pipe tobacco blend", role: "antique appraiser" },{ text: "a trace of a machine lubricant used only in vintage clock repair", role: "clock restorer" }]);
  const culpritName = pick(CASE_NAMES);
  const alibiEvent = pick(["a dinner reservation until midnight, confirmed by the restaurant","a late train home, confirmed by a ticket stamp","a late arrival at a hotel an hour away, confirmed by the front desk"]);
  return {
    statements: [
      `${capitalize(item)} went missing overnight from a locked room. The only opening was ${entry}.`,
      `Staff with access included a curator, a night guard, and a visiting ${trace.role}.`,
      "The curator said they had gone home sick early that day, confirmed by a doctor's office record for that evening.",
      "The night guard said they made their usual rounds and noticed nothing unusual.",
      `The ${trace.role}, ${culpritName}, said they had left hours before closing and had ${alibiEvent}.`,
      `Investigators found ${trace.text} at the opening, something no one else on staff had access to.`,
      "The detective made an arrest without asking another question.",
    ],
    answer: `The ${trace.role}, ${culpritName}.`,
    explanation: `${culpritName}'s alibi covers the moment the item actually vanished, but the trace at the opening ties them to that spot at some point, and it's something nobody else on staff even had access to. The likely read: they set up the access point earlier in the day, before heading off to a very solid, very public alibi, so they would be somewhere else the moment it counted.`,
    keywords: [trace.role.toLowerCase(), culpritName.toLowerCase()],
  };
}
function templateImpossibleSight() {
  const culpritName = pick(CASE_NAMES);
  const culpritRole = pick(["business partner","farmhand","joint owner","longtime friend"]);
  const claimedTime = pick(["5:15 a.m.","5:30 a.m.","5:45 a.m.","5:50 a.m."]);
  const sunrise = pick(["6:40 a.m.","6:52 a.m.","7:05 a.m.","6:58 a.m."]);
  const scene = pick(["barn","stable","toolshed","loading dock"]);
  return {
    statements: [
      `Someone was found dead near the ${scene} just before dawn.`,
      `The ${culpritRole}, ${culpritName}, said they arrived at ${claimedTime} to start the morning work, as they did every day, and found the body already there.`,
      `${culpritName} said they knew right away something was wrong, because they "saw exactly how the body was lying, right when I pulled up."`,
      `Sunrise that morning, by the almanac, was at ${sunrise}. There was no moon that night.`,
      "A receipt found nearby showed the area's only floodlight bulb had burned out days earlier and had never been replaced.",
      "The detective made an arrest without asking another question.",
    ],
    answer: `The ${culpritRole}, ${culpritName}.`,
    explanation: `${culpritName} described seeing the body's exact position clearly at ${claimedTime}, well before sunrise at ${sunrise}, with no moon and no working light anywhere nearby. There was no way to see anything clearly in that dark. Either the time they gave was wrong, or they already knew what they would find, and where, before they ever needed to look.`,
    keywords: [culpritRole.toLowerCase(), culpritName.toLowerCase()],
  };
}
const CASE_TEMPLATES = [templateSelfContradiction, templateWrongItem, templateGuiltyKnowledge, templatePreparedAlibi, templateImpossibleSight];
function generateDetectiveCase(seen) {
  let result, signature, attempts = 0;
  do { const template = pick(CASE_TEMPLATES); result = template(); signature = result.statements.join("|"); attempts++; } while (seen.has(signature) && attempts < 30);
  seen.add(signature);
  return result;
}
function checkAnswer(userAnswer, current) { const normalized = userAnswer.toLowerCase(); return current.keywords.some((k) => normalized.includes(k)); }

function DetectiveCase({ onFail, onProgress }) {
  const c = useColors();
  const seen = useRef(new Set()).current;
  const [roundsCompleted, setRoundsCompleted] = useState(0);
  const [current, setCurrent] = useState(() => generateDetectiveCase(seen));
  const [userAnswer, setUserAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [shake, setShake] = useState(false);
  const isCorrect = revealed && checkAnswer(userAnswer, current);

  const submit = () => {
    setRevealed(true);
    if (checkAnswer(userAnswer, current)) { playLevelUp(); } else { playMiss(); setShake(true); }
  };
  const next = () => {
    if (isCorrect) {
      onProgress(); setRoundsCompleted((r) => r + 1); setCurrent(generateDetectiveCase(seen)); setUserAnswer(""); setRevealed(false); setShake(false);
    } else { onFail(roundsCompleted); }
  };

  return (
    <div style={styles(c).gameBox}>
      <ul style={{ ...styles(c).caseList, ...(shake ? styles(c).shakeAnim : {}) }}>
        {current.statements.map((s, i) => (<li key={i} style={styles(c).caseItem}>{s}</li>))}
      </ul>
      {!revealed ? (
        <>
          <p style={styles(c).instruction}>Who did it, and why?</p>
          <textarea style={styles(c).answerInput} value={userAnswer} onChange={(e) => setUserAnswer(e.target.value)} placeholder="Type your answer here…" rows={3} />
          <button style={styles(c).btnPrimary} onClick={submit} disabled={!userAnswer.trim()}>Submit</button>
        </>
      ) : (
        <>
          <p style={{ ...styles(c).verdict, color: isCorrect ? c.good : c.bad }}>{isCorrect ? "Correct." : "Not quite."}</p>
          <p style={styles(c).instruction}>What actually happened:</p>
          <p style={styles(c).resultText}>{current.answer} {current.explanation}</p>
          <button style={styles(c).btnPrimary} onClick={next}>{isCorrect ? "Next case" : "Continue"}</button>
        </>
      )}
    </div>
  );
}

const GAME_COMPONENTS = { numbers: NumbersMemory, verbal: VerbalMemory, kims: KimsGame, sequence: SequenceMemory, chimp: ChimpTest, detective: DetectiveCase };

// =================================================================
// Background — a single, quiet field used behind every screen so
// the whole app reads as one place. Per the design system: solid
// midnight blue, a barely-there vignette toward the deep surface
// tone for depth, and nothing else — no glow, no gradients, no
// motion competing with the content.
// =================================================================
function CosmicBackground() {
  const c = COLORS;
  return (
    <div style={styles(c).eliteWrap} aria-hidden="true">
      <div style={styles(c).eliteVignette} />
    </div>
  );
}

// =================================================================
// Home screen
// =================================================================
const SITE_HEADING = "Mind Interpreter";
const LEET_MESSAGE = "Th3 m1nd 1s n0t 4 f1x3d th1ng, 1t 3v0lv3s w1th 3v3ry qu3st10n w3 4sk. 4w4r3n3ss sh4p3s 0ur p3rc3pt10n, wh1l3 m3m0ry, 4tt3nt10n, 1ntu1t10n 4nd r34s0n1ng sh4p3 h0w w3 1nt3rpr3t th3 w0rld. P4r4psych0l0gy 1nv1t3s us t0 3xpl0r3 wh4t l13s b3y0nd 0rd1n4ry 0bs3rv4t10n, wh1l3 c0gn1t10n h3lps us qu3st10n wh4t w3 th1nk w3 kn0w. Th3r3 1s 4lw4ys m0r3 t0 3xpl0r3, 4nd th3 m1nd 1s th3 pl4c3 t0 st4rt.";


// 500 provocative, self-inquiry style questions for the rotating
// banner. Thirty are hand-written; the remaining 470 are built from
// a small set of question templates crossed with fifty abstract
// concepts (thought, memory, the self, silence, and so on), which is
// what makes writing genuinely distinct questions at this volume
// possible without repeating phrasing. Every combination is unique,
// and a final dedupe pass guards against any accidental overlap with
// the hand-written set.
const DAILY_QUESTIONS_SEED = [
  "What if your first impression is not your first perception?",
  "Can you observe a thought without following it?",
  "How much of what you experience is interpretation?",
  "What happens when you stop trying to explain what you notice?",
  "Can intuition exist before conscious reasoning?",
  "Where does observation end and interpretation begin?",
  "How much of reality reaches conscious awareness?",
  "Who is the one noticing your thoughts?",
  "What if the self you defend does not actually exist?",
  "Can you catch the moment before a thought becomes words?",
  "What is left of you when every label is removed?",
  "Is the voice in your head really you, or something you listen to?",
  "What would you notice if you stopped naming everything you see?",
  "Are you having an experience, or are you the experience itself?",
  "What if certainty is just a feeling, not a fact?",
  "Can you find the exact edge between waking and dreaming?",
  "What part of you existed before you learned your own name?",
  "Is memory something you have, or something you keep rebuilding?",
  "What if your reactions are older than your reasons?",
  "Where were you the moment before you became aware you existed?",
  "Can silence be observed, or only noticed by its absence?",
  "What are you avoiding by staying busy?",
  "If no one ever told you who you are, who would you be?",
  "Is the observer separate from what it observes?",
  "What if awareness has no location at all?",
  "Can a belief be true and still not be yours?",
  "What happens in the gap between one thought and the next?",
  "Are you thinking your thoughts, or are they simply arriving?",
  "What if the mind is not where consciousness happens?",
  "Could the story you tell about yourself be the thing hiding you?",
];

const QUESTION_CONCEPTS = [
  "thought", "awareness", "perception", "memory", "identity", "time", "emotion", "silence", "attention", "belief",
  "the self", "consciousness", "intuition", "reality", "the mind", "experience", "observation", "certainty", "meaning", "desire",
  "fear", "curiosity", "understanding", "presence", "imagination", "language", "knowledge", "control", "choice", "change",
  "resistance", "the observer", "sensation", "focus", "doubt", "clarity", "illusion", "the present moment", "your reflection", "logic",
  "instinct", "wonder", "stillness", "recognition", "interpretation", "your inner voice", "surrender", "acceptance", "connection", "separation",
];
const QUESTION_TEMPLATES = [
  (c) => `What if ${c} is not what it appears to be?`,
  (c) => `Can you observe ${c} without naming it?`,
  (c) => `Where does ${c} begin and end?`,
  (c) => `How much of ${c} are you actually creating right now?`,
  (c) => `What happens to ${c} the moment you stop analyzing it?`,
  (c) => `Is ${c} something you have, or something happening to you?`,
  (c) => `Can ${c} exist without a witness?`,
  (c) => `What remains of ${c} in complete silence?`,
  (c) => `Who is aware of ${c} before you think about it?`,
  (c) => `What if ${c} was never really yours to begin with?`,
];
function buildDailyQuestionPool() {
  const generated = [];
  for (const template of QUESTION_TEMPLATES) {
    for (const concept of QUESTION_CONCEPTS) generated.push(template(concept));
  }
  const seen = new Set();
  const pool = [];
  for (const q of [...DAILY_QUESTIONS_SEED, ...generated]) {
    if (!seen.has(q)) { seen.add(q); pool.push(q); }
  }
  return pool;
}
const DAILY_QUESTIONS = buildDailyQuestionPool();

// A comprehensive set of human emotions, each with its own background
// color in the same muted, warm, non-neon palette established for
// the original set of 26. "All emotions" is inherently open-ended
// (there's no finite, universally agreed list), so this is a wide,
// curated set covering the primary emotions and their common
// variants, grouped loosely by family (joy-toned, trust-toned,
// fear-toned, anger-toned, sadness-toned, and the more complex or
// muted states) rather than an attempt at a literal exhaustive list.
const EMOTION_COLORS = {
  JOY: "#DBBD5E", HOPE: "#CBBB8C", LOVE: "#AB465D", TRUST: "#38744B", CURIOSITY: "#E1A26C",
  WONDER: "#8DC2E7", SURPRISE: "#B2DEE9", PRIDE: "#D1A975", CONFIDENCE: "#E6A07C",
  FEAR: "#685C96", ANXIETY: "#B4ADCC", DREAD: "#3C375B", ANGER: "#B74349", RAGE: "#8D2520", PAIN: "#9B504E",
  SHAME: "#7D5C6D", GUILT: "#634E60", DISGUST: "#696F33", DESPAIR: "#223041",
  SADNESS: "#446B80", SORROW: "#355C7E", LONELINESS: "#556379", LONGING: "#91576D",
  ACCEPTANCE: "#99C094", PEACE: "#BCD9CE", SERENITY: "#CFDDDB",

  GRATITUDE: "#C5AC69", CONTENTMENT: "#B6D7B5", EXCITEMENT: "#D3A849", ENTHUSIASM: "#DEA354", AMUSEMENT: "#E7C88E",
  OPTIMISM: "#D4CC88", BLISS: "#E3D8B0", EUPHORIA: "#E5DE7D", SATISFACTION: "#DEC4A4", RELIEF: "#91C4AD",

  AWE: "#246C99", REVERENCE: "#284B63", INSPIRATION: "#8CD2E9", FASCINATION: "#1C748E", ANTICIPATION: "#E9BC9B",

  COMPASSION: "#D79EB4", EMPATHY: "#EFADAB", TENDERNESS: "#EABED0", AFFECTION: "#EB96A0", ADMIRATION: "#EFC3C2",
  PASSION: "#A73A31", DESIRE: "#9E3341", INFATUATION: "#EFACD0", HEARTBREAK: "#6A2F3C",

  JEALOUSY: "#4E602F", ENVY: "#AFBD72", CONTEMPT: "#585033", HATRED: "#641A1A",
  FRUSTRATION: "#A7513B", IRRITATION: "#E5A998", RESENTMENT: "#713A2B", BITTERNESS: "#744642",

  GRIEF: "#1B3D5F", HURT: "#8C5A5F", REGRET: "#C6B2BC", EMBARRASSMENT: "#D0A3A6", HUMILIATION: "#784857",
  MELANCHOLY: "#A4BCD7", NOSTALGIA: "#D1AF9F", HOMESICKNESS: "#AACADC",

  VULNERABILITY: "#DBCADC", CONFUSION: "#5A5C7A", OVERWHELM: "#464776", NUMBNESS: "#B0B0B0", APATHY: "#6C6965",
  INDIFFERENCE: "#C9C6C1", BOREDOM: "#595A5C", HOPELESSNESS: "#3C4657", HELPLESSNESS: "#A8B1BF",

  PANIC: "#764C8F", TERROR: "#3B2657", WORRY: "#C6C4DE", NERVOUSNESS: "#C0A7D4",
  DISAPPOINTMENT: "#5C6B76", DISCOURAGEMENT: "#4A5661", PESSIMISM: "#404448",

  DETERMINATION: "#8C4F24", COURAGE: "#A65025", CALM: "#9BC6C0",
};

// Computes plain black or white per WCAG relative-luminance rules, so
// every box gets legible text on its own background regardless of
// how light or dark that specific emotion's color is.
function getContrastText(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const lin = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.42 ? "#1B140D" : "#F3ECDD";
}

function WriteToMeForm({ style, id, submitStyle }) {
  const c = useColors();
  const [wtmName, setWtmName] = useState("");
  const [wtmEmail, setWtmEmail] = useState("");
  const [wtmMessage, setWtmMessage] = useState("");
  const [wtmError, setWtmError] = useState("");
  const [wtmStatus, setWtmStatus] = useState("idle"); // idle | sending | sent | failed

  const handleWtmSubmit = async () => {
    if (!wtmName.trim() || !wtmEmail.trim() || !wtmMessage.trim()) {
      setWtmError("Please fill in your name, email id, and message before submitting.");
      return;
    }
    setWtmError("");
    setWtmStatus("sending");
    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: wtmName.trim(), email: wtmEmail.trim(), message: wtmMessage.trim() }),
      });
      if (res.ok) {
        setWtmStatus("sent");
        setWtmName(""); setWtmEmail(""); setWtmMessage("");
      } else {
        setWtmStatus("failed");
      }
    } catch (e) {
      setWtmStatus("failed");
    }
  };

  return (
    <div id={id} style={{ ...styles(c).writeToMeWrap, ...style }}>
      <p style={styles(c).contactSubhead}>Write to Me</p>

      <div style={styles(c).writeToMeField}>
        <label style={styles(c).writeToMeLabel}>Name <span style={styles(c).writeToMeRequired}>*</span></label>
        <input type="text" style={styles(c).writeToMeInput} value={wtmName} onChange={(e) => setWtmName(e.target.value)} />
      </div>

      <div style={styles(c).writeToMeField}>
        <label style={styles(c).writeToMeLabel}>Email id <span style={styles(c).writeToMeRequired}>*</span></label>
        <input type="email" style={styles(c).writeToMeInput} value={wtmEmail} onChange={(e) => setWtmEmail(e.target.value)} />
      </div>

      <div style={styles(c).writeToMeField}>
        <label style={styles(c).writeToMeLabel}>Message <span style={styles(c).writeToMeRequired}>*</span></label>
        <textarea style={styles(c).writeToMeTextarea} value={wtmMessage} onChange={(e) => setWtmMessage(e.target.value)} />
      </div>

      {wtmError && <p style={styles(c).writeToMeError}>{wtmError}</p>}
      {wtmStatus === "sent" && <p style={styles(c).writeToMeSuccess}>Message sent. Thank you, I'll get back to you soon.</p>}
      {wtmStatus === "failed" && <p style={styles(c).writeToMeError}>Something went wrong sending that. Please try again in a moment.</p>}

      <button type="button" style={{ ...styles(c).btnPrimary, ...submitStyle }} onClick={handleWtmSubmit} disabled={wtmStatus === "sending"}>
        {wtmStatus === "sending" ? "Sending…" : "Submit"}
      </button>
    </div>
  );
}

function HomeScreen({ onNavigate, onOpenExercise }) {
  const c = useColors();
  const orderRef = useRef(shuffle(DAILY_QUESTIONS));
  const [qIndex, setQIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setQIndex((i) => {
        const next = i + 1;
        if (next >= orderRef.current.length) {
          orderRef.current = shuffle(DAILY_QUESTIONS);
          return 0;
        }
        return next;
      });
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const question = orderRef.current[qIndex];

  const scrollToWriteToMe = (e) => {
    const el = document.getElementById("write-to-me");
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <div style={styles(c).homeOuter}>
      <div style={styles(c).homeContent}>
        <div style={styles(c).homeHeader}>
          <h1 style={styles(c).siteHeading}>
            <img src="/logo.png" alt="Benjamin Mithra, Mind Interpreter logo" width="256" height="256" style={styles(c).siteLogo} />
            <span style={styles(c).siteHeadingLine}>{SITE_HEADING}</span>
          </h1>
          <p style={styles(c).siteSubtitle}>Hi, I'm Benjamin Mithra</p>
          <p style={styles(c).siteSubtitleLine}>I listen, question, and reflect on your thoughts to uncover deeper perspectives.</p>
        </div>

        <div style={styles(c).homeIntro}>
          <p style={styles(c).homeIntroText}>Private, judgment-free conversations about whatever is on your mind.</p>
          <Link to={VIEW_PATH.contact} className="nav-btn hero-btn" style={{ ...styles(c).heroBtn, ...styles(c).homeIntroBtn }}>How it works</Link>
        </div>

        <div style={styles(c).homeQuestionBox}>
          <p key={qIndex} className="fade-in" style={styles(c).homeQuestion}>{question}</p>
        </div>

        <a href="#write-to-me" onClick={scrollToWriteToMe} className="nav-btn hero-btn" style={{ ...styles(c).heroBtn, ...styles(c).homeIntroBtn, marginTop: 0 }}>Write to Me</a>

        <p style={styles(c).homePhilosophy}>
          This is a space to slow down and understand your own mind. Talk things through in a{" "}
          <Link to={VIEW_PATH.contact} style={styles(c).homeInlineLink}>private conversation</Link>, or explore on your own:{" "}
          <Link to={VIEW_PATH.exercises} style={styles(c).homeInlineLink}>Mind Exercises</Link> for calm and focus,{" "}
          <Link to={VIEW_PATH.games} style={styles(c).homeInlineLink}>Brain Games</Link> for memory and thinking, and the{" "}
          <Link to={VIEW_PATH.rvlab} style={styles(c).homeInlineLink}>RV Lab</Link> for something more curious.
        </p>

        <div style={styles(c).heroButtonsGrid}>
          <Link to="/games/chess" className="nav-btn hero-btn" style={{ ...styles(c).heroBtn, ...styles(c).heroGridBtn }}>Play Chess</Link>{" "}
          <Link to="/exercises/guilfords-test" className="nav-btn hero-btn" style={{ ...styles(c).heroBtn, ...styles(c).heroGridBtn }}>Try Guilford's Test</Link>{" "}
          <Link to="/games/recall" className="nav-btn hero-btn" style={{ ...styles(c).heroBtn, ...styles(c).heroGridBtn }}>Practice Recall</Link>{" "}
          <Link to="/exercises/flow-type" className="nav-btn hero-btn" style={{ ...styles(c).heroBtn, ...styles(c).heroGridBtn }}>Try Flow Type</Link>
        </div>

        <HomeAmbientBreathing onOpenExercise={onOpenExercise} />

        <div style={styles(c).homeLeetGroup}>
          <p style={styles(c).homeIntroText}>Decoding numbers as letters breaks your brain's autopilot reading, training attention and visual pattern recognition.</p>
          <button type="button" style={styles(c).leetWrap} onClick={() => onOpenExercise("leet")} aria-label="Open Leetspeak Reading exercise">
            <div style={styles(c).leetSweep} aria-hidden="true" />
            <p style={styles(c).leetText}>{LEET_MESSAGE}</p>
          </button>
        </div>

        <WriteToMeForm id="write-to-me" style={styles(c).homeWriteToMe} submitStyle={styles(c).btnGold} />

        <div style={styles(c).consultTeaserWrap}>
          <p style={styles(c).consultTeaserText}>Need Support?</p>
          <Link to={VIEW_PATH.contact} style={styles(c).btnGold}>View My Consultation</Link>
        </div>

        <div style={styles(c).emotionMarqueeWrap}>
          <div className="emotion-marquee-track" style={styles(c).emotionMarqueeTrack}>
            {[0, 1].map((copy) => (
              <div key={copy} style={styles(c).emotionMarqueeCopy}>
                {Object.entries(EMOTION_COLORS).map(([name, color], i) => (
                  <Fragment key={name}>
                    {i > 0 && " "}
                    <span style={{ ...styles(c).emotionBox, background: color, color: getContrastText(color) }}>
                      {name}
                    </span>
                  </Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>

        <p style={{ ...styles(c).homeFooterLine, margin: 0 }}>
          <span>© {new Date().getFullYear()} Benjamin Mithra</span>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.articles} className="home-footer-link" style={styles(c).homeFooterLink}>Articles</Link>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.privacy} className="home-footer-link" style={styles(c).homeFooterLink}>Privacy</Link>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.terms} className="home-footer-link" style={styles(c).homeFooterLink}>Terms</Link>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.disclaimer} className="home-footer-link" style={styles(c).homeFooterLink}>Disclaimer</Link>
        </p>
      </div>
    </div>
  );
}

// =================================================================
// Card Memory
// =================================================================
const CARD_INK = "#1B140D";
const CARD_RED = "#C41E3A";

function CardMemory() {
  const c = useColors();
  const [deck, setDeck] = useState(() => shuffle(buildDeck()));
  const [phase, setPhase] = useState("intro");
  const [memIndex, setMemIndex] = useState(0);
  const [testSpread, setTestSpread] = useState(null);
  const [usedIds, setUsedIds] = useState(new Set());
  const [playerSequence, setPlayerSequence] = useState([]);
  const [bounceId, setBounceId] = useState(null);
  const [missId, setMissId] = useState(null);

  const [liveMs, setLiveMs] = useState(0);
  const [memorizeMs, setMemorizeMs] = useState(null);
  const [arrangeMs, setArrangeMs] = useState(null);
  const splitStartRef = useRef(Date.now());
  const intervalRef = useRef(null);

  const startSplit = () => {
    splitStartRef.current = Date.now();
    setLiveMs(0);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setLiveMs(Date.now() - splitStartRef.current), 30);
  };
  const stopSplit = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    return Date.now() - splitStartRef.current;
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const handleStart = () => { startSplit(); setPhase("memorize"); };

  const advanceCard = () => {
    const next = memIndex + 1;
    if (next >= deck.length) {
      const finishedMemorize = stopSplit();
      setMemorizeMs(finishedMemorize);
      setTestSpread(shuffle(deck));
      setUsedIds(new Set());
      setPlayerSequence([]);
      setPhase("test");
      startSplit();
    } else { setMemIndex(next); }
  };

  const clickTestCard = (card) => {
    if (usedIds.has(card.id)) return;
    const posIndex = playerSequence.length;
    const isMatch = card.id === deck[posIndex].id;
    if (isMatch) {
      playCorrect(); setBounceId(card.id);
      setTimeout(() => setBounceId((b) => (b === card.id ? null : b)), 150);
    } else {
      playMiss(); setMissId(card.id);
      setTimeout(() => setMissId((m) => (m === card.id ? null : m)), 320);
    }
    const nextUsed = new Set(usedIds); nextUsed.add(card.id); setUsedIds(nextUsed);
    const nextSeq = [...playerSequence, card]; setPlayerSequence(nextSeq);
    if (nextSeq.length >= deck.length) {
      playLevelUp();
      const finishedArrange = stopSplit();
      setArrangeMs(finishedArrange);
      setPhase("result");
    }
  };

  const endNow = () => { const finishedArrange = stopSplit(); setArrangeMs(finishedArrange); setPhase("result"); };

  const playAgain = () => {
    setDeck(shuffle(buildDeck())); setPhase("memorize"); setMemIndex(0); setTestSpread(null);
    setUsedIds(new Set()); setPlayerSequence([]); setMemorizeMs(null); setArrangeMs(null); startSplit();
  };

  const clockLabel = phase === "result" ? formatStopwatch((memorizeMs || 0) + (arrangeMs || 0)) : formatStopwatch(liveMs);

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Card Memory</p>
        <p style={styles(c).rvSubhead}>Sequence Memory</p>
        <p style={styles(c).instruction}>Flip through the deck to memorize the order, then find each card again in that same order.</p>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Start</button>
      </div>
    );
  }

  return (
    <div style={styles(c).cardScreenWrap}>
      <div style={styles(c).stopwatchBadge}>{clockLabel}</div>

      {phase === "memorize" && (
        <div style={styles(c).gameBox}>
          <button key={memIndex} className="fade-in tile-btn" onClick={(ev) => { ev.currentTarget.blur(); advanceCard(); }} style={styles(c).bigCard}>
            <span style={{ ...styles(c).cardRank, color: deck[memIndex].red ? CARD_RED : CARD_INK }}>{deck[memIndex].rank}</span>
            <span style={{ ...styles(c).cardSuit, color: deck[memIndex].red ? CARD_RED : CARD_INK }}>{deck[memIndex].suit}</span>
          </button>
          <div style={styles(c).timerTrack}><div style={{ ...styles(c).timerFill, width: `${((memIndex + 1) / deck.length) * 100}%` }} /></div>
        </div>
      )}

      {phase === "test" && (
        <div style={styles(c).gameBox}>
          <div style={styles(c).cardGrid}>
            {testSpread.map((card) => (
              <button key={card.id} className="tile-btn" onClick={(ev) => { ev.currentTarget.blur(); clickTestCard(card); }} disabled={usedIds.has(card.id)}
                style={{ ...styles(c).smallCard, ...(usedIds.has(card.id) ? styles(c).smallCardMatched : {}), ...(bounceId === card.id ? styles(c).bounceAnim : {}), ...(missId === card.id ? styles(c).shakeAnim : {}) }}>
                <span style={{ color: card.red ? CARD_RED : CARD_INK }}>{card.rank}{card.suit}</span>
              </button>
            ))}
          </div>
          <button style={styles(c).btnGhost} onClick={endNow}>End and see results</button>
        </div>
      )}

      {phase === "result" && (() => {
        const attempted = playerSequence.length;
        const correctCount = playerSequence.filter((card, i) => deck[i] && card.id === deck[i].id).length;
        return (
          <div style={styles(c).gameBox} className="fade-in">
            <p style={styles(c).levelLabel}>{correctCount}/{attempted} matched</p>
            <div style={styles(c).splitTimesRow}>
              <span style={styles(c).splitTimeChip}>Memorized in {formatStopwatch(memorizeMs || 0)}</span>
              <span style={styles(c).splitTimeChip}>Arranged in {formatStopwatch(arrangeMs || 0)}</span>
            </div>
            <div style={styles(c).compareHeaderRow}>
              <span style={styles(c).compareHeaderCell}>Memorized</span>
              <span style={styles(c).compareHeaderCell}>Your pick</span>
            </div>
            <div style={styles(c).compareWrap}>
              {Array.from({ length: attempted }).map((_, i) => {
                const truth = deck[i]; const guess = playerSequence[i]; const ok = guess.id === truth.id;
                return (
                  <div key={i} style={styles(c).compareRow}>
                    <span style={{ ...styles(c).compareCell, ...(ok ? styles(c).compareCellGood : styles(c).compareCellBad) }}><span style={{ color: truth.red ? CARD_RED : CARD_INK }}>{truth.rank}{truth.suit}</span></span>
                    <span style={{ ...styles(c).compareCell, ...(ok ? styles(c).compareCellGood : styles(c).compareCellBad) }}><span style={{ color: guess.red ? CARD_RED : CARD_INK }}>{guess.rank}{guess.suit}</span></span>
                  </div>
                );
              })}
            </div>
            <button style={styles(c).btnPrimary} onClick={playAgain}>Shuffle again</button>
          </div>
        );
      })()}
    </div>
  );
}

// =================================================================
// Word Memory — rounds of 10, 20, 30... up to a million words.
// A failed round is replayed at the same word count; a passed round
// steps up by 10. One stopwatch runs for the whole session, and a
// Finish button closes it out with every round's result, pass or
// fail, listed below.
// =================================================================
const MAX_WORD_COUNT = 1000000;

function generateWordList(n) {
  const out = [];
  let cyclePool = shuffle(WORD_POOL);
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % WORD_POOL.length === 0) cyclePool = shuffle(WORD_POOL);
    out.push(cyclePool[i % WORD_POOL.length]);
  }
  return out;
}

function WordMemory() {
  const c = useColors();
  const clock = useRunningClock();
  const [wordCount, setWordCount] = useState(10);
  const [wordList, setWordList] = useState(() => generateWordList(10));
  const [phase, setPhase] = useState("intro"); // intro | memorize | recall | finished
  const [typed, setTyped] = useState("");
  const [rounds, setRounds] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [finalMs, setFinalMs] = useState(null);

  const handleStart = () => { clock.start(); setPhase("memorize"); };
  const openRecall = () => setPhase("recall");

  const submitRecall = () => {
    const guessed = typed.split(/[\s,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
    let correct = 0;
    for (let i = 0; i < wordList.length; i++) { if (guessed[i] === wordList[i]) correct++; }
    const passed = correct === wordList.length;
    const entry = { count: wordList.length, correct, passed };
    setRounds((r) => [...r, entry]);
    setLastResult(entry);
    if (passed) playLevelUp(); else playMiss();
    setPhase("verdict");
  };

  const nextRound = () => {
    const nextCount = lastResult.passed ? Math.min(wordCount + 10, MAX_WORD_COUNT) : wordCount;
    setWordCount(nextCount);
    setWordList(generateWordList(nextCount));
    setTyped("");
    setLastResult(null);
    setPhase("memorize");
  };

  const finish = () => { const total = clock.stop(); setFinalMs(total); setPhase("finished"); };

  const playAgain = () => {
    setWordCount(10); setWordList(generateWordList(10)); setTyped(""); setRounds([]);
    setLastResult(null); setFinalMs(null); setPhase("memorize"); clock.start();
  };

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Word Memory</p>
        <p style={styles(c).rvSubhead}>Verbal Memory</p>
        <p style={styles(c).instruction}>Memorize the growing list of words, then type them back in the exact order shown.</p>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Start</button>
      </div>
    );
  }

  return (
    <div style={styles(c).cardScreenWrap}>
      <div style={styles(c).stopwatchBadge}>{phase === "finished" ? formatStopwatch(finalMs || 0) : formatStopwatch(clock.ms)}</div>

      {phase === "memorize" && (
        <div style={styles(c).gameBox}>
          <p style={styles(c).levelLabel}>{wordCount} words</p>
          <div style={styles(c).wordListBox}>{wordList.join("   ")}</div>
          <button style={styles(c).btnPrimary} onClick={openRecall}>I've memorized these</button>
          <button style={styles(c).btnGhost} onClick={finish}>Finish</button>
        </div>
      )}

      {phase === "recall" && (
        <div style={styles(c).gameBox}>
          <p style={styles(c).instruction}>Type the words back, in order, separated by spaces or commas.</p>
          <textarea style={styles(c).answerInput} value={typed} onChange={(e) => setTyped(e.target.value)} rows={5} autoFocus />
          <button style={styles(c).btnPrimary} onClick={submitRecall}>Submit</button>
        </div>
      )}

      {phase === "verdict" && lastResult && (
        <div style={styles(c).gameBox} className="fade-in">
          <p style={{ ...styles(c).verdict, color: lastResult.passed ? c.good : c.bad }}>{lastResult.passed ? "Correct." : "Not quite."}</p>
          <p style={styles(c).resultText}>{lastResult.correct} of {lastResult.count} words matched, in order.</p>
          <button style={styles(c).btnPrimary} onClick={nextRound}>{lastResult.passed ? `Next round: ${Math.min(wordCount + 10, MAX_WORD_COUNT)} words` : "Try again, same word count"}</button>
          <button style={styles(c).btnGhost} onClick={finish}>Finish</button>
        </div>
      )}

      {phase === "finished" && (
        <div style={styles(c).gameBox} className="fade-in">
          <p style={styles(c).levelLabel}>Session complete</p>
          <p style={styles(c).resultText}>Total time: {formatStopwatch(finalMs || 0)}</p>
          <ul style={styles(c).recapList}>
            {rounds.length === 0 && <li style={styles(c).recapItem}>No rounds completed.</li>}
            {rounds.map((r, i) => (
              <li key={i} style={styles(c).recapItem}>Round {i + 1}: {r.count} words, {r.correct}/{r.count} correct, {r.passed ? "passed" : "failed"}</li>
            ))}
          </ul>
          <button style={styles(c).btnPrimary} onClick={playAgain}>Start over</button>
        </div>
      )}
    </div>
  );
}

// =================================================================
// Number Memory — pick 2-digit or 3-digit numbers, same 10-up-to-a-
// million progression as Word Memory, laid out in the columns of 5
// the way a memory athlete would drill it.
// =================================================================
const MAX_NUMBER_COUNT = 1000000;

function generateNumberList(n, digits) {
  const min = digits === 2 ? 10 : 100;
  const max = digits === 2 ? 99 : 999;
  return Array.from({ length: n }, () => randInt(min, max));
}

function NumberMemory() {
  const c = useColors();
  const clock = useRunningClock();
  const [digits, setDigits] = useState(null); // null until chosen
  const [count, setCount] = useState(10);
  const [numberList, setNumberList] = useState([]);
  const [phase, setPhase] = useState("intro"); // intro | select | memorize | recall | verdict | finished
  const [typed, setTyped] = useState("");
  const [rounds, setRounds] = useState([]);
  const [lastResult, setLastResult] = useState(null);
  const [finalMs, setFinalMs] = useState(null);

  const handleStart = () => setPhase("select");

  const chooseDigits = (d) => {
    setDigits(d);
    setCount(10);
    setNumberList(generateNumberList(10, d));
    setPhase("memorize");
    clock.start();
  };

  const submitRecall = () => {
    const guessed = typed.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
    let correct = 0;
    for (let i = 0; i < numberList.length; i++) { if (guessed[i] === String(numberList[i])) correct++; }
    const passed = correct === numberList.length;
    const entry = { count: numberList.length, correct, passed };
    setRounds((r) => [...r, entry]);
    setLastResult(entry);
    if (passed) playLevelUp(); else playMiss();
    setPhase("verdict");
  };

  const nextRound = () => {
    const nextCount = lastResult.passed ? Math.min(count + 10, MAX_NUMBER_COUNT) : count;
    setCount(nextCount);
    setNumberList(generateNumberList(nextCount, digits));
    setTyped("");
    setLastResult(null);
    setPhase("memorize");
  };

  const finish = () => { const total = clock.stop(); setFinalMs(total); setPhase("finished"); };

  const playAgain = () => { setDigits(null); setCount(10); setNumberList([]); setTyped(""); setRounds([]); setLastResult(null); setFinalMs(null); setPhase("select"); };

  const rows = [];
  for (let i = 0; i < numberList.length; i += 5) rows.push(numberList.slice(i, i + 5));

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Number Memory</p>
        <p style={styles(c).rvSubhead}>Numeric Memory</p>
        <p style={styles(c).instruction}>Memorize the growing list of numbers, then type them back in the exact order shown.</p>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Start</button>
      </div>
    );
  }

  return (
    <div style={styles(c).cardScreenWrap}>
      {phase !== "select" && phase !== "finished" && <div style={styles(c).stopwatchBadge}>{formatStopwatch(clock.ms)}</div>}
      {phase === "finished" && <div style={styles(c).stopwatchBadge}>{formatStopwatch(finalMs || 0)}</div>}

      {phase === "select" && (
        <div style={styles(c).gameBox}>
          <p style={styles(c).instruction}>Choose a digit length to begin.</p>
          <div style={styles(c).rowButtons}>
            <button style={styles(c).btnPrimary} onClick={() => chooseDigits(2)}>2-digit numbers</button>
            <button style={styles(c).btnPrimary} onClick={() => chooseDigits(3)}>3-digit numbers</button>
          </div>
        </div>
      )}

      {phase === "memorize" && (
        <div style={styles(c).gameBox}>
          <p style={styles(c).levelLabel}>{count} numbers · {digits}-digit</p>
          <div style={styles(c).numberColumns}>
            {rows.map((row, ri) => (
              <div key={ri} style={styles(c).numberRow}>{row.map((v, vi) => (<span key={vi} style={styles(c).numberCell}>{v}</span>))}</div>
            ))}
          </div>
          <button style={styles(c).btnPrimary} onClick={() => setPhase("recall")}>I've memorized these</button>
          <button style={styles(c).btnGhost} onClick={finish}>Finish</button>
        </div>
      )}

      {phase === "recall" && (
        <div style={styles(c).gameBox}>
          <p style={styles(c).instruction}>Type the numbers back, in order, separated by spaces or commas.</p>
          <textarea style={styles(c).answerInput} value={typed} onChange={(e) => setTyped(e.target.value)} rows={5} autoFocus />
          <button style={styles(c).btnPrimary} onClick={submitRecall}>Submit</button>
        </div>
      )}

      {phase === "verdict" && lastResult && (
        <div style={styles(c).gameBox} className="fade-in">
          <p style={{ ...styles(c).verdict, color: lastResult.passed ? c.good : c.bad }}>{lastResult.passed ? "Correct." : "Not quite."}</p>
          <p style={styles(c).resultText}>{lastResult.correct} of {lastResult.count} numbers matched, in order.</p>
          <button style={styles(c).btnPrimary} onClick={nextRound}>{lastResult.passed ? `Next round: ${Math.min(count + 10, MAX_NUMBER_COUNT)} numbers` : "Try again, same count"}</button>
          <button style={styles(c).btnGhost} onClick={finish}>Finish</button>
        </div>
      )}

      {phase === "finished" && (
        <div style={styles(c).gameBox} className="fade-in">
          <p style={styles(c).levelLabel}>Session complete</p>
          <p style={styles(c).resultText}>{digits}-digit mode · Total time: {formatStopwatch(finalMs || 0)}</p>
          <ul style={styles(c).recapList}>
            {rounds.length === 0 && <li style={styles(c).recapItem}>No rounds completed.</li>}
            {rounds.map((r, i) => (
              <li key={i} style={styles(c).recapItem}>Round {i + 1}: {r.count} numbers, {r.correct}/{r.count} correct, {r.passed ? "passed" : "failed"}</li>
            ))}
          </ul>
          <button style={styles(c).btnPrimary} onClick={playAgain}>Start over</button>
        </div>
      )}
    </div>
  );
}

// =================================================================
// N-Back — a classic working-memory task. A sequence of images is
// shown one at a time; the player clicks the lit grid cell whenever
// its image is the same as the one shown immediately before it. This
// is plain 1-back throughout — every round compares a trial only to
// the single trial right before it, never to two-back or further,
// and never combined with a position match (which would make it
// "dual" n-back).
//
// The image appears in a different cell of a 3x3 grid each trial,
// and every trial has an explicit blank gap before it lights up, so
// a genuine repeat (every match trial, by definition) still reads as
// a distinct new event rather than the same trial "staying" put.
//
// Every round is exactly 30 trials with exactly 7 of them constructed
// as genuine matches — never left to chance, never more or fewer.
// The 7 match positions are chosen randomly each round from a window
// that excludes the first few and last few trials, so hits land
// somewhere in the middle stretch rather than right at the start or
// the very end. Every other trial is forced to differ from the one
// before it, so a non-match is always a genuine non-match. A fresh
// set of 8 icons is drawn each round from the same icon pool used
// elsewhere in the app.
// =================================================================
const NBACK_N = 1;
const NBACK_TOTAL_TRIALS = 30;
const NBACK_TARGET_HITS = 7;
const NBACK_EDGE_BUFFER = 4; // trials excluded from the hit window at each end

// Picks `count` indices from [rangeStart, rangeEnd] such that no two
// chosen indices are closer together than `minGap`. Plain random
// sampling (shuffle-and-slice) frequently landed several of the 7
// hit positions right next to each other by chance, which is exactly
// what made hits feel like they arrived in one clump right after the
// first one. This guarantees real separation between every hit.
function pickSpacedIndices(rangeStart, rangeEnd, count, minGap) {
  const pool = [];
  for (let i = rangeStart; i <= rangeEnd; i++) pool.push(i);
  for (let attempt = 0; attempt < 300; attempt++) {
    const candidates = shuffle(pool);
    const chosen = [];
    for (const idx of candidates) {
      if (chosen.every((c) => Math.abs(c - idx) >= minGap)) chosen.push(idx);
      if (chosen.length === count) break;
    }
    if (chosen.length === count) return chosen.sort((a, b) => a - b);
  }
  // Fallback (should be unreachable given the fixed 30/7 format): evenly spaced.
  const span = rangeEnd - rangeStart;
  return Array.from({ length: count }, (_, i) => rangeStart + Math.round((i * span) / (count - 1)));
}

function generateNBackSequence(pool) {
  const trials = NBACK_TOTAL_TRIALS;
  const windowStart = NBACK_EDGE_BUFFER;
  const windowEnd = trials - 1 - NBACK_EDGE_BUFFER;
  const targetSet = new Set(pickSpacedIndices(windowStart, windowEnd, NBACK_TARGET_HITS, 3));

  const seq = [];
  for (let i = 0; i < trials; i++) {
    if (i === 0) {
      seq.push(pick(pool));
      continue;
    }
    if (targetSet.has(i)) {
      seq.push(seq[i - 1]);
    } else {
      let candidate;
      let guard = 0;
      do { candidate = pick(pool); guard++; } while (candidate === seq[i - 1] && guard < 30);
      seq.push(candidate);
    }
  }
  return seq;
}

function generateNBackPositions(trials) {
  const positions = [];
  let prev = -1;
  for (let i = 0; i < trials; i++) {
    let p;
    do { p = randInt(0, 8); } while (p === prev);
    positions.push(p);
    prev = p;
  }
  return positions;
}

const NBACK_BLANK_MS = 500;
const NBACK_DISPLAY_MS = 1500;

function NBackGame() {
  const c = useColors();
  const timeoutsRef = useRef([]);
  const pressedRef = useRef(false);

  const [phase, setPhase] = useState("intro"); // intro | playing | result
  const [sequence, setSequence] = useState([]);
  const [positions, setPositions] = useState([]);
  const [trialIndex, setTrialIndex] = useState(0);
  const [showingActive, setShowingActive] = useState(false); // false = blank gap, true = cell lit
  const [pressedThisTrial, setPressedThisTrial] = useState(false);
  const [lastTrialCorrect, setLastTrialCorrect] = useState(null); // brief per-trial feedback
  const [result, setResult] = useState(null); // { hits, misses, falseAlarms, correctRejections, accuracy }

  const after = (ms, fn) => { const t = setTimeout(fn, ms); timeoutsRef.current.push(t); };
  const clearTimers = () => { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; };
  useEffect(() => () => clearTimers(), []);

  const runTrial = (seq, pos, idx, stats) => {
    setTrialIndex(idx);
    setShowingActive(false);
    setPressedThisTrial(false);
    setLastTrialCorrect(null);
    pressedRef.current = false;

    after(NBACK_BLANK_MS, () => {
      setShowingActive(true);

      after(NBACK_DISPLAY_MS, () => {
        const isTarget = idx >= NBACK_N && seq[idx] === seq[idx - NBACK_N];
        const pressed = pressedRef.current;
        const correct = (isTarget && pressed) || (!isTarget && !pressed);
        const nextStats = { ...stats };
        if (idx >= NBACK_N) {
          if (isTarget && pressed) nextStats.hits++;
          else if (isTarget && !pressed) nextStats.misses++;
          else if (!isTarget && pressed) nextStats.falseAlarms++;
          else nextStats.correctRejections++;
        }
        setShowingActive(false);
        setLastTrialCorrect(idx >= NBACK_N ? correct : null);

        const nextIdx = idx + 1;
        after(280, () => {
          if (nextIdx >= seq.length) {
            const scorable = seq.length - NBACK_N;
            const accuracy = scorable > 0 ? Math.round(((nextStats.hits + nextStats.correctRejections) / scorable) * 100) : 0;
            setResult({ ...nextStats, accuracy });
            setPhase("result");
          } else {
            runTrial(seq, pos, nextIdx, nextStats);
          }
        });
      });
    });
  };

  const startRound = () => {
    clearTimers();
    const pool = shuffle(EMOJI_POOL).slice(0, 8);
    const seq = generateNBackSequence(pool);
    const pos = generateNBackPositions(NBACK_TOTAL_TRIALS);
    setSequence(seq);
    setPositions(pos);
    setResult(null);
    setPhase("playing");
    runTrial(seq, pos, 0, { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0 });
  };

  const handleStart = () => startRound();
  const handlePlayAgain = () => startRound();
  const handleRestart = () => { clearTimers(); setPhase("intro"); };

  const handleCellClick = () => {
    if (phase !== "playing" || !showingActive || pressedThisTrial) return;
    pressedRef.current = true;
    setPressedThisTrial(true);
  };

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>N Back</p>
        <p style={styles(c).rvSubhead}>Working Memory</p>
        <p style={styles(c).instruction}>An image will light up somewhere on the grid. Click the lit cell whenever its image is the same as the one shown 1 step back.</p>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Start</button>
      </div>
    );
  }

  if (phase === "result" && result) {
    const passed = result.accuracy >= 80;
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>N Back</p>
        <p style={{ ...styles(c).verdict, color: passed ? c.good : c.bad }}>{passed ? "Round Cleared" : "Round Complete"}</p>
        <p style={styles(c).resultText}>Accuracy {result.accuracy}%</p>
        <ul style={styles(c).recapList}>
          <li style={styles(c).recapItem}>Hits: {result.hits}</li>
          <li style={styles(c).recapItem}>Misses: {result.misses}</li>
          <li style={styles(c).recapItem}>False alarms: {result.falseAlarms}</li>
          <li style={styles(c).recapItem}>Correct rejections: {result.correctRejections}</li>
        </ul>
        <div style={styles(c).rowButtons}>
          {passed ? (
            <button style={styles(c).btnPrimary} onClick={handlePlayAgain}>Continue</button>
          ) : (
            <button style={styles(c).btnPrimary} onClick={handlePlayAgain}>Try Again</button>
          )}
          <button style={styles(c).btnGhost} onClick={handleRestart}>Start Over</button>
        </div>
      </div>
    );
  }

  const totalTrials = sequence.length;
  const activeCell = positions[trialIndex];
  const currentStimulus = sequence[trialIndex];

  return (
    <div style={styles(c).nbackWrap} className="fade-in">
      <p style={styles(c).rvHeading}>N Back</p>
      <p style={styles(c).rvSubhead}>Trial {Math.min(trialIndex + 1, totalTrials)} of {totalTrials}</p>

      <div style={styles(c).nbackGrid}>
        {Array.from({ length: 9 }).map((_, cellIdx) => {
          const isActive = showingActive && cellIdx === activeCell;
          return (
            <button
              key={cellIdx}
              className="tile-btn"
              onClick={isActive ? handleCellClick : undefined}
              style={{
                ...styles(c).nbackCell,
                ...(isActive ? styles(c).nbackCellActive : {}),
                ...(isActive && pressedThisTrial ? styles(c).nbackCellPressed : {}),
                ...(!showingActive && lastTrialCorrect !== null && cellIdx === activeCell ? (lastTrialCorrect ? styles(c).nbackCellFeedbackGood : styles(c).nbackCellFeedbackBad) : {}),
                cursor: isActive ? "pointer" : "default",
              }}
            >
              {isActive && <span style={styles(c).nbackCellImage}>{currentStimulus}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =================================================================
// Chess — a from-scratch legal-move chess engine (no external chess
// library is available in this sandbox), played against a built-in
// computer opponent. Full rules: legal move generation with check
// filtering, castling, en passant, pawn promotion (auto-queen),
// checkmate/stalemate detection.
//
// The computer opponent runs a negamax search with alpha-beta
// pruning over material + light positional evaluation. Rather than
// asking the player to pick a difficulty, the search depth adapts to
// how many pieces remain on the board: 2 plies while the board is
// crowded (a "medium" feel — fast, since branching is high), and 3
// plies once enough pieces have been traded off (a "harder" feel —
// deeper search is affordable once branching drops). That's the
// medium/hard blend, chosen automatically every move.
// =================================================================
function cloneChessBoard(board) { return board.map((row) => row.slice()); }
function pieceColor(p) { return p ? p[0] : null; }
function pieceType(p) { return p ? p[1] : null; }
function inBoard(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

function initialChessBoard() {
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let c = 0; c < 8; c++) {
    board[0][c] = "b" + back[c];
    board[1][c] = "bP";
    board[6][c] = "wP";
    board[7][c] = "w" + back[c];
  }
  return board;
}

function isSquareAttacked(board, r, c, byColor) {
  const dir = byColor === "w" ? -1 : 1;
  for (const dc of [-1, 1]) {
    const pr = r - dir, pc = c - dc;
    if (inBoard(pr, pc) && board[pr][pc] === byColor + "P") return true;
  }
  const knightOffsets = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  for (const [dr, dc] of knightOffsets) {
    const nr = r + dr, nc = c + dc;
    if (inBoard(nr, nc) && board[nr][nc] === byColor + "N") return true;
  }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    const nr = r + dr, nc = c + dc;
    if (inBoard(nr, nc) && board[nr][nc] === byColor + "K") return true;
  }
  const diagDirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dr, dc] of diagDirs) {
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, nc)) {
      const p = board[nr][nc];
      if (p) { if (pieceColor(p) === byColor && (pieceType(p) === "B" || pieceType(p) === "Q")) return true; break; }
      nr += dr; nc += dc;
    }
  }
  const straightDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dr, dc] of straightDirs) {
    let nr = r + dr, nc = c + dc;
    while (inBoard(nr, nc)) {
      const p = board[nr][nc];
      if (p) { if (pieceColor(p) === byColor && (pieceType(p) === "R" || pieceType(p) === "Q")) return true; break; }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function findKing(board, color) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === color + "K") return [r, c];
  return [-1, -1];
}
function isInCheck(board, color) {
  const [kr, kc] = findKing(board, color);
  if (kr < 0) return false;
  return isSquareAttacked(board, kr, kc, color === "w" ? "b" : "w");
}

function pawnMoves(board, r, c, color, enPassant) {
  const moves = [];
  const dir = color === "w" ? -1 : 1;
  const startRow = color === "w" ? 6 : 1;
  const promoRow = color === "w" ? 0 : 7;
  const one = r + dir;
  if (inBoard(one, c) && !board[one][c]) {
    moves.push({ fr: r, fc: c, tr: one, tc: c, promotion: one === promoRow ? "Q" : null });
    const two = r + 2 * dir;
    if (r === startRow && !board[two][c]) moves.push({ fr: r, fc: c, tr: two, tc: c, promotion: null, doubleStep: true });
  }
  for (const dc of [-1, 1]) {
    const tr = r + dir, tc = c + dc;
    if (!inBoard(tr, tc)) continue;
    const target = board[tr][tc];
    if (target && pieceColor(target) !== color) moves.push({ fr: r, fc: c, tr, tc, promotion: tr === promoRow ? "Q" : null });
    else if (!target && enPassant && enPassant.r === tr && enPassant.c === tc) moves.push({ fr: r, fc: c, tr, tc, promotion: null, enPassant: true });
  }
  return moves;
}
function knightMoves(board, r, c, color) {
  const offsets = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const moves = [];
  for (const [dr, dc] of offsets) {
    const tr = r + dr, tc = c + dc;
    if (!inBoard(tr, tc)) continue;
    const target = board[tr][tc];
    if (!target || pieceColor(target) !== color) moves.push({ fr: r, fc: c, tr, tc, promotion: null });
  }
  return moves;
}
function slideMoves(board, r, c, color, dirs) {
  const moves = [];
  for (const [dr, dc] of dirs) {
    let tr = r + dr, tc = c + dc;
    while (inBoard(tr, tc)) {
      const target = board[tr][tc];
      if (!target) { moves.push({ fr: r, fc: c, tr, tc, promotion: null }); }
      else { if (pieceColor(target) !== color) moves.push({ fr: r, fc: c, tr, tc, promotion: null }); break; }
      tr += dr; tc += dc;
    }
  }
  return moves;
}
function kingMoves(board, state, r, c, color) {
  const moves = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (dr === 0 && dc === 0) continue;
    const tr = r + dr, tc = c + dc;
    if (!inBoard(tr, tc)) continue;
    const target = board[tr][tc];
    if (!target || pieceColor(target) !== color) moves.push({ fr: r, fc: c, tr, tc, promotion: null });
  }
  const opp = color === "w" ? "b" : "w";
  const homeRow = color === "w" ? 7 : 0;
  if (r === homeRow && c === 4 && !isSquareAttacked(board, r, c, opp)) {
    const kRight = color === "w" ? state.castling.wK : state.castling.bK;
    if (kRight && !board[homeRow][5] && !board[homeRow][6] && board[homeRow][7] === color + "R"
      && !isSquareAttacked(board, homeRow, 5, opp) && !isSquareAttacked(board, homeRow, 6, opp)) {
      moves.push({ fr: r, fc: c, tr: homeRow, tc: 6, promotion: null, isCastle: "K" });
    }
    const qRight = color === "w" ? state.castling.wQ : state.castling.bQ;
    if (qRight && !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3] && board[homeRow][0] === color + "R"
      && !isSquareAttacked(board, homeRow, 3, opp) && !isSquareAttacked(board, homeRow, 2, opp)) {
      moves.push({ fr: r, fc: c, tr: homeRow, tc: 2, promotion: null, isCastle: "Q" });
    }
  }
  return moves;
}
function pseudoMovesForSquare(board, state, r, c) {
  const p = board[r][c];
  if (!p) return [];
  const color = pieceColor(p), type = pieceType(p);
  if (type === "P") return pawnMoves(board, r, c, color, state.enPassant);
  if (type === "N") return knightMoves(board, r, c, color);
  if (type === "B") return slideMoves(board, r, c, color, [[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  if (type === "R") return slideMoves(board, r, c, color, [[1, 0], [-1, 0], [0, 1], [0, -1]]);
  if (type === "Q") return slideMoves(board, r, c, color, [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]);
  if (type === "K") return kingMoves(board, state, r, c, color);
  return [];
}
function applyChessMove(board, state, move) {
  const nb = cloneChessBoard(board);
  const piece = nb[move.fr][move.fc];
  const color = pieceColor(piece);
  if (move.enPassant) nb[move.fr][move.tc] = null;
  nb[move.tr][move.tc] = move.promotion ? color + move.promotion : piece;
  nb[move.fr][move.fc] = null;
  if (move.isCastle === "K") { const row = move.fr; nb[row][5] = nb[row][7]; nb[row][7] = null; }
  if (move.isCastle === "Q") { const row = move.fr; nb[row][3] = nb[row][0]; nb[row][0] = null; }

  const ns = { castling: { ...state.castling }, enPassant: null };
  if (pieceType(piece) === "K") { if (color === "w") { ns.castling.wK = false; ns.castling.wQ = false; } else { ns.castling.bK = false; ns.castling.bQ = false; } }
  if (move.fr === 7 && move.fc === 0) ns.castling.wQ = false;
  if (move.fr === 7 && move.fc === 7) ns.castling.wK = false;
  if (move.fr === 0 && move.fc === 0) ns.castling.bQ = false;
  if (move.fr === 0 && move.fc === 7) ns.castling.bK = false;
  if (move.tr === 7 && move.tc === 0) ns.castling.wQ = false;
  if (move.tr === 7 && move.tc === 7) ns.castling.wK = false;
  if (move.tr === 0 && move.tc === 0) ns.castling.bQ = false;
  if (move.tr === 0 && move.tc === 7) ns.castling.bK = false;
  if (move.doubleStep) ns.enPassant = { r: (move.fr + move.tr) / 2, c: move.fc };
  return { board: nb, state: ns };
}
function generateLegalMoves(board, state, color) {
  const moves = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (board[r][c] && pieceColor(board[r][c]) === color) moves.push(...pseudoMovesForSquare(board, state, r, c));
  }
  return moves.filter((m) => {
    const { board: nb } = applyChessMove(board, state, m);
    return !isInCheck(nb, color);
  });
}
function chessStatus(board, state, color) {
  const moves = generateLegalMoves(board, state, color);
  const check = isInCheck(board, color);
  if (moves.length === 0) return check ? "checkmate" : "stalemate";
  return check ? "check" : "ongoing";
}
function countChessPieces(board) {
  let n = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c]) n++;
  return n;
}
function evaluateChessBoard(board) {
  const values = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const centerBonus = [
    [0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 1, 1, 1, 1, 1, 0], [0, 1, 2, 2, 2, 2, 1, 0], [0, 1, 2, 3, 3, 2, 1, 0],
    [0, 1, 2, 3, 3, 2, 1, 0], [0, 1, 2, 2, 2, 2, 1, 0], [0, 1, 1, 1, 1, 1, 1, 0], [0, 0, 0, 0, 0, 0, 0, 0],
  ];
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = board[r][c];
    if (!p) continue;
    const type = pieceType(p);
    let val = values[type];
    if (type === "N" || type === "B" || type === "Q") val += centerBonus[r][c] * 2;
    score += pieceColor(p) === "w" ? val : -val;
  }
  return score;
}
function negamaxChess(board, state, depth, alpha, beta, color) {
  const opp = color === "w" ? "b" : "w";
  const moves = generateLegalMoves(board, state, color);
  if (moves.length === 0) {
    if (isInCheck(board, color)) return { score: -99000 - depth };
    return { score: 0 };
  }
  if (depth === 0) return { score: evaluateChessBoard(board) * (color === "w" ? 1 : -1) };
  let best = -Infinity, bestMove = moves[0];
  for (const m of shuffle(moves)) {
    const { board: nb, state: ns } = applyChessMove(board, state, m);
    const res = negamaxChess(nb, ns, depth - 1, -beta, -alpha, opp);
    const sc = -res.score;
    if (sc > best) { best = sc; bestMove = m; }
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  return { score: best, move: bestMove };
}
function chooseEngineDepth(board) { return countChessPieces(board) > 22 ? 2 : 3; }

// Real vector piece icons instead of Unicode chess glyphs — glyph
// rendering varies wildly across fonts/platforms and was part of why
// the pieces looked inconsistent. These are simplified, rounded
// icon-style pieces (not a pixel copy of any specific chess set),
// solid-filled so white vs black is unambiguous at a glance, with a
// contrasting outline (dark on white pieces, cream on black pieces)
// so they stay legible on either square color.
function ChessPieceIcon({ type, color }) {
  // A clean "flat classic" chess-icon style: solid fill, a single
  // consistent stroke weight, and a shared vocabulary across all six
  // pieces (base plinth, collar ring, tapered body, head ornament) —
  // the same general construction generic flat chess-icon sets use.
  // White pieces: white fill + dark outline. Black pieces: solid dark
  // silhouette. `mark` is the color used for each piece's one interior
  // detail line — dark-on-white for white pieces, and a light line on
  // black pieces so the detail actually shows up against the dark fill
  // instead of disappearing into it.
  const fill = color === "w" ? "#FFFFFF" : "#1A1A1A";
  const stroke = "#1A1A1A";
  const mark = color === "w" ? stroke : "#EDEAE0";
  const p = { fill, stroke, strokeWidth: 1.8, strokeLinejoin: "round", strokeLinecap: "round" };
  const svgProps = { viewBox: "0 0 45 45", width: "100%", height: "100%" };

  if (type === "P") return (
    <svg {...svgProps}>
      <circle cx="22.5" cy="12" r="6.5" {...p} />
      <path d="M18.5 19.5 H26.5" stroke={mark} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14.5 34 C14.5 25 18 21 22.5 21 C27 21 30.5 25 30.5 34 Z" {...p} />
      <rect x="9.5" y="36.5" width="26" height="4.5" rx="1.5" {...p} />
    </svg>
  );

  if (type === "N") return (
    <svg {...svgProps}>
      {/* Traced directly from the supplied reference image (contour-extracted, then
          curve-fit) rather than hand-drawn — verified by re-rendering this exact
          path data back to a bitmap and visually comparing it to the source. */}
      <path d="M23.27,1.0 C22.97,1.0 22.61,1.28 22.3,1.46 C21.99,1.64 21.65,1.84 21.41,2.09 C21.16,2.35 20.99,2.69 20.82,3.0 C20.64,3.32 20.54,3.66 20.36,3.97 C20.17,4.28 19.97,4.61 19.71,4.86 C19.45,5.1 19.13,5.32 18.8,5.44 C18.46,5.56 18.08,5.57 17.7,5.59 C17.33,5.62 16.92,5.57 16.55,5.59 C16.17,5.62 15.8,5.65 15.46,5.74 C15.11,5.83 14.78,5.97 14.46,6.13 C14.14,6.3 13.85,6.51 13.55,6.73 C13.26,6.95 12.95,7.18 12.69,7.44 C12.43,7.7 12.19,8.0 11.98,8.3 C11.78,8.6 11.65,8.93 11.48,9.25 C11.32,9.57 11.15,9.88 11.0,10.21 C10.85,10.53 10.71,10.86 10.56,11.18 C10.42,11.51 10.25,11.82 10.12,12.15 C9.99,12.49 9.9,12.83 9.8,13.18 C9.69,13.52 9.59,13.86 9.49,14.21 C9.39,14.55 9.28,14.89 9.19,15.23 C9.09,15.58 8.98,15.92 8.91,16.27 C8.83,16.63 8.78,16.99 8.73,17.36 C8.67,17.72 8.63,18.08 8.57,18.45 C8.52,18.81 8.47,19.18 8.42,19.54 C8.37,19.9 8.29,20.26 8.27,20.63 C8.24,21.01 8.29,21.41 8.27,21.79 C8.24,22.16 8.14,22.51 8.12,22.88 C8.09,23.26 8.11,23.65 8.12,24.04 C8.12,24.42 8.1,24.81 8.13,25.19 C8.15,25.56 8.24,25.91 8.27,26.28 C8.29,26.66 8.24,27.07 8.27,27.44 C8.29,27.81 8.37,28.17 8.42,28.53 C8.47,28.9 8.4,29.42 8.57,29.62 C8.75,29.83 9.13,29.72 9.46,29.77 C9.79,29.82 10.2,29.83 10.55,29.92 C10.9,30.01 11.23,30.13 11.55,30.3 C11.87,30.46 12.17,30.66 12.46,30.9 C12.75,31.13 13.04,31.43 13.28,31.72 C13.51,32.0 13.69,32.31 13.88,32.62 C14.06,32.93 14.23,33.25 14.39,33.57 C14.55,33.88 14.61,34.32 14.85,34.53 C15.08,34.74 15.45,34.77 15.81,34.82 C16.16,34.87 16.58,34.82 16.96,34.82 C17.35,34.82 17.73,34.82 18.12,34.82 C18.5,34.82 18.89,34.82 19.27,34.82 C19.66,34.82 20.04,34.82 20.43,34.82 C20.81,34.82 21.2,34.82 21.58,34.82 C21.97,34.82 22.36,34.82 22.74,34.82 C23.13,34.82 23.51,34.82 23.9,34.82 C24.28,34.82 24.67,34.82 25.05,34.82 C25.44,34.82 25.82,34.82 26.21,34.82 C26.59,34.82 27.01,34.9 27.36,34.82 C27.72,34.74 28.02,34.55 28.32,34.35 C28.63,34.15 28.91,33.86 29.17,33.59 C29.43,33.33 29.67,33.07 29.9,32.78 C30.12,32.49 30.35,32.2 30.5,31.87 C30.64,31.55 30.72,31.19 30.76,30.83 C30.81,30.46 30.84,30.02 30.76,29.67 C30.69,29.32 30.49,29.02 30.31,28.7 C30.13,28.39 29.95,28.08 29.71,27.8 C29.47,27.51 29.16,27.25 28.89,26.98 C28.62,26.71 28.35,26.42 28.07,26.16 C27.79,25.91 27.49,25.71 27.21,25.45 C26.93,25.2 26.67,24.91 26.4,24.64 C26.12,24.36 25.85,24.09 25.58,23.82 C25.31,23.55 25.02,23.28 24.76,23.0 C24.51,22.72 24.29,22.43 24.05,22.14 C23.82,21.85 23.56,21.57 23.34,21.28 C23.12,20.98 22.93,20.68 22.74,20.37 C22.55,20.06 22.36,19.76 22.19,19.44 C22.03,19.12 21.86,18.81 21.76,18.47 C21.66,18.12 21.5,17.59 21.58,17.38 C21.66,17.18 22.0,17.13 22.22,17.25 C22.44,17.37 22.67,17.83 22.93,18.11 C23.19,18.39 23.46,18.69 23.76,18.9 C24.05,19.11 24.38,19.26 24.72,19.36 C25.06,19.47 25.44,19.49 25.81,19.52 C26.19,19.54 26.58,19.52 26.97,19.52 C27.35,19.52 27.75,19.49 28.12,19.52 C28.5,19.54 28.88,19.56 29.22,19.67 C29.56,19.77 29.86,19.97 30.17,20.15 C30.48,20.33 30.79,20.53 31.08,20.75 C31.38,20.97 31.64,21.26 31.94,21.46 C32.24,21.66 32.55,21.91 32.89,21.96 C33.23,22.02 33.66,21.97 33.98,21.81 C34.3,21.65 34.52,21.26 34.8,20.99 C35.07,20.72 35.36,20.45 35.61,20.17 C35.87,19.89 36.14,19.62 36.32,19.31 C36.51,19.0 36.64,18.67 36.73,18.33 C36.82,17.98 36.94,17.57 36.88,17.23 C36.83,16.89 36.61,16.56 36.4,16.28 C36.19,15.99 35.92,15.77 35.65,15.52 C35.38,15.28 35.06,15.07 34.78,14.81 C34.5,14.56 34.24,14.27 33.97,14.0 C33.69,13.73 33.42,13.45 33.15,13.18 C32.88,12.91 32.61,12.64 32.33,12.36 C32.06,12.09 31.79,11.82 31.52,11.55 C31.24,11.27 30.97,11.0 30.7,10.73 C30.43,10.46 30.15,10.18 29.88,9.91 C29.61,9.64 29.34,9.35 29.06,9.09 C28.78,8.84 28.48,8.64 28.2,8.39 C27.92,8.13 27.66,7.82 27.39,7.57 C27.11,7.31 26.81,7.09 26.52,6.86 C26.23,6.63 25.93,6.42 25.64,6.2 C25.34,5.98 25.02,5.8 24.75,5.55 C24.49,5.3 24.19,5.01 24.05,4.69 C23.9,4.36 23.88,3.96 23.88,3.6 C23.87,3.24 24.0,2.86 24.03,2.51 C24.06,2.15 24.17,1.73 24.05,1.47 C23.92,1.22 23.56,1.0 23.27,1.0 Z" {...p} />
      <path d="M13.62,35.58 C13.36,35.72 13.29,36.15 13.09,36.42 C12.9,36.69 12.67,36.95 12.45,37.21 C12.24,37.48 11.84,37.82 11.82,38.0 C11.79,38.19 12.03,38.28 12.28,38.34 C12.54,38.39 12.99,38.34 13.34,38.34 C13.69,38.34 14.04,38.34 14.4,38.34 C14.75,38.34 15.1,38.34 15.45,38.34 C15.8,38.34 16.16,38.34 16.51,38.34 C16.86,38.34 17.21,38.34 17.57,38.34 C17.92,38.34 18.27,38.34 18.62,38.34 C18.97,38.34 19.33,38.34 19.68,38.34 C20.03,38.34 20.38,38.34 20.74,38.34 C21.09,38.34 21.44,38.34 21.79,38.34 C22.14,38.34 22.5,38.34 22.85,38.34 C23.2,38.34 23.55,38.34 23.91,38.34 C24.26,38.34 24.61,38.34 24.96,38.34 C25.31,38.34 25.67,38.34 26.02,38.34 C26.37,38.34 26.72,38.34 27.08,38.34 C27.43,38.34 27.78,38.34 28.13,38.34 C28.48,38.34 28.84,38.34 29.19,38.34 C29.54,38.34 29.91,38.35 30.24,38.34 C30.58,38.32 31.16,38.41 31.22,38.26 C31.28,38.11 30.81,37.72 30.61,37.46 C30.41,37.19 30.21,36.92 30.0,36.65 C29.79,36.39 29.62,36.04 29.36,35.86 C29.09,35.68 28.75,35.63 28.42,35.58 C28.08,35.54 27.71,35.58 27.36,35.58 C27.01,35.58 26.66,35.58 26.3,35.58 C25.95,35.58 25.6,35.58 25.25,35.58 C24.89,35.58 24.54,35.58 24.19,35.58 C23.84,35.58 23.49,35.58 23.13,35.58 C22.78,35.58 22.43,35.58 22.08,35.58 C21.72,35.58 21.37,35.58 21.02,35.58 C20.67,35.58 20.32,35.58 19.96,35.58 C19.61,35.58 19.26,35.58 18.91,35.58 C18.56,35.58 18.2,35.58 17.85,35.58 C17.5,35.58 17.15,35.58 16.79,35.58 C16.44,35.58 16.09,35.58 15.74,35.58 C15.39,35.58 15.03,35.58 14.68,35.58 C14.33,35.58 13.89,35.44 13.62,35.58 Z" {...p} />
      <path d="M11.02,39.1 C10.76,39.24 10.49,39.75 10.56,39.95 C10.64,40.15 11.15,40.26 11.49,40.33 C11.84,40.39 12.25,40.33 12.62,40.33 C13.0,40.33 13.37,40.33 13.75,40.33 C14.13,40.33 14.5,40.33 14.88,40.33 C15.25,40.33 15.63,40.33 16.0,40.33 C16.38,40.33 16.76,40.33 17.13,40.33 C17.51,40.33 17.88,40.33 18.26,40.33 C18.64,40.33 19.01,40.33 19.39,40.33 C19.76,40.33 20.14,40.33 20.51,40.33 C20.89,40.33 21.27,40.33 21.64,40.33 C22.02,40.33 22.39,40.33 22.77,40.33 C23.15,40.33 23.52,40.33 23.9,40.33 C24.27,40.33 24.65,40.33 25.02,40.33 C25.4,40.33 25.78,40.33 26.15,40.33 C26.53,40.33 26.9,40.33 27.28,40.33 C27.66,40.33 28.03,40.33 28.41,40.33 C28.78,40.33 29.16,40.33 29.53,40.33 C29.91,40.33 30.29,40.33 30.66,40.33 C31.04,40.33 31.52,40.46 31.79,40.33 C32.06,40.2 32.35,39.74 32.27,39.54 C32.19,39.33 31.66,39.18 31.32,39.1 C30.97,39.03 30.57,39.1 30.19,39.1 C29.82,39.1 29.44,39.1 29.06,39.1 C28.69,39.1 28.31,39.1 27.94,39.1 C27.56,39.1 27.18,39.1 26.81,39.1 C26.43,39.1 26.06,39.1 25.68,39.1 C25.31,39.1 24.93,39.1 24.55,39.1 C24.18,39.1 23.8,39.1 23.43,39.1 C23.05,39.1 22.67,39.1 22.3,39.1 C21.92,39.1 21.55,39.1 21.17,39.1 C20.79,39.1 20.42,39.1 20.04,39.1 C19.67,39.1 19.29,39.1 18.92,39.1 C18.54,39.1 18.16,39.1 17.79,39.1 C17.41,39.1 17.04,39.1 16.66,39.1 C16.28,39.1 15.91,39.1 15.53,39.1 C15.16,39.1 14.78,39.1 14.41,39.1 C14.03,39.1 13.65,39.1 13.28,39.1 C12.9,39.1 12.53,39.1 12.15,39.1 C11.77,39.1 11.29,38.96 11.02,39.1 Z" {...p} />
      <path d="M10.87,42.93 C10.66,43.08 10.57,43.68 10.73,43.86 C10.88,44.04 11.43,43.98 11.79,44.0 C12.15,44.02 12.54,44.0 12.91,44.0 C13.29,44.0 13.66,44.0 14.03,44.0 C14.41,44.0 14.78,44.0 15.16,44.0 C15.53,44.0 15.9,44.0 16.28,44.0 C16.65,44.0 17.03,44.0 17.4,44.0 C17.77,44.0 18.15,44.0 18.52,44.0 C18.9,44.0 19.27,44.0 19.64,44.0 C20.02,44.0 20.39,44.0 20.77,44.0 C21.14,44.0 21.51,44.0 21.89,44.0 C22.26,44.0 22.64,44.0 23.01,44.0 C23.38,44.0 23.76,44.0 24.13,44.0 C24.51,44.0 24.88,44.0 25.25,44.0 C25.63,44.0 26.0,44.0 26.38,44.0 C26.75,44.0 27.13,44.0 27.5,44.0 C27.87,44.0 28.25,44.0 28.62,44.0 C29.0,44.0 29.37,44.0 29.74,44.0 C30.12,44.0 30.49,44.0 30.87,44.0 C31.24,44.0 31.78,44.15 31.99,44.0 C32.2,43.85 32.28,43.25 32.13,43.07 C31.98,42.89 31.43,42.95 31.07,42.93 C30.7,42.9 30.32,42.93 29.95,42.93 C29.57,42.93 29.2,42.93 28.82,42.93 C28.45,42.93 28.08,42.93 27.7,42.93 C27.33,42.93 26.95,42.93 26.58,42.93 C26.21,42.93 25.83,42.93 25.46,42.93 C25.08,42.93 24.71,42.93 24.34,42.93 C23.96,42.93 23.59,42.93 23.21,42.93 C22.84,42.93 22.47,42.93 22.09,42.93 C21.72,42.93 21.34,42.93 20.97,42.93 C20.6,42.93 20.22,42.93 19.85,42.93 C19.47,42.93 19.1,42.93 18.72,42.93 C18.35,42.93 17.98,42.93 17.6,42.93 C17.23,42.93 16.85,42.93 16.48,42.93 C16.11,42.93 15.73,42.93 15.36,42.93 C14.98,42.93 14.61,42.93 14.24,42.93 C13.86,42.93 13.49,42.93 13.11,42.93 C12.74,42.93 12.37,42.93 11.99,42.93 C11.62,42.93 11.08,42.77 10.87,42.93 Z" {...p} />
      <path d="M10.87,41.09 C10.66,41.25 10.57,41.84 10.73,42.02 C10.88,42.2 11.43,42.14 11.79,42.16 C12.15,42.19 12.54,42.16 12.91,42.16 C13.29,42.16 13.66,42.16 14.03,42.16 C14.41,42.16 14.78,42.16 15.16,42.16 C15.53,42.16 15.9,42.16 16.28,42.16 C16.65,42.16 17.03,42.16 17.4,42.16 C17.77,42.16 18.15,42.16 18.52,42.16 C18.9,42.16 19.27,42.16 19.64,42.16 C20.02,42.16 20.39,42.16 20.77,42.16 C21.14,42.16 21.51,42.16 21.89,42.16 C22.26,42.16 22.64,42.16 23.01,42.16 C23.38,42.16 23.76,42.16 24.13,42.16 C24.51,42.16 24.88,42.16 25.25,42.16 C25.63,42.16 26.0,42.16 26.38,42.16 C26.75,42.16 27.13,42.16 27.5,42.16 C27.87,42.16 28.25,42.16 28.62,42.16 C29.0,42.16 29.37,42.16 29.74,42.16 C30.12,42.16 30.49,42.16 30.87,42.16 C31.24,42.16 31.78,42.32 31.99,42.16 C32.2,42.01 32.28,41.41 32.13,41.24 C31.98,41.06 31.43,41.12 31.07,41.09 C30.7,41.07 30.32,41.09 29.95,41.09 C29.57,41.09 29.2,41.09 28.82,41.09 C28.45,41.09 28.08,41.09 27.7,41.09 C27.33,41.09 26.95,41.09 26.58,41.09 C26.21,41.09 25.83,41.09 25.46,41.09 C25.08,41.09 24.71,41.09 24.34,41.09 C23.96,41.09 23.59,41.09 23.21,41.09 C22.84,41.09 22.47,41.09 22.09,41.09 C21.72,41.09 21.34,41.09 20.97,41.09 C20.6,41.09 20.22,41.09 19.85,41.09 C19.47,41.09 19.1,41.09 18.72,41.09 C18.35,41.09 17.98,41.09 17.6,41.09 C17.23,41.09 16.85,41.09 16.48,41.09 C16.11,41.09 15.73,41.09 15.36,41.09 C14.98,41.09 14.61,41.09 14.24,41.09 C13.86,41.09 13.49,41.09 13.11,41.09 C12.74,41.09 12.37,41.09 11.99,41.09 C11.62,41.09 11.08,40.94 10.87,41.09 Z" {...p} />
      <circle cx="24" cy="10" r="1.1" fill={mark} stroke="none" />
    </svg>

  );

  if (type === "B") return (
    <svg {...svgProps}>
      <circle cx="22.5" cy="6.5" r="2.2" {...p} />
      <path d="M14 24 C14 14 22.5 10 22.5 10 C22.5 10 31 14 31 24 C31 29 27.5 31.5 24 32.5 L21 32.5 C17.5 31.5 14 29 14 24 Z" {...p} />
      <path d="M17 16.5 L28 20" stroke={mark} strokeWidth="1.8" strokeLinecap="round" fill="none" />
      <rect x="18.5" y="32.5" width="8" height="2.5" {...p} />
      <path d="M15 38 C15 35.5 18 34 22.5 34 C27 34 30 35.5 30 38 Z" {...p} />
      <rect x="10.5" y="38" width="24" height="3.5" rx="1.5" {...p} />
    </svg>
  );

  if (type === "R") return (
    <svg {...svgProps}>
      <path d="M12 9 H16.5 V13 H19.5 V9 H25.5 V13 H28.5 V9 H33 V17 H12 Z" {...p} />
      <path d="M15.5 18.5 H29.5" stroke={mark} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15.5 20 L29.5 20 L28 33.5 L17 33.5 Z" {...p} />
      <rect x="10.5" y="33.5" width="24" height="4.5" rx="1.5" {...p} />
    </svg>
  );

  if (type === "Q") return (
    <svg {...svgProps}>
      <circle cx="10.5" cy="12" r="2" {...p} />
      <circle cx="17" cy="7.5" r="2" {...p} />
      <circle cx="22.5" cy="6" r="2.2" {...p} />
      <circle cx="28" cy="7.5" r="2" {...p} />
      <circle cx="34.5" cy="12" r="2" {...p} />
      <path d="M10.5 14 L17 9.5 L19 20 L22.5 8 L26 20 L28 9.5 L34.5 14 L32 24 C31 27.5 27.5 29 22.5 29 C17.5 29 14 27.5 13 24 Z" {...p} />
      <path d="M16 22.5 H29" stroke={mark} strokeWidth="1.6" strokeLinecap="round" />
      <rect x="17.5" y="29" width="10" height="3" {...p} />
      <path d="M14.5 38 C14.5 35.5 18 33.5 22.5 33.5 C27 33.5 30.5 35.5 30.5 38 Z" {...p} />
      <rect x="10" y="38" width="25" height="3.5" rx="1.5" {...p} />
    </svg>
  );

  if (type === "K") return (
    <svg {...svgProps}>
      <rect x="21" y="2" width="3" height="7" {...p} />
      <rect x="18" y="4.5" width="9" height="2.5" {...p} />
      <path d="M15 20 C15 13 18.5 9.5 22.5 9.5 C26.5 9.5 30 13 30 20 Z" {...p} />
      <path d="M16.5 23 L28.5 23 L27 33.5 L18 33.5 Z" {...p} />
      <path d="M15.5 25 L29.5 25" stroke={mark} strokeWidth="2" fill="none" />
      <rect x="10.5" y="33.5" width="24" height="4.5" rx="1.5" {...p} />
    </svg>
  );

  return null;
}

function ChessGame() {
  const c = useColors();
  const clock = useRunningClock();
  const boardRef = useRef(null);
  const [playerColor, setPlayerColor] = useState("w");
  const [board, setBoard] = useState(() => initialChessBoard());
  const [state, setState] = useState({ castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null });
  const [turn, setTurn] = useState("w");
  const [selected, setSelected] = useState(null);
  const [status, setStatus] = useState("ongoing");
  const [thinking, setThinking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lastMove, setLastMove] = useState(null); // { fr, fc, tr, tc } — highlights the most recent move, ours or the computer's
  const [drag, setDrag] = useState(null); // { r, c, piece, x, y, startX, startY } — x/y are board-relative pixel coords, not viewport coords
  const [gameId, setGameId] = useState(0); // bumped on reset so the engine effect re-runs even when turn stays "w"

  const engineColor = playerColor === "w" ? "b" : "w";
  const gameOver = status === "checkmate" || status === "stalemate";
  const legalMoves = useMemo(() => (selected ? generateLegalMoves(board, state, turn).filter((m) => m.fr === selected.r && m.fc === selected.c) : []), [selected, board, state, turn]);
  const kingInCheckSquare = useMemo(() => {
    if (status !== "check" && status !== "checkmate") return null;
    const [kr, kc] = findKing(board, turn);
    return kr < 0 ? null : { r: kr, c: kc };
  }, [status, board, turn]);

  useEffect(() => {
    if (gameOver || paused || turn !== engineColor) return;
    setThinking(true);
    const t = setTimeout(() => {
      const depth = chooseEngineDepth(board);
      const { move } = negamaxChess(board, state, depth, -Infinity, Infinity, engineColor);
      if (move) {
        const { board: nb, state: ns } = applyChessMove(board, state, move);
        const nextTurn = engineColor === "w" ? "b" : "w";
        setBoard(nb);
        setState(ns);
        setTurn(nextTurn);
        setStatus(chessStatus(nb, ns, nextTurn));
        setLastMove({ fr: move.fr, fc: move.fc, tr: move.tr, tc: move.tc });
      }
      setThinking(false);
    }, 260);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, gameOver, paused, engineColor, gameId]);

  const attemptMove = (fr, fc, tr, tc) => {
    const move = generateLegalMoves(board, state, playerColor).filter((m) => m.fr === fr && m.fc === fc).find((m) => m.tr === tr && m.tc === tc);
    if (!move) return false;
    const { board: nb, state: ns } = applyChessMove(board, state, move);
    const nextTurn = playerColor === "w" ? "b" : "w";
    setBoard(nb);
    setState(ns);
    setTurn(nextTurn);
    setStatus(chessStatus(nb, ns, nextTurn));
    setLastMove({ fr, fc, tr, tc });
    setSelected(null);
    return true;
  };

  const canInteract = () => !gameOver && !thinking && !paused && turn === playerColor;

  // Every drag coordinate is measured relative to the board's own
  // bounding box and rendered with position:absolute inside that same
  // board element. Using position:fixed + viewport coordinates here
  // breaks inside a scaled/transformed preview container — the ghost
  // piece ends up positioned relative to that ancestor's box instead
  // of the true viewport, which is exactly the "piece jumps to the
  // far right" bug.
  const relativePoint = (e) => {
    const rect = boardRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e, r, cIdx) => {
    if (!canInteract()) return;
    const piece = board[r][cIdx];
    if (piece && pieceColor(piece) === playerColor) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const pt = relativePoint(e);
      setSelected({ r, c: cIdx });
      setDrag({ r, c: cIdx, piece, x: pt.x, y: pt.y, startX: e.clientX, startY: e.clientY });
      return;
    }
    if (selected) { if (!attemptMove(selected.r, selected.c, r, cIdx)) setSelected(null); }
  };
  const handlePointerMove = (e) => {
    if (!drag) return;
    const pt = relativePoint(e);
    setDrag((prev) => (prev ? { ...prev, x: pt.x, y: pt.y } : prev));
  };
  const handlePointerUp = (e) => {
    if (!drag) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 6;
    if (moved) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el ? el.closest("[data-chess-square]") : null;
      if (target) {
        const tr = parseInt(target.getAttribute("data-row"), 10);
        const tc = parseInt(target.getAttribute("data-col"), 10);
        attemptMove(drag.r, drag.c, tr, tc);
      }
    }
    setDrag(null);
  };

  const togglePause = () => {
    if (gameOver) return;
    if (paused) clock.resume(); else clock.pause();
    setPaused(!paused);
  };

  const resetGame = () => {
    const nextPlayerColor = playerColor === "w" ? "b" : "w";
    setPlayerColor(nextPlayerColor);
    setBoard(initialChessBoard());
    setState({ castling: { wK: true, wQ: true, bK: true, bQ: true }, enPassant: null });
    setTurn("w");
    setSelected(null);
    setStatus("ongoing");
    setThinking(false);
    setPaused(false);
    setLastMove(null);
    setDrag(null);
    setGameId((id) => id + 1);
    clock.start();
  };

  const flip = playerColor === "b";
  const rows = flip ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const cols = flip ? [...Array(8).keys()].reverse() : [...Array(8).keys()];

  let statusLine;
  if (status === "checkmate") statusLine = `Checkmate. ${turn === "w" ? "Black" : "White"} wins.`;
  else if (status === "stalemate") statusLine = "Stalemate. Draw.";
  else if (paused) statusLine = "Paused. Click the timer to resume.";
  else if (thinking) statusLine = "The computer is thinking…";
  else if (status === "check") statusLine = `Check. ${turn === "w" ? "White" : "Black"} to move.`;
  else statusLine = turn === playerColor ? "Your move." : "Computer's move.";

  return (
    <div style={styles(c).chessWrap} className="fade-in">
      <div style={styles(c).chessTopRow}>
        <p style={styles(c).levelLabel}>You're playing {playerColor === "w" ? "White" : "Black"}</p>
        <button
          type="button"
          style={{ ...styles(c).chessTimerBadge, ...(paused ? styles(c).chessTimerBadgePaused : {}) }}
          onClick={togglePause}
          disabled={gameOver}
          title="Click to pause or resume the clock"
        >
          {paused ? "⏸ " : ""}{formatStopwatch(clock.ms)}
        </button>
      </div>
      {status !== "checkmate" && <p style={styles(c).chessStatus}>{statusLine}</p>}

      <div ref={boardRef} style={styles(c).chessBoard} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
        {rows.map((r, ri) => (
          <div key={r} style={styles(c).chessRow}>
            {cols.map((cIdx, ci) => {
              const isLight = (r + cIdx) % 2 === 0;
              const isSelected = selected && selected.r === r && selected.c === cIdx;
              const isLegal = legalMoves.some((m) => m.tr === r && m.tc === cIdx);
              const isLastMove = lastMove && ((lastMove.fr === r && lastMove.fc === cIdx) || (lastMove.tr === r && lastMove.tc === cIdx));
              const isCheckSquare = kingInCheckSquare && kingInCheckSquare.r === r && kingInCheckSquare.c === cIdx;
              const piece = board[r][cIdx];
              const isDragSource = drag && drag.r === r && drag.c === cIdx;
              const showRank = ci === 0;
              const showFile = ri === rows.length - 1;
              return (
                <button
                  key={cIdx}
                  className="tile-btn"
                  data-chess-square="true"
                  data-row={r}
                  data-col={cIdx}
                  onPointerDown={(e) => handlePointerDown(e, r, cIdx)}
                  style={{
                    ...styles(c).chessSquare,
                    ...(isLight ? styles(c).chessSquareLight : styles(c).chessSquareDark),
                    ...(isSelected ? styles(c).chessSquareSelected : {}),
                  }}
                >
                  {isLastMove && <span style={styles(c).chessLastMoveTint} />}
                  {isCheckSquare && <span style={styles(c).chessCheckTint} />}
                  {showRank && <span style={{ ...styles(c).chessCoordRank, color: isLight ? "#6B4A2E" : "#E8DCC6" }}>{8 - r}</span>}
                  {showFile && <span style={{ ...styles(c).chessCoordFile, color: isLight ? "#6B4A2E" : "#E8DCC6" }}>{String.fromCharCode(97 + cIdx)}</span>}
                  {piece && (
                    <span style={{ ...styles(c).chessPieceIconWrap, opacity: isDragSource ? 0.25 : 1 }}>
                      <ChessPieceIcon type={pieceType(piece)} color={pieceColor(piece)} />
                    </span>
                  )}
                  {isLegal && <span style={styles(c).chessLegalDot} />}
                </button>
              );
            })}
          </div>
        ))}

        {drag && (
          <div style={{ ...styles(c).chessDragGhost, left: drag.x, top: drag.y }}>
            <ChessPieceIcon type={pieceType(drag.piece)} color={pieceColor(drag.piece)} />
          </div>
        )}

        {status === "checkmate" && (
          <div style={styles(c).chessCheckmateOverlay}>
            <p style={styles(c).chessCheckmateText}>Checkmate</p>
            <p style={styles(c).chessCheckmateSub}>{turn === "w" ? "Black wins" : "White wins"}</p>
          </div>
        )}
      </div>

      <button style={styles(c).btnGhost} onClick={resetGame}>Reset: new game as {playerColor === "w" ? "Black" : "White"}</button>
    </div>
  );
}

// =================================================================
// Games menu — the landing screen shown whenever the Games nav is
// clicked. The player picks a game card here; the sub-tab bar (with
// an "All Games" link back to this screen) only appears once a
// specific game is open.
// =================================================================
function GamesMenu({ onSelect }) {
  const c = useColors();
  return (
    <div style={styles(c).gamesMenuWrap} className="fade-in">
      <p style={styles(c).rvHeading}>Brain Games</p>
      <p style={styles(c).instruction}>Choose a game to play or practice.</p>
      <div style={styles(c).gamesMenuGrid}>
        {GAME_TABS.map((t) => (
          <Link key={t.key} to={`/games/${GAME_SLUG[t.key]}`} className="nav-btn" style={styles(c).gamesMenuCard}>
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

// =================================================================
// Exercises menu — same pattern as the Games menu: pick a card here,
// open the specific exercise. Each card also carries a short
// description of what the exercise trains, since (unlike the Games
// cards) the point here is that a newcomer should understand what
// they're about to do before opening it.
// =================================================================
const EXERCISE_TABS = [
  {
    key: "breathing", label: "Mindfulness Breathing",
    description: "A guided breathing rhythm: watch the ball expand as you breathe in, hold as you hold your breath, and release as you breathe out, training slower, calmer, more deliberate breathing.",
  },
  {
    key: "leet", label: "Leetspeak Reading",
    description: "Decoding text written in leetspeak forces your brain to slow down and consciously reconstruct each word, training visual attention, pattern recognition, and reading fluency.",
  },
  {
    key: "flowtype", label: "Flow Type",
    description: "Typing continuously without stopping builds sustained focus and mental stamina, training your brain to keep producing language under light pressure without breaking concentration.",
  },
  {
    key: "guilford", label: "Guilford's Test",
    description: "A classic divergent thinking task: naming unusual uses for an everyday object exercises creative fluency, the ability to generate many different ideas instead of settling on the first obvious one.",
  },
];

function ExercisesMenu({ onSelect }) {
  const c = useColors();
  return (
    <div style={styles(c).gamesMenuWrap} className="fade-in">
      <p style={styles(c).rvHeading}>Mind Exercises</p>
      <p style={styles(c).instruction}>Choose an exercise to practice.</p>
      <div style={styles(c).exercisesMenuGrid}>
        {EXERCISE_TABS.map((t) => (
          <Link key={t.key} to={`/exercises/${EXERCISE_SLUG[t.key]}`} className="nav-btn" style={styles(c).exerciseMenuCard}>
            <span className="exercise-card-title" style={styles(c).exerciseMenuCardTitle}>{t.label}</span>
            <span className="exercise-card-desc" style={styles(c).exerciseMenuCardDesc}>{t.description}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// =================================================================
// Mindfulness Breathing. A guided breathing rhythm: a 5 second
// countdown, then breathe in for 4 seconds, hold for 6, breathe out
// for 8 (with a burst of particles at the release), hold for 4, then
// repeat. Every count is a real, exact second — each phase's total
// duration is literally its count multiplied by 1000ms, not a fixed
// duration divided into steps, so the pacing never drifts as the
// count numbers change between phases.
//
// The phase label and the count both live inside the ball itself
// (not below it), so they scale up and down automatically as the
// ball's own transform grows and shrinks, rather than staying a
// fixed size while the ball moves around them.
// =================================================================
const BREATH_PHASES = [
  { key: "in", label: "Breathe In", color: "#5FB8A8", counts: 4 },
  { key: "hold1", label: "Hold", color: "#8E7CC3", counts: 6 },
  { key: "out", label: "Breathe Out", color: "#E2AA3B", counts: 8 },
  { key: "hold2", label: "Hold", color: "#8E7CC3", counts: 4 },
];
const BREATH_COUNTDOWN_FROM = 5;
const BREATH_PARTICLE_COUNT = 22;
const BREATH_BALL_REST = 105;
const BREATH_BALL_EXPANDED_SCALE = 1.85;

// =================================================================
// Home page ambient breathing visual. A lighter version of the
// Mindfulness Breathing exercise: same phase colors, same 4-6-8-4
// second-exact timing, same progressive per-second expand/contract,
// and the same particle burst on release — but with no numbers, no
// "Get Ready" countdown, and no Start button. It autoplays as soon
// as Home loads and loops forever, purely as an ambient piece. The
// ball also drifts to a new random position inside the frame at the
// start of every phase, so it never sits still or repeats a path;
// since the target is freshly randomized each time rather than following
// a fixed route, there's no pattern to recognize.
// =================================================================
const HOME_BREATH_BALL_REST = 46;

const HOME_BREATH_LABELS = { in: "Inhale", hold1: "Hold", out: "Exhale", hold2: "Hold" };

function HomeAmbientBreathing({ onOpenExercise }) {
  const c = useColors();
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [tick, setTick] = useState(1);
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const timeoutsRef = useRef([]);

  const after = (ms, fn) => { const t = setTimeout(fn, ms); timeoutsRef.current.push(t); };
  const clearTimers = () => { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; };

  const pickPos = () => ({ x: 18 + Math.random() * 64, y: 22 + Math.random() * 56 });

  const runPhase = (idx) => {
    const ph = BREATH_PHASES[idx];
    setPhaseIndex(idx);
    setTick(1);
    setPos(pickPos());
    for (let i = 2; i <= ph.counts; i++) after(1000 * (i - 1), () => setTick(i));
    after(1000 * ph.counts, () => runPhase((idx + 1) % BREATH_PHASES.length));
  };

  useEffect(() => { runPhase(0); return clearTimers; }, []);

  const phase = BREATH_PHASES[phaseIndex];
  const isIn = phase.key === "in";
  const isOut = phase.key === "out";
  let ballScale = 1;
  if (isIn) ballScale = 1 + (tick / phase.counts) * (BREATH_BALL_EXPANDED_SCALE - 1);
  else if (isOut) ballScale = BREATH_BALL_EXPANDED_SCALE - ((tick - 1) / (phase.counts - 1)) * (BREATH_BALL_EXPANDED_SCALE - 1);
  else if (phase.key === "hold1") ballScale = BREATH_BALL_EXPANDED_SCALE;
  const phaseMs = phase.counts * 1000;
  const ballTransition = `left ${phaseMs}ms ease-in-out, top ${phaseMs}ms ease-in-out, ${(isIn || isOut) ? "transform 1000ms linear" : "transform 0.6s ease"}, background 0.6s ease`;

  return (
    <button type="button" style={styles(c).homeBreathFrame} onClick={() => onOpenExercise("breathing")} aria-label="Open Mindfulness Breathing exercise">
      <div style={{ ...styles(c).homeBreathBall, left: `${pos.x}%`, top: `${pos.y}%`, background: phase.color, transform: `translate(-50%, -50%) scale(${ballScale})`, transition: ballTransition }}>
        <span style={styles(c).homeBreathBallLabel}>{HOME_BREATH_LABELS[phase.key]}</span>
      </div>
    </button>
  );
}


function MindfulnessBreathingExercise() {
  const c = useColors();
  const [stage, setStage] = useState("intro"); // intro | countdown | active
  const [countdownValue, setCountdownValue] = useState(BREATH_COUNTDOWN_FROM);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [count, setCount] = useState(1);
  const [burstKey, setBurstKey] = useState(0);
  const timeoutsRef = useRef([]);

  const after = (ms, fn) => { const t = setTimeout(fn, ms); timeoutsRef.current.push(t); };
  const clearTimers = () => { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = []; };
  useEffect(() => () => clearTimers(), []);

  const runPhase = (idx) => {
    const ph = BREATH_PHASES[idx];
    setPhaseIndex(idx);
    setCount(1);
    if (ph.key === "out") setBurstKey((k) => k + 1);
    for (let i = 2; i <= ph.counts; i++) after(1000 * (i - 1), () => setCount(i));
    after(1000 * ph.counts, () => runPhase((idx + 1) % BREATH_PHASES.length));
  };

  const handleStart = () => {
    setStage("countdown");
    setCountdownValue(BREATH_COUNTDOWN_FROM);
    for (let i = 1; i < BREATH_COUNTDOWN_FROM; i++) {
      after(1000 * i, () => setCountdownValue(BREATH_COUNTDOWN_FROM - i));
    }
    after(1000 * BREATH_COUNTDOWN_FROM, () => { setStage("active"); runPhase(0); });
  };

  const handleStop = () => { clearTimers(); setStage("intro"); setPhaseIndex(0); setCount(1); };

  const phase = BREATH_PHASES[phaseIndex];
  const isIn = phase.key === "in";
  const isOut = phase.key === "out";

  // Scale is computed from the CURRENT count, not just the phase, so
  // the ball visibly grows or shrinks a little more with every single
  // tick (a smooth 1-second step each time) rather than jumping once
  // to its final size the moment the phase begins.
  const REST_SCALE = 1;
  let ballScale = REST_SCALE;
  if (isIn) {
    ballScale = REST_SCALE + (count / phase.counts) * (BREATH_BALL_EXPANDED_SCALE - REST_SCALE);
  } else if (isOut) {
    ballScale = BREATH_BALL_EXPANDED_SCALE - ((count - 1) / (phase.counts - 1)) * (BREATH_BALL_EXPANDED_SCALE - REST_SCALE);
  } else if (phase.key === "hold1") {
    ballScale = BREATH_BALL_EXPANDED_SCALE;
  }
  const ballTransition = (isIn || isOut) ? "transform 1000ms linear, background 0.6s ease" : "background 0.6s ease";

  const particles = Array.from({ length: BREATH_PARTICLE_COUNT }, (_, i) => {
    const angle = (i / BREATH_PARTICLE_COUNT) * Math.PI * 2 + (i % 2 === 0 ? 0.15 : -0.15);
    const distance = 160 + (i % 4) * 26;
    const size = 8 + (i % 5) * 4;
    const delay = (i % 5) * 45;
    return { tx: Math.cos(angle) * distance, ty: Math.sin(angle) * distance, size, delay };
  });

  if (stage === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Mindfulness Breathing</p>
        <p style={styles(c).rvSubhead}>Breath Work</p>
        <p style={styles(c).instruction}>Watch the ball. It expands as you breathe in, holds as you hold your breath, and releases as you breathe out. Follow its pace for a few rounds.</p>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Start</button>
      </div>
    );
  }

  if (stage === "countdown") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Mindfulness Breathing</p>
        <div style={styles(c).breathFrame}>
          <div style={{ ...styles(c).breathBall, background: "#4FA3D1" }}>
            <span style={styles(c).breathBallLabel}>Get Ready</span>
            <span style={styles(c).breathCount}>{countdownValue}</span>
          </div>
        </div>
        <button style={styles(c).btnGhost} onClick={handleStop}>Cancel</button>
      </div>
    );
  }

  return (
    <div style={styles(c).nbackWrap} className="fade-in">
      <p style={styles(c).rvHeading}>Mindfulness Breathing</p>
      <div style={styles(c).breathFrame}>
        {isOut && (
          <div key={burstKey} style={styles(c).breathParticleWrap}>
            {particles.map((p, i) => (
              <span
                key={i}
                className="breath-particle"
                style={{ ...styles(c).breathParticle, width: p.size, height: p.size, background: phase.color, animationDelay: `${p.delay}ms`, "--tx": `${p.tx}px`, "--ty": `${p.ty}px` }}
              />
            ))}
          </div>
        )}
        <div style={{ ...styles(c).breathBall, background: phase.color, transform: `scale(${ballScale})`, transition: ballTransition }}>
          <span style={styles(c).breathBallLabel}>{phase.label}</span>
          <span style={styles(c).breathCount}>{count}</span>
        </div>
      </div>
      <button style={styles(c).btnGhost} onClick={handleStop}>Stop</button>
    </div>
  );
}

// =================================================================
// Leetspeak Reading. Encodes generated short stories into the same
// leetspeak style already used on the home page (a/e/i/o -> 4/3/1/0,
// everything else including original casing left untouched), and
// presents them as a continuous reading exercise.
//
// Rather than hand-writing thousands of individual stories (not
// practical at that volume), stories are assembled from a bank of
// characters, sidekicks, settings, magic objects, twists, and
// morals, combined through several distinct narrative templates.
// The combined space is large enough that repeats are effectively
// never noticed in normal use; a short-term "recently shown" list
// also blocks the exact same combination from repeating back to
// back.
// =================================================================
function leetify(text) {
  let out = "";
  for (const ch of text) {
    if (ch === "a" || ch === "A") out += "4";
    else if (ch === "e" || ch === "E") out += "3";
    else if (ch === "i" || ch === "I") out += "1";
    else if (ch === "o" || ch === "O") out += "0";
    else out += ch;
  }
  return out;
}

const STORY_NAMES = ["Mira", "Oskar", "Priya", "Leo", "Sana", "Theo", "Amara", "Kofi", "Yuki", "Noor", "Diego", "Ivy", "Nell", "Gio", "Wren", "Suki", "Tobin", "Alma", "Ezra", "Fen"];
const STORY_SIDEKICKS = ["a talking crow", "a shy dragon the size of a cat", "a clockwork rabbit", "a grumpy garden gnome", "a tiny cloud spirit", "a lost star that had forgotten how to shine", "a silver fox with one crooked ear", "a paper airplane that could fly itself", "a snail carrying a shell full of stars", "a firefly with a broken light"];
const STORY_SETTINGS = ["a village built inside a hollow tree", "a school at the bottom of a warm lake", "a floating library that drifted a little every night", "a town where it rained colors instead of water", "a forest where every shadow had its own life", "a city built on the back of a sleeping stone giant", "a carnival that only appeared at midnight", "a house with staircases that rearranged themselves while you slept", "a valley where the wind carried whispered secrets", "a small island that moved a little further out to sea each day"];
const STORY_OBJECTS = ["a key that opened every door except the one it was meant for", "a mirror that showed yesterday instead of today", "a paintbrush that made anything real, badly", "a compass that pointed toward whatever you were afraid of", "a music box that played other people's memories", "a lantern that only lit up when you told the truth", "a pair of boots that walked backward through time", "a seed that grew whatever you wished for, imperfectly", "a hat that whispered other people's thoughts", "a bell that rang once for every lie told nearby"];
const STORY_TWISTS = ["it turned out the villain had been trying to help all along", "the monster everyone feared only wanted a friend", "the treasure was never gold, it was a memory someone had buried", "the map had been drawn backward on purpose", "the hero realized they were the one who had been lost the whole time", "the wish came true in the worst possible way, and that turned out to be lucky", "the quietest character in the whole story had been the bravest one from the start", "everyone had been trying to solve the wrong problem entirely", "the villain was simply a future, sadder version of the hero", "the ending had already happened, right at the very beginning, and no one had noticed"];
const STORY_LESSONS = ["sometimes the scariest things just need someone willing to listen", "being different is not the same as being wrong", "small kindnesses grow bigger than anyone expects", "the truth is heavier to carry than any secret", "getting lost is sometimes the only way to find something worth finding", "real courage is choosing to be kind exactly when it's hardest", "not every problem needs to be solved alone", "the world looks different once you stop being afraid of it", "some doors are worth knocking on twice", "you can't outrun who you are, only understand it a little better"];

const STORY_TEMPLATES = [
  ({ name, sidekick, setting, object, twist, lesson }) =>
    `In ${setting}, there lived a child named ${name} who believed in one simple rule: never trust ${object} more than your own eyes. That rule became hard to follow the day ${name} actually found it, half buried near an old wall. Curious despite every warning, ${name} picked it up, and immediately ${sidekick} appeared out of nowhere, insisting they had been guarding it for years.\n\n${sidekick} explained, in a voice equal parts nervous and proud, that the object was only dangerous to people who lied about wanting it. ${name} admitted the truth right away: they were bored, and wanted an adventure, nothing more. Satisfied, ${sidekick} agreed to help, and together they set off to learn what the object truly did.\n\nThe search led them through the strangest corners of ${setting}, past places most people avoided, until they reached the one person who might know the truth. But ${twist}. It changed everything ${name} thought they understood about the object, about ${sidekick}, and about the story they believed they were living inside.\n\nShaken, ${name} sat down right there and thought about what to do next. There was no simple fix, no obvious hero to call. Only a quiet choice, made without anyone watching. ${name} chose kindness anyway, even though it would have been easier not to.\n\nYears later, whenever ${name} told this story, it always ended the same way: ${lesson}. And every time, the listener went quiet for a moment, the way people do when a story lands somewhere they weren't expecting.`,

  ({ name, sidekick, setting, object, twist, lesson }) =>
    `${name} had lived in ${setting} for as long as anyone could remember, and had long ago stopped believing in ${object}. It was just a story adults told to keep children close to home. So when ${sidekick} showed up at the door one evening, insisting the object was real and already looking for ${name}, the reaction was mostly laughter.\n\nThe laughter didn't last. By morning, strange things were happening all through ${setting}, small at first, then impossible to ignore. ${sidekick} refused to say more than "I warned you," which was not helpful, and the two of them set out together to undo whatever had started.\n\nThey followed every clue they could find, argued more than once about which way to go, and slowly began to trust each other in the way people do when there's no one else left to trust. Then, without warning, ${twist}.\n\n${name} did not know what to do with that information at first. It rearranged everything, the danger, the object, even ${sidekick}'s place in the whole story. But standing there, with ${setting} quietly waiting to see what happened next, ${name} finally understood something simple and something true: ${lesson}.\n\nThat was the story ${name} told for the rest of their life, always leaving out the parts that still felt too strange to say out loud, and always keeping the ending exactly the same.`,

  ({ name, sidekick, setting, object, twist, lesson }) =>
    `Nobody in ${setting} would go near ${object}, and for years ${name} thought that was simply how things were. Then one afternoon, out of boredom more than bravery, ${name} went looking for it anyway, and found ${sidekick} sitting right beside it, as if waiting for exactly this moment.\n\n"You're not what I expected," ${sidekick} said, which ${name} took as a compliment, though it might not have been meant as one. Together they agreed to find out, once and for all, why everyone was so afraid.\n\nThe answer was not what either of them expected. Deep in the quietest part of ${setting}, past every warning sign, they discovered that ${twist}. ${name} had to sit with that for a long moment, turning it over, trying to make it fit with everything believed before.\n\nIt didn't fit, not neatly. But ${sidekick} pointed out, gently, that maybe it wasn't supposed to. Some things stay true even when they stop making sense. ${name} carried that thought all the way home, past every place that used to feel frightening and now simply felt familiar.\n\nWhen ${name} was much older and someone finally asked what had really happened that day, the answer was always the same: ${lesson}. It wasn't the whole story, but it was the part worth keeping.`,

  ({ name, sidekick, setting, object, twist, lesson }) =>
    `The first thing ${name} noticed about ${setting} was how quiet it was, right up until the night ${object} appeared, unannounced, exactly where it shouldn't have been. ${name} might have ignored it entirely, if not for ${sidekick}, who refused to let the matter drop.\n\n"Somebody has to ask what it wants," ${sidekick} insisted, and since nobody else seemed willing, that somebody turned out to be ${name}. The two of them spent the following days chasing an answer through every strange corner ${setting} had to offer, gathering more questions than they ever managed to solve.\n\nJust when it seemed like the mystery would stay a mystery forever, ${twist}. ${name} felt something shift, quietly but completely, the kind of change that doesn't announce itself until much later.\n\n${sidekick} didn't say "I told you so," though it would have been fair. Instead, the two of them simply sat with what they now knew, watching ${setting} return slowly to its old, ordinary quiet.\n\n${name} never forgot what that day taught, and repeated it to anyone who would listen: ${lesson}. Most people nodded politely. A few actually understood.`,

  ({ name, sidekick, setting, object, twist, lesson }) =>
    `${name} was not the bravest person in ${setting}, not even close, and would have been the first to admit it. So when ${object} went missing and ${sidekick} came asking for help finding it, ${name}'s first instinct was to suggest someone else entirely.\n\nThere was no one else. ${name} agreed, reluctantly, and the search began with far more nervousness than confidence. ${sidekick} seemed to know the way, or claimed to, and the two of them wound through every unfamiliar path ${setting} had to offer.\n\nWhat they found, eventually, was not what either had imagined. As it turned out, ${twist}. ${name} stood there for a long moment, feeling the old fear rearrange itself into something closer to understanding.\n\nIt would be nice to say ${name} became brave overnight, but that isn't quite true. What changed was smaller and steadier than that. ${name} simply kept going, one uncertain step after another, long after the fear should have won.\n\nThat, ${name} came to believe, was the real lesson hiding underneath everything else: ${lesson}. It took a long time to say it out loud, and even longer to actually believe it.`,
];

function generateLeetStory(recentSignatures) {
  let attempt = null;
  for (let i = 0; i < 20; i++) {
    const template = pick(STORY_TEMPLATES);
    const slots = {
      name: pick(STORY_NAMES), sidekick: pick(STORY_SIDEKICKS), setting: pick(STORY_SETTINGS),
      object: pick(STORY_OBJECTS), twist: pick(STORY_TWISTS), lesson: pick(STORY_LESSONS),
    };
    const signature = `${STORY_TEMPLATES.indexOf(template)}|${slots.name}|${slots.setting}|${slots.twist}`;
    if (!recentSignatures.has(signature)) {
      attempt = { text: template(slots), signature };
      break;
    }
    attempt = { text: template(slots), signature };
  }
  return attempt;
}

function LeetReadingExercise() {
  const c = useColors();
  const [phase, setPhase] = useState("intro"); // intro | reading
  const [story, setStory] = useState(null);
  const recentRef = useRef(new Set());

  const nextStory = () => {
    const result = generateLeetStory(recentRef.current);
    recentRef.current.add(result.signature);
    if (recentRef.current.size > 40) {
      recentRef.current = new Set([...recentRef.current].slice(-40));
    }
    setStory(result.text);
    setPhase("reading");
  };

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Leetspeak Reading</p>
        <p style={styles(c).rvSubhead}>Reading Fluency</p>
        <p style={styles(c).instruction}>Every story here is written in leetspeak (letters swapped for numbers). Decoding it as you read trains focus, pattern recognition, and reading speed. A fresh story loads each time, never the same one twice in a row.</p>
        <button style={styles(c).btnPrimary} onClick={nextStory}>Start Reading</button>
      </div>
    );
  }

  return (
    <div style={styles(c).nbackWrap} className="fade-in">
      <p style={styles(c).rvHeading}>Leetspeak Reading</p>
      <div style={styles(c).leetReadBox}>
        <p style={styles(c).leetReadText}>{leetify(story)}</p>
      </div>
      <button style={styles(c).btnPrimary} onClick={nextStory}>Next Story</button>
    </div>
  );
}

// =================================================================
// Flow Type. A continuous-typing endurance exercise: type anything,
// in English, without stopping. Pausing for more than 3 seconds at
// any point fails the attempt outright; reaching 700 words is a
// clean pass. There's no passage to copy and no accuracy check on
// wording — this is about sustaining continuous output, not typing
// speed or correctness. Language itself isn't validated (that would
// need a real language-detection service, which this app doesn't
// have); the instruction to write in English is stated up front and
// left to the player to follow.
// =================================================================
const FLOW_TYPE_TARGET_WORDS = 700;
const FLOW_TYPE_FAIL_MS = 3000;

function FlowTypeExercise() {
  const c = useColors();
  const [phase, setPhase] = useState("intro"); // intro | active | success | fail
  const [wordCount, setWordCount] = useState(0);
  const lastInputRef = useRef(0);
  const textareaRef = useRef(null);
  const intervalRef = useRef(null);

  const stopWatcher = () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };

  useEffect(() => () => stopWatcher(), []);

  const startWatcher = () => {
    stopWatcher();
    intervalRef.current = setInterval(() => {
      if (Date.now() - lastInputRef.current > FLOW_TYPE_FAIL_MS) {
        stopWatcher();
        setPhase("fail");
      }
    }, 200);
  };

  const handleStart = () => {
    setWordCount(0);
    if (textareaRef.current) textareaRef.current.value = "";
    lastInputRef.current = Date.now();
    setPhase("active");
    startWatcher();
    setTimeout(() => { if (textareaRef.current) textareaRef.current.focus(); }, 50);
  };

  const handleChange = (e) => {
    lastInputRef.current = Date.now();
    const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
    setWordCount(words);
    if (words >= FLOW_TYPE_TARGET_WORDS) {
      stopWatcher();
      setPhase("success");
    }
  };

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Flow Type</p>
        <p style={styles(c).rvSubhead}>Focus &amp; Stamina</p>
        <p style={styles(c).instruction}>Type anything you like, in English, with spaces and punctuation as normal. The only rule: never stop for more than 3 seconds. Pause too long and the attempt fails. Reach {FLOW_TYPE_TARGET_WORDS} words without stopping to pass.</p>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Start Typing</button>
      </div>
    );
  }

  if (phase === "fail") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <div style={styles(c).flowTypeFailBanner}>
          <p style={styles(c).flowTypeFailEmoji}>👎 😔</p>
          <p style={styles(c).flowTypeFailText}>Flow Broken</p>
          <p style={styles(c).resultText}>You paused for more than 3 seconds at {wordCount} words.</p>
        </div>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Try Again</button>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <div style={styles(c).flowTypeSuccessBanner}>
          <p style={styles(c).flowTypeFailEmoji}>👍 🎉</p>
          <p style={styles(c).flowTypeSuccessText}>Flow Complete</p>
          <p style={styles(c).resultText}>You reached {wordCount} words without breaking your flow.</p>
        </div>
        <button style={styles(c).btnPrimary} onClick={handleStart}>Go Again</button>
      </div>
    );
  }

  return (
    <div style={styles(c).nbackWrap} className="fade-in">
      <p style={styles(c).rvSubhead}>{wordCount} / {FLOW_TYPE_TARGET_WORDS} words</p>
      <div style={styles(c).timerTrack}><div style={{ ...styles(c).timerFill, width: `${Math.min(100, (wordCount / FLOW_TYPE_TARGET_WORDS) * 100)}%` }} /></div>
      <textarea
        ref={textareaRef}
        style={styles(c).flowTypeTextarea}
        placeholder="Start typing here, and don't stop…"
        onChange={handleChange}
        autoFocus
      />
    </div>
  );
}

// =================================================================
// Guilford's Test — modeled on J.P. Guilford's real Alternative Uses
// Test, a classic divergent-thinking measure. Shown one everyday
// physical object, the player lists 10 uses for it other than its
// obvious, intended one.
//
// IMPORTANT about the scoring: this app has no server and no AI
// behind it, so it cannot semantically judge whether an answer is
// "clever" or "makes sense" the way a person could. What it scores
// honestly is fluency, which is one real, legitimate part of how
// this test is actually scored in practice: how many of the 10
// answers are genuinely filled in, reasonably described, distinct
// from each other, and actually different from the object's normal
// use. That's a real structural measure, just not a creativity
// quality judgment.
// =================================================================
const GUILFORD_OBJECTS = [
  { name: "Tumbler", emoji: "🥤", usualUse: ["drink", "drinking", "water", "beverage", "liquid"] },
  { name: "Pen", emoji: "🖊️", usualUse: ["write", "writing", "ink", "sign"] },
  { name: "Helmet", emoji: "⛑️", usualUse: ["protect", "protection", "head", "safety", "riding"] },
  { name: "Brick", emoji: "🧱", usualUse: ["build", "building", "wall", "construction"] },
  { name: "Paperclip", emoji: "📎", usualUse: ["paper", "clip", "attach", "hold papers"] },
  { name: "Bucket", emoji: "🪣", usualUse: ["water", "carry water", "carry", "hold"] },
  { name: "Cap", emoji: "🧢", usualUse: ["wear", "head", "sun", "cover"] },
  { name: "Key", emoji: "🔑", usualUse: ["unlock", "lock", "door", "open"] },
  { name: "Spoon", emoji: "🥄", usualUse: ["eat", "stir", "food", "soup"] },
  { name: "Chair", emoji: "🪑", usualUse: ["sit", "sitting", "seat"] },
  { name: "Scarf", emoji: "🧣", usualUse: ["warm", "neck", "cold", "wear"] },
  { name: "Backpack", emoji: "🎒", usualUse: ["carry", "bag", "school", "items"] },
  { name: "Mirror", emoji: "🪞", usualUse: ["reflection", "look", "yourself", "face"] },
  { name: "Bottle", emoji: "🧴", usualUse: ["liquid", "water", "drink", "store"] },
  { name: "Basket", emoji: "🧺", usualUse: ["carry", "laundry", "fruit", "hold items"] },
  { name: "Hook", emoji: "🪝", usualUse: ["hang", "hold", "coat"] },
  { name: "Spool of Thread", emoji: "🧵", usualUse: ["sew", "sewing", "stitch"] },
  { name: "Fire Extinguisher", emoji: "🧯", usualUse: ["fire", "extinguish", "put out"] },
  { name: "Hammer", emoji: "🔨", usualUse: ["nail", "hit", "build"] },
  { name: "Tissue Roll", emoji: "🧻", usualUse: ["wipe", "clean", "toilet", "paper"] },
  { name: "Kite", emoji: "🪁", usualUse: ["fly", "wind", "play"] },
  { name: "Sock", emoji: "🧦", usualUse: ["wear", "foot", "feet", "warm"] },
  { name: "Balloon", emoji: "🎈", usualUse: ["party", "float", "air", "celebrate"] },
  { name: "Candle", emoji: "🕯️", usualUse: ["light", "wax", "burn", "flame"] },
  { name: "Ruler", emoji: "📏", usualUse: ["measure", "length", "straight"] },
  { name: "Scissors", emoji: "✂️", usualUse: ["cut", "cutting"] },
  { name: "Coin", emoji: "🪙", usualUse: ["money", "pay", "currency", "buy"] },
  { name: "Umbrella", emoji: "☂️", usualUse: ["rain", "shade", "protect"] },
  { name: "Rope", emoji: "🪢", usualUse: ["tie", "pull", "climb"] },
  { name: "Mousetrap", emoji: "🪤", usualUse: ["mouse", "trap", "catch"] },
];

function scoreGuilfordAnswers(answers, usualUse) {
  const trimmed = answers.map((a) => a.trim());
  const seen = new Set();
  return trimmed.map((text, i) => {
    if (!text) return { text, valid: false, reason: "Not answered" };
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    if (wordCount < 2) return { text, valid: false, reason: "Too short to describe a use" };
    const lower = text.toLowerCase();
    if (usualUse.some((kw) => lower.includes(kw))) return { text, valid: false, reason: "Too close to the usual use" };
    if (seen.has(lower)) return { text, valid: false, reason: "Duplicate of another answer" };
    seen.add(lower);
    return { text, valid: true, reason: "Counted" };
  });
}

function GuilfordTestExercise() {
  const c = useColors();
  const [phase, setPhase] = useState("intro"); // intro | active | result
  const [object, setObject] = useState(null);
  const [answers, setAnswers] = useState(Array(10).fill(""));
  const [scored, setScored] = useState(null);
  const queueRef = useRef([]);

  const nextObject = () => {
    if (queueRef.current.length === 0) queueRef.current = shuffle(GUILFORD_OBJECTS);
    const next = queueRef.current.shift();
    setObject(next);
    setAnswers(Array(10).fill(""));
    setScored(null);
    setPhase("active");
  };

  const updateAnswer = (i, value) => {
    setAnswers((prev) => { const next = [...prev]; next[i] = value; return next; });
  };

  const handleSubmit = () => {
    const result = scoreGuilfordAnswers(answers, object.usualUse);
    setScored(result);
    setPhase("result");
  };

  if (phase === "intro") {
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Guilford's Test</p>
        <p style={styles(c).rvSubhead}>Creative Fluency</p>
        <p style={styles(c).instruction}>You'll see one everyday object. List 10 uses for it other than the obvious one it's made for. The more distinct, genuine alternative uses you come up with, the higher your fluency score.</p>
        <button style={styles(c).btnPrimary} onClick={nextObject}>Start</button>
      </div>
    );
  }

  if (phase === "result" && scored) {
    const score = scored.filter((s) => s.valid).length;
    return (
      <div style={styles(c).nbackWrap} className="fade-in">
        <p style={styles(c).rvHeading}>Guilford's Test</p>
        <p style={styles(c).verdict}>Fluency Score: {score}/10</p>
        <ul style={styles(c).recapList}>
          {scored.map((s, i) => (
            <li key={i} style={{ ...styles(c).recapItem, color: s.valid ? c.good : c.faint }}>
              {i + 1}. {s.text || "(blank)"}: {s.reason}
            </li>
          ))}
        </ul>
        <button style={styles(c).btnPrimary} onClick={nextObject}>Try Another Object</button>
      </div>
    );
  }

  return (
    <div style={styles(c).nbackWrap} className="fade-in">
      <p style={styles(c).rvHeading}>Guilford's Test</p>
      <div style={styles(c).guilfordObjectBox}>
        <span style={styles(c).guilfordObjectEmoji}>{object.emoji}</span>
        <span style={styles(c).guilfordObjectName}>{object.name}</span>
      </div>
      <p style={styles(c).instruction}>List 10 uses for this object other than its usual one.</p>
      <div style={styles(c).guilfordInputList}>
        {answers.map((val, i) => (
          <input
            key={i}
            type="text"
            style={styles(c).guilfordInput}
            placeholder={`Use ${i + 1}`}
            value={val}
            onChange={(e) => updateAnswer(i, e.target.value)}
          />
        ))}
      </div>
      <button style={styles(c).btnPrimary} onClick={handleSubmit}>Submit</button>
    </div>
  );
}

// =================================================================
// Journals — reserved, empty for now
// =================================================================
function PlaceholderScreen({ title, note, points, sections, onNavigate }) {
  const c = useColors();
  return (
    <div style={styles(c).gameBox}>
      <p style={styles(c).levelLabel}>{title}</p>
      <p style={styles(c).instruction}>{note}</p>

      {points && (
        <ul style={styles(c).placeholderList}>
          {points.map((p, i) => (<li key={i} style={styles(c).placeholderListItem}>{p}</li>))}
        </ul>
      )}

      {sections && sections.map((section) => (
        <div key={section.heading} style={styles(c).placeholderSection}>
          <h2 style={styles(c).placeholderSubhead}>{section.heading}</h2>
          <ul style={styles(c).placeholderList}>
            {section.points.map((p, i) => (<li key={i} style={styles(c).placeholderListItem}>{p}</li>))}
          </ul>
        </div>
      ))}

      {onNavigate && (
        <p style={styles(c).homeFooterLine}>
          <span>© {new Date().getFullYear()} Benjamin Mithra</span>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.articles} className="home-footer-link" style={styles(c).homeFooterLink}>Articles</Link>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.privacy} className="home-footer-link" style={styles(c).homeFooterLink}>Privacy</Link>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.terms} className="home-footer-link" style={styles(c).homeFooterLink}>Terms</Link>{" "}
          <span style={styles(c).homeFooterDot}>·</span>{" "}
          <Link to={VIEW_PATH.disclaimer} className="home-footer-link" style={styles(c).homeFooterLink}>Disclaimer</Link>
        </p>
      )}
    </div>
  );
}

// =================================================================
// RV Lab — a Remote Viewing target generator. Every session draws a
// fresh 8-digit target reference number and pairs it with a real
// photograph — streets, places, nature, people, everyday scenes —
// served by Lorem Picsum from real Unsplash photographers under a
// free-to-use license (no copyright risk, no adult content by
// Picsum's own curation). Seeds are drawn one at a time from a
// shuffled pool and marked used, so neither the number nor the image
// repeats within a session; a pool only reshuffles once fully spent,
// never reusing the one just drawn.
//
// Note: Claude's own artifact preview blocks requests to outside
// image hosts, so this photo will not load inside that preview
// window — the onError fallback below explains that rather than
// showing a broken-image icon. Once this code runs on a real site
// (or any normal, unsandboxed browser), the actual photos load fine.
// =================================================================
const RV_IMAGE_POOL = Array.from({ length: 400 }, (_, i) => i + 1);

function RVTargetImage({ imageId }) {
  const [failed, setFailed] = useState(false);
  const c = useColors();
  if (failed) {
    return (
      <div style={styles(c).rvImageFallback}>
        This preview sandbox blocks outside images. This real photo will display once the site is live outside Claude's preview.
      </div>
    );
  }
  return (
    <img
      key={imageId}
      src={`https://picsum.photos/id/${imageId}/640/440`}
      alt="Remote viewing target"
      style={styles(c).rvImage}
      onError={() => setFailed(true)}
    />
  );
}

// =================================================================
// Freehand drawing canvas — used for every ideogram, sketch, and
// composite drawing area in the RV session form. Strokes are stored
// as normalized (0–1) point arrays in the parent's session state, so
// the drawing survives navigation, resizing, and re-renders without
// ever being cleared behind the user's back. Pointer Events cover
// mouse, trackpad, touchscreen, and stylus input through one code
// path. Nothing is smoothed, corrected, or interpreted — nothing but
// what the user actually drew is stored.
// =================================================================
function DrawingCanvas({ strokes, onChange, height = 200 }) {
  const c = useColors();
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef(null);
  const redoStackRef = useRef([]);
  const [tool, setTool] = useState("pen");

  const drawAll = (strokeList, liveStroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const paint = (stroke) => {
      if (!stroke || stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.tool === "eraser" ? "#08131B" : "#EDEAE0";
      ctx.lineWidth = stroke.tool === "eraser" ? 20 : 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height);
      ctx.stroke();
    };
    strokeList.forEach(paint);
    paint(liveStroke);
  };

  const resize = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    drawAll(strokes, null);
  };

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { drawAll(strokes, null); }, [strokes]);

  const getPos = (e) => {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  };

  const start = (e) => {
    e.preventDefault();
    e.target.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    currentStrokeRef.current = { tool, points: [getPos(e)] };
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    currentStrokeRef.current.points.push(getPos(e));
    drawAll(strokes, currentStrokeRef.current);
  };
  const end = (e) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (currentStrokeRef.current && currentStrokeRef.current.points.length > 1) {
      onChange([...strokes, currentStrokeRef.current]);
      redoStackRef.current = [];
    }
    currentStrokeRef.current = null;
  };

  const undo = () => {
    if (strokes.length === 0) return;
    redoStackRef.current.push(strokes[strokes.length - 1]);
    onChange(strokes.slice(0, -1));
  };
  const redo = () => {
    if (redoStackRef.current.length === 0) return;
    const restored = redoStackRef.current.pop();
    onChange([...strokes, restored]);
  };
  const clearAll = () => { redoStackRef.current = []; onChange([]); };

  return (
    <div style={styles(c).canvasBlock}>
      <div style={styles(c).canvasToolbar}>
        <button type="button" style={{ ...styles(c).canvasToolBtn, ...(tool === "pen" ? styles(c).canvasToolBtnActive : {}) }} onClick={() => setTool("pen")}>Pen</button>
        <button type="button" style={{ ...styles(c).canvasToolBtn, ...(tool === "eraser" ? styles(c).canvasToolBtnActive : {}) }} onClick={() => setTool("eraser")}>Eraser</button>
        <button type="button" style={styles(c).canvasToolBtn} onClick={undo}>Undo</button>
        <button type="button" style={styles(c).canvasToolBtn} onClick={redo}>Redo</button>
        <button type="button" style={styles(c).canvasToolBtn} onClick={clearAll}>Clear</button>
      </div>
      <div ref={containerRef} style={{ ...styles(c).canvasSurfaceWrap, height }}>
        <canvas
          ref={canvasRef}
          style={styles(c).canvasSurface}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onPointerLeave={end}
        />
      </div>
    </div>
  );
}

// =================================================================
// Small helpers, styled to match the rest of the RV Lab.
// =================================================================
function RVTextArea({ label, value, onChange, rows = 3 }) {
  const c = useColors();
  return (
    <label style={styles(c).rvFieldLabelWrap}>
      {label && <span style={styles(c).rvFieldLabel}>{label}</span>}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} style={styles(c).rvTextarea} />
    </label>
  );
}

// A frozen, non-interactive read-out of a finished stroke drawing —
// used to display the sketch exactly as submitted, once the session
// is locked in. No pointer handlers, so it can never be edited again
// and nothing about it is re-interpreted.
function StaticSketch({ strokes, height = 220 }) {
  const c = useColors();
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const draw = () => {
    const canvas = canvasRef.current, container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokes.forEach((stroke) => {
      if (!stroke || stroke.points.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.tool === "eraser" ? "#08131B" : "#EDEAE0";
      ctx.lineWidth = stroke.tool === "eraser" ? 20 : 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);
      for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i].x * canvas.width, stroke.points[i].y * canvas.height);
      ctx.stroke();
    });
  };
  useEffect(() => {
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);
  return (
    <div ref={containerRef} style={{ ...styles(c).canvasSurfaceWrap, height }}>
      <canvas ref={canvasRef} style={styles(c).canvasSurface} />
    </div>
  );
}

// =================================================================
// The Remote Viewing session panel. Deliberately minimal: the actual
// CRV process happens offline, on paper. This just captures the
// three things that matter afterward — the freehand sketch, the
// session notes, and the moment of submission — and keeps the target
// completely hidden until Submit Session is pressed.
// =================================================================
function RVSessionForm({ target, onNextTarget }) {
  const c = useColors();
  const [sketch, setSketch] = useState([]);
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = () => {
    if (sketch.length === 0 && !notes.trim()) { setError("Add your freehand sketch or your notes before submitting."); return; }
    setError("");
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div style={styles(c).rvSessionWrap}>
        <div style={styles(c).rvSection}>
          <p style={styles(c).rvSectionTitle}>Actual Target</p>
          <RVTargetImage imageId={target.imageId} />
        </div>

        <div style={styles(c).rvSection}>
          <p style={styles(c).rvSectionTitle}>Your Remote View</p>
          <div style={styles(c).rvCompareGrid}>
            <div style={styles(c).rvCompareCol}>
              <p style={styles(c).rvSectionSubtitle}>Your Freehand Sketch</p>
              <StaticSketch strokes={sketch} height={260} />
            </div>
            <div style={styles(c).rvCompareCol}>
              <p style={styles(c).rvSectionSubtitle}>Your Remote Viewing Notes</p>
              <p style={styles(c).rvNotesReadout}>{notes.trim() ? notes : "(no notes entered)"}</p>
            </div>
          </div>
        </div>

        <button type="button" style={styles(c).btnGhost} onClick={onNextTarget}>Start a new session with a new target</button>
      </div>
    );
  }

  return (
    <div style={styles(c).rvSessionWrap}>
      <div style={styles(c).rvSection}>
        <p style={styles(c).rvSectionTitle}>Freehand Sketch</p>
        <p style={styles(c).rvSectionSubtitle}>Recreate the freehand sketch you already made on paper during your offline session. Nothing here is straightened, corrected, or interpreted. It's preserved exactly as you draw it.</p>
        <DrawingCanvas strokes={sketch} onChange={setSketch} height={280} />
      </div>

      <div style={styles(c).rvSection}>
        <p style={styles(c).rvSectionTitle}>Remote Viewing Notes</p>
        <RVTextArea value={notes} onChange={setNotes} rows={8} />
      </div>

      {error && <p style={styles(c).rvErrorNote}>{error}</p>}
      <button type="button" style={styles(c).btnPrimary} onClick={handleSubmit}>Submit Session</button>
    </div>
  );
}

function RVLabScreen() {
  const c = useColors();
  const imagePoolRef = useRef(shuffle(RV_IMAGE_POOL));
  const imageIndexRef = useRef(0);
  const usedNumbersRef = useRef(new Set());

  const makeTargetNumber = () => {
    let num;
    do { num = `${randInt(1000, 9999)}-${randInt(1000, 9999)}`; } while (usedNumbersRef.current.has(num));
    usedNumbersRef.current.add(num);
    return num;
  };

  const makeTarget = () => {
    if (imageIndexRef.current >= imagePoolRef.current.length) {
      imagePoolRef.current = shuffle(RV_IMAGE_POOL);
      imageIndexRef.current = 0;
    }
    const imageId = imagePoolRef.current[imageIndexRef.current];
    imageIndexRef.current += 1;
    return { number: makeTargetNumber(), imageId };
  };

  const [target, setTarget] = useState(() => makeTarget());
  const nextTarget = () => setTarget(makeTarget());

  return (
    <div style={styles(c).rvOuter} className="fade-in">
      <div style={styles(c).rvCard}>
        <p style={styles(c).rvHeading}>Remote Viewing Lab</p>
        <p style={styles(c).rvInstruction}>Complete your Remote Viewing session offline with pen and paper first. Once you're finished, come back here, recreate your freehand sketch and enter your notes below. The target stays hidden until you submit.</p>

        <div style={styles(c).contactDivider} />

        <p style={styles(c).rvSubhead}>Target Reference Number</p>
        <p style={styles(c).rvTargetNumber}>{target.number}</p>
        <p style={styles(c).rvHiddenNote}>Hidden until your completed session below is submitted.</p>
      </div>

      <RVSessionForm key={target.number} target={target} onNextTarget={nextTarget} />
    </div>
  );
}

// =================================================================
// Contact
// =================================================================
const WHATSAPP_NUMBER = "447440573315";
const EMAIL_ADDRESS = "benjaminmithra@gmail.com";
const FORMSPREE_ENDPOINT = "https://formspree.io/f/xjyvqwrd";
const CONTACT_INTRO_BUBBLES = ["Hi, I'm Benjamin Mithra.", "I'm a Mind Interpreter.", "You talk. I listen. We explore."];
const CONTACT_STEPS = [
  { title: "Reach out.", text: "Send me a message on WhatsApp, by email, or through the Write to Me form. You don't need to explain everything; a few words are enough." },
  { title: "Choose a time.", text: "We'll find a time that suits you. I'm based in India, so just tell me your time zone and I'll work around it." },
  { title: "We talk.", text: "Sessions are 60 minutes, by video or voice call. You can keep your camera off if you prefer. There's no agenda, and nothing you need to prepare." },
];
const CONTACT_NOT_PARAGRAPHS = [
  "These conversations are a space to talk, reflect and understand. They aren't therapy, counselling, or medical or psychological treatment, and I don't diagnose or treat any condition. If you're working with a doctor or therapist, this can sit alongside that, but it isn't a replacement for it.",
  "If you're in crisis or thinking about harming yourself, please don't wait for a session. Contact your local emergency services or a crisis line right away (for example, 988 in the US).",
];
const CONTACT_INTRO_PARAGRAPHS = [
  "Sometimes you simply need someone who will listen without rushing to judge, advise, or tell you what to do.",
  "You can bring whatever is on your mind. Something you're going through, a difficult decision, a recurring thought or pattern, an experience you don't understand, or simply something you've never had the space to talk about.",
  "You don't need to prepare anything or know exactly where the conversation should go.",
];

function WhatsAppIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="currentColor"><path d="M16.02 3C9.4 3 4.02 8.38 4.02 15c0 2.24.62 4.34 1.7 6.14L4 29l8.06-1.66A11.9 11.9 0 0 0 16.02 27C22.64 27 28 21.62 28 15S22.64 3 16.02 3Zm0 21.6c-1.9 0-3.66-.52-5.18-1.44l-.37-.22-4.78.98.98-4.66-.24-.38A9.5 9.5 0 0 1 5.42 15c0-5.83 4.77-10.6 10.6-10.6S26.6 9.17 26.6 15 21.85 24.6 16.02 24.6Zm5.8-7.94c-.32-.16-1.9-.94-2.2-1.05-.3-.1-.5-.16-.72.16-.2.32-.83 1.05-1.02 1.26-.18.2-.37.24-.68.08-.32-.16-1.34-.5-2.55-1.58-.94-.84-1.58-1.87-1.76-2.2-.18-.32-.02-.5.14-.66.14-.14.32-.37.48-.55.16-.18.2-.32.32-.53.1-.2.05-.4-.02-.56-.08-.16-.72-1.74-.98-2.38-.26-.63-.53-.54-.72-.55h-.62c-.2 0-.53.08-.8.4-.28.32-1.06 1.03-1.06 2.52s1.08 2.93 1.24 3.13c.16.2 2.13 3.25 5.16 4.56.72.3 1.28.49 1.72.63.72.23 1.38.2 1.9.12.58-.09 1.9-.78 2.17-1.53.26-.75.26-1.4.18-1.53-.08-.13-.28-.2-.6-.36Z"/></svg>
  );
}
function EmailIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="4" y="7" width="24" height="18" rx="2.5" /><path d="M5 8.5 16 18l11-9.5" /></svg>
  );
}

// The portrait, framed as a little house: the photo fills the square
// body, and an SVG drawn over it adds the roof and gold outline. The
// roof's base is the body's top edge, so they share one clean line.
function HousePortrait() {
  const c = useColors();
  return (
    <div style={styles(c).housePortrait}>
      <img src="/benjamin-mithra.jpg" alt="Benjamin Mithra" width="360" height="360" style={styles(c).housePortraitPhoto} />
      <svg viewBox="0 0 100 128" aria-hidden="true" focusable="false" style={styles(c).housePortraitFrame}>
        <g stroke={c.gold} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M2 42 L50 5 L98 42 Z" fill={c.surface} />
          <rect x="8" y="42" width="84" height="84" fill="none" />
        </g>
      </svg>
    </div>
  );
}

// Two chairs facing each other across a small round table, with a
// steaming coffee on each side. The steam drifts up and fades on a
// loop (held still with reduced motion).
function CoffeeTableIllustration() {
  const c = useColors();
  return (
    <svg
      viewBox="0 0 280 150"
      role="img"
      aria-label="A table with two chairs and two cups of coffee, ready for a conversation"
      style={styles(c).coffeeTable}
    >
      <style>{`
        @keyframes coffeeSteam { 0% { opacity: 0; transform: translateY(4px); } 30% { opacity: 0.9; } 100% { opacity: 0; transform: translateY(-10px); } }
        .coffee-steam { animation: coffeeSteam 3.4s ease-in-out infinite; }
        .coffee-steam-2 { animation-delay: -1.1s; }
        .coffee-steam-3 { animation-delay: -2.2s; }
        @media (prefers-reduced-motion: reduce) { .coffee-steam { animation: none; opacity: 0.8; } }
      `}</style>
      <g fill="none" stroke={c.gold} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 141 H262" stroke={c.goldDark} strokeOpacity="0.55" strokeWidth="1.6" />
        {/* Left chair, facing right */}
        <path d="M45 100 L39 54 Q38.5 50 42.5 50 H45.5 Q49 50 49.5 54 L54 100" fill={c.surface} />
        <path d="M44 100 H92 Q95 100 95 103 V105 Q95 108 92 108 H47 Q44 108 44 105 Z" fill={c.surface} />
        <path d="M50 108 L46 140 M88 108 L92 140" />
        {/* Right chair, facing left */}
        <path d="M235 100 L241 54 Q241.5 50 237.5 50 H234.5 Q231 50 230.5 54 L226 100" fill={c.surface} />
        <path d="M236 100 H188 Q185 100 185 103 V105 Q185 108 188 108 H233 Q236 108 236 105 Z" fill={c.surface} />
        <path d="M230 108 L234 140 M192 108 L188 140" />
        {/* Round table, from the side */}
        <path d="M140 96 V136" />
        <path d="M120 140 Q140 132 160 140" />
        <ellipse cx="140" cy="91" rx="46" ry="6" fill={c.surface} />
        {/* Two coffees */}
        <path d="M106 71 H122 V81 Q122 85 118 85 H110 Q106 85 106 81 Z" fill={c.gold} />
        <path d="M106 74 Q100 74 100 78 Q100 82 106 82" />
        <path d="M101 86 H127" />
        <path d="M158 71 H174 V81 Q174 85 170 85 H162 Q158 85 158 81 Z" fill={c.gold} />
        <path d="M174 74 Q180 74 180 78 Q180 82 174 82" />
        <path d="M153 86 H179" />
        {/* Steam */}
        <g strokeWidth="1.8">
          <path className="coffee-steam" d="M111 64 C107 58 115 54 111 48 C107 42 115 38 111 32" />
          <path className="coffee-steam coffee-steam-2" d="M117 64 C113 58 121 54 117 48 C113 42 121 38 117 34" />
          <path className="coffee-steam coffee-steam-3" d="M163 64 C159 58 167 54 163 48 C159 42 167 38 163 32" />
          <path className="coffee-steam coffee-steam-2" d="M169 64 C165 58 173 54 169 48 C165 42 173 38 169 34" />
        </g>
      </g>
    </svg>
  );
}

function ContactScreen({ onNavigate }) {
  const c = useColors();
  return (
    <div style={styles(c).contactOuter} className="fade-in">
      <div style={styles(c).contactCard}>
        <p style={styles(c).contactBigHeading}>Private Consultation</p>

        <div style={styles(c).contactIntroRow}>
          <HousePortrait />
          <div style={styles(c).contactBubbleStack}>
            {CONTACT_INTRO_BUBBLES.map((b, i) => (
              <Fragment key={i}>
                {i > 0 && " "}
                <span style={{ ...styles(c).contactBubble, animationDelay: `${(i * 0.4).toFixed(2)}s` }}>{b}</span>
              </Fragment>
            ))}
          </div>
        </div>

        <div style={styles(c).contactDivider} />

        {CONTACT_INTRO_PARAGRAPHS.map((t, i) => (
          <p key={i} style={styles(c).contactBody}>{t}</p>
        ))}
        <p style={styles(c).contactClosing}>This is a private space for conversation, reflection and understanding.</p>

        <div style={styles(c).contactFirstHourWrap}>
          <p style={styles(c).contactFirstHour}>Your first hour is on me.</p>
          <CoffeeTableIllustration />
        </div>

        <div style={styles(c).contactDivider} />

        <p style={styles(c).contactSubhead}>How it works</p>
        <ol style={styles(c).contactSteps}>
          {CONTACT_STEPS.map((step, i) => (
            <li key={i} style={styles(c).contactBody}>
              <strong style={styles(c).contactStepTitle}>{step.title}</strong> {step.text}
            </li>
          ))}
        </ol>
        <p style={styles(c).contactBody}>What you share stays private and is never shared with anyone, except where the law requires it or where someone's immediate safety is at serious risk.</p>

        <div style={styles(c).contactDivider} />

        <p style={styles(c).contactSubhead}>What this isn't</p>
        {CONTACT_NOT_PARAGRAPHS.map((t, i) => (
          <p key={i} style={styles(c).contactBody}>{t}</p>
        ))}

        <div style={styles(c).contactDivider} />

        <p style={styles(c).contactSubhead}>Get in touch</p>
        <div style={styles(c).contactIconsRow}>
          <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" style={styles(c).contactIconLink} aria-label="Message on WhatsApp">
            <WhatsAppIcon /><span>WhatsApp</span>
          </a>{" "}
          <a href={`mailto:${EMAIL_ADDRESS}`} style={styles(c).contactIconLink} aria-label="Send an email">
            <EmailIcon /><span>Email</span>
          </a>
        </div>

        <WriteToMeForm style={styles(c).writeToMeInCard} />
      </div>

      <p style={styles(c).homeFooterLine}>
        <span>© {new Date().getFullYear()} Benjamin Mithra</span>{" "}
        <span style={styles(c).homeFooterDot}>·</span>{" "}
        <Link to={VIEW_PATH.articles} className="home-footer-link" style={styles(c).homeFooterLink}>Articles</Link>{" "}
        <span style={styles(c).homeFooterDot}>·</span>{" "}
        <Link to={VIEW_PATH.privacy} className="home-footer-link" style={styles(c).homeFooterLink}>Privacy</Link>{" "}
        <span style={styles(c).homeFooterDot}>·</span>{" "}
        <Link to={VIEW_PATH.terms} className="home-footer-link" style={styles(c).homeFooterLink}>Terms</Link>{" "}
        <span style={styles(c).homeFooterDot}>·</span>{" "}
        <Link to={VIEW_PATH.disclaimer} className="home-footer-link" style={styles(c).homeFooterLink}>Disclaimer</Link>
      </p>
    </div>
  );
}

// =================================================================
// Guide dog: a calm Great Dane lying in the doorway of its house,
// fixed to the bottom-left corner of the screen. It stays at home;
// every so often it does something small from the doorway (watches a
// butterfly, yawns, tilts its head, sniffs the air, or naps). Tapping
// the house shows a tip for the current page. Mounted only in a real
// browser after load, so it never ends up in the prerendered HTML.
// Hiding it is kept in memory only (the site stores nothing), so it
// lasts until reload.
//
// Everything is one SVG scene: a front-facing house on the ground at
// y=100, and the dog, facing out, clipped to the doorway so it's
// always behind the front wall.
// =================================================================
const GUIDE_DOG_TIPS = {
  home: { text: "New here? You can just write to me, no need to prepare anything.", link: { href: "#write-to-me", label: "Go to the form" } },
  contact: { text: "Take your time. Reach out whenever you're ready." },
  exercises: { text: "Try the breathing exercise if you need a calm minute.", link: { to: "/exercises/breathing", label: "Open the breathing exercise" } },
  games: { text: "Sniffing out a challenge? Chess is my favourite.", link: { to: "/games/chess", label: "Play chess" } },
  rvlab: { text: "Do your session on paper first, then come back here." },
  journals: { text: "New writing is on its way." },
  faq: { text: "Hi, I'm Diego! Can't find your answer? Write to me.", link: { to: "/consultation", label: "Go to Consultation" } },
  other: { text: "Want to talk? I'll show you the way.", link: { to: "/consultation", label: "Go to Consultation" } },
};

const GD_DOOR = "M22 100 V50 A28 28 0 0 1 78 50 V100 Z";
const GD_VIEW = { x: -8, y: -90, w: 290, h: 196 }; // room above and right for the butterfly
const GD_HOME_BOX = { x: -6, y: -2, w: 112, h: 110 }; // the house, for taps and the tip bubble
const GD_CANCEL = { cancelled: true };
const gdEase = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const gdClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Drives the dog: eased tweens, breathing, blinking, ear twitches and
// ears that settle a moment after the head moves. All drawing is done
// by setting attributes on the SVG nodes in `n`, once per frame.
function createGuideDogEngine(n) {
  const s = {
    headRot: 0, headY: 0, look: 0, perk: 0, paw: 0, yawn: 0, sleep: 0, zzz: 0,
    noseUp: 0, sniff: 0, earL: 0, earR: 0, follow: 0, bx: 260, by: -60, bOp: 0,
  };
  const tweens = [];
  const pending = new Set();
  let raf = 0;
  let last = 0;
  let time = 0;
  let blinkIn = 3;
  let blinkT = -1;
  let twitchIn = 6;
  let lagRot = 0;
  let lagVel = 0;
  const trail = { look: 0, rot: 0, y: 0 }; // where the head is, while following the butterfly
  let dead = false;

  // Every wait resolves early when the engine is destroyed, and then
  // throws GD_CANCEL so a running action stops where it is.
  const promise = (start) =>
    new Promise((resolve) => {
      const done = () => { pending.delete(done); resolve(); };
      pending.add(done);
      start(done);
    }).then(() => { if (dead) throw GD_CANCEL; });
  const tween = (key, to, ms) =>
    promise((done) => {
      for (let i = tweens.length - 1; i >= 0; i--) {
        if (tweens[i].key === key) { tweens[i].done(); tweens.splice(i, 1); }
      }
      tweens.push({ key, from: s[key], to, ms: Math.max(1, ms), t: 0, done });
    });
  const tweenAll = (values, ms) => Promise.all(Object.entries(values).map(([k, v]) => tween(k, v, ms)));
  const wait = (ms) => promise((done) => setTimeout(done, ms));

  function apply() {
    const T = (el, v) => el && el.setAttribute("transform", v);
    const O = (el, v) => el && el.setAttribute("opacity", gdClamp(v, 0, 1).toFixed(3));
    const f = s.follow;
    const look = s.look * (1 - f) + trail.look * f;
    const rot = s.headRot * (1 - f) + trail.rot * f;
    const lift = s.headY * (1 - f) + trail.y * f;
    const breath = Math.sin((time * 2 * Math.PI) / 4.6);
    const earLag = (lagRot - rot) * 0.9;

    T(n.chest, `translate(50 100) scale(1 ${1 + 0.018 * breath}) translate(-50 -100)`);
    T(n.head, `translate(0 ${lift + 0.35 * breath}) rotate(${rot} 50 66) translate(50 66) scale(1 ${1 - 0.05 * s.noseUp}) translate(-50 -66)`);
    T(n.face, `translate(${look * 2.6} ${-2.2 * s.noseUp - 0.8 * s.sniff})`);
    T(n.nose, `translate(50 53.5) scale(${1 + 0.08 * s.sniff}) translate(-50 -53.5)`);
    T(n.earL, `rotate(${14 * s.perk + earLag + s.earL} 39.6 31.5)`);
    T(n.earR, `rotate(${-14 * s.perk + earLag - s.earR} 60.4 31.5)`);
    const blink = blinkT >= 0 ? Math.sin((Math.PI * blinkT) / 0.2) : 0;
    const open = Math.max(0.06, (1 - blink) * (1 - s.sleep));
    T(n.eyes, `translate(0 42) scale(1 ${open}) translate(0 -42)`);
    O(n.eyesShut, s.sleep);
    O(n.mouth, s.yawn > 0.02 ? 1 : 0);
    T(n.mouth, `translate(50 59) scale(1 ${Math.max(0.01, s.yawn)}) translate(-50 -59)`);
    T(n.paw, `translate(${2 * s.paw} ${-9 * s.paw}) rotate(${-12 * s.paw} 35 81)`);
    O(n.zzz, s.zzz);
    O(n.bfly, s.bOp);
    T(n.bfly, `translate(${s.bx + 5 * Math.sin(time * 1.9)} ${s.by + 7 * Math.sin(time * 2.7)}) rotate(${12 * Math.sin(time * 2.3)})`);
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i];
      tw.t += dt * 1000;
      const p = Math.min(1, tw.t / tw.ms);
      s[tw.key] = tw.from + (tw.to - tw.from) * gdEase(p);
      if (p >= 1) { tweens.splice(i, 1); tw.done(); }
    }
    // The head eases toward the butterfly rather than snapping to it.
    const bx = s.bx + 5 * Math.sin(time * 1.9);
    const by = s.by + 7 * Math.sin(time * 2.7);
    const k = Math.min(1, dt * 2.5);
    trail.look += (gdClamp((bx - 50) / 70, -1, 1) - trail.look) * k;
    trail.rot += (gdClamp((bx - 50) / 12, -7, 7) - trail.rot) * k;
    trail.y += (gdClamp((by - 40) / 16, -2.5, 1) - trail.y) * k;
    // Ears: a soft spring that lags the head, then settles.
    const rot = s.headRot * (1 - s.follow) + trail.rot * s.follow;
    lagVel += (60 * (rot - lagRot) - 9 * lagVel) * dt;
    lagRot += lagVel * dt;
    if (blinkT >= 0) { blinkT += dt; if (blinkT > 0.2) blinkT = -1; }
    else if ((blinkIn -= dt) <= 0) { blinkT = 0; blinkIn = 2.5 + Math.random() * 4.5; }
    if ((twitchIn -= dt) <= 0) {
      twitchIn = 7 + Math.random() * 7;
      const ear = Math.random() < 0.5 ? "earL" : "earR";
      (async () => { await tween(ear, 9, 180); await tween(ear, -2, 220); await tween(ear, 0, 260); })().catch(() => {});
    }
    apply();
    raf = requestAnimationFrame(frame);
  }

  return {
    s, tween, tweenAll, wait, apply,
    start() { raf = requestAnimationFrame(frame); },
    destroy() { dead = true; cancelAnimationFrame(raf); [...pending].forEach((done) => done()); },
  };
}

// ---- Things it does from the doorway ---------------------------------
async function gdButterfly(e) {
  Object.assign(e.s, { bx: GD_VIEW.x + GD_VIEW.w + 10, by: -70 });
  e.tween("bOp", 1, 800);
  e.tween("follow", 1, 1200); // the head starts to follow it
  await e.tweenAll({ bx: 130, by: 8 }, 3600); // flutters in on a wavy path
  e.tween("perk", 1, 600); // ears perk up
  await e.tweenAll({ bx: 86, by: 30 }, 1800);
  await e.tween("paw", 1, 650); // lifts a paw, playfully
  await e.wait(500);
  await e.tween("paw", 0, 700);
  await e.wait(400);
  e.tween("bOp", 0, 3400);
  e.tweenAll({ bx: GD_VIEW.x + GD_VIEW.w + 30, by: GD_VIEW.y - 20 }, 3400); // and off it goes
  await e.wait(1800);
  await e.tweenAll({ follow: 0, perk: 0 }, 1200); // settles back down
}

async function gdYawn(e) {
  await e.tweenAll({ noseUp: 0.6, sleep: 0.9 }, 900);
  await e.tween("yawn", 1, 1100);
  await e.wait(800);
  await e.tween("yawn", 0, 900);
  await e.tweenAll({ noseUp: 0, sleep: 0 }, 800);
}

async function gdHeadTilt(e) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  await e.tweenAll({ headRot: 12 * dir, perk: 0.4 }, 800);
  await e.wait(1600);
  await e.tweenAll({ headRot: 0, perk: 0 }, 850);
}

async function gdSniffAir(e) {
  await e.tween("noseUp", 1, 700);
  for (let i = 0; i < 4; i++) {
    await e.tween("sniff", 1, 170);
    await e.tween("sniff", 0, 230);
    if (i === 1) await e.wait(350);
  }
  await e.wait(300);
  await e.tween("noseUp", 0, 800);
}

async function gdNap(e) {
  await e.tween("sleep", 1, 1200);
  await e.tween("zzz", 1, 800);
  await e.wait(12000 + Math.random() * 8000);
  await e.tween("zzz", 0, 700);
  await e.tween("sleep", 0, 900);
}

const GD_ACTIONS = [
  { name: "butterfly", run: gdButterfly },
  { name: "yawn", run: gdYawn },
  { name: "tilt", run: gdHeadTilt },
  { name: "sniff", run: gdSniffAir },
  { name: "nap", run: gdNap },
];

// Rests for 10 to 25 seconds, then does one thing (never the same one
// twice in a row), then rests again.
async function gdLife(e, canStart, onAction) {
  let lastName = null;
  for (;;) {
    await e.wait(10000 + Math.random() * 15000);
    while (!canStart()) await e.wait(1000);
    const options = GD_ACTIONS.filter((a) => a.name !== lastName);
    const pick = options[Math.floor(Math.random() * options.length)];
    lastName = pick.name;
    onAction(pick.name);
    await pick.run(e);
    onAction("rest");
  }
}

// ---- Drawing ---------------------------------------------------------
function GdLeg({ x }) {
  const dark = COLORS.bg;
  return (
    <g stroke={dark} strokeWidth="1.1" strokeLinejoin="round">
      <path d={`M${x - 6} 98 V86 C${x - 6} 81.5 ${x - 3.2} 79.5 ${x} 79.5 C${x + 3.2} 79.5 ${x + 6} 81.5 ${x + 6} 86 V98 Z`} />
      <path d={`M${x - 8.5} 97 C${x - 8.5} 93 ${x - 4.5} 91.8 ${x} 91.8 C${x + 4.5} 91.8 ${x + 8.5} 93 ${x + 8.5} 97 C${x + 8.5} 99.2 ${x + 6} 100 ${x} 100 C${x - 6} 100 ${x - 8.5} 99.2 ${x - 8.5} 97 Z`} />
      <path fill="none" strokeWidth="0.9" strokeLinecap="round" d={`M${x - 2.8} 95.6 V99 M${x} 95.2 V99.4 M${x + 2.8} 95.6 V99`} />
    </g>
  );
}

function GuideDogScene({ nodes, scale }) {
  const r = (key) => (el) => { nodes[key] = el; };
  const gold = COLORS.gold;
  const dark = COLORS.bg;
  const earFill = COLORS.goldDark;
  return (
    <svg
      ref={r("svg")}
      className="gd-scene"
      viewBox={`${GD_VIEW.x} ${GD_VIEW.y} ${GD_VIEW.w} ${GD_VIEW.h}`}
      style={{ width: GD_VIEW.w * scale, height: GD_VIEW.h * scale }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="gd-door-clip"><path d={GD_DOOR} /></clipPath>
      </defs>
      <path d={GD_DOOR} fill={COLORS.playfield} />
      {/* The dog, clipped to the doorway. */}
      <g clipPath="url(#gd-door-clip)" fill={gold}>
        <path ref={r("chest")} d="M34 100 C34 86 40 77 50 77 C60 77 66 86 66 100 Z" />
        <path d="M41 82 C41 72 42 64 44 58 L56 58 C58 64 59 72 59 82 Z" />
        <path fill="none" stroke={dark} strokeWidth="1.8" strokeLinecap="round" d="M42.5 70 Q50 72.5 57.5 70" />
        <g ref={r("paw")}><GdLeg x={35} /></g>
        <GdLeg x={65} />
        <g ref={r("head")}>
          <path d="M37 37 C37 32 42 30 50 30 C58 30 63 32 63 37 L62.2 51 C62 54 61.6 56 61.4 58 L61 62 C60.6 65 57 66.5 50 66.5 C43 66.5 39.4 65 39 62 L38.6 58 C38.4 56 38 54 37.8 51 Z" />
          <g ref={r("face")}>
            <path fill="none" stroke={dark} strokeWidth="0.9" strokeLinecap="round" d="M50 32.5 V38.5 M42.6 48 C42 52 42 56.5 43.2 61 M57.4 48 C58 52 58 56.5 56.8 61" />
            <path fill="none" stroke={dark} strokeWidth="1.1" strokeLinecap="round" d="M41.8 39.2 Q44.5 38 47 39.4 M53 39.4 Q55.5 38 58.2 39.2" />
            <g ref={r("eyes")} fill={dark}>
              <ellipse cx="44.6" cy="42" rx="1.7" ry="1.5" />
              <ellipse cx="55.4" cy="42" rx="1.7" ry="1.5" />
            </g>
            <path ref={r("eyesShut")} opacity="0" fill="none" stroke={dark} strokeWidth="1.1" strokeLinecap="round" d="M42.8 42 Q44.6 43.6 46.4 42 M53.6 42 Q55.4 43.6 57.2 42" />
            <ellipse ref={r("mouth")} opacity="0" cx="50" cy="62" rx="5.2" ry="4.6" fill={dark} />
            <path fill="none" stroke={dark} strokeWidth="1.1" strokeLinecap="round" d="M50 56.6 V59.6 M44.2 60.4 C46.8 62.2 49 61.8 50 59.6 C51 61.8 53.2 62.2 55.8 60.4" />
            <path ref={r("nose")} fill={dark} d="M45.2 52.2 C45.2 50.3 54.8 50.3 54.8 52.2 C54.8 55 52.3 56.6 50 56.6 C47.7 56.6 45.2 55 45.2 52.2 Z" />
          </g>
          <g ref={r("earL")}>
            <path fill={earFill} stroke={dark} strokeWidth="0.8" strokeLinejoin="round" d="M39.6 31.4 C36 30.6 32 32 30.2 35.2 L35 47.2 C36.8 44.4 38.4 40 39.8 35.6 Z" />
          </g>
          <g ref={r("earR")}>
            <path fill={earFill} stroke={dark} strokeWidth="0.8" strokeLinejoin="round" d="M60.4 31.4 C64 30.6 68 32 69.8 35.2 L65 47.2 C63.2 44.4 61.6 40 60.2 35.6 Z" />
          </g>
        </g>
      </g>
      {/* The house's front wall, with the doorway cut out, over the dog. */}
      <g stroke={gold} strokeWidth="1.6" strokeLinejoin="round">
        <path d={`M6 44 L50 6 L94 44 V100 H6 Z ${GD_DOOR}`} fillRule="evenodd" fill={COLORS.surface} />
        <path fill="none" stroke={earFill} strokeWidth="0.9" strokeOpacity="0.7" d="M8 58 H22 M78 58 H92 M8 72 H22 M78 72 H92 M8 86 H22 M78 86 H92" />
        <path d="M50 0 L104 46 L98 51 L50 9 L2 51 L-4 46 Z" fill={COLORS.surface} />
        <path fill="none" strokeLinecap="round" d="M2 100 H98" />
      </g>
      <g ref={r("zzz")} opacity="0" fill={gold} fontFamily="'Space Mono', monospace" fontWeight="700">
        <text className="gd-z" x="66" y="24" fontSize="8">z</text>
        <text className="gd-z gd-z2" x="73" y="14" fontSize="10">z</text>
        <text className="gd-z gd-z3" x="81" y="3" fontSize="12">z</text>
      </g>
      <g ref={r("bfly")} opacity="0">
        <g className="gd-part gd-wings">
          <path fill={gold} d="M0 0 C-3 -8 -11 -10 -11 -4 C-11 0 -5 1 0 0 Z M0 0 C3 -8 11 -10 11 -4 C11 0 5 1 0 0 Z" />
          <path fill={earFill} d="M0 0 C-2 3 -7 8 -8 4 C-8 2 -4 0.5 0 0 Z M0 0 C2 3 7 8 8 4 C8 2 4 0.5 0 0 Z" />
        </g>
        <ellipse cx="0" cy="0" rx="0.9" ry="3.4" fill={earFill} />
      </g>
    </svg>
  );
}

const GUIDE_DOG_CSS = `
  .gd-scene { position: fixed; left: 4px; bottom: calc(4px + env(safe-area-inset-bottom, 0px)); z-index: 30; pointer-events: none; overflow: visible; display: block; }
  .gd-home {
    position: fixed; z-index: 31; bottom: calc(4px + env(safe-area-inset-bottom, 0px));
    background: transparent; border: 0; padding: 0; margin: 0; cursor: pointer; border-radius: 10px; -webkit-tap-highlight-color: transparent;
  }
  .gd-home:focus { outline: none; }
  .gd-home:focus-visible, .gd-paw:focus-visible, .gd-hide:focus-visible, .gd-link:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 2px; }
  .gd-bubble {
    position: fixed; left: 10px; z-index: 32;
    width: max-content; max-width: min(250px, calc(100vw - 40px)); box-sizing: border-box;
    background: ${COLORS.secondary}; border: 1px solid ${COLORS.strongLine}; border-radius: 12px;
    padding: 12px 14px 10px; box-shadow: 0 12px 30px rgba(0,0,0,0.5); text-align: left;
    display: flex; flex-direction: column; gap: 8px; animation: fadeIn 0.25s ease both;
  }
  .gd-bubble::after {
    content: ""; position: absolute; left: var(--gd-tail-x, 48px); bottom: -7px; width: 12px; height: 12px;
    background: ${COLORS.secondary}; border-right: 1px solid ${COLORS.strongLine}; border-bottom: 1px solid ${COLORS.strongLine};
    transform: rotate(45deg);
  }
  .gd-tip { font-family: 'Source Serif 4', Georgia, serif; font-size: 14.5px; line-height: 1.5; color: ${COLORS.ink}; margin: 0; }
  .gd-link { font-family: 'Source Serif 4', Georgia, serif; font-size: 14px; color: ${COLORS.gold}; text-decoration: underline; text-underline-offset: 3px; }
  .gd-hide { align-self: flex-start; font-family: 'Space Mono', monospace; font-size: 11px; color: ${COLORS.muted}; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .gd-paw {
    position: fixed; left: 12px; bottom: calc(10px + env(safe-area-inset-bottom, 0px)); z-index: 30; width: 34px; height: 34px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; padding: 0; cursor: pointer;
    background: ${COLORS.secondary}; border: 1px solid ${COLORS.strongLine}; opacity: 0.8;
  }
  .gd-paw:hover { opacity: 1; }
  .gd-part { transform-box: fill-box; }
  .gd-wings { transform-origin: 50% 50%; animation: gdFlap 0.28s ease-in-out infinite alternate; }
  .gd-z { animation: gdZ 3s ease-in-out infinite; opacity: 0; }
  .gd-z2 { animation-delay: 1s; }
  .gd-z3 { animation-delay: 2s; }
  @keyframes gdFlap { from { transform: scaleX(1); } to { transform: scaleX(0.25); } }
  @keyframes gdZ { 0% { opacity: 0; transform: translate(0, 4px); } 30% { opacity: 1; } 100% { opacity: 0; transform: translate(4px, -8px); } }
  @media (prefers-reduced-motion: reduce) {
    .gd-scene, .gd-scene * { animation: none !important; }
  }
`;

function PawIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill={COLORS.gold}>
      <ellipse cx="12" cy="16" rx="5" ry="4.2" />
      <ellipse cx="5.2" cy="10.5" rx="2.1" ry="2.7" />
      <ellipse cx="9.4" cy="6.2" rx="2.1" ry="2.8" />
      <ellipse cx="14.6" cy="6.2" rx="2.1" ry="2.8" />
      <ellipse cx="18.8" cy="10.5" rx="2.1" ry="2.7" />
    </svg>
  );
}

const gdScale = () => (window.innerWidth <= 600 ? 0.8 : 1);

// =================================================================
// Floating WhatsApp button (bottom right). Like Diego, it only appears
// in a real browser after load, so it stays out of the prerendered HTML.
// Diego's spacer at the end of every page keeps the last content clear.
// =================================================================
const WHATSAPP_FLOAT_MESSAGE = "Hi Benjamin, I found your website and I'd like to talk.";

const WHATSAPP_FLOAT_CSS = `
  .wa-float {
    position: fixed; right: 20px; bottom: calc(20px + env(safe-area-inset-bottom, 0px)); z-index: 30;
    width: 56px; height: 56px; border-radius: 50%; background: #25D366; color: #FFFFFF;
    display: flex; align-items: center; justify-content: center; text-decoration: none;
    box-shadow: 0 6px 18px rgba(0,0,0,0.35); transition: transform 0.2s ease, box-shadow 0.2s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .wa-float svg { width: 30px; height: 30px; }
  .wa-float:hover, .wa-float:active { transform: translateY(-3px); box-shadow: 0 10px 24px rgba(0,0,0,0.4); }
  .wa-float:focus { outline: none; }
  .wa-float:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 3px; }
  @media (max-width: 600px) {
    .wa-float { width: 52px; height: 52px; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
    .wa-float svg { width: 28px; height: 28px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .wa-float { transition: none; }
    .wa-float:hover, .wa-float:active { transform: none; }
  }
`;

function WhatsAppFloat() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (navigator.webdriver) return;
    const show = () => setReady(true);
    if (document.readyState === "complete") { show(); return; }
    window.addEventListener("load", show);
    return () => window.removeEventListener("load", show);
  }, []);
  if (!ready) return null;
  return (
    <>
      <style>{WHATSAPP_FLOAT_CSS}</style>
      <a
        className="wa-float"
        href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_FLOAT_MESSAGE)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with Benjamin on WhatsApp"
      >
        <WhatsAppIcon />
      </a>
    </>
  );
}

function GuideDog({ view }) {
  const location = useLocation();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [scale, setScale] = useState(1);
  const nodes = useRef({}).current;
  const engineRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;

  // Only in a real browser, after load. Headless Chromium (the prerender
  // step) reports navigator.webdriver, so the dog stays out of the HTML.
  useEffect(() => {
    if (navigator.webdriver) return;
    const show = () => setReady(true);
    if (document.readyState === "complete") { show(); return; }
    window.addEventListener("load", show);
    return () => window.removeEventListener("load", show);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!mq) return;
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const update = () => setScale(gdScale());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [ready]);

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (e.target.closest && e.target.closest(".gd-bubble, .gd-home")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Starts the dog's life once the scene is on screen; with reduced
  // motion it just rests in the doorway, perfectly still.
  useEffect(() => {
    if (!ready || hidden) return;
    const e = createGuideDogEngine(nodes);
    engineRef.current = e;
    e.apply();
    if (!reducedMotion) {
      e.start();
      const mark = (name) => { if (nodes.svg) nodes.svg.dataset.action = name; };
      mark("rest");
      gdLife(e, () => !openRef.current, mark).catch(() => {});
    }
    return () => { e.destroy(); engineRef.current = null; };
  }, [ready, hidden, reducedMotion]);

  // While its tip is open it lifts its head and looks at you.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || reducedMotion) return;
    const values = open
      ? { headY: -3, headRot: 0, look: 0, noseUp: 0, follow: 0, sleep: 0, zzz: 0, perk: 0.5 }
      : { headY: 0, perk: 0 };
    e.tweenAll(values, open ? 600 : 800).catch(() => {});
  }, [open, reducedMotion]);

  if (!ready) return null;

  const toggleTip = () => setOpen((o) => !o);
  const hideDog = () => { setHidden(true); setOpen(false); };
  const showDog = () => setHidden(false);

  const tip = GUIDE_DOG_TIPS[view] || GUIDE_DOG_TIPS.other;
  const link = tip.link && tip.link.to !== location.pathname ? tip.link : null;
  const goToForm = (e) => {
    const el = document.getElementById("write-to-me");
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    setOpen(false);
  };

  // The tappable area is the house (with the dog in its doorway).
  const homeStyle = {
    left: 4 + (GD_HOME_BOX.x - GD_VIEW.x) * scale,
    width: GD_HOME_BOX.w * scale,
    height: GD_HOME_BOX.h * scale,
  };
  const bubbleStyle = {
    bottom: `calc(env(safe-area-inset-bottom, 0px) + ${Math.round(4 + GD_HOME_BOX.h * scale + 10)}px)`,
    "--gd-tail-x": `${Math.round((50 - GD_VIEW.x) * scale - 6 - 6)}px`,
  };

  return (
    <>
      <style>{GUIDE_DOG_CSS}</style>
      {/* Keeps the end of every page clear of the dog and its house. */}
      <div aria-hidden="true" style={{ height: Math.round(GD_HOME_BOX.h * scale) + 12, flexShrink: 0 }} />
      {hidden ? (
        <button type="button" className="gd-paw" onClick={showDog} aria-label="Bring back Diego the guide dog">
          <PawIcon />
        </button>
      ) : (
        <>
          <GuideDogScene nodes={nodes} scale={scale} />
          <button
            type="button"
            className="gd-home"
            style={homeStyle}
            aria-label="Diego the guide dog, tap for a tip"
            aria-expanded={open}
            aria-controls={open ? "gd-tip" : undefined}
            onClick={toggleTip}
          />
          {open && (
            <div className="gd-bubble" id="gd-tip" style={bubbleStyle}>
              <p className="gd-tip">{tip.text}</p>
              {link && (link.href ? (
                <a className="gd-link" href={link.href} onClick={goToForm}>{link.label}</a>
              ) : (
                <Link className="gd-link" to={link.to} onClick={() => setOpen(false)}>{link.label}</Link>
              ))}
              <button type="button" className="gd-hide" onClick={hideDog}>Hide the dog</button>
            </div>
          )}
        </>
      )}
    </>
  );
}

// =================================================================
// FAQ. One list of questions drives both the page and its FAQPage
// structured data, so the two can never disagree. An answer is a list
// of blocks: a plain string (a paragraph), { list: [...] } (bullets),
// or { parts: [...] } (a paragraph with inline links, where a link is
// { text, href } for outside links or { text, to } for site pages).
// =================================================================
const FAQ_SECTIONS = [
  {
    heading: "About the conversations",
    items: [
      { q: "Wait, are you going to read my mind?", a: ["No, I don't read minds. Through listening and questions, I help untangle your thoughts and bring you real clarity. You do the talking, and I help you put what's going on inside into words you can understand."] },
      {
        q: "Is there anything I can't talk about?",
        a: [
          "Not really. Some people come with something heavy, and some just need to say something out loud for the first time. For example:",
          {
            list: [
              "The thought that keeps you awake at 3 a.m.",
              "Feeling stuck, in a job, a relationship, or your own head",
              "Something you can't say to your family, friends or partner",
              "A decision you keep going back and forth on",
              "Guilt, regret, or anger you've been carrying quietly",
              "Loneliness, even when you're surrounded by people",
              "A strange dream, a coincidence, or an experience you can't explain",
              "A fantasy, a daydream, or a \"what if\" life you've imagined but never told anyone",
              "A big idea, a question about life, or something you're just curious about",
              "Good news or excitement that nobody around you seems to share",
            ],
          },
          "There's no topic too small, too strange, or too personal. If it's on your mind, it belongs here.",
        ],
      },
      { q: "What if I don't know where to begin?", a: ["That's completely fine. You don't need to prepare anything or know where the conversation should go. A few words to start are enough, and we'll find our way from there."] },
      { q: "Isn't this just therapy?", a: ["No. These conversations aren't therapy, counselling, or medical or psychological treatment, and I don't diagnose or treat any condition. They're a space to be heard and to think clearly. If you're seeing a therapist, this can sit alongside that, but it isn't a replacement."] },
      { q: "Why not just talk to a friend?", a: ["Friends are wonderful, but they often have opinions, history with you, or advice to give, and some things are hard to say to people who know you. Here, there's no judgment, no unasked-for advice, and nothing you say affects anyone in your life."] },
      { q: "Are you going to give me advice?", a: ["No. I ask questions and help you see your own thoughts more clearly. The decisions are always yours."] },
    ],
  },
  {
    heading: "Sessions and booking",
    items: [
      { q: "Can talking about my feelings for 60 minutes really bring change?", a: ["It can. Each session is a full, uninterrupted hour, which is something most people rarely get. Saying things out loud, without being judged or interrupted, often helps you see them more clearly than going over them alone. Some people leave feeling lighter after one conversation, and others come back to keep exploring. I can't promise any particular result, but I can promise you'll be truly heard."] },
      { q: "Do I have to show my face?", a: ["No. Sessions are by video or voice call, on an app we agree on beforehand, and you can keep your camera off if you prefer."] },
      { q: "You're in India and I'm not. Will the timing work?", a: ["Yes. Tell me your time zone and I'll find a time that works for you."] },
      {
        q: "How do we start the conversation?",
        a: [{
          parts: [
            "Send me a message on ",
            { text: "WhatsApp", href: `https://wa.me/${WHATSAPP_NUMBER}` },
            ", by ",
            { text: "email", href: `mailto:${EMAIL_ADDRESS}` },
            ", or through the ",
            { text: "Write to Me form", to: "/consultation" },
            ", and we'll choose a time together.",
          ],
        }],
      },
      { q: "Is the first hour really free? What's the catch?", a: ["No catch. Your first hour is on me. After that, sessions are $25 USD each, and only if you want to continue."] },
      { q: "How do I pay after that?", a: ["We'll go over payment options during our call, so you can choose what works best for you."] },
      { q: "What if something comes up and I can't make it?", a: ["No problem. Just let me know 24 hours before, and we'll reschedule."] },
      { q: "Is there an age limit?", a: ["Yes. Sessions are for adults aged 18 and over."] },
      { q: "What language do we talk in?", a: ["English only."] },
    ],
  },
  {
    heading: "Privacy and safety",
    items: [
      { q: "Will anyone else ever know what I said?", a: ["No. What you share stays private and is never shared with anyone, except where the law requires it or where someone's immediate safety is at serious risk."] },
      { q: "What do you do with my number and email?", a: ["Only what's needed to arrange and hold our conversations. Your contact details are never sold, shared, or added to any mailing list, and you can ask me to delete them at any time."] },
      { q: "What if I'm really not okay right now?", a: ["Please don't wait for a session. Contact your local emergency services or a crisis line right away (for example, 988 in the US)."] },
    ],
  },
  {
    heading: "The website",
    items: [
      { q: "Do I have to pay for the games and exercises?", a: ["No. Everything on the site is free to use."] },
      { q: "Do I need to sign up?", a: ["No. There are no accounts, logins, cookies or tracking on this site. Just open a game or exercise and start."] },
      { q: "Is anything I type or play saved?", a: ["No. Nothing you type or play is stored or sent anywhere. Once you leave the page, it's gone."] },
      { q: "What are the Brain Games good for?", a: ["Memory, attention and thinking: Chess for strategy, Recall and N Back for working memory, and Card, Word and Number Memory for recall."] },
      { q: "What do the Mind Exercises actually do?", a: ["They train calm and focus: Mindfulness Breathing slows you down, Leetspeak Reading sharpens attention, Flow Type builds focus stamina, and Guilford's Test exercises creative thinking."] },
      { q: "What's the RV Lab?", a: ["A space to practise remote viewing, an experimental exercise in perception. You sketch and describe a hidden target offline, then reveal the image. It's exploratory and experimental, not a scientifically proven method."] },
      { q: "Who's the dog?", a: ["That's Diego, my pet! Tap him on any page for a tip."] },
    ],
  },
];

// Plain text of an answer, for the structured data.
function faqAnswerText(blocks) {
  return blocks
    .map((b) => {
      if (typeof b === "string") return b;
      if (b.list) return b.list.map((item) => `- ${item}`).join("\n");
      return b.parts.map((p) => (typeof p === "string" ? p : p.text)).join("");
    })
    .join("\n");
}

const FAQ_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: faqAnswerText(item.a) },
    }))
  ),
}).replace(/</g, "\\u003c");

const FAQ_CSS = `
  .faq-q { list-style: none; cursor: pointer; }
  .faq-q::-webkit-details-marker { display: none; }
  .faq-q::marker { content: ""; }
  .faq-q:focus { outline: none; }
  .faq-q:focus-visible { outline: 2px solid ${COLORS.gold}; outline-offset: 3px; border-radius: 4px; }
  .faq-icon::before { content: "+"; }
  .faq-item[open] .faq-icon::before { content: "\\2212"; }
  .faq-item[open] .faq-answer { animation: fadeIn 0.25s ease both; }
`;

function FaqAnswer({ blocks }) {
  const c = useColors();
  return blocks.map((b, i) => {
    if (typeof b === "string") return <p key={i} style={styles(c).faqAnswerText}>{b}</p>;
    if (b.list) {
      return (
        <ul key={i} style={styles(c).faqList}>
          {b.list.map((item, j) => (<li key={j} style={styles(c).faqListItem}>{item}</li>))}
        </ul>
      );
    }
    return (
      <p key={i} style={styles(c).faqAnswerText}>
        {b.parts.map((p, j) => {
          if (typeof p === "string") return <Fragment key={j}>{p}</Fragment>;
          if (p.to) return <Link key={j} to={p.to} style={styles(c).faqLink}>{p.text}</Link>;
          const external = p.href.startsWith("http");
          return (
            <a key={j} href={p.href} style={styles(c).faqLink} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{p.text}</a>
          );
        })}
      </p>
    );
  });
}

function SiteFooterLine() {
  const c = useColors();
  return (
    <p style={styles(c).homeFooterLine}>
      <span>© {new Date().getFullYear()} Benjamin Mithra</span>{" "}
      <span style={styles(c).homeFooterDot}>·</span>{" "}
      <Link to={VIEW_PATH.articles} className="home-footer-link" style={styles(c).homeFooterLink}>Articles</Link>{" "}
      <span style={styles(c).homeFooterDot}>·</span>{" "}
      <Link to={VIEW_PATH.privacy} className="home-footer-link" style={styles(c).homeFooterLink}>Privacy</Link>{" "}
      <span style={styles(c).homeFooterDot}>·</span>{" "}
      <Link to={VIEW_PATH.terms} className="home-footer-link" style={styles(c).homeFooterLink}>Terms</Link>{" "}
      <span style={styles(c).homeFooterDot}>·</span>{" "}
      <Link to={VIEW_PATH.disclaimer} className="home-footer-link" style={styles(c).homeFooterLink}>Disclaimer</Link>
    </p>
  );
}

function FaqScreen() {
  const c = useColors();
  return (
    <div style={styles(c).faqWrap} className="fade-in">
      <style>{FAQ_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }} />
      <h1 style={styles(c).faqHeading}>Frequently Asked Questions</h1>

      {FAQ_SECTIONS.map((section) => (
        <section key={section.heading} style={styles(c).faqSection}>
          <h2 style={styles(c).placeholderSubhead}>{section.heading}</h2>
          <div style={styles(c).faqItems}>
            {section.items.map((item) => (
              <details key={item.q} className="faq-item" style={styles(c).faqItem}>
                <summary className="faq-q" style={styles(c).faqQuestion}>
                  <span>{item.q}</span>
                  <span className="faq-icon" style={styles(c).faqIcon} aria-hidden="true" />
                </summary>
                <div className="faq-answer" style={styles(c).faqAnswer}>
                  <FaqAnswer blocks={item.a} />
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      <div style={styles(c).faqCta}>
        <p style={styles(c).faqCtaText}>Still have a question?</p>
        <Link to={VIEW_PATH.contact} style={styles(c).btnGold}>Get in touch</Link>
      </div>

      <SiteFooterLine />
    </div>
  );
}

// =================================================================
// Articles. Every Markdown file in content/articles is one article at
// /articles/<file name>; the file format is described in
// src/articleFormat.js and WEEKLY_ARTICLE.md. routes.config.mjs reads the
// same files, so each one is prerendered and listed in the sitemap.
// =================================================================
const ARTICLE_FILES = import.meta.glob("../content/articles/*.md", { query: "?raw", import: "default", eager: true });
const ARTICLES = sortArticles(Object.entries(ARTICLE_FILES).map(([file, raw]) => parseArticle(raw, file)));
const ARTICLE_BY_SLUG = Object.fromEntries(ARTICLES.map((a) => [a.slug, a]));
const AUTHOR_BIO = "I listen, question, and reflect on your thoughts to uncover deeper perspectives.";

function articleMeta(a) {
  return { title: `${a.title} | Benjamin Mithra, Mind Interpreter`, description: a.description, type: "article" };
}

function articleJsonLd(a) {
  const url = `${SITE_URL}/articles/${a.slug}`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: a.date,
    dateModified: a.date,
    inLanguage: "en",
    url,
    mainEntityOfPage: url,
    image: `${SITE_URL}/benjamin-mithra.jpg`,
    wordCount: a.words,
    author: { "@type": "Person", "@id": `${SITE_URL}/#person`, name: "Benjamin Mithra", url: `${SITE_URL}/` },
    publisher: { "@id": `${SITE_URL}/#person` },
  }).replace(/</g, "\\u003c");
}

const ARTICLE_CSS = `
  .article-card { transition: border-color 0.15s ease; }
  .article-card:hover, .article-card:focus-visible { border-color: ${COLORS.gold} !important; outline: none; }
  .article-body { font-family: ${font.body}; font-size: 17px; line-height: 1.75; color: ${COLORS.ink}; }
  .article-body > :first-child { margin-top: 0; }
  .article-body p { margin: 0 0 1.1em; }
  .article-body h2 { font-family: ${font.display}; font-weight: 500; font-size: 21px; letter-spacing: 0.02em; line-height: 1.35; color: ${COLORS.gold}; margin: 1.8em 0 0.6em; }
  .article-body h3 { font-family: ${font.display}; font-weight: 500; font-size: 18px; letter-spacing: 0.02em; line-height: 1.35; color: ${COLORS.ink}; margin: 1.5em 0 0.5em; }
  .article-body ul, .article-body ol { margin: 0 0 1.1em; padding-left: 1.3em; }
  .article-body li { margin-bottom: 0.45em; }
  .article-body li::marker { color: ${COLORS.gold}; }
  .article-body a { color: ${COLORS.gold}; text-decoration: none; }
  .article-body a:hover { color: ${COLORS.goldHover}; }
  .article-body strong { font-weight: 600; }
  .article-body blockquote { margin: 1.3em 0; padding: 0.2em 0 0.2em 1em; border-left: 3px solid ${COLORS.gold}; color: ${COLORS.muted}; font-style: italic; }
  .article-body blockquote p:last-child { margin-bottom: 0; }
  .article-body hr { border: none; border-top: 1px solid ${COLORS.line}; margin: 2em 0; }
`;

function ArticlesListScreen() {
  const c = useColors();
  return (
    <div style={styles(c).articleWrap} className="fade-in">
      <style>{ARTICLE_CSS}</style>
      <h1 style={styles(c).faqHeading}>Articles</h1>
      {ARTICLES.length === 0 ? (
        <p style={styles(c).articleEmpty}>New articles are on their way.</p>
      ) : (
        <ul style={styles(c).articleList}>
          {ARTICLES.map((a) => (
            <li key={a.slug}>
              <Link to={`/articles/${a.slug}`} className="article-card" style={styles(c).articleCard}>
                <time dateTime={a.date} style={styles(c).articleCardDate}>{formatArticleDate(a.date)}</time>{" "}
                <h2 style={styles(c).articleCardTitle}>{a.title}</h2>{" "}
                <p style={styles(c).articleCardSummary}>{a.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <SiteFooterLine />
    </div>
  );
}

function ArticleScreen({ article }) {
  const c = useColors();
  const routerNavigate = useNavigate();
  const html = useMemo(() => (article ? marked.parse(article.body) : ""), [article]);

  useEffect(() => { window.scrollTo(0, 0); }, [article?.slug]);

  if (!article) {
    return (
      <div style={styles(c).articleWrap} className="fade-in">
        <h1 style={styles(c).faqHeading}>Article not found</h1>
        <p style={styles(c).articleEmpty}>This article may have moved. <Link to={VIEW_PATH.articles} style={styles(c).faqLink}>See all articles</Link>.</p>
        <SiteFooterLine />
      </div>
    );
  }

  // Links to other pages of the site open without a full page reload.
  const onBodyClick = (e) => {
    const link = e.target.closest && e.target.closest("a");
    const href = link && link.getAttribute("href");
    if (!href || !href.startsWith("/") || href.startsWith("//")) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    routerNavigate(href);
  };

  return (
    <div style={styles(c).articleWrap} className="fade-in">
      <style>{ARTICLE_CSS}</style>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: articleJsonLd(article) }} />
      <article style={styles(c).articleMain}>
        <header style={styles(c).articleHeader}>
          <Link to={VIEW_PATH.articles} style={styles(c).articleBack}>Articles</Link>
          <h1 style={styles(c).faqHeading}>{article.title}</h1>
          <p style={styles(c).articleMetaLine}>
            <time dateTime={article.date}>{formatArticleDate(article.date)}</time>{" "}
            <span aria-hidden="true" style={styles(c).homeFooterDot}>·</span>{" "}
            <span>{article.readingMinutes} min read</span>
          </p>
        </header>

        <div className="article-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />

        <aside style={styles(c).articleAuthor} aria-label="About the author">
          <img src="/benjamin-mithra.jpg" alt="Benjamin Mithra" width="64" height="64" style={styles(c).articleAuthorPhoto} />{" "}
          <div>
            <p style={styles(c).articleAuthorName}>Benjamin Mithra, Mind Interpreter</p>{" "}
            <p style={styles(c).articleAuthorBio}>{AUTHOR_BIO}</p>
          </div>
        </aside>

        <div style={styles(c).faqCta}>
          <p style={styles(c).articleCtaText}>If you'd like to talk it through with someone, I'm here.</p>
          <Link to={VIEW_PATH.contact} style={styles(c).btnGold}>Private Consultation</Link>
        </div>
      </article>
      <SiteFooterLine />
    </div>
  );
}

// =================================================================
// App
// =================================================================
function pickRandomGame(excludeSet) { const remaining = GAMES.filter((g) => !excludeSet.has(g.key)); return remaining[randInt(0, remaining.length - 1)].key; }

const TOP_TABS = [
  { key: "home", label: "Home" },
  { key: "exercises", label: "Mind Exercises" },
  { key: "games", label: "Brain Games" },
  { key: "rvlab", label: "RV Lab" },
  { key: "contact", label: "Consultation" },
  { key: "faq", label: "FAQ" },
];
const HAMBURGER_MENU_ITEMS = [
  ...TOP_TABS,
  { key: "articles", label: "Articles" },
  { key: "privacy", label: "Privacy" },
  { key: "terms", label: "Terms" },
  { key: "disclaimer", label: "Disclaimer" },
];
const GAME_TABS = [
  { key: "chess", label: "Chess" },
  { key: "everyday", label: "Recall" },
  { key: "nback", label: "N Back" },
  { key: "cards", label: "Card Memory" },
  { key: "words", label: "Word Memory" },
  { key: "numbers", label: "Number Memory" },
];

// =================================================================
// Routing. Real, bookmarkable URLs for every top-level section and
// every individual game/exercise, so each one is a genuine page a
// search engine (or a person) can land on directly, rather than
// everything living behind one URL with internal state. VIEW_PATH
// maps the app's existing internal "view" keys (unchanged from
// before) to real paths; GAME_SLUG/EXERCISE_SLUG do the same one
// level down for the individual games and exercises.
// =================================================================
const VIEW_PATH = {
  home: "/", journals: "/journals", exercises: "/exercises", games: "/games",
  rvlab: "/rv-lab", contact: "/consultation", faq: "/faq", articles: "/articles", privacy: "/privacy", terms: "/terms", disclaimer: "/disclaimer",
};
const GAME_SLUG = { chess: "chess", everyday: "recall", nback: "n-back", cards: "card-memory", words: "word-memory", numbers: "number-memory" };
const GAME_KEY_FROM_SLUG = Object.fromEntries(Object.entries(GAME_SLUG).map(([k, v]) => [v, k]));
const EXERCISE_SLUG = { breathing: "breathing", leet: "leetspeak-reading", flowtype: "flow-type", guilford: "guilfords-test" };
const EXERCISE_KEY_FROM_SLUG = Object.fromEntries(Object.entries(EXERCISE_SLUG).map(([k, v]) => [v, k]));

// Per page <title> and meta description, applied on every route
// change (including on the very first load, which is what the
// prerender step below captures into the static HTML for that URL).
const PAGE_META = {
  home: { title: "Mind Interpreter | Benjamin Mithra", description: "Private one-to-one conversations with Benjamin Mithra, a Mind Interpreter. You talk, I listen, we explore: a space to be heard without judgment." },
  journals: { title: "Journals | Mind Interpreter", description: "Reflections and reading on consciousness, cognition, and mindfulness from Benjamin Mithra. New journal entries coming soon." },
  exercises: { title: "Mind Exercises | Mind Interpreter", description: "Guided mindfulness breathing, leetspeak reading, flow typing, and Guilford's divergent thinking test to train focus, calm, and cognitive fluency." },
  "exercise-breathing": { title: "Mindfulness Breathing Exercise | Mind Interpreter", description: "A guided breathing exercise: inhale, hold, exhale, and hold again, paced to help you slow down and breathe more deliberately." },
  "exercise-leet": { title: "Leetspeak Reading Exercise | Mind Interpreter", description: "Decode short stories written in leetspeak to train visual attention, pattern recognition, and reading fluency." },
  "exercise-flowtype": { title: "Flow Type Exercise | Mind Interpreter", description: "Type continuously without stopping to build sustained focus and mental stamina under light pressure." },
  "exercise-guilford": { title: "Guilford's Test | Mind Interpreter", description: "A classic divergent thinking task: name unusual uses for an everyday object to exercise creative fluency." },
  games: { title: "Brain Games | Mind Interpreter", description: "Chess, Recall, N Back, Card Memory, Word Memory, and Number Memory: games built to train focus, memory, and pattern recognition." },
  "game-chess": { title: "Chess | Mind Interpreter", description: "Play chess against a built in engine, with a running timer and alternating colors each game." },
  "game-everyday": { title: "Recall: Everyday Memory Games | Mind Interpreter", description: "A rotating set of quick memory games: Digit Span, Word Recall, Kim's Game, Pattern Recall, Flash Grid, and Detective Case." },
  "game-nback": { title: "N Back Memory Game | Mind Interpreter", description: "A classic working memory task: spot the repeated pattern one step back in a moving sequence." },
  "game-cards": { title: "Card Memory Game | Mind Interpreter", description: "Memorize the positions of cards, then match pairs from memory." },
  "game-words": { title: "Word Memory Game | Mind Interpreter", description: "Memorize a list of words, then recall as many as you can." },
  "game-numbers": { title: "Number Memory Game | Mind Interpreter", description: "Memorize a growing sequence of digits and recall it back correctly." },
  rvlab: { title: "Remote Viewing Lab | Mind Interpreter", description: "Practice remote viewing with a freehand sketch, session notes, and a hidden target reveal, exploring anomalous perception and parapsychology." },
  contact: { title: "Private Consultation | Benjamin Mithra, Mind Interpreter", description: "A private one to one conversation with Benjamin Mithra, a Mind Interpreter. You talk, I listen, we explore: a space for conversation, reflection, and understanding." },
  privacy: { title: "Privacy Policy | Mind Interpreter", description: "How conversations and this site handle your information: conversations stay private, and the site uses no accounts, cookies, or tracking." },
  terms: { title: "Terms | Mind Interpreter", description: "Terms for using this site's games, exercises, and remote viewing content." },
  faq: { title: "FAQ | Benjamin Mithra, Mind Interpreter", description: "Answers about private conversations with Benjamin Mithra, a Mind Interpreter: what you can talk about, how sessions work, privacy, and the site's Brain Games and Mind Exercises." },
  articles: { title: "Articles | Benjamin Mithra, Mind Interpreter", description: "Articles by Benjamin Mithra, a Mind Interpreter, on loneliness, difficult conversations, hard decisions, overthinking, and the moments in life when you need to be heard." },
  "article-missing": { title: "Article not found | Mind Interpreter", description: "This article could not be found. Browse all articles by Benjamin Mithra, a Mind Interpreter." },
  disclaimer: { title: "Disclaimer | Mind Interpreter", description: "Conversations here are not therapy or medical care, and the site's exercises and remote viewing content are educational and experimental." },
};

const SITE_URL = "https://benjaminmithra.com";

// Finds a <meta> or <link> in <head> by one attribute, creating it if
// it isn't there yet, then sets its value.
function setHeadTag(tagName, matchAttr, matchValue, valueAttr, value) {
  let tag = document.head.querySelector(`${tagName}[${matchAttr}="${matchValue}"]`);
  if (!tag) {
    tag = document.createElement(tagName);
    tag.setAttribute(matchAttr, matchValue);
    document.head.appendChild(tag);
  }
  tag.setAttribute(valueAttr, value);
}

// An article passes its own meta (with type "article"); every other page
// uses PAGE_META and is a "website" for link previews.
function useDocumentMeta(key, pathname, override) {
  useEffect(() => {
    const meta = override || PAGE_META[key] || PAGE_META.home;
    // Canonical form: no www, no trailing slash except the home page.
    const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : "/";
    const url = `${SITE_URL}${path}`;
    document.title = meta.title;
    setHeadTag("meta", "name", "description", "content", meta.description);
    setHeadTag("link", "rel", "canonical", "href", url);
    setHeadTag("meta", "property", "og:title", "content", meta.title);
    setHeadTag("meta", "property", "og:description", "content", meta.description);
    setHeadTag("meta", "property", "og:url", "content", url);
    setHeadTag("meta", "property", "og:type", "content", meta.type || "website");
  }, [key, pathname, override?.title]);
}

export default function App() {
  const routerNavigate = useNavigate();
  const location = useLocation();
  const pathParts = location.pathname.split("/").filter(Boolean);

  const view = useMemo(() => {
    if (pathParts.length === 0) return "home";
    const first = pathParts[0];
    if (first === "consultation") return "contact";
    if (first === "rv-lab") return "rvlab";
    if (["journals", "exercises", "games", "faq", "articles", "privacy", "terms", "disclaimer"].includes(first)) return first;
    return "home";
  }, [location.pathname]);

  const gameTab = useMemo(() => {
    if (pathParts[0] !== "games" || !pathParts[1]) return null;
    return GAME_KEY_FROM_SLUG[pathParts[1]] || null;
  }, [location.pathname]);

  const exerciseTab = useMemo(() => {
    if (pathParts[0] !== "exercises" || !pathParts[1]) return null;
    return EXERCISE_KEY_FROM_SLUG[pathParts[1]] || null;
  }, [location.pathname]);

  const articleSlug = view === "articles" ? pathParts[1] || null : null;
  const article = articleSlug ? ARTICLE_BY_SLUG[articleSlug] || null : null;

  const metaKey = view === "games" && gameTab ? `game-${gameTab}` : view === "exercises" && exerciseTab ? `exercise-${exerciseTab}` : articleSlug && !article ? "article-missing" : view;
  useDocumentMeta(metaKey, location.pathname, article ? articleMeta(article) : null);

  const [menuOpen, setMenuOpen] = useState(false);

  const [activeGame, setActiveGame] = useState(() => pickRandomGame(new Set()));
  const [phase, setPhase] = useState("intro");
  const [failedGames, setFailedGames] = useState(new Set());
  const [recap, setRecap] = useState([]);
  const [pendingNext, setPendingNext] = useState(null);
  const [runKey, setRunKey] = useState(0);
  const [totalCleared, setTotalCleared] = useState(0);
  const [celebrate, setCelebrate] = useState(null);

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Space+Mono:wght@400;700&display=swap";
    document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, []);

  const handleProgress = () => {
    setTotalCleared((t) => {
      const next = t + 1;
      if (next > 2 && Math.random() < 0.22) {
        const msg = pick(CELEBRATIONS);
        setCelebrate(msg);
        setTimeout(() => setCelebrate(null), 900);
      }
      return next;
    });
  };

  const handleFail = (score) => {
    const entry = { game: activeGame, score };
    const newRecap = [...recap, entry];
    const newFailed = new Set(failedGames);
    newFailed.add(activeGame);
    setRecap(newRecap);
    setFailedGames(newFailed);
    if (newFailed.size >= GAMES.length) { setPhase("complete"); } else { setPendingNext(pickRandomGame(newFailed)); setPhase("transition"); }
  };

  const startNext = () => { setActiveGame(pendingNext); setRunKey((k) => k + 1); setPhase("playing"); };

  const resetAll = () => {
    setFailedGames(new Set()); setRecap([]); setTotalCleared(0);
    setActiveGame(pickRandomGame(new Set())); setRunKey((k) => k + 1); setPhase("playing");
  };

  const navigate = (target) => { routerNavigate(VIEW_PATH[target] || "/"); setMenuOpen(false); };
  const goToExercise = (key) => { routerNavigate(`/exercises/${EXERCISE_SLUG[key] || ""}`); setMenuOpen(false); };
  const selectGame = (key) => { routerNavigate(`/games/${GAME_SLUG[key] || ""}`); };
  const selectExercise = (key) => { routerNavigate(`/exercises/${EXERCISE_SLUG[key] || ""}`); };
  const handleBackArrow = () => {
    if (view === "games" && gameTab !== null) routerNavigate("/games");
    else if (view === "exercises" && exerciseTab !== null) routerNavigate("/exercises");
    else if (view === "articles" && articleSlug) routerNavigate("/articles");
    else navigate("home");
  };

  const c = COLORS;
  const ActiveComponent = GAME_COMPONENTS[activeGame];

  return (
    <ThemeContext.Provider value={c}>
      <div style={styles(c).root}>
        <style>{`
          ${FONT_IMPORT}
          * { box-sizing: border-box; }
          html, body { overflow-x: hidden; max-width: 100%; }
          button:disabled { opacity: 0.35; cursor: default; }
          input, textarea { font-family: inherit; }
          button { -webkit-tap-highlight-color: transparent; }
          button::-moz-focus-inner { border: 0; }
          .tile-btn { outline: none; -webkit-tap-highlight-color: transparent; -webkit-appearance: none; appearance: none; }
          .tile-btn:focus, .tile-btn:active, .tile-btn:focus-visible { outline: none; box-shadow: none; }
          .nav-btn { outline: none; }
          .nav-btn:focus, .nav-btn:active, .nav-btn:focus-visible { outline: none; box-shadow: none; }

          @keyframes bouncePop { 0% { transform: scale(1); } 40% { transform: scale(1.14); } 100% { transform: scale(1); } }
          @keyframes shakeIt { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-8px); } 40% { transform: translateX(7px); } 60% { transform: translateX(-5px); } 80% { transform: translateX(4px); } }
          @keyframes celebrateFade { 0% { opacity: 0; transform: translateY(6px) scale(0.96); } 15% { opacity: 1; transform: translateY(0) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes leetSweep { 0% { background-position: 0% 0; } 100% { background-position: -160% 0; } }
          @keyframes marqueeScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
          @keyframes bubbleFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
          @keyframes breathBurst { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--tx), var(--ty)) scale(0.2); opacity: 0; } }
          @keyframes flowFailPulse { 0%, 100% { background: rgba(201,107,91,0.14); } 50% { background: rgba(201,107,91,0.30); } }
          @media (prefers-reduced-motion: reduce) {
            .emotion-marquee-track { animation-duration: 400s !important; }
          }
          .fade-in { animation: fadeIn 0.35s ease both; }
          .nav-btn:hover { background: #B98220 !important; border-color: #B98220 !important; color: #FFFFFF !important; }
          .hero-btn:hover { background: #F0BD4D !important; border-color: #F0BD4D !important; color: #111820 !important; }
          .home-footer-link:hover { color: #E2AA3B !important; }
          .nav-btn:hover .exercise-card-title, .nav-btn:hover .exercise-card-desc { color: #FFFFFF !important; }
          @media (max-width: 600px) {
            .top-tabs { display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 6px !important; }
            .top-tabs .nav-btn {
              display: flex; align-items: center; justify-content: center; text-align: center; min-width: 0;
              font-size: 12px !important; letter-spacing: 0.04em !important; line-height: 1.2; padding: 8px 4px !important; min-height: 40px;
            }
          }
          @media (max-width: 360px) {
            .top-tabs .nav-btn { font-size: 11px !important; letter-spacing: 0.02em !important; padding: 8px 2px !important; }
          }
        `}</style>

        <CosmicBackground />

        {view === "home" || view === "contact" ? (
          <div style={styles(c).topBar}>
            <div className="top-tabs" style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", width: "100%" }}>
              {TOP_TABS.map((t, i) => (
                <Fragment key={t.key}>
                  {i > 0 && " "}
                  <Link to={VIEW_PATH[t.key] || "/"} className="nav-btn" style={{ ...styles(c).cornerBtn, ...(view === t.key ? styles(c).cornerBtnActive : {}) }}>
                    {t.label}
                  </Link>
                </Fragment>
              ))}
            </div>
          </div>
        ) : (
          <div style={styles(c).topBar}>
            <button className="nav-btn" style={styles(c).subTabBack} onClick={handleBackArrow} aria-label="Back">←</button>
            <div style={styles(c).hamburgerWrap}>
              <button className="nav-btn" style={styles(c).hamburgerBtn} onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
              {menuOpen && (
                <>
                  <div style={styles(c).hamburgerBackdrop} onClick={() => setMenuOpen(false)} />
                  <div style={styles(c).hamburgerMenu}>
                    {HAMBURGER_MENU_ITEMS.map((t) => (
                      <Link key={t.key} to={VIEW_PATH[t.key] || "/"} onClick={() => setMenuOpen(false)} className="nav-btn" style={{ ...styles(c).hamburgerMenuItem, ...(view === t.key ? styles(c).cornerBtnActive : {}) }}>
                        {t.label}
                      </Link>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {celebrate && (
          <div style={styles(c).celebrateOverlay} aria-hidden="true"><span style={styles(c).celebrateText}>{celebrate}</span></div>
        )}

        <main style={{ ...styles(c).main, ...(view === "home" ? styles(c).mainHome : {}), ...(view === "games" && gameTab === "chess" ? styles(c).mainChess : {}) }}>
          {view === "home" && <HomeScreen onNavigate={navigate} onOpenExercise={goToExercise} />}

          {view === "journals" && <PlaceholderScreen title="Journals" note="Reserved for reflections and reading. Coming soon." onNavigate={navigate} />}
          {view === "exercises" && exerciseTab === null && <ExercisesMenu onSelect={selectExercise} />}
          {view === "exercises" && exerciseTab === "breathing" && <MindfulnessBreathingExercise />}
          {view === "exercises" && exerciseTab === "leet" && <LeetReadingExercise />}
          {view === "exercises" && exerciseTab === "flowtype" && <FlowTypeExercise />}
          {view === "exercises" && exerciseTab === "guilford" && <GuilfordTestExercise />}
          {view === "rvlab" && <RVLabScreen />}
          {view === "contact" && <ContactScreen onNavigate={navigate} />}
          {view === "faq" && <FaqScreen />}
          {view === "articles" && !articleSlug && <ArticlesListScreen />}
          {view === "articles" && articleSlug && <ArticleScreen article={article} />}
          {view === "privacy" && (
            <PlaceholderScreen
              title="Privacy"
              note="This site does not use accounts, cookies, or any form of storage, and conversations are kept private. Here's what that actually means:"
              sections={[
                {
                  heading: "About the conversations",
                  points: [
                    "If you contact me by WhatsApp, email or the Write to Me form, your messages and contact details are used only to arrange and hold our conversations.",
                    "Calls take place on a standard video or voice call app that we agree on beforehand (such as WhatsApp or Zoom). That app's own privacy policy applies to the call itself. You can keep your camera off if you prefer.",
                    "What you share in a conversation stays private and is never shared with anyone, except where the law requires it or where someone's immediate safety is at serious risk.",
                    "Your contact details are never sold, shared, or added to any mailing list.",
                    "You can ask at any time for your messages and contact details to be deleted.",
                  ],
                },
                {
                  heading: "About the website",
                  points: [
                    "There are no accounts, logins, or user profiles anywhere on this site.",
                    "Remote Viewing sketches, notes, and scores exist only in your browser while you're using them, and are never saved or sent anywhere.",
                    "Nothing typed into the Mind Exercises tab (Flow Type, Guilford's Test answers) is stored either.",
                    "The Write to Me forms on the Home and Consultation pages are the one exception: the name, email, and message you submit there are sent to Formspree, a third-party form delivery service, which forwards it directly to the site owner's inbox. That message is not otherwise stored, published, or used for anything else.",
                    "No cookies, no localStorage, and no tracking of any kind are used on this site.",
                    "Loading the site's fonts (Google Fonts) and Remote Viewing target photos (Lorem Picsum) means your browser contacts those services directly, the same as most websites that use web fonts or hosted images.",
                    "No analytics services or advertising networks are used here.",
                  ],
                },
              ]}
            />
          )}
          {view === "terms" && (
            <PlaceholderScreen
              title="Terms"
              note="This site is offered for educational, experimental, and personal practice purposes only. A few things follow from that:"
              points={[
                "Games and exercises may produce different results for different people, and no score or outcome here should be taken as a guarantee of accuracy or ability.",
                "Remote Viewing content is presented as an experimental practice to explore, not a scientifically proven method with guaranteed results.",
                "Guilford's Test reports a fluency count (how many distinct, genuine answers you gave), not a judgment of intelligence or creative quality.",
                "Please don't interfere with, disrupt, or attempt unauthorized access to any part of this site.",
                "The site's original writing, design, illustrations, and code are protected and may not be redistributed without permission.",
                "This site is provided as is, without a promise that it will always be available, error free, or perfectly secure.",
              ]}
            />
          )}
          {view === "disclaimer" && (
            <PlaceholderScreen
              title="Disclaimer"
              note="This website offers private one-to-one conversations, along with educational, experimental and personal development content. None of it is a substitute for medical, psychiatric or licensed psychological care."
              sections={[
                {
                  heading: "About the conversations",
                  points: [
                    "Conversations with Benjamin Mithra are a space to talk, reflect and be heard. They are not therapy, counselling, coaching for clinical issues, or medical, psychiatric or psychological treatment.",
                    "Benjamin Mithra is not a licensed therapist, psychologist, counsellor or medical professional, and does not diagnose, treat or offer clinical advice for any condition.",
                    "Conversations can sit alongside care from a doctor or therapist, but are not a replacement for it. Please don't stop or change any treatment based on a conversation.",
                    "Sessions are for adults aged 18 and over.",
                    "Any decisions you make after a conversation are your own.",
                    "If you're in crisis or thinking about harming yourself or someone else, please don't wait for a session. Contact your local emergency services or a crisis line right away (for example, 988 in the US).",
                  ],
                },
                {
                  heading: "About the site's content",
                  points: [
                    "Nothing on this site diagnoses, treats, cures, or prevents any medical, psychiatric, or psychological condition.",
                    "Remote Viewing is presented as an educational and experimental practice, not established medical treatment or a replacement for professional judgment.",
                    "No claim is made that a user's perceptions during a Remote Viewing session correspond to objective fact about any target.",
                    "No game or exercise here, including Leetspeak Reading, Flow Type, or Guilford's Test, is claimed to raise IQ or change brain function in any clinically proven way.",
                    "Using this site does not create a doctor, therapist, psychologist, or attorney relationship with anyone.",
                  ],
                },
              ]}
            />
          )}

          {view === "games" && gameTab === null && <GamesMenu onSelect={selectGame} />}
          {view === "games" && gameTab === "cards" && <CardMemory />}
          {view === "games" && gameTab === "nback" && <NBackGame />}
          {view === "games" && gameTab === "words" && <WordMemory />}
          {view === "games" && gameTab === "numbers" && <NumberMemory />}
          {view === "games" && gameTab === "chess" && <ChessGame />}

          {view === "games" && gameTab === "everyday" && (
            <div style={styles(c).everydayWrap}>
              {phase !== "intro" && (
                <div style={styles(c).everydayTopRow}><button style={styles(c).cornerBtn} onClick={resetAll}>Reset</button></div>
              )}

              {phase === "intro" && (
                <div style={styles(c).nbackWrap} className="fade-in">
                  <p style={styles(c).rvHeading}>Recall</p>
                  <p style={styles(c).rvSubhead}>Everyday Memory</p>
                  <p style={styles(c).instruction}>You'll be given a rotating set of quick memory games: Digit Span, Word Recall, Kim's Game, Pattern Recall, Flash Grid, and Detective Case. Clear each one to move to the next, until you slip up.</p>
                  <button style={styles(c).btnPrimary} onClick={() => setPhase("playing")}>Start</button>
                </div>
              )}

              {phase === "playing" && (
                <>
                  <p style={styles(c).levelLabel}>{GAME_LABEL[activeGame]}</p>
                  <p style={styles(c).recallGameDescription}>{GAME_DESCRIPTION[activeGame]}</p>
                  <ActiveComponent key={runKey} onFail={handleFail} onProgress={handleProgress} />
                </>
              )}

              {phase === "transition" && (
                <div style={styles(c).gameBox} className="fade-in">
                  <p style={styles(c).levelLabel}>Round over</p>
                  <p style={styles(c).resultText}>You reached level {recap[recap.length - 1].score} in {GAME_LABEL[recap[recap.length - 1].game]}.</p>
                  <p style={styles(c).instruction}>Next up: {GAME_LABEL[pendingNext]}</p>
                  <button style={styles(c).btnPrimary} onClick={startNext}>Start {GAME_LABEL[pendingNext]}</button>
                </div>
              )}

              {phase === "complete" && (
                <div style={styles(c).gameBox} className="fade-in">
                  <p style={styles(c).levelLabel}>Session complete</p>
                  <p style={styles(c).resultText}>You have played all six. Here is how it went.</p>
                  <ul style={styles(c).recapList}>
                    {recap.map((r, i) => (<li key={i} style={styles(c).recapItem}>{GAME_LABEL[r.game]}: reached level {r.score}</li>))}
                  </ul>
                  <button style={styles(c).btnPrimary} onClick={resetAll}>Play again</button>
                </div>
              )}
            </div>
          )}
        </main>

        <GuideDog view={view} />
        {(view === "home" || view === "contact" || view === "faq" || (view === "exercises" && !exerciseTab) || (view === "games" && !gameTab)) && <WhatsAppFloat />}
      </div>
    </ThemeContext.Provider>
  );
}

// =================================================================
// Styles
// =================================================================
function styles(c) {
  return {
    root: {
      position: "relative", minHeight: "100vh", background: c.bg, color: c.ink, fontFamily: font.body,
      display: "flex", flexDirection: "column", alignItems: "center",
    },

    // ---- Background ----
    eliteWrap: { position: "fixed", inset: 0, overflow: "hidden", zIndex: 0, pointerEvents: "none", background: c.bg },
    eliteVignette: { position: "absolute", inset: 0, background: `radial-gradient(ellipse at 50% 15%, ${c.surface} 0%, ${c.bg} 60%, ${c.playfield} 100%)`, opacity: 0.7 },

    mainHome: { padding: 0, maxWidth: "none", width: "100%" },
    mainChess: { paddingLeft: 4, paddingRight: 4 },
    homeOuter: { position: "relative", width: "100%", display: "flex", justifyContent: "center" },
    homeContent: { position: "relative", zIndex: 1, width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center", gap: 32, padding: "36px 16px 60px", textAlign: "center" },
    homeHeader: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%", maxWidth: 480 },
    homeLeetGroup: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%", maxWidth: 480 },
    homeWriteToMe: { maxWidth: 480 },
    siteHeading: {
      fontFamily: font.display, fontWeight: 700, fontStyle: "normal",
      fontSize: "clamp(24px, 6vw, 32px)", letterSpacing: "0.09em", lineHeight: 1.45, textTransform: "uppercase",
      color: c.gold, margin: 0, textAlign: "center",
      display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: "clamp(10px, 3vw, 16px)",
      width: "100%", maxWidth: 720, padding: "0 16px", boxSizing: "border-box",
    },
    siteLogo: { width: "clamp(40px, 11vw, 60px)", height: "auto", flexShrink: 0, display: "block" },
    siteHeadingLine: { display: "block", whiteSpace: "nowrap" },
    siteSubtitle: { fontFamily: font.body, fontSize: 19, lineHeight: 1.5, color: c.ink, margin: 0, textAlign: "center" },
    siteSubtitleLine: { fontFamily: font.body, fontSize: 17, lineHeight: 1.55, color: c.ink, margin: 0, textAlign: "center", maxWidth: 480 },
    homeIntro: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: "100%", maxWidth: 480, margin: 0 },
    homeIntroText: { fontFamily: font.body, fontSize: 16, lineHeight: 1.6, color: c.muted, margin: 0, textAlign: "center" },
    homeIntroBtn: { width: "auto", display: "inline-block", marginTop: 6 },
    heroButtonsGrid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, width: "100%", maxWidth: 480 },
    heroGridBtn: { display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1.3, padding: "9px 12px", boxSizing: "border-box", minWidth: 0 },
    heroBtn: {
      textDecoration: "none", textAlign: "center", fontFamily: font.display, fontWeight: 500, fontSize: 14, letterSpacing: "0.05em", textTransform: "uppercase",
      background: c.gold, color: "#111820", border: `1px solid ${c.gold}`, borderRadius: 6, padding: "9px 20px", cursor: "pointer",
      width: "100%", transition: "background 0.15s ease, border-color 0.15s ease",
    },
    leetWrap: {
      position: "relative", width: "100%", maxWidth: 480, display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden", borderRadius: 12, padding: "24px 22px", border: "1px solid #29414B", background: "#081820",
      cursor: "pointer", outline: "none", WebkitAppearance: "none", appearance: "none", textAlign: "center",
    },
    leetSweep: {
      position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none",
      background: "linear-gradient(100deg, transparent 35%, rgba(185,130,32,0.20) 50%, transparent 65%)",
      backgroundSize: "260% 100%",
      animation: "leetSweep 7s linear infinite",
    },
    leetText: {
      position: "relative", zIndex: 2, fontFamily: font.mono, fontWeight: 400, fontSize: 16, lineHeight: 1.85,
      letterSpacing: "0.02em", color: "#C8D0D0", margin: 0, textAlign: "center",
    },

    emotionMarqueeWrap: { width: "100%", maxWidth: 480, overflow: "hidden", margin: 0 },
    emotionMarqueeTrack: { display: "flex", width: "max-content", animation: "marqueeScroll 90s linear infinite" },
    emotionMarqueeCopy: { display: "flex", flexShrink: 0, alignItems: "center", gap: 8, paddingRight: 40 },
    emotionBox: {
      fontFamily: font.mono, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.03em", textTransform: "uppercase",
      padding: "8px 13px", borderRadius: 8, display: "inline-block", lineHeight: 1.2, whiteSpace: "nowrap", flexShrink: 0,
    },

    homeInlineLink: { color: c.gold, textDecoration: "none", fontStyle: "normal" },
    homePhilosophy: {
      fontFamily: font.body, fontStyle: "italic", fontWeight: 400, fontSize: 16.5, lineHeight: 1.9,
      color: c.muted, width: "100%", maxWidth: 480, margin: 0,
    },
    homeFooterLine: {
      fontFamily: font.mono, fontSize: 12, color: c.muted, margin: "30px 0 0", padding: "18px 0 0",
      borderTop: `1px solid ${c.line}`, width: "100%", maxWidth: 480, textAlign: "center",
      display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: "6px 8px",
    },
    homeFooterDot: { color: c.line },
    homeFooterLink: {
      textDecoration: "none", fontFamily: font.mono, fontSize: 12, color: c.muted, background: "none", border: "none", cursor: "pointer", padding: 0,
      transition: "color 0.15s ease",
    },
    homeQuestionBox: {
      background: c.surface, border: `1px solid ${c.gold}`, borderRadius: 14, padding: "18px 26px",
      width: "100%", maxWidth: 480, minHeight: 124, display: "flex", alignItems: "center", justifyContent: "center",
      margin: 0, overflow: "hidden",
    },
    homeQuestion: {
      fontFamily: font.body, fontStyle: "italic", fontWeight: 700, fontSize: 18.5, lineHeight: 1.5,
      letterSpacing: "0.01em", color: c.gold, margin: 0, textAlign: "center",
    },
    topBar: { position: "relative", zIndex: 100, width: "100%", maxWidth: 680, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px" },
    cornerBtn: { textDecoration: "none", fontFamily: font.display, fontWeight: 500, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase", background: "transparent", border: "1px solid #3A5661", borderRadius: 6, padding: "7px 15px", color: "#D6DDE0", cursor: "pointer", transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease" },
    cornerBtnActive: { background: c.gold, borderColor: c.gold, color: "#111820" },

    subTabBar: { display: "flex", gap: 8, width: "100%", maxWidth: 680, position: "relative", zIndex: 5, flexWrap: "nowrap", overflowX: "auto", paddingBottom: 6, WebkitOverflowScrolling: "touch" },
    subTabBack: { flexShrink: 0, fontFamily: font.display, fontWeight: 600, fontSize: 16, background: "transparent", border: "1px solid #3A5661", borderRadius: 6, padding: "8px 12px", color: "#D6DDE0", cursor: "pointer", outline: "none" },
    hamburgerWrap: { position: "relative" },
    hamburgerBtn: { flexShrink: 0, fontFamily: font.display, fontWeight: 600, fontSize: 16, background: "transparent", border: "1px solid #3A5661", borderRadius: 6, padding: "8px 12px", color: "#D6DDE0", cursor: "pointer", outline: "none" },
    hamburgerBackdrop: { position: "fixed", inset: 0, zIndex: 40, background: "transparent" },
    hamburgerMenu: {
      position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 41, minWidth: 160,
      background: c.surface, border: "1px solid #29414B", borderRadius: 10, padding: 8,
      display: "flex", flexDirection: "column", gap: 6, boxShadow: "0 12px 30px rgba(0,0,0,0.5)",
    },
    hamburgerMenuItem: {
      textDecoration: "none", fontFamily: font.display, fontWeight: 500, fontSize: 13.5, letterSpacing: "0.04em", textTransform: "uppercase",
      background: "transparent", border: "1px solid #29414B", borderRadius: 6, padding: "9px 14px", color: "#D6DDE0",
      cursor: "pointer", outline: "none", textAlign: "left", width: "100%",
    },
    subTab: { flexShrink: 0, whiteSpace: "nowrap", fontFamily: font.display, fontWeight: 500, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase", background: c.surface, border: "1px solid #29414B", borderRadius: 6, padding: "8px 13px", color: "#D6DDE0", cursor: "pointer", outline: "none", transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease" },
    subTabActive: { color: "#111820", background: c.gold, borderColor: c.gold },
    gamesMenuWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", maxWidth: 560, margin: "0 auto", textAlign: "center" },
    gamesMenuGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16, width: "100%", marginTop: 14 },
    gamesMenuCard: {
      textDecoration: "none", textAlign: "center", fontFamily: font.display, fontWeight: 600, fontSize: 17, letterSpacing: "0.03em", textTransform: "uppercase",
      background: c.surface, border: "1px solid #29414B", borderRadius: 12, padding: "30px 16px", color: c.gold, cursor: "pointer", outline: "none",
    },
    exercisesMenuGrid: { display: "flex", flexDirection: "column", gap: 14, width: "100%", marginTop: 14 },
    exerciseMenuCard: {
      textDecoration: "none", color: c.ink, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, textAlign: "left",
      background: c.surface, border: "1px solid #29414B", borderRadius: 12, padding: "20px 22px", cursor: "pointer", outline: "none", width: "100%", boxSizing: "border-box",
    },
    exerciseMenuCardTitle: { fontFamily: font.display, fontWeight: 600, fontSize: 17, letterSpacing: "0.03em", textTransform: "uppercase", color: c.gold },
    exerciseMenuCardDesc: { fontFamily: font.body, fontWeight: 400, fontSize: 14, lineHeight: 1.6, color: c.muted },
    leetReadBox: { width: "100%", maxWidth: 560, background: "#FFFFFF", border: "1px solid #29414B", borderRadius: 12, padding: "22px 24px", maxHeight: 420, overflowY: "auto", boxSizing: "border-box" },
    leetReadText: { fontFamily: font.mono, fontSize: 15.5, lineHeight: 1.85, letterSpacing: "0.02em", color: "#111111", whiteSpace: "pre-wrap", margin: 0, textAlign: "left" },

    breathFrame: {
      position: "relative", width: "100%", maxWidth: 400, aspectRatio: "1 / 1.15", background: "#000000",
      borderRadius: 24, border: "1px solid #29414B", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14, boxSizing: "border-box",
    },
    breathBall: {
      position: "relative", zIndex: 2, width: BREATH_BALL_REST, height: BREATH_BALL_REST, borderRadius: "50%",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
      boxShadow: "0 0 40px 6px rgba(255,255,255,0.08)",
    },
    breathBallLabel: {
      fontFamily: font.display, fontWeight: 600, fontSize: 11, letterSpacing: "0.06em",
      textTransform: "uppercase", color: "#0B0B0B", opacity: 0.75,
    },
    breathCount: { fontFamily: font.mono, fontWeight: 700, fontSize: 26, color: "#0B0B0B" },
    breathParticleWrap: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1, pointerEvents: "none" },
    breathParticle: { position: "absolute", borderRadius: "50%", animation: "breathBurst 1000ms ease-out forwards" },

    homeBreathFrame: {
      position: "relative", width: "100%", maxWidth: 480, height: 220, background: "#000000",
      borderRadius: 12, border: "1px solid #29414B", overflow: "hidden",
      cursor: "pointer", outline: "none", padding: 0, WebkitAppearance: "none", appearance: "none",
    },
    homeBreathBall: {
      position: "absolute", width: HOME_BREATH_BALL_REST, height: HOME_BREATH_BALL_REST, borderRadius: "50%",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 0 30px 5px rgba(255,255,255,0.08)",
    },
    homeBreathBallLabel: {
      fontFamily: font.display, fontWeight: 600, fontSize: 8.5, letterSpacing: "0.04em",
      textTransform: "uppercase", color: "#0B0B0B", opacity: 0.8, whiteSpace: "nowrap",
    },

    flowTypeTextarea: {
      width: "100%", maxWidth: 560, minHeight: 260, background: c.playfield, border: `1px solid ${c.line}`, borderRadius: 12,
      padding: "16px 18px", fontFamily: font.body, fontSize: 15.5, lineHeight: 1.7, color: c.ink, outline: "none", resize: "vertical", boxSizing: "border-box",
    },
    flowTypeFailBanner: {
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", maxWidth: 420,
      padding: "26px 20px", borderRadius: 14, border: `2px solid ${c.bad}`, background: "rgba(201,107,91,0.14)",
      animation: "flowFailPulse 1.4s ease-in-out infinite",
    },
    flowTypeSuccessBanner: {
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8, width: "100%", maxWidth: 420,
      padding: "26px 20px", borderRadius: 14, border: `2px solid ${c.good}`, background: "rgba(88,180,159,0.14)",
    },
    flowTypeFailEmoji: { fontSize: 34, margin: 0 },
    flowTypeFailText: { fontFamily: font.display, fontWeight: 700, fontSize: 20, letterSpacing: "0.04em", textTransform: "uppercase", color: c.bad, margin: 0 },
    flowTypeSuccessText: { fontFamily: font.display, fontWeight: 700, fontSize: 20, letterSpacing: "0.04em", textTransform: "uppercase", color: c.good, margin: 0 },

    guilfordObjectBox: {
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6, width: "100%", maxWidth: 220,
      background: c.playfield, border: `1px solid ${c.line}`, borderRadius: 14, padding: "22px 16px",
    },
    guilfordObjectEmoji: { fontSize: 48, lineHeight: 1 },
    guilfordObjectName: { fontFamily: font.display, fontWeight: 600, fontSize: 15, letterSpacing: "0.04em", textTransform: "uppercase", color: c.gold },
    guilfordInputList: { display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 420 },
    guilfordInput: {
      fontFamily: font.body, fontSize: 14.5, color: c.ink, background: c.playfield, border: `1px solid ${c.line}`,
      borderRadius: 8, padding: "10px 12px", outline: "none", width: "100%", boxSizing: "border-box",
    },

    main: { position: "relative", zIndex: 2, width: "100%", maxWidth: 680, padding: "10px 20px 80px", minHeight: 460, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" },
    everydayWrap: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 },
    everydayTopRow: { width: "100%", display: "flex", justifyContent: "flex-end", marginBottom: 4 },

    celebrateOverlay: { position: "fixed", top: "18%", left: "50%", transform: "translateX(-50%)", zIndex: 5, pointerEvents: "none", animation: "celebrateFade 0.9s ease both" },
    celebrateText: { fontFamily: font.display, fontSize: 26, letterSpacing: "0.06em", textTransform: "uppercase", color: c.gold, textShadow: `0 0 20px ${c.gold}55` },

    gameBox: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 20, width: "100%", minHeight: 420, justifyContent: "center" },
    levelLabel: { fontFamily: font.display, fontSize: 18, letterSpacing: "0.06em", textTransform: "uppercase", color: c.gold, margin: 0 },
    instruction: { fontFamily: font.display, fontWeight: 500, fontSize: 15.5, lineHeight: 1.7, color: c.ink, maxWidth: 480, margin: 0 },
    recallGameDescription: { fontFamily: font.display, fontWeight: 500, fontSize: 14, lineHeight: 1.6, color: c.ink, maxWidth: 620, textAlign: "center", margin: 0 },
    resultText: { fontFamily: font.mono, fontWeight: 400, fontSize: 15, lineHeight: 1.7, color: c.muted, maxWidth: 480 },
    verdict: { fontFamily: font.display, fontSize: 26, letterSpacing: "0.03em", textTransform: "uppercase", margin: 0 },
    timerTrack: { width: 220, height: 6, borderRadius: 3, background: "#202B31", overflow: "hidden" },
    timerFill: { height: "100%", background: c.gold, transition: "width 1s linear" },
    digitDisplay: { fontFamily: font.mono, fontSize: 52, letterSpacing: "0.14em", margin: 0, color: c.ink, userSelect: "none", WebkitUserSelect: "none", MozUserSelect: "none", msUserSelect: "none", WebkitTouchCallout: "none" },
    wordDisplay: { fontFamily: font.mono, fontWeight: 700, fontSize: 40, letterSpacing: "0.03em", margin: 0, color: c.ink },
    textInput: { fontFamily: font.mono, fontSize: 22, letterSpacing: "0.1em", textAlign: "center", border: `1px solid ${c.line}`, borderRadius: 8, padding: "10px 14px", width: 220, background: c.panel, color: c.ink },
    rowButtons: { display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" },
    emojiGrid: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10, maxWidth: 480 },
    emojiTile: { fontSize: 28, width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center", background: c.panel, border: `1px solid ${c.line}`, borderRadius: 10 },
    emojiChoice: { cursor: "pointer" },
    emojiChosen: { borderColor: c.good, background: c.good + "22" },
    emojiRowsWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10 },
    emojiRow: { display: "flex", justifyContent: "center", gap: 10 },
    scatterWrap: { position: "relative", width: "100%", maxWidth: 480, height: 240 },
    scatterTile: { position: "absolute", transform: "translate(-50%, -50%)" },
    sqTile: { background: "#F5F0E3", border: "1px solid #DCD0B4", borderRadius: 8, cursor: "pointer", width: "100%", height: "100%", outline: "none", WebkitAppearance: "none", appearance: "none" },
    sqTileActive: { background: c.gold, borderColor: c.gold },
    bounceAnim: { animation: "bouncePop 0.15s ease" },
    shakeAnim: { animation: "shakeIt 0.32s ease" },
    visualGrid: { display: "grid", gap: 8, width: "100%", maxWidth: 360 },
    numTile: { background: c.panel, border: `1px solid ${c.line}`, borderRadius: 8, height: 52, fontFamily: font.mono, fontSize: 18, color: c.ink, cursor: "pointer", outline: "none", WebkitAppearance: "none", appearance: "none" },
    numTileUsed: { background: c.bg, opacity: 0.3 },
    btnPrimary: { fontFamily: font.display, fontSize: 15, letterSpacing: "0.04em", textTransform: "uppercase", background: c.good, color: "#0E1410", border: "none", borderRadius: 6, padding: "13px 24px", cursor: "pointer" },
    btnGold: { textDecoration: "none", fontFamily: font.display, fontSize: 15, letterSpacing: "0.04em", textTransform: "uppercase", background: c.gold, color: "#111820", border: "none", borderRadius: 6, padding: "13px 24px", cursor: "pointer" },
    btnGhost: { fontFamily: font.display, fontSize: 15, letterSpacing: "0.04em", textTransform: "uppercase", background: "transparent", color: c.ink, border: `1px solid ${c.line}`, borderRadius: 6, padding: "13px 20px", cursor: "pointer" },
    caseList: { textAlign: "left", fontSize: 14.5, lineHeight: 1.9, color: c.ink, maxWidth: 480, margin: 0, paddingLeft: 20 },
    caseItem: {},
    answerInput: { fontFamily: font.body, fontSize: 15, lineHeight: 1.5, border: `1px solid ${c.line}`, borderRadius: 8, padding: "12px 14px", width: "100%", maxWidth: 480, background: c.panel, color: c.ink, resize: "vertical" },
    recapList: { fontFamily: font.mono, fontSize: 13.5, lineHeight: 2, color: c.muted, margin: 0, paddingLeft: 20, textAlign: "left", maxHeight: 260, overflowY: "auto" },
    recapItem: {},
    placeholderList: {
      fontFamily: font.body, fontSize: 15, lineHeight: 1.75, color: c.ink, margin: "6px 0 0",
      paddingLeft: 22, textAlign: "left", maxWidth: 480, listStyleType: "disc",
    },
    faqWrap: { width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", alignItems: "center", gap: 28, padding: "8px 0 20px" },
    faqHeading: { fontFamily: font.display, fontWeight: 600, fontSize: 27, letterSpacing: "0.03em", lineHeight: 1.3, color: c.gold, margin: "2px 0 0", textAlign: "center", textWrap: "balance" },
    faqSection: { width: "100%", textAlign: "left" },
    faqItems: { borderBottom: `1px solid ${c.line}`, marginTop: 8 },
    faqItem: { borderTop: `1px solid ${c.line}` },
    faqQuestion: {
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "14px 2px",
      fontFamily: font.display, fontWeight: 500, fontSize: 16.5, letterSpacing: "0.02em", lineHeight: 1.45, color: c.gold,
    },
    faqIcon: { flexShrink: 0, width: 22, height: 22, borderRadius: "50%", border: `1px solid ${c.strongLine}`, color: c.gold, fontFamily: font.display, fontSize: 16, lineHeight: "20px", textAlign: "center" },
    faqAnswer: { padding: "0 2px 16px", display: "flex", flexDirection: "column", gap: 10 },
    faqAnswerText: { fontFamily: font.body, fontSize: 15.5, lineHeight: 1.7, color: c.muted, margin: 0 },
    faqList: { fontFamily: font.body, fontSize: 15.5, lineHeight: 1.7, color: c.muted, margin: 0, paddingLeft: 22, listStyleType: "disc" },
    faqListItem: { marginBottom: 4 },
    faqLink: { color: c.gold, textDecoration: "none" },
    faqCta: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 4 },
    faqCtaText: { fontFamily: font.display, fontWeight: 500, fontSize: 18, letterSpacing: "0.02em", color: c.ink, margin: 0 },
    articleWrap: { width: "100%", maxWidth: 640, display: "flex", flexDirection: "column", alignItems: "center", gap: 28, padding: "8px 0 20px" },
    articleEmpty: { fontFamily: font.body, fontSize: 17, lineHeight: 1.6, color: c.muted, margin: 0, textAlign: "center" },
    articleList: { listStyle: "none", margin: 0, padding: 0, width: "100%", display: "flex", flexDirection: "column", gap: 14 },
    articleCard: {
      display: "flex", flexDirection: "column", gap: 6, textDecoration: "none", textAlign: "left",
      background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, padding: "18px 20px",
    },
    articleCardDate: { fontFamily: font.mono, fontSize: 12, letterSpacing: "0.02em", color: c.muted },
    articleCardTitle: { fontFamily: font.display, fontWeight: 500, fontSize: 20, letterSpacing: "0.02em", lineHeight: 1.35, color: c.gold, margin: 0 },
    articleCardSummary: { fontFamily: font.body, fontSize: 15.5, lineHeight: 1.6, color: c.muted, margin: 0 },
    articleMain: { width: "100%", display: "flex", flexDirection: "column", gap: 28 },
    articleHeader: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" },
    articleBack: { fontFamily: font.display, fontWeight: 500, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: c.gold, textDecoration: "none" },
    articleMetaLine: { fontFamily: font.mono, fontSize: 12.5, color: c.muted, margin: 0, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" },
    articleAuthor: {
      display: "flex", alignItems: "center", gap: 16, textAlign: "left",
      background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, padding: "16px 18px",
    },
    articleAuthorPhoto: { width: 64, height: 64, borderRadius: "50%", objectFit: "cover", objectPosition: "50% 22%", flexShrink: 0, border: `1px solid ${c.gold}` },
    articleAuthorName: { fontFamily: font.display, fontWeight: 500, fontSize: 16, letterSpacing: "0.02em", color: c.gold, margin: "0 0 4px" },
    articleAuthorBio: { fontFamily: font.body, fontSize: 15, lineHeight: 1.55, color: c.muted, margin: 0 },
    articleCtaText: { fontFamily: font.body, fontStyle: "italic", fontSize: 17, lineHeight: 1.6, color: c.ink, margin: 0, textAlign: "center" },
    placeholderSection: { width: "100%", maxWidth: 480, textAlign: "left" },
    placeholderSubhead: { fontFamily: font.display, fontWeight: 500, fontSize: 14, letterSpacing: "0.08em", textTransform: "uppercase", color: c.gold, margin: "0 0 4px" },
    placeholderListItem: { fontFamily: font.body, fontSize: 15, lineHeight: 1.75, color: c.ink, marginBottom: 8 },

    cardScreenWrap: { position: "relative", width: "100%", display: "flex", justifyContent: "center", paddingTop: 50 },
    stopwatchBadge: { position: "absolute", top: -2, right: 0, fontFamily: font.mono, fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", color: c.ink, background: c.panel, border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", zIndex: 3 },
    splitTimesRow: { display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" },
    splitTimeChip: { fontFamily: font.mono, fontSize: 12.5, color: c.muted, border: `1px solid ${c.line}`, borderRadius: 6, padding: "5px 10px" },
    bigCard: { width: 160, height: 220, background: "#FFFFFF", border: "1px solid #E2DAC8", borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", outline: "none", WebkitAppearance: "none", appearance: "none" },
    cardRank: { fontFamily: font.display, fontSize: 56, lineHeight: 1 },
    cardSuit: { fontSize: 40, lineHeight: 1 },
    cardGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, width: "100%", maxWidth: 360, margin: "0 auto" },
    smallCard: { width: "100%", aspectRatio: "3 / 4", background: "#FFFFFF", border: "1px solid #E2DAC8", borderRadius: 8, fontFamily: font.mono, fontSize: 17, fontWeight: 600, cursor: "pointer", outline: "none", WebkitAppearance: "none", appearance: "none" },
    smallCardMatched: { opacity: 0.28 },
    compareHeaderRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", maxWidth: 320 },
    compareHeaderCell: { fontFamily: font.mono, fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: c.muted, textAlign: "center" },
    compareWrap: { display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 320, maxHeight: 380, overflowY: "auto", paddingRight: 4 },
    compareRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
    compareCell: { display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", border: "1px solid #E2DAC8", borderRadius: 6, height: 34, fontFamily: font.mono, fontSize: 13, fontWeight: 600 },
    compareCellGood: { background: c.good, border: `1px solid ${c.good}` },
    compareCellBad: { boxShadow: `inset 0 0 0 2px ${c.bad}` },

    wordListBox: { fontFamily: font.mono, fontWeight: 400, fontSize: 17, lineHeight: 1.9, color: c.ink, maxWidth: 520, background: c.cardBg, border: `1px solid ${c.cardBorder}`, borderRadius: 10, padding: "18px 20px" },
    numberColumns: { display: "flex", flexDirection: "column", gap: 8, alignItems: "center", width: "100%" },
    numberRow: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 },
    numberCell: { fontFamily: font.mono, fontSize: 18, letterSpacing: "0.04em", color: c.ink, background: c.cardBg, border: `1px solid ${c.cardBorder}`, borderRadius: 8, padding: "7px 8px", minWidth: 42, textAlign: "center" },

    contactOuter: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "10px 0 60px" },
    contactCard: {
      width: "100%", maxWidth: 540, display: "flex", flexDirection: "column", gap: 14, textAlign: "left",
      background: c.secondary,
      border: `1px solid ${c.line}`, borderRadius: 20, padding: "34px 32px",
      boxShadow: "0 18px 46px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)",
    },
    contactEyebrow: { fontFamily: font.mono, fontSize: 13.5, letterSpacing: "0.16em", textTransform: "uppercase", color: c.good, margin: "0 0 4px" },
    contactTitle: { fontFamily: font.display, fontSize: 27, letterSpacing: "0.02em", lineHeight: 1.4, color: c.gold, margin: "2px 0 8px" },
    contactBigHeading: { fontFamily: font.display, fontWeight: 700, fontSize: 32, letterSpacing: "0.03em", textTransform: "uppercase", color: c.gold, margin: "0 0 10px", lineHeight: 1.3 },
    contactBody: { fontSize: 14.5, lineHeight: 1.75, color: c.muted, margin: 0 },
    contactDivider: { height: 1, background: `linear-gradient(90deg, ${c.line} 0%, transparent 90%)`, width: "100%", margin: "2px 0" },
    contactSteps: { margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 10, color: c.muted },
    contactStepTitle: { color: c.ink, fontWeight: 600 },
    contactClosing: { fontFamily: font.body, fontStyle: "italic", fontSize: 15.5, lineHeight: 1.7, color: c.ink, margin: "6px 0 0" },
    contactSubhead: { fontFamily: font.display, fontSize: 19, letterSpacing: "0.06em", textTransform: "uppercase", color: c.gold, margin: "8px 0 6px" },

    writeToMeWrap: {
      width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 12,
      background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, padding: "22px 22px 24px", boxSizing: "border-box", textAlign: "left",
    },
    consultTeaserWrap: {
      width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
      background: c.surface, border: `1px solid ${c.line}`, borderRadius: 12, padding: "22px 22px 24px", boxSizing: "border-box", textAlign: "center",
    },
    consultTeaserText: { fontFamily: font.display, fontWeight: 500, fontSize: 16, color: c.ink, margin: 0 },
    writeToMeInCard: { maxWidth: "100%", marginTop: 10 },
    writeToMeField: { display: "flex", flexDirection: "column", gap: 6 },
    writeToMeLabel: { fontFamily: font.display, fontWeight: 500, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase", color: c.muted },
    writeToMeRequired: { color: c.bad },
    writeToMeInput: {
      fontFamily: font.body, fontSize: 15, color: c.ink, background: c.playfield, border: `1px solid ${c.line}`,
      borderRadius: 8, padding: "10px 12px", outline: "none", width: "100%", boxSizing: "border-box",
    },
    writeToMeTextarea: {
      fontFamily: font.body, fontSize: 15, color: c.ink, background: c.playfield, border: `1px solid ${c.line}`,
      borderRadius: 8, padding: "10px 12px", outline: "none", width: "100%", minHeight: 120, resize: "vertical", boxSizing: "border-box",
    },
    writeToMeError: { fontFamily: font.display, fontWeight: 500, fontSize: 13.5, color: c.bad, margin: 0 },
    writeToMeSuccess: { fontFamily: font.display, fontWeight: 500, fontSize: 13.5, color: c.good, margin: 0 },
    contactIntroRow: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 20 },
    housePortrait: { position: "relative", width: "clamp(130px, 30vw, 160px)", aspectRatio: "100 / 128", flexShrink: 0 },
    housePortraitPhoto: {
      position: "absolute", left: "8%", top: `${(42 / 128) * 100}%`, width: "84%", height: `${(84 / 128) * 100}%`,
      objectFit: "cover", objectPosition: "50% 50%", display: "block",
    },
    housePortraitFrame: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" },
    contactFirstHourWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, margin: "12px 0 4px" },
    contactFirstHour: { fontFamily: font.display, fontWeight: 500, fontSize: 24, letterSpacing: "0.03em", lineHeight: 1.3, color: c.gold, margin: 0, textAlign: "center", textWrap: "balance" },
    coffeeTable: { width: "clamp(220px, 58vw, 280px)", height: "auto", display: "block", overflow: "visible" },
    contactBubbleStack: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 10 },
    contactBubble: {
      fontFamily: font.body, fontSize: 16, lineHeight: 1.45, color: c.ink, background: "rgba(255,255,255,0.05)",
      border: `1px solid ${c.strongLine}`, borderRadius: "18px 18px 18px 4px", padding: "10px 18px", display: "inline-block",
      animation: "bubbleFloat 5.5s ease-in-out infinite",
    },
    contactIconsRow: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14, marginTop: 2 },
    contactIconLink: {
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: c.ink, textDecoration: "none",
      fontFamily: font.body, fontSize: 12.5, border: `1px solid ${c.line}`, borderRadius: 12, padding: "14px 26px",
      background: "rgba(255,255,255,0.03)", transition: "border-color 0.15s ease",
    },

    rvOuter: { width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "24px 16px 60px", background: "#050F15", borderRadius: 20 },
    rvCard: {
      width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center",
      background: "#0C202A", border: `1px solid ${c.line}`, borderRadius: 20, padding: "34px 32px",
      boxShadow: "0 18px 46px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.03)",
    },
    rvHeading: { fontFamily: font.display, fontWeight: 600, fontSize: 27, letterSpacing: "0.03em", color: c.gold, margin: "2px 0 4px" },
    rvInstruction: { fontFamily: font.body, fontWeight: 400, fontSize: 15.5, lineHeight: 1.7, color: c.ink, margin: 0, maxWidth: 420 },
    rvSubhead: { fontFamily: font.display, fontWeight: 500, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: c.muted, margin: "6px 0 0" },
    rvTargetNumber: { fontFamily: font.mono, fontWeight: 700, fontSize: 30, letterSpacing: "0.08em", color: c.goldHover, margin: "0 0 6px" },
    rvImage: { width: "100%", maxWidth: 460, borderRadius: 12, border: `1px solid ${c.line}`, display: "block" },
    rvImageFallback: {
      width: "100%", maxWidth: 460, minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center",
      textAlign: "center", padding: "24px", borderRadius: 12, border: `1px dashed ${c.line}`, background: "#08131B",
      fontFamily: font.mono, fontSize: 13, lineHeight: 1.7, color: c.muted,
    },

    // ---- RV session transcription form ----
    rvSessionWrap: { display: "flex", flexDirection: "column", gap: 20, width: "100%", maxWidth: 640 },
    rvSection: {
      background: "#0C202A", border: `1px solid ${c.line}`, borderRadius: 16, padding: "24px 26px",
      display: "flex", flexDirection: "column", gap: 14, textAlign: "left", width: "100%",
    },
    rvSectionTitle: { fontFamily: font.display, fontWeight: 600, fontSize: 18, letterSpacing: "0.03em", color: c.gold, margin: 0 },
    rvSectionSubtitle: { fontFamily: font.body, fontWeight: 400, fontSize: 14, lineHeight: 1.65, color: c.muted, margin: 0 },
    rvHiddenNote: { fontFamily: font.mono, fontSize: 12.5, color: c.muted, margin: "2px 0 0" },
    rvErrorNote: { fontFamily: font.display, fontWeight: 500, fontSize: 14, color: c.bad, margin: 0 },
    rvNotesReadout: {
      fontFamily: font.body, fontSize: 15, lineHeight: 1.7, color: c.ink, whiteSpace: "pre-wrap",
      background: "#08131B", border: `1px solid ${c.line}`, borderRadius: 8, padding: "12px 14px", margin: 0,
    },
    rvCompareGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20, width: "100%" },
    rvCompareCol: { display: "flex", flexDirection: "column", gap: 10 },

    rvFieldLabelWrap: { display: "flex", flexDirection: "column", gap: 6, width: "100%" },
    rvFieldLabel: { fontFamily: font.display, fontWeight: 500, fontSize: 11.5, letterSpacing: "0.06em", textTransform: "uppercase", color: c.muted, margin: 0 },
    rvTextarea: {
      fontFamily: font.mono, fontSize: 13.5, lineHeight: 1.6, color: c.ink, background: "#08131B",
      border: `1px solid ${c.line}`, borderRadius: 8, padding: "9px 12px", outline: "none", width: "100%", resize: "vertical",
    },

    // ---- Freehand drawing canvas ----
    canvasBlock: { display: "flex", flexDirection: "column", gap: 8, width: "100%" },
    canvasToolbar: { display: "flex", gap: 8, flexWrap: "wrap" },
    canvasToolBtn: {
      fontFamily: font.mono, fontSize: 12, letterSpacing: "0.03em", textTransform: "uppercase",
      background: "transparent", border: `1px solid ${c.line}`, color: c.muted, borderRadius: 6, padding: "6px 12px", cursor: "pointer",
    },
    canvasToolBtnActive: { background: c.gold, borderColor: c.gold, color: "#111820" },
    canvasSurfaceWrap: { width: "100%", borderRadius: 10, border: `1px dashed ${c.line}`, background: "#08131B", overflow: "hidden" },
    canvasSurface: { width: "100%", height: "100%", display: "block", cursor: "crosshair", touchAction: "none" },

    // ---- N-Back ----
    nbackWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", maxWidth: 400, margin: "0 auto", textAlign: "center" },
    nbackGrid: {
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, width: "100%", maxWidth: 320, aspectRatio: "1 / 1", marginTop: 4,
    },
    nbackCell: {
      background: c.playfield, border: `1px solid ${c.line}`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 0, outline: "none", WebkitAppearance: "none", appearance: "none",
      transition: "background 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease",
    },
    nbackCellActive: { background: c.surface, borderColor: c.gold, boxShadow: `0 0 0 2px ${c.gold}55` },
    nbackCellPressed: { borderColor: c.goldHover, boxShadow: `0 0 0 2px ${c.goldHover}88` },
    nbackCellFeedbackGood: { borderColor: c.good, boxShadow: `0 0 0 2px ${c.good}55` },
    nbackCellFeedbackBad: { borderColor: c.bad, boxShadow: `0 0 0 2px ${c.bad}55` },
    nbackCellImage: { fontSize: 34, lineHeight: 1, userSelect: "none", pointerEvents: "none" },

    // ---- Chess ----
    chessWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%", maxWidth: 560, margin: "0 auto" },
    chessTopRow: { display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" },
    chessTimerBadge: {
      fontFamily: font.mono, fontWeight: 700, fontSize: 14, letterSpacing: "0.06em", color: c.ink, background: c.panel,
      border: `1px solid ${c.line}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer",
    },
    chessTimerBadgePaused: { color: c.gold, borderColor: c.gold },
    chessStatus: { fontFamily: font.display, fontWeight: 500, fontSize: 14.5, color: c.muted, margin: 0 },
    chessCheckmateOverlay: {
      position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
      background: "rgba(6,19,27,0.82)", zIndex: 50,
    },
    chessCheckmateText: { fontFamily: font.display, fontWeight: 700, fontSize: 30, letterSpacing: "0.06em", textTransform: "uppercase", color: c.gold, margin: 0 },
    chessCheckmateSub: { fontFamily: font.mono, fontSize: 15, color: c.ink, margin: 0 },
    chessBoard: { display: "flex", flexDirection: "column", border: "2px solid #4A2E1B", borderRadius: 4, overflow: "hidden", width: "100%", maxWidth: "min(560px, max(280px, calc(100vh - 200px)))", aspectRatio: "1 / 1", touchAction: "none", position: "relative" },
    chessRow: { display: "flex", flex: 1 },
    chessSquare: {
      flex: 1, aspectRatio: "1 / 1", display: "flex", alignItems: "center", justifyContent: "center",
      border: "none", cursor: "pointer", position: "relative", outline: "none", WebkitAppearance: "none", appearance: "none", touchAction: "none",
    },
    chessSquareLight: { background: "#F0D9B5" },
    chessSquareDark: { background: "#B58863" },
    chessSquareSelected: { boxShadow: `inset 0 0 0 3px ${c.gold}` },
    chessLastMoveTint: { position: "absolute", inset: 0, background: "rgba(246, 200, 60, 0.45)", pointerEvents: "none" },
    chessCheckTint: { position: "absolute", inset: 0, background: "rgba(220, 60, 50, 0.55)", pointerEvents: "none" },
    chessPieceIconWrap: { width: "94%", height: "94%", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.4))", zIndex: 1, position: "relative" },
    chessLegalDot: { position: "absolute", width: "22%", height: "22%", borderRadius: "50%", background: "rgba(20,20,20,0.35)", pointerEvents: "none" },
    chessCoordRank: { position: "absolute", top: 2, left: 3, fontFamily: font.mono, fontSize: 10, fontWeight: 700, opacity: 0.8, pointerEvents: "none" },
    chessCoordFile: { position: "absolute", bottom: 1, right: 3, fontFamily: font.mono, fontSize: 10, fontWeight: 700, opacity: 0.8, pointerEvents: "none" },
    chessDragGhost: { position: "absolute", width: "14%", height: "14%", transform: "translate(-50%, -50%)", pointerEvents: "none", zIndex: 60, filter: "drop-shadow(0 3px 4px rgba(0,0,0,0.5))" },
  };
}
