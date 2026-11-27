/* CarVisual.js — our Blender pickup (truck.glb, bake_models.py → truck) riding on folio-2025's PhysicsVehicle chassis
   (forward = +x). It follows his VisualVehicle.js (Bruno Simon, MIT): the wheels spin, steer and ride their own
   suspension, the tyres leave tracks (Tracks.js), boost leaves two glowing trails, the blinkers blink while you
   steer, the stop lights light when you brake and the reverse lights when you back up. Ours adds headlights with
   beams and a pool of light on the ground, and a roof light bar; all of it glows at night (Look's nightUniform). */
import * as THREE from 'three/webgpu'
import { uniform, color, uv, float, normalView, positionViewDirection } from 'three/tsl'
import { Game } from '../engine/Game.js'
import { Spring } from './Juice.js'
import { Track, Trails } from './Tracks.js'

const REST = 0.513          // PhysicsVehicle's suspension length at rest: the model's wheel centres sit there
const WHEEL_Z = 0.42        // wheel centre height in truck.glb

// a lamp: its colour times a brightness that the update sets every frame (bloom picks up anything over 1)
const lamp = (hex) =>
{
    const level = uniform(1), m = new THREE.MeshBasicNodeMaterial()
    m.colorNode = color(hex).mul(level)
    m.userData.level = level
    return m
}

export class CarVisual
{
    constructor()
    {
        this.game = Game.getInstance()
        this.group = new THREE.Group()
        this.wheels = []
        this.spin = 0
        this.steer = 0
        this.squash = new Spring(200, 10)
        this.dustT = 0
        this.blink = { t: 0, on: false }
        this.night = uniform(0)
        this.game.scene.add(this.group)

        const src = this.game.stage.models.truck
        if(src) this.setModel(src.scene.clone(true))
        else this.setModel(this.fallback())
        this.setLamps()
        this.setBeams()
        this.setTracks()
        this.setTrails()

        this.game.ticker.events.on('tick', () => this.update(), 6.5)
    }

