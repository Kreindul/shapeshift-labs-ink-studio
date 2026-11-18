"""Headless Blender adapter for Ink Studio's indexed model export."""

import json
import math
from pathlib import Path
import struct
import sys
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector
import numpy as np


# Ink and glTF are Y up. Blender is Z up.
INK_TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
BLENDER_TO_INK = INK_TO_BLENDER.inverted()


def vector(value, size):
    if len(value) != size or any(not math.isfinite(x) for x in value):
        raise ValueError(f'Expected {size} finite components')
    return Vector(value)


def position(value):
    return INK_TO_BLENDER.to_3x3() @ vector(value, 3)


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bind_weights(obj, spec, rig, names):
    weights = spec.get('weights')
    if not names or (weights is None and spec.get('static')):
        return
    if weights is None:
        raise ValueError(f'{obj.name} requires weights for each vertex or static: true')
    if len(weights) != len(obj.data.vertices):
        raise ValueError(f'{obj.name} needs one weight list per vertex')
    groups = [obj.vertex_groups.new(name=name) for name in names]
    for vertex, influences in enumerate(weights):
        merged = {}
        for index, weight in influences:
            if not isinstance(index, int) or not 0 <= index < len(groups) or not math.isfinite(weight) or weight < 0:
                raise ValueError(f'Invalid weight for vertex {vertex} on {obj.name}')
            merged[index] = merged.get(index, 0) + weight
        strongest = sorted(merged.items(), key=lambda pair: (-pair[1], pair[0]))[:4]
        total = sum(weight for _, weight in strongest)
        if not math.isfinite(total) or total <= 0:
            raise ValueError(f'Missing skin weight for vertex {vertex} on {obj.name}')
        for index, weight in strongest:
            if weight > 0:
                groups[index].add([vertex], weight / total, 'REPLACE')
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig


def build_mesh(spec, rig, names, default_name):
    points, faces = spec['points'], spec['faces']
    if not points or not faces:
        raise ValueError('A model mesh must have vertices and faces')
    for face in faces:
        if len(face) not in (3, 4) or len(set(face)) != len(face) or any(
                not isinstance(i, int) or not 0 <= i < len(points) for i in face):
            raise ValueError('Expected indexed triangles or quads with distinct vertices')
    name = spec.get('name', default_name)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([position(p) for p in points], [], faces)
    if mesh.validate():
        raise ValueError(f'{name} contains duplicate faces or invalid geometry')
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if spec.get('weights') is not None and rig is None:
        raise ValueError(f'{name} has weights but no skeleton')
    bind_weights(obj, spec, rig, names)

    materials = spec.get('materials') or [{'name': name, 'color': [0.45, 0.45, 0.45]}]
    for item in materials:
        material = bpy.data.materials.new(item['name'])
        material.diffuse_color = (*vector(item['color'], 3), 1)
        material.use_nodes = True
        material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = material.diffuse_color
        mesh.materials.append(material)
    if 'faceMaterials' in spec:
        slots = spec['faceMaterials']
        if len(slots) != len(faces) or any(not isinstance(i, int) or not 0 <= i < len(materials) for i in slots):
            raise ValueError(f'Invalid face material assignments on {name}')
        mesh.polygons.foreach_set('material_index', slots)
    if 'colors' in spec:
        colors = spec['colors']
        if len(colors) != len(points):
            raise ValueError(f'{name} requires one color per vertex')
        layer = mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
        layer.data.foreach_set('color', [c for rgb in colors for c in (*vector(rgb, 3), 1)])
    if 'uvs' in spec:
        uvs = spec['uvs']
        if len(uvs) != len(faces) or any(len(uv) != len(face) for uv, face in zip(uvs, faces)):
            raise ValueError(f'{name} requires UVs for every face corner')
        layer = mesh.uv_layers.new(name='UVMap')
        layer.uv.foreach_set('vector', [c for face in uvs for uv in face for c in vector(uv, 2)])

    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        extent = max(obj.dimensions)
        # Remove loose points and sub-resolution edges from position-sampled SDF meshes.
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
        if spec.get('closed'):
            tolerance = max(extent, 1e-6) * 1e-7
            if any(edge.is_boundary for edge in bm.edges):
                bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=tolerance)
            bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=tolerance)
            if any(not edge.is_manifold or not edge.is_contiguous for edge in bm.edges):
                raise ValueError(f'{name} is not a consistently oriented closed manifold. Check the field, enlarge its bounds or adjust the sampling resolution.')
        if not bm.faces:
            raise ValueError(f'{name} has no faces after geometry cleanup')
        for face in bm.faces:
            face.smooth = spec.get('smooth', True)
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()
    mesh.calc_loop_triangles()
    if any(tri.area <= 0 for tri in mesh.loop_triangles):
        raise ValueError(f'{name} contains degenerate triangles')
    return obj


