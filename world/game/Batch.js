/* Batch.js — merges static meshes that share a material into one mesh, so they cost one draw call (and one in the
   shadow pass) instead of one each. Only direct children of `group` with no children of their own are merged. */
import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export function batch(group, materials)
{
    for(const material of materials)
    {
        const list = group.children.filter(m => m.isMesh && !m.isInstancedMesh && m.material === material && !m.children.length)
        if(list.length < 2) continue
        const names = Object.keys(list[0].geometry.attributes).filter(n => list.every(m => m.geometry.attributes[n]))
        const geos = list.map(m =>
        {
            m.updateMatrixWorld()
            let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
            for(const n of Object.keys(g.attributes)) if(!names.includes(n)) g.deleteAttribute(n)
            g.applyMatrix4(m.matrixWorld)                    // the group sits at the origin, so world = group space
            return g
        })
        const merged = mergeGeometries(geos)
        if(!merged) continue
        const first = list[0], mesh = new THREE.Mesh(merged, material)
        mesh.castShadow = list.some(m => m.castShadow); mesh.receiveShadow = list.some(m => m.receiveShadow)
        Object.assign(mesh.userData, first.userData)
        for(const m of list) { group.remove(m); m.geometry.dispose() }
        geos.forEach(g => g.dispose())
        group.add(mesh)
    }
}
