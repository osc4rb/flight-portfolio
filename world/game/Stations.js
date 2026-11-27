/* Stations.js — the résumé in the world. Each section of site.js `home.sections` gets a station: a house, a flag,
   a floating label and a person (Kenney character, CC0) who hands you that part of the résumé when you press E.
   Also the coins: pick them all up for the "Island collector" note. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'
import { STATION_SPOTS, rng } from './Stage.js'
import { Spring } from './Juice.js'

const COLORS = [ '#f2c94c', '#5fb3cf', '#9fe0b7', '#ef8a6f', '#b9a6ff' ]
const VOICES = [ 1.25, 0.85, 1.45, 1.05, 1.6 ]           // talk-blip pitch per person
const TALK = 9                                              // m: inside this a person turns to you and talks

// a dark pill with a coloured dot and the name, as a sprite (Places.js uses it too)
export function label(text, color)
{
    const c = document.createElement('canvas'), g = c.getContext('2d'), font = '600 64px system-ui, -apple-system, Segoe UI, sans-serif'
    g.font = font; const w = Math.ceil(g.measureText(text).width) + 90; c.width = w; c.height = 112
    g.fillStyle = 'rgba(16,15,15,.86)'; g.beginPath(); g.roundRect(0, 0, w, 112, 56); g.fill()
    g.fillStyle = color; g.beginPath(); g.arc(50, 56, 14, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#f2f0e5'; g.font = font; g.textBaseline = 'middle'; g.fillText(text, 78, 60)
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }))
    s.scale.set(w / 112 * 1.3, 1.3, 1); s.renderOrder = 10
    return s
}

export class Stations
{
    constructor()
    {
        this.game = Game.getInstance()
        this.stage = this.game.stage
        this.list = []
        this.near = null
        this.coins = { got: 0, total: this.stage.coins.length }

        const sections = (this.game.site.home && this.game.site.home.sections) || []
        const R = rng(77), houses = [ 'houseE', 'houseF', 'houseG', 'houseH', 'houseB' ]
        sections.slice(0, STATION_SPOTS.length).forEach((sec, i) =>
        {
            const [ x, z ] = STATION_SPOTS[i], color = COLORS[i % COLORS.length], face = Math.atan2(- x, - z)  // face the town
            const gy = this.stage.height(x, z)
            const back = new THREE.Vector3(Math.sin(face), 0, Math.cos(face)).multiplyScalar(- 7)
            this.stage.place(houses[i % houses.length], x + back.x, z + back.z, { size: 9, by: 'height', rotation: face })
            const flag = this.stage.place('flag', x + 4, z + 1, { size: 4, by: 'height', collide: false })
            const tag = label(sec.title, color); tag.position.set(x, gy + 6.2, z); this.game.scene.add(tag)
            const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.6, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }))
            ring.rotation.x = - Math.PI / 2; ring.position.set(x, gy + 0.09, z); this.game.scene.add(ring)
            const npc = this.person(x, z, face, color)
            const st = { section: sec, x, z, color, tag, ring, npc, flag, seen: false, face, voice: VOICES[i % VOICES.length], line: 0, talking: false, tagScale: tag.scale.clone(), tagSpring: new Spring(300, 12) }
            if(npc) this.game.juice.addTarget(npc.model, 'person', () => this.game.modes.interact())
            this.list.push(st)
        })

        this.game.ticker.events.on('tick', () => this.update(), 9)
    }

    // a résumé keeper: the Kenney character, tinted, idling
    person(x, z, face, color)
    {
        const src = this.stage.models.character; if(!src) return null
        const model = src.scene.clone(true), box = new THREE.Box3().setFromObject(model), k = 1.45 / box.getSize(new THREE.Vector3()).y
        model.scale.setScalar(k); model.position.set(x, this.stage.height(x, z) - box.min.y * k, z); model.rotation.y = face
        model.traverse(c => { if(c.isMesh) { c.castShadow = true; c.material = c.material.clone(); if(c.material.color) c.material.color.lerp(new THREE.Color(color), 0.35) } })
        this.game.scene.add(model)
        this.game.look && this.game.look.convert(model)
        const mixer = new THREE.AnimationMixer(model), idle = (src.animations || []).find(a => /idle/i.test(a.name))
        if(idle) mixer.clipAction(idle).play()
        this.game.objects.add(null, { type: 'fixed', colliders: [ { shape: 'cylinder', parameters: [ 0.75, 0.4 ], position: { x, y: model.position.y + 0.75, z } } ] })
        return { model, mixer, k, baseY: model.position.y, yaw: face, squash: new Spring(240, 11), hop: 0, nextHop: 2 + Math.random() * 3 }
    }

    open(st)
    {
        const g = this.game, first = !st.seen
        st.seen = true
        g.hud.panel(st.section, st.color)
        if(first && st.npc) { g.juice.confetti(st.npc.model.position.clone().add(new THREE.Vector3(0, 1.6, 0)), 36); g.sound.chime(); this.hop(st) }
        if(this.list.every(s => s.seen)) { g.hud.toast('You read the whole résumé. Thanks for stopping by!', true); g.achievements && g.achievements.unlock('people') }
    }

    hop(st, h = 0.45) { const n = st.npc; if(!n || n.hop > 0) return; n.hop = 0.0001; n.hopH = h; n.launched = false; n.squash.kick(- 4) }

    // the person's lines come from site.js (home.sections[i].say); without them they just wave
    lines(st) { return st.section.say || [] }

    update()
    {
        const dt = this.game.ticker.delta, t = this.game.ticker.elapsed
        const p = this.game.modes ? this.game.modes.activePosition() : null
        let near = null, talker = null, td = Infinity
        for(const st of this.list)
        {
            const n = st.npc
            if(n)
            {
                n.mixer.update(dt)
                const d = p ? Math.hypot(p.x - st.x, p.z - st.z) : Infinity
                // turn to face you when you come close, back to the town when you leave
                const want = d < TALK + 3 && this.game.mode !== 'fly' ? Math.atan2(p.x - st.x, p.z - st.z) : st.face
                let dy = want - n.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); n.yaw += dy * Math.min(1, dt * 6)
                n.model.rotation.y = n.yaw
                // hop: on greeting, and now and then while you're near
                if(d < TALK) { n.nextHop -= dt; if(n.nextHop < 0) { n.nextHop = 3 + Math.random() * 4; this.hop(st, 0.25) } }
                let y = 0
                if(n.hop > 0)
                {
                    n.hop += dt
                    if(!n.launched && n.hop > 0.07) { n.launched = true; n.squash.kick(7) }       // crouch, then spring up
                    const k = (n.hop - 0.07) / 0.42
                    if(k >= 1) { n.hop = 0; n.squash.kick(- 6) } else if(k > 0) y = Math.sin(k * Math.PI) * n.hopH
                }
                const sq = Math.max(- 0.3, Math.min(0.3, n.squash.update(dt) * 0.5))
                n.model.position.y = n.baseY + y
                n.model.scale.set(n.k * (1 - sq * 0.5), n.k * (1 + sq), n.k * (1 - sq * 0.5))
                if(d < TALK && this.game.mode === 'foot' && d < td) { td = d; talker = st }
            }
            const ts = 1 + st.tagSpring.update(dt) * 0.08
            st.tag.scale.set(st.tagScale.x * ts, st.tagScale.y * ts, 1)
            st.tag.position.y = this.stage.height(st.x, st.z) + 6.2 + Math.sin(t * 1.6 + st.x) * 0.12
            st.ring.material.opacity = 0.5 + Math.sin(t * 3 + st.z) * 0.25
            if(p && this.game.mode !== 'fly' && Math.hypot(p.x - st.x, p.z - st.z) < (this.game.mode === 'drive' ? 8 : 5)) near = st
        }
        if(near !== this.near) { if(near) near.tagSpring.kick(6); this.near = near; this.game.modes && this.game.modes.refreshPrompt() }

        // speech bubble over the nearest person in range, typed out with their voice
        if(talker !== this.talker)
        {
            if(this.talker) { this.talker.line = (this.talker.line + 1) % Math.max(1, this.lines(this.talker).length) }
            this.talker = talker
            if(talker) { this.hop(talker); const L = this.lines(talker); this.game.hud.say(L.length ? L[talker.line % L.length] : null, talker.color, talker.voice) }
            else this.game.hud.say(null)
        }
        if(talker && talker.npc)
        {
            const head = talker.npc.model.position.clone(); head.y += 2.1
            const cam = this.game.view.camera; cam.matrixWorldInverse.copy(cam.matrixWorld).invert()   // the renderer refreshes it only at draw time
            head.project(cam)
            this.game.hud.bubbleAt(head.z < 1 ? (head.x + 1) / 2 : null, (1 - head.y) / 2)
        }

        // coins
        if(p) for(const c of this.stage.coins)
        {
            if(c.taken || Math.hypot(p.x - c.x, p.z - c.z) > (this.game.mode === 'drive' ? 2.6 : 1.6) || Math.abs(p.y - c.y) > 3.5) continue
            c.taken = true; c.anim = 0; this.coins.got++
            this.game.juice.sparkle(c.obj.position.clone(), 16); this.game.sound.coin()
            this.game.hud.coins(this.coins.got, this.coins.total)
            if(this.coins.got >= this.coins.total) this.game.achievements && this.game.achievements.unlock('coins')
            if(this.coins.got === this.coins.total) { this.game.hud.toast('Island collector: every coin found!', true); this.game.sound.chime(); this.game.juice.confetti(c.obj.position.clone(), 60) }
        }
        // a taken coin jumps up, spins fast and shrinks away
        for(const c of this.stage.coins)
        {
            if(c.anim === undefined || c.anim < 0) continue
            c.anim += dt
            const k = c.anim / 0.45
            if(k >= 1) { c.obj.visible = false; c.anim = - 1; continue }
            if(!c.scale0) c.scale0 = c.obj.scale.x
            c.obj.position.y = c.y + Math.sin(k * Math.PI * 0.5) * 1.8
            c.obj.rotation.y += dt * 30
            c.obj.scale.setScalar(c.scale0 * (k < 0.3 ? 1 + k * 1.2 : 1.36 * (1 - (k - 0.3) / 0.7)))
        }
    }
}
