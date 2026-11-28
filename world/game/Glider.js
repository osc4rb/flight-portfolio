/* Glider.js — bailing out, or crashing in the air or on the ground, throws you clear under a hang glider that you
   steer down. A/D turn, W dives (faster, sinks more), S flares (slower, sinks less). Where you touch land you are on
   foot and the truck is parked beside you; on the sea or a rock you are put on the nearest beach, the truck with you.
   The robot hangs from the control bar; forward = +x like the jet and the car. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'

const UP = new THREE.Vector3(0, 1, 0)
const FEET = new THREE.Vector3(- 0.15, - 2.75, 0)          // the robot's feet, below the bar, in the wing's frame
const FACE = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)   // the walker model faces +z

export class Glider
{
    constructor()
    {
        this.game = Game.getInstance()
        this.active = false
        this.position = new THREE.Vector3()
        this.s = { yaw: 0, bank: 0, pitch: 0, v: 13, vy: 0, open: 0 }
        this.chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false }
        this.setModel()
        this.game.ticker.events.on('tick', () => this.update(), 2.65)
    }

    setModel()
    {
        this.group = new THREE.Group()
        this.group.visible = false
        this.game.scene.add(this.group)
        this.wing = new THREE.Group()                       // scaled from a fold to full span as the sail opens
        this.group.add(this.wing)
        const sail = new THREE.MeshLambertMaterial({ color: '#f2c94c', side: THREE.DoubleSide })
        const band = new THREE.MeshLambertMaterial({ color: '#2f6fb0', side: THREE.DoubleSide })
        const metal = new THREE.MeshLambertMaterial({ color: '#3a3d42' })
        const tri = (a, b, c, mat, lift = 0) =>
        {
            const g = new THREE.BufferGeometry()
            g.setAttribute('position', new THREE.Float32BufferAttribute([ ...a, ...b, ...c ], 3)); g.translate(0, lift, 0); g.computeVertexNormals()
            const m = new THREE.Mesh(g, mat); m.castShadow = true; return m
        }
        const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)
        // a delta: nose ahead, 9.6 m span, the keel's tail a little lower than the wingtips
        const N = [ 2.0, 0.3, 0 ], L = [ - 1.6, 0.6, - 4.8 ], R = [ - 1.6, 0.6, 4.8 ], K = [ - 1.2, 0.1, 0 ]
        this.wing.add(tri(N, L, K, sail), tri(N, K, R, sail))
        for(const S of [ L, R ]) this.wing.add(tri(mix(N, S, 0.55), mix(N, S, 0.8), mix(K, S, 0.62), band, 0.02))
        const rod = (a, b, r = 0.045) =>
        {
            const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A)
            const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), metal)
            m.position.copy(A).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = true
            return m
        }
        this.wing.add(rod(N, L), rod(N, R), rod(N, K, 0.05), rod(mix(N, L, 0.5), mix(N, R, 0.5), 0.035))
        // the control bar (an A-frame under the keel) and its base bar the robot holds
        const top = [ 0.1, 0.25, 0 ], bl = [ 0.55, - 1.55, - 0.75 ], br = [ 0.55, - 1.55, 0.75 ]
        this.group.add(rod(top, bl, 0.035), rod(top, br, 0.035), rod(bl, br, 0.035))
    }

    // how: 'bail' (out of a flying jet) or 'crash' (the seat fires as the jet goes up)
    start(from, yaw, how)
    {
        const g = this.game, s = this.s
        const floor = Math.max(g.stage.height(from.x, from.z), - 0.3)
        this.position.copy(from)
        if(how === 'crash') this.position.y = Math.max(from.y, floor) + 3
        Object.assign(s, { yaw, bank: 0, pitch: 0, v: 13, vy: how === 'crash' ? 24 : 7, open: 0 })
        this.active = true
        this.group.visible = true
        this.chase.init = false
        g.mode = 'glide'
        g.walker.setActive(false)
        g.walker.group.visible = true
        g.walker.play('jump')
        g.cameraOverride = (cam) => this.camera(cam)
        g.modes.far(true)
        g.jet.setFov(50)
        g.sound.whoosh(); g.juice.shake(0.25)
        g.juice.dust(this.position.clone(), 8, { color: '#d9d6cf', spread: 1.5, up: 2, size: 0.8, life: 0.9 })
        g.hud.toast('A/D steer · W dive · S flare')
        g.modes.refreshPrompt()
    }

    input()
    {
        const a = this.game.inputs.actions, pad = this.game.inputs.gamepad.joysticks.left, n = this.game.inputs.nipple
        let pitch = (a.get('forward').active ? 1 : 0) - (a.get('backward').active ? 1 : 0)
        let roll = (a.get('right').active ? 1 : 0) - (a.get('left').active ? 1 : 0)
        if(pad.active) { pitch = - pad.safeY; roll = pad.safeX }
        if(n.active && n.progress > 0) { roll = Math.max(- 1, Math.min(1, - n.smallestAngle * 1.2)); pitch = n.forward ? n.progress : - n.progress }
        return { pitch, roll }
    }

    update()
    {
        if(!this.active) return
        const g = this.game, s = this.s, dt = g.ticker.deltaScaled * 0.5      // the jet's time: the engine runs at 2x
        const inp = g.modes && g.modes.locked ? { pitch: 0, roll: 0 } : this.input()

        // the seat's climb, then the sail opens and takes the weight
        s.vy -= 9.81 * dt
        s.open = Math.min(1, s.open + (s.vy < 4 ? dt * 2.2 : 0))
        const want = 13 + inp.pitch * 7                                          // W 20 m/s, S 6 m/s
        s.v += (want - s.v) * Math.min(1, dt * 1.5)
        s.bank += (inp.roll * 0.65 - s.bank) * Math.min(1, dt * 3)
        s.pitch += (- inp.pitch * 0.28 - s.pitch) * Math.min(1, dt * 3)
        s.yaw -= 9.81 * Math.tan(s.bank) / Math.max(s.v, 6) * dt
        const sink = (0.9 + 0.01 * s.v * s.v) / Math.cos(s.bank)                // about 5:1, worse in a dive or a turn
        if(s.open > 0.6) s.vy = Math.max(s.vy, - sink)
        const glide = s.v * (0.25 + 0.75 * s.open)
        this.position.x += Math.cos(s.yaw) * glide * dt
        this.position.z -= Math.sin(s.yaw) * glide * dt
        this.position.y += s.vy * dt
        // stay over the island's waters: turn back gently, as the jet does
        const r = Math.hypot(this.position.x, this.position.z)
        if(r > 330) { const back = Math.atan2(this.position.z, - this.position.x); let d = back - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); s.yaw += Math.sign(d) * 0.5 * dt }

        this.group.position.copy(this.position)
        this.group.quaternion.setFromEuler(new THREE.Euler(s.bank, s.yaw, s.pitch, 'YZX'))
        this.wing.scale.set(1, 1, 0.08 + 0.92 * s.open)
        this.group.updateMatrixWorld()
        const w = g.walker.group
        w.visible = true
        w.position.copy(FEET).applyMatrix4(this.group.matrixWorld)
        w.quaternion.copy(this.group.quaternion).multiply(FACE)
        g.view.focusPoint.trackedPosition.copy(this.position)

        // touchdown: the robot's feet reach the ground, the water or a rock
        const gy = g.stage.height(this.position.x, this.position.z), feet = w.position.y
        const rock = g.course && g.course.distance(this.position) < 0
        if(rock || feet <= Math.max(gy, - 0.3)) this.land(gy < - 0.3 || rock)
    }

    land(wet)
    {
        const g = this.game, s = this.s, p = this.position.clone()
        this.active = false
        const finish = (x, z, yaw) =>
        {
            this.group.visible = false
            g.cameraOverride = null
            g.modes.far(false)
            g.jet.setFov(25)
            const gy = g.stage.height(x, z), wk = g.walker
            g.mode = 'foot'
            wk.setActive(true)
            wk.moveTo(new THREE.Vector3(x, gy + wk.half + wk.radius + 0.1, z), yaw)
            wk.squash.kick(- 6)
            this.parkTruck(x, z, yaw)
            g.modes.refreshPrompt()
        }
        if(!wet)
        {
            g.sound.land(0.8); g.juice.ring(new THREE.Vector3(p.x, g.stage.height(p.x, p.z), p.z), 14, '#e9dfc6', 4)
            g.achievements && g.achievements.unlock && g.achievements.unlock('glide')
            finish(p.x, p.z, s.yaw)
            return
        }
        // the sea or a rock: a splash, then the nearest beach, facing inland
        g.sound.boom(); g.juice.ring(new THREE.Vector3(p.x, 0, p.z), 18, '#e6f4fb', 6); g.juice.shake(0.3)
        const a = Math.atan2(p.z, p.x)
        let rr = Math.min(Math.hypot(p.x, p.z), 145)
        while(rr > 20 && g.stage.height(Math.cos(a) * rr, Math.sin(a) * rr) < 0.4) rr -= 4
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr
        g.hud.wipe(() => finish(x, z, Math.atan2(z, - x)))
    }

    // the truck waits a few metres to the side of where you land, on ground that is neither sea nor steep
    parkTruck(x, z, yaw)
    {
        const g = this.game, H = (a, b) => g.stage.height(a, b)
        const side = new THREE.Vector2(Math.sin(yaw), Math.cos(yaw))           // right of the heading
        for(const [ k, f ] of [ [ 6, 0 ], [ - 6, 0 ], [ 6, 4 ], [ - 6, - 4 ], [ 0, 7 ], [ 9, 0 ], [ - 9, 0 ] ])
        {
            const tx = x + side.x * k + Math.cos(yaw) * f, tz = z + side.y * k - Math.sin(yaw) * f, h = H(tx, tz)
            if(h < 0.3 || Math.abs(H(tx + 2, tz) - h) > 1.2 || Math.abs(H(tx, tz + 2) - h) > 1.2) continue
            g.physicalVehicle.moveTo(new THREE.Vector3(tx, h + 1.6, tz), yaw)
            g.juice.dust(new THREE.Vector3(tx, h, tz), 8, { size: 0.6 })
            return
        }
    }

    camera(cam)
    {
        const s = this.s, dt = this.game.ticker.delta
        const fwd = new THREE.Vector3(Math.cos(s.yaw), 0, - Math.sin(s.yaw))
        const want = this.position.clone().addScaledVector(fwd, - 11).addScaledVector(UP, 3.5)
        const look = this.position.clone().addScaledVector(fwd, 14).addScaledVector(UP, - 3)
        const k = this.chase.init ? Math.min(1, dt * 4) : 1
        this.chase.pos.lerp(want, k); this.chase.look.lerp(look, k); this.chase.init = true
        cam.position.copy(this.chase.pos)
        cam.lookAt(this.chase.look)
    }
}
