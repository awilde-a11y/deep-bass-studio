import { useState, useEffect, useRef, useCallback } from "react";

// ─── Tokens ────────────────────────────────────────────────────────────────
const C = {
  bg: "#0F0B05", panel: "#1A1208", card: "#201508", border: "#3A2810",
  accent: "#C8892A", gold: "#E8C87A", muted: "#6B5030", label: "#8B6A3E",
  green: "#4ADE80", kick: "#D97B4A", bass: "#C8892A",
};

const NOTES = [
  { label: "C1", midi: 36 }, { label: "D1", midi: 38 }, { label: "E1", midi: 40 },
  { label: "F1", midi: 41 }, { label: "G1", midi: 43 }, { label: "A1", midi: 45 },
  { label: "B1", midi: 47 }, { label: "C2", midi: 48 },
];
const STEPS = 16;

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

const BASS_PRESETS = {
  "Deep House Sub": { waveform: "sine", octave: -2, attack: 0.08, decay: 0.4, sustain: 0.6, release: 1.2, filterFreq: 280, filterQ: 1.2, filterEnv: 0.3, distortion: 0.08, warmth: 0.7, punch: 0.3 },
  "Afro Bass Thump": { waveform: "triangle", octave: -1, attack: 0.02, decay: 0.25, sustain: 0.4, release: 0.8, filterFreq: 420, filterQ: 2.8, filterEnv: 0.55, distortion: 0.18, warmth: 0.8, punch: 0.7 },
  "Organic Deep": { waveform: "sine", octave: -2, attack: 0.12, decay: 0.6, sustain: 0.5, release: 1.8, filterFreq: 200, filterQ: 0.8, filterEnv: 0.2, distortion: 0.04, warmth: 0.9, punch: 0.2 },
  "Wobbly Afro": { waveform: "sawtooth", octave: -1, attack: 0.04, decay: 0.3, sustain: 0.55, release: 1.0, filterFreq: 600, filterQ: 4.5, filterEnv: 0.75, distortion: 0.25, warmth: 0.6, punch: 0.5 },
  "808 Rumble": { waveform: "sine", octave: -2, attack: 0.001, decay: 0.8, sustain: 0.2, release: 2.0, filterFreq: 160, filterQ: 0.6, filterEnv: 0.15, distortion: 0.12, warmth: 0.95, punch: 0.9 },
};

const KICK_PRESETS = {
  "Afro Deep": { subFreq: 55, clickFreq: 180, pitchDrop: 38, subDecay: 0.55, clickDecay: 0.045, bodyDecay: 0.18, subLevel: 0.92, clickLevel: 0.38, bodyLevel: 0.52, distortion: 0.12, compression: 0.7 },
  "Organic Thump": { subFreq: 50, clickFreq: 140, pitchDrop: 30, subDecay: 0.65, clickDecay: 0.06, bodyDecay: 0.22, subLevel: 0.88, clickLevel: 0.28, bodyLevel: 0.62, distortion: 0.08, compression: 0.65 },
  "Club Punch": { subFreq: 60, clickFreq: 220, pitchDrop: 45, subDecay: 0.45, clickDecay: 0.035, bodyDecay: 0.14, subLevel: 0.95, clickLevel: 0.5, bodyLevel: 0.4, distortion: 0.18, compression: 0.8 },
};

// ─── WAV Encoder ──────────────────────────────────────────────────────────
function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