def build_rig(joints, name):
    if not joints:
        return None, []
    names = [j['name'] for j in joints]
    if len(set(names)) != len(names) or any(not name or '\x00' in name or len(name.encode()) > 63 for name in names):
        raise ValueError('Joint names must be unique and fit in 63 bytes')
    for i, joint in enumerate(joints):
        parent = joint.get('parent')
        if parent is not None and (not isinstance(parent, int) or not 0 <= parent < i):
            raise ValueError('A joint parent must appear before its children')
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(rig)
    activate(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for joint in joints:
        bone = data.edit_bones.new(joint['name'])
        bone.head = position(joint['head'])
        bone.tail = position(joint['tail'])
        if bone.length < 1e-6:
            raise ValueError(f'Joint {bone.name} has a zero-length rest axis')
        if joint.get('parent') is not None:
            bone.parent = data.edit_bones[names[joint['parent']]]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig, names


def pose_delta(value):
    if len(value) != 12 or any(not math.isfinite(x) for x in value):
        raise ValueError('Expected nine finite row-major matrix components followed by xyz translation')
    matrix = Matrix(((*value[:3], value[9]), (*value[3:6], value[10]), (*value[6:9], value[11]), (0, 0, 0, 1)))
    return INK_TO_BLENDER @ matrix @ BLENDER_TO_INK


def build_actions(rig, clips, names):
    if not clips:
        return
    if rig is None:
        raise ValueError('Animation clips require a skeleton')
    labels = set()
    scene = bpy.context.scene
    scene.render.fps = 60
    rig.animation_data_create()
    bones = [rig.pose.bones[name] for name in names]
    rest = [bone.bone.matrix_local.copy() for bone in bones]
    for clip in clips:
        label, frames = clip['name'], clip['frames']
        if not label or label in labels or len(frames) < 2 or frames[0]['time'] != 0:
            raise ValueError('Clips need unique names and at least two samples starting at zero seconds')
        labels.add(label)
        action = bpy.data.actions.new(label)
        rig.animation_data.action = action
        last, previous = -1, [None] * len(bones)
        for frame in frames:
            time = frame['time']
            if not math.isfinite(time) or time <= last or len(frame['matrices']) != len(bones):
                raise ValueError('Animation times must increase and every frame needs a matrix per joint')
            last = time
            world = [pose_delta(delta) @ matrix for delta, matrix in zip(frame['matrices'], rest)]
            # Use the effective parent after TRS decomposition so small numerical errors don't accumulate.
            effective = {}
            for i, bone in enumerate(bones):
                parent = {} if bone.parent is None else {
                    'parent_matrix': effective[bone.parent.name], 'parent_matrix_local': bone.parent.bone.matrix_local
                }
                basis = bone.bone.convert_local_to_pose(world[i], rest[i], invert=True, **parent)
                location, rotation, scale = basis.decompose()
                trs = Matrix.LocRotScale(location, rotation, scale)
                # glTF animated joints are TRS channels. A significant local shear cannot be serialized accurately.
                error = max(abs(trs[r][c] - basis[r][c]) for r in range(3) for c in range(3))
                if error > 0.002:
                    raise ValueError(f'Animation {label} has local shear on {bone.name} at {time:g}s')
                effective[bone.name] = bone.bone.convert_local_to_pose(trs, rest[i], **parent)
                if previous[i] is not None:
                    rotation.make_compatible(previous[i])
                previous[i] = rotation.copy()
                bone.rotation_mode = 'QUATERNION'
                bone.location, bone.rotation_quaternion, bone.scale = location, rotation, scale
                for prop in ('location', 'rotation_quaternion', 'scale'):
                    bone.keyframe_insert(prop, frame=time * scene.render.fps, group=bone.name)
        for slot in action.slots:
            for layer in action.layers:
                for strip in layer.strips:
                    channelbag = strip.channelbag(slot)
                    if channelbag:
                        for curve in channelbag.fcurves:
                            for key in curve.keyframe_points:
                                key.interpolation = 'LINEAR'
        rig.animation_data.action = None
        track = rig.animation_data.nla_tracks.new()
        track.name = label
        track.strips.new(label, 0, action)
    scene.frame_set(0)


def unwrap(obj, margin, angle=66):
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), margin_method='FRACTION', island_margin=margin,
                             correct_aspect=False, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    if not obj.data.uv_layers:
        raise ValueError(f'UV unwrap failed for {obj.name}')


