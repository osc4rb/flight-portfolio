/* Map.js — the island from above, after folio-2025's Map.js (Bruno Simon, MIT): M or the Map button opens it, a
   pin per place, and a click on a pin takes you there (a wipe, then you stand beside it). His map is a painted
   picture; ours is drawn once from our own terrain function, roads, runway, houses and the lap's gates. It is turned
   45° so "up" on the map is "up" on your screen (the camera looks from the +x +z corner).
   The words are in site.js → world.map; the places come from Places.js. */
import { Game } from '../engine/Game.js'
import { PALETTE, R_LAND } from './Stage.js'

const E = 185                   // m: half the width the map covers
const N = 360                   // px: the drawing's size before CSS scales it
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const hex = c => [ 1, 3, 5 ].map(i => parseInt(c.slice(i, i + 2), 16))
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

export class IslandMap
{
    constructor()
    {
        const g = this.game = Game.getInstance()
        this.words = (g.site.world || {}).map || {}
        this.open = false
        this.drawn = false

        this.el = document.createElement('div'); this.el.className = 'h-map'; this.el.hidden = true
        this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-modal', 'true'); this.el.setAttribute('aria-labelledby', 'h-maptitle')
        this.el.innerHTML = `<div class="m-card"><header><h2 id="h-maptitle">${esc(this.words.title)}</h2><p class="m-hint"></p>
            <button type="button" class="h-x" data-close aria-label="${esc(this.words.close)}">×</button></header>
            <div class="m-box"><canvas width="${N}" height="${N}"></canvas><div class="m-pins"></div><i class="m-you" title="${esc(this.words.you)}"></i></div></div>`
        document.getElementById('hud').appendChild(this.el)
        this.canvas = this.el.querySelector('canvas')
        this.pins = this.el.querySelector('.m-pins')
        this.you = this.el.querySelector('.m-you')
        this.hint = this.el.querySelector('.m-hint')
        this.el.addEventListener('click', e => { if(e.target === this.el || e.target.closest('[data-close]')) this.close() })

        g.inputs.addActions([ { name: 'map', categories: [ 'wandering', 'modal' ], keys: [ 'Keyboard.KeyM' ] } ])
        g.inputs.events.on('map', (action) => { if(action.active) this.open ? this.close() : this.show() })
        g.ticker.events.on('tick', () => this.update(), 14)
    }

    // world (x, z) → 0..1 on the map, turned so the camera's forward (−x −z) points up
    toMap(x, z) { return { u: ((x - z) / Math.SQRT2 / E + 1) / 2, v: ((x + z) / Math.SQRT2 / E + 1) / 2 } }

    show()
    {
        const g = this.game
        if(this.open || g.reveal.active || g.desk.state !== 'idle' || !g.hud.$('h-panel').hidden) return
        if(!this.drawn) { this.draw(); this.drawn = true }
        this.setPins()
        this.open = true
        this.el.hidden = false
        this.el.classList.remove('in'); void this.el.offsetWidth; this.el.classList.add('in')
        if(g.mode !== 'fly') g.modes.lock(true)             // in the air the jet keeps its controls
        g.sound && g.sound.pop(true)
        this.update()
        const x = this.el.querySelector('.h-x'); x && x.focus({ preventScroll: true })
    }

    close()
    {
        if(!this.open) return
        this.open = false
        this.el.hidden = true
        if(this.game.modes.locked) this.game.modes.lock(false)
        this.game.sound && this.game.sound.pop(false)
        this.game.canvasElement.focus && this.game.canvasElement.focus()
    }

    setPins()
    {
        const g = this.game, fly = g.mode === 'fly'
        this.hint.textContent = fly ? this.words.flying : this.words.hint
        this.pins.innerHTML = ''
        for(const p of g.places.list)
        {
            const at = p.at(), m = this.toMap(at.x, at.z)
            const b = document.createElement('button'); b.type = 'button'; b.className = 'm-pin' + ((p.side === 'left' || m.u > 0.68) && m.u > 0.3 ? ' left' : '')   // near the right edge, the name goes left
            b.style.left = (m.u * 100).toFixed(2) + '%'; b.style.top = (m.v * 100).toFixed(2) + '%'; b.style.setProperty('--c', p.color)
            b.style.zIndex = Math.round(m.v * 1000)
            b.innerHTML = `<i></i><span>${esc(p.name)}</span>`
            b.disabled = fly || !p.spot
            b.addEventListener('click', () => this.go(p))
            this.pins.appendChild(b)
        }
    }

