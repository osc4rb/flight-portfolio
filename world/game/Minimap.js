/* Minimap.js — a round map in the top right corner that moves with you, Fortnite-style. It reuses Map.js's drawing
   of the island. Places you have found carry a diamond and their name; one not found yet is only a faint circle
   somewhere near it. As you close in on a hidden place (or on the next gate of a lap), a ring pulses out from the
   centre with a soft ping, faster the closer you are. A click opens the M map. */
import { Game } from '../engine/Game.js'

const SIZE = 168                // px drawn (CSS may show it smaller)
const SPAN = 120                // m across the minimap
const CUE = 70                  // m: the pulse starts this close to a hidden place
const CUE_GATE = 140            // m: and this close to the next gate in a lap
const AREA = 28                 // m: the radius of a hidden place's faint circle

export class Minimap
{
    constructor()
    {
        const g = this.game = Game.getInstance()
        this.el = document.createElement('button')
        this.el.type = 'button'; this.el.className = 'h-mini'
        this.el.title = ((g.site.world || {}).nav || {}).mapTitle || ''
        this.el.innerHTML = `<canvas width="${SIZE}" height="${SIZE}"></canvas><i class="mm-you"></i>`
        document.getElementById('hud').appendChild(this.el)
        this.canvas = this.el.querySelector('canvas')
        this.ctx = this.canvas.getContext('2d')
        this.you = this.el.querySelector('.mm-you')
        this.el.addEventListener('click', () => g.map && g.map.show())
        this.pulse = { t: 0, on: false }
        this.last = 0
        g.ticker.events.on('tick', () => this.update(), 14.5)
    }

    found(p) { this.flash = { p, t: 0 } }

    // a fixed offset per place so its circle never sits exactly on it
    jitter(p) { let h = 0; for(const c of p.id) h = h * 31 + c.charCodeAt(0) | 0; const a = (h % 628) / 100; return { x: Math.cos(a) * AREA * 0.45, z: Math.sin(a) * AREA * 0.45 } }

    update()
    {
        const g = this.game, map = g.map
        const hide = g.reveal.active || (g.room && g.room.state !== 'off') || g.desk.state !== 'idle' || (map && map.open)
            || !!document.querySelector('.h-help:not([hidden]),.h-achbox:not([hidden]),.h-unlock.on,.h-result:not([hidden])')   // they open in the same corner
        this.el.hidden = !!hide
        if(hide || !map) return
        if(!map.drawn) { map.draw(); map.drawn = true }
        const dt = g.ticker.delta || 0.016
        const me = g.modes.activePosition()

        // the cue: the nearest hidden place, or the next gate while flying a lap
        let cue = null
        const n = g.places.nearestHidden()
        if(n && n.d < CUE) cue = { k: 1 - n.d / CUE, color: '255,255,255' }
        const c = g.course
        if(g.mode === 'fly' && c && c.gates && c.gates.length)
        {
            const gate = c.gates[c.next], d = gate.c.distanceTo(me)
            if(d < CUE_GATE) { const k = 1 - d / CUE_GATE; if(!cue || k > cue.k) cue = { k, color: '242,201,76' } }
        }
        if(cue)
        {
            const period = 1.6 - cue.k * 1.25                         // 1.6 s far out, 0.35 s on top of it
            this.pulse.t += dt / period
            if(this.pulse.t >= 1 || !this.pulse.on)
            {
                this.pulse.t = this.pulse.on ? this.pulse.t % 1 : 0; this.pulse.on = true
                g.sound && g.sound.tone({ type: 'sine', f0: 520 + cue.k * 500, d: 0.09, peak: 0.035 + cue.k * 0.05 })
            }
            this.pulse.color = cue.color
        }
        else this.pulse.on = false

        const now = performance.now()
        if(now - this.last < 33) return                               // about 30 drawings a second is plenty
        this.last = now
        this.draw(me)
    }