def png_chunk(tag, payload):
    return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', zlib.crc32(tag + payload))


def bake_palette(obj, size, directory, margin):
    # UV tiles are already packed. Texture the authored base color, using linear interpolation
    # for vertex color and leaving enough edge pixels for the sampler at island borders.
    mesh = obj.data
    mesh.calc_loop_triangles()
    layer = mesh.uv_layers.active
    uv = np.array([tuple(item.vector) for item in layer.uv]) * size
    colors = mesh.color_attributes.active_color
    palette = np.array([tuple(mat.diffuse_color[:3]) for mat in mesh.materials])
    pixels = np.zeros((size, size, 3), dtype=np.float32)
    painted = np.zeros((size, size), dtype=bool)
    interiors = np.zeros_like(painted)
    for tri in mesh.loop_triangles:
        coords = uv[list(tri.loops)]
        lower = np.maximum(np.floor(coords.min(axis=0)).astype(int), 0)
        upper = np.minimum(np.ceil(coords.max(axis=0)).astype(int), size)
        if np.any(upper <= lower):
            continue
        a, b = coords[1] - coords[0], coords[2] - coords[0]
        det = a[0] * b[1] - a[1] * b[0]
        if abs(det) < 1e-8:
            raise ValueError(f'Degenerate UV triangle on {obj.name}')
        y, x = np.ogrid[lower[1]:upper[1], lower[0]:upper[0]]
        dx, dy = x + 0.5 - coords[0, 0], y + 0.5 - coords[0, 1]
        s, t = (dx * b[1] - dy * b[0]) / det, (a[0] * dy - a[1] * dx) / det
        mask = (s >= -1e-7) & (t >= -1e-7) & (s + t <= 1 + 1e-7)
        if not np.any(mask):
            continue
        interior = (s > 1e-5) & (t > 1e-5) & (s + t < 1 - 1e-5)
        region = interiors[lower[1]:upper[1], lower[0]:upper[0]]
        if np.any(region & interior):
            return False
        region |= interior
        color = palette[tri.material_index]
        if colors:
            ca, cb, cc = np.array([tuple(colors.data[i].color[:3]) for i in tri.vertices]) * color
            color = ca + s[mask, None] * (cb - ca) + t[mask, None] * (cc - ca)
        pixels[lower[1]:upper[1], lower[0]:upper[0]][mask] = color
        painted[lower[1]:upper[1], lower[0]:upper[0]] |= mask
    if not painted.any():
        raise ValueError(f'Texture bake found no UV coverage on {obj.name}')
    fill = pixels[painted].mean(axis=0)
    for _ in range(max(1, min(16, int(size * margin / 2)))):
        next_fill = painted.copy()
        for src, dst in [
            (np.s_[:-1, :], np.s_[1:, :]), (np.s_[1:, :], np.s_[:-1, :]),
            (np.s_[:, :-1], np.s_[:, 1:]), (np.s_[:, 1:], np.s_[:, :-1])
        ]:
            mask = painted[src] & ~next_fill[dst]
            pixels[dst][mask] = pixels[src][mask]
            next_fill[dst] |= mask
        painted = next_fill
    pixels[~painted] = fill
    pixels = np.clip(pixels, 0, 1)
    srgb = np.where(pixels <= 0.0031308, 12.92 * pixels, 1.055 * pixels ** (1 / 2.4) - 0.055)
    rows = (srgb[::-1] * 255 + 0.5).astype(np.uint8)
    file = directory / f'{mesh.name.replace("/", "_").replace(chr(92), "_")}-base-color.png'
    data = b''.join(b'\x00' + row.tobytes() for row in rows)
    file.write_bytes(b'\x89PNG\r\n\x1a\n' +
                     png_chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) +
                     png_chunk(b'IDAT', zlib.compress(data)) + png_chunk(b'IEND', b''))
    image = bpy.data.images.load(str(file))
    image.pack()
    mesh.materials.clear()
    material = bpy.data.materials.new(obj.name + ' · Baked Base Color')
    material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    tex = material.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = image
    material.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    mesh.materials.append(material)
    mesh.polygons.foreach_set('material_index', np.zeros(len(mesh.polygons), dtype=np.int32))
    if colors:
        mesh.color_attributes.remove(colors)
    return True