    // travel: close the map, cover the screen, get out of the truck if you are in it, stand beside the place
    go(p)
    {
        const g = this.game
        if(g.mode === 'fly' || !p.spot) return
        this.close()
        g.hud.wipe(() =>
        {
            if(g.mode === 'drive') g.modes.leave('drive')
            const spot = p.spot()
            g.walker.moveTo(spot, Math.PI * 0.75)
            const f = g.view.focusPoint
            f.trackedPosition.copy(spot); f.smoothedPosition.copy(spot)
            g.modes.refreshPrompt()
        })
    }

    update()
    {
        if(!this.open) return
        const g = this.game, p = g.modes.activePosition(), m = this.toMap(p.x, p.z)
        this.you.style.left = (m.u * 100).toFixed(2) + '%'
        this.you.style.top = (m.v * 100).toFixed(2) + '%'
        // which way you face: every mode turns +x by its yaw, so forward is (cos, −sin); then into map terms
        const yaw = g.mode === 'fly' ? g.jet.state.yaw : g.mode === 'drive' ? g.physicalVehicle.yRotation : g.walker.yaw
        const fx = Math.cos(yaw), fz = - Math.sin(yaw)
        this.you.style.setProperty('--a', Math.atan2(fx + fz, fx - fz) + 'rad')
    }

    // ---------------------------------------------------------------- the drawing
    draw()
    {
        const g = this.game, H = g.stage.height, c = this.canvas.getContext('2d'), img = c.createImageData(N, N), d = img.data
        const sea = hex('#4f9fc4'), deep = hex('#2f6f98'), shore = hex('#8fd0e4'), sand = hex(PALETTE.sand), grass = hex(PALETTE.grass), hill = hex(PALETTE.hill)
        const world = (i, j) => { const u = ((i + 0.5) / N * 2 - 1) * E, w = ((j + 0.5) / N * 2 - 1) * E; return [ (u + w) / Math.SQRT2, (w - u) / Math.SQRT2 ] }
        for(let j = 0; j < N; j++) for(let i = 0; i < N; i++)
        {
            const [ x, z ] = world(i, j), h = H(x, z)
            let col
            if(h < - 0.4) col = mix(shore, mix(sea, deep, Math.min(1, (Math.hypot(x, z) - R_LAND - 20) / 40)), Math.min(1, (- 0.4 - h) / 1.5))
            else if(h < 0.45) col = sand
            else col = mix(grass, hill, Math.min(1, Math.max(0, (h - 3) / 6)))
            if(h >= - 0.4)
            {
                // hill shading, lit from the top left of the map
                const k = 1.5, sx = H(x + k, z) - H(x - k, z), sz = H(x, z + k) - H(x, z - k)
                const lit = Math.max(0.72, Math.min(1.18, 1 - (sx + sz) * 0.09))
                col = col.map(v => v * lit)
            }
            const o = (j * N + i) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255
        }
        c.putImageData(img, 0, 0)

        const P = (x, z) => { const m = this.toMap(x, z); return [ m.u * N, m.v * N ] }
        const s = N / (2 * E)                                      // px per metre
        const line = (pts, w, style) => { c.beginPath(); pts.forEach(([ x, z ], k) => c[k ? 'lineTo' : 'moveTo'](...P(x, z))); c.lineWidth = w * s; c.strokeStyle = style; c.lineCap = c.lineJoin = 'round'; c.stroke() }

        for(const r of g.stage.roads || []) line(r.points, r.width, '#d9c8a6')
        const rw = g.stage.runway
        line([ [ rw.x0, rw.z ], [ rw.x1, rw.z ] ], 18, '#4c4f55')
        c.setLineDash([ 6 * s, 6 * s ]); line([ [ rw.x0 + 8, rw.z ], [ rw.x1 - 8, rw.z ] ], 0.8, '#f3eede'); c.setLineDash([])

        for(const h of g.stage.houses) { const [ x, y ] = P(h.x, h.z), r = Math.max(2, h.r * s * 0.9); c.fillStyle = 'rgba(70,52,40,.28)'; c.fillRect(x - r + 1, y - r + 2, 2 * r, 2 * r); c.fillStyle = '#efe6d6'; c.fillRect(x - r, y - r, 2 * r, 2 * r) }

        // the lap: a dotted line through the gates, back to the start
        const gates = (g.course && g.course.gates) || []
        if(gates.length)
        {
            c.setLineDash([ 2, 5 ])
            line([ ...gates.map(q => [ q.c.x, q.c.z ]), [ gates[0].c.x, gates[0].c.z ] ], 1.2, 'rgba(242,201,76,.95)')
            c.setLineDash([])
            for(const q of gates) { const [ x, y ] = P(q.c.x, q.c.z); c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.strokeStyle = '#f2c94c'; c.lineWidth = 2; c.stroke() }
        }
    }
}
