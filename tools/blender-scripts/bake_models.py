"""bake_models.py - builds the world's own models in Blender and exports them as GLB into world/models/.

Run (Blender 4.5 LTS portable, unpacked in tools/blender/):
    tools/blender/blender-4.5.17-windows-x64/blender.exe -b --factory-startup -P tools/blender-scripts/bake_models.py -- world/models

Each model is built from primitives in code (no outside art), bevelled, densified, and gets ambient occlusion baked
by Cycles into a vertex colour (COLOR_0). The world's Look.js multiplies a material's colour by its vertex colour,
so the AO shows up under folio-2025's lighting the way Henry Heffernan's baked rooms look soft.
Blender is Z up; the glTF exporter turns it into Y up (Blender -Y becomes glTF +Z, the side that faces the camera).
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, noise

OUT = os.path.abspath(sys.argv[sys.argv.index('--') + 1]) if '--' in sys.argv else os.path.abspath('world/models')
os.makedirs(OUT, exist_ok=True)


def lin(hexstr):
    """sRGB hex -> linear RGBA, the space glTF base colours are stored in."""
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c] + [1.0]


_mats = {}
def mat(hexstr, rough=0.8):
    if hexstr in _mats:
        return _mats[hexstr]
    m = bpy.data.materials.new('m' + hexstr.lstrip('#'))
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexstr)
    b.inputs['Roughness'].default_value = rough
    _mats[hexstr] = m
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'CPU'
    s.cycles.samples = 48
    if s.world is None:
        s.world = bpy.data.worlds.new('w')


def finish(o, color, name=None, bevel=0.0, segs=3, smooth=0.6):
    if name:
        o.name = name
    o.data.materials.clear()
    o.data.materials.append(mat(color))
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if bevel > 0:
        md = o.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = segs; md.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier=md.name)
    if smooth:
        bpy.ops.object.shade_auto_smooth(angle=smooth)
    o.select_set(False)
    return o


def box(name, size, loc, color, bevel=0.02, segs=3):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.scale = size
    return finish(o, color, name, bevel, segs)


def cyl(name, r, depth, loc, color, rot=(0, 0, 0), verts=32, bevel=0.01, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    return finish(bpy.context.active_object, color, name, bevel, 2)


def sphere(name, r, loc, color, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=12)
    o = bpy.context.active_object; o.scale = scale
    return finish(o, color, name, 0, smooth=1.2)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name; o.select_set(False)
    return o


def densify(o, step):
    """Split long edges so vertex AO has enough points to land on."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    for _ in range(4):
        long = [e for e in bm.edges if e.calc_length() > step]
        if not long:
            break
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=True)
    bm.to_mesh(o.data); bm.free()


def ground(z=0.0, size=40):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, z))
    g = bpy.context.active_object; g.name = '__ground'
    return g


def bake_ao(distance, floor=0.45, paint=None):
    """Cycles AO into a point colour attribute on every mesh, remapped to floor..1, optionally times a paint fn."""
    s = bpy.context.scene
    s.world.light_settings.distance = distance
    s.render.bake.target = 'VERTEX_COLORS'
    meshes = [o for o in s.objects if o.type == 'MESH' and not o.name.startswith('__')]
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        attr = o.data.color_attributes.get('Col') or o.data.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
        o.data.color_attributes.active_color = attr
        o.data.color_attributes.render_color_index = o.data.color_attributes.active_color_index
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type='AO')
    for o in meshes:
        a = o.data.color_attributes['Col']
        for i, d in enumerate(a.data):
            ao = d.color[0]
            k = floor + (1 - floor) * ao
            c = paint(o, o.data.vertices[i].co) if paint else (1, 1, 1)
            d.color = (c[0] * k, c[1] * k, c[2] * k, 1)


def export(name):
    for o in list(bpy.context.scene.objects):
        if o.name.startswith('__'):
            bpy.data.objects.remove(o, do_unlink=True)
    path = os.path.join(OUT, name + '.glb')
    kw = dict(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw, export_colors=True)
    print('wrote', path, os.path.getsize(path), 'bytes')


