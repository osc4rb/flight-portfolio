/* Reveal.js — the opening, ported from folio-2025's Reveal.js, World/Intro.js and World/Grid.js (Bruno Simon, MIT).
   A glowing ring closes around the start as the loader fades, then shrinks away. A small disc of the island opens
   on a dark grid with a "click to start" label. Click, tap, Enter, W or ↑ and the disc's glowing edge sweeps outward
   (back.in) until the whole island is there; the camera eases back out at the same time.
   How the cut works: every MeshDefaultMaterial discards fragments farther than `distance` from the start and glows
   in a thin band at its edge (engine/Materials/MeshDefaultMaterial.js → revealDiscardNodeBuilder). The few other
   materials (rings, flame, screens, labels) get a plain mask from mask(). The colour is blue, as the owner asked,
   from Look's day cycle (revealColor, revealIntensity). The words are in site.js → world.intro.
   ?skip=1 (or #skip) opens the world straight away. */
import * as THREE from 'three/webgpu'
import { uniform, vec2, vec4, color, Fn, atan, PI2, positionGeometry, positionWorld } from 'three/tsl'
import gsap from 'gsap'
import { Game } from '../engine/Game.js'
import { MeshDefaultMaterial } from '../engine/Materials/MeshDefaultMaterial.js'
import MeshGridMaterial, { MeshGridMaterialLine } from '../engine/Materials/MeshGridMaterial.js'

const RADIUS = 7            // the disc you start in (his 3.5 m, for a 2.6 m car; ours holds the robot, the desk and the jet's cockpit)
const SWEEP = 45            // how far the ring travels before the rest pops in (his 30; our island is taller)

export class Reveal
{
    constructor()
    {
        this.game = Game.getInstance()
        this.step = -1
        this.active = true                          // true until the world is fully revealed
        this.waiting = []
        this.skip = /[?&]skip=1/.test(location.search) || /skip/i.test(location.hash)
        this.position = this.game.respawns.getDefault().position.clone()
        this.position2Uniform = uniform(vec2(this.position.x, this.position.z))
        this.distance = uniform(0)
        this.thickness = uniform(0.05)
        this.color = uniform(color('#5f7dff'))
        this.intensity = uniform(12)
        this.intensityMultiplier = 1
        this.update = this.update.bind(this)
        this.game.ticker.events.on('tick', this.update, 10)
    }

    // run once the world is revealed (or now, if it already is)
    then(callback) { if(this.active) this.waiting.push(callback); else callback() }

    // materials that are not MeshDefaultMaterial get a plain cut at the same distance (no glow band); every
    // material's shadow pass is cut too, so hidden things cast no shadow into the disc
    mask(root = this.game.scene)
    {
        const center = this.position2Uniform, distance = this.distance
        const inside = positionWorld.xz.sub(center).length().lessThan(distance)
        const seen = new Set()
        root.traverse(o =>
        {
            if(!o.material || o.userData.noReveal) return
            for(const m of Array.isArray(o.material) ? o.material : [ o.material ])
            {
                if(seen.has(m)) continue
                seen.add(m)
                if(m.isMeshDefault || m.hasReveal) m.maskShadowNode = inside
                else m.maskNode = inside            // copied into the node version when the renderer builds it
                m.needsUpdate = true
            }
        })
    }

    // ---------------------------------------------------------------- the opening, step by step (his updateStep)
    start(center)
    {
        if(center) { this.position.copy(center); this.position2Uniform.value.set(center.x, center.z) }
        this.ground = this.game.stage.height(this.position.x, this.position.z)
        const g = this.game
        // the camera starts on the disc, not gliding in from wherever the loader left it
        const f = g.view.focusPoint
        f.trackedPosition.set(this.position.x, 0, this.position.z); f.smoothedPosition.copy(f.trackedPosition)

        if(this.skip) { this.distance.value = 99999; g.view.zoom.baseRatio = g.view.zoom.smoothedRatio = 0; this.finish(); return }

        g.domElement.classList.add('intro')
        g.inputs.filters.clear(); g.inputs.filters.add('intro')
        this.setCircle()
        this.setGrid()
        this.setLabel()
        g.scene.add(this.grid)
        // the ring closes as the loader fades out, then hands over to the disc
        this.circle.progress = 1
        gsap.delayedCall(1.1, () => this.updateStep(0))
    }

