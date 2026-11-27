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
        bpy.ops.object.shade_smooth_by_angle(angle=smooth)
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
    """A lifted pickup in metres, front toward -Y, Z up from the ground. CarVisual (JS) finds these nodes by name:
    wheel-front-* / wheel-back-* (each spun about its own origin at the wheel centre, and moved up and down with its
    suspension), headlight, lightbar, taillight, reverse, blinker-left, blinker-right (lit by JS). The wheel centres
    match folio-2025's PhysicsVehicle (x +-0.9 forward, z +-0.75 across, radius 0.4)."""
    reset()
    yellow, dark, black, glass, tyre, rim = '#f2c94c', '#2d2c2b', '#1b1b1d', '#33424d', '#1d1c1b', '#5b5f66'
    lamp, red, amber, white = '#fff4c2', '#e0483e', '#ffae2a', '#f4f4f0'
    WZ, WR = 0.42, 0.42                      # wheel centre height and radius
    box('frame', (0.9, 2.7, 0.2), (0, 0, 0.66), black, 0.03)
    box('sill', (1.6, 3.12, 0.16), (0, 0.02, 0.94), yellow, 0.05, 3)
    box('cab', (1.56, 1.1, 0.74), (0, -0.15, 1.38), yellow, 0.1, 4)
    box('hood', (1.58, 0.98, 0.44), (0, -1.09, 1.21), yellow, 0.08, 4)
    box('roof', (1.44, 0.96, 0.06), (0, -0.15, 1.77), dark, 0.03)
    box('windshield', (1.36, 0.05, 0.5), (0, -0.71, 1.45), glass, 0.02).rotation_euler.x = 0.3
    box('rearwindow', (1.3, 0.05, 0.38), (0, 0.41, 1.46), glass, 0.02)
    for s in (-1, 1):
        box('sidewin', (0.05, 0.84, 0.4), (s * 0.785, -0.15, 1.46), glass, 0.02)
        box('mirror', (0.08, 0.16, 0.12), (s * 0.86, -0.6, 1.4), dark, 0.02)
    box('bedfloor', (1.5, 1.22, 0.08), (0, 0.95, 1.04), dark, 0.02)
    for s in (-1, 1):
        box('bedside', (0.1, 1.22, 0.38), (s * 0.75, 0.95, 1.21), yellow, 0.03)
        box('rail', (0.06, 1.18, 0.05), (s * 0.75, 0.95, 1.43), dark, 0.02)
    box('tailgate', (1.56, 0.1, 0.4), (0, 1.56, 1.2), yellow, 0.03)
    cyl('spare', 0.3, 0.2, (0, 1.0, 1.18), tyre, verts=24, bevel=0.05)
    cyl('sparehub', 0.16, 0.22, (0, 1.0, 1.18), rim, verts=16, bevel=0.02)
    # fender flares over each wheel
    for x in (-1, 1):
        for y in (-0.9, 0.9):
            box('fender', (0.26, 1.02, 0.1), (x * 0.84, y, 0.98), black, 0.04, 3)
    # front: grille, round headlights, blinkers, bumper and a bull bar
    box('grille', (0.66, 0.05, 0.26), (0, -1.585, 1.2), black, 0.02)
    for s in (-1, 1):
        cyl('headlight', 0.12, 0.06, (s * 0.55, -1.59, 1.22), lamp, rot=(math.pi / 2, 0, 0), verts=20, bevel=0.01)
        cyl('headring', 0.15, 0.04, (s * 0.55, -1.575, 1.22), dark, rot=(math.pi / 2, 0, 0), verts=20, bevel=0.01)
    box('blinker-left', (0.13, 0.05, 0.08), (0.7, -1.59, 1.05), amber, 0.015)
    box('blinker-right', (0.13, 0.05, 0.08), (-0.7, -1.59, 1.05), amber, 0.015)
    box('bumperF', (1.72, 0.2, 0.22), (0, -1.66, 0.9), black, 0.05)
    for s in (-1, 1):
        cyl('bar', 0.045, 0.46, (s * 0.42, -1.8, 1.08), black, verts=12, bevel=0.0)
    cyl('bar', 0.045, 0.94, (0, -1.8, 1.31), black, rot=(0, math.pi / 2, 0), verts=12, bevel=0.0)
    # back: tail lights, reverse lights, rear blinkers, bumper
    for s in (-1, 1):
        box('taillight', (0.18, 0.05, 0.2), (s * 0.64, 1.62, 1.22), red, 0.015)
        box('reverse', (0.1, 0.05, 0.07), (s * 0.4, 1.62, 1.3), white, 0.01)
    box('blinker-left-rear', (0.18, 0.05, 0.07), (0.64, 1.62, 1.07), amber, 0.01)
    box('blinker-right-rear', (0.18, 0.05, 0.07), (-0.64, 1.62, 1.07), amber, 0.01)
    box('bumperB', (1.72, 0.2, 0.2), (0, 1.66, 0.9), black, 0.05)
    # roof light bar: a dark bar on two feet, four lamps facing forward
    box('barbase', (1.32, 0.2, 0.12), (0, -0.42, 1.88), black, 0.03)
    for s in (-1, 1):
        box('barfoot', (0.08, 0.12, 0.1), (s * 0.55, -0.4, 1.82), black, 0.01)
    for i, x in enumerate((-0.48, -0.16, 0.16, 0.48)):
        box('lightbar', (0.26, 0.06, 0.08), (x, -0.53, 1.88), lamp, 0.01)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.2)
    for name, x, y in [('wheel-front-left', 0.8, -0.9), ('wheel-front-right', -0.8, -0.9), ('wheel-back-left', 0.8, 0.9), ('wheel-back-right', -0.8, 0.9)]:
        parts = [cyl(name, WR - 0.04, 0.34, (x, y, WZ), tyre, rot=(0, math.pi / 2, 0), verts=32, bevel=0.07)]
        for k in range(18):                  # tread blocks round the tyre
            a = k / 18 * math.pi * 2
            b = box('tread', (0.3, 0.12, 0.07), (x, y + (WR - 0.04) * math.cos(a), WZ + (WR - 0.04) * math.sin(a)), tyre, 0.015)
            b.rotation_euler.x = a + math.pi / 2
            parts.append(b)
        parts.append(cyl('rim', 0.24, 0.36, (x, y, WZ), rim, rot=(0, math.pi / 2, 0), verts=20, bevel=0.02))
        parts.append(cyl('cap', 0.09, 0.38, (x, y, WZ), yellow, rot=(0, math.pi / 2, 0), verts=12, bevel=0.01))
        for p in parts:
            p.select_set(True); bpy.context.view_layer.objects.active = p
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); p.select_set(False)
        w = join(parts, name)
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


