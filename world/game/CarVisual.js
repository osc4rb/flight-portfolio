/* CarVisual.js — a Kenney truck (CC0) riding on folio-2025's PhysicsVehicle chassis (forward = +x).
   His VisualVehicle.js loads his own car model, so this replaces it: same idea, our model. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'
import { Spring } from './Juice.js'

export class CarVisual
{
    constructor()
    {
        this.game = Game.getInstance()
        this.group = new THREE.Group()
        this.wheels = []
        this.spin = 0
        this.squash = new Spring(200, 10)
        this.dustT = 0
        this.game.scene.add(this.group)

        const src = this.game.stage.models.truck
        if(src) this.setModel(src.scene.clone(true))
        else this.setModel(this.fallback())

        this.game.ticker.events.on('tick', () => this.update(), 6.5)
    }

    fallback()
    {
        const g = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 2.8), new THREE.MeshLambertMaterial({ color: '#f2c94c' }))
        body.position.y = 0.8; g.add(body); return g
    }

    setModel(model)
    {
        // find wheels and which way the model faces (front wheels named "front" where Kenney names them)
        const wheels = []; model.traverse(c => { if(/wheel/i.test(c.name)) wheels.push(c) })
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3())
        let fwd = new THREE.Vector3(0, 0, - 1)
        const fronts = wheels.filter(w => /front/i.test(w.name)), backs = wheels.filter(w => /back|rear/i.test(w.name))
        if(fronts.length && backs.length)
        {
            const fc = new THREE.Vector3(), bc = new THREE.Vector3()
            fronts.forEach(w => fc.add(w.getWorldPosition(new THREE.Vector3()))); backs.forEach(w => bc.add(w.getWorldPosition(new THREE.Vector3())))
            fwd = fc.divideScalar(fronts.length).sub(bc.divideScalar(backs.length)).setY(0).normalize()
        }
        else if(size.x > size.z) fwd.set(1, 0, 0)

        const k = 3.0 / Math.max(size.x, size.z)
        const holder = new THREE.Group()
        holder.add(model)
        model.scale.setScalar(k)
        model.position.set(- (box.min.x + box.max.x) / 2 * k, - box.min.y * k - 1.28, - (box.min.z + box.max.z) / 2 * k)
        holder.quaternion.setFromUnitVectors(fwd, new THREE.Vector3(1, 0, 0))   // model forward -> chassis +x
        model.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
        this.group.add(holder)
        this.holder = holder

        const axle = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), fwd).normalize()
        this.wheels = wheels.map(w => ({ node: w, base: w.quaternion.clone(), front: /front/i.test(w.name) || (!fronts.length && w.position.dot(fwd) > 0), axle }))
    }

    update()
    {
        const v = this.game.physicalVehicle
        this.group.position.copy(v.position)
        this.group.quaternion.copy(v.quaternion)

        // landing squash, and dust from the back wheels when it digs in
        const g = this.game, j = g.juice, dt = g.ticker.delta
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
        if(j && g.mode === 'drive' && v.wheels && v.wheels.inContactCount >= 2)
        {
            const fast = (v.speed || 0) > 6, boost = g.player.boosting > 0.5, brake = g.player.braking > 0.5 && (v.speed || 0) > 3
            this.dustT -= dt
            if((fast || boost || brake) && this.dustT <= 0)
            {
                this.dustT = boost ? 0.035 : 0.07
                const back = new THREE.Vector3(- 1.2, - 0.85, (Math.random() > 0.5 ? 1 : - 1) * 0.75).applyQuaternion(v.quaternion).add(v.position)
                j.dust(back, 1, { size: 0.45 + (boost ? 0.25 : 0), up: 0.6, spread: 0.3, life: 0.8 })
            }
        }

        this.spin += (v.goingForward ? 1 : - 1) * v.speed * this.game.ticker.deltaScaled / 0.4
        const steer = this.game.player.steering * v.steeringAmplitude
        const qs = new THREE.Quaternion(), qy = new THREE.Quaternion()
        for(const w of this.wheels)
        {
            qs.setFromAxisAngle(w.axle, - this.spin)
            qy.setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.front ? steer : 0)
            w.node.quaternion.copy(w.base).premultiply(qs).premultiply(qy)
        }
    }
}