    draw(me)
    {
        const g = this.game, x = this.ctx, map = g.map, src = map.canvas, N = src.width, E2 = 370
        const m = map.toMap(me.x, me.z), w = SPAN / E2 * N
        x.clearRect(0, 0, SIZE, SIZE)
        x.fillStyle = '#2f6f98'; x.fillRect(0, 0, SIZE, SIZE)
        x.drawImage(src, m.u * N - w / 2, m.v * N - w / 2, w, w, 0, 0, SIZE, SIZE)
        const px = SIZE / SPAN                                       // px per metre
        const at = (wx, wz) => { const q = map.toMap(wx, wz); return [ SIZE / 2 + (q.u - m.u) * E2 * px, SIZE / 2 + (q.v - m.v) * E2 * px ] }

        // the next gate of a lap
        const c = g.course
        if(g.mode === 'fly' && c && c.gates && c.gates.length)
        {
            const [ gx, gy ] = at(c.gates[c.next].c.x, c.gates[c.next].c.z)
            x.beginPath(); x.arc(gx, gy, 5, 0, Math.PI * 2); x.lineWidth = 2.5; x.strokeStyle = '#f2c94c'; x.stroke()
        }

        x.font = '700 10px system-ui, sans-serif'; x.textBaseline = 'middle'
        for(const p of g.places.list)
        {
            if(p.station || p.id === 'blimp') continue
            const a = p.at()
            if(p.find && !p.found)
            {
                const j = this.jitter(p), [ cx, cy ] = at(a.x + j.x, a.z + j.z)
                x.beginPath(); x.arc(cx, cy, AREA * px, 0, Math.PI * 2)
                x.fillStyle = 'rgba(255,255,255,.08)'; x.fill()
                x.setLineDash([ 3, 4 ]); x.lineWidth = 1.2; x.strokeStyle = 'rgba(255,255,255,.55)'; x.stroke(); x.setLineDash([])
                continue
            }
            const [ cx, cy ] = at(a.x, a.z)
            if(cx < - 40 || cx > SIZE + 40 || cy < - 10 || cy > SIZE + 10) continue
            x.save(); x.translate(cx, cy); x.rotate(Math.PI / 4)
            x.fillStyle = p.color; x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.fillRect(- 4, - 4, 8, 8); x.strokeRect(- 4, - 4, 8, 8)
            x.restore()
            if(p.find) { const t = String(p.name).toUpperCase(); x.lineWidth = 3; x.strokeStyle = 'rgba(16,15,15,.85)'; x.strokeText(t, cx + 8, cy); x.fillStyle = '#fff'; x.fillText(t, cx + 8, cy) }
        }

        // just found: a ring opens over it
        if(this.flash)
        {
            this.flash.t += 0.033
            const a = this.flash.p.at(), [ cx, cy ] = at(a.x, a.z), k = this.flash.t / 0.9
            x.beginPath(); x.arc(cx, cy, 6 + k * 30, 0, Math.PI * 2); x.lineWidth = 3 * (1 - k); x.strokeStyle = 'rgba(159,224,183,' + (1 - k) + ')'; x.stroke()
            if(k >= 1) this.flash = null
        }

        // the cue: a ring from you out to the rim
        if(this.pulse.on)
        {
            const t = this.pulse.t
            x.beginPath(); x.arc(SIZE / 2, SIZE / 2, 6 + t * (SIZE / 2 - 8), 0, Math.PI * 2)
            x.lineWidth = 3; x.strokeStyle = 'rgba(' + this.pulse.color + ',' + (0.9 * (1 - t)).toFixed(3) + ')'; x.stroke()
        }
        this.el.classList.toggle('hot', this.pulse.on)

        // which way you face, as on the big map
        const g2 = this.game, yaw = g2.mode === 'fly' ? g2.jet.state.yaw : g2.mode === 'glide' ? g2.glider.s.yaw : g2.mode === 'drive' ? g2.physicalVehicle.yRotation : g2.walker.yaw
        const fx = Math.cos(yaw), fz = - Math.sin(yaw)
        this.you.style.setProperty('--a', Math.atan2(fx + fz, fx - fz) + 'rad')
    }
}
