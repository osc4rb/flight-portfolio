/* Course.js — the flight course: a ring of rock peaks in the sea around the island, three sea arches and a tunnel
   ridge to fly through, and ten gates that make one timed lap (start and finish over the runway).
   Our flight take on folio-2025's CircuitArea (checkpoints in order, a timer, a best time kept on this device),
   built from code: no models. Rock is collision-checked with simple distance functions, so the jet crashes on it
   and a close pass gives a whoosh. */
import * as THREE from 'three/webgpu'
import { Game } from '../engine/Game.js'
import { rng } from './Stage.js'
import { Leaderboard } from './Leaderboard.js'
import { batch } from './Batch.js'

const BEST = 'world-course-best', TOP = 'world-course-top'
export const PODIUM = { x: 80, z: - 99.5 }                       // clear of the start gantry's posts
const ROCK = { base: '#c39a6b', dark: '#93735a', moss: '#74b84a', snow: '#fbf8f0' }
const SHAPE = 0.85                                         // peak profile: radius = r * (1 - u)^SHAPE, rounder below 1

// 3D value noise, 0..1
function h3(x, y, z) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1440662683) | 0; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296 }
function noise3(x, y, z)
{
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), f = t => t * t * (3 - 2 * t)
    const u = f(x - xi), v = f(y - yi), w = f(z - zi), L = (a, b, t) => a + (b - a) * t
    const c = (i, j, k) => h3(xi + i, yi + j, zi + k)
    return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w)
}
const fbm = (x, y, z) => noise3(x, y, z) * 0.65 + noise3(x * 2.3 + 7, y * 2.3, z * 2.3) * 0.35

// rock colour by height and a little noise: moss at the foot, snow on tall summits
function paint(geo, snowLine)
{
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color(), base = new THREE.Color(ROCK.base), dark = new THREE.Color(ROCK.dark), moss = new THREE.Color(ROCK.moss), snow = new THREE.Color(ROCK.snow)
    for(let i = 0; i < pos.count; i++)
    {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), n = noise3(x * 0.08, y * 0.08, z * 0.08)
        c.copy(base).lerp(dark, n * 0.8)
        if(y < 5 + n * 4) c.lerp(moss, 0.75)
        if(y > snowLine + n * 10) c.copy(snow)
        col.set([ c.r, c.g, c.b ], i * 3)
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

// a peak: an icosphere pulled into a rough cone; the lower half drops below the sea as a skirt
function peakGeometry(r, h, seed)
{
    const g = new THREE.IcosahedronGeometry(1, 4), p = g.attributes.position
    for(let i = 0; i < p.count; i++)
    {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), u = Math.max(0, y), a = Math.hypot(x, z) || 1
        const n = fbm(x * 1.8 + seed, y * 1.8, z * 1.8 + seed) - 0.5
        const rad = r * Math.pow(1 - u, SHAPE) * (1 + n * 0.55)
        p.setXYZ(i, x / a * rad, y < 0 ? - 8 : h * u * (1 + n * 0.3), z / a * rad)
    }
    g.computeVertexNormals()
    paint(g, Math.max(58, h * 0.74))
    return g
}

// a standing arch: half a torus with rough rock, thicker legs, sunk a little into the sea
function archGeometry(R, tube, seed)
{
    let g = new THREE.TorusGeometry(R, tube, 12, 56, Math.PI + 0.6); g.rotateZ(- 0.3)
    const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3()
    for(let i = 0; i < p.count; i++)
    {
        v.fromBufferAttribute(p, i)
        const th = Math.atan2(v.y, v.x); c.set(Math.cos(th) * R, Math.sin(th) * R, 0)
        const out = v.clone().sub(c), n = fbm(v.x * 0.12 + seed, v.y * 0.12, v.z * 0.12) - 0.5
        v.copy(c).addScaledVector(out, 1 + legs(v.y, R) + n * 0.6)
        p.setXYZ(i, v.x, v.y, v.z)
    }
    g = g.toNonIndexed(); g.computeVertexNormals()
    paint(g, 999)
    return g
}
const legs = (y, R) => 0.7 * Math.max(0, 1 - y / (R * 0.55))