function downloadWAV(buffer, name) {
  const blob = new Blob([buffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ─── Offline renderer ──────────────────────────────────────────────────────
async function renderTrack(durationBars, bpm, renderFn, sampleRate = 44100) {
  const secondsPerBar = (60 / bpm) * 4;
  const totalSec = durationBars * secondsPerBar;
  const offCtx = new OfflineAudioContext(1, Math.ceil(totalSec * sampleRate), sampleRate);
  renderFn(offCtx, bpm, totalSec);
  const rendered = await offCtx.startRendering();
  return rendered.getChannelData(0);
}

// ─── Knob ────────────────────────────────────────────────────────────────
function describeArc(cx, cy, r, a1, a2) {
  const r2 = (d) => (d * Math.PI) / 180;
  const s = { x: cx + r * Math.cos(r2(a1 - 90)), y: cy + r * Math.sin(r2(a1 - 90)) };
  const e = { x: cx + r * Math.cos(r2(a2 - 90)), y: cy + r * Math.sin(r2(a2 - 90)) };
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
}

function Knob({ label, value, min, max, step = 0.01, onChange, unit = "", color = "#C8892A", size = 48 }) {
  const drag = useRef(false), startY = useRef(0), startV = useRef(0);
  const norm = (value - min) / (max - min);
  const angle = -140 + norm * 280;
  const r = size / 2 - 4;

  useEffect(() => {
    const mv = (e) => {
      if (!drag.current) return;
      const dy = startY.current - (e.touches ? e.touches[0].clientY : e.clientY);
      const newV = Math.min(max, Math.max(min, startV.current + (dy / 120) * (max - min)));
      onChange(Math.round(newV / step) * step);
    };
    const up = () => { drag.current = false; };
    window.addEventListener("mousemove", mv);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", mv, { passive: false });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", mv);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", mv);
      window.removeEventListener("touchend", up);
    };
  }, [min, max, step, onChange]);

  const down = (e) => {
    drag.current = true;
    startY.current = e.touches ? e.touches[0].clientY : e.clientY;
    startV.current = value;
    e.preventDefault();
  };

  const display = unit === "Hz" ? Math.round(value) : (step < 0.1 ? value.toFixed(2) : value.toFixed(1));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, userSelect: "none" }}>
      <div onMouseDown={down} onTouchStart={down} style={{ width: size, height: size, borderRadius: "50%", cursor: "ns-resize", position: "relative", background: "radial-gradient(circle at 35% 35%, #4A3218, #1A1208)", border: `1.5px solid #3A2810`, boxShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
        <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0 }}>
          <path d={describeArc(size / 2, size / 2, r, -140, 140)} fill="none" stroke="#2A1A08" strokeWidth="2.5" strokeLinecap="round" />
          <path d={describeArc(size / 2, size / 2, r, -140, angle)} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, boxShadow: `0 0 5px ${color}`, transform: `rotate(${angle}deg) translateY(-${r - 1}px)`, position: "absolute", top: "50%", left: "50%", marginLeft: -2.5, marginTop: -2.5 }} />
      </div>
      <div style={{ color: C.label, fontSize: 8, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ color: C.gold, fontSize: 9 }}>{display}{unit}</div>
    </div>
  );
}

// ─── Waveform Canvas ──────────────────────────────────────────────────────
function WaveDisplay({ analyserBass, analyserKick, isPlaying }) {
  const ref = useRef(null);
  const anim = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const draw = () => {
      anim.current = requestAnimationFrame(draw);
      ctx.fillStyle = C.panel;
      ctx.fillRect(0, 0, W, H);
      const drawWave = (analyser, color, yOff, hHalf) => {
        if (!analyser || !isPlaying) return;
        const buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        ctx.shadowColor = color + "80";
        const sw = W / buf.length;
        for (let i = 0; i < buf.length; i++) {
          const v = buf[i] / 128.0;
          const y = yOff + (v * hHalf);
          i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * sw, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      };
      // divider
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
      if (!isPlaying) {
        const t = Date.now() / 1400;
        [0, H / 2].forEach((yo, idx) => {
          ctx.beginPath();
          ctx.strokeStyle = idx === 0 ? C.bass + "40" : C.kick + "40";
          ctx.lineWidth = 1;
          for (let x = 0; x <= W; x++) {
            const y = yo + H / 4 + Math.sin(x / W * Math.PI * 3 + t + idx) * 6;
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        });
      }
      drawWave(analyserBass, C.bass, 0, H / 2);
      drawWave(analyserKick, C.kick, H / 2, H / 2);
      // labels
      ctx.fillStyle = C.bass + "60"; ctx.font = "8px monospace";
      ctx.fillText("BASS", 6, 12);
      ctx.fillStyle = C.kick + "60";
      ctx.fillText("KICK", 6, H / 2 + 12);
    };
    draw();
    return () => cancelAnimationFrame(anim.current);
  }, [analyserBass, analyserKick, isPlaying]);
  return <canvas ref={ref} width={700} height={90} style={{ width: "100%", height: 90, borderRadius: 8, border: `1px solid ${C.border}` }} />;
}

