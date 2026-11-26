/* Ambience.js — the small life in the air and on the ground, after folio-2025's WindLines, Leaves, Flowers and
   PoleLights (Bruno Simon, MIT: the ideas; this code is ours):
   - wind lines: thin white streaks that sweep past near the camera, curling a little, fading in and out
   - leaves: now and then a leaf lets go of a tree near you and drifts down (Juice particles)
   - flowers: small tufts of colour scattered through the grass, instanced
   - lamps: posts along the paths whose heads glow at night (bright enough for the bloom pass) */
import * as THREE from 'three/webgpu'
import { uniform, color, mix, uv, smoothstep, float } from 'three/tsl'
import { Game } from '../engine/Game.js'
import { rng, STATION_SPOTS } from './Stage.js'

const LINES = 6, SEG = 24

export class Ambience
{
    constructor()
    {
        this.game = Game.getInstance()
        this.wind = new THREE.Vector3(1, 0, 0.35).normalize()
        this.setWindLines()
        this.setFlowers()
        this.setLamps()
        this.leafT = 0
        this.game.ticker.events.on('tick', () => this.update(), 8.7)
    }

    // ---------------------------------------------------------------- wind lines
    setWindLines()
    {
        this.lines = []
        const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
        mat.colorNode = color('#ffffff')
        this.lineFade = uniform(1)
        // fade along the streak (uv.x) and across it (uv.y), so it is a soft sliver
        mat.opacityNode = smoothstep(0, 0.35, uv().x).mul(smoothstep(1, 0.7, uv().x)).mul(smoothstep(0, 0.5, uv().y).mul(smoothstep(1, 0.5, uv().y))).mul(this.lineFade).mul(0.75)
        for(let i = 0; i < LINES; i++)
        {
            const g = new THREE.BufferGeometry(), pos = new Float32Array((SEG + 1) * 2 * 3), uvs = new Float32Array((SEG + 1) * 2 * 2), idx = []
            for(let k = 0; k <= SEG; k++) { uvs.set([ k / SEG, 0, k / SEG, 1 ], k * 4); if(k < SEG) { const o = k * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) } }
            g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); g.setIndex(idx)
            const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.userData.keepMaterial = true; mesh.renderOrder = 5
            this.game.scene.add(mesh)
            this.lines.push({ mesh, t: - Math.random() * 6, life: 0, origin: new THREE.Vector3(), seed: Math.random() * 100 })
        }
    }

    respawnLine(L)
    {
        const f = this.game.view.focusPoint.smoothedPosition, side = new THREE.Vector3(- this.wind.z, 0, this.wind.x)
        L.origin.copy(f).addScaledVector(this.wind, - 9 - Math.random() * 5).addScaledVector(side, (Math.random() - 0.5) * 18)
        L.origin.y = Math.max(f.y, this.game.stage.height(L.origin.x, L.origin.z)) + 0.8 + Math.random() * 2
        L.t = - Math.random() * 2.5; L.life = 2.6 + Math.random() * 1.6; L.seed = Math.random() * 100
        L.len = 5 + Math.random() * 4; L.curl = Math.random() < 0.35
    }

    updateLine(L, dt)
    {
        L.t += dt
        if(L.t < 0) { L.mesh.visible = false; return }
        if(L.life === 0 || L.t > L.life) { this.respawnLine(L); if(L.t < 0) { L.mesh.visible = false; return } }
        if(!Number.isFinite(L.origin.x + L.origin.y + L.origin.z)) { L.life = 0; L.mesh.visible = false; return }     // focus not ready yet
        L.mesh.visible = true
        const pos = L.mesh.geometry.attributes.position, speed = 9, side = new THREE.Vector3(- this.wind.z, 0, this.wind.x)
        const head = L.t * speed, w = 0.06, cam = this.game.view.camera.position, p = new THREE.Vector3(), prev = new THREE.Vector3(), up = new THREE.Vector3()
        for(let k = 0; k <= SEG; k++)
        {
            const s = head - L.len + (k / SEG) * L.len                    // distance travelled by this point
            p.copy(L.origin).addScaledVector(this.wind, s).addScaledVector(side, Math.sin(s * 0.35 + L.seed) * 0.6)
            p.y += Math.sin(s * 0.5 + L.seed * 2) * 0.35
            if(L.curl) { const c = Math.max(0, s - (L.len + 6)); const a = c * 0.9; p.addScaledVector(side, Math.sin(a) * 0.8 * Math.min(1, c)); p.y += (1 - Math.cos(a)) * 0.8 * Math.min(1, c) }
            // the ribbon's width points across both the streak and the view, so it never goes edge-on
            const dir = k ? p.clone().sub(prev) : this.wind.clone()
            up.copy(dir).cross(prev.copy(cam).sub(p)); if(up.lengthSq() < 1e-8) up.set(0, 1, 0); up.normalize().multiplyScalar(w)
            pos.setXYZ(k * 2, p.x + up.x, p.y + up.y, p.z + up.z); pos.setXYZ(k * 2 + 1, p.x - up.x, p.y - up.y, p.z - up.z)
            prev.copy(p)
        }
        pos.needsUpdate = true
    }

    // ---------------------------------------------------------------- flowers
    setFlowers()
    {
        const st = this.game.stage, R = rng(42), spots = []
        for(let n = 0; n < 6000 && spots.length < 900; n++)
        {
            const a = R() * 6.283, r = 12 + Math.sqrt(R()) * 135, x = Math.cos(a) * r, z = Math.sin(a) * r
            if(st.nearRoad(x, z, 5) || Math.hypot(x, z) < 18 || st.height(x, z) < 1) continue
            // in clumps: keep a spot only where a slow pattern says "meadow"
            if(Math.sin(x * 0.09 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.08 - x * 0.03) < 0.35) continue
            spots.push([ x, z ])
        }
        // a flower: a little five-petal head on a stem, one mesh
        // a little cluster of three blossoms sitting just above the grass
        const geo = mergeTwo(mergeTwo(new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.5, 0), new THREE.IcosahedronGeometry(0.085, 0).translate(0.16, 0.42, 0.05)),
            mergeTwo(new THREE.IcosahedronGeometry(0.08, 0).translate(- 0.08, 0.38, 0.13), new THREE.CylinderGeometry(0.012, 0.012, 0.45, 3).translate(0, 0.22, 0)))
        const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), spots.length)
        const colors = [ '#fff6d6', '#ffd23f', '#ff8fb1', '#b9a6ff', '#ffffff' ], d = new THREE.Object3D(), c = new THREE.Color()
        spots.forEach(([ x, z ], i) =>
        {
            d.position.set(x, st.height(x, z) - 0.02, z); d.rotation.set((R() - 0.5) * 0.3, R() * 6, (R() - 0.5) * 0.3); d.scale.setScalar(0.8 + R() * 0.6); d.updateMatrix()
            mesh.setMatrixAt(i, d.matrix); mesh.setColorAt(i, c.set(colors[Math.floor(R() * colors.length)]))
        })
        mesh.receiveShadow = true
        this.flowers = mesh
        this.game.scene.add(mesh)
        this.game.look.convert(mesh)
    }

    // ---------------------------------------------------------------- lamps
    setLamps()
    {
        const st = this.game.stage, spots = []
        for(const t of [ - 30, - 10, 10, 30 ]) spots.push([ t, - 45.5 ], [ t, 45.5 ], [ - 45.5, t ], [ 45.5, t ])
        spots.push([ 4.5, 60 ], [ - 4.5, 74 ], [ 4.5, - 60 ], [ - 4.5, - 80 ], [ - 60, 28 ], [ 64, 33 ], [ - 58, - 50 ], [ 60, - 51 ])
        STATION_LAMPS.forEach(s => spots.push(s))
        const pole = new THREE.CylinderGeometry(0.07, 0.1, 3.2, 6).translate(0, 1.6, 0)
        const cap = new THREE.CylinderGeometry(0.34, 0.24, 0.16, 6).translate(0, 3.62, 0)
        const poles = new THREE.InstancedMesh(mergeTwo(pole, cap), new THREE.MeshLambertMaterial({ color: '#4a4f6a' }), spots.length)
        this.night = this.game.look.nightUniform
        const glowMat = new THREE.MeshBasicNodeMaterial({ toneMapped: false }); glowMat.fog = false
        glowMat.colorNode = mix(color('#ffe2a8').mul(0.9), color('#ffb35c').mul(5), this.night)
        const glow = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.3, 1).translate(0, 3.3, 0), glowMat, spots.length)
        glow.userData.keepMaterial = true
        const d = new THREE.Object3D()
        spots.forEach(([ x, z ], i) => { d.position.set(x, st.height(x, z), z); d.updateMatrix(); poles.setMatrixAt(i, d.matrix); glow.setMatrixAt(i, d.matrix); this.game.objects.add(null, { type: 'fixed', colliders: [ { shape: 'cylinder', parameters: [ 1.6, 0.12 ], position: { x, y: st.height(x, z) + 1.6, z } } ] }) })
        poles.castShadow = true; poles.receiveShadow = true
        this.game.scene.add(poles, glow)
        this.game.look.convert(poles)
        this.lamps = { poles, glow, spots }
    }

    update()
    {
        const g = this.game, dt = g.ticker.delta
        const on = g.mode !== 'fly'
        this.lineFade.value += ((on ? 1 : 0) - this.lineFade.value) * Math.min(1, dt * 3)
        for(const L of this.lines) this.updateLine(L, dt)

        // a leaf now and then from a tree near you
        this.leafT -= dt
        if(this.leafT < 0 && g.juice && g.mode === 'foot')
        {
            this.leafT = 0.35 + Math.random() * 0.6
            const p = g.walker.position, trees = g.stage.trees.list
            for(let tries = 0; tries < 6; tries++)
            {
                const t = trees[Math.floor(Math.random() * trees.length)]
                if(Math.hypot(t.x - p.x, t.z - p.z) > 30) continue
                g.juice.leaves(new THREE.Vector3(t.x + (Math.random() - 0.5) * 2, t.y + 3.4 * t.s, t.z + (Math.random() - 0.5) * 2), 1)
                break
            }
        }
    }
}

// lamps beside each résumé station
const STATION_LAMPS = STATION_SPOTS.map(([ x, z ]) => [ x + 3.2, z + 3.2 ])

function mergeTwo(a, b)
{
    const out = new THREE.BufferGeometry(), A = a.index ? a.toNonIndexed() : a, B = b.index ? b.toNonIndexed() : b
    for(const name of [ 'position', 'normal', 'uv' ])
    {
        const x = A.attributes[name], y = B.attributes[name]
        const arr = new Float32Array(x.array.length + y.array.length); arr.set(x.array); arr.set(y.array, x.array.length)
        out.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize))
    }
    return out
}