# ------------------------------------------------------------------------------------------------ desk (Desk.js)
def desk():
    reset()
    wood, dark, metal, key = '#b9824f', '#2a2928', '#9aa0a6', '#3a3937'
    box('top', (2.6, 1.1, 0.06), (0, 0, 0.77), wood, 0.012)
    for x, y in [(-1.2, -0.45), (1.2, -0.45), (-1.2, 0.45), (1.2, 0.45)]:
        box('leg', (0.07, 0.07, 0.74), (x, y, 0.37), dark, 0.01)
    box('drawers', (0.52, 0.95, 0.6), (0.92, 0.02, 0.43), wood, 0.012)
    for z in (0.58, 0.32):
        box('handle', (0.22, 0.03, 0.025), (0.92, -0.47, z), metal, 0.006)
    # monitor: bezel, stand, and the screen plane Desk.js finds by name (1.6 x 0.9, facing -Y = glTF +Z)
    box('bezel', (1.68, 0.06, 0.98), (0, 0.34, 1.57), dark, 0.025, 4)
    box('neck', (0.09, 0.06, 0.34), (0, 0.4, 0.97), dark, 0.015)
    box('foot', (0.5, 0.3, 0.025), (0, 0.32, 0.815), dark, 0.01)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.305, 1.57), rotation=(math.pi / 2, 0, 0))
    scr = bpy.context.active_object; scr.scale = (1.6, 0.9, 1)
    finish(scr, '#100f0f', 'Screen', smooth=0)
    # keyboard with keys, mouse, mug, lamp, plant
    box('keyboard', (0.9, 0.28, 0.025), (0, -0.2, 0.812), key, 0.008)
    keys = []
    for r in range(4):
        for c in range(14):
            keys.append(box('k', (0.048, 0.048, 0.018), (-0.39 + c * 0.06, -0.29 + r * 0.06, 0.83), '#4a4846', 0.006, 1))
    join(keys, 'keys')
    sphere('mouse', 0.06, (0.62, -0.22, 0.81), key, (0.65, 1, 0.38))
    cyl('mug', 0.055, 0.12, (-0.85, -0.05, 0.86), '#f2c94c', verts=24, r2=0.05)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.035, minor_radius=0.01, location=(-0.79, -0.05, 0.865), rotation=(math.pi / 2, 0, 0))
    finish(bpy.context.active_object, '#f2c94c', 'handle')
    cyl('lampbase', 0.09, 0.02, (-1.05, 0.3, 0.81), dark)
    cyl('lamparm', 0.012, 0.5, (-1.05, 0.25, 1.05), dark, rot=(0.35, 0, 0), verts=12)
    cyl('lampshade', 0.11, 0.16, (-1.05, 0.12, 1.28), dark, rot=(1.1, 0, 0), r2=0.04)
    cyl('pot', 0.1, 0.16, (1.12, 0.3, 0.88), '#c9895a', r2=0.08)
    for i, (dx, dy, dz, s) in enumerate([(0, 0, 1.06, 0.12), (0.06, 0.03, 1.12, 0.09), (-0.05, -0.02, 1.13, 0.08)]):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=s, subdivisions=2, location=(1.12 + dx, 0.3 + dy, dz))
        finish(bpy.context.active_object, '#63a842', 'leaves', smooth=0)
    # chair
    box('seat', (0.55, 0.55, 0.08), (0, -0.95, 0.5), dark, 0.03, 4)
    box('back', (0.55, 0.07, 0.6), (0, -1.22, 0.88), dark, 0.03, 4)
    cyl('post', 0.03, 0.42, (0, -0.95, 0.27), metal, verts=12)
    for k in range(5):
        a = k / 5 * math.tau
        box('spoke', (0.32, 0.05, 0.035), (math.cos(a) * 0.16, -0.95 + math.sin(a) * 0.16, 0.07), metal, 0.01).rotation_euler.z = a
        sphere('caster', 0.035, (math.cos(a) * 0.3, -0.95 + math.sin(a) * 0.3, 0.035), dark)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.select_set(False)
            if o.name != 'Screen':
                densify(o, 0.12)
    ground()
    bake_ao(0.45, 0.5)
    export('desk')


