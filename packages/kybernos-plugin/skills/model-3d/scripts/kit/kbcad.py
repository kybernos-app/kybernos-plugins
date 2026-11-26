"""Shared helpers for the 3D shelf examples that are built with a real CAD kernel (build123d / OpenCascade).

A model is a `Kit`: named solids drawn at their reference pose, in millimetres, Z up. The helpers
  - tessellate every solid and write ONE .glb (metres, Y up: what three.js expects), one node per part;
  - check every part before it ships: valid B-rep, closed mesh, mesh volume equal to the exact volume;
  - measure what the page will show (exact volume, mass from a density, bounding box);
  - test two parts against each other: the volume they share must be zero.

Run with the toolchain python that `node scripts/model.mjs doctor` prints (an isolated venv, never the system python).
"""
import json
import numpy as np
import trimesh

# CAD (x right, y depth, z up) -> three.js (x right, y up, z toward the viewer)
_TO_THREE = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], float)
TOL, ANG = 0.03, 0.12            # tessellation: 0.03 mm chord error, 0.12 rad angular error


def mesh_of(shape, tol=TOL, ang=ANG):
    v, f = shape.tessellate(tol, ang)
    return trimesh.Trimesh([(p.X, p.Y, p.Z) for p in v], f, process=True)


class Kit:
    def __init__(self):
        self.parts = {}

    def add(self, name, shape, material, density=None, tess=None, vtol=None, **meta):
        """density in g/cm3 (None for parts that have no mass to report); tess = (chord, angle) for parts that need another mesh; vtol = allowed mesh-volume error for
        a part that is only there to be looked at (a spring)."""
        if name in self.parts:
            raise ValueError('part twice: ' + name)
        self.parts[name] = dict(shape=shape, material=material, density=density, tess=tess or (TOL, ANG), vtol=vtol, meta=meta)
        return shape

    def report(self):
        out = {}
        for name, p in self.parts.items():
            s = p['shape']
            m = mesh_of(s, *p['tess'])
            bb = s.bounding_box()
            vol = s.volume
            row = dict(
                material=p['material'], valid=bool(s.is_valid), volume_mm3=round(vol, 3), area_mm2=round(s.area, 2),
                bbox_mm=[[round(bb.min.X, 3), round(bb.min.Y, 3), round(bb.min.Z, 3)], [round(bb.max.X, 3), round(bb.max.Y, 3), round(bb.max.Z, 3)]],
                triangles=int(len(m.faces)), watertight=bool(m.is_watertight),
                mesh_volume_error=round(abs(m.volume - vol) / vol, 5) if vol else None)
            if p['density']:
                row['density_g_cm3'] = p['density']
                row['mass_g'] = round(vol / 1000.0 * p['density'], 2)
            row['volume_tolerance'] = p['vtol'] or None
            row.update(p['meta'])
            out[name] = row
        return out

    def check(self, max_volume_error=0.003):
        """Raise with every problem listed; return the report when all parts are sound."""
        rep, bad = self.report(), []
        for n, r in rep.items():
            if not r['valid']: bad.append(n + ': invalid B-rep')
            if not r['volume_mm3'] > 0: bad.append(n + ': empty or inside out')
            if not r['watertight']: bad.append(n + ': tessellation is not closed')
            if r['mesh_volume_error'] is not None and r['mesh_volume_error'] > (r['volume_tolerance'] or max_volume_error):
                bad.append('%s: mesh volume off by %.2f%%' % (n, r['mesh_volume_error'] * 100))
        if bad:
            raise AssertionError('; '.join(bad))
        return rep

    def write_glb(self, path):
        scene = trimesh.Scene()
        for name, p in self.parts.items():
            m = mesh_of(p['shape'], *p['tess'])
            m.apply_scale(0.001)
            m.apply_transform(_TO_THREE)
            scene.add_geometry(m, node_name=name, geom_name=name)
        data = scene.export(file_type='glb')
        with open(path, 'wb') as f:
            f.write(data)
        return len(data)


def shared_volume(a, b):
    """Volume (mm3) that two solids occupy together: 0.0 when they only touch or do not meet, None when the kernel failed.
    Treat None as a failure of the check, never as "no overlap"."""
    try:
        r = a & b
    except Exception:
        return None
    if r is None:
        return 0.0
    try:
        return float(r.volume)
    except Exception:
        return None


def write_json(path, obj):
    with open(path, 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True)