    updateStep(step)
    {
        const g = this.game, zoom = g.view.zoom
        this.step = step
        if(step === 0)
        {
            this.circle.hide(() =>
            {
                this.distance.value = 0
                gsap.to(this.distance, { value: RADIUS, ease: 'back.out(1.7)', duration: 2, overwrite: true })
                // close in on the disc, then settle a little farther out (his values: 0.6 → 0.3)
                zoom.smoothedRatio = zoom.baseRatio = 0.6
                gsap.to(zoom, { baseRatio: 0.3, ease: 'power1.inOut', duration: 1.25, overwrite: true })
                g.sound.pop(true)
                gsap.delayedCall(1, () => this.showLabel())
                this.listen()
            })
        }
        else if(step === 1)
        {
            setTimeout(() => g.sound.reveal(), 40)          // let the audio context start on this gesture first
            gsap.to(this.distance, { value: SWEEP, ease: 'back.in(1.3)', duration: 2, overwrite: true, onComplete: () => { this.distance.value = 99999; this.updateStep(2) } })
            this.hideLabel()
            // next task: the key that started it (Enter is also 'get in') must not also act in the world
            setTimeout(() => { g.inputs.filters.clear(); g.inputs.filters.add('wandering') }, 150)
            g.domElement.classList.remove('intro')
            gsap.to(zoom, { baseRatio: 0, ease: 'back.in(1.5)', duration: 1.75, overwrite: true })      // his play zoom: all the way out
        }
        else if(step === 2)
        {
            this.grid.removeFromParent(); this.grid.geometry.dispose(); this.grid.material.dispose()
            this.label.removeFromParent(); this.label.material.map.dispose(); this.label.material.dispose()
            this.circle.mesh.geometry.dispose(); this.circle.mesh.material.dispose()
            this.finish()
        }
    }

    finish()
    {
        this.active = false
        this.game.ticker.events.off('tick', this.update)
        for(const callback of this.waiting.splice(0)) callback()
    }

    // click or tap anywhere (not a drag), or Enter / W / ↑ / D / gamepad cross
    listen()
    {
        const g = this.game, canvas = g.canvasElement
        let down = null
        const onDown = e => { down = { x: e.clientX, y: e.clientY, t: performance.now() } }
        const onUp = e =>
        {
            if(!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || performance.now() - down.t > 800) return
            next()
        }
        const onKey = () => next()
        const next = () =>
        {
            if(this.step !== 0) return
            canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointerup', onUp)
            g.inputs.events.off('introStart', onKey)
            canvas.style.cursor = ''
            this.updateStep(1)
        }
        g.inputs.addActions([ { name: 'introStart', categories: [ 'intro' ], keys: [ 'Gamepad.cross', 'Keyboard.Enter', 'Keyboard.Space', 'Keyboard.ArrowUp', 'Keyboard.KeyW', 'Keyboard.KeyD' ] } ])
        g.inputs.events.on('introStart', onKey)
        canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointerup', onUp)
        canvas.style.cursor = 'pointer'
    }

    // ---------------------------------------------------------------- Intro.js: the loading ring
    setCircle()
    {
        const C = this.circle = { progress: 0, smoothed: uniform(0) }
        const geometry = new THREE.RingGeometry(RADIUS - 0.04, RADIUS, 128, 1)
        const material = new THREE.MeshBasicNodeMaterial()
        material.outputNode = Fn(() =>
        {
            const angle = atan(positionGeometry.y, positionGeometry.x)
            C.smoothed.lessThan(angle.div(PI2).add(0.5).oneMinus()).discard()
            return vec4(this.color.mul(this.intensity), 1)
        })()
        const mesh = C.mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(this.position.x, this.ground + 0.02, this.position.z)
        mesh.rotation.x = - Math.PI * 0.5; mesh.rotation.z = Math.PI * 0.5
        mesh.userData.noReveal = true
        this.game.scene.add(mesh)
        C.hide = (callback) =>
        {
            const d = { s: 1 }
            gsap.to(d, { s: 0, duration: 1.5, ease: 'power4.in', overwrite: true, onUpdate: () => mesh.scale.setScalar(Math.max(d.s, 1e-4)), onComplete: () => { mesh.removeFromParent(); callback && callback() } })
        }
    }