def plane(name, w, h, loc, rot, color):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.scale = (w, h, 1)
    return finish(o, color, name, smooth=0)


# ------------------------------------------------------------------------------------------------ room (Room.js)
def room():
    """The room you walk into from the cabin: a floor and two walls (back +Y, left -X), open toward the camera corner
    (-Y, +X = glTF +Z, +X). Room.js finds the clickable things by node name: Computer + Screen (the CV, a CSS3D page
    laid on Screen, 1.6 x 0.9 like the desk), Board + BoardFace (projects drawn on it), Shelf (papers), Phone (contact)."""
    reset()
    wall, trim, wood, plank2, dark, metal = '#e9dcc6', '#cbb89a', '#b98a5e', '#a97b52', '#2a2928', '#9aa0a6'
    W, H = 3.0, 2.8                                                   # half width, wall height
    planks = []
    for i in range(12):
        x = -W + 0.25 + i * 0.5
        planks.append(box('plank', (0.49, 2 * W, 0.12), (x, 0, -0.06), wood if i % 2 else plank2, 0.01, 1))
    floor = join(planks, 'floor')
    box('wallback', (2 * W + 0.2, 0.2, H), (0, W + 0.1, H / 2), wall, 0.02)
    box('wallleft', (0.2, 2 * W + 0.2, H), (-W - 0.1, 0, H / 2), wall, 0.02)
    box('skirtback', (2 * W, 0.04, 0.12), (0, W - 0.02, 0.06), trim, 0.01)
    box('skirtleft', (0.04, 2 * W, 0.12), (-W + 0.02, 0, 0.06), trim, 0.01)
    box('rug', (2.6, 1.9, 0.02), (0.2, 0.2, 0.01), '#6f8fa8', 0.01)
    box('rugedge', (2.3, 1.6, 0.025), (0.2, 0.2, 0.012), '#d8c9a8', 0.01)

    # desk against the back wall, with the computer
    box('desktop', (1.9, 0.8, 0.05), (1.1, 2.5, 0.75), wood, 0.012)
    for x, y in [(0.22, 2.17), (1.98, 2.17), (0.22, 2.83), (1.98, 2.83)]:
        box('deskleg', (0.06, 0.06, 0.73), (x, y, 0.365), dark, 0.01)
    box('drawer', (0.45, 0.7, 0.5), (1.7, 2.5, 0.45), wood, 0.012)
    comp = [box('bezel', (1.68, 0.06, 0.98), (1.0, 2.72, 1.45), dark, 0.025, 4),
            box('neck', (0.09, 0.06, 0.3), (1.0, 2.78, 0.9), dark, 0.015),
            box('foot', (0.5, 0.3, 0.025), (1.0, 2.7, 0.785), dark, 0.01),
            box('keyboard', (0.8, 0.26, 0.025), (1.0, 2.3, 0.79), '#3a3937', 0.008),
            sphere('mouse', 0.055, (1.6, 2.32, 0.785), '#3a3937', (0.65, 1, 0.38))]
    join(comp, 'Computer')
    plane('Screen', 1.6, 0.9, (1.0, 2.685, 1.45), (math.pi / 2, 0, 0), '#100f0f')
    cyl('mug', 0.05, 0.11, (0.4, 2.3, 0.83), '#f2c94c', verts=20, r2=0.045)
    cyl('lampbase', 0.08, 0.02, (0.35, 2.75, 0.785), dark)
    cyl('lamparm', 0.012, 0.45, (0.35, 2.7, 1.0), dark, rot=(0.3, 0, 0), verts=10)
    cyl('lampshade', 0.1, 0.15, (0.35, 2.58, 1.2), '#f2c94c', rot=(1.1, 0, 0), r2=0.035)
    # chair
    box('seat', (0.5, 0.5, 0.07), (1.0, 1.75, 0.48), '#3d5a73', 0.03, 4)
    box('chairback', (0.5, 0.07, 0.55), (1.0, 1.5, 0.85), '#3d5a73', 0.03, 4)
    cyl('post', 0.03, 0.4, (1.0, 1.75, 0.25), metal, verts=12)
    for k in range(5):
        a = k / 5 * math.tau
        box('spoke', (0.3, 0.05, 0.035), (1.0 + math.cos(a) * 0.15, 1.75 + math.sin(a) * 0.15, 0.06), metal, 0.01).rotation_euler.z = a

    # corkboard on the back wall: a frame, and BoardFace (1.5 x 1.0) that Room.js draws the projects on
    board = [box('frame-t', (1.62, 0.06, 0.06), (-1.3, W - 0.03, 2.06), wood, 0.01),
             box('frame-b', (1.62, 0.06, 0.06), (-1.3, W - 0.03, 1.0), wood, 0.01),
             box('frame-l', (0.06, 0.06, 1.06), (-2.08, W - 0.03, 1.53), wood, 0.01),
             box('frame-r', (0.06, 0.06, 1.06), (-0.52, W - 0.03, 1.53), wood, 0.01),
             box('cork', (1.5, 0.03, 1.0), (-1.3, W - 0.015, 1.53), '#c49a6c', 0.005)]
    join(board, 'Board')
    plane('BoardFace', 1.5, 1.0, (-1.3, W - 0.035, 1.53), (math.pi / 2, 0, 0), '#c49a6c')
    # a low chest under the board, with a plant
    box('chest', (1.3, 0.45, 0.55), (-1.3, W - 0.25, 0.275), '#8d6a4b', 0.02)
    cyl('pot', 0.13, 0.22, (-0.85, W - 0.25, 0.66), '#c9895a', r2=0.1)
    for dx, dy, dz, s in [(0, 0, 0.9, 0.16), (0.08, 0.03, 0.98, 0.12), (-0.07, -0.02, 1.0, 0.11)]:
        bpy.ops.mesh.primitive_ico_sphere_add(radius=s, subdivisions=2, location=(-0.85 + dx, W - 0.25 + dy, dz))
        finish(bpy.context.active_object, '#63a842', 'leaves', smooth=0)

    # bookshelf on the left wall: the papers
    sx, sy, sw, sd, sh = -W + 0.2, 1.6, 1.3, 0.38, 1.9
    shelf = [box('side', (sd, 0.04, sh), (sx, sy - sw / 2, sh / 2), wood, 0.01),
             box('side', (sd, 0.04, sh), (sx, sy + sw / 2, sh / 2), wood, 0.01),
             box('back', (0.02, sw, sh), (sx - sd / 2 + 0.01, sy, sh / 2), plank2, 0.005)]
    cols = ['#d9534f', '#3d5a73', '#f2c94c', '#ece6d6', '#5b8c5a', '#8a5a8c', '#e07b39', '#2a2928']
    n = 0
    for k, z in enumerate((0.02, 0.48, 0.94, 1.4, 1.88)):
        shelf.append(box('board', (sd, sw, 0.04), (sx, sy, z), wood, 0.008))
        if z > 1.8:
            break
        y = sy - sw / 2 + 0.06
        while y < sy + sw / 2 - 0.12:
            t = 0.04 + (n * 37 % 5) * 0.012
            h = 0.28 + (n * 53 % 7) * 0.018
            if k == 1 and 0.3 < y - (sy - sw / 2) < 0.55:                 # a lying stack of papers
                for j in range(4):
                    shelf.append(box('paper', (0.3, 0.22, 0.012), (sx + 0.02, y + 0.1, z + 0.03 + j * 0.014), '#f4f0e6', 0.002, 1))
                y += 0.3; continue
            shelf.append(box('book', (0.26, t, h), (sx + 0.02, y + t / 2, z + 0.02 + h / 2), cols[n % len(cols)], 0.006, 1))
            y += t + 0.006; n += 1
    join(shelf, 'Shelf')

    # window on the left wall, with a side table and the phone under it
    box('winframe', (0.08, 1.2, 1.0), (-W + 0.02, -0.6, 1.65), '#f4f0e6', 0.01)
    box('glass', (0.02, 1.04, 0.84), (-W + 0.065, -0.6, 1.65), '#bfe3f2', 0)
    box('mullion', (0.03, 0.04, 0.84), (-W + 0.075, -0.6, 1.65), '#f4f0e6', 0.005)
    box('sill', (0.18, 1.3, 0.04), (-W + 0.09, -0.6, 1.13), '#f4f0e6', 0.008)
    box('tabletop', (0.6, 0.6, 0.04), (-2.5, -0.6, 0.62), wood, 0.01)
    for dx, dy in [(-0.25, -0.25), (0.25, -0.25), (-0.25, 0.25), (0.25, 0.25)]:
        box('tableleg', (0.04, 0.04, 0.6), (-2.5 + dx, -0.6 + dy, 0.3), dark, 0.008)
    red = '#c8443b'
    phone = [box('body', (0.26, 0.3, 0.1), (-2.5, -0.6, 0.69), red, 0.03, 3),
             box('cradle', (0.08, 0.26, 0.05), (-2.5, -0.6, 0.765), red, 0.015),
             cyl('dial', 0.085, 0.015, (-2.5, -0.68, 0.745), '#ece6d6', rot=(0.35, 0, 0), verts=24),
             cyl('grip', 0.025, 0.24, (-2.5, -0.6, 0.83), red, rot=(math.pi / 2, 0, 0), verts=12),
             sphere('ear', 0.045, (-2.5, -0.72, 0.81), red, (1, 1, 0.7)),
             sphere('mouth', 0.045, (-2.5, -0.48, 0.81), red, (1, 1, 0.7))]
    join(phone, 'Phone')
    # floor lamp and a beanbag in the open corner
    cyl('flbase', 0.16, 0.03, (-2.3, -2.2, 0.015), dark)
    cyl('flpole', 0.015, 1.5, (-2.3, -2.2, 0.78), dark, verts=10)
    cyl('flshade', 0.24, 0.3, (-2.3, -2.2, 1.6), '#ece6d6', r2=0.14)
    sphere('beanbag', 0.45, (-1.6, -1.4, 0.3), '#e07b39', (1.1, 1, 0.68))
    sphere('cushion', 0.2, (-1.5, -1.45, 0.62), '#f2c94c', (1.2, 1, 0.5))
    # a poster beside the board and a clock on the left wall
    box('poster', (0.5, 0.02, 0.7), (2.45, W - 0.01, 1.7), '#3d5a73', 0.005)
    box('posterplane', (0.36, 0.025, 0.22), (2.45, W - 0.01, 1.82), '#f2c94c', 0.004)
    cyl('clock', 0.17, 0.04, (-W + 0.02, 0.9 - 0.95, 2.35), '#ece6d6', rot=(0, math.pi / 2, 0), verts=28)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.select_set(False)
            if o.name not in ('Screen', 'BoardFace'):
                densify(o, 0.25)
    bake_ao(0.7, 0.42)
    export('room')


