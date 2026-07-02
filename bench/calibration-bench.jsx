/* Port shim: React and Recharts are loaded as UMD globals (see index.html),
   so the original ES-module imports become destructures off those globals.
   Nothing else in the component changed. */
const { useState, useEffect, useMemo, useCallback } = React;
const {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Scatter,
} = Recharts;

/* ────────────────────────────────────────────────────────────
   CALIBRATION BENCH v2 — metacognition trainer
   Three item types, chosen per item:
   · FACT       — prompt → answer, binary-ish grading
   · CONCEPT    — explain from memory, graded vs key ideas
   · PROCEDURE  — ordered steps, graded step-by-step
   Loop: predict (delayed JOL) → free recall → strict grade →
   dual-needle gauge → reflection → spaced reschedule with
   an overconfidence penalty.
   ──────────────────────────────────────────────────────────── */

const T = {
  bg: "#14181C",
  panel: "#1E252B",
  panelUp: "#242D34",
  etch: "#37424B",
  dial: "#E9E4D6",
  dialInk: "#23201A",
  brass: "#C9963F",
  needle: "#D64541",
  green: "#4E9B6E",
  blue: "#5B8DB8",
  text: "#D8DCE0",
  muted: "#8A939B",
  mono: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
  sans: "'IBM Plex Sans', system-ui, sans-serif",
};

const STORAGE_KEY = "calbench-v1";
const DAY = 86400000;

const TYPES = {
  fact:      { label: "FACT",      color: T.blue,   unit: "answer",    plural: "answer" },
  concept:   { label: "CONCEPT",   color: T.green,  unit: "key idea",  plural: "key ideas" },
  procedure: { label: "PROCEDURE", color: T.brass,  unit: "step",      plural: "steps" },
};

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/* ── scheduling: spacing + overconfidence penalty ── */
function nextInterval(prevDays, accuracy, confidence) {
  const gap = confidence - accuracy * 100;
  let next;
  if (accuracy >= 0.85) next = Math.max(prevDays * 2.2, 2);
  else if (accuracy >= 0.6) next = Math.max(prevDays * 1.3, 1.5);
  else next = 1;
  if (gap > 20) next = Math.max(1, next * 0.6); // overconfident → sooner
  return Math.round(next * 10) / 10;
}

