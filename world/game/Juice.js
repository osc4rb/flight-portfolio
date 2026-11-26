/* Juice.js — the small reactions that make the world feel alive:
   - Spring: a damped spring used for squash and stretch, wobbles and pops
   - particles: dust puffs, leaves, sparkles and confetti from two pooled instanced meshes
   - camera shake: trauma that decays, applied after folio-2025's View has placed the camera
   - wobblers: trees and houses that sway or squash when the truck or the walker bumps them
   - hover: the pointer lights up what you can use (people, the truck, the jet); a click walks you there */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'

export class Spring
{
    constructor(stiffness = 220, damping = 14) { this.k = stiffness; this.c = damping; this.x = 0; this.v = 0; this.target = 0 }
    kick(v) { this.v += v; return this }
    update(dt)
    {
        dt = Math.min(dt, 1 / 30)
        const a = - this.k * (this.x - this.target) - this.c * this.v
        this.v += a * dt; this.x += this.v * dt
        if(Math.abs(this.v) < 1e-4 && Math.abs(this.x - this.target) < 1e-4) { this.x = this.target; this.v = 0 }
        return this.x
    }
    get resting() { return this.v === 0 && this.x === this.target }
}

const MAX = 600

class Pool
{
    constructor(scene, geometry, material)
    {
        this.mesh = new THREE.InstancedMesh(geometry, material, MAX)
        this.mesh.frustumCulled = false
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        this.mesh.setColorAt(0, new THREE.Color())
        this.items = []
        this.free = []
        for(let i = 0; i < MAX; i++) { this.items.push({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), size: 1, spin: 0, rot: 0, grav: 0, drag: 0, grow: 0 }); this.free.push(i) }
        this.d = new THREE.Object3D()
        this.zero = new THREE.Matrix4().makeScale(0, 0, 0)
        for(let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this.zero)
        scene.add(this.mesh)
        this.alive = 0
    }

    emit(o, color)
    {
        const i = this.free.pop(); if(i === undefined) return
        const it = this.items[i]
        Object.assign(it, { life: o.life, max: o.life, size: o.size, spin: o.spin || 0, rot: Math.random() * 6.3, grav: o.grav || 0, drag: o.drag || 0, grow: o.grow || 0 })
        it.p.copy(o.p); it.v.copy(o.v)
        this.mesh.setColorAt(i, color); this.mesh.instanceColor.needsUpdate = true
        this.alive++
    }

    update(dt)
    {
        if(!this.alive) return
        const d = this.d
        for(let i = 0; i < MAX; i++)
        {
            const it = this.items[i]; if(it.life <= 0) continue
            it.life -= dt
            if(it.life <= 0) { this.mesh.setMatrixAt(i, this.zero); this.free.push(i); this.alive--; continue }
            it.v.y -= it.grav * dt; it.v.multiplyScalar(Math.max(0, 1 - it.drag * dt)); it.p.addScaledVector(it.v, dt); it.rot += it.spin * dt
            const k = it.life / it.max, s = it.size * (it.grow ? (1 + (1 - k) * it.grow) * Math.min(1, k * 3) : Math.min(1, k * 2.5)) * Math.min(1, (1 - k) * 12 + 0.2)
            d.position.copy(it.p); d.rotation.set(it.rot, it.rot * 0.7, 0); d.scale.setScalar(s); d.updateMatrix()
            this.mesh.setMatrixAt(i, d.matrix)
        }
        this.mesh.instanceMatrix.needsUpdate = true
    }
}

