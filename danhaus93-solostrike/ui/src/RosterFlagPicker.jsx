// RosterFlagPicker.jsx — self-declared country/subdivision flag for the Pulse
// roster. Overrides flagFromLoc; broadcasts only a region code ("US"/"US-TX"),
// never coordinates. Emoji on Apple, bundled image on Windows/everything else.
import { useState, useMemo, useRef, useEffect, memo } from "react";
import {
  COUNTRIES, SUBDIVISIONS, SUB_KINDS, hasSubs, labelFor,
  supportsFlagEmoji, emojiForCode, imgPathForCode,
} from "./rosterFlags.js";

// Shared flag node: emoji on Apple, bundled image elsewhere. Exported so the
// Pulse roster can render self-declared flags the same way.
export const FlagNode = memo(function FlagNode({ code, size = 19 }) {
  const emoji = emojiForCode(code);
  if (emoji && (code === "auto" || supportsFlagEmoji()))
    return <span style={{ fontSize: size + 2, lineHeight: 1, width: 26, textAlign: "center", flex: "none" }}>{emoji}</span>;
  const src = imgPathForCode(code);
  if (src) {
    const w = Math.round(size * 4 / 3);
    // No loading="lazy": these are inline data URIs (already in memory), and
    // lazy-loading them inside the animated Pulse/WebGL subtree makes iOS
    // Safari repeatedly re-evaluate visibility and re-decode the bitmap on
    // every re-render (e.g. the per-second BEAT countdown) — visible as a
    // flicker, worst on the largest state PNGs like Missouri. Explicit
    // width/height + decoding="async" stabilise layout and decode.
    return <img alt="" decoding="async" draggable={false} width={w} height={size} src={src}
      style={{ width: w, height: size, borderRadius: 2, objectFit: "cover", flex: "none", boxShadow: "0 0 0 .5px rgba(255,255,255,.22)" }} />;
  }
  return <span style={{ fontSize: size + 2, lineHeight: 1, width: 26, textAlign: "center", flex: "none" }}>{emoji || "🌐"}</span>;
});

