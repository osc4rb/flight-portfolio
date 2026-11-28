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
# The room is a cutaway diorama lit in Cycles and baked into vertex colours (COLOR_0): Room.js shows it unlit, so the
# bake is the final look. Art direction measured from baked room portfolios (Bruno Simon's my-room-in-3d, Henry
# Heffernan's desk): a dark plum shell, one warm window key, a cool fill, and three practical glow pools (monitor blue,
# lamp orange, neon pink). Blender coordinates: X right, Y back, Z up; the camera sits at the +X -Y corner.
RX0, RX1, RY0, RY1, RH, RT = -2.4, 2.4, -2.1, 2.1, 2.6, 0.18     # floor 4.8 x 4.2, walls 2.6 high, 0.18 thick
ROOM_NAMED = ('Computer', 'Screen', 'Board', 'BoardFace', 'Shelf', 'Phone', 'Chair', 'Lamp')
ROOM_EXPOSURE = 6.4


def _rbox(name, size, loc, color, rot=(0, 0, 0), bevel=0.02, segs=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object; o.scale = size; o.rotation_euler = rot
    return finish(o, color, name, bevel, segs)


def _rcyl(name, r, depth, loc, color, rot=(0, 0, 0), verts=24, bevel=0.004, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=verts, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, vertices=verts, location=loc, rotation=rot)
    return finish(bpy.context.active_object, color, name, bevel, 1)


def _rod(name, a, b, r, color, verts=10):
    a, b = Vector(a), Vector(b); d = b - a
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=verts, location=(a + b) / 2)
    o = bpy.context.active_object; o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(o, color, name, 0, smooth=1.2)


def _ball(name, r, loc, color, scale=(1, 1, 1), rot=(0, 0, 0), segs=16, rings=8):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=segs, ring_count=rings)
    o = bpy.context.active_object; o.scale = scale; o.rotation_euler = rot
    return finish(o, color, name, 0, smooth=1.2)


def _tube(name, pts, r, color, closed=False, sharp=False):
    """A curve through pts with a round section, turned into a mesh: cables, the neon."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = r; cu.bevel_resolution = 2; cu.resolution_u = 6; cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
    for p, q in zip(sp.bezier_points, pts):
        p.co = q; p.handle_left_type = p.handle_right_type = 'VECTOR' if sharp else 'AUTO'
    sp.use_cyclic_u = closed
    o = bpy.data.objects.new(name, cu); bpy.context.collection.objects.link(o)
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    return finish(bpy.context.active_object, color, name, 0, smooth=1.2)


def _pslab(name, pts, thick, color):
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
    return finish(o, color, name, 0, smooth=0)


def _turn(o, rz, pivot, rx=0.0, ry=0.0):
    """Rotate o about pivot and bake the rotation in; the node's origin ends at pivot (the chair spins about it)."""
    bpy.context.scene.cursor.location = pivot
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    o.rotation_euler = (rx, ry, rz)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    o.select_set(False)
    return o


_emats = {}
def _glow(o, hexstr, strength):
    key = (hexstr, strength)
    if key not in _emats:
        m = bpy.data.materials.new('e%s_%g' % (hexstr.lstrip('#'), strength)); m.use_nodes = True
        b = m.node_tree.nodes['Principled BSDF']
        b.inputs['Base Color'].default_value = lin(hexstr)
        b.inputs['Emission Color'].default_value = lin(hexstr)
        b.inputs['Emission Strength'].default_value = strength
        _emats[key] = m
    o.data.materials.clear(); o.data.materials.append(_emats[key])
    return o


def _light(kind, name, loc, color, power, aim=None, **kw):
    d = bpy.data.lights.new(name, kind); d.color = lin(color)[:3]; d.energy = power
    for k, v in kw.items():
        setattr(d, k, v)
    o = bpy.data.objects.new(name, d); bpy.context.collection.objects.link(o); o.location = loc
    if aim is not None:
        o.rotation_euler = Vector(aim).normalized().to_track_quat('-Z', 'Y').to_euler()
    return o