// ─── Step Button ──────────────────────────────────────────────────────────
function StepBtn({ active, current, onClick, color }) {
  return (
    <div onClick={onClick} style={{
      height: 34, borderRadius: 5, border: `1px solid`,
      borderColor: current ? C.green : active ? color : C.border,
      background: current ? C.green + "30" : active ? color + "30" : C.panel,
      cursor: "pointer",
      boxShadow: current ? `0 0 8px ${C.green}50` : active ? `0 0 5px ${color}30` : "none",
      transition: "all 0.07s",
    }} />
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────
export default function App() {
  const audioCtxRef = useRef(null);
  const analyserBassRef = useRef(null);
  const analyserKickRef = useRef(null);
  const bassGainNodeRef = useRef(null);  // for sidechain ducking
  const activeBassCurrent = useRef({});

  const [bpm, setBpm] = useState(122);
  const [seqPlaying, setSeqPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [isActive, setIsActive] = useState(false);
  const [exporting, setExporting] = useState(null); // null | 'kick' | 'bass' | 'both'

  const [bassParams, setBassParams] = useState(BASS_PRESETS["Deep House Sub"]);
  const [activePreset, setActivePreset] = useState("Deep House Sub");
  const [bassVol, setBassVol] = useState(0.8);
  const [kickVol, setKickVol] = useState(0.85);

  const [kickParams, setKickParams] = useState(KICK_PRESETS["Afro Deep"]);
  const [activeKickPreset, setActiveKickPreset] = useState("Afro Deep");

  const [bassSeq, setBassSeq] = useState(() =>
    Array.from({ length: STEPS }, (_, i) => ({ active: [0, 4, 8, 12].includes(i), note: 36 }))
  );
  const [kickSeq, setKickSeq] = useState(() =>
    Array.from({ length: STEPS }, (_, i) => ({ active: [0, 4, 8, 12].includes(i) }))
  );

  const [activeTab, setActiveTab] = useState("bass"); // 'bass' | 'kick'
  const [activeKeys, setActiveKeys] = useState(new Set());

  const seqRef = useRef(null);
  const stepRef = useRef(0);
  const bassSeqRef = useRef(bassSeq);
  const kickSeqRef = useRef(kickSeq);
  const bpmRef = useRef(bpm);
  const bassParamsRef = useRef(bassParams);
  const kickParamsRef = useRef(kickParams);
  const bassVolRef = useRef(bassVol);
  const kickVolRef = useRef(kickVol);

  useEffect(() => { bassSeqRef.current = bassSeq; }, [bassSeq]);
  useEffect(() => { kickSeqRef.current = kickSeq; }, [kickSeq]);
  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { bassParamsRef.current = bassParams; }, [bassParams]);
  useEffect(() => { kickParamsRef.current = kickParams; }, [kickParams]);
  useEffect(() => { bassVolRef.current = bassVol; }, [bassVol]);
  useEffect(() => { kickVolRef.current = kickVol; }, [kickVol]);

  const getCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;

      const analyserB = ctx.createAnalyser(); analyserB.fftSize = 2048;
      const analyserK = ctx.createAnalyser(); analyserK.fftSize = 2048;
      analyserBassRef.current = analyserB;
      analyserKickRef.current = analyserK;

      // Master bus
      const masterGain = ctx.createGain(); masterGain.gain.value = 0.92;
      analyserB.connect(masterGain);
      analyserK.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Sidechain gain node for bass
      const scGain = ctx.createGain(); scGain.gain.value = 1.0;
      bassGainNodeRef.current = scGain;
      scGain.connect(analyserB);
    }
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  // ─── Kick synthesis ────────────────────────────────────────────────────
  const playKick = useCallback((ctx, dest, at, kp, vol = 1) => {
    const now = at;
    // Sub oscillator: deep sine with pitch envelope (the "boom")
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(kp.subFreq * 2.5, now);
    subOsc.frequency.exponentialRampToValueAtTime(kp.subFreq, now + 0.025);
    subOsc.frequency.exponentialRampToValueAtTime(kp.pitchDrop, now + kp.subDecay);
    subGain.gain.setValueAtTime(kp.subLevel * vol, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + kp.subDecay + 0.05);

    // Click oscillator: woody transient (the "knock")
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = "triangle";
    clickOsc.frequency.setValueAtTime(kp.clickFreq * 1.4, now);
    clickOsc.frequency.exponentialRampToValueAtTime(kp.clickFreq * 0.5, now + kp.clickDecay);
    clickGain.gain.setValueAtTime(kp.clickLevel * vol, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + kp.clickDecay + 0.01);

    // Body: noise burst filtered for that djembe/tom quality
    const bufSize = Math.ceil(ctx.sampleRate * 0.08);
    const noiseBuffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const noiseNode = ctx.createBufferSource();
    noiseNode.buffer = noiseBuffer;
    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = "bandpass";
    bodyFilter.frequency.setValueAtTime(kp.clickFreq * 0.6, now);
    bodyFilter.Q.value = 2.5;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(kp.bodyLevel * vol, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + kp.bodyDecay);

    // Soft distortion for warmth
    const waveshaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 255 - 1;
      const k = kp.distortion * 50;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    waveshaper.curve = curve;

    // Compressor for glue
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 4 + kp.compression * 6;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;

    subOsc.connect(subGain);
    clickOsc.connect(clickGain);
    noiseNode.connect(bodyFilter);
    bodyFilter.connect(bodyGain);

    subGain.connect(waveshaper);
    clickGain.connect(waveshaper);
    bodyGain.connect(waveshaper);
    waveshaper.connect(comp);
    comp.connect(dest);

    subOsc.start(now); subOsc.stop(now + kp.subDecay + 0.1);
    clickOsc.start(now); clickOsc.stop(now + kp.clickDecay + 0.05);
    noiseNode.start(now); noiseNode.stop(now + kp.bodyDecay + 0.05);

    // Sidechain: duck bass when kick hits
    if (bassGainNodeRef.current && bassGainNodeRef.current.context === ctx) {
      const sc = bassGainNodeRef.current;
      sc.gain.cancelScheduledValues(now);
      sc.gain.setValueAtTime(1, now);
      sc.gain.linearRampToValueAtTime(0.25, now + 0.008);
      sc.gain.linearRampToValueAtTime(0.7, now + 0.06);
      sc.gain.linearRampToValueAtTime(1.0, now + 0.18);
    }
  }, []);

  // ─── Bass synthesis ────────────────────────────────────────────────────
  const playBass = useCallback((ctx, dest, at, midi, dur, bp, vol = 1) => {
    const freq = midiToFreq(midi + bp.octave * 12);
    const now = at;
    const osc = ctx.createOscillator();
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const ampGain = ctx.createGain();
    const waveshaper = ctx.createWaveShaper();

    osc.type = bp.waveform;
    osc.frequency.setValueAtTime(freq, now);
    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(freq / 2, now);
    subGain.gain.setValueAtTime(bp.warmth * 0.45 * vol, now);

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(bp.filterFreq + bp.filterEnv * 1800 * vol, now);
    filter.frequency.exponentialRampToValueAtTime(bp.filterFreq, now + bp.decay * 1.2);
    filter.Q.setValueAtTime(bp.filterQ, now);

    ampGain.gain.setValueAtTime(0, now);
    ampGain.gain.linearRampToValueAtTime(vol * 0.75, now + bp.attack);
    ampGain.gain.linearRampToValueAtTime(vol * bp.sustain * 0.75, now + bp.attack + bp.decay);
    const releaseAt = now + Math.max(dur, bp.attack + bp.decay + 0.01);
    ampGain.gain.setValueAtTime(vol * bp.sustain * 0.75, releaseAt);
    ampGain.gain.exponentialRampToValueAtTime(0.001, releaseAt + bp.release);

    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i * 2) / 255 - 1;
      const k = bp.distortion * 70;
      curve[i] = ((Math.PI + k) * x) / (Math.PI + k * Math.abs(x));
    }
    waveshaper.curve = curve;

    osc.connect(waveshaper);
    subOsc.connect(subGain);
    waveshaper.connect(filter);
    subGain.connect(filter);
    filter.connect(ampGain);
    ampGain.connect(dest);

    osc.start(now);
    subOsc.start(now);
    osc.stop(releaseAt + bp.release + 0.1);
    subOsc.stop(releaseAt + bp.release + 0.1);

    return { osc, subOsc, ampGain };
  }, []);

  // ─── Live keyboard ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((midi) => {
    if (activeKeys.has(midi)) return;
    setActiveKeys((p) => new Set([...p, midi]));
    const ctx = getCtx();
    const dest = bassGainNodeRef.current || analyserBassRef.current;
    const nodes = playBass(ctx, dest, ctx.currentTime, midi, 999, bassParamsRef.current, bassVolRef.current);
    activeBassCurrent.current[midi] = nodes;
    setIsActive(true);
  }, [activeKeys, getCtx, playBass]);

  const handleKeyUp = useCallback((midi) => {
    setActiveKeys((p) => { const s = new Set(p); s.delete(midi); return s; });
    const nodes = activeBassCurrent.current[midi];
    if (!nodes || !audioCtxRef.current) return;
    const now = audioCtxRef.current.currentTime;
    nodes.ampGain.gain.cancelScheduledValues(now);
    nodes.ampGain.gain.setValueAtTime(nodes.ampGain.gain.value, now);
    nodes.ampGain.gain.exponentialRampToValueAtTime(0.001, now + bassParamsRef.current.release);
    nodes.osc.stop(now + bassParamsRef.current.release + 0.1);
    nodes.subOsc.stop(now + bassParamsRef.current.release + 0.1);
    delete activeBassCurrent.current[midi];
    if (Object.keys(activeBassCurrent.current).length === 0) setIsActive(false);
  }, []);

  // ─── Sequencer ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!seqPlaying) {
      clearInterval(seqRef.current);
      setCurrentStep(-1);
      stepRef.current = 0;
      return;
    }
    const tick = () => {
      const step = stepRef.current % STEPS;
      setCurrentStep(step);
      const ctx = getCtx();
      const now = ctx.currentTime;
      const stepDur = (60 / bpmRef.current / 4);

      const ks = kickSeqRef.current[step];
      if (ks.active) {
        playKick(ctx, analyserKickRef.current, now, kickParamsRef.current, kickVolRef.current);
      }
      const bs = bassSeqRef.current[step];
      if (bs.active) {
        const dest = bassGainNodeRef.current || analyserBassRef.current;
        playBass(ctx, dest, now, bs.note, stepDur * 0.8, bassParamsRef.current, bassVolRef.current);
      }
      setIsActive(ks.active || bs.active);
      stepRef.current++;
    };
    tick();
    seqRef.current = setInterval(tick, (60 / bpm / 4) * 1000);
    return () => clearInterval(seqRef.current);
  }, [seqPlaying, bpm, getCtx, playKick, playBass]);

  // ─── WAV Export ───────────────────────────────────────────────────────
  const exportTrack = useCallback(async (which) => {
    setExporting(which);
    const bars = 2;
    const sr = 44100;
    const stepDur = (60 / bpm / 4);

    try {
      if (which === "kick" || which === "both") {
        const samples = await renderTrack(bars, bpm, (offCtx, bpm2) => {
          for (let i = 0; i < STEPS * bars; i++) {
            const s = kickSeq[i % STEPS];
            if (s.active) {
              const at = (i * (60 / bpm2 / 4));
              playKick(offCtx, offCtx.destination, at, kickParams, kickVol);
            }
          }
        }, sr);
        downloadWAV(encodeWAV(samples, sr), `kick_${bpm}bpm.wav`);
        await new Promise(r => setTimeout(r, 400));
      }
      if (which === "bass" || which === "both") {
        const samples = await renderTrack(bars, bpm, (offCtx, bpm2) => {
          for (let i = 0; i < STEPS * bars; i++) {
            const s = bassSeq[i % STEPS];
            if (s.active) {
              const at = (i * (60 / bpm2 / 4));
              playBass(offCtx, offCtx.destination, at, s.note, stepDur * 0.8, bassParams, bassVol);
            }
          }
        }, sr);
        downloadWAV(encodeWAV(samples, sr), `bass_${bpm}bpm.wav`);
      }
    } catch (e) {
      console.error(e);
    }
    setExporting(null);
  }, [bpm, kickSeq, bassSeq, kickParams, bassParams, kickVol, bassVol, playKick, playBass]);

  const setBassParam = (k) => (v) => setBassParams(p => ({ ...p, [k]: v }));
  const setKickParam = (k) => (v) => setKickParams(p => ({ ...p, [k]: v }));

  // ─── UI helpers ────────────────────────────────────────────────────────
  const card = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: "14px 16px" };
  const tabBtn = (t) => ({
    padding: "7px 20px", borderRadius: 20, border: `1px solid`,
    borderColor: activeTab === t ? (t === "bass" ? C.bass : C.kick) : C.border,
    background: activeTab === t ? (t === "bass" ? C.bass + "20" : C.kick + "20") : "transparent",
    color: activeTab === t ? (t === "bass" ? C.bass : C.kick) : C.label,
    fontSize: 11, cursor: "pointer", fontFamily: "monospace", letterSpacing: 1, transition: "all 0.15s",
  });
  const exportBtn = (which, label) => (
    <button
      onClick={() => exportTrack(which)}
      disabled={!!exporting}
      style={{
        padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.green}60`,
        background: exporting === which ? C.green + "25" : "transparent",
        color: exporting ? C.muted : C.green, fontSize: 10, cursor: exporting ? "wait" : "pointer",
        fontFamily: "monospace", letterSpacing: 0.5, transition: "all 0.15s",
        display: "flex", alignItems: "center", gap: 5,
      }}
    >
      {exporting === which ? "⏳" : "⬇"} {label}
    </button>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.gold, fontFamily: "'Courier New', monospace", padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.accent, letterSpacing: 2 }}>DEEP BASS STUDIO</div>
          <div style={{ fontSize: 8, color: C.muted, letterSpacing: 3, textTransform: "uppercase" }}>Deep House · Afro House · Warm Sub Engine</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? C.green : C.border, boxShadow: isActive ? `0 0 8px ${C.green}` : "none", transition: "all 0.15s" }} />
          {exportBtn("kick", "Kick WAV")}
          {exportBtn("bass", "Bass WAV")}
          {exportBtn("both", "Beide WAV")}
        </div>
      </div>

      {/* Waveform */}
      <WaveDisplay analyserBass={analyserBassRef.current} analyserKick={analyserKickRef.current} isPlaying={isActive} />

      {/* Transport */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button
          onClick={() => setSeqPlaying(p => !p)}
          style={{
            padding: "8px 24px", borderRadius: 20, border: `1px solid ${seqPlaying ? C.green : C.accent}`,
            background: seqPlaying ? C.green + "20" : C.accent + "20",
            color: seqPlaying ? C.green : C.accent,
            fontSize: 12, cursor: "pointer", fontFamily: "monospace", fontWeight: 700, letterSpacing: 1,
          }}
        >
          {seqPlaying ? "■  STOP" : "▶  PLAY"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: C.label, fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>BPM</span>
          <input type="range" min={80} max={160} value={bpm} onChange={e => setBpm(Number(e.target.value))} style={{ accentColor: C.accent, width: 100 }} />
          <span style={{ color: C.accent, fontSize: 14, fontWeight: 700, minWidth: 30 }}>{bpm}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
          <span style={{ color: C.label, fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>Kick Vol</span>
          <input type="range" min={0} max={1} step={0.01} value={kickVol} onChange={e => setKickVol(Number(e.target.value))} style={{ accentColor: C.kick, width: 70 }} />
          <span style={{ color: C.label, fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}>Bass Vol</span>
          <input type="range" min={0} max={1} step={0.01} value={bassVol} onChange={e => setBassVol(Number(e.target.value))} style={{ accentColor: C.bass, width: 70 }} />
        </div>
      </div>

      {/* Sequencer */}
      <div style={card}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
          <div style={{ color: C.muted, fontSize: 8, textTransform: "uppercase", letterSpacing: 3 }}>
            Step Sequencer — 16 Steps / 2 Bars
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setKickSeq(prev => prev.map((s, i) => ({ ...s, active: [0, 4, 8, 12].includes(i) })))} style={{ fontSize: 9, color: C.kick, background: "none", border: `1px solid ${C.kick}40`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "monospace" }}>4-on-floor</button>
            <button onClick={() => setBassSeq(prev => prev.map((s, i) => ({ ...s, active: [0, 6, 10].includes(i) })))} style={{ fontSize: 9, color: C.bass, background: "none", border: `1px solid ${C.bass}40`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "monospace" }}>Afro Groove</button>
            <button onClick={() => { setKickSeq(prev => prev.map(s => ({ ...s, active: false }))); setBassSeq(prev => prev.map(s => ({ ...s, active: false }))); }} style={{ fontSize: 9, color: C.muted, background: "none", border: `1px solid ${C.border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer", fontFamily: "monospace" }}>Clear</button>
          </div>
        </div>

        {/* Beat numbers top */}
        <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 6, marginBottom: 4 }}>
          <div />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 5 }}>
            {[1,2,3,4,5,6,7,8].map(n => (
              <div key={n} style={{ textAlign: "center", fontSize: 8, color: [1,3,5,7].includes(n) ? C.accent : C.muted, fontFamily: "monospace" }}>{n}</div>
            ))}
          </div>
        </div>

        {/* ── Row renderer: splits 16 steps into two rows of 8 ── */}
        {[
          { label: "KICK", color: C.kick, seq: kickSeq, setSeq: setKickSeq, isKick: true },
          { label: "BASS", color: C.bass, seq: bassSeq, setSeq: setBassSeq, isKick: false },
        ].map(({ label, color, seq, setSeq, isKick }) => (
          <div key={label} style={{ marginBottom: isKick ? 14 : 0 }}>
            {/* Row A: steps 1–8 */}
            <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <div style={{ color, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, textAlign: "center",
                background: color + "18", border: `1px solid ${color}40`, borderRadius: 6, padding: "3px 0" }}>
                {label}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 5 }}>
                {seq.slice(0, 8).map((s, i) => (
                  <div key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {!isKick && (
                      <select value={s.note}
                        onChange={e => setSeq(prev => prev.map((x, j) => j === i ? { ...x, note: Number(e.target.value) } : x))}
                        style={{ background: C.panel, border: `1px solid ${s.active ? color + "60" : C.border}`, color: s.active ? C.gold : C.muted, fontSize: 8, borderRadius: 4, padding: "1px 2px", fontFamily: "monospace", width: "100%" }}>
                        {NOTES.map(n => <option key={n.midi} value={n.midi}>{n.label}</option>)}
                      </select>
                    )}
                    <div onClick={() => setSeq(prev => prev.map((x, j) => j === i ? { ...x, active: !x.active } : x))}
                      style={{
                        height: isKick ? 44 : 38, borderRadius: 6, border: `1.5px solid`,
                        borderColor: currentStep === i ? C.green : s.active ? color : C.border,
                        background: currentStep === i ? C.green + "35" : s.active ? color + "35" : C.panel,
                        cursor: "pointer",
                        boxShadow: currentStep === i ? `0 0 10px ${C.green}50` : s.active ? `0 0 6px ${color}30` : "none",
                        transition: "all 0.07s",
                        position: "relative",
                      }}>
                      {/* Beat accent marker */}
                      {[0, 2, 4, 6].includes(i) && (
                        <div style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: s.active ? color : C.border + "80" }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Row B: steps 9–16 */}
            <div style={{ display: "grid", gridTemplateColumns: "44px 1fr", gap: 6, alignItems: "center" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 7, color: C.muted, fontFamily: "monospace" }}>9–16</div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 5 }}>
                {seq.slice(8, 16).map((s, i) => {
                  const globalI = i + 8;
                  return (
                    <div key={globalI} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {!isKick && (
                        <select value={s.note}
                          onChange={e => setSeq(prev => prev.map((x, j) => j === globalI ? { ...x, note: Number(e.target.value) } : x))}
                          style={{ background: C.panel, border: `1px solid ${s.active ? color + "60" : C.border}`, color: s.active ? C.gold : C.muted, fontSize: 8, borderRadius: 4, padding: "1px 2px", fontFamily: "monospace", width: "100%" }}>
                          {NOTES.map(n => <option key={n.midi} value={n.midi}>{n.label}</option>)}
                        </select>
                      )}
                      <div onClick={() => setSeq(prev => prev.map((x, j) => j === globalI ? { ...x, active: !x.active } : x))}
                        style={{
                          height: isKick ? 44 : 38, borderRadius: 6, border: `1.5px solid`,
                          borderColor: currentStep === globalI ? C.green : s.active ? color : C.border,
                          background: currentStep === globalI ? C.green + "35" : s.active ? color + "35" : C.panel,
                          cursor: "pointer",
                          boxShadow: currentStep === globalI ? `0 0 10px ${C.green}50` : s.active ? `0 0 6px ${color}30` : "none",
                          transition: "all 0.07s",
                          position: "relative",
                        }}>
                        {[0, 2, 4, 6].includes(i) && (
                          <div style={{ position: "absolute", bottom: 3, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: s.active ? color : C.border + "80" }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs: Bass / Kick params */}
      <div style={{ display: "flex", gap: 8 }}>
        <button style={tabBtn("bass")} onClick={() => setActiveTab("bass")}>🎸 Bass</button>
        <button style={tabBtn("kick")} onClick={() => setActiveTab("kick")}>🥁 Kick</button>
      </div>

      {activeTab === "bass" && (
        <>
          {/* Bass presets */}
          <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: C.muted, fontSize: 8, textTransform: "uppercase", letterSpacing: 2, marginRight: 4 }}>Preset</span>
            {Object.keys(BASS_PRESETS).map(n => (
              <button key={n} onClick={() => { setActivePreset(n); setBassParams(BASS_PRESETS[n]); }}
                style={{ padding: "5px 12px", borderRadius: 16, border: `1px solid`, borderColor: activePreset === n ? C.bass : C.border, background: activePreset === n ? C.bass + "20" : "transparent", color: activePreset === n ? C.bass : C.label, fontSize: 10, cursor: "pointer", fontFamily: "monospace", transition: "all 0.12s" }}>
                {n}
              </button>
            ))}
          </div>

          {/* Bass controls */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={card}>
              <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>Oscillator</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {["sine", "triangle", "sawtooth", "square"].map(w => (
                  <button key={w} onClick={() => setBassParam("waveform")(w)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid`, borderColor: bassParams.waveform === w ? C.bass : C.border, background: bassParams.waveform === w ? C.bass + "25" : "transparent", color: bassParams.waveform === w ? C.bass : C.label, fontSize: 9, cursor: "pointer", fontFamily: "monospace" }}>
                    {w}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
                <span style={{ color: C.label, fontSize: 8 }}>OCT</span>
                {[-3, -2, -1, 0].map(o => (
                  <button key={o} onClick={() => setBassParam("octave")(o)}
                    style={{ width: 28, height: 28, borderRadius: 5, border: `1px solid`, borderColor: bassParams.octave === o ? C.bass : C.border, background: bassParams.octave === o ? C.bass + "25" : "transparent", color: bassParams.octave === o ? C.bass : C.label, fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}>
                    {o}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                <Knob label="Warmth" value={bassParams.warmth} min={0} max={1} onChange={setBassParam("warmth")} color={C.bass} size={44} />
                <Knob label="Punch" value={bassParams.punch} min={0} max={1} onChange={setBassParam("punch")} color="#E8642A" size={44} />
                <Knob label="Drive" value={bassParams.distortion} min={0} max={0.5} onChange={setBassParam("distortion")} color={C.label} size={44} />
              </div>
            </div>
            <div style={card}>
              <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>Filter · Envelope</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <Knob label="Cutoff" value={bassParams.filterFreq} min={60} max={3000} step={1} onChange={setBassParam("filterFreq")} unit="Hz" color={C.bass} size={44} />
                <Knob label="Reso" value={bassParams.filterQ} min={0.1} max={12} onChange={setBassParam("filterQ")} color={C.gold} size={44} />
                <Knob label="Env" value={bassParams.filterEnv} min={0} max={1} onChange={setBassParam("filterEnv")} color="#6B8B3E" size={44} />
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <Knob label="Attack" value={bassParams.attack} min={0.001} max={1} onChange={setBassParam("attack")} color={C.bass} size={44} />
                <Knob label="Decay" value={bassParams.decay} min={0.05} max={2} onChange={setBassParam("decay")} color={C.bass} size={44} />
                <Knob label="Release" value={bassParams.release} min={0.05} max={4} onChange={setBassParam("release")} color={C.bass} size={44} />
              </div>
            </div>
          </div>

          {/* Keyboard */}
          <div style={{ ...card }}>
            <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>Live Keyboard</div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
              {NOTES.map(({ label: nl, midi }) => (
                <button key={midi}
                  onMouseDown={() => handleKeyDown(midi)} onMouseUp={() => handleKeyUp(midi)}
                  onMouseLeave={() => { if (activeKeys.has(midi)) handleKeyUp(midi); }}
                  onTouchStart={e => { e.preventDefault(); handleKeyDown(midi); }}
                  onTouchEnd={e => { e.preventDefault(); handleKeyUp(midi); }}
                  style={{
                    width: 48, height: 70, borderRadius: 7, border: `2px solid`,
                    borderColor: activeKeys.has(midi) ? C.bass : C.border,
                    background: activeKeys.has(midi) ? `linear-gradient(180deg, ${C.bass}, #A06820)` : `linear-gradient(180deg, #2D1F0A, #1A1208)`,
                    color: activeKeys.has(midi) ? "#1A1208" : C.label,
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "monospace",
                    transform: activeKeys.has(midi) ? "translateY(2px)" : "none",
                    transition: "all 0.06s", userSelect: "none",
                  }}>
                  {nl}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === "kick" && (
        <>
          {/* Kick presets */}
          <div style={{ ...card, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: C.muted, fontSize: 8, textTransform: "uppercase", letterSpacing: 2, marginRight: 4 }}>Preset</span>
            {Object.keys(KICK_PRESETS).map(n => (
              <button key={n} onClick={() => { setActiveKickPreset(n); setKickParams(KICK_PRESETS[n]); }}
                style={{ padding: "5px 12px", borderRadius: 16, border: `1px solid`, borderColor: activeKickPreset === n ? C.kick : C.border, background: activeKickPreset === n ? C.kick + "20" : "transparent", color: activeKickPreset === n ? C.kick : C.label, fontSize: 10, cursor: "pointer", fontFamily: "monospace", transition: "all 0.12s" }}>
                {n}
              </button>
            ))}
            {/* Test kick button */}
            <button onClick={() => { const ctx = getCtx(); playKick(ctx, analyserKickRef.current, ctx.currentTime, kickParams, kickVol); setIsActive(true); setTimeout(() => setIsActive(false), 800); }}
              style={{ marginLeft: "auto", padding: "5px 14px", borderRadius: 16, border: `1px solid ${C.kick}`, background: C.kick + "15", color: C.kick, fontSize: 10, cursor: "pointer", fontFamily: "monospace" }}>
              ▶ Test
            </button>
          </div>

          {/* Kick controls */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={card}>
              <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>Sub Boom (45–65 Hz)</div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <Knob label="Freq" value={kickParams.subFreq} min={35} max={80} step={0.5} onChange={setKickParam("subFreq")} unit="Hz" color={C.kick} size={44} />
                <Knob label="Drop To" value={kickParams.pitchDrop} min={20} max={60} step={0.5} onChange={setKickParam("pitchDrop")} unit="Hz" color="#A0602A" size={44} />
                <Knob label="Decay" value={kickParams.subDecay} min={0.15} max={1.2} onChange={setKickParam("subDecay")} color={C.kick} size={44} />
                <Knob label="Level" value={kickParams.subLevel} min={0} max={1} onChange={setKickParam("subLevel")} color={C.kick} size={44} />
              </div>
            </div>
            <div style={card}>
              <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>Click · Woody Body</div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
                <Knob label="Click Freq" value={kickParams.clickFreq} min={80} max={400} step={1} onChange={setKickParam("clickFreq")} unit="Hz" color={C.gold} size={44} />
                <Knob label="Click Decay" value={kickParams.clickDecay} min={0.01} max={0.12} onChange={setKickParam("clickDecay")} color={C.gold} size={44} />
                <Knob label="Body" value={kickParams.bodyLevel} min={0} max={1} onChange={setKickParam("bodyLevel")} color="#8B6A3E" size={44} />
                <Knob label="Body Decay" value={kickParams.bodyDecay} min={0.05} max={0.5} onChange={setKickParam("bodyDecay")} color="#8B6A3E" size={44} />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div style={card}>
              <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", marginBottom: 12 }}>Charakter</div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center" }}>
                <Knob label="Warmth/Drive" value={kickParams.distortion} min={0} max={0.35} onChange={setKickParam("distortion")} color="#D97B4A" size={44} />
                <Knob label="Compression" value={kickParams.compression} min={0} max={1} onChange={setKickParam("compression")} color="#7A5A8A" size={44} />
                <Knob label="Click Level" value={kickParams.clickLevel} min={0} max={1} onChange={setKickParam("clickLevel")} color={C.gold} size={44} />
              </div>
            </div>
            <div style={{ ...card, display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
              <div style={{ color: C.muted, fontSize: 8, letterSpacing: 3, textTransform: "uppercase" }}>Sidechain</div>
              <div style={{ color: C.label, fontSize: 10, lineHeight: 1.5 }}>
                Automatisches Sidechain-Ducking aktiv: Wenn die Kick schlägt, weicht der Bass für ~180 ms zurück. Das sorgt für den typischen pumpenden Deep-House-Groove.
              </div>
              <div style={{ width: "100%", height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${C.kick}, ${C.bass})`, opacity: 0.4 }} />
            </div>
          </div>
        </>
      )}

      <div style={{ textAlign: "center", color: C.border, fontSize: 8, letterSpacing: 3, paddingBottom: 8 }}>
        DEEP BASS STUDIO v2 · KICK + BASS + EXPORT · WEB AUDIO API
      </div>
    </div>
  );
}