// value: "auto" | "US" | "US-TX"   onChange(code)   tt: translator
export default function RosterFlagPicker({ value = "auto", onChange, tt = (s) => s }) {
  const [cc, sub] = value === "auto" ? ["auto", ""] : value.split("-");
  const [openC, setOpenC] = useState(false);
  const [openS, setOpenS] = useState(false);
  const [qC, setQC] = useState("");
  const [qS, setQS] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) { setOpenC(false); setOpenS(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const countries = useMemo(() => {
    const f = qC.trim().toLowerCase();
    return COUNTRIES.filter((c) => !f || c[1].toLowerCase().includes(f) || c[0].toLowerCase().includes(f));
  }, [qC]);
  const subs = useMemo(() => {
    if (!hasSubs(cc)) return [];
    const f = qS.trim().toLowerCase();
    return SUBDIVISIONS[cc].filter((r) => !f || r[1].toLowerCase().includes(f));
  }, [cc, qS]);

  const pickCountry = (code) => { setOpenC(false); setQC(""); onChange && onChange(code === "auto" ? "auto" : code); };
  const pickSub = (s) => { setOpenS(false); setQS(""); onChange && onChange(s ? `${cc}-${s}` : cc); };
  const selLabel = value === "auto" ? tt("Auto — from map pin") : labelFor(value);

  return (
    <div ref={wrapRef} style={{ marginTop: 11 }}>
      <div style={st.flbl}>{tt("Country / region")}</div>

      <div style={st.sel} onClick={() => { setOpenC((o) => !o); setOpenS(false); setQC(""); }}>
        <FlagNode code={value === "auto" ? "auto" : cc} />
        <span style={st.nm}>{selLabel}</span><span style={st.ca}>▾</span>
      </div>
      {openC && (
        <div style={st.panel}>
          <input autoFocus value={qC} onChange={(e) => setQC(e.target.value)} placeholder={tt("Search…")} style={st.search} />
          <div style={st.list}>
            <div style={{ ...st.opt, ...(value === "auto" ? st.optSel : null) }} onClick={() => pickCountry("auto")}>
              <FlagNode code="auto" /><span style={{ ...st.nm, ...st.auto }}>{tt("Auto — from map pin")}</span>
            </div>
            {countries.map((c) => (
              <div key={c[0]} style={{ ...st.opt, ...(cc === c[0] ? st.optSel : null) }} onClick={() => pickCountry(c[0])}>
                <FlagNode code={c[0]} /><span style={st.nm}>{c[1]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasSubs(cc) && (
        <div style={{ marginTop: 11 }}>
          <div style={st.flbl}>
            <span>{tt(SUB_KINDS[cc])} ({tt("optional")})</span>
            <span style={st.badge}>{tt("real flags · bundled")}</span>
          </div>
          <div style={st.sel} onClick={() => { setOpenS((o) => !o); setOpenC(false); setQS(""); }}>
            {sub ? <FlagNode code={`${cc}-${sub}`} /> : <span style={st.chip}>◇</span>}
            <span style={{ ...st.nm, ...(sub ? null : st.auto) }}>{sub ? labelFor(value) : tt("None — show country flag")}</span>
            <span style={st.ca}>▾</span>
          </div>
          {openS && (
            <div style={st.panel}>
              <input autoFocus value={qS} onChange={(e) => setQS(e.target.value)} placeholder={tt("Search…")} style={st.search} />
              <div style={st.list}>
                <div style={st.opt} onClick={() => pickSub("")}>
                  <span style={st.chip}>◇</span><span style={{ ...st.nm, ...st.auto }}>{tt("None — show country flag")}</span>
                </div>
                {subs.map((r) => (
                  <div key={r[0]} style={{ ...st.opt, ...(sub === r[0] ? st.optSel : null) }} onClick={() => pickSub(r[0])}>
                    <FlagNode code={`${cc}-${r[0]}`} /><span style={st.nm}>{r[1]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={st.note}>
        {tt("Auto keeps today's behavior — your flag is guessed from the map pin. Pick a country for an exact flag; some unlock subdivisions. No precise location is ever shared — only the region code you choose.")}
      </div>
    </div>
  );
}

const st = {
  flbl: { fontFamily: "var(--fd)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 5, display: "flex", justifyContent: "space-between", alignItems: "center" },
  sel: { display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "11px 12px", border: "1px solid var(--border-hot, rgba(245,166,35,.4))", borderRadius: 9, background: "var(--bg-void, #060708)", color: "var(--text-1)", fontFamily: "var(--fm)", fontSize: 14, cursor: "pointer", boxSizing: "border-box" },
  chip: { width: 24, height: 18, borderRadius: 3, border: "1px solid var(--border-hot, rgba(245,166,35,.4))", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--fd)", fontSize: 9, color: "var(--amber)", flex: "none" },
  nm: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  auto: { color: "var(--text-3)", fontStyle: "italic" },
  ca: { color: "var(--text-3)" },
  panel: { marginTop: 6, border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg-void, #060708)", overflow: "hidden" },
  search: { width: "100%", padding: "10px 12px", background: "var(--bg-deep, #0b0d0f)", border: 0, borderBottom: "1px solid var(--border)", color: "var(--text-1)", fontFamily: "var(--fm)", fontSize: 13, boxSizing: "border-box", outline: "none" },
  list: { maxHeight: 220, overflow: "auto" },
  opt: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", fontSize: 13.5, borderBottom: "1px solid rgba(245,166,35,.05)" },
  optSel: { background: "rgba(0,255,209,.08)" },
  badge: { fontSize: 8.5, fontFamily: "var(--fd)", padding: "2px 6px", borderRadius: 5, letterSpacing: ".05em", textTransform: "uppercase", background: "rgba(0,255,209,.12)", color: "var(--cyan, #00FFD1)" },
  note: { fontSize: 11, color: "var(--text-3)", lineHeight: 1.55, marginTop: 9 },
};
