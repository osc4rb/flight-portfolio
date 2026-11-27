/* Jet.js — the jet you can climb into at the airstrip. The airframe comes from our own planes.js (F-35A / F-47
   concept, built in code); the flight model is arcade, sized for this small world. Forward = +x like the car.
   W pulls up, S pushes down, A/D bank and turn, Shift afterburner, B / Ctrl brake or throttle back. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'

const UP = new THREE.Vector3(0, 1, 0)

export class Jet
{
    constructor()
    {
        this.game = Game.getInstance()
        this.stage = this.game.stage
        this.group = new THREE.Group()
        this.game.scene.add(this.group)
        this.position = new THREE.Vector3()
        this.forward = new THREE.Vector3(1, 0, 0)
        this.up = new THREE.Vector3(0, 1, 0)
        this.state = { yaw: 0, pitch: 0, bank: 0, v: 0, thr: 0, ground: true, pilot: false }
        this.chase = { pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false }

        this.setModel()
        this.setFx()
        this.setBody()
        this.park()
        this.game.ticker.events.on('tick', () => this.update(), 2.6)
    }

    setModel()
    {
        const planes = (window.FlightParts || {}).planes || {}, def = planes[(this.game.site.aircraft || 'f35')] || planes[Object.keys(planes)[0]]
        // our Blender jet (tools/blender-scripts/bake_models.py) is already in these metres, nose toward -z, on the
        // same envelope as the planes.js airframe; planes.js stays as the fallback
        const own = this.game.stage.models.jet
        let airframe
        if(own) airframe = own.scene.clone(true)
        else if(def) airframe = def.build(THREE).group
        else { airframe = new THREE.Mesh(new THREE.ConeGeometry(1, 12, 6).rotateX(- Math.PI / 2), new THREE.MeshLambertMaterial({ color: '#8a9097' })) }
        if(!own)
        {
            const box = new THREE.Box3().setFromObject(airframe), size = box.getSize(new THREE.Vector3()), k = 12 / Math.max(size.z, 1)
            airframe.scale.setScalar(k)
            airframe.position.set(- (box.min.x + box.max.x) / 2 * k, - box.min.y * k, - (box.min.z + box.max.z) / 2 * k)
        }
        const holder = new THREE.Group(); holder.rotation.y = - Math.PI / 2; holder.add(airframe)   // model nose -z -> +x
        airframe.traverse(c => { if(c.isMesh) { c.castShadow = true } })
        this.model = new THREE.Group(); this.model.add(holder)
        this.gearH = 1.6
        this.model.position.y = this.gearH
        // landing gear: three simple legs
        const leg = new THREE.MeshLambertMaterial({ color: '#c9ccd0' }), tyre = new THREE.MeshLambertMaterial({ color: '#202226' })
        this.gear = new THREE.Group()
        for(const [ x, z ] of [ [ 3.4, 0 ], [ - 1.2, - 1.5 ], [ - 1.2, 1.5 ] ])
        {
            const s = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, this.gearH - 0.35, 6), leg); s.position.set(x, (this.gearH - 0.35) / 2 + 0.35, z)
            const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.25, 12).rotateX(Math.PI / 2), tyre); w.position.set(x, 0.35, z)
            this.gear.add(s, w)
        }
        this.group.add(this.model, this.gear)
        this.length = 12
    }

    // speed lines, the afterburner flame and the FOV kick (folio-2025's car has its own boost streaks; these are ours)
    setFx()
    {
        const add = THREE.AdditiveBlending
        this.flame = new THREE.Group()
        for(const [ r, len, color, op ] of [ [ 0.62, 5, '#ff8a2a', 0.55 ], [ 0.34, 3.4, '#cfe6ff', 0.8 ] ])
        {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(r, len, 14, 1, true).translate(0, len / 2, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: add, depthWrite: false }))
            cone.userData.keepMaterial = true; this.flame.add(cone)
        }
        this.flame.position.set(- 6.1, this.gearH + 0.85, 0); this.flame.visible = false
        this.group.add(this.flame)

        this.lines = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.045, 0.045).translate(- 0.5, 0, 0), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }), 70)
        this.lines.userData.keepMaterial = true; this.lines.frustumCulled = false; this.lines.visible = false
        this.game.scene.add(this.lines)
        this.linePos = Array.from({ length: 70 }, () => new THREE.Vector3(1e5, 0, 0))
        this.fx = { fov: 25, boost: 0, wasBoost: false }
    }

    updateFx(boost)
    {
        const s = this.state, dt = this.game.ticker.delta, fx = this.fx, flying = s.pilot && !s.ground
        fx.boost += ((boost ? 1 : 0) - fx.boost) * Math.min(1, dt * (boost ? 6 : 2.5))
        if(flying && boost && !fx.wasBoost) { this.game.sound.boost(); this.game.juice.shake(0.12); this.game.view.roll.kick(0.6) }
        fx.wasBoost = flying && boost

        // flame: a lick at idle, long on afterburner
        const len = s.pilot ? 0.25 + s.thr * 0.5 + fx.boost * 1.3 : 0
        this.flame.visible = len > 0.05
        this.flame.scale.set(len * (0.9 + Math.random() * 0.2), 1 + fx.boost * 0.25, 1 + fx.boost * 0.25)

        // speed lines: fixed in the world ahead of the camera, so the jet's own speed streams them past
        const k = flying ? Math.min(1, Math.max(0, (s.v - 30) / 40)) * 0.45 + fx.boost * 0.35 : 0
        this.lines.visible = k > 0.01
        if(!this.lines.visible) return
        this.lines.material.opacity = k
        const cam = this.chase.pos, f = this.forward, side = new THREE.Vector3().crossVectors(f, UP).normalize(), up = new THREE.Vector3().crossVectors(side, f), d = new THREE.Object3D()
        const len2 = 2 + s.v * 0.08 + fx.boost * 5
        this.linePos.forEach((p, i) =>
        {
            const rel = p.clone().sub(cam), ahead = rel.dot(f)
            if(ahead < - 2 || ahead > 130 || rel.lengthSq() > 160 * 160)
            {
                const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 14
                p.copy(cam).addScaledVector(f, 50 + Math.random() * 80).addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r)
            }
            d.position.copy(p); d.quaternion.copy(this.group.quaternion); d.scale.set(len2, 1, 1); d.updateMatrix()
            this.lines.setMatrixAt(i, d.matrix)
        })
        this.lines.instanceMatrix.needsUpdate = true
    }

    setBody()
    {
        const R = this.game.RAPIER, world = this.game.physics.world
        this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased())
        world.createCollider(R.ColliderDesc.cuboid(6, 1.2, 1.6).setTranslation(0, this.gearH + 0.8, 0), this.body)
        world.createCollider(R.ColliderDesc.cuboid(1.8, 0.3, 4.8).setTranslation(- 1, this.gearH + 0.8, 0), this.body)
    }

    park()
    {
        const rw = this.stage.runway, x = rw.x0 + 18, z = rw.z
        Object.assign(this.state, { yaw: 0, pitch: 0, bank: 0, v: 0, thr: 0, ground: true })
        this.position.set(x, this.stage.height(x, z), z)
        this.applyPose(true)
    }

    applyPose(teleport = false)
    {
        const s = this.state
        this.group.position.copy(this.position)
        this.group.quaternion.setFromEuler(new THREE.Euler(s.bank, s.yaw, s.pitch, 'YZX'))
        this.forward.set(1, 0, 0).applyQuaternion(this.group.quaternion)
        this.up.set(0, 1, 0).applyQuaternion(this.group.quaternion)
        const q = this.group.quaternion, p = this.position
        if(teleport) { this.body.setTranslation(p, true); this.body.setRotation(q, true) }
        else { this.body.setNextKinematicTranslation(p); this.body.setNextKinematicRotation(q) }
    }

    // where the pilot climbs out, and where the walker needs to stand to get in
    get door() { return this.position.clone().add(new THREE.Vector3(0, 0, 3.2).applyAxisAngle(UP, this.state.yaw)) }

    enter() { this.state.pilot = true; this.state.thr = Math.max(this.state.thr, 0.25); this.chase.init = false; this.fx.fov = 46; this.game.hud.toast('Hold W to roll, past 100 kt W lifts off · Shift afterburner') }
    exit() { this.state.pilot = false; this.state.thr = 0; this.setFov(25); this.lines.visible = false; this.flame.visible = false }

    input()
    {
        const a = this.game.inputs.actions, pad = this.game.inputs.gamepad.joysticks.left, n = this.game.inputs.nipple
        let pitch = (a.get('forward').active ? 1 : 0) - (a.get('backward').active ? 1 : 0)
        let roll = (a.get('right').active ? 1 : 0) - (a.get('left').active ? 1 : 0)
        if(pad.active) { pitch = - pad.safeY; roll = pad.safeX }
        if(n.active && n.progress > 0) { const ang = n.smallestAngle; roll = Math.max(- 1, Math.min(1, - ang * 1.2)); pitch = n.forward ? n.progress : - n.progress }
        return { pitch, roll, boost: a.get('boost').active, brake: a.get('brake').active }
    }

    update()
    {
        const s = this.state, dt = this.game.ticker.deltaScaled * 0.5      // the engine runs at 2x; flight feels better at 1x
        const inp = s.pilot && !(this.game.modes && this.game.modes.locked) ? this.input() : { pitch: 0, roll: 0, boost: false, brake: !s.ground ? false : true }

        // throttle: up while W on the ground or flying, back with brake; afterburner on Shift
        if(s.pilot) s.thr = Math.min(1, Math.max(0, s.thr + ((inp.brake ? - 0.8 : 0) + (s.ground && inp.pitch > 0 ? 0.6 : 0) + (!s.ground ? 0.15 : 0)) * dt))
        const thrust = (s.thr * 11 + (inp.boost && s.pilot ? 12 : 0)) * (s.pilot ? 1 : 0)

        if(s.ground)
        {
            const brake = inp.brake ? 14 : (s.thr < 0.05 ? 2 : 0.4)
            s.v = Math.max(0, s.v + (thrust - 0.002 * s.v * s.v - (s.v > 0.1 ? brake : 0)) * dt)
            s.yaw -= inp.roll * 0.6 * Math.min(1, s.v / 4) * dt
            s.bank *= 0.8
            s.pitch = s.v > 24 && inp.pitch > 0 ? Math.min(0.2, s.pitch + 0.5 * dt) : Math.max(0, s.pitch - 0.6 * dt)
            this.position.x += Math.cos(s.yaw) * s.v * dt; this.position.z -= Math.sin(s.yaw) * s.v * dt
            const gy = this.stage.height(this.position.x, this.position.z); this.position.y = gy
            if(s.pilot && s.v > 8) this.game.juice.shake(Math.min(0.012, s.v * 0.0004))                // runway rumble
            if(s.v > 26 && s.pitch > 0.12) { s.ground = false; this.position.y += 0.4; this.game.sound.whoosh(); this.game.achievements && this.game.achievements.unlock('takeoff'); this.game.hud.toast('Wheels up · E bails out') }
            if(s.v > 8 && Math.abs(gy - this.stage.runway.y) > 1.5) this.crash('Ran off the runway')
        }
        else
        {
            // bank up to 77° and get there quickly; the turn follows the bank, capped so it stays flyable
            const wantBank = inp.roll * 1.35
            s.bank += (wantBank - s.bank) * Math.min(1, dt * 6)
            s.pitch = Math.max(- 1.1, Math.min(1.1, s.pitch + inp.pitch * 1.2 * dt))
            if(Math.abs(inp.pitch) < 0.05) s.pitch -= s.pitch * 0.4 * dt                      // gentle self-levelling
            s.yaw -= Math.max(- 1.1, Math.min(1.1, 9.81 * Math.tan(s.bank) / Math.max(s.v, 18) * 2.2)) * dt
            if(s.v < 17) s.pitch -= (17 - s.v) * 0.05 * dt                                     // stall: nose drops
            s.v = Math.min(90, Math.max(10, s.v + (thrust - 0.0035 * s.v * s.v - 9.81 * Math.sin(s.pitch)) * dt))
            const cp = Math.cos(s.pitch)
            this.position.x += Math.cos(s.yaw) * cp * s.v * dt; this.position.z -= Math.sin(s.yaw) * cp * s.v * dt; this.position.y += Math.sin(s.pitch) * s.v * dt
            // stay over the area: turn back gently
            const r = Math.hypot(this.position.x, this.position.z)
            if(r > 330) { const back = Math.atan2(this.position.z, - this.position.x); let d = back - s.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); s.yaw += Math.sign(d) * 0.5 * dt; s.bank += (Math.sign(d) * - 0.6 - s.bank) * dt }
            if(this.position.y > 220) s.pitch = Math.min(s.pitch, 0)
            // touchdown or crash
            const gy = this.stage.height(this.position.x, this.position.z), agl = this.position.y - Math.max(gy, - 0.4)
            if(agl <= 0)
            {
                const sink = - Math.sin(s.pitch) * s.v, onRunway = Math.abs(this.position.z - this.stage.runway.z) < 9 && this.position.x > this.stage.runway.x0 && this.position.x < this.stage.runway.x1
                if(onRunway && sink < 6 && Math.abs(s.bank) < 0.4 && s.pitch > - 0.15) { s.ground = true; s.pitch = 0; this.position.y = gy; this.game.juice.shake(0.2 + sink * 0.05); this.game.sound.land(0.6); this.game.juice.ring(this.position.clone(), 18, '#d9d6cf', 7); this.game.hud.toast('Touchdown! Brake with B', true); this.game.achievements && this.game.achievements.unlock('land') }
                else this.crash(gy < - 0.4 ? 'Splashdown' : 'Crashed')
            }
            // rock: the course's peaks, arches and tunnel
            const course = this.game.course, clear = course ? course.distance(this.position) : 1e9
            if(clear < 0) this.crash('Hit the rock')
            else if(clear < 6 && s.v > 25 && performance.now() - (this.nearT || 0) > 700) { this.nearT = performance.now(); this.game.sound.whoosh(); this.game.juice.shake(0.08); this.game.achievements && this.game.achievements.unlock('near') }
        }

        if(s.pilot && inp.boost && !s.ground) this.game.juice.shake(0.006)                                   // afterburner buzz
        this.updateFx(s.pilot && inp.boost)
        this.gear.visible = s.ground || this.position.y - this.stage.height(this.position.x, this.position.z) < 25
        this.applyPose()

        if(s.pilot) this.game.view.focusPoint.trackedPosition.copy(this.position)
    }

    crash(reason)
    {
        const s = this.state
        if(this.crashing) return
        this.crashing = true
        this.game.hud.toast(reason + '. Back to the airstrip…')
        if(reason === 'Splashdown') this.game.achievements && this.game.achievements.unlock('splash')
        if(reason !== 'Respawn')
        {
            const j = this.game.juice, p = this.position.clone()
            j.shake(0.9)
            if(reason !== 'Splashdown' && this.game.explosions) this.game.explosions.fireball(p.clone().setY(Math.max(p.y, this.stage.height(p.x, p.z) + 1)), 7, 9)
            else this.game.sound.boom()
            j.ring(p, 24, reason === 'Splashdown' ? '#e6f4fb' : '#9a948a', 9); j.dust(p, 14, { color: '#6d6a66', spread: 3, up: 4, size: 1.4, life: 1.4 }); j.sparkle(p, 24, '#ff9a3c')
        }
        this.game.view.roll.kick(3)
        const wasPilot = s.pilot
        s.v = 0; s.thr = 0
        this.game.hud.wipe(() =>
        {
            this.park()
            if(wasPilot) this.game.modes.leave('fly', true)
            this.crashing = false
        })
    }

    // chase camera while flying (folio-2025's View calls game.cameraOverride when it is set)
    camera(cam)
    {
        const s = this.state, fx = this.fx, dt = this.game.ticker.delta
        // FOV opens with speed and kicks on the afterburner; the camera hangs back a little more when fast
        const fovWant = 46 + Math.min(1, Math.max(0, (s.v - 25) / 55)) * 10 + fx.boost * 12
        fx.fov += (fovWant - fx.fov) * Math.min(1, dt * (fovWant > fx.fov ? 5 : 2))
        this.setFov(fx.fov)
        const back = 17 + Math.min(1, s.v / 80) * 4 + fx.boost * 2
        const want = this.position.clone().addScaledVector(this.forward, - back).addScaledVector(UP, 4.6)
        const look = this.position.clone().addScaledVector(this.forward, 30)
        const k = this.chase.init ? Math.min(1, dt * 8) : 1
        this.chase.pos.lerp(want, k); this.chase.look.lerp(look, k); this.chase.init = true
        cam.position.copy(this.chase.pos)
        cam.up.copy(UP).lerp(this.up, 0.35).normalize()
        cam.lookAt(this.chase.look)
        cam.up.copy(UP)
    }

    setFov(fov)
    {
        const v = this.game.view
        for(const c of [ v.camera, v.defaultCamera ]) if(Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix() }
    }
}
