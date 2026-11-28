/* Stage.js — our island, built for folio-2025's engine scale (his car is 2.6 m long, the camera 15-30 m away).
   A small, dense world: a town ring road, five résumé stations, an airstrip, coins and knock-over crates.
   Models: Kenney starter kits (CC0), loaded from GitHub through jsDelivr at pinned commits. Everything else is code. */
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Game } from '../engine/Game.js'
import { crownGeometry, bushGeometry } from './Foliage.js'

const KIT = {
    racing: 'https://cdn.jsdelivr.net/gh/KenneyNL/Starter-Kit-Racing@2f2e5f2646dda89cb21d4e8539bab60c6e955dc8/models/',
    city: 'https://cdn.jsdelivr.net/gh/KenneyNL/Starter-Kit-City-Builder@4535092b740b378b700efd9df9e27a631815b84a/models/',
    platformer: 'https://cdn.jsdelivr.net/gh/KenneyNL/Starter-Kit-3D-Platformer@3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0/models/',
    // KayKit City Builder Bits 1.0 by Kay Lousberg (CC0)
    kaykit: 'https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0@63976910ca04d16f0fc531b9c614244be8128713/addons/kaykit_city_builder_bits/Assets/gltf/',
}
const MODELS = {
    truckRed: KIT.racing + 'vehicle-truck-red.glb',
    truckGreen: KIT.racing + 'vehicle-truck-green.glb',
    character: KIT.platformer + 'character.glb',
    coin: KIT.platformer + 'coin.glb',
    brick: KIT.platformer + 'brick.glb',
    flag: KIT.platformer + 'flag.glb',
    cloud: KIT.platformer + 'cloud.glb',
    houseA: KIT.kaykit + 'building_A_withoutBase.gltf',
    houseB: KIT.kaykit + 'building_B_withoutBase.gltf',
    houseC: KIT.kaykit + 'building_C_withoutBase.gltf',
    houseD: KIT.kaykit + 'building_D_withoutBase.gltf',
    houseE: KIT.kaykit + 'building_E_withoutBase.gltf',
    houseF: KIT.kaykit + 'building_F_withoutBase.gltf',
    houseG: KIT.kaykit + 'building_G_withoutBase.gltf',
    houseH: KIT.kaykit + 'building_H_withoutBase.gltf',
    bench: KIT.kaykit + 'bench.gltf',
    hydrant: KIT.kaykit + 'firehydrant.gltf',
    bin: KIT.kaykit + 'trash_A.gltf',
    dumpster: KIT.kaykit + 'dumpster.gltf',
    watertower: KIT.kaykit + 'watertower.gltf',
    carA: KIT.kaykit + 'car_sedan.gltf',
    carB: KIT.kaykit + 'car_taxi.gltf',
    carC: KIT.kaykit + 'car_hatchback.gltf',
    carD: KIT.kaykit + 'car_stationwagon.gltf',
    // ours, built in Blender by tools/blender-scripts/bake_models.py (AO baked into vertex colours)
    fountain: 'models/fountain.glb',
    truck: 'models/truck.glb',
    desk: 'models/desk.glb',
    arch: 'models/arch.glb',
    jet: 'models/jet.glb',
    garage: 'models/garage.glb',
    room: 'models/room.glb',
    cabin: 'models/cabin.glb',
    doorway: 'models/doorway.glb',
    crate: 'models/crate.glb',
    tents: KIT.racing + 'decoration-tents.glb',
}

// ground colours shared by the terrain, the grass blades and the light bounce (Look.js)
export const PALETTE = { grass: '#74b84a', grass2: '#63a842', hill: '#97ab52', sand: '#e6c88a', wet: '#c9a466' }

export const START_TRUCK = { x: - 85.5, z: - 106.2 }   // the truck's spot in the opening disc (Reveal START), clear of the walker, the desk and the cabin
export const R_LAND = 150                 // island radius (m); beach to ~175, sea beyond
const TE = 210, SEG = 140                 // terrain half-extent and grid

// small deterministic noise
function hash(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) | 0; h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296 }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