def run(config):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if bpy.app.version < (4, 5, 0):
        raise RuntimeError('Use Blender 4.5 or later')
    source = config['input']
    if source:
        if Path(source).suffix.lower() == '.obj':
            bpy.ops.wm.obj_import(filepath=source, forward_axis='NEGATIVE_Z', up_axis='Y')
        else:
            bpy.ops.import_scene.gltf(filepath=source, merge_vertices=False)
    else:
        model = config['model']
        rig, names = build_rig(model.get('joints', []), config['name'] + ' Rig')
        seen = set()
        for i, mesh in enumerate(model['meshes']):
            obj = build_mesh(mesh, rig, names, f'{config["name"]} {i + 1}')
            if obj.name in seen:
                raise ValueError('Model mesh names must be unique')
            seen.add(obj.name)
        build_actions(rig, model.get('animations', []), names)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH' and obj.data.polygons and obj.visible_get()]
    if not meshes:
        raise ValueError('No mesh faces to export')
    total = []
    for obj in meshes:
        generated = not obj.data.uv_layers
        if generated:
            for angle in (66, 54, 45, 34, 25):
                unwrap(obj, config['uvMargin'], angle)
                if source or not config['textureSize'] or bake_palette(obj, config['textureSize'],
                                                                      Path(config['staged']).parent, config['uvMargin']):
                    break
            else:
                raise ValueError(f'Could not pack an overlap-free base color atlas for {obj.name}')
        mesh = obj.data
        mesh.calc_loop_triangles()
        total.append({
            'name': obj.name, 'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles),
            'uvLayers': len(mesh.uv_layers), 'generatedUVs': generated,
        })
    result = bpy.ops.export_scene.gltf(
        filepath=config['staged'], export_format='GLB', export_apply=False, use_visible=True,
        export_texcoords=True, export_normals=True, export_materials='EXPORT', export_animations=True,
        export_vertex_color='MATERIAL' if source else 'ACTIVE',
        export_skins=True, export_influence_nb=4, export_all_influences=bool(source),
        export_animation_mode='ACTIONS', export_force_sampling=False,
        export_frame_range=False, export_cameras=False, export_lights=False,
    )
    if 'FINISHED' not in result:
        raise RuntimeError('GLB writer did not finish')
    print('INK_GLB ' + json.dumps({
        'meshes': total, 'joints': sum(len(o.data.bones) for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    }))


if __name__ == '__main__':
    run(json.loads(Path(sys.argv[sys.argv.index('--') + 1]).read_text(encoding='utf8')))