# ------------------------------------------------------------------------------------------------ cabin (Room.js door)
def cabin():
    """The small house by the start disc that the room is inside. Door on the -Y side (glTF +Z), named Door."""
    reset()
    log, roof, trim, stone = '#b07a4f', '#7d4b3a', '#f4f0e6', '#a9a39a'
    box('base', (5.4, 4.4, 0.3), (0, 0, 0.15), stone, 0.04)
    logs = []
    for i in range(9):
        z = 0.42 + i * 0.27
        logs.append(box('log', (5.0, 0.26, 0.26), (0, -2.0, z), log, 0.1, 3))
        logs.append(box('log', (5.0, 0.26, 0.26), (0, 2.0, z), log, 0.1, 3))
        logs.append(box('log', (0.26, 4.26, 0.26), (-2.45, 0, z), log, 0.1, 3))
        logs.append(box('log', (0.26, 4.26, 0.26), (2.45, 0, z), log, 0.1, 3))
    join(logs, 'walls')
    # gables and the roof
    for y in (-2.0, 2.0):
        slab('gable', [(-2.55, y, 2.72), (2.55, y, 2.72), (0, y, 4.1)], 0.24, log)
    for s in (-1, 1):
        r = box('roof', (3.3, 5.2, 0.16), (s * 1.3, 0, 3.5), roof, 0.03)
        r.rotation_euler.y = s * math.atan2(1.38, 2.55)
    box('ridge', (0.24, 5.3, 0.22), (0, 0, 4.17), roof, 0.04)
    box('chimney', (0.6, 0.6, 1.6), (1.4, 1.0, 3.8), stone, 0.04)
    # door (Room.js walks you in through it) and windows
    box('doorframe', (1.2, 0.16, 2.2), (0, -2.08, 1.4), trim, 0.02)
    box('Door', (1.0, 0.12, 2.05), (0, -2.12, 1.33), '#3d5a73', 0.02)
    sphere('knob', 0.05, (0.36, -2.2, 1.3), '#f2c94c')
    box('step', (1.6, 0.7, 0.18), (0, -2.55, 0.09), stone, 0.03)
    for x in (-1.6, 1.6):
        box('winframe', (0.9, 0.16, 0.8), (x, -2.08, 1.6), trim, 0.02)
        box('Window', (0.74, 0.18, 0.64), (x, -2.08, 1.6), '#ffd98a', 0.01)
    box('sidewin', (0.16, 0.9, 0.8), (-2.53, 0.4, 1.6), trim, 0.02)
    box('Window', (0.18, 0.74, 0.64), (-2.53, 0.4, 1.6), '#ffd98a', 0.01)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.5)
    ground()
    bake_ao(1.0, 0.45)
    export('cabin')