// flat zones: town, runway, stations (x, z, half-width, half-depth)
const FLAT = [
    { x: 0, z: 0, w: 62, d: 62 },
    { x: 0, z: -112, w: 118, d: 16 },
]
export const STATION_SPOTS = [ [ 0, 92 ], [ -96, 34 ], [ 96, 30 ], [ -70, -80 ], [ 82, -60 ] ]   // the fourth stands 35 m from the start disc
STATION_SPOTS.forEach(([ x, z ]) => FLAT.push({ x, z, w: 13, d: 13 }))
// the places you find by exploring, out in the hills (Room.js): the cabin, then the three doorways in site.js order
export const HIDDEN_SPOTS = { cabin: [ - 100, 100 ], doors: [ [ - 132, - 20 ], [ 35, 128 ], [ 128, 40 ] ] }

// the hills before any levelling
function rise(x, z)
{
    const r = Math.hypot(x, z)
    return (vnoise(x * 0.025, z * 0.025) - 0.5) * 9 + (vnoise(x * 0.07 + 9, z * 0.07) - 0.5) * 2.5 + 2.2
        + smooth(90, 140, r) * smooth(0, 1, vnoise(x * 0.012 + 40, z * 0.012)) * 9     // hills near the edge
}
// each hidden place stands on a small level pad at the hill's own height there
export const PADS = [ HIDDEN_SPOTS.cabin, ...HIDDEN_SPOTS.doors ].map(([ x, z ]) => ({ x, z, w: 7, d: 7, y: rise(x, z) }))

export function height(x, z)
{
    const r = Math.hypot(x, z)
    let h = rise(x, z)
    for(const f of PADS) { const k = 1 - smooth(0.75, 1.25, Math.max(Math.abs(x - f.x) / f.w, Math.abs(z - f.z) / f.d)); if(k > 0) h += (f.y - h) * k }
    let flat = 0
    for(const f of FLAT) flat = Math.max(flat, 1 - smooth(0.75, 1.25, Math.max(Math.abs(x - f.x) / f.w, Math.abs(z - f.z) / f.d)))
    // the airfield: flat from the runway north past the start disc, the letters and the hangar (fading 26–40 m out),
    // and south of it one low beach down to the sea, so no ridge stands across the strip
    const dz = z + 112, rwX = 1 - smooth(112, 124, Math.abs(x))
    flat = Math.max(flat, rwX * (dz > 0 ? 1 - smooth(26, 40, dz) : 1))
    h = h * (1 - flat) + 0.6 * flat
    const coast = smooth(R_LAND, R_LAND + 28, r) * (1 - rwX * (1 - smooth(10, 16, Math.abs(dz))))   // beach down into the sea; not under the runway's ends
    return h * (1 - coast) - 4 * coast
}

export class Stage
{
    constructor()
    {
        this.game = Game.getInstance()
        this.models = {}
        this.animated = []
        this.coins = []
        this.occluders = []                    // houses that fade when they hide the player from the camera
        this.houses = []                       // big placed models that squash when the truck hits them (Juice)
        this.height = height

        const respawn = (name, x, z, rotation = 0, lift = 1.6) => ({ name, position: new THREE.Vector3(x, height(x, z) + lift, z), rotation })
        // the first is the truck's start: in the opening disc beside the jet (Reveal START), nose toward the camera corner
        const list = [ respawn('start', START_TRUCK.x, START_TRUCK.z, - Math.PI / 4, 1.0), respawn('town', 8, 14, 0), respawn('runway', -96, -112, 0) ]
        this.respawns = {
            items: list,
            getDefault: () => list[0],
            getByName: (name) => list.find(r => r.name === name) || list[0],
            getClosest: (position) => list.reduce((best, r) => r.position.distanceTo(position) < best.position.distanceTo(position) ? r : best, list[0]),
        }
    }

    async build(progress)
    {
        this.setLights()
        this.setTerrain()
        this.setWater()
        this.setRoads()
        this.setRunway()
        await this.loadModels(progress)
        this.setTown()
        this.setTrees()
        this.setProps()
        this.setCoins()
        this.setClouds()
        this.game.ticker.events.on('tick', () => this.update(), 8)
    }

    // ---------------------------------------------------------------- light, sky, fog
    setLights()
    {
        const scene = this.game.scene
        scene.background = new THREE.Color('#9fd2ec')
        scene.fog = new THREE.Fog('#bfe0ef', 70, 190)
        this.hemi = new THREE.HemisphereLight('#e8f4ff', '#7a8c5a', 1.6)
        scene.add(this.hemi)
        this.sun = new THREE.DirectionalLight('#fff3dc', 2.6)
        this.sun.castShadow = true
        this.sun.shadow.mapSize.set(2048, 2048)
        const c = this.sun.shadow.camera; c.left = - 40; c.right = 40; c.top = 40; c.bottom = - 40; c.near = 1; c.far = 160
        this.sun.shadow.bias = - 0.0005
        this.sunOffset = new THREE.Vector3(30, 60, 20)
        scene.add(this.sun, this.sun.target)
    }

