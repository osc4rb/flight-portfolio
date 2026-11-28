/* Letters.js — the name from site.js in big block letters on the grass by the airstrip, each a Rapier body you can
   knock over with the truck, the jet or on foot. After folio-2025's LandingArea letters; the 5×7 block font and the
   code are ours. Each letter is lighter than the truck, so it goes over instead of stopping it, and a hit from the
   truck or the jet (which is not a Rapier body) wakes it and throws it along the vehicle's velocity, as his car's
   bumps do. Knocking one flat unlocks an achievement.
   The name stands across the runway in the takeoff run, the first name stacked on the last, in orange, facing the
   camera's corner. The jet bursts through it with a fireball (it does not crash), and once the letters have lain still
   for a while with nobody near, they stand up again for the next takeoff. */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Game } from '../engine/Game.js'

const FONT = {
    A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110',
    C: '01111 10000 10000 10000 10000 10000 01111', D: '11110 10001 10001 10001 10001 10001 11110',
    E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000',
    G: '01111 10000 10000 10011 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
    I: '11111 00100 00100 00100 00100 00100 11111', J: '00111 00010 00010 00010 00010 10010 01100',
    K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
    M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001',
    O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
    Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001',
    S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
    U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100',
    W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
    Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111',
}
const PX = 0.42, DEPTH = 0.7, GAP = 0.5, SPACE = 1.6
const WALL = { x: - 40, z: - 112 }        // on the runway, about 50 m from where the jet waits
const COLOR = '#ff7b1c'
const BACK = 25                            // s after the last hit before the letters stand up again

export class Letters
{
    constructor()
    {
        this.game = Game.getInstance()
        this.list = []
        const lines = String(this.game.site.name || '').toUpperCase().split(/\s+/).filter(Boolean)
        const mat = new THREE.MeshLambertMaterial({ color: COLOR })
        // the last line on the ground, each line above it standing on it; read from the camera's corner, so along −z
        lines.forEach((line, i) =>
        {
            const chars = [ ...line ].filter(ch => FONT[ch]), w = chars.length * 5 * PX + (chars.length - 1) * GAP
            const level = lines.length - 1 - i
            let along = w / 2 - 2.5 * PX
            for(const ch of chars) { this.add(FONT[ch].split(' '), WALL.z + along, level, mat); along -= 5 * PX + GAP }
        })
        this.lastHit = - 1e9
        this.game.ticker.events.on('tick', () => this.update(), 10)
    }

    add(rows, cz, level, mat)
    {
        const H = this.game.stage.height, cx = WALL.x, y = H(cx, cz) + 3.5 * PX + 0.05 + level * (7 * PX + 0.02)
        const boxes = [], colliders = []
        rows.forEach((row, r) =>
        {
            const ry = (3 - r) * PX
            // runs of filled cells in a row become one box and one collider
            for(let c = 0; c < 5; c++)
            {
                if(row[c] !== '1') continue
                let e = c; while(e + 1 < 5 && row[e + 1] === '1') e++
                const w = (e - c + 1) * PX, rx = ((c + e) / 2 - 2) * PX
                // turned a quarter: the letter's reading direction runs along −z, its face looks toward +x
                boxes.push(new THREE.BoxGeometry(w, PX, DEPTH).translate(rx, ry, 0).rotateY(Math.PI / 2))
                colliders.push({ shape: 'cuboid', parameters: [ DEPTH / 2, PX / 2, w / 2 ], position: { x: 0, y: ry, z: - rx }, mass: 0.07 * (e - c + 1) })
                c = e
            }
        })
        const mesh = new THREE.Mesh(mergeGeometries(boxes), mat); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.softUp = 0.5
        const group = new THREE.Group(); group.add(mesh)
        const o = this.game.objects.add({ model: group }, { type: 'dynamic', position: { x: cx, y, z: cz }, friction: 0.7, restitution: 0.05, sleeping: true, colliders })
        this.list.push({ o, mesh, fallen: false, cool: 0 })
    }

    // a hit: wake the letter and throw it along the hitter's velocity, a little up, with some spin
    hit(l, velocity, k)
    {
        const body = l.o.physical.body, m = body.mass(), v = velocity.length()
        if(v < 2 || l.cool > 0) return
        l.cool = 0.4
        const push = velocity.clone().setY(0).normalize().multiplyScalar(Math.min(v, 30) * k * m)
        push.y = Math.min(v, 30) * k * 0.35 * m
        body.wakeUp()
        body.applyImpulse(push, true)
        body.applyTorqueImpulse({ x: (Math.random() - 0.5) * m * 2, y: (Math.random() - 0.5) * m, z: - Math.sign(velocity.x || 1) * m * 2.5 }, true)
        const g = this.game
        this.lastHit = performance.now()
        g.sound && g.sound.clonk(Math.min(1, v / 20))
        g.juice && g.juice.dust(new THREE.Vector3().copy(body.translation()), 4, { spread: 1, up: 1.5, size: 0.6 })
    }

    update()
    {
        const g = this.game, dt = g.ticker.delta
        const truck = g.mode === 'drive' ? g.physicalVehicle : null
        const jet = g.mode === 'fly' && g.jet ? g.jet : null
        const tv = new THREE.Vector3(), jv = new THREE.Vector3(), p = new THREE.Vector3()
        if(truck) { const lv = truck.chassis.physical.body.linvel(); tv.set(lv.x, lv.y, lv.z) }
        if(jet) jv.copy(jet.forward).multiplyScalar(jet.state.v)
        for(const l of this.list)
        {
            if(l.cool > 0) l.cool -= dt
            p.copy(l.o.physical.body.translation())
            if(truck && truck.position.distanceTo(p) < 2.8) this.hit(l, tv, 0.5)
            if(jet && jet.position.distanceTo(p) < 6)
            {
                // the jet bursts through: one fireball where it meets the name (the fireball throws the rest)
                if(performance.now() - (this.boomAt || 0) > 4000 && jet.state.v > 8)
                {
                    this.boomAt = performance.now()
                    g.explosions && g.explosions.fireball(jet.position.clone().addScaledVector(jet.forward, 3), 4, 7)
                    g.juice && g.juice.shake(0.5)
                }
                this.hit(l, jv, 0.35)
            }
        }
        if(++this.tick % 20) return
        // stand the name up again once it has lain still a while and nobody is near
        if(this.list.some(l => l.fallen) && performance.now() - this.lastHit > BACK * 1000)
        {
            const me = g.modes ? g.modes.activePosition() : null
            if(!me || Math.hypot(me.x - WALL.x, me.z - WALL.z) > 30)
            {
                for(const l of this.list) { g.objects.resetObject(l.o); l.fallen = false }
                this.lastHit = performance.now()
            }
        }
        const a = this.game.achievements
        for(const l of this.list)
        {
            const body = l.o.physical && l.o.physical.body; if(!body || l.fallen) continue
            const q = body.rotation(), upY = 1 - 2 * (q.x * q.x + q.z * q.z)                    // the letter's up axis, y part
            if(upY < 0.5) { l.fallen = true; a && a.unlock('letters') }
        }
    }
}
Letters.prototype.tick = 0
