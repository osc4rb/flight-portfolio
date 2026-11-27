/* Grass.js — a field of grass blades that always surrounds the camera's focus, sways in the wind and bends away
   from whoever walks or drives through it. The idea follows folio-2025's grass (a fixed set of blades wrapped around
   the player in the vertex shader); this version is ours, written in TSL for three's WebGPU renderer.
   The terrain height and a grass mask (no grass on roads, the plaza, the runway, sand or water) are baked once into
   a small half-float texture that the vertex shader samples. */
import * as THREE from 'three/webgpu'
import { uniform, attribute, positionLocal, vec2, vec3, float, sin, cos, floor, smoothstep, mix, length, max, texture, time, vec4, cameraViewMatrix } from 'three/tsl'
import { Game } from '../engine/Game.js'
import { R_LAND } from './Stage.js'

const TE = 210                  // must match Stage.js: the terrain spans [-TE, TE] on x and z
const RES = 384

export class Grass
{
    constructor()
    {
        this.game = Game.getInstance()
        this.stage = this.game.stage
        const low = this.game.quality.level > 0
        this.size = low ? 44 : 60
        this.count = low ? 14000 : 42000

        this.focus = uniform(new THREE.Vector3())
        this.pusher = uniform(new THREE.Vector3(0, - 99, 0))
        this.pushRadius = uniform(1.4)

        this.setMap()
        this.setMesh()
        this.game.ticker.events.on('tick', () => this.update(), 8.5)
    }