# ------------------------------------------------------------------------------------------------ doorway (Room.js doors)
def doorway():
    """A free-standing door in a frame on a stone step, ajar. Room.js tints the node named Panel per site."""
    reset()
    trim, stone = '#f4f0e6', '#a9a39a'
    box('step', (1.9, 0.9, 0.2), (0, 0, 0.1), stone, 0.03)
    box('post', (0.18, 0.22, 2.5), (-0.68, 0, 1.45), trim, 0.03)
    box('post', (0.18, 0.22, 2.5), (0.68, 0, 1.45), trim, 0.03)
    box('lintel', (1.6, 0.26, 0.22), (0, 0, 2.75), trim, 0.03)
    # the panel, hinged on the left post: built with its left edge at the origin, then swung open
    p = box('Panel', (1.14, 0.08, 2.4), (0.57, 0, 0), '#3d5a73', 0.02)
    bpy.context.view_layer.objects.active = p; p.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False); p.select_set(False)
    p.location = (-0.6, -0.02, 1.42); p.rotation_euler.z = -0.55
    a = -0.55
    sphere('knob', 0.045, (-0.6 + 1.0 * math.cos(a) + 0.07 * math.sin(a), -0.02 + 1.0 * math.sin(a) - 0.07 * math.cos(a), 1.4), '#f2c94c')
    box('dark', (1.16, 0.02, 2.42), (0, 0.06, 1.42), '#1d1c1b', 0)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.3)
    ground()
    bake_ao(0.8, 0.45)
    export('doorway')


