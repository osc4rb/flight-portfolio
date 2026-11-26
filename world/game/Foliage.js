/* Foliage.js — tree crowns as clouds of small leaf cards, ported from folio-2025's World/Foliage.js (Bruno Simon,
   MIT). Each crown is many small planes scattered in a few spheres. Their normals are bent toward the sphere's
   surface so the clump shades like one soft ball. A leaf-cluster alpha cuts each card's outline, and the wind turns
   the cut-out so the edges shimmer. The cards face the engine's fixed camera angle, which is baked into the
   geometry. Ours: the leaf texture is drawn in a canvas here, the crowns are three blobs, and the colours are ours. */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Fn, float, mix, normalWorld, positionLocal, positionWorld, rotateUV, sin, texture, time, uniform, uv, vec2, color, instancedBufferAttribute } from 'three/tsl'
import { rng } from './Stage.js'

// a lumpy leaf-cluster field in the red channel: overlapping soft discs, thresholded in the shader
export function leafTexture()
{
    const S = 128, c = document.createElement('canvas'); c.width = c.height = S
    const g = c.getContext('2d'), R = rng(5)
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S)
    g.globalCompositeOperation = 'lighter'
    const blob = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,0,0,${a})`); gr.addColorStop(1, 'rgba(255,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill() }
    blob(S / 2, S / 2, S * 0.36, 0.85)
    for(let i = 0; i < 7; i++) { const a = i / 7 * 6.283 + R() * 0.5, d = S * (0.2 + R() * 0.08); blob(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, S * (0.13 + R() * 0.06), 0.75) }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    return t
}

// one crown: three blobs of cards (a big top one and two side ones), facing the camera direction
export function crownGeometry(towardCamera)
{
    const R = rng(11), planes = []
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), towardCamera.clone().normalize())
    const blobs = [ [ 0, 3.35, 0, 1.55, 70 ], [ - 0.95, 2.75, 0.45, 1.05, 34 ], [ 0.85, 2.85, - 0.5, 1.1, 34 ] ]
    for(const [ bx, by, bz, br, n ] of blobs) for(let i = 0; i < n; i++)
    {
        const plane = new THREE.PlaneGeometry(0.85 * br, 0.85 * br)
        plane.rotateZ(R() * 9999)
        plane.applyQuaternion(face)
        const p = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1 - Math.pow(R(), 3), Math.PI * 2 * R(), Math.PI * R())).multiplyScalar(br)
        plane.translate(p.x + bx, p.y + by, p.z + bz)
        // normals: the card's own facing blended toward the blob's sphere normal (soft round shading)
        const centre = new THREE.Vector3(bx, by, bz), pos = plane.attributes.position, nor = new Float32Array(pos.count * 3)
        for(let k = 0; k < pos.count; k++)
        {
            const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(centre).normalize()
            const m = v.lerp(p.clone().normalize(), 0.85).normalize()
            nor.set([ m.x, m.y, m.z ], k * 3)
        }
        plane.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
        planes.push(plane)
    }
    return mergeGeometries(planes)
}

// a bush: one low blob of cards
export function bushGeometry(towardCamera)
{
    const R = rng(23), planes = []
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), towardCamera.clone().normalize())
    for(let i = 0; i < 38; i++)
    {
        const plane = new THREE.PlaneGeometry(0.75, 0.75)
        plane.rotateZ(R() * 9999); plane.applyQuaternion(face)
        const p = new THREE.Vector3().setFromSpherical(new THREE.Spherical(1 - Math.pow(R(), 3), Math.PI * 2 * R(), Math.PI * 0.55 * R())).multiplyScalar(0.95)
        p.y *= 0.8
        plane.translate(p.x, p.y + 0.45, p.z)
        const pos = plane.attributes.position, nor = new Float32Array(pos.count * 3), centre = new THREE.Vector3(0, 0.45, 0)
        for(let k = 0; k < pos.count; k++) { const v = new THREE.Vector3(pos.getX(k), pos.getY(k), pos.getZ(k)).sub(centre).normalize().lerp(p.clone().normalize(), 0.85).normalize(); nor.set([ v.x, v.y, v.z ], k * 3) }
        plane.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
        planes.push(plane)
    }
    return mergeGeometries(planes)
}

// the material, built once Look has set up the lighting (MeshDefaultMaterial reads game.lighting)
export function foliageMaterial(look, mesh, MeshDefaultMaterial)
{
    const leaf = look.leafTexture || (look.leafTexture = leafTexture())
    const threshold = uniform(0.3)
    // wind turns the cut-out a little, more at the crown's edge
    const wind = sin(time.mul(1.7).add(positionWorld.x.mul(0.35)).add(positionWorld.z.mul(0.27))).mul(0.5).add(sin(time.mul(3.1).add(positionLocal.y.mul(3))).mul(0.18))
    // see-through around the player, as in his Foliage (the leaf field shrinks toward the threshold near you)
    const near = look.holeDistance(0.4, 1.6)
    const alpha = texture(leaf, rotateUV(uv(), wind, vec2(0.5))).r.mul(near.mul(threshold.oneMinus()).add(threshold)).sub(threshold)
    const shadowSide = uniform(color('#3c7a35')), sunSide = uniform(color('#a6d95a'))
    let colorNode = mix(shadowSide, sunSide, normalWorld.dot(look.lighting.directionUniform).smoothstep(0, 1))
    if(mesh.instanceColor) colorNode = colorNode.mul(instancedBufferAttribute(mesh.instanceColor))
    const m = new MeshDefaultMaterial({ colorNode, alphaNode: alpha, hasLightBounce: true })
    m.receivedShadowPositionNode = positionLocal.add(look.lighting.directionUniform.mul(1))      // no self-shadow acne inside the clump
    m.maskShadowNode = texture(leaf).r.greaterThan(0.5)
    m.isMeshDefault = true
    m.userData.ownGlow = true
    m.emissive = new THREE.Color(0, 0, 0); m.emissiveIntensity = 0
    look.foliage = { threshold, shadowSide, sunSide }
    return m
}