    // ---------------------------------------------------------------- Grid.js: the dark grid around the disc
    setGrid()
    {
        const lines = [ new MeshGridMaterialLine('#3d6bff', 10, 0.02, 0.2), new MeshGridMaterialLine('#2f3b66', 100, 0.002, 1) ]
        const grid = new MeshGridMaterial({ color: 0x10131f, scale: 0.001, antialiased: true, reference: 'uv', side: THREE.DoubleSide, lines })
        const shaded = new MeshDefaultMaterial({ colorNode: grid.outputNode.rgb, hasWater: false, hasReveal: false, hasLightBounce: false, hasEmissive: false })
        shaded.isMeshDefault = true
        grid.outputNode = Fn(() =>
        {
            positionWorld.xz.sub(this.position2Uniform).length().lessThan(this.distance).discard()
            return shaded.outputNode
        })()
        this.grid = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), grid)
        this.grid.rotation.x = - Math.PI * 0.5
        this.grid.position.set(this.position.x, this.ground - 0.03, this.position.z)
        this.grid.receiveShadow = true
        this.grid.userData.noReveal = true
    }

    // ---------------------------------------------------------------- the label beside the disc (our words)
    setLabel()
    {
        const W = (this.game.site.world || {}).intro || {}
        const touch = matchMedia('(pointer: coarse)').matches
        const big = touch ? W.tap || W.start || '' : W.start || '', small = touch ? W.tapNote || '' : W.note || ''
        const c = document.createElement('canvas'); c.width = 1024; c.height = 512
        const x = c.getContext('2d'), font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
        x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#ffffff'
        x.shadowColor = 'rgba(10, 16, 48, 0.55)'; x.shadowBlur = 18
        x.font = `700 132px ${font}`; x.fillText(big, 512, small ? 210 : 256, 980)
        if(small) { x.font = `500 58px ${font}`; x.globalAlpha = 0.85; x.fillText(small, 512, 352, 980) }
        const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4
        const label = this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }))
        label.renderOrder = 20
        label.userData.noReveal = true
        // over the front of the disc, below you as the camera sees it, clear of the jet and the desk (his sits to the
        // side; centred fits phones too)
        const near = this.game.stage.cameraDirection().setY(0).normalize()               // points toward the camera
        label.position.set(this.position.x + near.x * RADIUS, this.ground + 0.2, this.position.z + near.z * RADIUS)
        this.labelSize = 5.2
        label.scale.setScalar(1e-4)
        this.game.scene.add(label)
    }

    showLabel()
    {
        const d = { s: 0 }, L = this.label, w = this.labelSize
        gsap.to(d, { s: 1, duration: 2, delay: 1, ease: 'elastic.out(1, 0.5)', overwrite: true, onUpdate: () => L.scale.set(Math.max(1e-4, w * d.s), Math.max(1e-4, w * 0.5 * d.s), 1) })
    }

    hideLabel()
    {
        const L = this.label, sx = L.scale.x, sy = L.scale.y, d = { s: 1 }
        gsap.to(d, { s: 0, duration: 0.3, ease: 'power2.in', overwrite: true, onUpdate: () => L.scale.set(Math.max(1e-4, sx * d.s), Math.max(1e-4, sy * d.s), 1) })
    }

    update()
    {
        const C = this.circle
        if(C) C.smoothed.value += (C.progress - C.smoothed.value) * Math.min(1, this.game.ticker.delta * 4)
        const P = this.game.dayCycles && this.game.dayCycles.properties
        if(P && P.revealColor) { this.color.value.copy(P.revealColor.value); this.intensity.value = P.revealIntensity.value * this.intensityMultiplier }
        // the ring at the disc's edge breathes while it waits for a click
        if(this.step === 0) this.intensityMultiplier = 1 + Math.sin(performance.now() / 420) * 0.12
    }
}
