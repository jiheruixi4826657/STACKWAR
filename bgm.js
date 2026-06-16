/**
 * bgm.js — StackWar Mode-Specific BGM Synthesizer
 * Synthesizes Jazz (free) and Boom Bap (score/auto/sprint) via Web Audio API
 * API: BGM.start(mode), BGM.stop(), BGM.setVolume(0~1)
 */
(function(global){
  'use strict';

  let ctx = null, masterGain = null;
  let _scheduler = null, _nextBeatTime = 0, _beatIndex = 0;
  let _currentMode = null, _volume = 0.55;
  let _nodes = [];   // all active nodes for cleanup
  const LOOKAHEAD = 0.1;   // seconds
  const SCHEDULE_INTERVAL = 80; // ms

  // ── Utility ────────────────────────────────────────────────────────────────
  function getCtx(){
    if(!ctx){
      ctx = new (window.AudioContext||window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = _volume;
      masterGain.connect(ctx.destination);
    }
    return ctx;
  }

  function track(node){ _nodes.push(node); return node; }

  function killAll(){
    _nodes.forEach(n=>{ try{ n.stop && n.stop(0); }catch(e){} });
    _nodes = [];
  }

  function noteFreq(note, octave){
    const map={C:0,'C#':1,D:2,'D#':3,E:4,F:5,'F#':6,G:7,'G#':8,A:9,'A#':10,B:11};
    return 440 * Math.pow(2, (map[note] + (octave-4)*12 - 9) / 12);
  }

  function osc(type, freq, startT, endT, gainVal=0.18, fadeOut=0.04){
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, startT);
    g.gain.linearRampToValueAtTime(0.0001, endT - fadeOut);
    o.connect(g); g.connect(masterGain);
    o.start(startT); o.stop(endT + 0.01);
    track(o);
  }

  function noise(startT, dur, gainVal=0.15, lpFreq=8000){
    const c = getCtx();
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const data = buf.getChannelData(0);
    for(let i=0;i<data.length;i++) data[i] = Math.random()*2-1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = lpFreq;
    const g = c.createGain();
    g.gain.setValueAtTime(gainVal, startT);
    g.gain.exponentialRampToValueAtTime(0.0001, startT + dur);
    src.connect(lp); lp.connect(g); g.connect(masterGain);
    src.start(startT); src.stop(startT + dur + 0.01);
    track(src);
  }

  // ── JAZZ (free mode) ───────────────────────────────────────────────────────
  // 120 BPM swing, chord loop: Cmaj7 → Am7 → Dm7 → G7
  const JAZZ = {
    bpm: 118,
    chords: [
      ['C','E','G','B'],    // Cmaj7
      ['A','C','E','G'],    // Am7
      ['D','F','A','C'],    // Dm7
      ['G','B','D','F'],    // G7
    ],
    bass: ['C2','E2','G2','B2', 'A1','C2','E2','G2', 'D2','F2','A2','C3', 'G1','B1','D2','F2'],
    bassOctave:[2,2,2,2, 2,2,2,2, 2,2,2,3, 2,2,2,2],
    // melody fragments (relative to root) - simple jazz lick
    melody: [
      {n:'E',o:5,dur:0.5},{n:'D',o:5,dur:0.25},{n:'C',o:5,dur:0.25},
      {n:'B',o:4,dur:0.5},{n:'G',o:4,dur:0.5},
      {n:'A',o:4,dur:0.5},{n:'C',o:5,dur:0.25},{n:'E',o:5,dur:0.25},
      {n:'D',o:5,dur:1.0},
    ],
    beatsPerChord: 4,
    totalBeats: 16,
  };

  function swingT(beat, beatDur){
    // 8th note swing: on-beat normal, off-beat delayed by 2/3 of 8th
    const b8 = beatDur / 2;
    const whole = Math.floor(beat);
    const half = beat - whole;
    return whole * beatDur + (half < 0.5 ? half * beatDur : (b8*1.33 + (half-0.5)*beatDur));
  }

  function scheduleJazz(startTime){
    const { bpm, chords, totalBeats, beatsPerChord, melody } = JAZZ;
    const beatDur = 60 / bpm;
    const loopDur = totalBeats * beatDur;

    for(let beat=0; beat < totalBeats; beat++){
      const t = startTime + beat * beatDur;
      const chordIdx = Math.floor(beat / beatsPerChord) % chords.length;
      const chord = chords[chordIdx];

      // — Brushed hi-hat (8th notes, swing) —
      for(let e=0; e<2; e++){
        const ht = t + e * beatDur * 0.5;
        const swT = swingT(beat + e*0.5, beatDur) + startTime - beat*beatDur;
        noise(swT, 0.06, e===0 ? 0.045 : 0.025, 12000);
      }

      // — Kick on beat 1 and 3 of each chord —
      const localBeat = beat % beatsPerChord;
      if(localBeat === 0 || localBeat === 2){
        kick808(t, 60, 0.25, 0.18);
      }
      // — Light snare on 2 and 4 —
      if(localBeat === 1 || localBeat === 3){
        jazzSnare(t);
      }

      // — Walking bass (one note per beat) —
      const bassNote = JAZZ.bass[beat % JAZZ.bass.length];
      const bn = bassNote.replace(/\d/,'');
      const bo = parseInt(bassNote.match(/\d/)[0]);
      osc('triangle', noteFreq(bn, bo), t, t + beatDur * 0.7, 0.28, 0.1);
      // slight harmonics for upright bass feel
      osc('sawtooth', noteFreq(bn, bo) * 2, t, t + beatDur * 0.4, 0.04, 0.08);

      // — Chord pads (comping, every 2 beats) —
      if(localBeat % 2 === 0){
        chord.forEach((n,i)=>{
          const oct = i<2 ? 4 : 5;
          osc('sine', noteFreq(n, oct), t + 0.02, t + beatDur * 1.8, 0.06 - i*0.01, 0.15);
        });
      }
    }

    // — Melody on top (runs over full loop) —
    let mt = startTime;
    melody.forEach(({n,o,dur})=>{
      osc('triangle', noteFreq(n,o), mt, mt + dur*beatDur - 0.04, 0.09, 0.06);
      // Add subtle vibrato feel via slight detune
      osc('triangle', noteFreq(n,o)*1.003, mt+0.02, mt+dur*beatDur-0.06, 0.04, 0.06);
      mt += dur * beatDur;
    });

    return loopDur;
  }

  function kick808(t, freq=55, dur=0.35, gain=0.5){
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq*3, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.04);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + dur + 0.01);
    track(o);
  }

  function jazzSnare(t){
    noise(t, 0.12, 0.07, 6000);
    // slight tone
    osc('triangle', 200, t, t+0.08, 0.04, 0.05);
  }

  // ── BOOM BAP (score / auto / sprint) ───────────────────────────────────────
  // 93 BPM, heavy kick+snare, 808 bass, chopped hi-hats
  const BOOMBAP = {
    bpm: 93,
    totalBeats: 8,
    // Bass line pattern (degrees of minor pentatonic in A)
    bassPattern: [
      {n:'A',o:2,beat:0,   dur:0.75},
      {n:'A',o:2,beat:0.75,dur:0.25},
      {n:'C',o:3,beat:1,   dur:0.5},
      {n:'A',o:2,beat:2,   dur:1.0},
      {n:'G',o:2,beat:3,   dur:0.5},
      {n:'A',o:2,beat:4,   dur:1.0},
      {n:'A',o:2,beat:5,   dur:0.5},
      {n:'E',o:2,beat:5.5, dur:0.5},
      {n:'D',o:3,beat:6,   dur:0.75},
      {n:'C',o:3,beat:6.75,dur:0.25},
      {n:'A',o:2,beat:7,   dur:1.0},
    ],
    // Kick pattern (beats)
    kicks: [0, 2.25, 4, 6.25],
    // Snare on 2 and 4 (with slight laid-back delay)
    snares: [1.02, 3.02, 5.02, 7.02],
    // Hi-hat pattern (16th-note grid, 1=open 0.5=closed 0=off)
    hats:   [1,0.5,0,0.5, 0.7,0.5,0,0.5, 1,0.5,0,0.5, 0.7,0.5,1,0.5,
             1,0.5,0,0.5, 0.7,0.5,0,0.5, 1,0.5,0,0.5, 0.5,0.5,0.7,0],
  };

  function boomBapSnare(t){
    // Layered snare: noise body + cracking tone
    noise(t, 0.18, 0.28, 7500);
    noise(t, 0.08, 0.15, 14000);
    osc('square', 180, t, t+0.06, 0.06, 0.04);
    osc('triangle', 340, t, t+0.03, 0.04, 0.02);
  }

  function boomBapHat(t, gain=1.0){
    const dur = gain > 0.8 ? 0.09 : 0.04;
    noise(t, dur, 0.08 * gain, 16000);
  }

  function bass808(t, freq, dur, gain=0.55){
    const c = getCtx();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    // 808: pitch starts high then drops
    o.frequency.setValueAtTime(freq * 2.5, t);
    o.frequency.exponentialRampToValueAtTime(freq, t + 0.035);
    o.frequency.exponentialRampToValueAtTime(freq * 0.85, t + dur * 0.8);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // Slight distortion on 808 via waveshaper
    const ws = c.createWaveShaper();
    const curve = new Float32Array(256);
    for(let i=0;i<256;i++){const x=i*2/256-1; curve[i]=x<0?-Math.pow(-x,0.8):Math.pow(x,0.8);}
    ws.curve = curve;
    o.connect(ws); ws.connect(g); g.connect(masterGain);
    o.start(t); o.stop(t + dur + 0.01);
    track(o);
  }

  function scheduleBoomBap(startTime){
    const { bpm, totalBeats, kicks, snares, hats, bassPattern } = BOOMBAP;
    const beatDur = 60 / bpm;
    const sixteenth = beatDur / 4;
    const loopDur = totalBeats * beatDur;

    // — Kicks —
    kicks.forEach(b => kick808(startTime + b * beatDur, 48, 0.55, 0.65));

    // — Snares —
    snares.forEach(b => boomBapSnare(startTime + b * beatDur));

    // — Hi-hats (16th note grid) —
    hats.forEach((g, i) => {
      if(g > 0) boomBapHat(startTime + i * sixteenth, g);
    });

    // — 808 bass line —
    bassPattern.forEach(({n, o, beat, dur}) => {
      bass808(startTime + beat * beatDur, noteFreq(n, o), dur * beatDur * 0.92);
    });

    // — Chord stabs (synth chops every 2 beats) —
    const stabChords = [
      ['A','C','E'],  // Am
      ['G','B','D'],  // G
      ['F','A','C'],  // F
      ['E','G#','B'], // E (dominant)
    ];
    [0, 2, 4, 6].forEach((beat, i) => {
      const t = startTime + beat * beatDur;
      const chord = stabChords[i % stabChords.length];
      // Short, punchy stab
      chord.forEach((n, ci) => {
        osc('sawtooth', noteFreq(n, 4), t, t + 0.18, 0.055 - ci*0.01, 0.06);
      });
    });

    return loopDur;
  }

  // ── Scheduler loop ──────────────────────────────────────────────────────────
  function scheduleLoop(){
    const c = getCtx();
    while(_nextBeatTime < c.currentTime + LOOKAHEAD){
      let loopDur = 0;
      if(_currentMode === 'jazz'){
        loopDur = scheduleJazz(_nextBeatTime);
      } else if(_currentMode === 'boombap'){
        loopDur = scheduleBoomBap(_nextBeatTime);
      }
      _nextBeatTime += loopDur || 4;
      // Safety: don't let old nodes pile up forever
      if(_nodes.length > 2000) _nodes = _nodes.slice(-500);
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  function modeToTrack(gameMode){
    if(gameMode === 'free') return 'jazz';
    if(['score','auto','sprint'].includes(gameMode)) return 'boombap';
    return null;
  }

  const BGM = {
    start(gameMode){
      const track = modeToTrack(gameMode);
      if(!track){ this.stop(); return; }
      if(_currentMode === track && _scheduler) return; // already playing
      this.stop();
      const c = getCtx();
      if(c.state === 'suspended') c.resume();
      _currentMode = track;
      _nextBeatTime = c.currentTime + 0.05;
      _beatIndex = 0;
      scheduleLoop();
      _scheduler = setInterval(()=>{ if(_currentMode) scheduleLoop(); }, SCHEDULE_INTERVAL);
    },

    stop(){
      if(_scheduler){ clearInterval(_scheduler); _scheduler = null; }
      _currentMode = null;
      killAll();
    },

    pause(){
      if(_scheduler){ clearInterval(_scheduler); _scheduler = null; }
      if(ctx && ctx.state === 'running') ctx.suspend();
    },

    resume(gameMode){
      if(!_currentMode) return this.start(gameMode);
      if(ctx && ctx.state === 'suspended'){
        ctx.resume().then(()=>{
          _nextBeatTime = ctx.currentTime + 0.05;
          scheduleLoop();
          _scheduler = setInterval(()=>{ if(_currentMode) scheduleLoop(); }, SCHEDULE_INTERVAL);
        });
      }
    },

    setVolume(v){
      _volume = Math.max(0, Math.min(1, v));
      if(masterGain) masterGain.gain.linearRampToValueAtTime(_volume, getCtx().currentTime + 0.1);
    },

    isPlaying(){ return !!_scheduler; },
  };

  global.BGM = BGM;
})(window);
