/* Explosions.js — explosive crates and fireballs, ported from folio-2025 (Bruno Simon, MIT): his Explosions.js,
   World/Fireballs.js and World/ExplosiveCrates.js.
   - explode(): an impulse that throws every awake dynamic body in the radius up and away, a roll kick on the camera,
     bullet time when the truck takes a big hit, and (ours) trees bending away and screen shake by distance.
   - fireball(): his noisy sphere that grows, burns from yellow to red and eats itself away. His noise texture is
     replaced by three's 3D noise (mx_noise_float), so no image is needed.
   - crates: our Blender crate (crate.glb) as light sleeping Rapier boxes. Anything that hits one, the truck, the
     jet or the robot, sets it off: a click, then 0.4 s later the boom. A crate comes back 30 s later, once you
     are away. Ours also lets the jet's crash and the robot set them off (the jet is not a Rapier body). */
import * as THREE from 'three/webgpu'
import gsap from 'gsap'
import { Fn, mix, positionGeometry, positionWorld, vec3, vec4, color, uniform, step, mx_noise_float } from 'three/tsl'
import { Game } from '../engine/Game.js'

const remapClamp = (v, a, b, c, d) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return c + (d - c) * t }

// clusters of crates: [ x, z, layout ] — a pyramid of 3 + 1, a row of 3, or a single crate
const SPOTS = [
    [ - 76, - 103.5, 'pyramid' ],         // by the start disc, on the way to the letters
    [ 0, - 80, 'row' ],
    [ - 80, 10, 'pyramid' ],
    [ 20, 70, 'row' ],
    [ 60, - 80, 'pyramid' ],
    [ - 50, - 80, 'single' ],
    [ 100, - 80, 'single' ],
]
const LAYOUTS = {
    pyramid: [ [ - 0.55, 0, 0 ], [ 0.55, 0, 0 ], [ 0, 0, 0.95 ], [ 0, 1, 0.45 ] ],      // x, layer, z
    row: [ [ - 1.15, 0, 0 ], [ 0, 0, 0.15 ], [ 1.15, 0, - 0.1 ] ],
    single: [ [ 0, 0, 0 ] ],
}

export class Explosions
{
    constructor()
    {
        this.game = Game.getInstance()
        this.crates = []
        this.setFireballs()
        this.setCrates()
        this.game.ticker.events.on('tick', () => this.update(), 10.5)
    }

    // ---------------------------------------------------------------- his Explosions.explode
    explode(coordinates, radius = 7, strength = 4, bulletTimeStrengthThreshold = 3)
    {
        const g = this.game
        const distance = g.view.focusPoint.position.distanceTo(coordinates)
        g.view.roll.kick(remapClamp(distance, 2, 15, 1, 0))
        if(g.juice)
        {
            g.juice.shake(remapClamp(distance, 4, 40, 0.8, 0))
            for(const w of g.juice.wobblers) if(Math.hypot(w.x - coordinates.x, w.z - coordinates.z) < radius * 2.2) g.juice.bump(w, coordinates, 4)
        }

        let vehicleHit = false
        const position = new THREE.Vector3()
        for(const object of g.objects.list)
        {
            const physical = object.physical
            if(!physical || physical.type !== 'dynamic' || !physical.body.isEnabled()) continue
            position.copy(physical.body.translation())
            const direction = position.clone().sub(coordinates); direction.y = 0
            const faded = remapClamp(Math.hypot(direction.x, direction.z), 1, radius, 1, 0)
            if(faded <= 0) continue
            const impulse = direction.setLength(0.5); impulse.y = 1; impulse.normalize()
            const final = faded * strength
            impulse.setLength(final * physical.body.mass())
            const point = position.clone()
            g.ticker.wait(1, () => physical.body.applyImpulseAtPoint(impulse, point, true))
            if(physical === g.physicalVehicle.chassis.physical && final > bulletTimeStrengthThreshold) { g.time.bulletTime.activate(); vehicleHit = true }
        }
        return vehicleHit
    }

    // ---------------------------------------------------------------- his Fireballs
    setFireballs()
    {
        this.fireGeometry = new THREE.SphereGeometry(0.5, 12, 6)
        this.colorA = uniform(color('#ff2a12'))
        this.colorB = uniform(color('#ffb238'))
        this.emissive = uniform(8)
    }

