# Builds a small cyberpunk sentry turret with two animation clips and writes
# turret.blend + turret.glb into the directory passed after "--".
import bpy, sys, os, math

out_dir = sys.argv[sys.argv.index('--') + 1]
os.makedirs(os.path.join(out_dir, 'textures'), exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30

# --- albedo texture (128 px) so texel density has something to measure
size = 128
img = bpy.data.images.new('turret_albedo', size, size)
px = []
for y in range(size):
    for x in range(size):
        panel = ((x // 16) + (y // 16)) % 2
        seam = x % 32 == 0 or y % 32 == 0
        base = 0.16 if panel else 0.2
        if seam:
            px += [0.02, 0.02, 0.03, 1.0]
        elif y % 64 in (30, 31):
            px += [1.0, 0.17, 0.84, 1.0]
        else:
            px += [base, base, base * 1.25, 1.0]
img.pixels = px
img.filepath_raw = os.path.join(out_dir, 'textures', 'turret_albedo.png')
img.file_format = 'PNG'
img.save()

def textured_mat(name):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.interpolation = 'Closest'
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = 0.6
    bsdf.inputs['Roughness'].default_value = 0.45
    return m

def neon_mat(name, rgb):
    m = bpy.data.materials.new(name)
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
    bsdf.inputs['Emission Strength'].default_value = 4.0
    return m

metal = textured_mat('turret_metal')
magenta = neon_mat('neon_magenta', (1.0, 0.17, 0.84))

def add(obj, mat, parent=None):
    obj.data.materials.append(mat)
    if parent:
        # Keep the child where it is in the world (plain .parent = would offset it by the
        # parent's transform: that lifted the column 12.5 cm off the base).
        bpy.context.view_layer.update()
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj

bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.45, depth=0.25, location=(0, 0, 0.125))
base = add(bpy.context.object, metal); base.name = 'base'
bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.18, depth=0.6, location=(0, 0, 0.55))
column = add(bpy.context.object, metal, base); column.name = 'column'

bpy.ops.object.empty_add(location=(0, 0, 0.9))
head = bpy.context.object; head.name = 'head'
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.9))
shell = add(bpy.context.object, metal); shell.name = 'head_shell'
shell.scale = (0.5, 0.42, 0.3)
bpy.ops.object.transform_apply(scale=True)
shell.parent = head; shell.matrix_parent_inverse = head.matrix_world.inverted()
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.215, 0.95))
eye = add(bpy.context.object, magenta); eye.name = 'eye'
eye.scale = (0.3, 0.02, 0.06)
bpy.ops.object.transform_apply(scale=True)
eye.parent = head; eye.matrix_parent_inverse = head.matrix_world.inverted()

bpy.ops.object.empty_add(location=(0, -0.2, 0.85))
barrel_pivot = bpy.context.object; barrel_pivot.name = 'barrel_pivot'
barrel_pivot.parent = head; barrel_pivot.matrix_parent_inverse = head.matrix_world.inverted()
for i, x in enumerate((-0.12, 0.12)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=0.04, depth=0.5, location=(x, -0.45, 0.85), rotation=(math.radians(90), 0, 0))
    b = add(bpy.context.object, metal); b.name = f'barrel_{i}'
    b.parent = barrel_pivot; b.matrix_parent_inverse = barrel_pivot.matrix_world.inverted()

def push_action(obj, name):
    ad = obj.animation_data
    act = ad.action
    act.name = name
    act.use_fake_user = True
    track = ad.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(act.frame_range[0]), act)
    ad.action = None

# Clip 1: scan — head yaws left/right (2 s loop)
for f, yaw in ((1, -40), (31, 40), (61, -40)):
    head.rotation_euler = (0, 0, math.radians(yaw))
    head.keyframe_insert('rotation_euler', frame=f)
push_action(head, 'scan')

# Clip 2: fire — barrels recoil 3 times
for f, y in ((1, 0), (3, 0.12), (8, 0), (10, 0.12), (15, 0), (17, 0.12), (24, 0)):
    barrel_pivot.location = (0, -0.2 + y, 0.85)
    barrel_pivot.keyframe_insert('location', frame=f)
push_action(barrel_pivot, 'fire')
barrel_pivot.location = (0, -0.2, 0.85)
head.rotation_euler = (0, 0, 0)
scene.frame_start, scene.frame_end = 1, 61

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, 'turret.blend'))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, 'turret.glb'),
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_apply=True,
)
print('turret written')