def _leaf(loc, L, w, yaw, pitch, color, thick=0.006):
    """A flattened leaf: its base at loc, pointing along yaw (about Z, 0 = +Y) and pitch (up from level)."""
    d = Vector((-math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    return _ball('leaf', 1, Vector(loc) + d * L / 2, color, (w / 2, L / 2, thick), (pitch, 0, yaw), 10, 6)


def _plant(base, rnd, n, reach, leaf, cols, stem='#2e5a2a', up=(0.15, 0.75)):
    parts = []
    for k in range(n):
        yaw = k / n * math.tau + rnd.uniform(-0.4, 0.4)
        tilt = rnd.uniform(*up)                                  # from vertical
        ln = reach * rnd.uniform(0.55, 1.0)
        tip = Vector(base) + Vector((-math.sin(yaw) * math.sin(tilt), math.cos(yaw) * math.sin(tilt), math.cos(tilt))) * ln
        parts.append(_rod('stem', base, tip, 0.006 if leaf < 0.2 else 0.009, stem, 6))
        L = leaf * rnd.uniform(0.8, 1.15)
        parts.append(_leaf(tip, L, L * rnd.uniform(0.5, 0.62), yaw + rnd.uniform(-0.3, 0.3), rnd.uniform(-0.45, 0.35), cols[k % len(cols)]))
    return parts


def _bake_light(samples):
    s = bpy.context.scene
    s.cycles.samples = samples
    s.cycles.max_bounces = 8; s.cycles.diffuse_bounces = 4; s.cycles.glossy_bounces = 0
    s.cycles.transmission_bounces = 0; s.cycles.transparent_max_bounces = 2
    b = s.render.bake
    b.target = 'VERTEX_COLORS'
    b.use_pass_direct = True; b.use_pass_indirect = True
    b.use_pass_diffuse = True; b.use_pass_emit = True; b.use_pass_glossy = False; b.use_pass_transmission = False
    meshes = [o for o in s.objects if o.type == 'MESH' and not o.name.startswith('__')]
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        attr = o.data.color_attributes.get('Col') or o.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        o.data.color_attributes.active_color = attr
        o.data.color_attributes.render_color_index = o.data.color_attributes.active_color_index
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type='COMBINED')
    return meshes


def _grade(meshes, expo, knee=0.6, blur=0.45):
    """Per-vertex noise out (one pass of neighbour averaging), exposure, then a soft shoulder so glows roll off."""
    import numpy as np
    for o in meshes:
        me = o.data; a = me.color_attributes['Col']; n = len(me.vertices)
        c = np.empty(n * 4, np.float32); a.data.foreach_get('color', c); c = c.reshape(n, 4)
        e = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
        if len(e) and blur > 0:
            s = np.zeros((n, 3), np.float32); k = np.zeros(n, np.float32)
            np.add.at(s, e[:, 0], c[e[:, 1], :3]); np.add.at(s, e[:, 1], c[e[:, 0], :3])
            np.add.at(k, e[:, 0], 1); np.add.at(k, e[:, 1], 1)
            m = k > 0
            avg = c[:, :3].copy(); avg[m] = s[m] / k[m, None]
            c[:, :3] = c[:, :3] * (1 - blur) + avg * blur
        rgb = np.maximum(c[:, :3] * expo, 0)
        hi = rgb > knee
        rgb[hi] = knee + (1 - knee) * (1 - np.exp(-(rgb[hi] - knee) / (1 - knee)))
        c[:, :3] = rgb; c[:, 3] = 1
        a.data.foreach_set('color', c.ravel())


def _export_room():
    """Like export(), without normals: the room is shown unlit from COLOR_0, and normals would split vertices."""
    for o in list(bpy.context.scene.objects):
        if o.name.startswith('__'):
            bpy.data.objects.remove(o, do_unlink=True)
        elif o.type == 'MESH' and o.name not in ('Screen', 'BoardFace'):
            while o.data.uv_layers:                                 # only the two textured quads keep UVs (fewer splits)
                o.data.uv_layers.remove(o.data.uv_layers[0])
    path = os.path.join(OUT, 'room.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True, export_normals=False,
                              export_texcoords=True, export_vertex_color='ACTIVE', export_lights=False)
    print('wrote', path, os.path.getsize(path), 'bytes')


def room():
    """The room you walk into from the cabin. A floor slab and two walls (back +Y, left -X) open toward the camera
    corner (-Y, +X = glTF +Z, +X). Room.js finds by node name: Computer + Screen (0.8 x 0.45, the CV is laid on it, so
    Desk.use takes scale 0.5), Board + BoardFace (1.5 x 1.0, projects drawn on it), Shelf (papers), Phone (contact),
    and Chair (spins about its post), Lamp, Steam (an empty over the mug) for small animations."""
    import random
    reset(); _emats.clear()
    rnd = random.Random(7)
    wall, trim, edge = '#3a2c34', '#241b20', '#2e2228'
    board1, board2, wood, wood2 = '#5a3a2c', '#6a4533', '#84543c', '#6a4533'
    rug, rugb, paper, green, green2, leafd = '#6c3c3c', '#cc8454', '#e8dfd0', '#7db81b', '#5f9a1c', '#4a7f22'
    black, black2, metal = '#1a1a1c', '#2a2628', '#6b6f76'
    X0, X1, Y0, Y1, H, T = RX0, RX1, RY0, RY1, RH, RT

    # ---- shell: slab with a cut edge, planks, two walls with a window hole in the left one
    _rbox('slab', (X1 - X0 + T, Y1 - Y0 + T, 0.17), ((X0 - T + X1) / 2, (Y0 + Y1 + T) / 2, -0.115), edge, bevel=0.012)
    planks, y = [], Y0
    row = 0
    while y < Y1 - 0.01:
        w = min(0.16, Y1 - y)
        x = X0 - rnd.uniform(0.2, 1.2) if row else X0
        x = max(x, X0)
        while x < X1 - 0.01:
            ln = min(rnd.uniform(0.9, 2.1), X1 - x)
            c = board1 if rnd.random() < 0.5 else board2
            planks.append(_rbox('plank', (ln - 0.006, w - 0.006, 0.03), (x + ln / 2, y + w / 2, -0.015), c, bevel=0.004, segs=1))
            x += ln
        y += w; row += 1
    join(planks, 'floor')
    WY0, WY1, WZ0, WZ1 = -0.85, 0.25, 0.95, 2.15                     # the window in the left wall
    wx = X0 - T / 2
    _rbox('wall', (T, WY0 - Y0, H), (wx, (Y0 + WY0) / 2, H / 2), wall, bevel=0.015)
    _rbox('wall', (T, Y1 + T - WY1, H), (wx, (WY1 + Y1 + T) / 2, H / 2), wall, bevel=0.015)
    _rbox('wall', (T, WY1 - WY0, WZ0), (wx, (WY0 + WY1) / 2, WZ0 / 2), wall, bevel=0.015)
    _rbox('wall', (T, WY1 - WY0, H - WZ1), (wx, (WY0 + WY1) / 2, (WZ1 + H) / 2), wall, bevel=0.015)
    _rbox('wall', (X1 - X0, T, H), ((X0 + X1) / 2, Y1 + T / 2, H / 2), wall, bevel=0.015)
    _rbox('cap', (T + 0.01, Y1 - Y0 + T + 0.01, 0.025), (wx, (Y0 + Y1 + T) / 2, H + 0.012), trim, bevel=0.006)
    _rbox('cap', (X1 - X0 + 0.005, T + 0.01, 0.025), ((X0 + X1) / 2 + 0.003, Y1 + T / 2, H + 0.012), trim, bevel=0.006)
    _rbox('skirt', (0.022, Y1 - Y0, 0.1), (X0 + 0.011, (Y0 + Y1) / 2, 0.05), trim, bevel=0.005)
    _rbox('skirt', (X1 - X0, 0.022, 0.1), ((X0 + X1) / 2, Y1 - 0.011, 0.05), trim, bevel=0.005)
    # window: frame, cross bars, sill, the sky pane (it glows a little and lets the sun through), rod and curtains
    fr = '#4a3a42'
    _rbox('wframe', (T + 0.02, 0.06, WZ1 - WZ0), (wx, WY0 + 0.03, (WZ0 + WZ1) / 2), fr, bevel=0.008)
    _rbox('wframe', (T + 0.02, 0.06, WZ1 - WZ0), (wx, WY1 - 0.03, (WZ0 + WZ1) / 2), fr, bevel=0.008)
    _rbox('wframe', (T + 0.02, WY1 - WY0, 0.06), (wx, (WY0 + WY1) / 2, WZ1 - 0.03), fr, bevel=0.008)
    _rbox('wbar', (0.04, 0.035, WZ1 - WZ0), (wx, (WY0 + WY1) / 2, (WZ0 + WZ1) / 2), fr, bevel=0.005)
    _rbox('wbar', (0.04, WY1 - WY0, 0.035), (wx, (WY0 + WY1) / 2, 1.62), fr, bevel=0.005)
    _rbox('sill', (T + 0.1, WY1 - WY0 + 0.12, 0.045), (wx + 0.05, (WY0 + WY1) / 2, WZ0 - 0.02), '#5c4850', bevel=0.008)
    glass = _rbox('glass', (0.01, WY1 - WY0 - 0.08, WZ1 - WZ0 - 0.06), (wx - 0.02, (WY0 + WY1) / 2, (WZ0 + WZ1) / 2 - 0.0), '#6aa3d9', bevel=0)
    _glow(glass, '#6aa3d9', 0.45); glass.visible_shadow = False
    _rod('rod', (X0 + 0.07, WY0 - 0.32, 2.3), (X0 + 0.07, WY1 + 0.3, 2.3), 0.012, metal)
    for y0, y1 in ((WY0 - 0.3, WY0 + 0.02), (WY1 - 0.04, WY1 + 0.28)):
        k, yy = 0, y0
        while yy < y1:
            _rcyl('curtain', 0.032, 1.95, (X0 + 0.08 + (k % 2) * 0.018, yy, 1.3), '#8c6a5a', verts=10, bevel=0)
            yy += 0.045; k += 1

    # ---- rug, rotated a little, with a border and an inner line
    rg = [_rbox('rug', (2.4, 1.7, 0.012), (0.75, 0.45, 0.006), rugb, bevel=0.004, segs=1),
          _rbox('rugfield', (2.24, 1.54, 0.004), (0.75, 0.45, 0.014), rug, bevel=0.001, segs=1)]
    for sx, sy, lx, ly in ((0, 0.55, 1.8, 0.03), (0, -0.55, 1.8, 0.03), (0.9, 0, 0.03, 1.13), (-0.9, 0, 0.03, 1.13)):
        rg.append(_rbox('rugline', (lx, ly, 0.004), (0.75 + sx, 0.45 + sy, 0.017), rugb, bevel=0.001, segs=1))
    _turn(join(rg, 'rug'), math.radians(6), (0.75, 0.45, 0))

    # ---- the desk against the back wall: top, legs on the left, a drawer unit on the right
    DX, DY, DZ = 1.05, 1.73, 0.77                                   # desk centre and top surface
    _rbox('desktop', (1.7, 0.7, 0.04), (DX, DY, DZ - 0.02), wood, bevel=0.015)
    for x, yy in ((0.26, 1.44), (0.26, 2.02)):
        _rbox('deskleg', (0.045, 0.045, DZ - 0.04), (x, yy, (DZ - 0.04) / 2), black, bevel=0.008)
    _rbox('deskbar', (0.04, 0.55, 0.04), (0.26, 1.73, 0.12), black, bevel=0.008)
    _rbox('drawers', (0.42, 0.62, DZ - 0.04), (1.66, 1.73, (DZ - 0.04) / 2), wood2, bevel=0.015)
    for z in (0.17, 0.42, 0.62):
        _rbox('drawerfront', (0.38, 0.012, 0.19 if z < 0.6 else 0.15), (1.66, 1.418, z), wood, bevel=0.004)
        _rbox('handle', (0.12, 0.018, 0.012), (1.66, 1.408, z + 0.05), metal, bevel=0.003)

    # the monitor (Computer + Screen), keyboard, mouse; the Screen is one quad, 0..1 UVs, facing -Y
    MX, MY, MZ = 0.95, 1.95, 1.13
    comp = [_rbox('bezel', (0.86, 0.03, 0.51), (MX, MY, MZ), black, bevel=0.012),
            _rbox('mback', (0.56, 0.05, 0.34), (MX, MY + 0.035, MZ - 0.02), black2, bevel=0.02),
            _rbox('neck', (0.06, 0.035, 0.3), (MX, MY + 0.07, DZ + 0.17), metal, bevel=0.01),
            _rbox('mfoot', (0.26, 0.2, 0.014), (MX, MY + 0.02, DZ + 0.007), metal, bevel=0.006),
            _rbox('keyboard', (0.44, 0.14, 0.02), (0.9, 1.58, DZ + 0.01), black2, rot=(0, 0, math.radians(-2)), bevel=0.006),
            _rbox('keys', (0.41, 0.11, 0.006), (0.9, 1.58, DZ + 0.022), '#3a3436', rot=(0, 0, math.radians(-2)), bevel=0.002),
            _ball('mouse', 0.05, (1.33, 1.57, DZ + 0.018), black2, (0.62, 1, 0.36), (0, 0, math.radians(8)))]
    join(comp, 'Computer')
    plane('Screen', 0.8, 0.45, (MX, MY - 0.0155, MZ), (math.pi / 2, 0, 0), '#0a1830')
    _glow(bpy.data.objects['Screen'], '#0082ff', 1.6)
    _rbox('mousemat', (0.27, 0.22, 0.004), (1.33, 1.58, DZ + 0.002), '#241b20', rot=(0, 0, math.radians(5)), bevel=0.002)
    # the laptop, open and turned toward the chair
    lp = [_rbox('lapbase', (0.34, 0.23, 0.014), (0.46, 1.66, DZ + 0.007), metal, bevel=0.005),
          _rbox('laplid', (0.34, 0.01, 0.22), (0.46, 1.775 + 0.02, DZ + 0.12), metal, rot=(math.radians(-14), 0, 0), bevel=0.004)]
    lscr = _rbox('lapscreen', (0.31, 0.004, 0.19), (0.46, 1.768 + 0.02, DZ + 0.12), '#3d8fff', rot=(math.radians(-14), 0, 0), bevel=0)
    _glow(lscr, '#3d8fff', 0.5); lp.append(lscr)
    _turn(join(lp, 'laptop'), math.radians(11), (0.46, 1.66, DZ))
    # papers, two overlapping stacks, notebooks, a pen
    for k, (px, py, a) in enumerate(((0.62, 1.5, 7), (0.72, 1.46, -12), (0.66, 1.52, 2))):
        _rbox('paper', (0.21, 0.297, 0.004), (px, py, DZ + 0.003 + k * 0.004), paper, rot=(0, 0, math.radians(a)), bevel=0.001, segs=1)
    _rbox('notebook', (0.16, 0.22, 0.016), (1.46, 1.88, DZ + 0.008), rug, rot=(0, 0, math.radians(-9)), bevel=0.004)
    _rbox('notebook', (0.15, 0.21, 0.012), (1.47, 1.87, DZ + 0.022), trim, rot=(0, 0, math.radians(4)), bevel=0.004)
    _rod('pen', (0.6, 1.42, DZ + 0.012), (0.74, 1.47, DZ + 0.012), 0.005, '#cc8454', 8)
    # the mug, and Steam (an empty just over it)
    MUG = (1.5, 1.52)
    _rcyl('mug', 0.042, 0.095, (MUG[0], MUG[1], DZ + 0.0475), '#cc8454', verts=20, bevel=0.003)
    _rcyl('coffee', 0.036, 0.004, (MUG[0], MUG[1], DZ + 0.088), '#2a1810', verts=20, bevel=0)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.028, minor_radius=0.007, major_segments=14, minor_segments=6,
                                     location=(MUG[0] + 0.045, MUG[1], DZ + 0.05), rotation=(math.pi / 2, 0, 0))
    finish(bpy.context.active_object, '#cc8454', 'mughandle', smooth=1.2)
    steam = bpy.data.objects.new('Steam', None); bpy.context.collection.objects.link(steam)
    steam.location = (MUG[0], MUG[1], DZ + 0.12)
    # headphones lying by the monitor, a small plant on the left corner
    hp = [_rcyl('cup', 0.045, 0.03, (1.62, 1.95, DZ + 0.015), black, verts=16, bevel=0.006),
          _rcyl('cup', 0.045, 0.03, (1.8, 1.92, DZ + 0.015), black, verts=16, bevel=0.006)]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.09, minor_radius=0.008, major_segments=20, minor_segments=6,
                                     location=(1.71, 1.935, DZ + 0.01), rotation=(0, 0, 0))
    hp.append(finish(bpy.context.active_object, black2, 'band', smooth=1.2))
    hp[-1].scale = (1, 0.45, 1)
    _turn(join(hp, 'headphones'), math.radians(-10), (1.71, 1.935, DZ))
    _rcyl('pot', 0.055, 0.09, (0.28, 1.98, DZ + 0.045), '#5c4040', verts=16, r2=0.045)
    _plant((0.28, 1.98, DZ + 0.09), rnd, 9, 0.12, 0.09, [green, green2, leafd], up=(0.1, 0.9))
    # the lamp: base on the desk, two arm rods, a shade aimed at the desk, a glowing bulb inside
    LB = Vector((1.78, 1.98, DZ))
    elbow, head = Vector((1.8, 2.0, 1.27)), Vector((1.56, 1.72, 1.24))
    lm = [_rcyl('lampbase', 0.075, 0.02, (LB.x, LB.y, DZ + 0.01), black, verts=20),
          _rod('lamparm', LB + Vector((0, 0, 0.02)), elbow, 0.01, black),
          _rod('lamparm', elbow, head, 0.01, black),
          _ball('joint', 0.018, elbow, black)]
    d = Vector((-0.25, -0.35, -1)).normalized()
    shade_c = head + d * 0.05
    bpy.ops.mesh.primitive_cone_add(radius1=0.1, radius2=0.035, depth=0.13, vertices=24, location=shade_c,
                                    rotation=(-d).to_track_quat('Z', 'Y').to_euler(), end_fill_type='NOTHING')
    shade = bpy.context.active_object
    md = shade.modifiers.new('solid', 'SOLIDIFY'); md.thickness = 0.006
    bpy.context.view_layer.objects.active = shade; bpy.ops.object.modifier_apply(modifier=md.name)
    lm.append(finish(shade, black, 'lampshade', smooth=1.2))
    bulb = _ball('bulb', 0.03, head + d * 0.07, '#ff6700')
    _glow(bulb, '#ffb070', 30); lm.append(bulb)
    _turn(join(lm, 'Lamp'), 0, (LB.x, LB.y, DZ))
    # cables: monitor and lamp down the back to a power strip on the floor
    _rbox('strip', (0.3, 0.06, 0.04), (1.0, 1.98, 0.02), black2, bevel=0.008)
    _tube('cable', [(MX + 0.05, MY + 0.06, 1.0), (MX + 0.08, 2.05, 0.7), (MX + 0.1, 2.06, 0.25), (1.05, 2.0, 0.03)], 0.007, black)
    _tube('cable', [(LB.x, LB.y + 0.05, DZ + 0.01), (1.75, 2.07, 0.6), (1.4, 2.06, 0.06), (1.12, 1.99, 0.03)], 0.006, black)
    _tube('cable', [(0.62, 1.8, DZ + 0.007), (0.7, 2.06, DZ - 0.02), (0.72, 2.07, 0.35), (0.88, 1.98, 0.03)], 0.005, '#d8d0c4')
    _tube('cable', [(0.9, 1.98, 0.02), (0.4, 1.9, 0.008), (-0.4, 1.75, 0.008), (-1.0, 1.98, 0.008), (-1.3, 2.06, 0.02)], 0.006, black)
    # bin under the desk with paper balls
    _rcyl('bin', 0.13, 0.3, (0.5, 1.85, 0.15), black2, verts=24, r2=0.15)
    for k in range(3):
        _ball('ball', 0.04, (0.47 + k * 0.03, 1.84 + (k % 2) * 0.04, 0.31 + k * 0.01), paper, (1, 0.9, 0.85), segs=10, rings=6)

    # ---- the chair, rotated off the desk, with a jacket over the back (Chair spins about its post)
    CX, CY = 1.02, 1.0
    ch = [_rcyl('post', 0.028, 0.38, (CX, CY, 0.26), metal, verts=12)]
    for k in range(5):
        a = k / 5 * math.tau + 0.3
        tip = (CX + math.cos(a) * 0.3, CY + math.sin(a) * 0.3, 0.07)
        ch.append(_rod('spoke', (CX, CY, 0.09), tip, 0.022, black, 8))
        ch.append(_ball('caster', 0.03, (tip[0], tip[1], 0.03), black, segs=10, rings=6))
    ch += [_rbox('seat', (0.5, 0.48, 0.08), (CX, CY + 0.02, 0.49), black2, bevel=0.03, segs=3),
           _rbox('seatpad', (0.46, 0.44, 0.03), (CX, CY + 0.02, 0.54), '#3a2c34', bevel=0.014, segs=2),
           _rod('backpost', (CX, CY - 0.2, 0.47), (CX, CY - 0.27, 0.72), 0.02, metal),
           _rbox('back', (0.46, 0.07, 0.5), (CX, CY - 0.27, 0.98), black2, rot=(math.radians(-8), 0, 0), bevel=0.03, segs=3)]
    for s in (-1, 1):
        ch.append(_rod('armpost', (CX + s * 0.25, CY + 0.02, 0.47), (CX + s * 0.26, CY + 0.02, 0.68), 0.015, black))
        ch.append(_rbox('armrest', (0.06, 0.3, 0.03), (CX + s * 0.26, CY + 0.04, 0.69), black, bevel=0.012))
    jk = '#7a3f2c'
    ch += [_rbox('jacket', (0.48, 0.05, 0.42), (CX + 0.02, CY - 0.33, 0.95), jk, rot=(math.radians(-6), 0, math.radians(3)), bevel=0.02, segs=2),
           _rbox('jackettop', (0.48, 0.14, 0.05), (CX + 0.02, CY - 0.28, 1.235), jk, rot=(0, 0, math.radians(3)), bevel=0.02, segs=2),
           _rbox('collar', (0.3, 0.08, 0.04), (CX + 0.02, CY - 0.22, 1.25), '#5e2f22', bevel=0.015)]
    for s in (-1, 1):
        ch.append(_rod('sleeve', (CX + s * 0.22, CY - 0.33, 1.16), (CX + s * 0.27, CY - 0.38, 0.62), 0.045, jk, 10))
    _turn(join(ch, 'Chair'), math.radians(-15), (CX, CY, 0))

    # ---- back wall, left of the desk: corkboard (Board + BoardFace 1.5 x 1.0), a chest, a poster and a clock
    BX, BZ = -1.1, 1.58
    board = [_rbox('frame-t', (1.62, 0.05, 0.06), (BX, Y1 - 0.025, BZ + 0.53), wood, bevel=0.01),
             _rbox('frame-b', (1.62, 0.05, 0.06), (BX, Y1 - 0.025, BZ - 0.53), wood, bevel=0.01),
             _rbox('frame-l', (0.06, 0.05, 1.06), (BX - 0.78, Y1 - 0.025, BZ), wood, bevel=0.01),
             _rbox('frame-r', (0.06, 0.05, 1.06), (BX + 0.78, Y1 - 0.025, BZ), wood, bevel=0.01),
             _rbox('cork', (1.5, 0.03, 1.0), (BX, Y1 - 0.015, BZ), '#a07a52', bevel=0.004)]
    join(board, 'Board')
    plane('BoardFace', 1.5, 1.0, (BX, Y1 - 0.031, BZ), (math.pi / 2, 0, 0), '#a07a52')
    _rbox('chest', (1.3, 0.38, 0.5), (BX, Y1 - 0.2, 0.25), wood2, bevel=0.02)
    for x in (BX - 0.32, BX + 0.32):
        _rbox('chestfront', (0.6, 0.012, 0.4), (x, Y1 - 0.395, 0.26), wood, bevel=0.005)
        _rbox('knob', (0.08, 0.02, 0.02), (x, Y1 - 0.405, 0.4), metal, bevel=0.004)
    for k, (c, t) in enumerate(((rug, 0.04), (trim, 0.03), ('#a08670', 0.035))):     # books lying on the chest
        _rbox('book', (0.24, 0.17, t), (BX + 0.25, Y1 - 0.2, 0.5 + 0.02 + k * 0.04), c, rot=(0, 0, math.radians(rnd.uniform(-12, 12))), bevel=0.004)
    _rbox('radio', (0.3, 0.14, 0.17), (BX - 0.35, Y1 - 0.15, 0.585), '#4a3a32', rot=(0, 0, math.radians(4)), bevel=0.015)
    _rcyl('dial', 0.035, 0.012, (BX - 0.42, Y1 - 0.225, 0.6), '#cc8454', rot=(math.pi / 2, 0, 0), verts=16)
    _rbox('grille', (0.12, 0.006, 0.1), (BX - 0.27, Y1 - 0.222, 0.59), black, bevel=0.002)
    _rcyl('pot', 0.06, 0.1, (BX + 0.0, Y1 - 0.18, 0.55), '#5c4040', verts=16, r2=0.05)
    _plant((BX, Y1 - 0.18, 0.6), rnd, 7, 0.1, 0.08, [green2, green, leafd], up=(0.05, 0.6))
    # skateboard leaning on the wall between chest and desk
    sk = [_rbox('deck', (0.2, 0.012, 0.78), (-0.22, Y1 - 0.09, 0.42), wood),
          _rbox('grip', (0.19, 0.004, 0.76), (-0.22, Y1 - 0.098, 0.42), black, bevel=0.002)]
    for zz in (0.15, 0.69):
        for s in (-1, 1):
            sk.append(_rcyl('wheel', 0.026, 0.03, (-0.22 + s * 0.07, Y1 - 0.05, zz), '#e8dfd0', rot=(0, math.pi / 2, 0), verts=12))
    _turn(join(sk, 'skate'), 0, (-0.22, Y1 - 0.09, 0), rx=math.radians(-12), ry=math.radians(4))
    # poster (a sunset print) and a clock
    PX = -0.12
    _rbox('poster', (0.38, 0.02, 0.52), (PX, Y1 - 0.01, 1.55), trim, bevel=0.005)
    _rbox('print', (0.32, 0.004, 0.46), (PX, Y1 - 0.022, 1.55), '#4a2c30', bevel=0)
    _rcyl('sun', 0.07, 0.004, (PX, Y1 - 0.026, 1.6), '#cc8454', rot=(math.pi / 2, 0, 0), verts=24, bevel=0)
    _rbox('hill', (0.32, 0.004, 0.12), (PX, Y1 - 0.028, 1.38), '#6c3c3c', bevel=0)
    _rcyl('clock', 0.13, 0.04, (PX, Y1 - 0.02, 2.2), trim, rot=(math.pi / 2, 0, 0), verts=28)
    _rcyl('clockface', 0.11, 0.004, (PX, Y1 - 0.042, 2.2), paper, rot=(math.pi / 2, 0, 0), verts=28, bevel=0)
    _rbox('hand', (0.012, 0.004, 0.08), (PX + 0.01, Y1 - 0.046, 2.23), black, rot=(0, math.radians(-25), 0), bevel=0)
    _rbox('hand', (0.06, 0.004, 0.01), (PX - 0.025, Y1 - 0.046, 2.19), black, rot=(0, math.radians(20), 0), bevel=0)

    # ---- the neon above the desk: a flight path ending in a paper plane (the third light pool)
    NY = Y1 - 0.035
    neon = '#ff115e'
    t1 = _tube('neon', [(1.18, NY, 1.86), (1.38, NY, 2.04), (1.58, NY, 1.94), (1.78, NY, 2.1), (1.96, NY, 2.18)], 0.011, neon)
    t2 = _tube('neon', [(2.0, NY, 2.15), (2.26, NY, 2.3), (2.06, NY, 2.33), (2.0, NY, 2.15)], 0.011, neon, sharp=True)
    t3 = _tube('neon', [(2.06, NY, 2.33), (2.08, NY, 2.22), (2.26, NY, 2.3)], 0.009, neon, sharp=True)
    for o in (t1, t2, t3):
        _glow(o, neon, 8)
    for x, z in ((1.25, 1.9), (1.7, 2.05), (2.1, 2.25)):
        _rcyl('standoff', 0.008, 0.03, (x, Y1 - 0.015, z), metal, rot=(math.pi / 2, 0, 0), verts=8, bevel=0)

    # ---- the tall plant right of the desk
    _rcyl('bigpot', 0.17, 0.36, (2.12, 1.82, 0.18), '#3d3236', verts=24, r2=0.14, bevel=0.01)
    _rcyl('soil', 0.155, 0.01, (2.12, 1.82, 0.355), '#2a1810', verts=24, bevel=0)
    _plant((2.12, 1.82, 0.36), rnd, 16, 1.05, 0.3, [green, green2, leafd, green], up=(0.08, 0.55))

    # ---- the shelf on the left wall, near the back: 30+ things of mixed height (Shelf, the papers)
    sd, sy0, sy1 = 0.34, 0.6, 1.98
    sx = X0 + sd / 2
    levels = (0.03, 0.5, 0.97, 1.44, 1.93)
    sh = [_rbox('side', (sd, 0.03, 1.96), (sx, sy0 + 0.015, 0.98), wood, bevel=0.008),
          _rbox('side', (sd, 0.03, 1.96), (sx, sy1 - 0.015, 0.98), wood, bevel=0.008),
          _rbox('shelfback', (0.015, sy1 - sy0, 1.96), (X0 + 0.0075, (sy0 + sy1) / 2, 0.98), '#4a3530', bevel=0.002)]
    for z in levels:
        sh.append(_rbox('shelfboard', (sd, sy1 - sy0 - 0.06, 0.03), (sx, (sy0 + sy1) / 2, z), wood, bevel=0.006))
    bcols = ['#5c3a3a', '#7a5a44', '#3d3236', '#a08670', '#2a2226', '#6b5848', '#8c6e52', '#4a3e44', '#cc8454', '#e0d4c0', '#6c3c3c']
    bx = X0 + 0.015

    def book(y, z, t, h, d, c, lean=0.0):
        sh.append(_rbox('book', (d, t, h), (bx + d / 2, y - math.sin(lean) * h / 2, z + math.cos(lean) * h / 2), c, rot=(lean, 0, 0), bevel=0.004, segs=1))

    def books(y, z, n, hmax):
        for _ in range(n):
            t = rnd.uniform(0.022, 0.055); h = rnd.uniform(0.62, 1.0) * hmax; d = rnd.uniform(0.17, 0.26)
            book(y + t / 2, z, t, h, d, rnd.choice(bcols)); y += t + 0.002
        return y

    def lying(y, z, n, c0=0):
        for k in range(n):
            t = rnd.uniform(0.025, 0.045)
            sh.append(_rbox('book', (rnd.uniform(0.2, 0.25), rnd.uniform(0.17, 0.24), t), (bx + 0.14, y, z + t / 2), bcols[(c0 + k * 3) % len(bcols)], rot=(0, 0, math.radians(rnd.uniform(-8, 8))), bevel=0.004, segs=1))
            z += t
        return z

    top = [z + 0.015 for z in levels]
    # level 0: storage boxes, binders, a lying stack
    y = sy0 + 0.05
    for c in ('#3d3236', '#5c4a40'):
        sh.append(_rbox('storebox', (0.3, 0.3, 0.26), (bx + 0.16, y + 0.15, top[0] + 0.13), c, rot=(0, 0, math.radians(rnd.uniform(-3, 3))), bevel=0.01))
        sh.append(_rbox('label', (0.004, 0.1, 0.05), (bx + 0.312, y + 0.15, top[0] + 0.17), paper, bevel=0))
        y += 0.32
    for c in (trim, '#6c3c3c', trim, '#4a3e44'):
        book(y + 0.035, top[0], 0.065, 0.32, 0.27, c); y += 0.068
    lying(y + 0.17, top[0], 3)
    # level 1: books, one leaning, a paper stack, a pen jar, a trophy
    y = books(sy0 + 0.04, top[1], 10, 0.38)
    book(y + 0.06, top[1], 0.035, 0.3, 0.22, '#8c6e52', lean=0.32); y += 0.13
    for k in range(5):
        sh.append(_rbox('paper', (0.24, 0.3, 0.008), (bx + 0.15, y + 0.16, top[1] + 0.004 + k * 0.008), paper, rot=(0, 0, math.radians(rnd.uniform(-6, 6))), bevel=0.001, segs=1))
    sh.append(_rcyl('jar', 0.04, 0.11, (bx + 0.24, y + 0.16, top[1] + 0.095), '#4a3e44', verts=14))
    for k in range(4):
        sh.append(_rod('pencil', (bx + 0.24, y + 0.16, top[1] + 0.06), (bx + 0.24 + rnd.uniform(-0.04, 0.04), y + 0.16 + rnd.uniform(-0.04, 0.04), top[1] + 0.21), 0.004, rnd.choice(['#cc8454', '#e0d4c0', '#2a2226']), 6))
    y += 0.34
    sh += [_rcyl('trophybase', 0.05, 0.05, (bx + 0.15, y + 0.06, top[1] + 0.025), trim, verts=16),
           _rcyl('trophystem', 0.012, 0.08, (bx + 0.15, y + 0.06, top[1] + 0.09), '#cc8454', verts=10),
           _rcyl('trophycup', 0.06, 0.09, (bx + 0.15, y + 0.06, top[1] + 0.175), '#cc8454', verts=18, r2=0.03)]
    # level 2: a lying stack with the model jet on a stand, books, a succulent
    z = lying(sy0 + 0.17, top[2], 3, 2)
    jy, jz = sy0 + 0.17, z + 0.07
    sh += [_rcyl('jetstand', 0.03, 0.006, (bx + 0.15, jy, z + 0.003), black, verts=14),
           _rod('jetpost', (bx + 0.15, jy, z), (bx + 0.15, jy, jz), 0.004, black, 6)]
    jet = [_rod('fuselage', (bx + 0.15, jy - 0.14, jz), (bx + 0.15, jy + 0.12, jz), 0.018, '#8a9098', 12),
           _rcyl('nose', 0.018, 0.06, (bx + 0.15, jy - 0.17, jz), '#8a9098', rot=(math.pi / 2, 0, 0), verts=12, r2=0.002),
           _pslab('wing', [(bx + 0.15, jy - 0.04, jz), (bx + 0.15 + 0.12, jy + 0.06, jz), (bx + 0.15 + 0.12, jy + 0.08, jz), (bx + 0.15, jy + 0.07, jz)], 0.005, '#8a9098'),
           _pslab('wing', [(bx + 0.15, jy - 0.04, jz), (bx + 0.15, jy + 0.07, jz), (bx + 0.15 - 0.12, jy + 0.08, jz), (bx + 0.15 - 0.12, jy + 0.06, jz)], 0.005, '#8a9098'),
           _pslab('fin', [(bx + 0.15, jy + 0.06, jz), (bx + 0.15, jy + 0.12, jz), (bx + 0.15, jy + 0.13, jz + 0.07)], 0.005, '#cc8454'),
           _ball('canopy', 0.014, (bx + 0.15, jy - 0.08, jz + 0.014), '#241b20', (1, 2.2, 0.8))]
    jj = join(jet, 'modeljet'); _turn(jj, math.radians(-25), (bx + 0.15, jy, jz), rx=math.radians(6))
    sh.append(jj)
    y = books(sy0 + 0.36, top[2], 8, 0.4)
    book(y + 0.05, top[2], 0.03, 0.27, 0.2, '#a08670', lean=0.25); y += 0.12
    sh.append(_rcyl('pot', 0.045, 0.07, (bx + 0.16, y + 0.07, top[2] + 0.035), paper, verts=14, r2=0.04))
    succ = _plant((bx + 0.16, y + 0.07, top[2] + 0.07), rnd, 10, 0.06, 0.06, [green, green2], up=(0.2, 1.1))
    sh += succ
    # level 3: a speaker, books, a leaning pair, a camera, a small box
    sh += [_rbox('speaker', (0.2, 0.16, 0.26), (bx + 0.12, sy0 + 0.12, top[3] + 0.13), black, bevel=0.012),
           _rcyl('cone', 0.05, 0.006, (bx + 0.222, sy0 + 0.12, top[3] + 0.09), black2, rot=(0, math.pi / 2, 0), verts=16),
           _rcyl('tweeter', 0.022, 0.006, (bx + 0.222, sy0 + 0.12, top[3] + 0.2), black2, rot=(0, math.pi / 2, 0), verts=12)]
    y = books(sy0 + 0.23, top[3], 7, 0.4)
    book(y + 0.05, top[3], 0.04, 0.33, 0.24, '#5c3a3a', lean=0.2)
    book(y + 0.1, top[3], 0.03, 0.3, 0.22, '#3d3236', lean=0.24); y += 0.2
    sh += [_rbox('camera', (0.12, 0.14, 0.09), (bx + 0.13, y + 0.08, top[3] + 0.045), black2, rot=(0, 0, math.radians(15)), bevel=0.01),
           _rcyl('lens', 0.035, 0.06, (bx + 0.2, y + 0.06, top[3] + 0.045), black, rot=(0, math.pi / 2, math.radians(15)), verts=16)]
    y += 0.22
    sh.append(_rbox('giftbox', (0.14, 0.14, 0.14), (bx + 0.12, y + 0.08, top[3] + 0.07), '#6c3c3c', rot=(0, 0, math.radians(10)), bevel=0.006))
    y = books(y + 0.18, top[3], 4, 0.36)
    # on top: boxes, a rolled poster, a trailing plant
    sh.append(_rbox('topbox', (0.3, 0.36, 0.2), (bx + 0.16, sy0 + 0.25, top[4] + 0.1), '#5c4a40', rot=(0, 0, math.radians(-4)), bevel=0.01))
    sh.append(_rbox('topbox', (0.24, 0.28, 0.14), (bx + 0.15, sy0 + 0.27, top[4] + 0.27), '#3d3236', rot=(0, 0, math.radians(7)), bevel=0.01))
    sh.append(_rod('roll', (bx + 0.12, sy0 + 0.55, top[4] + 0.04), (bx + 0.16, sy0 + 1.05, top[4] + 0.04), 0.035, paper, 12))
    sh.append(_rcyl('pot', 0.07, 0.11, (bx + 0.16, sy1 - 0.15, top[4] + 0.055), '#5c4040', verts=16, r2=0.06))
    for k in range(9):                                              # leaves trailing down over the front
        a = rnd.uniform(-1.2, 1.2)
        tip = (bx + 0.3 + rnd.uniform(0, 0.08), sy1 - 0.15 + a * 0.12, top[4] + 0.05 - rnd.uniform(0.0, 0.35))
        sh.append(_rod('vine', (bx + 0.16, sy1 - 0.15, top[4] + 0.1), tip, 0.004, '#2e5a2a', 6))
        sh.append(_leaf(tip, 0.07, 0.045, math.radians(-90) + a * 0.4, rnd.uniform(-1.0, -0.4), rnd.choice([green, green2])))
    join(sh, 'Shelf')

    # ---- under the window: a side table with the phone; the curtains frame it
    TX, TY = X0 + 0.32, -1.38
    _rbox('tabletop', (0.48, 0.48, 0.035), (TX, TY, 0.6), wood, bevel=0.01)
    for dx, dy in ((-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)):
        _rod('tableleg', (TX + dx * 0.9, TY + dy * 0.9, 0.585), (TX + dx, TY + dy, 0.0), 0.016, black, 8)
    _rbox('undershelf', (0.4, 0.4, 0.02), (TX, TY, 0.2), wood2, bevel=0.006)
    for k in range(3):
        _rbox('book', (0.22, 0.16, 0.035), (TX, TY, 0.21 + 0.0175 + k * 0.036), bcols[k * 4 % len(bcols)], rot=(0, 0, math.radians(rnd.uniform(-15, 15))), bevel=0.004)
    red = '#a8443a'
    PZ = 0.6175
    ph = [_rbox('body', (0.2, 0.24, 0.09), (TX, TY, PZ + 0.045), red, bevel=0.03, segs=3),
          _rbox('cradle', (0.07, 0.2, 0.04), (TX, TY, PZ + 0.105), red, bevel=0.012),
          _rcyl('dial', 0.07, 0.012, (TX + 0.0, TY - 0.07, PZ + 0.085), paper, rot=(0.4, 0, 0), verts=24),
          _rcyl('dialhub', 0.022, 0.016, (TX, TY - 0.072, PZ + 0.09), red, rot=(0.4, 0, 0), verts=12),
          _rod('grip', (TX, TY - 0.1, PZ + 0.16), (TX, TY + 0.1, PZ + 0.16), 0.02, red, 12),
          _ball('ear', 0.038, (TX, TY - 0.11, PZ + 0.145), red, (1, 1, 0.7)),
          _ball('mouth', 0.038, (TX, TY + 0.11, PZ + 0.145), red, (1, 1, 0.7))]
    _turn(join(ph, 'Phone'), math.radians(12), (TX, TY, PZ))
    _tube('cord', [(TX + 0.0, TY + 0.12, PZ + 0.13), (TX + 0.12, TY + 0.2, PZ + 0.02), (TX + 0.16, TY + 0.05, PZ + 0.005), (TX + 0.1, TY - 0.06, PZ + 0.03)], 0.005, red)
    # a framed photo on the left wall by the table
    _rbox('frame', (0.02, 0.32, 0.42), (X0 + 0.01, -1.72, 1.55), trim, bevel=0.005)
    _rbox('photo', (0.004, 0.26, 0.36), (X0 + 0.022, -1.72, 1.55), '#5a4a48', bevel=0)
    _rbox('photo2', (0.004, 0.26, 0.14), (X0 + 0.024, -1.72, 1.44), '#84543c', bevel=0)

    # ---- floor clutter: a backpack by the desk, shoes, a floor pile of books, two boxes in the front corner
    bp = [_rbox('backpack', (0.3, 0.18, 0.4), (-0.02, 1.62, 0.2), '#3d3236', bevel=0.07, segs=3),
          _rbox('pocket', (0.22, 0.06, 0.18), (-0.02, 1.52, 0.13), '#4a3e44', bevel=0.04, segs=2),
          _rod('strap', (-0.1, 1.72, 0.36), (-0.12, 1.75, 0.08), 0.015, trim, 8),
          _rod('strap', (0.06, 1.72, 0.36), (0.08, 1.75, 0.08), 0.015, trim, 8)]
    _turn(join(bp, 'backpack'), math.radians(18), (-0.02, 1.62, 0), rx=math.radians(-8))
    for k, (x, yy, a) in enumerate(((-1.55, -1.75, 20), (-1.38, -1.62, -8))):
        s = [_rbox('shoe', (0.11, 0.27, 0.07), (x, yy, 0.05), '#6b5848', bevel=0.03, segs=2),
             _rbox('sole', (0.115, 0.28, 0.025), (x, yy, 0.0125), '#2a2226', bevel=0.008)]
        _turn(join(s, 'shoe'), math.radians(a), (x, yy, 0))
    z = 0
    for k in range(5):
        t = rnd.uniform(0.03, 0.05)
        _rbox('book', (rnd.uniform(0.18, 0.24), rnd.uniform(0.24, 0.3), t), (-1.75, 0.3, z + t / 2), bcols[(k * 5) % len(bcols)], rot=(0, 0, math.radians(rnd.uniform(-20, 20))), bevel=0.004, segs=1)
        z += t
    _rbox('box', (0.46, 0.4, 0.34), (-2.08, -1.88, 0.17), '#7a5a40', rot=(0, 0, math.radians(-5)), bevel=0.01)
    _rbox('box', (0.36, 0.32, 0.26), (-2.06, -1.86, 0.47), '#8c6a4a', rot=(0, 0, math.radians(9)), bevel=0.01)
    _rbox('tape', (0.36, 0.05, 0.004), (-2.06, -1.86, 0.602), '#a08670', rot=(0, 0, math.radians(9)), bevel=0)

    # ---- lights: the window sun (blocked overhead by a ceiling that is not exported), a cool sky fill, the practicals
    _rbox('__ceil', (X1 - X0 + 0.6, Y1 - Y0 + 0.6, 0.05), ((X0 + X1) / 2 - 0.1, (Y0 + Y1) / 2 + 0.1, H + 0.06), wall, bevel=0)
    w = bpy.context.scene.world; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = lin('#2b3550'); bg.inputs[1].default_value = 20
    _light('SUN', '__sun', (0, 0, 5), '#ffd9a0', 7.0, aim=(0.8, -0.25, -0.55), angle=math.radians(6))
    _light('AREA', '__monitor', (MX, MY - 0.04, MZ), '#0082ff', 28, aim=(0, -1, -0.15), shape='RECTANGLE', size=0.8, size_y=0.45)
    _light('AREA', '__bias', (MX, MY + 0.07, MZ + 0.05), '#0082ff', 10, aim=(0, 1, 0.1), shape='RECTANGLE', size=0.5, size_y=0.3)
    _light('SPOT', '__lamp', head + d * 0.118, '#ff6700', 55, aim=d, spot_size=math.radians(120), spot_blend=0.6, shadow_soft_size=0.03)
    _light('POINT', '__lampfill', head + d * 0.14, '#ff6700', 6, shadow_soft_size=0.05)
    _light('POINT', '__neon', (1.72, Y1 - 0.2, 2.08), neon, 30, shadow_soft_size=0.25)

    # ---- bake: densify so light pools and shadows have points to land on, then Cycles, grade, merge, export
    for o in bpy.context.scene.objects:
        if o.type != 'MESH' or o.name in ('Screen', 'BoardFace') or o.name.startswith('__'):
            continue
        m = max(o.dimensions)
        if m > 0.3: densify(o, 0.1 if m > 1.0 else 0.07)
    meshes = _bake_light(int(os.environ.get('ROOM_SAMPLES', '256')))
    _grade(meshes, ROOM_EXPOSURE)
    # one white material for everything (the colour is all in COLOR_0); the static props become one mesh, "Room"
    base = bpy.data.materials.new('room'); base.use_nodes = True
    b = base.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (1, 1, 1, 1); b.inputs['Roughness'].default_value = 1.0
    for o in meshes:
        o.data.materials.clear(); o.data.materials.append(base)
    static = [o for o in meshes if o.name not in ROOM_NAMED]
    r = join(static, 'Room')
    bpy.context.scene.cursor.location = (0, 0, 0)
    r.select_set(True); bpy.context.view_layer.objects.active = r
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); r.select_set(False)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH' and 'Col' in o.data.color_attributes:
            o.data.color_attributes.active_color = o.data.color_attributes['Col']
    for o in list(bpy.context.scene.objects):
        if o.type == 'LIGHT':
            bpy.data.objects.remove(o, do_unlink=True)
    # glTF coordinates (x, y up, z toward the camera) of what Room.js uses, relative to the room's origin
    for n in ROOM_NAMED + ('Steam',):
        o = bpy.data.objects.get(n)
        if not o:
            continue
        if o.type == 'MESH':
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = [min(p.x for p in pts), min(p.z for p in pts), min(-p.y for p in pts)]
            hi = [max(p.x for p in pts), max(p.z for p in pts), max(-p.y for p in pts)]
            print('ROOMBOX %-9s node (%.3f, %.3f, %.3f)  min (%.3f, %.3f, %.3f)  max (%.3f, %.3f, %.3f)  verts %d' % (
                n, o.location.x, o.location.z, -o.location.y, *lo, *hi, len(o.data.vertices)))
        else:
            print('ROOMBOX %-9s node (%.3f, %.3f, %.3f)' % (n, o.location.x, o.location.z, -o.location.y))
    print('ROOMVERTS', sum(len(o.data.vertices) for o in bpy.context.scene.objects if o.type == 'MESH'))
    _export_room()


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