    setMap()
    {
        const data = new Uint16Array(RES * RES * 4), h16 = THREE.DataUtils.toHalfFloat, st = this.stage, rw = st.runway
        const boxes = st.houses.map(h => new THREE.Box3().setFromObject(h.obj).expandByScalar(0.4))      // no grass through floors
        for(let j = 0; j < RES; j++) for(let i = 0; i < RES; i++)
        {
            const x = - TE + (i + 0.5) * 2 * TE / RES, z = - TE + (j + 0.5) * 2 * TE / RES, h = st.height(x, z), r = Math.hypot(x, z)
            let m = 1
            if(h < 0.2 || (h < 0.9 && r > R_LAND - 6)) m = 0                                          // sand and water
            if(st.nearRoad(x, z, 4.8)) m = 0                                                          // ring road and spokes
            if(Math.hypot(x, z) < 17.5) m = 0                                                         // plaza
            if(Math.abs(z - rw.z) < 10.5 && x > rw.x0 - 2 && x < rw.x1 + 2) m = 0                    // runway
            for(const s of [ [ - 40, 30, - 88, 34 ], [ 40, 28, 88, 30 ], [ - 40, - 40, - 72, - 52 ], [ 40, - 40, 76, - 54 ] ])
            {
                const [ ax, az, bx, bz ] = s, dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
                if(Math.hypot(x - ax - dx * t, z - az - dz * t) < 3.8) m = 0                          // diagonal spokes
            }
            for(const bx of boxes) if(x > bx.min.x && x < bx.max.x && z > bx.min.z && z < bx.max.z) { m = 0; break }
            // patches: taller tufts here and there
            m *= 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2) * Math.cos(z * 0.17 + x * 0.05))
            const k = (i + j * RES) * 4
            data[k] = h16(h); data[k + 1] = h16(m); data[k + 2] = 0; data[k + 3] = h16(1)
        }
        if(this.map) { this.map.image.data.set(data); this.map.needsUpdate = true; return }     // re-bake in place (shaders keep the texture)
        this.map = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.HalfFloatType)
        this.map.magFilter = this.map.minFilter = THREE.LinearFilter
        this.map.wrapS = this.map.wrapT = THREE.ClampToEdgeWrapping
        this.map.needsUpdate = true
    }

    setMesh()
    {
        const N = this.count, S = this.size
        const pos = new Float32Array(N * 9), nor = new Float32Array(N * 9), base = new Float32Array(N * 6), rnd = new Float32Array(N * 9)
        for(let b = 0; b < N; b++)
        {
            const bx = Math.random() * S, bz = Math.random() * S, yaw = Math.random() * Math.PI, hs = 0.6 + Math.random() * 0.7, c = Math.random()
            const verts = [ [ - 1, 0 ], [ 1, 0 ], [ 0, 1 ] ]
            verts.forEach(([ side, tip ], v) =>
            {
                const k = b * 3 + v
                pos.set([ side, tip, 0 ], k * 3); nor.set([ 0, 1, 0 ], k * 3); base.set([ bx, bz ], k * 2); rnd.set([ yaw, hs, c ], k * 3)
            })
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
        geo.setAttribute('aBase', new THREE.BufferAttribute(base, 2))
        geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 3))

        const mat = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide })
        const aBase = attribute('aBase', 'vec2'), aRand = attribute('aRand', 'vec3')
        const Sf = float(S), side = positionLocal.x, tip = positionLocal.y

        // wrap the blade around the focus point
        const q = aBase.sub(this.focus.xz).add(Sf.mul(0.5)), rel = q.sub(floor(q.div(Sf)).mul(Sf)).sub(Sf.mul(0.5))
        const wx = this.focus.x.add(rel.x), wz = this.focus.z.add(rel.y)
        const map = texture(this.map, vec2(wx, wz).div(TE * 2).add(0.5)).level(0)
        const edge = smoothstep(Sf.mul(0.5), Sf.mul(0.5).sub(8), length(rel))
        const grow = map.g.mul(edge).mul(aRand.y)
        const run = this.game.tracks ? this.game.tracks.sample(vec2(wx, wz)) : float(0)       // tyre tracks (Tracks.js)
        const height = grow.mul(0.56).mul(float(1).sub(run.mul(0.85))), width = grow.mul(0.06).add(0.01)

        // wind: two travelling waves
        const wind = sin(time.mul(1.6).add(wx.mul(0.13)).add(wz.mul(0.09))).mul(0.22).add(sin(time.mul(3.3).add(wx.mul(0.5)).add(wz.mul(0.37))).mul(0.07))
        // push: away from the walker or the truck
        const away = vec3(wx.sub(this.pusher.x), 0, wz.sub(this.pusher.z)), d = max(length(away), 0.001)
        const push = smoothstep(this.pushRadius, this.pushRadius.mul(0.15), d).mul(smoothstep(2.5, 0.5, this.pusher.y.sub(map.r).abs()))
        const dirX = cos(aRand.x), dirZ = sin(aRand.x)
        const bendX = wind.mul(0.8).add(away.x.div(d).mul(push).mul(1.3)), bendZ = wind.mul(0.45).add(away.z.div(d).mul(push).mul(1.3))
        const t2 = tip.mul(tip)
        mat.positionNode = vec3(
            wx.add(side.mul(dirX).mul(width)).add(bendX.mul(height).mul(t2)),
            map.r.sub(0.04).add(tip.mul(height).mul(float(1).sub(push.mul(0.55)))),
            wz.add(side.mul(dirZ).mul(width)).add(bendZ.mul(height).mul(t2))
        )
        // colour: dark at the root, light at the tip, a little variation per blade; a few flower tips
        // (linear colours: the root matches the terrain's grass, the tip is a little lighter and warmer)
        const root = vec3(0.1, 0.36, 0.045), tipCol = mix(vec3(0.24, 0.54, 0.07), vec3(0.36, 0.56, 0.08), aRand.z)
        const flower = smoothstep(0.975, 0.98, aRand.z).mul(smoothstep(0.8, 1, tip))
        mat.colorNode = mix(mix(root, tipCol, tip.mul(tip)), vec3(1, 0.86, 0.45), flower)
        // every blade is lit like the ground under it (normal straight up), whichever side the camera sees
        mat.normalNode = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz

        // Look rebuilds the material from these: tip (0 root, 1 tip), per-blade shade, flower tips
        this.positionNode = mat.positionNode; this.tip = tip; this.shade = aRand.z.mul(0.22).add(0.9); this.flower = flower
        this.mesh = new THREE.Mesh(geo, mat)
        this.mesh.frustumCulled = false
        this.mesh.receiveShadow = true
        this.mesh.castShadow = false
        this.game.scene.add(this.mesh)
    }

    update()
    {
        const g = this.game, f = g.view.focusPoint.smoothedPosition
        this.focus.value.copy(f)
        this.mesh.visible = g.mode !== 'fly' || g.jet.position.y - g.stage.height(g.jet.position.x, g.jet.position.z) < 40
        const p = g.modes ? g.modes.activePosition() : g.walker.position
        if(g.mode === 'drive') { this.pusher.value.set(p.x, p.y - 0.8, p.z); this.pushRadius.value = 2.4 }
        else if(g.mode === 'foot') { this.pusher.value.set(p.x, p.y - 0.8, p.z); this.pushRadius.value = 1.3 }
        else { this.pusher.value.set(p.x, p.y, p.z); this.pushRadius.value = 6 }
    }
}