/* ── storage ── */
async function loadData() {
  try {
    const r = await window.storage.get(STORAGE_KEY);
    if (r && r.value) {
      const d = JSON.parse(r.value);
      // migrate v1 items (no type field) → procedure; legacy tag becomes subject
      d.skills = (d.skills || []).map((s) => {
        const m = { type: "procedure", tag: "", discipline: "", subject: "", ...s };
        if (!m.subject && m.tag) m.subject = m.tag;
        return m;
      });
      return d;
    }
  } catch (e) { /* first run */ }
  return { skills: [] };
}
async function saveData(data) {
  try { await window.storage.set(STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { console.error("save failed", e); }
}

const allAttempts = (skills) =>
  skills.flatMap((s) => s.attempts.map((a) => ({ ...a, skillName: s.name, type: s.type })));

/* ════════════════ GAUGE (signature element) ════════════════ */
function Gauge({ confidence, accuracy, size = 300, label }) {
  const cx = size / 2, cy = size * 0.54, r = size * 0.40;
  const ang = (v) => (-180 + (v / 100) * 180) * (Math.PI / 180);
  const pt = (v, rad) => [cx + rad * Math.cos(ang(v)), cy + rad * Math.sin(ang(v))];

  const ticks = [];
  for (let v = 0; v <= 100; v += 5) {
    const major = v % 25 === 0;
    const [x1, y1] = pt(v, r - (major ? 14 : 8));
    const [x2, y2] = pt(v, r - 2);
    ticks.push(
      <line key={v} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={T.dialInk} strokeWidth={major ? 2 : 1} opacity={major ? 0.9 : 0.45} />
    );
    if (major) {
      const [tx, ty] = pt(v, r - 26);
      ticks.push(
        <text key={"t" + v} x={tx} y={ty + 4} textAnchor="middle"
          fontSize={size * 0.038} fill={T.dialInk} fontFamily={T.mono}>{v}</text>
      );
    }
  }

  const needle = (v, color, len, w) => {
    const [x2, y2] = pt(v, r * len);
    return (
      <g style={{ transition: "all 700ms cubic-bezier(.2,.8,.3,1)" }}>
        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeLinecap="round" />
      </g>
    );
  };

  let wedge = null;
  if (accuracy != null) {
    const a1 = Math.min(confidence, accuracy * 100), a2 = Math.max(confidence, accuracy * 100);
    if (a2 - a1 > 0.5) {
      const steps = 24, pts = [];
      for (let i = 0; i <= steps; i++) {
        const v = a1 + ((a2 - a1) * i) / steps;
        pts.push(pt(v, r * 0.62).join(","));
      }
      wedge = <polygon points={`${cx},${cy} ${pts.join(" ")}`} fill={T.needle} opacity={0.14} />;
    }
  }

  return (
    <svg width={size} height={size * 0.66} viewBox={`0 0 ${size} ${size * 0.66}`} role="img"
      aria-label={label || "calibration gauge"}>
      <path d={`M ${pt(0, r + 8)[0]} ${pt(0, r + 8)[1]} A ${r + 8} ${r + 8} 0 0 1 ${pt(100, r + 8)[0]} ${pt(100, r + 8)[1]} L ${pt(100, 0)[0]} ${cy + 14} L ${cx - r - 8} ${cy + 14} Z`}
        fill={T.dial} stroke={T.etch} strokeWidth={2} />
      {ticks}
      {wedge}
      {needle(confidence, T.brass, 0.86, 3.5)}
      {accuracy != null && needle(accuracy * 100, T.needle, 0.7, 2.5)}
      <circle cx={cx} cy={cy} r={7} fill={T.dialInk} />
      <circle cx={cx} cy={cy} r={3} fill={T.brass} />
      <text x={cx} y={cy - r * 0.42} textAnchor="middle" fontSize={size * 0.036}
        fill={T.dialInk} fontFamily={T.mono} letterSpacing="0.15em">
        {accuracy == null ? "PREDICTED" : "PREDICTED vs ACTUAL"}
      </text>
    </svg>
  );
}

/* ════════════════ SHARED UI ════════════════ */
const Btn = ({ children, onClick, primary, danger, disabled, small }) => (
  <button onClick={onClick} disabled={disabled} style={{
    fontFamily: T.mono, fontSize: small ? 12 : 14, letterSpacing: "0.08em",
    padding: small ? "6px 12px" : "10px 20px", cursor: disabled ? "default" : "pointer",
    background: primary ? T.brass : "transparent",
    color: primary ? "#1a1408" : danger ? T.needle : T.text,
    border: `1.5px solid ${primary ? T.brass : danger ? T.needle : T.etch}`,
    borderRadius: 3, opacity: disabled ? 0.4 : 1, textTransform: "uppercase",
  }}>{children}</button>
);

const Panel = ({ children, style }) => (
  <div style={{ background: T.panel, border: `1px solid ${T.etch}`, borderRadius: 4, padding: 20, ...style }}>
    {children}
  </div>
);

const Eyebrow = ({ children }) => (
  <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.2em", color: T.brass, textTransform: "uppercase", marginBottom: 8 }}>
    {children}
  </div>
);

const TypeBadge = ({ type }) => {
  const t = TYPES[type] || TYPES.procedure;
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 10, letterSpacing: "0.15em", color: t.color,
      border: `1px solid ${t.color}`, borderRadius: 2, padding: "2px 6px", marginRight: 8,
    }}>{t.label}</span>
  );
};