// a ridge with a round tunnel through it: an extruded hill profile with a hole, roughened outside the bore
const TUN = { W: 62, H: 46, L: 72, hc: 15, hr: 13.5 }
const profile = x => TUN.H * (1 - Math.pow(Math.min(1, Math.abs(x) / TUN.W), 1.7))
function tunnelGeometry(seed)
{
    const s = new THREE.Shape()
    s.moveTo(- TUN.W, - 8)
    for(let i = 0; i <= 40; i++) { const x = - TUN.W + 2 * TUN.W * i / 40; s.lineTo(x, Math.max(0, profile(x))) }
    s.lineTo(TUN.W, - 8); s.lineTo(- TUN.W, - 8)
    const hole = new THREE.Path(); hole.absarc(0, TUN.hc, TUN.hr, 0, Math.PI * 2, true); s.holes.push(hole)
    let g = new THREE.ExtrudeGeometry(s, { depth: TUN.L, steps: 10, bevelEnabled: false, curveSegments: 28 })
    g.translate(0, 0, - TUN.L / 2)
    const p = g.attributes.position
    for(let i = 0; i < p.count; i++)
    {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), bore = Math.hypot(x, y - TUN.hc)
        if(bore < TUN.hr + 0.5 || y < - 1) continue
        const n = fbm(x * 0.07 + seed, y * 0.07, z * 0.07) - 0.5, k = Math.min(1, (bore - TUN.hr) / 8)
        p.setXYZ(i, x + n * 7 * k, y + n * 9 * k, z + (Math.abs(z) > TUN.L / 2 - 0.1 ? n * 3 * k : 0))
    }
    g = g.toNonIndexed(); g.computeVertexNormals()
    paint(g, 999)
    return g
}

