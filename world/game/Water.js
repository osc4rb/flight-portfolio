/* Water.js — the sea, ported from folio-2025 (Bruno Simon, MIT): his Water.js (surface height and the uniforms every
   MeshDefaultMaterial reads for its white waterline) and World/WaterSurface.js (the surface).
   The surface is his: where the details mask is set (deeper than the shore edge, and his ripple rings rolling in
   toward the beach) it is an opaque lit surface; elsewhere it shows a hash-blurred copy of what is under it, so the
   shallows read as looking through water. Ours: the mask's depth comes from the terrain height baked in the grass map
   (his terrain texture's blue channel), his noise textures are three's mx_noise_float, the ripples follow time (he has
   wind time), the surf is a pale sea colour instead of white, and beyond the terrain's edge the surface is the deep sea's colour.
   His ice and rain splashes need his weather, which we don't have. */
import * as THREE from 'three/webgpu'
import { Fn, color, max, mix, positionWorld, screenUV, select, time, uniform, vec3, vec4, viewportSharedTexture, mx_noise_float, abs, smoothstep } from 'three/tsl'
import { hashBlur } from 'three/addons/tsl/display/hashBlur.js'
import { Game } from '../engine/Game.js'
import { MeshDefaultMaterial } from '../engine/Materials/MeshDefaultMaterial.js'

const DEPTH = 3             // metres of water for his terrain "b" to reach 1 (his floor is 1.5 m deep; our sea is deeper)

export class Water
{
    constructor()
    {
        this.surfaceElevation = - 0.4
        this.depthElevation = - 25
        this.surfaceElevationUniform = uniform(this.surfaceElevation)
        this.surfaceThicknessUniform = uniform(0.035)     // his 0.013, for a world four times smaller
    }
}

export class WaterSurface
{
    constructor()
    {
        this.game = Game.getInstance()
        this.mesh = this.game.stage.water
        this.surfaceColor = uniform(color('#d9f3f7'))
        this.deepColor = uniform(color('#1f5f9a'))
        this.throughTint = uniform(color('#9fdcec'))
        this.ripplesRatio = uniform(1)
        this.shoreEdge = uniform(0.17)
        this.setMaterial()
        this.game.quality.events.on('change', () => this.setMaterial())
    }

    // his detailsMask: 1 where the surface shows (shore edge and ripples), 0 where you look through
    detailsMask()
    {
        return Fn(() =>
        {
            const T = this.game.terrain, surface = this.game.water.surfaceElevationUniform
            const h = T.terrainNode(positionWorld.xz).r
            const b = surface.sub(h).div(DEPTH).clamp(0, 1)
            const t = time.mul(0.25)
            const baseRipple = b.add(t).mul(10)
            const noise = mx_noise_float(vec3(positionWorld.xz.add(baseRipple.floor().div(0.345)).mul(0.1), 0)).mul(0.5).add(0.5)
            const ripples = baseRipple.fract().sub(b.remap(0, 1, - 0.3, 1).oneMinus()).add(noise)
            const value = this.ripplesRatio.remap(0, 1, - 1, - 0.4).step(ripples).mul(b.greaterThan(0.005)).toVar()
            value.assign(max(value, this.shoreEdge.step(b)))
            // past the terrain's edge there is nothing under the water to look at
            const edge = max(abs(positionWorld.x), abs(positionWorld.z))
            value.assign(max(value, smoothstep(195, 205, edge)))
            return value
        })()
    }

    setMaterial()
    {
        // past the terrain's edge the surface takes the deep seabed's colour (Stage.js) instead of the surf's
        const edge = smoothstep(195, 205, max(abs(positionWorld.x), abs(positionWorld.z)))
        const material = new MeshDefaultMaterial({
            depthWrite: false,
            colorNode: mix(this.surfaceColor, this.deepColor, edge),
            alphaNode: this.detailsMask(),
            alphaTest: 0,
            hasCoreShadows: false,
            hasDropShadows: true,
            hasLightBounce: false,
            transparent: true,
        })
        material.isMeshDefault = true
        const baseOutput = material.outputNode
        if(this.game.quality.level === 0)
        {
            material.outputNode = Fn(() =>
            {
                const blur = hashBlur(viewportSharedTexture(screenUV), 0.01, { repeats: 25, premultipliedAlpha: true })
                // ours: what you see through the water is tinted toward the sea, so rock under the surface reads as under it
                const seen = mix(vec3(blur).mul(this.throughTint), this.deepColor, 0.12)
                return select(baseOutput.a.lessThan(0.5), vec4(seen, 1), vec4(baseOutput.rgb, 1))
            })()
        }
        material.maskShadowNode = this.detailsMask().greaterThan(0.5)
        if(this.material) this.material.dispose()
        this.material = material
        this.mesh.material = material
        this.mesh.renderOrder = 1
        this.mesh.castShadow = false
        this.mesh.receiveShadow = true
    }
}