/* ════════════════ ADD / EDIT ITEM ════════════════ */
function SkillForm({ initial, onSave, onCancel, skills }) {
  const [type, setType] = useState(initial?.type || "concept");
  const [name, setName] = useState(initial?.name || "");
  const [cue, setCue] = useState(initial?.cue || "");
  const [discipline, setDiscipline] = useState(initial?.discipline || "");
  const [subject, setSubject] = useState(initial?.subject || initial?.tag || "");
  const [stepsText, setStepsText] = useState(initial ? initial.steps.join("\n") : "");
  const steps = type === "fact"
    ? (stepsText.trim() ? [stepsText.trim()] : [])
    : stepsText.split("\n").map((s) => s.trim()).filter(Boolean);

  const input = {
    width: "100%", background: T.bg, color: T.text, border: `1px solid ${T.etch}`,
    borderRadius: 3, padding: "10px 12px", fontFamily: T.sans, fontSize: 14, boxSizing: "border-box",
  };
  const valid = name.trim() && (type === "fact" ? steps.length === 1 : steps.length >= (type === "procedure" ? 2 : 1));

  const hints = {
    fact: {
      nameLabel: "PROMPT — the question you'll see",
      namePh: "e.g., What are the day-VFR fuel requirements?",
      bodyLabel: "ANSWER",
      bodyPh: "Enough fuel to reach the first point of intended landing, plus 30 minutes at normal cruise.",
      note: "Best for regs, V-speeds, frequencies, definitions, light signals.",
    },
    concept: {
      nameLabel: "CONCEPT NAME — what you'll be asked to explain",
      namePh: "e.g., How carburetor icing forms and when to expect it",
      bodyLabel: "KEY IDEAS — one per line (order doesn't matter)",
      bodyPh: "Fuel vaporization + pressure drop in venturi cools air up to 40\u00B0F\nCan occur well above freezing \u2014 danger zone ~20\u201370\u00B0F with high humidity\nFirst sign (fixed-pitch): drop in RPM\nCarb heat melts ice \u2014 expect roughness as it ingests water\u2026",
      note: "Best for aerodynamics, weather theory, airspace logic, systems.",
    },
    procedure: {
      nameLabel: "PROCEDURE NAME",
      namePh: "e.g., Engine failure en route \u2014 emergency approach flow",
      bodyLabel: "REFERENCE STEPS — one per line, in order",
      bodyPh: "Establish best glide speed\nPick a field \u2014 plan the approach\nRestart flow: fuel selector, mixture, carb heat, mags\u2026",
      note: "Best for flows, checklists, maneuver sequences, lost procedures.",
    },
  }[type];

  return (
    <Panel>
      <Eyebrow>{initial ? "Edit item" : "New item"}</Eyebrow>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>TYPE</label>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {Object.entries(TYPES).map(([k, t]) => (
              <button key={k} onClick={() => setType(k)} style={{
                fontFamily: T.mono, fontSize: 12, letterSpacing: "0.1em", padding: "8px 14px",
                cursor: "pointer", borderRadius: 3,
                background: type === k ? "rgba(255,255,255,0.05)" : "transparent",
                color: type === k ? t.color : T.muted,
                border: `1.5px solid ${type === k ? t.color : T.etch}`,
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>{hints.note}</div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>{hints.nameLabel}</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={hints.namePh} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>DISCIPLINE</label>
            <input style={input} value={discipline} onChange={(e) => setDiscipline(e.target.value)}
              list="cb-disciplines" placeholder="e.g., Aviation" />
            <datalist id="cb-disciplines">
              {[...new Set((skills || []).map((s) => s.discipline).filter(Boolean))].sort().map((d) => <option key={d} value={d} />)}
            </datalist>
          </div>
          <div>
            <label style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>SUBJECT</label>
            <input style={input} value={subject} onChange={(e) => setSubject(e.target.value)}
              list="cb-subjects" placeholder="e.g., FAA Regulations" />
            <datalist id="cb-subjects">
              {[...new Set((skills || [])
                .filter((s) => !discipline.trim() || (s.discipline || "") === discipline.trim())
                .map((s) => s.subject).filter(Boolean))].sort().map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
        </div>
        <div>
          <label style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>CONTEXT CUE (optional)</label>
          <input style={input} value={cue} onChange={(e) => setCue(e.target.value)}
            placeholder="When or why this matters — shown before you predict" />
        </div>
        <div>
          <label style={{ fontSize: 12, color: T.muted, fontFamily: T.mono }}>
            {hints.bodyLabel}{type !== "fact" ? ` (${steps.length})` : ""}
          </label>
          <textarea style={{ ...input, minHeight: type === "fact" ? 90 : 180, resize: "vertical" }} value={stepsText}
            onChange={(e) => setStepsText(e.target.value)} placeholder={hints.bodyPh} />
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            Write this in your own words while the material is fresh — building the reference is itself a first retrieval rep.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn primary disabled={!valid} onClick={() => onSave({ type, name: name.trim(), cue: cue.trim(), discipline: discipline.trim(), subject: subject.trim(), tag: subject.trim(), steps })}>
            Save item
          </Btn>
          <Btn onClick={onCancel}>Cancel</Btn>
        </div>
      </div>
    </Panel>
  );
}

/* ════════════════ DRILL (the core loop) ════════════════ */
function Drill({ skill, onComplete, onExit }) {
  const type = skill.type || "procedure";
  const [phase, setPhase] = useState("predict");
  const [confidence, setConfidence] = useState(50);
  const [recall, setRecall] = useState("");
  const [checked, setChecked] = useState([]);
  const [factScore, setFactScore] = useState(null);
  const [reflection, setReflection] = useState("");
  const [startTs] = useState(Date.now());

  const accuracy = type === "fact"
    ? (factScore == null ? 0 : factScore)
    : checked.filter(Boolean).length / skill.steps.length;

  const wording = {
    fact: {
      predict: "Without looking anything up: how likely are you to recall this correctly right now?",
      recall: "Type the answer from memory. Be as complete and precise as the real answer needs to be.",
      gradeHint: "Grade against the exact reference — on the knowledge test, \u201Cclose\u201D is a wrong answer.",
    },
    concept: {
      predict: "Without looking anything up: what fraction of the key ideas could you explain right now?",
      recall: "Explain this from memory as if teaching it to another student pilot. Cover the why, not just the what.",
      gradeHint: "Check an idea only if your explanation actually contained it — not if you \u201Cwould have said it.\u201D",
    },
    procedure: {
      predict: "Without looking anything up: if you had to execute every step right now, what fraction would you get right?",
      recall: "Type every step from memory, in order. Include details — settings, speeds, checks. Don't stop at the gist.",
      gradeHint: "Grade strictly. \u201CI basically had it\u201D is the fluency illusion talking.",
    },
  }[type];

  const finish = () => {
    const attempt = {
      ts: Date.now(), confidence, accuracy,
      gap: Math.round(confidence - accuracy * 100),
      recall, reflection: reflection.trim(),
      missed: type === "fact"
        ? (accuracy >= 1 ? [] : [0])
        : skill.steps.map((_, i) => i).filter((i) => !checked[i]),
      secs: Math.round((Date.now() - startTs) / 1000),
    };
    onComplete(attempt);
  };

  const gap = Math.round(confidence - accuracy * 100);
  const verdict = phase !== "result" ? null
    : Math.abs(gap) <= 10 ? { txt: "WELL CALIBRATED", c: T.green }
    : gap > 10 ? { txt: `OVERCONFIDENT BY ${gap} PTS`, c: T.needle }
    : { txt: `UNDERCONFIDENT BY ${-gap} PTS`, c: T.brass };

  const boxStyle = {
    width: "100%", boxSizing: "border-box", background: T.bg, color: T.text,
    border: `1px solid ${T.etch}`, borderRadius: 3, padding: 12,
    fontFamily: T.sans, fontSize: 14, resize: "vertical",
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <Eyebrow>Drill · {phase}</Eyebrow>
          <div style={{ fontSize: 22, fontWeight: 600 }}>
            <TypeBadge type={type} />{skill.name}
          </div>
          {skill.cue && <div style={{ color: T.muted, fontSize: 13, marginTop: 2 }}>{skill.cue}</div>}
        </div>
        <Btn small onClick={onExit}>Exit</Btn>
      </div>

      {phase === "predict" && (
        <Panel>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, marginBottom: 4 }}>{wording.predict}</div>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 12 }}>
              Answer from what you can retrieve, not from how familiar it feels.
            </div>
            <Gauge confidence={confidence} accuracy={null} />
            <div style={{ fontFamily: T.mono, fontSize: 34, color: T.brass, margin: "4px 0 10px" }}>
              {confidence}%
            </div>
            <input type="range" min={0} max={100} step={5} value={confidence}
              onChange={(e) => setConfidence(+e.target.value)}
              style={{ width: "70%", accentColor: T.brass }}
              aria-label="confidence prediction" />
            <div style={{ marginTop: 18 }}>
              <Btn primary onClick={() => setPhase("recall")}>Lock prediction → recall</Btn>
            </div>
          </div>
        </Panel>
      )}

      {phase === "recall" && (
        <Panel>
          <div style={{ fontSize: 15, marginBottom: 10 }}>{wording.recall}</div>
          <textarea value={recall} onChange={(e) => setRecall(e.target.value)} autoFocus
            style={{ ...boxStyle, minHeight: type === "fact" ? 100 : 220 }}
            placeholder={type === "procedure" ? "1. \u2026" : "\u2026"} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: T.muted }}>
              Struggling is the point — effortful retrieval is what strengthens the memory.
            </div>
            <Btn primary disabled={recall.trim().length < 2}
              onClick={() => { setChecked(new Array(skill.steps.length).fill(false)); setPhase("grade"); }}>
              Reveal reference
            </Btn>
          </div>
        </Panel>
      )}

      {phase === "grade" && type === "fact" && (
        <Panel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div>
              <Eyebrow>Your answer</Eyebrow>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{recall}</div>
            </div>
            <div>
              <Eyebrow>Reference</Eyebrow>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: T.text }}>{skill.steps[0]}</div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginBottom: 10 }}>{wording.gradeHint}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={() => { setFactScore(1); setPhase("result"); }}>✓ Correct</Btn>
            <Btn onClick={() => { setFactScore(0.5); setPhase("result"); }}>~ Partial</Btn>
            <Btn danger onClick={() => { setFactScore(0); setPhase("result"); }}>✗ Missed</Btn>
          </div>
        </Panel>
      )}

      {phase === "grade" && type !== "fact" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Panel>
            <Eyebrow>Your recall</Eyebrow>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, color: T.text }}>{recall}</div>
          </Panel>
          <Panel>
            <Eyebrow>
              {type === "procedure" ? "Reference — check each step you fully got" : "Key ideas — check each one your explanation covered"}
            </Eyebrow>
            <div style={{ display: "grid", gap: 8 }}>
              {skill.steps.map((s, i) => (
                <label key={i} style={{
                  display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                  padding: "8px 10px", borderRadius: 3,
                  background: checked[i] ? "rgba(78,155,110,0.12)" : T.bg,
                  border: `1px solid ${checked[i] ? T.green : T.etch}`,
                }}>
                  <input type="checkbox" checked={!!checked[i]}
                    onChange={() => setChecked((c) => c.map((v, j) => (j === i ? !v : v)))}
                    style={{ marginTop: 3, accentColor: T.green }} />
                  <span style={{ fontSize: 14 }}>
                    {type === "procedure" && (
                      <span style={{ fontFamily: T.mono, color: T.muted, marginRight: 8 }}>{i + 1}</span>
                    )}
                    {s}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontFamily: T.mono, fontSize: 13, color: T.muted }}>
                {checked.filter(Boolean).length}/{skill.steps.length} · {Math.round(accuracy * 100)}%
              </span>
              <Btn primary onClick={() => setPhase("result")}>Read the gauge</Btn>
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>{wording.gradeHint}</div>
          </Panel>
        </div>
      )}

      {phase === "result" && (
        <Panel>
          <div style={{ textAlign: "center" }}>
            <Gauge confidence={confidence} accuracy={accuracy} size={340} />
            <div style={{ display: "flex", justifyContent: "center", gap: 28, fontFamily: T.mono, fontSize: 13, marginTop: 6 }}>
              <span style={{ color: T.brass }}>▮ predicted {confidence}%</span>
              <span style={{ color: T.needle }}>▮ actual {Math.round(accuracy * 100)}%</span>
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 18, letterSpacing: "0.12em", color: verdict.c, margin: "14px 0 4px" }}>
              {verdict.txt}
            </div>
          </div>
          <div style={{ maxWidth: 560, margin: "16px auto 0" }}>
            <label style={{ fontSize: 13, color: T.muted }}>
              {gap > 10
                ? "What made this feel more known than it was? Name what specifically evaporated."
                : gap < -10
                ? "You knew more than you trusted. What signal were you discounting?"
                : "Anything that almost slipped? Note it while it's hot."}
            </label>
            <textarea value={reflection} onChange={(e) => setReflection(e.target.value)}
              style={{ ...boxStyle, minHeight: 70, marginTop: 6 }} />
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <Btn primary onClick={finish}>Log attempt & schedule review</Btn>
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* ════════════════ CHARTS ════════════════ */
function CalibrationCurve({ attempts }) {
  const data = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ lo: i * 10, pts: [] }));
    attempts.forEach((a) => {
      const b = Math.min(9, Math.floor(a.confidence / 10));
      buckets[b].pts.push(a.accuracy * 100);
    });
    return buckets
      .filter((b) => b.pts.length)
      .map((b) => ({
        conf: b.lo + 5,
        actual: Math.round(b.pts.reduce((s, v) => s + v, 0) / b.pts.length),
        n: b.pts.length,
      }));
  }, [attempts]);

  if (attempts.length < 3)
    return <div style={{ color: T.muted, fontSize: 13, padding: 20 }}>
      Run at least 3 drills and your calibration curve will draw itself here.
    </div>;

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: -10 }}>
        <CartesianGrid stroke={T.etch} strokeDasharray="2 4" />
        <XAxis dataKey="conf" domain={[0, 100]} type="number" ticks={[0, 25, 50, 75, 100]}
          stroke={T.muted} fontSize={11} label={{ value: "predicted %", position: "insideBottom", offset: -2, fill: T.muted, fontSize: 11 }} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} stroke={T.muted} fontSize={11} />
        <Tooltip contentStyle={{ background: T.panelUp, border: `1px solid ${T.etch}`, fontFamily: T.mono, fontSize: 12 }}
          formatter={(v, k) => [v + "%", k === "actual" ? "actual" : k]} labelFormatter={(v) => `predicted ~${v}%`} />
        <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke={T.green} strokeDasharray="4 4"
          label={{ value: "perfect calibration", fill: T.green, fontSize: 10, position: "insideTopLeft" }} />
        <Line dataKey="actual" stroke={T.brass} strokeWidth={2} dot={{ fill: T.brass, r: 4 }} />
        <Scatter dataKey="actual" fill={T.brass} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function TrendChart({ attempts }) {
  const data = useMemo(() => {
    const byWeek = {};
    attempts.forEach((a) => {
      const d = new Date(a.ts); const day = d.getDay();
      const wk = new Date(d); wk.setDate(d.getDate() - day); wk.setHours(0, 0, 0, 0);
      const k = wk.getTime();
      (byWeek[k] = byWeek[k] || []).push(Math.abs(a.gap));
    });
    return Object.entries(byWeek)
      .sort(([a], [b]) => a - b)
      .map(([k, gaps]) => ({
        week: fmtDate(+k),
        avgMiss: Math.round(gaps.reduce((s, v) => s + v, 0) / gaps.length),
      }));
  }, [attempts]);

  if (data.length < 2)
    return <div style={{ color: T.muted, fontSize: 13, padding: 20 }}>
      After a couple of weeks of drills, your average miss will trend here. Down and to the right is the goal.
    </div>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: -10 }}>
        <CartesianGrid stroke={T.etch} strokeDasharray="2 4" />
        <XAxis dataKey="week" stroke={T.muted} fontSize={11} />
        <YAxis stroke={T.muted} fontSize={11} label={{ value: "avg miss (pts)", angle: -90, position: "insideLeft", fill: T.muted, fontSize: 10 }} />
        <Tooltip contentStyle={{ background: T.panelUp, border: `1px solid ${T.etch}`, fontFamily: T.mono, fontSize: 12 }} />
        <Line dataKey="avgMiss" stroke={T.needle} strokeWidth={2} dot={{ fill: T.needle, r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ════════════════ APP ════════════════ */
function CalibrationBench() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("bench");
  const [activeSkill, setActiveSkill] = useState(null);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ discipline: "", subject: "" });

  useEffect(() => { loadData().then(setData); }, []);
  const persist = useCallback((next) => { setData(next); saveData(next); }, []);

  if (!data)
    return (
      <div style={{ minHeight: "100vh", background: T.bg, color: T.muted, display: "flex",
        alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontSize: 13, letterSpacing: "0.15em" }}>
        ZEROING INSTRUMENT…
      </div>
    );

  const skills = data.skills;
  const attempts = allAttempts(skills).sort((a, b) => a.ts - b.ts);
  const inScope = (s) =>
    (!filter.discipline || (s.discipline || "") === filter.discipline) &&
    (!filter.subject || (s.subject || "") === filter.subject);
  const due = skills.filter((s) => inScope(s) && (!s.due || s.due <= Date.now()));
  const recent = attempts.slice(-12);
  const bias = recent.length ? Math.round(recent.reduce((s, a) => s + a.gap, 0) / recent.length) : null;
  const avgMiss = recent.length ? Math.round(recent.reduce((s, a) => s + Math.abs(a.gap), 0) / recent.length) : null;

  const addSkill = (fields) => {
    persist({ ...data, skills: [...skills, { id: uid(), ...fields, created: Date.now(), intervalDays: 1, due: today(), attempts: [] }] });
    setView("bench");
  };
  const updateSkill = (fields) => {
    persist({ ...data, skills: skills.map((s) => (s.id === editing.id ? { ...s, ...fields } : s)) });
    setEditing(null); setView("library");
  };
  const deleteSkill = (id) => {
    if (!window.confirm("Delete this item and its history?")) return;
    persist({ ...data, skills: skills.filter((s) => s.id !== id) });
  };
  const completeDrill = (attempt) => {
    const s = activeSkill;
    const interval = nextInterval(s.intervalDays || 1, attempt.accuracy, attempt.confidence);
    persist({
      ...data,
      skills: skills.map((k) => k.id === s.id
        ? { ...k, attempts: [...k.attempts, attempt], intervalDays: interval, due: today() + interval * DAY }
        : k),
    });
    setActiveSkill(null); setView("bench");
  };

  const Tab = ({ id, children }) => (
    <button onClick={() => setView(id)} style={{
      fontFamily: T.mono, fontSize: 12, letterSpacing: "0.15em", textTransform: "uppercase",
      background: "none", border: "none", cursor: "pointer", padding: "6px 2px",
      color: view === id ? T.brass : T.muted,
      borderBottom: `2px solid ${view === id ? T.brass : "transparent"}`,
    }}>{children}</button>
  );

  const unitLine = (s) => {
    const t = s.type || "procedure";
    return t === "fact" ? "fact" : `${s.steps.length} ${TYPES[t].plural}`;
  };

  // library grouped by tag (plain computation — no hook, since this sits below an early return)
  const groups = (() => {
    const g = {};
    skills.forEach((s) => {
      const k = ((s.discipline || "").trim() || "General") + " · " + ((s.subject || s.tag || "").trim() || "Uncategorized");
      (g[k] = g[k] || []).push(s);
    });
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  })();

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: T.sans }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;600&display=swap');
        * { transition-duration: 200ms; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
        button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.brass}; outline-offset: 2px; }
        input[type=range] { height: 4px; }
        .cb-home { font-family: ${T.mono}; font-size: 12px; letter-spacing: 0.08em; color: ${T.text};
          text-decoration: none; border: 1.5px solid ${T.etch}; border-radius: 3px; padding: 6px 12px; margin-left: 6px; }
        .cb-home:hover { border-color: ${T.brass}; color: ${T.brass}; }
        @media (max-width: 640px) { .cb-home { display: none; } }
      `}</style>

      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end",
          borderBottom: `1px solid ${T.etch}`, paddingBottom: 14, marginBottom: 22 }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 20, letterSpacing: "0.22em" }}>
              CALIBRATION<span style={{ color: T.brass }}> BENCH</span>
            </div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
              predict · recall · grade · read the gauge
            </div>
          </div>
          <nav style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <Tab id="bench">Bench</Tab>
            <Tab id="library">Library ({skills.length})</Tab>
            <Tab id="add">+ New</Tab>
            <a className="cb-home" href="https://mattbreckenridge.com">&larr; mattbreckenridge.com</a>
          </nav>
        </div>

        {view === "add" && <SkillForm skills={skills} onSave={addSkill} onCancel={() => setView("bench")} />}
        {view === "edit" && editing && <SkillForm skills={skills} initial={editing} onSave={updateSkill} onCancel={() => { setEditing(null); setView("library"); }} />}

        {view === "drill" && activeSkill && (
          <Drill skill={activeSkill} onComplete={completeDrill}
            onExit={() => { setActiveSkill(null); setView("bench"); }} />
        )}

        {view === "bench" && (
          <div style={{ display: "grid", gap: 16 }}>
            {(() => {
              const disciplineOpts = [...new Set(skills.map((s) => s.discipline).filter(Boolean))].sort();
              const subjectOpts = [...new Set(skills
                .filter((s) => !filter.discipline || (s.discipline || "") === filter.discipline)
                .map((s) => s.subject).filter(Boolean))].sort();
              if (!disciplineOpts.length && !subjectOpts.length) return null;
              const sel = { fontFamily: T.mono, fontSize: 12, letterSpacing: "0.05em", background: T.bg,
                color: T.text, border: `1px solid ${T.etch}`, borderRadius: 3, padding: "8px 10px" };
              return (
                <Panel style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.2em", color: T.brass, textTransform: "uppercase" }}>
                    Session scope
                  </span>
                  <select style={sel} value={filter.discipline} aria-label="filter by discipline"
                    onChange={(e) => setFilter({ discipline: e.target.value, subject: "" })}>
                    <option value="">All disciplines</option>
                    {disciplineOpts.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select style={sel} value={filter.subject} aria-label="filter by subject"
                    onChange={(e) => setFilter({ ...filter, subject: e.target.value })}>
                    <option value="">All subjects</option>
                    {subjectOpts.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  {(filter.discipline || filter.subject) && (
                    <Btn small onClick={() => setFilter({ discipline: "", subject: "" })}>Clear</Btn>
                  )}
                </Panel>
              );
            })()}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              <Panel style={{ textAlign: "center" }}>
                <div style={{ fontFamily: T.mono, fontSize: 30, color: due.length ? T.needle : T.green }}>{due.length}</div>
                <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>DUE NOW</div>
              </Panel>
              <Panel style={{ textAlign: "center" }}>
                <div style={{ fontFamily: T.mono, fontSize: 30, color: avgMiss == null ? T.muted : avgMiss <= 10 ? T.green : T.brass }}>
                  {avgMiss == null ? "—" : avgMiss}
                </div>
                <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>AVG MISS · LAST 12</div>
              </Panel>
              <Panel style={{ textAlign: "center" }}>
                <div style={{ fontFamily: T.mono, fontSize: 30, color: bias == null ? T.muted : bias > 5 ? T.needle : bias < -5 ? T.brass : T.green }}>
                  {bias == null ? "—" : (bias > 0 ? "+" : "") + bias}
                </div>
                <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: "0.12em" }}>
                  BIAS {bias == null ? "" : bias > 5 ? "· OVERCONFIDENT" : bias < -5 ? "· UNDERCONFIDENT" : "· CENTERED"}
                </div>
              </Panel>
            </div>

            <Panel>
              <Eyebrow>Review queue</Eyebrow>
              {skills.length === 0 && (
                <div style={{ color: T.muted, fontSize: 14 }}>
                  Nothing on the bench yet. Add your first item — a fact worth memorizing cold, a concept worth
                  explaining, or a procedure worth executing blind.
                  <div style={{ marginTop: 12 }}><Btn primary onClick={() => setView("add")}>Add an item</Btn></div>
                </div>
              )}
              {skills.length > 0 && due.length === 0 && (
                <div style={{ color: T.muted, fontSize: 14 }}>
                  Nothing due. That's the spacing working — reviewing now would feel productive but teach less.
                  Next up: {(() => { const pool = skills.filter(inScope); const n = [...(pool.length ? pool : skills)].sort((a, b) => a.due - b.due)[0]; return `${n.name} on ${fmtDate(n.due)}`; })()}
                </div>
              )}
              <div style={{ display: "grid", gap: 8 }}>
                {due.map((s) => (
                  <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: T.bg, border: `1px solid ${T.etch}`, borderRadius: 3, padding: "10px 14px" }}>
                    <div>
                      <div style={{ fontSize: 15 }}><TypeBadge type={s.type} />{s.name}</div>
                      <div style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
                        {(s.discipline || s.subject) ? [s.discipline, s.subject || s.tag].filter(Boolean).join(" / ") + " · " : (s.tag ? s.tag + " · " : "")}{unitLine(s)} · {s.attempts.length === 0 ? "never drilled" :
                          `last: ${Math.round(s.attempts[s.attempts.length - 1].accuracy * 100)}% (predicted ${s.attempts[s.attempts.length - 1].confidence}%)`}
                      </div>
                    </div>
                    <Btn primary small onClick={() => { setActiveSkill(s); setView("drill"); }}>Drill</Btn>
                  </div>
                ))}
              </div>
            </Panel>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <Panel>
                <Eyebrow>Calibration curve</Eyebrow>
                <CalibrationCurve attempts={attempts} />
              </Panel>
              <Panel>
                <Eyebrow>Average miss by week</Eyebrow>
                <TrendChart attempts={attempts} />
              </Panel>
            </div>
          </div>
        )}

        {view === "library" && (
          <div style={{ display: "grid", gap: 18 }}>
            {skills.length === 0 && (
              <Panel><div style={{ color: T.muted }}>Library is empty. <Btn small primary onClick={() => setView("add")}>Add an item</Btn></div></Panel>
            )}
            {groups.map(([tag, items]) => (
              <div key={tag}>
                <div style={{ fontFamily: T.mono, fontSize: 12, letterSpacing: "0.18em", color: T.muted,
                  textTransform: "uppercase", margin: "0 0 8px 2px" }}>{tag} · {items.length}</div>
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((s) => {
                    const last = s.attempts[s.attempts.length - 1];
                    return (
                      <Panel key={s.id}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 600 }}><TypeBadge type={s.type} />{s.name}</div>
                            <div style={{ fontSize: 12, color: T.muted, fontFamily: T.mono, marginTop: 4 }}>
                              {unitLine(s)} · {s.attempts.length} drills · next {fmtDate(s.due)} · interval {s.intervalDays}d
                              {last && ` · last gap ${last.gap > 0 ? "+" : ""}${last.gap}`}
                            </div>
                            {last && last.reflection && (
                              <div style={{ fontSize: 13, color: T.muted, marginTop: 6, fontStyle: "italic" }}>
                                "{last.reflection}"
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                            <Btn small onClick={() => { setActiveSkill(s); setView("drill"); }}>Drill now</Btn>
                            <Btn small onClick={() => { setEditing(s); setView("edit"); }}>Edit</Btn>
                            <Btn small danger onClick={() => deleteSkill(s.id)}>Delete</Btn>
                          </div>
                        </div>
                      </Panel>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── mount (added for the static port; runs in this script's scope so the
   `T` design tokens above are guaranteed initialized before first render) ── */
ReactDOM.createRoot(document.getElementById("root")).render(<CalibrationBench />);