    fireball(coordinates, fireRadius = 5, explosionRadius = 5)
    {
        const g = this.game, material = new THREE.MeshBasicNodeMaterial()
        const progress = uniform(0.5)
        const ground = uniform(coordinates.y - 0.6)
        material.outputNode = Fn(() =>
        {
            const noise = mx_noise_float(positionGeometry.mul(1.6)).mul(0.5).add(0.5).remap(0.15, 0.9, 0, 1).toVar()
            noise.mulAssign(positionWorld.y.sub(ground).mul(2).clamp(0, 1))       // floor attenuation (his is at y 0)
            noise.subAssign(progress)
            const emissive = mix(this.colorA, this.colorB, noise).mul(this.emissive)
            const goo = g.fog ? g.fog.strength.mix(vec3(0.08, 0.06, 0.07), g.fog.color) : vec3(0.08)
            const final = mix(emissive, goo, step(noise, 0.1))
            noise.lessThan(0).discard()
            return vec4(final, 1)
        })()
        const mesh = new THREE.Mesh(this.fireGeometry, material)
        mesh.position.copy(coordinates)
        mesh.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, 0, 'XYZ')
        mesh.userData.noReveal = true
        g.scene.add(mesh)

        const scale = { value: 0 }
        gsap.fromTo(scale, { value: 0.5 }, { value: fireRadius, duration: 0.6, ease: 'power3.out', onUpdate: () => mesh.scale.setScalar(scale.value) })
        gsap.fromTo(mesh.rotation, { z: 0 }, { z: - 1, duration: 2.25, ease: 'linear' })
        gsap.fromTo(progress, { value: 0.15 }, { value: 1, duration: 2, delay: 0.25, ease: 'linear' })
        g.sound && g.sound.boom()
        if(g.juice) { g.juice.sparkle(coordinates, 20, '#ffb238'); g.juice.dust(coordinates, 5, { color: '#4a4542', spread: fireRadius * 0.4, up: 3, size: 0.9, life: 1.4 }) }
        this.explode(coordinates, explosionRadius, 8)
        gsap.delayedCall(2.25, () => { mesh.removeFromParent(); material.dispose() })
    }

    // ---------------------------------------------------------------- his ExplosiveCrates, on our model
    setCrates()
    {
        const g = this.game, src = g.stage.models.crate
        const model = src ? src.scene : new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#c8412d' }))
        model.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
        let id = 0
        for(const [ x, z, layout ] of SPOTS)
        {
            const yaw = (x * 7 + z * 3) % 6.28
            const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
            for(const [ dx, layer, dz ] of LAYOUTS[layout])
            {
                const off = new THREE.Vector3(dx, 0, dz).applyQuaternion(q)
                const px = x + off.x, pz = z + off.z
                const y = g.stage.height(px, pz) + 0.5 + layer * 1.0 + 0.02
                const crate = { id: id++, exploded: false, home: new THREE.Vector3(px, y, pz) }
                const visual = new THREE.Group(); visual.add(model.clone(true))
                crate.object = g.objects.add({ model: visual }, {
                    type: 'dynamic',
                    position: crate.home.clone(),
                    rotation: q.clone(),
                    friction: 0.7,
                    mass: 0.02,
                    sleeping: true,
                    colliders: [ { shape: 'cuboid', parameters: [ 0.5, 0.5, 0.5 ], category: 'object' } ],
                    contactThreshold: 0,
                    onCollision: () => this.trigger(crate),
                })
                this.crates.push(crate)
            }
        }
    }

    trigger(crate)
    {
        if(crate.exploded) return
        crate.exploded = true
        const g = this.game, body = crate.object.physical.body
        g.sound && g.sound.tone({ type: 'square', f0: 2400, f1: 1800, d: 0.05, peak: 0.12 })
        gsap.delayedCall(0.4, () =>
        {
            const p = new THREE.Vector3().copy(body.translation())
            g.objects.disable(crate.object)
            this.fireball(p)
            g.achievements && g.achievements.unlock('crates')
            crate.back = 30
        })
    }

    update()
    {
        const g = this.game, dt = g.ticker.delta
        // the jet and the robot are not dynamic bodies: they set crates off by distance
        const jet = g.mode === 'fly' && g.jet ? g.jet.position : null
        const walker = g.mode === 'foot' && g.walker ? g.walker.position : null
        const p = new THREE.Vector3()
        for(const crate of this.crates)
        {
            if(crate.exploded)
            {
                if(crate.back > 0 && (crate.back -= dt) <= 0)
                {
                    const here = g.modes ? g.modes.activePosition() : g.physicalVehicle.position
                    if(here.distanceTo(crate.home) < 25) { crate.back = 3; continue }
                    g.objects.resetObject(crate.object)
                    crate.exploded = false
                }
                continue
            }
            p.copy(crate.object.physical.body.translation())
            if((jet && jet.distanceTo(p) < 4) || (walker && walker.distanceTo(p) < 1.25)) this.trigger(crate)
        }
    }
}