# ------------------------------------------------------------------------------------------------ fountain (Stage.js)
def fountain():
    reset()
    stone, trim, water = '#ddd5c4', '#b9b1a1', '#4cc3b6'
    cyl('step', 4.7, 0.25, (0, 0, 0.125), trim, verts=48, bevel=0.04)
    # basin: a cylinder with its top inset and pushed down
    bpy.ops.mesh.primitive_cylinder_add(radius=4.3, depth=0.75, vertices=48, location=(0, 0, 0.6))
    o = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(o.data)
    topf = [f for f in bm.faces if f.normal.z > 0.9]
    r = bmesh.ops.inset_region(bm, faces=topf, thickness=0.4)
    bmesh.ops.translate(bm, vec=Vector((0, 0, -0.55)), verts=list({v for f in topf for v in f.verts}))
    bm.to_mesh(o.data); bm.free()
    finish(o, stone, 'basin', 0.04, 3)
    cyl('Water', 3.88, 0.04, (0, 0, 0.78), water, verts=48, bevel=0)
    cyl('pillar', 0.38, 1.4, (0, 0, 1.3), stone, verts=24, bevel=0.03)
    cyl('bowl1', 0.55, 0.38, (0, 0, 1.95), stone, verts=40, r2=1.5, bevel=0.03)
    cyl('water1', 1.38, 0.03, (0, 0, 2.13), water, verts=40, bevel=0)
    cyl('pillar2', 0.2, 0.9, (0, 0, 2.55), stone, verts=20, bevel=0.02)
    cyl('bowl2', 0.3, 0.26, (0, 0, 3.05), stone, verts=32, r2=0.8, bevel=0.02)
    cyl('water2', 0.72, 0.03, (0, 0, 3.17), water, verts=32, bevel=0)
    sphere('finial', 0.2, (0, 0, 3.4), trim)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            densify(o, 0.35)
    ground()
    bake_ao(1.2, 0.5)
    export('fountain')


# ------------------------------------------------------------------------------------------------ arch (Course.js)
def arch():
    """A unit sea arch: major radius 1, tube 0.2, standing in the XZ plane (fly through along Y). Course.js scales it
    by R and checks collision with the same shape: thickness x (1 + legs) with legs = 0.7 * max(0, 1 - z / 0.55)."""
    reset()
    bpy.ops.mesh.primitive_torus_add(major_radius=1, minor_radius=0.2, major_segments=128, minor_segments=28, rotation=(math.pi / 2, 0, 0))
    o = bpy.context.active_object
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bm = bmesh.new(); bm.from_mesh(o.data)
    kill = [v for v in bm.verts if not (-0.3 <= math.atan2(v.co.z, v.co.x) <= math.pi + 0.3)]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    for v in bm.verts:
        th = math.atan2(v.co.z, v.co.x)
        c = Vector((math.cos(th), 0, math.sin(th)))
        out = v.co - c
        legs = 0.7 * max(0.0, 1 - v.co.z / 0.55)
        n = noise.noise(v.co * 4.0) * 0.18 + noise.noise(v.co * 11.0) * 0.06
        v.co = c + out * (1 + legs + n)
    bm.to_mesh(o.data); bm.free()
    finish(o, '#ffffff', 'arch', smooth=1.0)
    md = o.modifiers.new('sub', 'SUBSURF'); md.levels = 1
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='sub')
    bpy.ops.object.shade_smooth()

    base, dark, moss = lin('#c39a6b'), lin('#93735a'), lin('#74b84a')
    def paint(obj, co):
        n = noise.noise(co * 6.0) * 0.5 + 0.5
        c = [base[i] + (dark[i] - base[i]) * n * 0.8 for i in range(3)]
        if co.z < 0.1 + n * 0.08:
            c = [c[i] + (moss[i] - c[i]) * 0.75 for i in range(3)]
        return c
    ground(-0.02, 6)
    bake_ao(0.35, 0.4, paint)
    export('arch')


