/* Walker.js — the person you play on foot: a Kenney character (CC0) on a Rapier kinematic character controller.
   Ours, in the style of the engine: runs on the same ticker (deltaScaled), reads the same Inputs actions, and hands
   the camera its position the way folio-2025's Player does for the car. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'
import { Inputs } from '../engine/Inputs/Inputs.js'
import { Spring } from './Juice.js'

export class Walker
{
    constructor()
    {
        this.game = Game.getInstance()
        this.position = this.game.respawns.getDefault().position.clone().add(new THREE.Vector3(- 4, 0, 2))
        this.velocityY = 0
        this.yaw = 0
        this.speed = 0
        this.grounded = false
        this.active = true
        this.squash = new Spring(260, 13)        // + stretches tall, - squashes flat
        this.lean = new Spring(120, 16)
        this.stepPhase = 0
        this.airTime = 0
        this.target = null                        // click-to-go: { point, done }

        this.setBody()
        this.setModel()
        this.game.inputs.addActions([ { name: 'jump', categories: [ 'wandering' ], keys: [ 'Keyboard.Space', 'Gamepad.triangle' ] } ])
        this.game.ticker.events.on('tick', () => this.update(), 2.5)
    }

    setBody()
    {
        const R = this.game.RAPIER, world = this.game.physics.world
        this.half = 0.45; this.radius = 0.35
        this.body = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y, this.position.z))
        this.collider = world.createCollider(R.ColliderDesc.capsule(this.half, this.radius).setCollisionGroups(this.game.physics.categories.object), this.body)
        this.controller = world.createCharacterController(0.05)
        this.controller.enableAutostep(0.45, 0.2, true)
        this.controller.enableSnapToGround(0.4)
        this.controller.setMaxSlopeClimbAngle(50 * Math.PI / 180)
        this.controller.setApplyImpulsesToDynamicBodies(true)
        this.controller.setCharacterMass(1.5)
    }

    // the owner's GitHub avatar (site.js -> avatar, the only picture of him allowed) as the robot's face: a framed
    // plane on the front of the torso box, unlit so it reads from the 15-30 m camera, kept out of look.convert()
    setFace(model)
    {
        const torso = model.getObjectByName('torso'), m = String(this.game.site.avatar || '').match(/github\.com\/([\w-]+)\.png/)
        // github.com/<login>.png redirects without CORS headers; GitHub's avatar host serves the same image with them
        const url = m ? `https://avatars.githubusercontent.com/${m[1]}?s=256` : this.game.site.avatar
        if(!url || !torso) return
        const c = document.createElement('canvas'); c.width = c.height = 256
        const x = c.getContext('2d'), tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
        const round = (r) => { x.beginPath(); x.roundRect(r, r, 256 - 2 * r, 256 - 2 * r, 40 - r); }
        x.fillStyle = '#1d1c1b'; round(0); x.fill()
        const img = new Image(); img.crossOrigin = 'anonymous'
        img.onload = () => { x.save(); round(14); x.clip(); x.drawImage(img, 14, 14, 228, 228); x.restore(); tex.needsUpdate = true }
        img.src = url
        torso.geometry.computeBoundingBox()
        const b = torso.geometry.boundingBox, w = (b.max.x - b.min.x) * 0.74
        const face = new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshBasicMaterial({ map: tex }))
        face.position.set((b.min.x + b.max.x) / 2, b.max.y - w / 2 - (b.max.y - b.min.y) * 0.08, b.max.z + 0.01)
        face.userData.keepMaterial = true
        torso.add(face)
        this.face = face
    }

    setModel()
    {
        this.group = new THREE.Group()
        this.game.scene.add(this.group)
        this.body3 = new THREE.Group()                // squash, stretch and lean happen on this inner group
        this.group.add(this.body3)
        const src = this.game.stage.models.character
        if(!src)
        {
            const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), new THREE.MeshLambertMaterial({ color: '#f2c94c' }))
            m.position.y = 0.8; this.body3.add(m); return
        }
        const model = src.scene.clone(true)
        const box = new THREE.Box3().setFromObject(model), s = box.getSize(new THREE.Vector3()), k = 1.45 / s.y
        model.scale.setScalar(k); model.position.y = - box.min.y * k
        model.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
        this.body3.add(model)
        this.setFace(model)
        this.mixer = new THREE.AnimationMixer(model)
        const clips = src.animations || [], find = (re) => clips.find(c => re.test(c.name))
        this.clips = { idle: find(/idle/i), walk: find(/walk/i), run: find(/sprint|run/i) || find(/walk/i), jump: find(/jump/i), fall: find(/fall/i) || find(/jump/i) }
        this.actions = {}
        for(const [ key, clip ] of Object.entries(this.clips)) if(clip) this.actions[key] = this.mixer.clipAction(clip)
        this.play('idle')
        this.clipNames = clips.map(c => c.name)
    }

    play(name)
    {
        if(!this.actions || this.current === name) return
        const next = this.actions[name] || this.actions.idle; if(!next) return
        const prev = this.current && this.actions[this.current]
        next.reset().setEffectiveWeight(1).fadeIn(0.15).play()
        if(prev && prev !== next) prev.fadeOut(0.15)
        this.current = name
    }

    feet() { return new THREE.Vector3(this.position.x, this.position.y - this.half - this.radius + 0.1, this.position.z) }

    // put the walker somewhere (getting out of a vehicle, respawning)
    moveTo(position, yaw = this.yaw)
    {
        this.position.copy(position)
        this.body.setTranslation(position, true)
        this.body.setNextKinematicTranslation(position)
        this.yaw = yaw; this.velocityY = 0
    }

    // walk on your own towards a point (a click on a person, the truck or the jet), then run `done`
    goTo(point, done)
    {
        this.target = { point: point.clone(), done, t: 0 }
    }

    setActive(active)
    {
        this.active = active
        this.group.visible = active
        this.collider.setEnabled(active)
    }

    // movement direction from keys, gamepad or the touch nipple, relative to the camera
    readMove()
    {
        const a = this.game.inputs.actions, move = new THREE.Vector2()
        if(a.get('forward').active) move.y += 1
        if(a.get('backward').active) move.y -= 1
        if(a.get('right').active) move.x += 1
        if(a.get('left').active) move.x -= 1
        const pad = this.game.inputs.gamepad.joysticks.left
        if(pad.active) move.set(pad.safeX, - pad.safeY)
        let mag = Math.min(1, move.length())
        const theta = this.game.view.spherical.theta
        let dir = null
        if(mag > 0.05) { move.normalize(); const fx = - Math.sin(theta), fz = - Math.cos(theta), rx = Math.cos(theta), rz = - Math.sin(theta); dir = new THREE.Vector2(fx * move.y + rx * move.x, fz * move.y + rz * move.x) }
        const nipple = this.game.inputs.nipple
        if(this.game.inputs.mode === Inputs.MODE_TOUCH && nipple.active && nipple.progress > 0)
        {
            // the nipple's targetAngle is already a world direction: atan2(dz, dx) from the walker to the touch
            dir = new THREE.Vector2(Math.cos(nipple.targetAngle), Math.sin(nipple.targetAngle)); mag = Math.min(1, nipple.progress * 1.4)
        }
        return { dir, mag }
    }

    update()
    {
        if(!this.active) { if(this.mixer) this.mixer.update(this.game.ticker.delta); return }
        const dt = this.game.ticker.deltaScaled, a = this.game.inputs.actions, locked = this.game.modes && this.game.modes.locked
        let { dir, mag } = locked ? { dir: null, mag: 0 } : this.readMove()
        if(dir) this.target = null                                     // any key or stick cancels click-to-go
        if(this.target && !locked)
        {
            const t = this.target, dx = t.point.x - this.position.x, dz = t.point.z - this.position.z, l = Math.hypot(dx, dz)
            t.t += dt
            if(l < 2.6 || t.t > 12) { this.target = null; if(l < 4) t.done && t.done() }
            else { dir = new THREE.Vector2(dx / l, dz / l); mag = 1 }
        }
        const run = !locked && a.get('boost').active
        const target = dir ? (run ? 5.2 : 2.6) * mag : 0
        this.speed += (target - this.speed) * Math.min(1, dt * 8)
        if(dir) { const want = Math.atan2(- dir.y, dir.x); let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 10) }
        // standing still for a moment, the robot turns its face (the owner's avatar) to the camera
        this.still = dir ? 0 : (this.still || 0) + dt
        if(this.still > 1.2 && this.active)
        {
            const c = this.game.view.camera.position, want = Math.atan2(- (c.z - this.position.z), c.x - this.position.x)
            let d = want - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 3)
        }

        // gravity + jump
        const j = this.game.juice, snd = this.game.sound
        if(this.grounded && !locked && a.get('jump').active && !this.jumpHeld)
        {
            this.velocityY = 5.2; this.grounded = false; this.jumpHeld = true
            this.squash.kick(7); snd && snd.jump(); j && j.dust(this.feet(), 4, { size: 0.35, up: 0.4 })
        }
        if(!a.get('jump').active) this.jumpHeld = false
        this.velocityY = Math.max(this.velocityY - 9.81 * dt, - 30)

        const fx = Math.cos(this.yaw), fz = - Math.sin(this.yaw)
        const desired = { x: fx * this.speed * dt, y: this.velocityY * dt, z: fz * this.speed * dt }
        this.controller.computeColliderMovement(this.collider, desired)
        const m = this.controller.computedMovement()
        const p = this.body.translation()
        const next = { x: p.x + m.x, y: p.y + m.y, z: p.z + m.z }
        this.body.setNextKinematicTranslation(next)
        const wasGrounded = this.grounded, fall = this.velocityY
        this.grounded = this.controller.computedGrounded()
        if(!this.grounded) this.airTime += dt
        if(this.grounded && !wasGrounded && this.airTime > 0.18)
        {
            const k = Math.min(1, Math.max(0, (- fall - 2) / 10))
            this.squash.kick(- 3 - k * 6); snd && snd.land(k)
            j && (j.ring(this.feet(), 8 + Math.round(k * 10), '#e9dfc6', 2.5 + k * 3), k > 0.5 && j.shake(k * 0.25))
        }
        if(this.grounded) this.airTime = 0
        if(this.grounded && this.velocityY < 0) this.velocityY = - 0.5
        // bumping into trees and houses makes them wobble
        if(j && this.speed > 1.2) for(let i = 0; i < this.controller.numComputedCollisions(); i++)
        {
            const c = this.controller.computedCollision(i), w = c && c.collider && j.byCollider.get(c.collider.handle)
            if(w) j.bump(w, this.position, this.speed * 1.1)
        }

        // fell into the sea or off the world
        if(next.y < - 6) { this.moveTo(this.game.modes ? this.game.modes.home() : this.game.respawns.getDefault().position.clone()); return }

        this.position.set(next.x, next.y, next.z)
        this.group.position.set(next.x, next.y - this.half - this.radius, next.z)
        this.group.rotation.y = this.yaw + Math.PI / 2

        // squash and stretch (volume kept roughly constant) and a lean into the run
        const rdt = this.game.ticker.delta, sq = Math.max(- 0.35, Math.min(0.3, this.squash.update(rdt) * 0.6))
        this.body3.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5)
        this.lean.target = Math.min(0.22, this.speed * 0.03) + (target - this.speed) * 0.02
        this.body3.rotation.x = this.lean.update(rdt)

        // footsteps: a puff and a tap twice per stride
        if(this.grounded && this.speed > 0.6)
        {
            this.stepPhase += rdt * (this.speed > 3.6 ? 3.2 : 2.2) * Math.max(0.7, this.speed / (this.speed > 3.6 ? 5.2 : 2.6))
            if(this.stepPhase >= 1)
            {
                this.stepPhase -= 1
                snd && snd.step(this.speed > 3.6)
                if(j && this.speed > 3.6) j.dust(this.feet(), 2, { size: 0.3, up: 0.3, spread: 0.4, life: 0.5 })
            }
        }

        // animation
        if(!this.grounded && this.velocityY > 0.5) this.play('jump')
        else if(!this.grounded && this.velocityY < - 3) this.play('fall')
        else if(this.speed > 3.6) this.play('run')
        else if(this.speed > 0.3) this.play('walk')
        else this.play('idle')
        if(this.mixer) this.mixer.update(this.game.ticker.delta * (this.current === 'walk' || this.current === 'run' ? Math.max(0.6, this.speed / (this.current === 'run' ? 5.2 : 2.6)) : 1))

        // camera + touch joystick follow the walker
        if(this.game.mode === 'foot')
        {
            this.game.view.focusPoint.trackedPosition.copy(this.position)
            this.game.inputs.nipple.setCoordinates(this.position.x, this.position.y - 0.8, this.position.z, Math.atan2(fz, fx))
        }
    }
}
