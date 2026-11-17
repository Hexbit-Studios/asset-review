# Low-poly android with a skinned armature and three clips, authored at 24 fps:
#   idle  - breathing / head look (in place)
#   walk  - 1 s cycle, hips travel 1.4 m forward (root motion)
#   wave  - right arm wave
# Writes android.blend + android.glb into the directory passed after "--".
import bpy, sys, os, math
from mathutils import Vector

out_dir = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24

def mat(name, rgb, emit=0.0, metal=0.3, rough=0.5):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Metallic'].default_value = metal
    b.inputs['Roughness'].default_value = rough
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m

shell = mat('shell', (0.12, 0.12, 0.16), metal=0.6, rough=0.35)
joint = mat('joint', (0.05, 0.05, 0.06), metal=0.2, rough=0.7)
visor = mat('visor', (0.13, 0.9, 1.0), emit=6.0)
trim = mat('trim', (1.0, 0.17, 0.84), emit=3.0)

# --- armature (bone heads/tails in metres, Z up, character faces -Y)
arm_data = bpy.data.armatures.new('rig')
rig = bpy.data.objects.new('android_rig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
BONES = {
    'hips': ((0, 0, 0.92), (0, 0, 1.08), None),
    'chest': ((0, 0, 1.08), (0, 0, 1.5), 'hips'),
    'head': ((0, 0, 1.5), (0, 0, 1.75), 'chest'),
    'upper_arm.L': ((0.27, 0, 1.48), (0.27, 0, 1.18), 'chest'),
    'forearm.L': ((0.27, 0, 1.18), (0.27, 0, 0.88), 'upper_arm.L'),
    'upper_arm.R': ((-0.27, 0, 1.48), (-0.27, 0, 1.18), 'chest'),
    'forearm.R': ((-0.27, 0, 1.18), (-0.27, 0, 0.88), 'upper_arm.R'),
    'thigh.L': ((0.1, 0, 0.92), (0.1, 0, 0.5), 'hips'),
    'shin.L': ((0.1, 0, 0.5), (0.1, 0, 0.06), 'thigh.L'),
    'thigh.R': ((-0.1, 0, 0.92), (-0.1, 0, 0.5), 'hips'),
    'shin.R': ((-0.1, 0, 0.5), (-0.1, 0, 0.06), 'thigh.R'),
}
for name, (h, t, parent) in BONES.items():
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = h, t
    # Point every bone's local X at world +X so "rotate X" means pitch for limbs and torso alike.
    eb.align_roll(Vector((0, -1, 0)) if abs(t[2] - h[2]) > 0 else Vector((0, 0, 1)))
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = Vector(h) == Vector(BONES[parent][1])
bpy.ops.object.mode_set(mode='OBJECT')

# --- body parts: boxes rigidly weighted to one bone each, then joined into one skinned mesh
parts = [
    # name, bone, center, size, material
    ('pelvis', 'hips', (0, 0, 1.0), (0.34, 0.2, 0.16), shell),
    ('torso', 'chest', (0, 0, 1.3), (0.42, 0.24, 0.42), shell),
    ('belt', 'hips', (0, 0, 1.07), (0.36, 0.22, 0.03), trim),
    ('head', 'head', (0, 0, 1.63), (0.22, 0.24, 0.24), shell),
    ('visor', 'head', (0, -0.122, 1.65), (0.18, 0.02, 0.05), visor),
    ('neck', 'chest', (0, 0, 1.52), (0.1, 0.1, 0.06), joint),
    ('upper_arm.L', 'upper_arm.L', (0.27, 0, 1.33), (0.1, 0.1, 0.3), shell),
    ('forearm.L', 'forearm.L', (0.27, 0, 1.03), (0.09, 0.09, 0.3), joint),
    ('upper_arm.R', 'upper_arm.R', (-0.27, 0, 1.33), (0.1, 0.1, 0.3), shell),
    ('forearm.R', 'forearm.R', (-0.27, 0, 1.03), (0.09, 0.09, 0.3), joint),
    ('thigh.L', 'thigh.L', (0.1, 0, 0.72), (0.13, 0.14, 0.4), shell),
    ('shin.L', 'shin.L', (0.1, 0, 0.3), (0.11, 0.12, 0.42), joint),
    ('foot.L', 'shin.L', (0.1, -0.05, 0.04), (0.12, 0.24, 0.08), shell),
    ('thigh.R', 'thigh.R', (-0.1, 0, 0.72), (0.13, 0.14, 0.4), shell),
    ('shin.R', 'shin.R', (-0.1, 0, 0.3), (0.11, 0.12, 0.42), joint),
    ('foot.R', 'shin.R', (-0.1, -0.05, 0.04), (0.12, 0.24, 0.08), shell),
]
objs = []
for name, bone, c, size, m in parts:
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    o = bpy.context.object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(m)
    vg = o.vertex_groups.new(name=bone)
    vg.add([v.index for v in o.data.vertices], 1.0, 'REPLACE')
    objs.append(o)
bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = 'android'
body.parent = rig
mod = body.modifiers.new('rig', 'ARMATURE')
mod.object = rig

# --- animation helpers
pose = rig.pose.bones
for pb in pose:
    pb.rotation_mode = 'XYZ'

def key(frame, **bones):
    for name, vals in bones.items():
        pb = pose[name]
        if 'rot' in vals:
            pb.rotation_euler = [math.radians(a) for a in vals['rot']]
            pb.keyframe_insert('rotation_euler', frame=frame)
        if 'loc' in vals:
            pb.location = vals['loc']
            pb.keyframe_insert('location', frame=frame)

def reset_pose():
    for pb in pose:
        pb.location = (0, 0, 0)
        pb.rotation_euler = (0, 0, 0)

def finish(name):
    ad = rig.animation_data
    act = ad.action
    act.name = name
    act.use_fake_user = True
    tr = ad.nla_tracks.new()
    tr.name = name
    tr.strips.new(name, int(act.frame_range[0]), act)
    ad.action = None
    reset_pose()

# idle (2 s)
for f, breath, look in ((1, 0, 0), (13, 3, 12), (25, 0, 0), (37, 3, -12), (49, 0, 0)):
    key(f, chest={'rot': (breath, 0, 0)}, head={'rot': (-breath, 0, look)},
        **{'upper_arm.L': {'rot': (0, 0, 4 + breath)}, 'upper_arm.R': {'rot': (0, 0, -4 - breath)}})
finish('idle')

# walk (1 s). Hips bone local Z points forward (-Y world), so root travel goes in loc Z.
prefs = bpy.context.preferences.edit
prefs.keyframe_new_interpolation_type = 'LINEAR'
for f in range(1, 26, 6):
    key(f, hips={'loc': (0, 0, 1.4 * (f - 1) / 24)})
prefs.keyframe_new_interpolation_type = 'BEZIER'
for f, s in ((1, 1), (7, 0), (13, -1), (19, 0), (25, 1)):
    bob = 0.03 if s == 0 else 0.0
    pose['hips'].location = (0, bob, 1.4 * (f - 1) / 24)
    pose['hips'].keyframe_insert('location', frame=f)
    key(f, **{
        'thigh.L': {'rot': (28 * s, 0, 0)},
        'thigh.R': {'rot': (-28 * s, 0, 0)},
        'shin.L': {'rot': (-35 if s == -1 else -5, 0, 0)},
        'shin.R': {'rot': (-35 if s == 1 else -5, 0, 0)},
        'upper_arm.L': {'rot': (-22 * s, 0, 4)},
        'upper_arm.R': {'rot': (22 * s, 0, -4)},
        'forearm.L': {'rot': (-15, 0, 0)},
        'forearm.R': {'rot': (-15, 0, 0)},
        'chest': {'rot': (4, 6 * s, 0)},
    })
finish('walk')

# wave (1.5 s)
for f, w in ((1, 0), (7, 1), (13, -1), (19, 1), (25, -1), (31, 1), (37, 0)):
    up = 0 if f in (1, 37) else 1
    key(f, **{
        'upper_arm.R': {'rot': (0, 0, -150 * up)},
        'forearm.R': {'rot': (0, 0, -25 * w * up)},
        'head': {'rot': (0, 0, -10 * up)},
    })
finish('wave')

scene.frame_start, scene.frame_end = 1, 49
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, 'android.blend'))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(out_dir, 'android.glb'),
    export_format='GLB',
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_apply=False,  # keep the armature modifier as a real skin
)
print('android written')
