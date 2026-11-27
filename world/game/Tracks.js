/* Tracks.js — tyre tracks and boost trails, ported from folio-2025 (Bruno Simon, MIT): his Tracks.js and Trails.js.
   Tracks: every wheel drags a ribbon (a 128-point history in a data texture) that is drawn from above into a small
   render target that follows the player; the grass shortens and the ground darkens where it reads red.
   Trails: glowing tubes that follow a point (his boost trails); ours take two colours instead of his gradient texture.
   Changes from his: the top-down camera follows the player's height (our island has hills), and sample() gives the
   other materials the lookup. */
import * as THREE from 'three/webgpu'
import { screenUV, mul, cos, sin, sign, atan, varying, float, uv, texture, Fn, vec2, vec3, vec4, positionGeometry, attribute, cross, dot, mat3, modelViewMatrix, uniform, mix, color } from 'three/tsl'
import { Game } from '../engine/Game.js'

export class Tracks
{
    constructor()
    {
        this.game = Game.getInstance()
        this.resolution = 512
        this.size = 40
        this.halfSize = this.size / 2
        this.tracks = []
        this.focusPoint = new THREE.Vector2()          // x, z (his Player sets it too)
        this.focusHeight = 0
        this.focusUniform = uniform(new THREE.Vector2())

        this.camera = new THREE.OrthographicCamera(- this.halfSize, this.halfSize, this.halfSize, - this.halfSize, 0.1, 40)
        this.camera.rotation.x = - Math.PI * 0.5
        this.scene = new THREE.Scene()
        this.scene.add(this.camera)
        this.renderTarget = new THREE.RenderTarget(this.resolution, this.resolution, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping })

        this.game.ticker.events.on('tick', () => this.update(), 9)
    }

    // red where a wheel ran, 0 elsewhere (and outside the 40 m square)
    sample(xz)
    {
        return texture(this.renderTarget.texture, xz.sub(this.focusUniform).add(this.halfSize).div(this.size)).r
    }

    add(track)
    {
        this.tracks.push(track)
        this.scene.add(track.trail.mesh)
        return track
    }

    update()
    {
        const r = this.game.rendering && this.game.rendering.renderer
        if(!r) return
        this.camera.position.set(this.focusPoint.x, this.focusHeight + 20, this.focusPoint.y)
        this.focusUniform.value.copy(this.focusPoint)
        const state = THREE.RendererUtils.resetRendererState(r)
        r.setPixelRatio(1)
        r.setRenderTarget(this.renderTarget)
        r.render(this.scene, this.camera)
        r.setRenderTarget(null)
        THREE.RendererUtils.restoreRendererState(r, state)
    }
}

export class Track
{
    constructor(thickness = 1, channel = 'r')
    {
        this.game = Game.getInstance()
        this.subdivisions = 128
        this.timeThrottle = 1 / 30
        this.lastTime = 0
        this.thickness = thickness
        this.channelVec3 = { r: vec3(1, 0, 0), g: vec3(0, 1, 0), b: vec3(0, 0, 1) }[channel]
        this.distanceThrottle = 0.2
        this.lastPosition = new THREE.Vector3(Infinity, Infinity, Infinity)
        this.dataTexture = new THREE.DataTexture(new Float32Array(this.subdivisions * 4), this.subdivisions, 1, THREE.RGBAFormat, THREE.FloatType)
        this.setTrail()
    }

    setTrail()
    {
        this.trail = {}
        this.trail.geometry = new THREE.PlaneGeometry(1, 1, this.subdivisions, 1)
        this.trail.geometry.translate(0.5, 0, 0)
        this.trail.material = new THREE.MeshBasicNodeMaterial({ depthTest: false, transparent: true, blending: THREE.AdditiveBlending })
        const trackData = varying(vec4())

        this.trail.material.positionNode = Fn(() =>
        {
            const fragmentSize = float(1).div(this.subdivisions)
            const ratio = uv().x.sub(fragmentSize.mul(0.5))
            trackData.assign(texture(this.dataTexture, vec2(ratio, 0.5)))
            const prev = texture(this.dataTexture, vec2(ratio.sub(fragmentSize), 0.5))
            const angle = atan(trackData.z.sub(prev.z), trackData.x.sub(prev.x))
            const sideSign = sign(positionGeometry.y).mul(- 1)
            const offset = vec2(cos(angle.add(sideSign.mul(Math.PI * 0.5))), sin(angle.add(sideSign.mul(Math.PI * 0.5)))).mul(this.thickness)
            return vec3(trackData.x.add(offset.x), trackData.y, trackData.z.add(offset.y))
        })()

        this.trail.material.outputNode = Fn(() =>
        {
            const endAlpha = uv().x.smoothstep(0.5, 1).oneMinus()
            const startAlpha = uv().x.smoothstep(0, 0.05)
            const renderEdgeAlpha = mul(screenUV.x.remapClamp(0, 0.2, 0, 1), screenUV.x.remapClamp(0.8, 1, 1, 0), screenUV.y.remapClamp(0, 0.2, 0, 1), screenUV.y.remapClamp(0.8, 1, 1, 0))
            const trackEdgeAlpha = uv().y.sub(0.5).abs().mul(2).oneMinus()
            return vec4(this.channelVec3, endAlpha.mul(startAlpha).mul(trackData.a).mul(trackEdgeAlpha).mul(renderEdgeAlpha))
        })()

        this.trail.mesh = new THREE.Mesh(this.trail.geometry, this.trail.material)
        this.trail.mesh.frustumCulled = false
    }