# ------------------------------------------------------------------------------------------------ truck (CarVisual.js)
def truck():
    """A small pickup, front toward -Y. CarVisual finds nodes named wheel-front-* / wheel-back-* and spins each about
    its own origin, so every wheel keeps its origin at its centre."""
    reset()
    yellow, dark, glass, tyre, hub = '#f2c94c', '#2d2c2b', '#33424d', '#1d1c1b', '#c9ccd0'
    box('chassis', (1.62, 3.0, 0.36), (0, 0, 0.6), yellow, 0.06, 4)
    box('cab', (1.5, 1.05, 0.72), (0, -0.25, 1.12), yellow, 0.1, 4)
    box('hood', (1.52, 0.85, 0.28), (0, -1.12, 0.9), yellow, 0.08, 4)
    box('windshield', (1.32, 0.05, 0.46), (0, -0.79, 1.18), glass, 0.02).rotation_euler.x = 0.25
    for s in (-1, 1):
        box('sidewin', (0.05, 0.8, 0.42), (s * 0.755, -0.25, 1.2), glass, 0.02)
    box('bedfloor', (1.5, 1.2, 0.08), (0, 0.85, 0.82), dark, 0.02)
    for s in (-1, 1):
        box('bedside', (0.1, 1.2, 0.36), (s * 0.76, 0.85, 1.0), yellow, 0.03)
    box('tailgate', (1.52, 0.1, 0.36), (0, 1.47, 1.0), yellow, 0.03)
    box('bumperF', (1.7, 0.16, 0.2), (0, -1.56, 0.55), dark, 0.05)
    box('bumperB', (1.7, 0.16, 0.2), (0, 1.56, 0.55), dark, 0.05)
    for s in (-1, 1):
        box('headlight', (0.26, 0.04, 0.14), (s * 0.56, -1.55, 0.86), '#fff4c2', 0.02)
        box('taillight', (0.16, 0.04, 0.16), (s * 0.62, 1.53, 0.98), '#e0483e', 0.02)
    box('grille', (0.7, 0.04, 0.18), (0, -1.55, 0.82), dark, 0.02)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.2)
    for name, x, y in [('wheel-front-left', -0.82, -0.98), ('wheel-front-right', 0.82, -0.98), ('wheel-back-left', -0.82, 0.98), ('wheel-back-right', 0.82, 0.98)]:
        t = cyl(name, 0.4, 0.3, (x, y, 0.4), tyre, rot=(0, math.pi / 2, 0), verts=28, bevel=0.06)
        h = cyl('hub', 0.2, 0.32, (x, y, 0.4), hub, rot=(0, math.pi / 2, 0), verts=16, bevel=0.02)
        w = join([t, h], name)
        bpy.context.view_layer.objects.active = w; w.select_set(True)
        bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS'); w.select_set(False)
    ground()
    bake_ao(0.6, 0.5)
    export('truck')


def slab(name, pts, thick, color):
    """A flat polygon (list of (x, y, z)) given thickness along its normal: wings, fins, tails."""
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]
    n = f.normal.copy()
    bmesh.ops.translate(bm, vec=n * thick, verts=nv)
    bmesh.ops.translate(bm, vec=n * (-thick / 2), verts=list(bm.verts))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(o)
    return finish(o, color, name, 0.03, 2)


# ------------------------------------------------------------------------------------------------ jet (Jet.js)
def jet():
    """Our jet, in the jet's own metres: Blender +Y is the jet's forward (+x in Jet.js), X its right side (+z), Z up
    from the bottom of the fuselage (Jet.js lifts the model by the gear height). Same envelope as the planes.js
    airframe it replaces (nose at +6, nozzle at -4.8, span 7.5, fin tips near 2.15), so flight and collision are
    unchanged. Jet.js adds its own gear and afterburner flame."""
    reset()
    grey, dark, glass, metal, yellow = '#8a9097', '#4e545b', '#2a3b4a', '#3a3d42', '#f2c94c'
    box('body', (2.0, 7.4, 0.95), (0, -0.6, 0.58), grey, 0.32, 4)
    nose = cyl('nose', 0.62, 2.95, (0, 4.5, 0.6), grey, rot=(-math.pi / 2, 0, 0), verts=24, r2=0.06, bevel=0.0)
    nose.scale = (1.15, 1, 0.85)
    box('spine', (0.85, 3.4, 0.4), (0, 0.4, 1.0), grey, 0.18, 4)
    sphere('canopy', 1, (0, 3.75, 1.0), glass, (0.34, 1.1, 0.3))
    for s in (-1, 1):
        box('intake', (0.55, 2.4, 0.8), (s * 0.85, 2.15, 0.5), grey, 0.14, 3)
        box('intake-mouth', (0.42, 0.06, 0.62), (s * 0.85, 3.36, 0.5), dark, 0.02)
        slab('wing', [(s * 0.7, 1.27, 0.55), (s * 3.7, -0.32, 0.55), (s * 3.7, -1.95, 0.55), (s * 0.7, -2.74, 0.55)], 0.14, grey)
        slab('elevator', [(s * 0.55, -2.95, 0.62), (s * 2.31, -3.3, 0.62), (s * 2.31, -4.4, 0.62), (s * 0.55, -4.85, 0.62)], 0.1, grey)
        fin = slab('fin', [(0, -2.0, 0.0), (0, -2.95, 1.4), (0, -4.2, 1.4), (0, -4.0, 0.0)], 0.1, grey)
        fin.location = (s * 0.78, 0, 0.75); fin.rotation_euler.y = s * 0.35
        tip = box('fintip', (0.12, 1.28, 0.16), (s * 1.27, -3.57, 2.12), yellow, 0.03)
        tip.rotation_euler.y = s * 0.35
        sphere('nav', 0.07, (s * 3.72, -0.87, 0.58), '#22ff55' if s > 0 else '#ff2a2a')
    cyl('nozzle', 0.45, 0.75, (0, -4.42, 0.55), metal, rot=(math.pi / 2, 0, 0), verts=24, r2=0.4, bevel=0.03)
    cyl('nozzle-hot', 0.32, 0.05, (0, -4.8, 0.55), '#5a2208', rot=(math.pi / 2, 0, 0), verts=24, bevel=0)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.3)
    ground(-1.6)
    bake_ao(0.6, 0.55)
    export('jet')


