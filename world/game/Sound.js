/* Sound.js — every sound in the world is made here with WebAudio, from oscillators and noise. No sound files, so
   nothing to license. The context starts on the first key or tap (browsers require a gesture). M toggles mute; the
   choice is kept in localStorage on this device only.
   One-shots: step, jump, land, coin (rising with a streak), talk blips (one voice per person), pop, hit, honk,
   brick clonk, chime, the opening reveal. Loops: truck engine, jet engine, wind. */
import { Game } from '../engine/Game.js'

const KEY = 'world-sound'

export class Sound
{
    constructor()
    {
        this.game = Game.getInstance()
        this.muted = localStorage.getItem(KEY) === 'off'
        this.ctx = null
        this.streak = { n: 0, t: 0 }
        this.last = {}
        const start = () => this.start()
        addEventListener('pointerdown', start, { once: false, capture: true })
        addEventListener('keydown', start, { once: false, capture: true })
        addEventListener('keydown', e => { if(e.code === 'KeyM' && !e.repeat && !/input|textarea/i.test(e.target.tagName)) this.toggle() })
        this.game.ticker.events.on('tick', () => this.update(), 9.5)
    }

    start()
    {
        if(this.ctx) { if(this.ctx.state === 'suspended') this.ctx.resume(); return }
        const AC = window.AudioContext || window.webkitAudioContext; if(!AC) return
        const c = this.ctx = new AC()
        this.out = c.createDynamicsCompressor(); this.out.threshold.value = - 14; this.out.ratio.value = 4
        this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8
        this.out.connect(this.master).connect(c.destination)
        // one second of white noise, reused by every noisy sound
        this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate)
        const d = this.noise.getChannelData(0); for(let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
        this.setLoops()
        this.game.hud && this.game.hud.sound(this.muted)
    }

    toggle()
    {
        this.muted = !this.muted
        localStorage.setItem(KEY, this.muted ? 'off' : 'on')
        if(this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05)
        this.game.hud && this.game.hud.sound(this.muted)
    }

    get ok() { return this.ctx && this.ctx.state === 'running' && !this.muted }
    // rate limit per sound name
    gate(name, ms) { const n = performance.now(); if(n - (this.last[name] || 0) < ms) return false; this.last[name] = n; return true }

    // ---------------------------------------------------------------- building blocks
    env(gain, t, a, peak, d)
    {
        gain.gain.setValueAtTime(0.0001, t)
        gain.gain.exponentialRampToValueAtTime(peak, t + a)
        gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
    }

    tone({ type = 'sine', f0 = 440, f1 = f0, a = 0.005, d = 0.15, peak = 0.3, delay = 0, pan = 0, dest = this.out })
    {
        const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain()
        o.type = type; o.frequency.setValueAtTime(f0, t); if(f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d)
        this.env(g, t, a, peak, d)
        let node = o.connect(g)
        if(pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; node = node.connect(p) }
        node.connect(dest)
        o.start(t); o.stop(t + a + d + 0.05)
    }