export class Juice
{
    constructor()
    {
        this.game = Game.getInstance()
        const scene = this.game.scene
        this.low = this.game.quality.level > 0
        // dust, leaves and confetti are lit; sparkles are unlit and bright enough for the bloom pass to catch
        this.lit = new Pool(scene, new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }))
        this.lit.mesh.castShadow = false
        const glowMat = new THREE.MeshBasicMaterial({ toneMapped: false }); glowMat.fog = false
        this.glow = new Pool(scene, new THREE.OctahedronGeometry(0.5, 0), glowMat)
        this.c = new THREE.Color()
        this.v = new THREE.Vector3()

        this.trauma = 0
        this.shakeT = 0
        this.wobblers = []
        this.byCollider = new Map()

        this.game.ticker.events.on('tick', () => this.update(), 7.2)          // right after View (7) places the camera
        this.setPointer()
    }

    // ---------------------------------------------------------------- particles
    dust(p, n = 6, { color = '#e9dfc6', spread = 1, up = 1, size = 0.5, life = 0.7 } = {})
    {
        if(this.low) n = Math.ceil(n / 2)
        for(let i = 0; i < n; i++)
        {
            const a = Math.random() * 6.283, r = Math.random() * spread
            this.v.set(Math.cos(a) * r * 2.2, (0.4 + Math.random()) * up, Math.sin(a) * r * 2.2)
            this.lit.emit({ p: this.v.clone().multiplyScalar(0.25).add(p), v: this.v, life: life * (0.7 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8), drag: 2.5, grow: 1.6, spin: 2 }, this.c.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.06))
        }
    }
    ring(p, n = 14, color = '#e9dfc6', speed = 4)
    {
        if(this.low) n = Math.ceil(n / 2)
        for(let i = 0; i < n; i++)
        {
            const a = i / n * 6.283 + Math.random() * 0.3
            this.v.set(Math.cos(a) * speed, 0.6 + Math.random() * 0.6, Math.sin(a) * speed)
            this.lit.emit({ p: p.clone().addScaledVector(this.v, 0.06), v: this.v, life: 0.55 + Math.random() * 0.3, size: 0.45 + Math.random() * 0.35, drag: 4, grow: 1.4, spin: 3 }, this.c.set(color))
        }
    }
    leaves(p, n = 10)
    {
        for(let i = 0; i < n; i++)
        {
            this.v.set((Math.random() - 0.5) * 4, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 4)
            this.lit.emit({ p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 2)), v: this.v, life: 1.4 + Math.random(), size: 0.22 + Math.random() * 0.15, grav: 3, drag: 1.6, spin: 6 }, this.c.set('#5aa34f').offsetHSL((Math.random() - 0.5) * 0.08, 0, (Math.random() - 0.5) * 0.15))
        }
    }
    sparkle(p, n = 14, color = '#ffd34d')
    {
        for(let i = 0; i < n; i++)
        {
            this.v.set((Math.random() - 0.5), Math.random() * 0.8 + 0.3, (Math.random() - 0.5)).normalize().multiplyScalar(3 + Math.random() * 4)
            this.glow.emit({ p: p.clone(), v: this.v, life: 0.45 + Math.random() * 0.35, size: 0.18 + Math.random() * 0.16, grav: 6, drag: 3, spin: 8 }, this.c.set(color).multiplyScalar(2.2))
        }
    }
    confetti(p, n = 40)
    {
        const colors = [ '#f2c94c', '#5fb3cf', '#9fe0b7', '#ef8a6f', '#b9a6ff', '#ffffff' ]
        for(let i = 0; i < n; i++)
        {
            this.v.set((Math.random() - 0.5) * 7, 6 + Math.random() * 6, (Math.random() - 0.5) * 7)
            this.lit.emit({ p: p.clone(), v: this.v, life: 1.8 + Math.random() * 0.8, size: 0.2 + Math.random() * 0.12, grav: 9, drag: 1.2, spin: 9 }, this.c.set(colors[i % colors.length]))
        }
    }

    // ---------------------------------------------------------------- camera
    shake(amount) { this.trauma = Math.min(1, this.trauma + amount) }

    // a hit somewhere in the world: sound, dust, shake, and whatever got hit wobbles
    impact(force, position, { who = 'truck' } = {})
    {
        const k = Math.min(1, Math.max(0, (force - 20) / 150))
        if(k <= 0.03) return
        const p = new THREE.Vector3(position.x, position.y, position.z)
        this.game.sound && this.game.sound.hit(k)
        if(this.game.mode === 'drive' && who === 'truck') this.shake(0.15 + k * 0.5)
        this.dust(p, 4 + Math.round(k * 10), { spread: 1 + k, size: 0.5 + k * 0.4 })
        const w = this.nearestWobbler(p, 2.5)
        if(w) this.bump(w, p, 2 + k * 6)
    }

    // ---------------------------------------------------------------- wobblers
    // kind 'tree': instanced crown + trunk sway from the base; kind 'squash': an object scales like jelly
    addWobbler(w)
    {
        Object.assign(w, { sx: new Spring(w.kind === 'tree' ? 60 : 160, w.kind === 'tree' ? 3 : 7), sz: new Spring(w.kind === 'tree' ? 60 : 160, w.kind === 'tree' ? 3 : 7), cooldown: 0 })
        this.wobblers.push(w)
        if(w.collider !== undefined) this.byCollider.set(w.collider, w)
        return w
    }
    nearestWobbler(p, slack)
    {
        let best = null, bd = Infinity
        for(const w of this.wobblers) { const d = Math.hypot(p.x - w.x, p.z - w.z) - w.r; if(d < slack && d < bd) { bd = d; best = w } }
        return best
    }
    bump(w, from, strength)
    {
        if(w.cooldown > 0) return
        w.cooldown = 0.25
        const dx = w.x - from.x, dz = w.z - from.z, l = Math.hypot(dx, dz) || 1
        const amp = w.kind === 'tree' ? 0.32 : 0.06
        w.sx.kick(dz / l * strength * amp); w.sz.kick(- dx / l * strength * amp)
        if(w.kind === 'tree') { this.leaves(new THREE.Vector3(w.x, w.y + 3.2 * w.s, w.z), 4 + Math.round(strength)); this.game.sound && this.game.sound.clonk(0.3) }
        if(w.kind === 'squash') w.sx.kick(strength * 0.12)
        this.active = true
    }

    updateWobblers(dt)
    {
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3()
        const trees = this.game.stage.trees
        let dirty = false
        for(const w of this.wobblers)
        {
            if(w.cooldown > 0) w.cooldown -= dt
            if(w.sx.resting && w.sz.resting) continue
            const ax = w.sx.update(dt), az = w.sz.update(dt)
            if(w.kind === 'tree' && trees)
            {
                e.set(ax, 0, az); q.setFromEuler(e); qy.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, w.rot); q.multiply(qy)
                m.compose(p.set(w.x, w.y, w.z), q, s.setScalar(w.s))
                trees.trunk.setMatrixAt(w.i, m); trees.crown.setMatrixAt(w.i, m); dirty = true
            }
            if(w.kind === 'squash' && w.obj)
            {
                const k = ax * 0.6
                w.obj.scale.set(w.base * (1 + k * 0.5), w.base * (1 - k), w.base * (1 + k * 0.5))
                w.obj.rotation.z = az * 0.15; w.obj.rotation.x = 0
            }
        }
        if(dirty) { trees.trunk.instanceMatrix.needsUpdate = true; trees.crown.instanceMatrix.needsUpdate = true }
    }

    // ---------------------------------------------------------------- pointer: hover glow and click-to-go
    setPointer()
    {
        this.ray = new THREE.Raycaster()
        this.ndc = new THREE.Vector2()
        this.hover = null
        this.targets = []          // { obj, kind, glow: [materials], spring, run(), near() }
        const canvas = this.game.canvasElement
        let down = null
        canvas.addEventListener('pointermove', e => { this.pointer = e; this.pointerDirty = true })
        canvas.addEventListener('pointerleave', () => { this.pointer = null; this.pointerDirty = true })
        canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } })
        canvas.addEventListener('pointerup', e =>
        {
            if(!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 400) return
            this.pointer = e; this.pick(); if(this.hover) this.click(this.hover)
        })
    }

    addTarget(obj, kind, run)
    {
        const glow = []
        obj.traverse(c => { if(c.isMesh && c.material && c.material.emissive) { if(!c.material.userData.ownGlow) { c.material = c.material.clone(); c.material.userData.ownGlow = true } glow.push(c.material) } })
        const t = { obj, kind, glow, run, amount: 0 }
        this.targets.push(t)
        return t
    }

    pick()
    {
        this.pointerDirty = false
        if(!this.pointer || (this.game.modes && this.game.modes.locked) || this.game.mode === 'fly' || (this.game.reveal && this.game.reveal.active)) { this.setHover(null); return }
        const r = this.game.canvasElement.getBoundingClientRect()
        this.ndc.set((this.pointer.clientX - r.left) / r.width * 2 - 1, - (this.pointer.clientY - r.top) / r.height * 2 + 1)
        this.ray.setFromCamera(this.ndc, this.game.view.camera)
        let best = null, bd = Infinity
        for(const t of this.targets)
        {
            if(!t.obj.visible) continue
            const hit = this.ray.intersectObject(t.obj, true)[0]
            if(hit && hit.distance < bd) { bd = hit.distance; best = t }
        }
        this.setHover(best)
    }

    setHover(t)
    {
        if(t === this.hover) return
        this.hover = t
        this.game.canvasElement.style.cursor = t ? 'pointer' : ''
        if(t) this.game.sound && this.game.sound.tick()
    }

    click(t)
    {
        if(this.game.mode !== 'foot') { t.run && t.run(); return }
        this.game.walker.goTo(t.obj.getWorldPosition(new THREE.Vector3()), () => t.run && t.run())
        this.game.sound && this.game.sound.pop(true)
    }

    updateGlow(dt, time)
    {
        for(const t of this.targets)
        {
            const want = t === this.hover ? 1 : 0
            if(t.amount === want && !want) continue
            t.amount += (want - t.amount) * Math.min(1, dt * 10)
            if(Math.abs(t.amount - want) < 0.005) t.amount = want
            const pulse = t.amount * (0.35 + Math.sin(time * 6) * 0.1)
            for(const m of t.glow) { m.emissive.setRGB(1, 0.85, 0.45); m.emissiveIntensity = pulse }
        }
    }

    // ---------------------------------------------------------------- tick
    update()
    {
        const dt = this.game.ticker.delta, time = this.game.ticker.elapsed
        this.lit.update(dt); this.glow.update(dt)
        this.updateWobblers(dt)
        if(this.pointerDirty || (this.pointer && (this.tickN = (this.tickN || 0) + 1) % 6 === 0)) this.pick()
        this.updateGlow(dt, time)

        // camera shake: offset = trauma² × smooth noise, applied on top of the camera View just placed
        if(this.trauma > 0)
        {
            this.trauma = Math.max(0, this.trauma - dt * 1.4)
            this.shakeT += dt * 22
            const s = this.trauma * this.trauma, cam = this.game.view.camera, n = (o) => Math.sin(this.shakeT * 1.13 + o) * 0.6 + Math.sin(this.shakeT * 2.71 + o * 3.1) * 0.4
            cam.position.x += n(0) * s * 0.6; cam.position.y += n(7) * s * 0.6; cam.position.z += n(13) * s * 0.6
            cam.rotateZ(n(21) * s * 0.04)
            cam.updateMatrixWorld()
        }
    }
}