    // ---------------------------------------------------------------- terrain: one mesh + one Rapier heightfield on the same grid
    setTerrain()
    {
        const geo = new THREE.PlaneGeometry(TE * 2, TE * 2, SEG, SEG); geo.rotateX(- Math.PI / 2)
        const pos = geo.attributes.position, col = new Float32Array(pos.count * 3), cc = new THREE.Color()
        const teal = new THREE.Color('#4cc3b6'), deep = new THREE.Color('#1f5f9a'), sand = new THREE.Color(PALETTE.sand), grass = new THREE.Color(PALETTE.grass), grass2 = new THREE.Color(PALETTE.grass2), wet = new THREE.Color(PALETTE.wet), hill = new THREE.Color(PALETTE.hill)
        for(let i = 0; i < pos.count; i++)
        {
            const x = pos.getX(i), z = pos.getZ(i), h = height(x, z)
            if(h < - 0.4) cc.copy(wet).lerp(teal, smooth(0.1, 1.2, - 0.4 - h)).lerp(deep, smooth(1.2, 3.4, - 0.4 - h))     // seabed by depth
            else if(h < 0.9 && Math.hypot(x, z) > R_LAND - 6) cc.copy(sand)
            else cc.copy(grass).lerp(grass2, vnoise(x * 0.05, z * 0.05)).lerp(hill, smooth(5, 12, h))
            cc.multiplyScalar(0.94 + hash(Math.round(x * 3), Math.round(z * 3)) * 0.1)
            pos.setY(i, h); col.set([ cc.r, cc.g, cc.b ], i * 3)
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals()
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }))
        mesh.receiveShadow = true; mesh.userData.ground = true          // shaded with an up normal, like folio-2025's floor
        this.game.scene.add(mesh)

        const N = SEG, hts = new Float32Array((N + 1) * (N + 1))
        for(let j = 0; j <= N; j++) for(let i = 0; i <= N; i++) hts[i + j * (N + 1)] = height(- TE + 2 * TE * j / N, - TE + 2 * TE * i / N)
        this.game.objects.add(null, { type: 'fixed', friction: 0.6, category: 'floor', colliders: [ { shape: 'heightfield', parameters: [ N, N, hts, { x: TE * 2, y: 1, z: TE * 2 } ], category: 'floor' } ] })
    }

    setWater()
    {
        const water = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: '#2f9fd0', transparent: true, opacity: 0.85 }))
        water.rotation.x = - Math.PI / 2; water.position.y = - 0.4
        this.water = water
        this.game.scene.add(water)
    }

    // ---------------------------------------------------------------- roads: flat ribbons hugging the ground
    ribbon(points, width, color, lift = 0.06)
    {
        (this.roads = this.roads || []).push({ points, width })     // Map.js draws them
        const P = [], I = []
        for(let k = 0; k < points.length; k++)
        {
            const a = points[Math.max(0, k - 1)], b = points[Math.min(points.length - 1, k + 1)], p = points[k]
            const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = - dz / l * width / 2, nz = dx / l * width / 2
            P.push(p[0] + nx, height(p[0] + nx, p[1] + nz) + lift, p[1] + nz, p[0] - nx, height(p[0] - nx, p[1] - nz) + lift, p[1] - nz)
            if(k) { const o = (k - 1) * 2; I.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals()
        const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: - 2 }))
        m.receiveShadow = true; m.userData.ground = true; m.userData.slabs = lift < 0.08; this.game.scene.add(m); return m
    }
    path(ax, az, bx, bz, step = 2) { const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / step)); return Array.from({ length: n + 1 }, (_, i) => [ ax + (bx - ax) * i / n, az + (bz - az) * i / n ]) }

    setRoads()
    {
        const asphalt = '#bba98a', line = '#f3eede'                // stone slabs (Look paints them)
        const ring = []
        const corners = [ [ - 40, - 40 ], [ 40, - 40 ], [ 40, 40 ], [ - 40, 40 ], [ - 40, - 40 ] ]
        for(let k = 0; k < 4; k++) ring.push(...this.path(...corners[k], ...corners[k + 1]).slice(k ? 1 : 0))
        this.ribbon(ring, 8, asphalt)
        // spokes out to the stations and the airstrip
        const spokes = [ [ 0, 40, 0, 84 ], [ - 40, 30, - 88, 34 ], [ 40, 28, 88, 30 ], [ - 40, - 40, - 72, - 52 ], [ 40, - 40, 76, - 54 ], [ 0, - 40, 0, - 100 ] ]
        spokes.forEach(s => this.ribbon(this.path(...s), 6, asphalt))
        // (no centre line: the roads are slab paths now)
        for(let k = 0; k < 0; k++)
        {
            const [ ax, az ] = corners[k], [ bx, bz ] = corners[k + 1]
            for(let t = 0.06; t < 0.94; t += 0.09)
            {
                const x0 = ax + (bx - ax) * t, z0 = az + (bz - az) * t, x1 = ax + (bx - ax) * (t + 0.04), z1 = az + (bz - az) * (t + 0.04)
                this.ribbon([ [ x0, z0 ], [ x1, z1 ] ], 0.35, line, 0.09)
            }
        }
        // plaza
        const plaza = new THREE.Mesh(new THREE.CircleGeometry(16, 40), new THREE.MeshLambertMaterial({ color: '#cdbd9d' }))
        plaza.rotation.x = - Math.PI / 2; plaza.position.set(0, height(0, 0) + 0.07, 0); plaza.receiveShadow = true; plaza.userData.ground = true; plaza.userData.slabs = true
        this.game.scene.add(plaza)
    }

    setRunway()
    {
        const z = - 112, y = height(0, z)
        const strip = new THREE.Mesh(new THREE.BoxGeometry(220, 0.1, 18), new THREE.MeshLambertMaterial({ color: '#4c4f55' }))
        strip.position.set(0, y + 0.03, z); strip.receiveShadow = true; strip.userData.ground = true; this.game.scene.add(strip)
        const mark = new THREE.MeshLambertMaterial({ color: '#f3eede' })
        for(let x = - 96; x <= 96; x += 12) { const d = new THREE.Mesh(new THREE.BoxGeometry(6, 0.12, 0.6), mark); d.position.set(x, y + 0.05, z); this.game.scene.add(d) }
        for(const s of [ - 1, 1 ]) for(let k = 0; k < 6; k++) { const d = new THREE.Mesh(new THREE.BoxGeometry(5, 0.12, 0.9), mark); d.position.set(s * 104, y + 0.05, z - 6.5 + k * 2.6); this.game.scene.add(d) }
        this.runway = { x0: - 110, x1: 110, z, y }
    }

    // ---------------------------------------------------------------- Kenney models
    async loadModels(progress)
    {
        const loader = new GLTFLoader(), names = Object.keys(MODELS)
        let done = 0
        await Promise.all(names.map(name => loader.loadAsync(MODELS[name]).then(g => { this.models[name] = g }).catch(e => { console.warn('model failed', name, e) }).finally(() => progress(++done / names.length))))
    }

    // a placed copy of a model, scaled so its footprint (or height) matches `size`, sitting on the ground
    place(name, x, z, { size = 6, by = 'width', rotation = 0, collide = true, y = null } = {})
    {
        const src = this.models[name]; if(!src) return null
        const obj = src.scene.clone(true)
        const box = new THREE.Box3().setFromObject(obj), s = box.getSize(new THREE.Vector3())
        const k = size / (by === 'height' ? s.y : Math.max(s.x, s.z))
        obj.scale.setScalar(k); obj.rotation.y = rotation
        const gy = y === null ? height(x, z) : y
        obj.position.set(x, gy - box.min.y * k, z)
        obj.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
        this.game.scene.add(obj)
        if(collide && size >= 8)
        {
            obj.traverse(c => { if(c.isMesh) { c.material = c.material.clone(); c.material.userData.fade = true } })      // Look dithers it
            const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere())
            this.occluders.push({ obj, sphere, fade: 1 })
            this.houses.push({ obj, x, z, r: Math.min(sphere.radius * 0.7, size * 0.6) })
        }
        if(collide)
        {
            obj.updateMatrixWorld(true)
            const wb = new THREE.Box3().setFromObject(obj), ws = wb.getSize(new THREE.Vector3()), wc = wb.getCenter(new THREE.Vector3())
            this.game.objects.add(null, { type: 'fixed', friction: 0.5, colliders: [ { shape: 'cuboid', parameters: [ ws.x / 2 * 0.92, ws.y / 2, ws.z / 2 * 0.92 ], position: wc } ] })
        }
        if(this.game.look) this.game.look.convert(obj)          // placed after the world was converted (stations)
        return obj
    }

    setTown()
    {
        const houses = [ 'houseA', 'houseB', 'houseC', 'houseD', 'houseE', 'houseF', 'houseG', 'houseH' ], R = rng(4)
        // houses facing the ring road, inside and outside the block
        const spots = []
        for(let t = - 28; t <= 28; t += 14)
        {
            spots.push([ t, - 52, 0 ], [ t, 52, Math.PI ], [ - 52, t, Math.PI / 2 ], [ 52, t, - Math.PI / 2 ])
            if(Math.abs(t) > 10) spots.push([ t, - 28, Math.PI ], [ t, 28, 0 ], [ - 28, t, - Math.PI / 2 ], [ 28, t, Math.PI / 2 ])
        }
        for(const [ x, z, r ] of spots)
        {
            if(Math.hypot(x, z - 40) < 9 || Math.hypot(x + 40, z - 30) < 9 || Math.hypot(x - 40, z - 28) < 9 || Math.abs(x) < 6 && z < 0) continue
            this.place(houses[Math.floor(R() * houses.length)], x, z, { size: 8 + R() * 2.5, by: 'height', rotation: r })      // KayKit blocks: scale by height
        }
        this.place('fountain', 0, 0, { size: 9 })
        this.setStreet(spots)
        this.place('garage', - 22, - 96.5, { size: 19.4, rotation: 0 })                           // our hangar with its annex, at 1:1, doors at the runway's edge
        this.place('tents', 24, - 98, { size: 18, collide: false })
    }

    // ---------------------------------------------------------------- street life (KayKit props) and leaf-card bushes
    setStreet(houseSpots)
    {
        const R = rng(8)
        // benches around the plaza, facing the fountain
        for(let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + 0.26; this.place('bench', Math.cos(a) * 13.5, Math.sin(a) * 13.5, { size: 2.4, rotation: - a - Math.PI / 2 }) }
        // parked cars along the outside of the ring road
        const cars = [ 'carA', 'carB', 'carC', 'carD' ], parked = [ [ - 20, 46.5, 0 ], [ 14, 46.5, 0 ], [ 46.5, - 16, Math.PI / 2 ], [ - 46.5, 8, Math.PI / 2 ], [ 24, - 46.5, 0 ], [ - 8, - 46.5, Math.PI ] ]
        parked.forEach(([ x, z, r ], i) => this.place(cars[i % cars.length], x, z, { size: 4.2, rotation: r }))
        // hydrants and bins by the road, a dumpster by the hangar, a water tower on the hill
        for(const [ x, z ] of [ [ 34, 45.5 ], [ - 45.5, - 30 ], [ 45.5, 22 ], [ - 30, - 45.5 ] ]) this.place('hydrant', x, z, { size: 0.9, by: 'height' })
        for(const [ x, z ] of [ [ 4, 45.5 ], [ - 45.5, - 4 ], [ 45.5, - 34 ], [ 10, - 45.5 ], [ 15.5, 6 ] ]) this.place('bin', x, z, { size: 1.1, by: 'height' })
        this.place('dumpster', - 34, - 100, { size: 3 })
        this.place('watertower', 70, 70, { size: 12, by: 'height' })
        // bushes: two in front of most houses, a ring round the plaza
        const spots = []
        for(const [ x, z, r ] of houseSpots)
        {
            if(R() < 0.25) continue
            const fx = Math.sin(r), fz = Math.cos(r), sx = fz, sz = - fx
            for(const side of [ - 1, 1 ]) spots.push([ x + fx * 5.2 + sx * side * (3 + R()), z + fz * 5.2 + sz * side * (3 + R()), 0.8 + R() * 0.5 ])
        }
        for(let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; spots.push([ Math.cos(a) * 17.5, Math.sin(a) * 17.5, 0.9 + R() * 0.4 ]) }
        const mat = new THREE.MeshLambertMaterial({ color: '#4f9a4a' }); mat.userData.foliage = true
        const bushes = new THREE.InstancedMesh(bushGeometry(this.cameraDirection()), mat, spots.length)
        const d = new THREE.Object3D(), c = new THREE.Color()
        spots.forEach(([ x, z, s ], i) => { d.position.set(x, height(x, z) - 0.15, z); d.scale.setScalar(s); d.updateMatrix(); bushes.setMatrixAt(i, d.matrix); bushes.setColorAt(i, c.setRGB(1, 1, 1).offsetHSL((R() - 0.5) * 0.06, 0, (R() - 0.5) * 0.1)) })
        bushes.castShadow = true; bushes.receiveShadow = true
        this.game.scene.add(bushes)
        this.bushes = bushes
    }

    // ---------------------------------------------------------------- code-built low-poly trees, instanced
    setTrees()
    {
        const R = rng(9), spots = []
        for(let n = 0; n < 900 && spots.length < 260; n++)
        {
            const a = R() * Math.PI * 2, r = 30 + Math.sqrt(R()) * (R_LAND - 34), x = Math.cos(a) * r, z = Math.sin(a) * r
            if([ ...FLAT, ...PADS ].some(f => Math.abs(x - f.x) < f.w + 4 && Math.abs(z - f.z) < f.d + 4)) continue
            if(this.nearRoad(x, z, 7) || height(x, z) < 1.2) continue
            spots.push([ x, z, 0.8 + R() * 0.7 ])
        }
        const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.24, 2.9, 7).translate(0, 1.45, 0), new THREE.MeshLambertMaterial({ color: '#7a4b37' }), spots.length)
        // crowns are leaf-card clouds (Foliage.js); Look gives them folio-2025's foliage material
        const crownMat = new THREE.MeshLambertMaterial({ color: '#4f9a4a' }); crownMat.userData.foliage = true
        const crown = new THREE.InstancedMesh(crownGeometry(this.cameraDirection()), crownMat, spots.length)
        const d = new THREE.Object3D(), c = new THREE.Color()
        this.trees = { trunk, crown, list: [] }
        spots.forEach(([ x, z, s ], i) =>
        {
            R(); const rot = 0                                  // no yaw: the leaf cards face the camera angle
            d.position.set(x, height(x, z) - 0.1, z); d.scale.setScalar(s); d.rotation.y = rot; d.updateMatrix()
            trunk.setMatrixAt(i, d.matrix); crown.setMatrixAt(i, d.matrix)
            crown.setColorAt(i, c.setRGB(1, 1, 1).offsetHSL((R() - 0.5) * 0.05, 0, (R() - 0.5) * 0.1))
            const o = this.game.objects.add(null, { type: 'fixed', colliders: [ { shape: 'cylinder', parameters: [ 1.6 * s, 0.35 * s ], position: { x, y: height(x, z) + 1.6 * s, z } } ] })
            this.trees.list.push({ i, x, y: height(x, z) - 0.1, z, s, rot, r: 0.6 * s, collider: o.physical && o.physical.colliders[0] && o.physical.colliders[0].handle })
        })
        trunk.instanceMatrix.setUsage(THREE.DynamicDrawUsage); crown.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        trunk.castShadow = crown.castShadow = true; crown.receiveShadow = true
        this.game.scene.add(trunk, crown)
    }
    // the fixed camera's direction from its angles alone: the offset also holds a radius that is NaN while the
    // viewport has no size (a hidden tab at load), which made every leaf card NaN
    cameraDirection() { const s = this.game.view.spherical; return new THREE.Vector3().setFromSphericalCoords(1, s.phi, s.theta) }

    nearRoad(x, z, m)
    {
        const onRing = (Math.abs(Math.abs(x) - 40) < m && Math.abs(z) < 40 + m) || (Math.abs(Math.abs(z) - 40) < m && Math.abs(x) < 40 + m)
        return onRing || (Math.abs(x) < m && z > 40 && z < 86) || (Math.abs(x) < m && z < - 40 && z > - 100)
    }

    // ---------------------------------------------------------------- things to knock over
    setProps()
    {
        const brick = this.models.brick; if(!brick) return
        const proto = brick.scene, box = new THREE.Box3().setFromObject(proto), s = box.getSize(new THREE.Vector3()), k = 1.1 / Math.max(s.x, s.y, s.z)
        const stack = (cx, cz, rows) =>
        {
            for(let r = 0; r < rows; r++) for(let i = 0; i < rows - r; i++)
            {
                const x = cx + (i - (rows - r - 1) / 2) * 1.15, y = height(cx, cz) + 0.56 + r * 1.12
                const model = proto.clone(true); model.scale.setScalar(k)
                model.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true } })
                const inner = new THREE.Group(); model.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(- k)); inner.add(model)
                this.game.objects.add({ model: inner }, { type: 'dynamic', position: { x, y, z: cz }, friction: 0.7, restitution: 0.1, sleeping: true,
                    contactThreshold: 3, onCollision: this.brickHit(),
                    colliders: [ { shape: 'cuboid', parameters: [ 0.55, 0.55, 0.55 ], mass: 0.4 } ] })
            }
        }
        stack(12, - 12, 4); stack(- 14, 16, 3); stack(30, - 100, 5); stack(-60, -104, 4)
    }

    // a brick clonks only on a real knock: a spike well above its last contact force (a resting stack reports its
    // weight every frame), at most a few times a second
    brickHit()
    {
        let last = 0, at = 0
        return (force, p) =>
        {
            const g = this.game, now = performance.now(), spike = force > 12 && force > last * 1.8
            last = last * 0.8 + force * 0.2
            if(!spike || now - at < 220) return
            at = now
            g.sound && g.sound.clonk(Math.min(1, force / 60))
            if(force > 30 && g.juice) g.juice.dust(new THREE.Vector3(p.x, p.y - 0.3, p.z), 3, { size: 0.35 })
        }
    }

    setCoins()
    {
        const coin = this.models.coin; if(!coin) return
        const R = rng(21), spots = [ [ 0, 18 ], [ 20, 0 ], [ - 20, 0 ], [ 0, - 20 ] ]
        while(spots.length < 24) { const a = R() * Math.PI * 2, r = 20 + R() * 110, x = Math.cos(a) * r, z = Math.sin(a) * r; if(height(x, z) > 0.8 && !this.nearRoad(x, z, 3)) spots.push([ x, z ]) }
        spots.forEach(([ x, z ]) =>
        {
            const obj = this.place('coin', x, z, { size: 1.3, by: 'height', collide: false, y: height(x, z) + 0.9 })
            if(obj) this.coins.push({ obj, x, z, y: obj.position.y, taken: false })
        })
    }

    setClouds()
    {
        const R = rng(31)
        for(let i = 0; i < 14; i++) { const a = R() * 6.28, r = 40 + R() * 140; const c = this.place('cloud', Math.cos(a) * r, Math.sin(a) * r, { size: 14 + R() * 12, collide: false, y: 34 + R() * 16 }); if(c) { c.traverse(o => { o.castShadow = false }); this.animated.push({ obj: c, drift: 0.6 + R() }) } }   // no cloud shadows: they read as dark slabs
    }

    update()
    {
        const t = this.game.ticker.elapsed, dt = this.game.ticker.delta, f = this.game.view.focusPoint.smoothedPosition
        const sf = (this.game.room && this.game.room.sunAt) || f          // in the room the shadows follow the room
        this.sun.position.copy(sf).add(this.sunOffset); this.sun.target.position.copy(sf)
        this.water.position.x = f.x; this.water.position.z = f.z
        for(const c of this.coins) if(!c.taken) { c.obj.rotation.y = t * 2.2; c.obj.position.y = c.y + Math.sin(t * 2 + c.x) * 0.15 }
        for(const a of this.animated) { a.obj.position.x += a.drift * dt; if(a.obj.position.x > 220) a.obj.position.x = - 220 }

        // fade houses standing between the camera and the player (the camera always looks from the same corner)
        const cam = this.game.view.camera.position, seg = new THREE.Line3(cam, f), on = new THREE.Vector3()
        for(const o of this.occluders)
        {
            seg.closestPointToPoint(o.sphere.center, true, on)
            const hide = on.distanceTo(o.sphere.center) < o.sphere.radius * 0.85 && o.sphere.center.distanceTo(f) > 3
            const want = hide ? 0.18 : 1
            if(Math.abs(o.fade - want) < 0.01) continue
            o.fade += (want - o.fade) * Math.min(1, dt * 8)
            o.obj.traverse(c => { if(c.isMesh) c.material.opacity = o.fade })
        }
    }
}