    fallback()
    {
        const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 2.8), new THREE.MeshLambertMaterial({ color: '#f2c94c' }))
        body.position.y = 0.8; g.add(body); return g
    }

    setModel(model)
    {
        // wheels, and which way the model faces (front wheels minus back wheels)
        const wheels = []; model.traverse(c => { if(/^wheel/i.test(c.name)) wheels.push(c) })
        let fwd = new THREE.Vector3(0, 0, - 1)
        const fronts = wheels.filter(w => /front/i.test(w.name)), backs = wheels.filter(w => /back|rear/i.test(w.name))
        if(fronts.length && backs.length)
        {
            const fc = new THREE.Vector3(), bc = new THREE.Vector3()
            fronts.forEach(w => fc.add(w.position)); backs.forEach(w => bc.add(w.position))
            fwd = fc.divideScalar(fronts.length).sub(bc.divideScalar(backs.length)).setY(0).normalize()
        }
        const holder = new THREE.Group()
        holder.add(model)
        model.position.set(0, - REST - WHEEL_Z, 0)                       // built in metres: wheel centres on the physics wheels
        holder.quaternion.setFromUnitVectors(fwd, new THREE.Vector3(1, 0, 0))   // model forward -> chassis +x
        model.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
        this.group.add(holder)
        this.holder = holder
        this.model = model

        // each model wheel rides the physics wheel nearest to it (0, 1 front; 2, 3 back; z + and -)
        const axle = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize()
        const items = this.game.physicalVehicle.wheels.items
        this.group.updateMatrixWorld(true)
        this.wheels = wheels.map(w =>
        {
            const p = w.position.clone().applyQuaternion(holder.quaternion)
            let best = 0
            items.forEach((it, i) => { if(it.basePosition.distanceTo(new THREE.Vector3(p.x, 0, p.z)) < items[best].basePosition.distanceTo(new THREE.Vector3(p.x, 0, p.z))) best = i })
            return { node: w, base: w.quaternion.clone(), baseY: w.position.y, lift: 0, physical: best, front: /front/i.test(w.name), axle }
        })
    }

    setLamps()
    {
        const find = (re) => { const out = []; this.model.traverse(c => { if(c.isMesh && re.test(c.name)) out.push(c) }); return out }
        const set = (meshes, hex) => { const m = lamp(hex); for(const o of meshes) { o.material = m; o.userData.keepMaterial = true; o.castShadow = false } return m }
        this.lamps = {
            head: set(find(/^headlight/), '#fff1c8'),
            bar: set(find(/^lightbar/), '#f4f7ff'),
            tail: set(find(/^taillight/), '#ff3b2f'),
            reverse: set(find(/^reverse/), '#ffffff'),
            left: set(find(/^blinker-left/), '#ffa21f'),
            right: set(find(/^blinker-right/), '#ffa21f'),
        }
    }

    // two soft cones from the headlights and a pool of light on the ground ahead: additive, by night only
    setBeams()
    {
        const opacity = this.beamOpacity = uniform(0)
        const beam = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
        const along = uv().y                                         // 1 at the lamp, 0 at the far end
        const edge = normalView.dot(positionViewDirection).abs().pow(1.6)
        beam.colorNode = color('#ffe7b0')
        beam.opacityNode = along.pow(2.2).mul(edge).mul(opacity).mul(0.2)
        const length = 10, cone = new THREE.ConeGeometry(2.0, length, 24, 1, true)
        cone.translate(0, - length / 2, 0)                           // apex at the origin, opening along -y
        cone.rotateZ(Math.PI / 2)                                    // ... now along +x
        this.beams = []
        const heads = []; this.model.traverse(c => { if(c.isMesh && /^headlight/.test(c.name)) heads.push(c) })
        this.group.updateMatrixWorld(true)
        for(const h of heads)
        {
            const m = new THREE.Mesh(cone, beam)
            const p = this.group.worldToLocal(h.getWorldPosition(new THREE.Vector3()))
            m.position.copy(p).add(new THREE.Vector3(0.05, 0, 0))
            m.rotation.z = - 0.12                                    // a little down toward the road
            m.renderOrder = 2; m.frustumCulled = false; m.castShadow = false
            m.userData.keepMaterial = true; m.userData.noReveal = true
            this.group.add(m); this.beams.push(m)
        }
        const pool = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
        const d = uv().sub(0.5).mul(2)
        pool.colorNode = color('#ffdca0')
        pool.opacityNode = float(1).sub(d.length()).clamp(0, 1).pow(1.5).mul(opacity).mul(0.32)
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), pool)
        plane.rotation.x = - Math.PI / 2
        plane.position.set(6.2, - REST - 0.38, 0)
        plane.renderOrder = 2; plane.castShadow = false; plane.userData.keepMaterial = true; plane.userData.noReveal = true
        this.group.add(plane); this.pool = plane
    }

    setTracks()
    {
        const tracks = this.game.tracks
        this.tracks = tracks ? this.wheels.map(() => tracks.add(new Track(0.17, 'r'))) : []
    }

    // his boost trails, from the two back corners
    setTrails()
    {
        this.trails = new Trails({ head: '#fff6cf', tail: '#ff7a1a', strength: 5, radius: 0.09 })
        this.trailRefs = [ - 0.62, 0.62 ].map(z => { const o = new THREE.Object3D(); o.position.set(- 1.75, - 0.1, z); this.group.add(o); return { ref: o, item: this.trails.create() } })
    }

    update()
    {
        const g = this.game, v = g.physicalVehicle, p = g.player, dt = g.ticker.delta
        this.group.position.copy(v.position)
        this.group.quaternion.copy(v.quaternion)
        this.group.updateMatrixWorld(true)

        // landing squash, and dust from the back wheels when it digs in
        const j = g.juice
        if(v.wheels && v.wheels.justTouchedCount >= 2 && this.wasAir > 0.25)
        {
            const k = Math.min(1, this.wasAir / 1.2)
            this.squash.kick(- 3 - k * 6)
            if(j) { j.ring(v.position.clone().setY(v.position.y - 0.9), 10 + Math.round(k * 10), '#e9dfc6', 4 + k * 3); j.shake(0.1 + k * 0.35) }
            g.sound && g.sound.land(k)
        }
        this.wasAir = v.wheels && v.wheels.inContactCount === 0 ? (this.wasAir || 0) + dt : 0
        const sq = Math.max(- 0.18, Math.min(0.15, this.squash.update(dt) * 0.25))
        if(this.holder) this.holder.scale.set(1 + sq * 0.4, 1 + sq, 1 + sq * 0.4)
        const driving = g.mode === 'drive'
        if(j && driving && v.wheels && v.wheels.inContactCount >= 2)
        {
            const fast = (v.speed || 0) > 6, boost = p.boosting > 0.5, brake = p.braking > 0.5 && (v.speed || 0) > 3
            this.dustT -= dt
            if((fast || boost || brake) && this.dustT <= 0)
            {
                this.dustT = boost ? 0.035 : 0.07
                const back = new THREE.Vector3(- 1.2, - 0.85, (Math.random() > 0.5 ? 1 : - 1) * 0.75).applyQuaternion(v.quaternion).add(v.position)
                j.dust(back, 1, { size: 0.45 + (boost ? 0.25 : 0), up: 0.6, spread: 0.3, life: 0.8 })
            }
        }

        // wheels: spin, steer (smoothed, as his), and ride the suspension (hanging down in the air)
        this.spin += (v.goingForward ? 1 : - 1) * v.speed * g.ticker.deltaScaled / 0.42
        this.steer += (p.steering * v.steeringAmplitude - this.steer) * Math.min(1, g.ticker.deltaScaled * 16)
        const qs = new THREE.Quaternion(), qy = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0)
        const contact = new THREE.Vector3()
        this.wheels.forEach((w, i) =>
        {
            const pw = v.wheels.items[w.physical]
            const len = pw && pw.inContact && pw.suspensionLength != null ? pw.suspensionLength : 0.88
            const lift = Math.max(- 0.36, Math.min(0.3, REST - len))
            w.lift += (lift - w.lift) * Math.min(1, 25 * g.ticker.deltaScaled)
            w.node.position.y = w.baseY + w.lift
            qs.setFromAxisAngle(w.axle, - this.spin)
            qy.setFromAxisAngle(up, w.front ? this.steer : 0)
            w.node.quaternion.copy(w.base).premultiply(qs).premultiply(qy)
            const t = this.tracks[i]
            if(t)
            {
                if(pw && pw.inContact && pw.contactPoint) contact.copy(pw.contactPoint)
                else w.node.getWorldPosition(contact)
                t.update(contact, !!(pw && pw.inContact))
            }
        })
        if(g.tracks) { const f = g.modes ? g.modes.activePosition() : v.position; g.tracks.focusPoint.set(f.x, f.z); g.tracks.focusHeight = f.y }

        // lights
        const look = g.look, night = look ? look.nightUniform.value : 0
        this.night.value = night
        const L = this.lamps, braking = p.braking > 0.5, reversing = p.accelerating < - 0.1 && !v.goingForward
        L.head.userData.level.value = 1.1 + night * 5
        L.bar.userData.level.value = (driving && p.boosting > 0.5 ? 3.2 : 0.75) + night * 4
        L.tail.userData.level.value = braking ? 5 : 0.9 + night * 2
        L.reverse.userData.level.value = reversing ? 4 : 0.55
        const turning = driving && Math.abs(p.steering) > 0.3
        if(turning || this.blink.on)
        {
            this.blink.t += dt
            if(this.blink.t > 0.4) { this.blink.t = 0; this.blink.on = turning ? !this.blink.on : false }
        }
        else this.blink.t = 0.4
        const side = p.steering > 0 ? 'left' : 'right'
        L.left.userData.level.value = this.blink.on && side === 'left' ? 5 : 0.7
        L.right.userData.level.value = this.blink.on && side === 'right' ? 5 : 0.7
        this.beamOpacity.value = night

        // boost trails
        const boosting = driving && v.goingForward && p.boosting > 0.5 && p.accelerating > 0
        for(const t of this.trailRefs) { t.ref.getWorldPosition(t.item.position); t.item.alpha = boosting ? 1 : 0 }
    }
}
