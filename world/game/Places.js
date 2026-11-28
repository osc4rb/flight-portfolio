/* Places.js — wayfinding, after folio-2025's interactive-point labels and map pins (Bruno Simon, MIT; ideas, not
   code). A floating label over each thing you can use: the computer, the jet, the truck, the race start, the blimp.
   The five people already carry theirs (Stations.js). An arrow at the screen's edge points to the place the
   current quest needs (site.js → world.quests[i].at). Map.js reads `list` for its pins and travel spots.
   The names are in site.js → world.places; the people use their section titles from `home`. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'
import { label } from './Stations.js'
import { PODIUM } from './Course.js'

const NEAR = { foot: 12, drive: 16, fly: 40 }          // m: closer than this, the quest arrow hides
const FIND = { foot: 16, drive: 20, glide: 26, fly: 34 }   // m: this close to a hidden place, you have found it
const KEY = 'oscar-world-found'                         // the places found, kept on this device only

export class Places
{
    constructor()
    {
        const g = this.game = Game.getInstance()
        const P = (g.site.world || {}).places || {}, H = g.stage.height
        const v = (x, y, z) => new THREE.Vector3(x, y, z)
        this.list = []
        const add = (id, name, o) => { if(name) this.list.push({ id, name, ...o }) }

        // at(): the point the label floats over · lift: how high · aim(): where the quest arrow points
        // spot(): where you stand after travelling there (walker centre), or null if you cannot walk there
        add('computer', P.computer, { color: '#f2c94c', lift: 4.6, at: () => g.desk.position.clone(),
            spot: () => g.desk.front.add(v(0, 1.2, 1.6)) })
        add('jet', P.jet, { color: '#5fb3cf', lift: 6, side: 'left', at: () => g.jet.position.clone(), hideIn: 'fly',
            spot: () => g.jet.door.add(v(2.5, 1.2, 3.6)) })
        add('truck', P.truck, { color: '#ef8a6f', lift: 3.6, at: () => g.physicalVehicle.position.clone(), hideIn: 'drive',
            spot: () => { const p = g.physicalVehicle.position; return p.clone().add(v(0, 0, 3).applyQuaternion(g.physicalVehicle.quaternion)).setY(p.y + 1) } })
        add('circuit', P.circuit, { color: '#9fe0b7', lift: 7.5, at: () => v(PODIUM.x, H(PODIUM.x, PODIUM.z), PODIUM.z),
            aim: () => g.course.gates[0].c.clone(), spot: () => v(PODIUM.x, H(PODIUM.x, PODIUM.z + 6) + 1.2, PODIUM.z + 6) })
        if(g.room) for(const d of g.room.doors)
            add(d.room ? 'room' : 'door-' + d.id, d.label, { color: d.color || '#f2c94c', lift: d.lift || 1.2, at: () => d.top.clone(),
                find: true, spot: () => d.front.clone().add(v(Math.sin(d.face), 0, Math.cos(d.face)).multiplyScalar(1.5)).setY(d.front.y + 1.2) })
        add('blimp', P.blimp, { color: '#b9a6ff', lift: - 4, side: 'left', at: () => g.sky.blimp.position.clone(), spot: null })
        for(const st of g.stations.list)
        {
            const front = v(Math.sin(st.face), 0, Math.cos(st.face)).multiplyScalar(4.5)
            this.list.push({ id: 'person', station: st, name: st.section.title, color: st.color, tag: st.tag,
                at: () => v(st.x, H(st.x, st.z), st.z), spot: () => v(st.x + front.x, H(st.x + front.x, st.z + front.z) + 1.2, st.z + front.z) })
        }

        // the hidden places: found once you come close, remembered on this device
        let saved = []; try { saved = JSON.parse(localStorage.getItem(KEY) || '[]') } catch(e) {}
        for(const p of this.list) if(p.find) p.found = saved.includes(p.id)

        // labels for the places that do not have one yet
        for(const p of this.list)
        {
            if(p.tag) continue
            p.tag = label(p.name, p.color)
            p.tag.position.copy(p.at()).y += p.lift
            g.scene.add(p.tag)
        }

        this.arrow = document.createElement('div'); this.arrow.className = 'h-mark h-qmark'; this.arrow.hidden = true
        document.getElementById('hud').appendChild(this.arrow)
        g.ticker.events.on('tick', () => this.update(), 9.5)
    }

    get(id) { return this.list.find(p => p.id === id) }

    known(p) { return !p.find || p.found }

    // the nearest hidden place not found yet, and how far it is (for the minimap's cue)
    nearestHidden()
    {
        const me = this.game.modes.activePosition()
        let best = null, d = Infinity
        for(const p of this.list) if(p.find && !p.found) { const a = p.at(), k = Math.hypot(a.x - me.x, a.z - me.z); if(k < d) { d = k; best = p } }
        return best && { place: best, d }
    }

    discover(p)
    {
        const g = this.game
        p.found = true
        try { localStorage.setItem(KEY, JSON.stringify(this.list.filter(q => q.find && q.found).map(q => q.id))) } catch(e) {}
        const at = p.at()
        g.hud.toast(p.name, true)
        g.juice && g.juice.ring(at.clone().setY(g.stage.height(at.x, at.z) + 0.2), 22, p.color, 6)
        if(g.sound) { g.sound.tone({ type: 'triangle', f0: 660, f1: 990, d: 0.22, peak: 0.16 }); g.sound.tone({ type: 'triangle', f0: 990, d: 0.35, peak: 0.12, delay: 0.12 }) }
        g.minimap && g.minimap.found(p)
        if(this.list.every(q => !q.find || q.found)) g.achievements && g.achievements.unlock && g.achievements.unlock('explorer')
    }

    // the place the current quest is about (for "people", the nearest one not met yet)
    target()
    {
        const q = this.game.quests, step = q && q.list && q.list[q.step]
        if(!step || !step.at) return null
        if(step.at !== 'people') { const p = this.get(step.at); return p && this.known(p) ? p : null }   // a hidden place is yours to find
        const me = this.game.modes.activePosition()
        let best = null, d = Infinity
        for(const p of this.list) if(p.station && !p.station.seen) { const k = p.at().distanceTo(me); if(k < d) { d = k; best = p } }
        return best
    }

    busy()
    {
        const g = this.game
        return g.reveal.active || g.desk.state !== 'idle' || (g.room && g.room.state !== 'off') || !g.hud.$('h-panel').hidden || (g.map && g.map.open)
    }

    update()
    {
        const g = this.game, t = g.ticker.elapsed || 0
        // labels follow what moves, and hide while you are in that vehicle (and during the opening: the disc would clip them)
        for(const p of this.list)
        {
            if(p.station) { p.tag.visible = !g.reveal.active; continue }
            p.tag.visible = p.hideIn !== g.mode && !g.reveal.active && this.known(p)
            if(p.tag.visible) { p.tag.position.copy(p.at()); p.tag.position.y += p.lift + Math.sin(t * 2 + p.lift) * 0.15 }
        }

        // finding: close enough to a hidden place (not while the opening or a panel holds you)
        if(!g.reveal.active && g.mode !== 'off')
        {
            const n = this.nearestHidden()
            if(n && n.d < (FIND[g.mode] || 16)) this.discover(n.place)
        }

        const aim = this.busy() || (g.course && g.course.running) ? null : this.target()
        const at = aim && (aim.aim ? aim.aim() : aim.at().add(new THREE.Vector3(0, aim.lift || 3, 0)))
        if(!at || at.distanceTo(g.modes.activePosition()) < (NEAR[g.mode] || 12)) { this.arrow.hidden = true; return }
        this.arrow.hidden = false
        this.arrow.style.setProperty('--c', aim.color)
        const v = at.project(g.view.camera), behind = v.z > 1
        let x = v.x, y = v.y
        if(behind) { x = - x; y = - y }
        const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86
        if(off) { const k = 0.88 / Math.max(Math.abs(x), Math.abs(y), 1e-3); x *= k; y *= k }
        this.arrow.classList.toggle('edge', off)
        this.arrow.style.left = ((x + 1) / 2 * 100).toFixed(2) + '%'
        this.arrow.style.top = ((1 - y) / 2 * 100).toFixed(2) + '%'
        this.arrow.style.setProperty('--a', Math.atan2(- y, x) + 'rad')
    }
}