def half(o, z=0.0, keep_above=True):
    """Cut a mesh with a horizontal plane, keeping one side."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1 if keep_above else -1), clear_inner=True)
    bm.to_mesh(o.data); bm.free()


# ------------------------------------------------------------------------------------------------ hangar (Stage.js garage)
def garage():
    """A Quonset hangar, open toward +Y (glTF -Z, toward the runway): an arched roof with ribs, a back wall, doors
    slid half open with hazard stripes, an office annex, and crates and a workbench inside."""
    reset()
    wall, rib, door, stripe, floor, annex = '#cfd2d6', '#7d838a', '#5d636a', '#f2c94c', '#8d8d88', '#e8e2d4'
    box('floor', (16.4, 12.4, 0.2), (0, 0, 0.1), floor, 0.05)

    def shell(depth, y):
        bpy.ops.mesh.primitive_cylinder_add(radius=8, depth=depth, vertices=48, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.active_object
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        half(o)
        o.location = (0, y, 0); o.scale = (1, 1, 0.72)
        return o

    roof = shell(12, 0)
    bm = bmesh.new(); bm.from_mesh(roof.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.y) > 0.9 or f.normal.z < -0.9], context='FACES')   # open ends and floor
    bm.to_mesh(roof.data); bm.free()
    md = roof.modifiers.new('solid', 'SOLIDIFY'); md.thickness = 0.25
    bpy.context.view_layer.objects.active = roof; bpy.ops.object.modifier_apply(modifier='solid')
    finish(roof, wall, 'roof', 0.04, 2)
    finish(shell(0.25, -6.0), wall, 'back', 0.04, 2)
    gable = shell(0.25, 6.0)
    half(gable, 4.9 / 0.72)                                     # only the part above the doors
    finish(gable, wall, 'gable', 0.04, 2)
    for y in (-5.9, -3.0, 0.0, 3.0, 5.9):
        bpy.ops.mesh.primitive_torus_add(major_radius=8.12, minor_radius=0.12, major_segments=64, minor_segments=8, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
        t = bpy.context.active_object
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        half(t)
        t.location = (0, y, 0); t.scale = (1, 1, 0.72)
        finish(t, rib, 'rib')
    box('header', (16.2, 0.35, 0.45), (0, 6.05, 4.85), rib, 0.05)
    for s in (-1, 1):
        box('door', (3.7, 0.25, 4.6), (s * 6.0, 6.25, 2.5), door, 0.05)
        box('stripe', (0.25, 0.27, 4.6), (s * 4.25, 6.26, 2.5), stripe, 0.02)
        box('stripe', (3.7, 0.27, 0.25), (s * 6.0, 6.26, 0.4), stripe, 0.02)
    box('annex', (3.0, 4.2, 3.0), (9.6, 3.6, 1.6), annex, 0.08)
    box('annex-roof', (3.3, 4.5, 0.2), (9.6, 3.6, 3.15), rib, 0.04)
    for y in (2.5, 4.5):
        box('window', (0.06, 1.1, 0.9), (11.12, y, 1.9), '#33424d', 0.02)
    box('annex-door', (1.0, 0.06, 2.0), (9.0, 5.72, 1.1), door, 0.02)
    for i, (x, y, sz) in enumerate([(-5.5, -4.5, 1.2), (-4.2, -4.6, 1.0), (-5.4, -3.2, 0.9), (5.0, -4.2, 1.4), (5.6, -2.6, 0.8)]):
        box('crate', (sz, sz, sz), (x, y, 0.2 + sz / 2), '#b9824f' if i % 2 else '#9c6b3f', 0.04)
    box('workbench', (3.0, 0.8, 0.9), (0, -5.3, 0.65), rib, 0.04)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.6)
    ground()
    bake_ao(2.0, 0.45)
    export('garage')


only = sys.argv[sys.argv.index('--') + 2:] if '--' in sys.argv else []
for fn in (desk, fountain, arch, truck, jet, garage):
    if not only or fn.__name__ in only:
        fn()