    burst({ type = 'lowpass', f0 = 800, f1 = f0, q = 1, a = 0.003, d = 0.12, peak = 0.3, delay = 0, rate = 1 })
    {
        const c = this.ctx, t = c.currentTime + delay, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain()
        s.buffer = this.noise; s.playbackRate.value = rate; s.loop = true
        f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); if(f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + a + d)
        this.env(g, t, a, peak, d)
        s.connect(f).connect(g).connect(this.out)
        s.start(t, Math.random() * 0.8); s.stop(t + a + d + 0.05)
    }

    // ---------------------------------------------------------------- one-shots
    step(run)
    {
        if(!this.ok) return
        const r = 0.85 + Math.random() * 0.3
        this.burst({ type: 'bandpass', f0: 1400 * r, f1: 500 * r, q: 0.9, d: run ? 0.07 : 0.06, peak: run ? 0.11 : 0.07 })
        this.tone({ type: 'sine', f0: 120 * r, f1: 70, d: 0.05, peak: 0.08 })
    }
    jump() { if(!this.ok) return; this.tone({ type: 'triangle', f0: 260, f1: 620, a: 0.005, d: 0.16, peak: 0.16 }); this.burst({ type: 'highpass', f0: 2000, d: 0.08, peak: 0.05 }) }
    land(k = 0.5)
    {
        if(!this.ok) return
        this.tone({ type: 'sine', f0: 140, f1: 45, d: 0.18 + k * 0.1, peak: 0.15 + k * 0.25 })
        this.burst({ type: 'lowpass', f0: 900, f1: 200, d: 0.15 + k * 0.1, peak: 0.08 + k * 0.15 })
    }
    coin()
    {
        if(!this.ok) return
        const now = performance.now()
        this.streak.n = now - this.streak.t < 2500 ? Math.min(this.streak.n + 1, 12) : 0; this.streak.t = now
        const base = 988 * Math.pow(2, this.streak.n / 12)
        this.tone({ type: 'square', f0: base, d: 0.07, peak: 0.07 })
        this.tone({ type: 'square', f0: base * 1.335, d: 0.28, peak: 0.07, delay: 0.07 })
        this.tone({ type: 'sine', f0: base * 2, d: 0.3, peak: 0.05, delay: 0.07 })
    }
    // a talking blip: each person has a voice (base pitch); vowels go a little higher
    blip(voice = 1, ch = 'a')
    {
        if(!this.ok || !this.gate('blip', 45)) return
        const vowel = /[aeiouy]/i.test(ch), f = 210 * voice * (vowel ? 1.18 : 1) * (0.94 + Math.random() * 0.12)
        this.tone({ type: 'triangle', f0: f, f1: f * 0.92, a: 0.004, d: 0.05, peak: 0.09 })
    }
    pop(up = true) { if(!this.ok) return; this.tone({ type: 'sine', f0: up ? 420 : 700, f1: up ? 900 : 300, a: 0.004, d: 0.09, peak: 0.14 }) }
    tick() { if(!this.ok || !this.gate('tick', 60)) return; this.tone({ type: 'sine', f0: 1500, f1: 1200, a: 0.002, d: 0.03, peak: 0.04 }) }
    hit(k = 0.5)
    {
        if(!this.ok || !this.gate('hit', 90)) return
        this.tone({ type: 'sine', f0: 110, f1: 40, d: 0.2 + k * 0.2, peak: 0.12 + k * 0.3 })
        this.burst({ type: 'lowpass', f0: 2400, f1: 300, d: 0.12 + k * 0.15, peak: 0.08 + k * 0.25 })
    }
    clonk(k = 0.5)
    {
        if(!this.ok || !this.gate('clonk', 35)) return
        const f = 300 + Math.random() * 180
        this.tone({ type: 'square', f0: f, f1: f * 0.6, d: 0.06, peak: 0.03 + k * 0.06 })
        this.burst({ type: 'bandpass', f0: 1800, q: 2, d: 0.05, peak: 0.05 + k * 0.1 })
    }
    honk() { if(!this.ok || !this.gate('honk', 250)) return; for(const f of [ 392, 494 ]) this.tone({ type: 'sawtooth', f0: f, a: 0.01, d: 0.32, peak: 0.06 }) }
    // a short rising arpeggio for milestones
    chime() { if(!this.ok) return; [ 523, 659, 784, 1047 ].forEach((f, i) => this.tone({ type: 'triangle', f0: f, d: 0.35, peak: 0.1, delay: i * 0.08 })) }
    // a course gate: two rising notes, higher as the lap goes on
    ring(k = 0) { if(!this.ok) return; const f = 523 * Math.pow(2, k); this.tone({ type: 'triangle', f0: f, d: 0.18, peak: 0.12 }); this.tone({ type: 'triangle', f0: f * 1.5, d: 0.3, peak: 0.1, delay: 0.07 }) }
    // start lights: a low beep per red lamp, a high one for green
    beep(go = false) { if(!this.ok) return; this.tone({ type: 'square', f0: go ? 880 : 440, a: 0.004, d: go ? 0.4 : 0.16, peak: 0.07 }) }
    // afterburner light: a low thump and a rush
    boost() { if(!this.ok) return; this.tone({ type: 'sine', f0: 120, f1: 45, d: 0.4, peak: 0.3 }); this.burst({ type: 'bandpass', f0: 200, f1: 1600, q: 0.8, a: 0.05, d: 0.6, peak: 0.18 }) }
    // the opening: a long rising rush as the ring sweeps out, a soft chord as the island arrives, a low swell under it
    reveal()
    {
        if(!this.ok) return
        this.burst({ type: 'bandpass', f0: 180, f1: 3400, q: 0.7, a: 1.1, d: 1.1, peak: 0.16 })
        this.tone({ type: 'sine', f0: 55, f1: 110, a: 1.2, d: 1, peak: 0.16 })
        ;[ 392, 587, 784, 1175 ].forEach((f, i) => this.tone({ type: 'triangle', f0: f, a: 0.02, d: 1.8, peak: 0.055, delay: 1.25 + i * 0.07 }))
    }
    whoosh() { if(!this.ok) return; this.burst({ type: 'bandpass', f0: 300, f1: 2400, q: 1.2, a: 0.12, d: 0.35, peak: 0.12 }) }
    boom() { if(!this.ok) return; this.tone({ type: 'sine', f0: 90, f1: 28, d: 0.9, peak: 0.5 }); this.burst({ type: 'lowpass', f0: 1800, f1: 120, a: 0.005, d: 0.9, peak: 0.45 }) }

    // ---------------------------------------------------------------- loops
    setLoops()
    {
        const c = this.ctx
        const loop = (filterType, f, q) =>
        {
            const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain()
            s.buffer = this.noise; s.loop = true; fl.type = filterType; fl.frequency.value = f; fl.Q.value = q; g.gain.value = 0
            s.connect(fl).connect(g).connect(this.out); s.start()
            return { src: s, filter: fl, gain: g }
        }
        // truck: two detuned saws through a lowpass, plus a rumble of filtered noise
        const tg = c.createGain(), tf = c.createBiquadFilter(); tg.gain.value = 0; tf.type = 'lowpass'; tf.frequency.value = 400; tf.Q.value = 3
        const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 50; o2.frequency.value = 25.3
        o1.connect(tf); o2.connect(tf); tf.connect(tg).connect(this.out); o1.start(); o2.start()
        this.truck = { gain: tg, filter: tf, o1, o2 }
        // jet: a bandpassed roar and a thin whine
        this.jet = loop('bandpass', 500, 0.6)
        const wo = c.createOscillator(), wg = c.createGain(); wo.type = 'sine'; wo.frequency.value = 1800; wg.gain.value = 0; wo.connect(wg).connect(this.out); wo.start()
        this.jet.whine = { osc: wo, gain: wg }
        // wind, always there, louder with speed
        this.wind = loop('lowpass', 380, 0.4)
    }

    update()
    {
        if(!this.ctx || !this.truck) return
        const g = this.game, t = this.ctx.currentTime, set = (p, v, k = 0.08) => p.setTargetAtTime(v, t, k)
        const drive = g.mode === 'drive', fly = g.mode === 'fly'
        // truck
        const v = g.physicalVehicle, acc = Math.abs(g.player.accelerating || 0), boost = g.player.boosting || 0
        const rev = Math.min(1, (v.speed || 0) / 14) * 0.7 + acc * 0.3 + boost * 0.2
        set(this.truck.gain.gain, drive ? 0.05 + rev * 0.07 : 0, 0.15)
        set(this.truck.o1.frequency, 48 + rev * 70); set(this.truck.o2.frequency, 24.3 + rev * 35)
        set(this.truck.filter.frequency, 280 + rev * 900)
        // jet
        const s = g.jet.state, thr = fly ? s.thr + (g.inputs.actions.get('boost').active ? 0.5 : 0) : 0
        set(this.jet.gain.gain, fly ? 0.05 + thr * 0.16 : 0, 0.2); set(this.jet.filter.frequency, 380 + thr * 1400 + s.v * 6)
        set(this.jet.whine.gain.gain, fly ? 0.006 + thr * 0.01 : 0, 0.2); set(this.jet.whine.osc.frequency, 1500 + thr * 1500)
        // wind: a whisper on foot, a rush in the jet
        const speed = fly ? s.v : drive ? v.speed || 0 : (g.walker.speed || 0)
        set(this.wind.gain.gain, 0.012 + Math.min(1, speed / 60) * (fly ? 0.12 : 0.05), 0.4)
        set(this.wind.filter.frequency, 300 + Math.min(1, speed / 60) * 900, 0.4)
        // honk (folio-2025's Player has the H action; its own horn sound is a stub)
        if(drive && g.inputs.actions.get('honk').active) this.honk()
    }
}