export class Course
{
    constructor()
    {
        this.game = Game.getInstance()
        this.group = new THREE.Group(); this.group.name = 'course'
        this.game.scene.add(this.group)
        this.rock = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide })      // the bore's faces wind inward
        this.obstacles = []
        this.gates = []
        this.next = 0
        this.running = false
        this.best = Number(localStorage.getItem(BEST)) || 0
        this.setGates()
        this.setPeaks()
        this.setMarker()
        this.setStart()
        batch(this.group, [ this.rock, this.dark ])           // the rock and the start's dark posts: one draw call each
        this.game.ticker.events.on('tick', () => this.update(), 9)
    }

    mesh(geo, x, y, z, yaw = 0)
    {
        const m = new THREE.Mesh(geo, this.rock); m.position.set(x, y, z); m.rotation.y = yaw
        m.castShadow = true; m.receiveShadow = true; m.userData.softUp = 0.55
        this.group.add(m); m.updateMatrixWorld()
        return m
    }

    addPeak(x, z, r, h, seed, y = 0)
    {
        this.mesh(peakGeometry(r, h, seed), x, y, z, seed)
        this.obstacles.push({ kind: 'peak', x, y, z, r, h })
    }

    // ---------------------------------------------------------------- the lap, in order (angles in degrees, around the island)
    setGates()
    {
        const at = (a, r) => [ Math.cos(a * Math.PI / 180) * r, Math.sin(a * Math.PI / 180) * r ]
        const list = [
            { k: 'ring', x: 60, z: - 112, y: 15, r: 10 },          // start and finish, over the runway
            { k: 'arch', a: - 14, d: 222, R: 34, tube: 7 },
            { k: 'tunnel', a: 22, d: 238 },
            { k: 'ring', a: 54, d: 226, y: 46, r: 11, flank: 38 },  // a saddle between two summits
            { k: 'arch', a: 88, d: 234, R: 28, tube: 6 },           // a low sea arch
            { k: 'ring', a: 122, d: 214, y: 11, r: 10, flank: 26 }, // skim the water between two stacks
            { k: 'arch', a: 158, d: 236, R: 46, tube: 8 },          // the tall one
            { k: 'ring', a: 194, d: 226, y: 26, r: 10, needles: true },
            { k: 'ring', a: 228, d: 206, y: 36, r: 11 },
        ]
        for(const g of list) if(g.a !== undefined) [ g.x, g.z ] = at(g.a, g.d)
        // each gate faces along the line from the gate before it to the gate after it
        list.forEach((g, i) =>
        {
            const a = list[(i + list.length - 1) % list.length], b = list[(i + 1) % list.length]
            g.t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()
            g.yaw = Math.atan2(g.t.x, g.t.z)
        })
        this.path = list.map(g => [ g.x, g.z ])

        const R = rng(42)
        for(const g of list)
        {
            const side = new THREE.Vector3(g.t.z, 0, - g.t.x)
            if(g.k === 'arch')
            {
                g.tube = g.R * 0.2                                                             // the Blender arch's proportions
                const src = this.game.stage.models.arch, seed = R() * 50
                let m
                if(src)
                {
                    // our Blender arch (unit radius, AO and rock colours baked in), scaled to R; collision uses the same shape
                    m = src.scene.clone(true); m.scale.setScalar(g.R); m.position.set(g.x, - 1, g.z); m.rotation.y = g.yaw
                    m.traverse(c => { if(c.isMesh) { c.castShadow = c.receiveShadow = true; c.userData.softUp = 0.55 } })
                    this.group.add(m)
                }
                else m = this.mesh(archGeometry(g.R, g.tube, seed), g.x, - 1, g.z, g.yaw)
                const frame = new THREE.Object3D(); frame.position.set(g.x, - 1, g.z); frame.rotation.y = g.yaw; frame.updateMatrixWorld()
                this.obstacles.push({ kind: 'arch', R: g.R, tube: g.tube, inv: frame.matrixWorld.clone().invert() })
                for(const s of [ - 1, 1 ]) this.addPeak(g.x + side.x * s * g.R, g.z + side.z * s * g.R, g.tube * 2.6, g.tube * 2.2, R() * 50)  // rock at each foot
                const a = g.R - g.tube; g.y = a / 2 + 1.5; g.r = a / 2 * 0.86
            }
            if(g.k === 'tunnel')
            {
                const m = this.mesh(tunnelGeometry(R() * 50), g.x, 0, g.z, g.yaw)
                this.obstacles.push({ kind: 'tunnel', inv: m.matrixWorld.clone().invert() })
                this.addPeak(g.x, g.z, 26, 38, R() * 50, 38)                                         // a summit on the ridge, its skirt clear of the bore
                this.tunnelLights(m)
                // the gate sits at the mouth you fly into
                g.x -= g.t.x * (TUN.L / 2 + 3); g.z -= g.t.z * (TUN.L / 2 + 3); g.y = TUN.hc; g.r = TUN.hr - 2.5
            }
            if(g.flank) for(const s of [ - 1, 1 ]) this.addPeak(g.x + side.x * s * g.flank, g.z + side.z * s * g.flank, g.flank * 0.62, g.y * 1.9 + 20, R() * 50)
            if(g.needles) for(const [ s, f ] of [ [ - 1, 24 ], [ 1, 22 ], [ 1, - 30 ] ]) this.addPeak(g.x + side.x * s * f + g.t.x * f * 0.6, g.z + side.z * s * f + g.t.z * f * 0.6, 13, 55 + R() * 25, R() * 50)
            this.addGate(g)
        }
    }

    tunnelLights(m)
    {
        const mat = new THREE.MeshBasicMaterial({ color: '#ffd34d' }), geo = new THREE.BoxGeometry(0.5, 0.25, 1.6)
        const lights = new THREE.InstancedMesh(geo, mat, 2 * 9), d = new THREE.Object3D()
        let i = 0
        for(let k = 0; k < 9; k++) for(const s of [ - 1, 1 ])
        {
            const ang = - Math.PI / 2 + s * 0.95
            d.position.set(Math.cos(ang) * (TUN.hr - 0.2), TUN.hc + Math.sin(ang) * (TUN.hr - 0.2), - TUN.L / 2 + 4 + k * (TUN.L - 8) / 8)
            d.rotation.set(0, 0, ang + Math.PI / 2); d.updateMatrix(); lights.setMatrixAt(i++, d.matrix)
        }
        lights.userData.keepMaterial = true
        m.add(lights)
    }

    addGate(g)
    {
        const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.3, depthWrite: false })
        const ring = new THREE.Mesh(new THREE.TorusGeometry(g.r, 0.55, 8, 56), mat)
        ring.position.set(g.x, g.y, g.z); ring.rotation.y = g.yaw
        ring.userData.keepMaterial = true
        this.group.add(ring)
        this.gates.push({ ...g, ring, mat, c: ring.position.clone(), n: g.t.clone(), s: 0 })
    }

    // filler peaks all round, kept clear of the flying line
    setPeaks()
    {
        const R = rng(7), segDist = (x, z) =>
        {
            let best = 1e9
            for(let i = 0; i < this.path.length; i++)
            {
                const [ ax, az ] = this.path[i], [ bx, bz ] = this.path[(i + 1) % this.path.length]
                const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
                best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t))
            }
            return best
        }
        let tries = 0, made = 0
        while(made < 30 && tries++ < 800)
        {
            const a = R() * Math.PI * 2, d = 192 + R() * 125, x = Math.cos(a) * d, z = Math.sin(a) * d, r = 16 + R() * 24
            if(segDist(x, z) < r + 24 || d - r * 0.4 < 186) continue
            if(this.obstacles.some(o => o.kind === 'peak' && Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.8)) continue
            this.addPeak(x, z, r, r * (1 + R() * 1.1) + 12, R() * 50); made++
        }
    }

    // signed clearance from rock (m): negative means inside it
    distance(p)
    {
        let best = 1e9
        const q = new THREE.Vector3()
        for(const o of this.obstacles)
        {
            let d
            if(o.kind === 'peak')
            {
                const dx = p.x - o.x, dz = p.z - o.z, dh = Math.hypot(dx, dz)
                if(dh > o.r * 1.4 + 20) continue
                const y = p.y - o.y
                if(y < 0 && o.y > 0) continue                                                  // a summit's ridge answers below it
                const top = dh >= o.r ? 0 : o.h * (1 - Math.pow(dh / o.r, 1 / SHAPE))
                d = dh >= o.r ? Math.hypot(dh - o.r, Math.max(0, y - 0)) : y - top * 0.9
            }
            else if(o.kind === 'seg')                                                          // gantry posts and bar
            {
                const ab = q.copy(o.b).sub(o.a), t = Math.max(0, Math.min(1, p.clone().sub(o.a).dot(ab) / ab.lengthSq()))
                d = p.distanceTo(o.a.clone().addScaledVector(ab, t)) - o.r
            }
            else if(o.kind === 'arch')
            {
                q.copy(p).applyMatrix4(o.inv)
                if(q.y < - 1) continue
                d = Math.hypot(Math.hypot(q.x, q.y) - o.R, q.z) - o.tube * (1 + legs(q.y, o.R)) * 0.97
            }
            else
            {
                q.copy(p).applyMatrix4(o.inv)
                const slab = Math.abs(q.z) - TUN.L / 2, above = q.y - profile(q.x)
                if(slab > 0 || above > 0 || Math.abs(q.x) > TUN.W) d = Math.max(slab, above, Math.abs(q.x) - TUN.W)
                else d = (TUN.hr - 1.2) - Math.hypot(q.x, q.y - TUN.hc)
            }
            if(d < best) best = d
        }
        return best
    }

    // ---------------------------------------------------------------- the start, after his CircuitArea: a light gantry over the
    // start gate, a podium with a board of the fastest laps, and banners along the runway
    setStart()
    {
        const g = this.gates[0], side = new THREE.Vector3(g.n.z, 0, - g.n.x), H = this.game.stage.height, ob = this.game.objects
        const dark = this.dark = new THREE.MeshLambertMaterial({ color: '#2d2c2b' }), top = g.y + g.r + 2.5, half = g.r + 3
        const ends = [ - 1, 1 ].map(s => new THREE.Vector3(g.x + side.x * s * half, top, g.z + side.z * s * half))
        for(const e of ends)
        {
            const y0 = H(e.x, e.z), m = new THREE.Mesh(new THREE.BoxGeometry(0.8, top - y0, 0.8), dark)
            m.position.set(e.x, (top + y0) / 2, e.z); m.castShadow = true; this.group.add(m)
            this.obstacles.push({ kind: 'seg', a: new THREE.Vector3(e.x, y0, e.z), b: e.clone(), r: 0.9 })
            ob.add(null, { type: 'fixed', colliders: [ { shape: 'cuboid', parameters: [ 0.4, (top - y0) / 2, 0.4 ], position: { x: e.x, y: (top + y0) / 2, z: e.z } } ] })
        }
        const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.8, 0.8, 0.8), dark); bar.position.set(g.x, top, g.z); bar.rotation.y = g.yaw; bar.castShadow = true; this.group.add(bar)
        this.obstacles.push({ kind: 'seg', a: ends[0], b: ends[1], r: 0.9 })
        this.lamps = [ - 3, 0, 3 ].map(k =>
        {
            const l = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), new THREE.MeshBasicMaterial({ color: '#3a2523' }))
            l.position.set(g.x + side.x * k, top - 1.3, g.z + side.z * k); l.userData.keepMaterial = true; this.group.add(l)
            return l
        })
        this.lit = 0; this.greenUntil = 0

        // podium and the fastest-laps board, on the grass beside the start
        const steps = [ [ - 2.2, 1.0, '#cfd2d6' ], [ 0, 1.6, '#f2c94c' ], [ 2.2, 0.7, '#c9895a' ] ]
        for(const [ dx, h, color ] of steps)
        {
            const x = PODIUM.x + dx, z = PODIUM.z, y0 = H(x, z), m = new THREE.Mesh(new THREE.BoxGeometry(2.1, h, 2.1), new THREE.MeshLambertMaterial({ color }))
            m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true; this.group.add(m)
            ob.add(null, { type: 'fixed', colliders: [ { shape: 'cuboid', parameters: [ 1.05, h / 2, 1.05 ], position: { x, y: y0 + h / 2, z } } ] })
        }
        this.top = JSON.parse(localStorage.getItem(TOP) || '[]').filter(Number.isFinite)
        if(!this.top.length && this.best) this.top = [ this.best ]
        this.boardCanvas = document.createElement('canvas'); this.boardCanvas.width = 1024; this.boardCanvas.height = 576
        this.boardTex = new THREE.CanvasTexture(this.boardCanvas); this.boardTex.colorSpace = THREE.SRGBColorSpace
        this.leaderboard = new Leaderboard()                     // shared times when a project is set; this device's otherwise
        this.rows = this.top.map(time => ({ name: '', time }))
        this.drawBoard()
        this.refreshBoard()
        const bx = PODIUM.x + 12, bz = - 99, by = H(bx, bz)
        const board = new THREE.Mesh(new THREE.PlaneGeometry(8, 4.5), new THREE.MeshBasicMaterial({ map: this.boardTex })); board.position.set(bx, by + 5.6, bz + 0.13); board.userData.keepMaterial = true; this.group.add(board)
        const frame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 4.9, 0.2), dark); frame.position.set(bx, by + 5.6, bz); frame.castShadow = true; this.group.add(frame)
        for(const s of [ - 1, 1 ]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.4, 0.3), dark); leg.position.set(bx + s * 3.4, by + 1.7, bz); this.group.add(leg) }
        ob.add(null, { type: 'fixed', colliders: [ { shape: 'cuboid', parameters: [ 4.2, 4, 0.2 ], position: { x: bx, y: by + 4, z: bz } } ] })

        // banners: chequered and yellow flags on poles down both edges of the runway
        const flag = (draw) => { const c = document.createElement('canvas'); c.width = 64; c.height = 160; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }) }
        const chequer = flag(x => { for(let i = 0; i < 4; i++) for(let j = 0; j < 10; j++) { x.fillStyle = (i + j) % 2 ? '#1d1c1b' : '#f2f0e5'; x.fillRect(i * 16, j * 16, 16, 16) } })
        const yellow = flag(x => { x.fillStyle = '#f2c94c'; x.fillRect(0, 0, 64, 160); x.fillStyle = '#1d1c1b'; x.fillRect(0, 128, 64, 12) })
        this.flags = []
        for(let x = 0; x <= 108; x += 12) for(const z of [ - 101.5, - 122.5 ])
        {
            const y0 = H(x, z), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6.2, 6), dark); pole.position.set(x, y0 + 3.1, z); this.group.add(pole)
            const f = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3).translate(0.6, 0, 0), (x / 12 + (z < - 110 ? 1 : 0)) % 2 ? yellow : chequer); f.position.set(x + 0.08, y0 + 4.5, z); f.castShadow = true; this.group.add(f)
            this.flags.push(f)
            ob.add(null, { type: 'fixed', colliders: [ { shape: 'cuboid', parameters: [ 0.12, 3.1, 0.12 ], position: { x, y: y0 + 3.1, z } } ] })
        }
    }

    // the board on the podium: everyone's five fastest laps when the shared board is on, this device's three otherwise
    drawBoard()
    {
        const R = (this.game.site.world || {}).race || {}
        const x = this.boardCanvas.getContext('2d'), W = 1024, H = 576, shared = this.leaderboard && this.leaderboard.on, n = shared ? 5 : 3
        x.fillStyle = '#100f0f'; x.fillRect(0, 0, W, H)
        x.fillStyle = '#f2c94c'; x.fillRect(64, 56, 90, 10)
        x.fillStyle = '#cecdc3'; x.font = '600 54px system-ui, sans-serif'; x.fillText(R.board || '', 64, 128)
        const step = shared ? 76 : 100, y0 = shared ? 218 : 250
        for(let k = 0; k < n; k++)
        {
            const y = y0 + k * step, r = this.rows[k]
            x.fillStyle = '#878580'; x.font = '40px ui-monospace, Consolas, monospace'; x.fillText(String(k + 1), 64, y)
            x.fillStyle = k === 0 ? '#f2c94c' : '#cecdc3'; x.font = '600 52px ui-monospace, Consolas, monospace'
            x.fillText(r ? r.time.toFixed(1) + ' s' : '—', 130, y)
            if(r && r.name) { x.fillStyle = '#cecdc3'; x.font = '500 44px system-ui, sans-serif'; x.fillText(r.name.slice(0, 16), 400, y, 560) }
        }
        this.boardTex.needsUpdate = true
    }

    async refreshBoard()
    {
        const rows = await this.leaderboard.top(10)
        if(rows) { this.rows = rows; this.drawBoard(); if(this.result) this.fillResult() }
    }

    lapDone(t)
    {
        this.ceremonyArmed = true                                                          // land and stop for the podium
        this.lastLap = t; this.posted = false
        this.top = [ ...this.top, t ].sort((a, b) => a - b).slice(0, 3)
        localStorage.setItem(TOP, JSON.stringify(this.top.map(v => +v.toFixed(2))))
        if(!this.leaderboard.on) this.rows = this.top.map(time => ({ name: '', time }))
        this.drawBoard()
        const a = this.game.achievements; if(a) { a.unlock('lap'); if(t < 25) a.unlock('fast') }
    }

    // ---------------------------------------------------------------- the result on the podium: your lap, a name, the board
    showResult()
    {
        if(!this.lastLap) return
        const R = (this.game.site.world || {}).race || {}, esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        const el = this.result = document.createElement('div'); el.className = 'h-result'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', R.board || '')
        const shared = this.leaderboard.on
        el.innerHTML = '<div class="r-card"><header><span class="r-k">' + esc(R.yourLap) + '</span><b class="r-t">' + this.lastLap.toFixed(1) + ' s</b>'
            + '<button type="button" class="h-x" data-close aria-label="' + esc(R.close) + '">×</button></header>'
            + (shared ? '<form class="r-form"><input maxlength="16" autocomplete="nickname" spellcheck="false" placeholder="' + esc(R.name) + '" aria-label="' + esc(R.name) + '"><button type="submit" class="r-post">' + esc(R.post) + '</button></form>' : '')
            + '<ol class="r-list"></ol></div>'
        document.getElementById('hud').appendChild(el)
        const input = el.querySelector('input'), form = el.querySelector('form')
        el.addEventListener('click', e => { if(e.target.closest('[data-close]')) this.closeResult() })
        if(input)
        {
            input.value = this.leaderboard.name
            // keys typed here are for the name only: none reach the world (M, N, E, Enter, Esc)
            input.addEventListener('keydown', e => { e.stopPropagation(); if(e.key === 'Escape') this.closeResult() })
            input.addEventListener('keyup', e => e.stopPropagation())
            form.addEventListener('submit', async e =>
            {
                e.preventDefault()
                if(this.posted || !input.value.trim()) return
                const btn = form.querySelector('button'); btn.disabled = true
                const ok = await this.leaderboard.post(input.value, this.lastLap)
                if(ok) { this.posted = true; btn.textContent = R.posted || ''; input.disabled = true; this.refreshBoard() }
                else btn.disabled = false
            })
            setTimeout(() => input.focus({ preventScroll: true }), 50)
        }
        this.fillResult()
        if(shared) this.refreshBoard()
    }

    fillResult()
    {
        const list = this.result && this.result.querySelector('.r-list'); if(!list) return
        const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
        const me = this.leaderboard.name, mine = r => this.posted && r.name === me && Math.abs(r.time - this.lastLap) < 0.01
        list.innerHTML = this.rows.slice(0, 10).map((r, k) => '<li' + (mine(r) ? ' class="me"' : '') + '><span>' + (k + 1) + '</span><b>' + r.time.toFixed(1) + ' s</b><i>' + esc(r.name) + '</i></li>').join('')
    }

    closeResult()
    {
        if(!this.result) return
        this.result.remove(); this.result = null
        if(!this.game.modes.ceremony) this.game.modes.lock(false)
        this.game.canvasElement.focus && this.game.canvasElement.focus()
    }

    // the podium ceremony, after his circuit's end: land and stop after a lap, and the pilot stands on the top step
    // while the camera circles and confetti flies; then you are back on foot beside the podium
    ceremony()
    {
        const g = this.game, H = g.stage.height
        this.ceremonyArmed = false
        g.hud.wipe(() =>
        {
            g.modes.leave('fly', true)
            const x = PODIUM.x, z = PODIUM.z, top = H(x, z) + 1.6, c = new THREE.Vector3(x, top + 1, z)
            g.walker.moveTo(new THREE.Vector3(x, top + 1.1, z), Math.PI / 2)
            g.modes.lock(true); g.modes.ceremony = true
            g.achievements && g.achievements.unlock('podium')
            g.sound.chime(); setTimeout(() => g.sound.chime(), 450)
            this.showResult()
            let t = 0
            g.cameraOverride = cam =>
            {
                t += g.ticker.delta
                const a = Math.PI / 2 + Math.sin(t * 0.5) * 0.6                               // swing on the open grass side
                cam.position.set(c.x + Math.cos(a) * 9, c.y + 4.5, c.z + Math.sin(a) * 9); cam.lookAt(c)
            }
            const bursts = setInterval(() => { g.juice.confetti(c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 2)), 30); g.juice.sparkle(c.clone(), 10, '#ffd34d') }, 500)
            setTimeout(() =>
            {
                clearInterval(bursts)
                g.hud.wipe(() =>
                {
                    g.cameraOverride = null; g.modes.ceremony = false; if(!this.result) g.modes.lock(false)
                    g.walker.moveTo(new THREE.Vector3(x, H(x, z + 3.5) + 1.2, z + 3.5), - Math.PI / 2)
                })
            }, 4800)
        })
    }

    // ---------------------------------------------------------------- HUD marker for the next gate
    setMarker()
    {
        this.mark = document.createElement('div'); this.mark.className = 'h-mark'; this.mark.hidden = true
        document.getElementById('hud').appendChild(this.mark)
    }

    placeMarker(c)
    {
        const cam = this.game.view.camera, v = c.clone().project(cam), behind = v.z > 1
        let x = v.x, y = v.y
        if(behind) { x = - x; y = - y }
        const off = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.9
        if(off) { const k = 0.9 / Math.max(Math.abs(x), Math.abs(y), 1e-3); x *= k; y *= k }
        this.mark.classList.toggle('edge', off)
        this.mark.style.left = ((x + 1) / 2 * 100).toFixed(2) + '%'
        this.mark.style.top = ((1 - y) / 2 * 100).toFixed(2) + '%'
        this.mark.style.setProperty('--a', Math.atan2(- y, x) + 'rad')
    }

    // ---------------------------------------------------------------- race
    reset()
    {
        this.next = 0; this.running = false
        for(const g of this.gates) g.ring.visible = true
        this.game.hud.race(null)
    }

    pass(i)
    {
        const g = this.gates[i], j = this.game.juice, n = this.gates.length, now = performance.now()
        j.sparkle(g.c.clone(), 22, i === 0 ? '#ffd34d' : '#ffffff'); j.shake(0.1)
        if(i === 0)
        {
            if(this.running)
            {
                const t = (now - this.t0) / 1000, record = !this.best || t < this.best
                if(record) { this.best = t; localStorage.setItem(BEST, t.toFixed(2)) }
                this.lapDone(t)
                this.game.sound.chime(); j.confetti(g.c.clone(), 60)
                this.game.hud.toast(`Lap ${t.toFixed(1)} s${record ? ' · new best' : ` · best ${this.best.toFixed(1)} s`}`, record)
            }
            else this.game.hud.toast('Lap started · fly through the gates in order')
            this.running = true; this.t0 = now; this.greenUntil = now + 2500; this.game.sound.beep(true)
            for(const gg of this.gates) gg.ring.visible = true
        }
        else this.game.sound.ring(i / n)
        const a = this.game.achievements
        if(a && g.k === 'tunnel') a.unlock('tunnel')
        if(a && g.k === 'arch') { (this.arches = this.arches || new Set()).add(i); if(this.arches.size >= 3) a.unlock('arches') }
        g.ring.visible = i === 0
        this.next = (i + 1) % n
        this.gates[this.next].s = this.side(this.gates[this.next])
    }

    side(g) { return this.game.jet.position.clone().sub(g.c).dot(g.n) }

    update()
    {
        const g = this.game, t = g.ticker.elapsed, flying = g.mode === 'fly' && !g.jet.state.ground
        this.gates.forEach((gate, i) =>
        {
            const next = i === this.next, after = i === (this.next + 1) % this.gates.length
            gate.mat.color.set(next ? '#ffd34d' : '#ffffff')
            gate.mat.opacity = next ? 0.95 : after ? 0.5 : 0.22
            gate.ring.scale.setScalar(next ? 1 + Math.sin(t * 6) * 0.04 : 1)
        })
        this.flags.forEach((f, i) => { f.rotation.y = Math.sin(t * 3.1 + i * 0.7) * 0.25 })
        // start lights: red one by one as you close on the start gate, all green as the lap starts
        let lit = 0
        const green = performance.now() < this.greenUntil
        if(!green && flying && this.next === 0 && !this.running)
        {
            const g0 = this.gates[0], d = g.jet.position.distanceTo(g0.c)
            if(this.side(g0) < 0) lit = d < 90 ? 3 : d < 170 ? 2 : d < 260 ? 1 : 0
        }
        if(lit > this.lit) g.sound.beep(false)
        this.lit = lit
        this.lamps.forEach((l, i) => l.material.color.set(green ? '#3ddc6a' : i < lit ? '#ff3b30' : '#3a2523'))
        if(this.ceremonyArmed && g.mode === 'fly' && g.jet.state.ground && g.jet.state.v < 3 && !g.modes.locked) this.ceremony()
        if(g.mode !== 'fly') { if(this.running || this.next) this.reset(); g.hud.race(null); this.mark.hidden = true; return }

        const gate = this.gates[this.next]
        this.mark.hidden = !flying
        if(flying)
        {
            const s = this.side(gate), p = g.jet.position
            if(gate.s < 0 && s >= 0 && p.distanceTo(gate.c) < gate.r + 2.5) this.pass(this.next)
            else gate.s = s
            this.placeMarker(gate.c)
        }
        g.hud.race(this.running ? { gate: this.next, n: this.gates.length, time: (performance.now() - this.t0) / 1000, best: this.best } : { gate: 0, n: this.gates.length, best: this.best })
    }
}