def crate():
    """An explosive crate, 1 m, centred on its origin (Explosions.js gives it a 0.5 m cuboid collider): red boards, a
    dark frame on every edge, and a yellow warning plate with a black triangle on two sides."""
    reset()
    red, frame, plate, ink = '#c8412d', '#4a2a1c', '#f2c94c', '#1d1c1b'
    box('boards', (0.94, 0.94, 0.94), (0, 0, 0), red, 0.02)
    for k in range(1, 4):                    # board seams
        for s in (-1, 1):
            box('seam', (0.95, 0.012, 0.012), (0, s * 0.471, -0.47 + k * 0.235), frame, 0)
            box('seam', (0.012, 0.95, 0.012), (s * 0.471, 0, -0.47 + k * 0.235), frame, 0)
    e = 0.5 - 0.06
    for a in (-1, 1):
        for b in (-1, 1):
            box('edge', (1.0, 0.12, 0.12), (0, a * e, b * e), frame, 0.02)
            box('edge', (0.12, 1.0, 0.12), (a * e, 0, b * e), frame, 0.02)
            box('edge', (0.12, 0.12, 1.0), (a * e, b * e, 0), frame, 0.02)
    for s in (-1, 1):
        box('plate', (0.46, 0.02, 0.4), (0, s * 0.485, 0), plate, 0.01)
        slab('mark', [(-0.15, s * 0.5, -0.12), (0.15, s * 0.5, -0.12), (0, s * 0.5, 0.15)], 0.012, ink)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.select_set(True); bpy.context.view_layer.objects.active = o
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True); o.select_set(False)
            densify(o, 0.25)
    ground(-0.5)
    bake_ao(0.5, 0.5)
    join([o for o in bpy.context.scene.objects if o.type == 'MESH' and not o.name.startswith('__')], 'Crate')
    export('crate')


only = sys.argv[sys.argv.index('--') + 2:] if '--' in sys.argv else []
for fn in (desk, fountain, arch, truck, jet, garage, room, cabin, doorway, crate):
    if not only or fn.__name__ in only:
        fn()