    update(position, touching)
    {
        const data = this.dataTexture.source.data.data
        if(this.game.ticker.elapsed - this.lastTime > this.timeThrottle && this.lastPosition.distanceTo(position) > this.distanceThrottle)
        {
            for(let i = this.subdivisions - 1; i > 0; i--)
            {
                const i4 = i * 4
                data[i4] = data[i4 - 4]; data[i4 + 1] = data[i4 - 3]; data[i4 + 2] = data[i4 - 2]; data[i4 + 3] = data[i4 - 1]
            }
            this.lastTime = this.game.ticker.elapsed
            this.lastPosition.copy(position)
        }
        data[0] = position.x; data[1] = position.y; data[2] = position.z; data[3] = touching ? 1 : 0
        this.dataTexture.needsUpdate = true
    }
}

const rotationMatrix = Fn(([ u, v ]) =>
{
    const c = dot(u, v), axis = cross(u, v), s = axis.length()
    axis.assign(axis.normalize())
    const t = c.oneMinus()
    return mat3(
        t.mul(axis.x).mul(axis.x).add(c), t.mul(axis.x).mul(axis.y).sub(s.mul(axis.z)), t.mul(axis.x).mul(axis.z).add(s.mul(axis.y)),
        t.mul(axis.x).mul(axis.y).add(s.mul(axis.z)), t.mul(axis.y).mul(axis.y).add(c), t.mul(axis.y).mul(axis.z).sub(s.mul(axis.x)),
        t.mul(axis.x).mul(axis.z).sub(s.mul(axis.y)), t.mul(axis.y).mul(axis.z).add(s.mul(axis.x)), t.mul(axis.z).mul(axis.z).add(c)
    )
})

export class Trails
{
    constructor({ head = '#fff3c4', tail = '#ff6a1f', strength = 5, radius = 0.1 } = {})
    {
        this.game = Game.getInstance()
        this.subdivisions = 32
        this.texel = 1 / this.subdivisions
        this.distanceThrottle = 0.4
        this.emissive = uniform(strength)
        this.fresnelOffset = uniform(0.25)
        this.head = uniform(color(head))
        this.tail = uniform(color(tail))
        this.decay = 0.2
        this.items = []
        this.geometry = new THREE.CylinderGeometry(radius, radius, 1, 4, this.subdivisions, true)
        this.geometry.rotateY(Math.PI * 0.25)
        this.geometry.rotateX(- Math.PI * 0.5)
        this.geometry.translate(0, 0, 0.5)
        this.geometry.deleteAttribute('uv')
        this.game.ticker.events.on('tick', () => this.update(), 10)
    }

    create()
    {
        const item = { lastPosition: new THREE.Vector3(Infinity, Infinity, Infinity), position: new THREE.Vector3(), alpha: 0 }
        item.dataTexture = new THREE.DataTexture(new Float32Array(this.subdivisions * 4), this.subdivisions, 1, THREE.RGBAFormat, THREE.FloatType)
        const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
        const customNormal = vec3().toVarying(), ratio = float(0).toVarying(), alpha = float(0).toVarying()

        material.positionNode = Fn(() =>
        {
            ratio.assign(positionGeometry.z.oneMinus())
            const data = texture(item.dataTexture, vec2(ratio, 0.5)), p = data.xyz
            const next = texture(item.dataTexture, vec2(ratio.add(this.texel), 0.5)).xyz
            const m = rotationMatrix(next.sub(p).normalize(), vec3(0, 0, - 1))
            customNormal.assign(modelViewMatrix.mul(vec4(m.mul(attribute('normal')), 0)))
            alpha.assign(data.w)
            return p.add(m.mul(vec3(positionGeometry.x, positionGeometry.y, 0)))
        })()

        material.outputNode = Fn(() =>
        {
            const fresnel = customNormal.dot(vec3(0, 0, 1)).abs().oneMinus()
            const k = ratio.oneMinus().sub(fresnel.oneMinus().mul(this.fresnelOffset)).clamp(0, 1)
            return vec4(mix(this.tail, this.head, k).mul(this.emissive), ratio.oneMinus().mul(alpha))
        })()
        item.mesh = new THREE.Mesh(this.geometry, material)
        item.mesh.renderOrder = 1
        item.mesh.frustumCulled = false
        item.mesh.userData.noReveal = true
        this.game.scene.add(item.mesh)
        this.items.push(item)
        return item
    }

    update()
    {
        for(const item of this.items)
        {
            const data = item.dataTexture.source.data.data
            if(item.lastPosition.distanceTo(item.position) > this.distanceThrottle)
            {
                for(let i = this.subdivisions - 1; i > 0; i--)
                {
                    const i4 = i * 4
                    data[i4] = data[i4 - 4]; data[i4 + 1] = data[i4 - 3]; data[i4 + 2] = data[i4 - 2]; data[i4 + 3] = data[i4 - 1]
                }
                item.lastPosition.copy(item.position)
            }
            for(let i = 0; i < this.subdivisions; i++) data[i * 4 + 3] = Math.max(data[i * 4 + 3] - this.game.ticker.deltaScaled * this.decay, 0)
            data[0] = item.position.x; data[1] = item.position.y; data[2] = item.position.z; data[3] = item.alpha
            item.dataTexture.needsUpdate = true
        }
    }
}
