import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets/models/garden_rose/blender/build_garden_rose.py");
const blend = path.join(root, "assets/models/garden_rose/blender/garden_rose.blend");
const blender = process.env.BLENDER_EXE || "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe";

test("Rose01 preserves authored geometry while regenerating its shoot", { timeout: 180_000 }, () => {
  const py = String.raw`
import bpy, importlib.util, hashlib, json
from mathutils import Vector
spec=importlib.util.spec_from_file_location("rose_source", __SOURCE__)
src=importlib.util.module_from_spec(spec); spec.loader.exec_module(src)
def digest(o):
 h=hashlib.sha256()
 if o.type=="MESH":
  for v in o.data.vertices: h.update(repr(tuple(round(x,8) for x in v.co)).encode())
  for f in o.data.polygons: h.update(repr(tuple(f.vertices)).encode())
 elif o.type=="CURVE":
  for s in o.data.splines:
   for p in s.points: h.update(repr((tuple(round(x,8) for x in p.co),round(p.radius,8),round(p.tilt,8),round(p.weight,8))).encode())
 return h.hexdigest()
def state():
 stem=bpy.data.objects["Main_stem_curved"]
 return (tuple((tuple(round(x,8) for x in p.co),round(p.radius,8)) for p in stem.data.splines[0].points),
 tuple((r,tuple(round(x,8) for row in src._role_socket(r).matrix_world for x in row)) for r in sorted(src.ROLE_ANCHORS)),
 tuple(sorted(o.name for o in bpy.context.scene.objects)))
assert bpy.data.objects["GardenRose_root_origin"]["rose01_schema_version"]==1
# Simulate the exact pre-fix saved defect on an already-migrated source scene.
bud=bpy.data.objects["Bud_pedicel"]; bud_point=bud.data.splines[0].points[-1]
bud_point.co=(0.0,0.0,0.0,1.0); bud_point.radius=1.0
src.regenerate_scene(seed=314159,stem_height_ratio=1.0); same=state()
bud=bpy.data.objects["Bud_pedicel"]; bud_spline=bud.data.splines[0]
bud_base=src._canonical_bud_pedicel_points()[-1]
assert len(bud_spline.points)==4 and max(abs(bud_spline.points[-1].co[i]-bud_base[i]) for i in range(3))<1e-6
assert abs(bud_spline.points[-1].radius-0.30)<1e-6 and bud_spline.points[-1].co[:3]!=(0.0,0.0,0.0)
canonical_bud_socket=src._socket_matrix("bud",1.0)
bud_base_in_socket=canonical_bud_socket.inverted()@bud_base
def bud_endpoint_gap():
 endpoint=bud.matrix_world@Vector(bud.data.splines[0].points[-1].co[:3])
 target=src._role_socket("bud").matrix_world@bud_base_in_socket
 return (endpoint-target).length
assert bud_endpoint_gap()<1e-5,"corrected pedicel terminal must meet the bud base"
src.regenerate_scene(seed=314159,stem_height_ratio=1.0)
assert state()==same,"same seed/default output is unstable"
mesh=bpy.data.objects["Petal_Outer_01"]; curve=bpy.data.objects["Compound_leaf_1_petiole"]
mesh.data.vertices[0].co.x+=0.00123; curve.data.splines[0].points[0].co.y+=0.00045
bud.data.splines[0].points[1].co.y+=0.0017; bud.data.splines[0].points[1].radius+=0.037
mesh_hash=digest(mesh); curve_hash=digest(curve); bud_hash=digest(bud)
stem=bpy.data.objects["Main_stem_curved"]; radii=tuple(p.radius for p in stem.data.splines[0].points); bevel=stem.data.bevel_depth
leaf=src._role_socket("leaf:01"); petiole=bpy.data.objects["Compound_leaf_1_petiole"]; point=petiole.data.splines[0].points[0].co
def gap(): return ((petiole.matrix_world@Vector(point[:3]))-leaf.matrix_world.translation).length
base_gap=gap()
root=bpy.data.objects["GardenRose_root_origin"]
def role_root(role):
 if role.startswith("leaf:"):
  o=bpy.data.objects["Compound_leaf_"+str(int(role[-2:]))+"_petiole"]
  return o.matrix_world@Vector(o.data.splines[0].points[0].co[:3])
 if role.startswith("thorn:"):
  o=bpy.data.objects["Stem_thorn_"+role[-2:]]
  center=sum((v.co for v in o.data.vertices[:8]),Vector())/8
  return o.matrix_world@center
 o=bpy.data.objects["Flower_pedicel" if role=="flower" else "Bud_pedicel"]
 return o.matrix_world@Vector(o.data.splines[0].points[0].co[:3])
def role_gaps():
 inv=root.matrix_world.inverted()
 return {role:((inv@role_root(role))-(inv@src._role_socket(role).matrix_world.translation)).length for role in src.ROLE_ANCHORS}
base_role_gaps=role_gaps()
col=bpy.data.collections.new("USER | Rose contract"); bpy.context.scene.collection.children.link(col)
custom=bpy.data.objects.new("USER_Rose_added_detail",bpy.data.meshes.new("USER_Rose_added_mesh")); col.objects.link(custom); custom.location=(0.31,0.14,0.77)
bpy.context.view_layer.update()
custom_matrix=custom.matrix_world.copy()
attached=bpy.data.objects.new("USER_Rose_attached_detail",bpy.data.meshes.new("USER_Rose_attached_mesh")); col.objects.link(attached); attached.location=(0.2,0.1,0.6)
before=attached.matrix_world.copy(); src.attach_to_role(attached,"flower")
assert max(abs(before[r][c]-attached.matrix_world[r][c]) for r in range(4) for c in range(4))<1e-6
root.location=(10.0,-3.0,2.5); root.rotation_euler=(0.22,-0.31,0.47); root.scale=(1.75,1.75,1.75)
bpy.context.view_layer.update()
positions={}; frames={}
for ratio in (0.9,0.99,1.0,1.01,1.1):
 src.regenerate_scene(seed=314159,stem_height_ratio=ratio)
 positions[ratio]=(root.matrix_world.inverted()@leaf.matrix_world.translation).z; frames[ratio]=leaf.matrix_basis.to_3x3().col[2].copy()
 assert digest(mesh)==mesh_hash and digest(curve)==curve_hash
 assert digest(bud)==bud_hash,"custom Bud_pedicel curve edit was overwritten"
 assert bud_endpoint_gap()<1e-4,"Bud_pedicel disconnected from bud base after height/root transform"
 assert tuple(p.radius for p in stem.data.splines[0].points)==radii and abs(stem.data.bevel_depth-bevel)<1e-9
 assert abs(gap()-base_gap*1.75)<1e-4
 assert max(abs(role_gaps()[role]-base_role_gaps[role]) for role in base_role_gaps)<1e-4,"organ roots separated from their parent sockets"
assert abs(positions[0.9]-positions[1.1])>0.099
assert abs(frames[0.99].dot(frames[1.01]))>0.999
assert custom.name in bpy.context.scene.objects and max(abs(custom_matrix[r][c]-custom.matrix_world[r][c]) for r in range(4) for c in range(4))<1e-6
assert attached.matrix_world.translation.z!=before.translation.z
pre=state()
for bad in (0.89,1.11,float("nan"),float("inf")):
 try: src.regenerate_scene(stem_height_ratio=bad)
 except ValueError: pass
 else: raise AssertionError("invalid ratio accepted")
assert state()==pre,"invalid parameters mutated scene"
final_gap=gap(); final_role_gaps=role_gaps()
bpy.ops.wm.read_factory_settings(use_empty=True); src.build_factory_scene(seed=314159)
fresh_bud=bpy.data.objects["Bud_pedicel"].data.splines[0].points[-1]
fresh_bud.co=(0.0,0.0,0.0,1.0); fresh_bud.radius=1.0
src.regenerate_scene(seed=314159,stem_height_ratio=1.0)
repaired=bpy.data.objects["Bud_pedicel"].data.splines[0].points[-1]
assert max(abs(repaired.co[i]-bud_base[i]) for i in range(3))<1e-6 and abs(repaired.radius-0.30)<1e-6,"first migration did not repair exact legacy bud curve"
bpy.ops.wm.read_factory_settings(use_empty=True); src.build_factory_scene(seed=314159)
for attribute,value in (("tilt",0.25),("weight",1.25)):
 bpy.ops.wm.read_factory_settings(use_empty=True); src.build_factory_scene(seed=314159)
 custom_bud=bpy.data.objects["Bud_pedicel"]; custom_point=custom_bud.data.splines[0].points[-1]
 custom_point.co=(0.0,0.0,0.0,1.0); custom_point.radius=1.0; setattr(custom_point,attribute,value)
 before_custom=digest(custom_bud)
 src.regenerate_scene(seed=314159,stem_height_ratio=1.0)
 assert digest(bpy.data.objects["Bud_pedicel"])==before_custom,f"legacy-shaped user Bud_pedicel {attribute} edit was overwritten"
bpy.ops.wm.read_factory_settings(use_empty=True); src.build_factory_scene(seed=314159)
collision=bpy.data.objects.new("Rose01_socket_leaf_01",None); bpy.context.scene.collection.objects.link(collision)
pre=(tuple(sorted(o.name for o in bpy.context.scene.objects)),tuple(sorted(c.name for c in bpy.data.collections)),digest(bpy.data.objects["Main_stem_curved"]))
try: src.regenerate_scene()
except RuntimeError as e: assert "collision" in str(e).lower()
else: raise AssertionError("socket collision accepted")
post=(tuple(sorted(o.name for o in bpy.context.scene.objects)),tuple(sorted(c.name for c in bpy.data.collections)),digest(bpy.data.objects["Main_stem_curved"]))
assert pre==post,"migration collision changed scene"
try: src.build_factory_scene()
except RuntimeError: pass
else: raise AssertionError("factory accepted occupied scene")
assert collision.name in bpy.context.scene.objects
bpy.data.objects.remove(collision,do_unlink=True); src.regenerate_scene()
print("ROSE01_CONTRACT_PASS",json.dumps({"roles":len(src.ROLE_ANCHORS),"ratios":[0.9,0.99,1,1.01,1.1],"organ_root_gaps_m":final_role_gaps,"frame_dot":frames[0.99].dot(frames[1.01]),"edited_mesh_curve":"preserved","invalid_collision":"no mutation","custom_content":"preserved"}))
`.replace("__SOURCE__",JSON.stringify(source));
  const result = spawnSync(blender, ["--background", blend, "--python-exit-code", "1", "--python-expr", py], { encoding: "utf8", timeout: 180_000, windowsHide: true });
  assert.equal(result.error, undefined, "Blender failed to start");
  assert.equal(result.status, 0, String(result.stdout) + String(result.stderr));
  assert.match(result.stdout, /ROSE01_CONTRACT_PASS/);
});






