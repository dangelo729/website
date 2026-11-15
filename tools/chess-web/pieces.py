#!/usr/bin/env python3
# the chess set's meshes, made: the six pieces and the board as obj files
# in pieces/, and beside them pieces/shapes.h. a square is 1 unit, y up;
# each piece stands on y = 0 with its axis on the y axis, and the board's
# top is y = 0 with its middle at the origin. a piece is a lathe (a profile
# turned about y) and, for the knight's head and the king's cross, closed
# shells sunk a little into it: the renderer's depth test hides what is
# inside and no line is drawn where they meet. the rook's top is stitched
# onto its lathe, so the rook is one closed surface, its merlons and all,
# and a line is drawn only where its turret has a corner. a corner
# in a profile sharper than the renderer's crease (60 degrees) inks as a
# ring; a curve is cut finer than that and inks only at its silhouette.
# the board is a slab with rounded corners, the 32 dark squares, one open
# mesh flat on its top, the field's frame, one quad that fills nothing
# and inks its edge, and the two the glue lays on a square to mark it: the
# tile, all of it but a little round its edge, and the band, the tile's
# border. shapes.h holds, for each mesh, what
# third_dimension's tools/obj2mesh.py takes away from its obj (the middle
# of its bounds and its radius about that) and how tall it stands over y =
# 0. the objs are the sources: a piece modelled by hand is its obj put in
# place of this one's. every piece and the slab must be closed (open_edges),
# or nothing is written.
#
#   python3 pieces.py      (make pieces)
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "pieces")
SEG = 16  # a lathe's sides, round


def arc(cx, cy, r, a0, a1, n):
    pts = []
    for i in range(n + 1):
        a = math.radians(a0 + (a1 - a0) * i / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


class Mesh:
    def __init__(self):
        self.v = []
        self.f = []
        self.parts = []  # what it is made of, for weighing: ("lathe", profile), ("prism", poly, z0, z1), ("band", ...)

    def add(self, verts, faces):
        base = len(self.v)
        self.v += verts
        self.f += [[base + i for i in face] for face in faces]

    # a profile of (r, y) turned about y, seg sides round; a point on the
    # axis closes the lathe there. returns each profile point's ring, ("r",
    # its first vertex) or ("p", its one vertex on the axis), so more can be
    # stitched onto an open end
    def lathe(self, profile, seg=SEG):
        verts, faces, rings = [], [], []
        for (r, y) in profile:
            if r <= 1e-9:
                rings.append(("p", len(verts)))
                verts.append((0.0, y, 0.0))
            else:
                rings.append(("r", len(verts)))
                for j in range(seg):
                    a = 2 * math.pi * j / seg
                    verts.append((r * math.cos(a), y, r * math.sin(a)))
        for i in range(len(rings) - 1):
            (ka, a), (kb, b) = rings[i], rings[i + 1]
            for j in range(seg):
                j1 = (j + 1) % seg
                if ka == "r" and kb == "r":
                    faces.append([a + j1, a + j, b + j, b + j1])
                elif ka == "p" and kb == "r":
                    faces.append([a, b + j, b + j1])
                elif ka == "r" and kb == "p":
                    faces.append([a + j1, a + j, b])
        base = len(self.v)
        self.add(verts, faces)
        self.parts.append(("lathe", profile))
        return [(k, base + i) for (k, i) in rings]

    # a polygon in the xy plane, ccw seen from +z, pulled from z0 to z1
    def extrude(self, poly, z0, z1):
        self.parts.append(("prism", poly, z0, z1))
        n = len(poly)
        verts = [(x, y, z1) for (x, y) in poly] + [(x, y, z0) for (x, y) in poly]
        faces = []
        for (a, b, c) in ears(poly):
            faces.append([a, b, c])
            faces.append([n + c, n + b, n + a])
        for i in range(n):
            j = (i + 1) % n
            faces.append([n + i, n + j, j, i])
        self.add(verts, faces)

    # how many of its edges are not closed: an edge, between two vertices,
    # that is not walked once each way, by two faces wound the same way
    # round. a closed surface has none; the renderer inks an edge with one
    # face as a boundary line
    def open_edges(self):
        walked = {}
        for face in self.f:
            for k in range(len(face)):
                e = (face[k], face[(k + 1) % len(face)])
                walked[e] = walked.get(e, 0) + 1
        return sum(1 for (a, b), n in walked.items() if n != 1 or walked.get((b, a), 0) != 1)

    # its signed volume: positive for a closed mesh wound ccw outward
    def volume(self):
        vol = 0.0
        for face in self.f:
            a = self.v[face[0]]
            for k in range(1, len(face) - 1):
                b, c = self.v[face[k]], self.v[face[k + 1]]
                vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        return vol

    # the obj, its points as written; and, from those, what obj2mesh takes
    # away (the middle of their bounds and the radius about it) and the
    # highest y
    def write(self, name):
        pts = [tuple(float("%.6f" % x) for x in p) for p in self.v]
        with open(os.path.join(OUT, name + ".obj"), "w") as fp:
            fp.write("# made by pieces.py: %s, a square 1 unit, y up\n" % name)
            for (x, y, z) in pts:
                fp.write("v %.6f %.6f %.6f\n" % (x, y, z))
            for face in self.f:
                fp.write("f " + " ".join(str(i + 1) for i in face) + "\n")
        xs, ys, zs = zip(*pts)
        c = ((min(xs) + max(xs)) * 0.5, (min(ys) + max(ys)) * 0.5, (min(zs) + max(zs)) * 0.5)
        r = max(math.sqrt((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2) for (x, y, z) in pts)
        return c, r, max(ys)


# a polygon cut into triangles by ear clipping, ccw
def ears(poly):
    idx = list(range(len(poly)))
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        return cross(a, b, p) > 0 and cross(b, c, p) > 0 and cross(c, a, p) > 0

    guard = 0
    while len(idx) > 3 and guard < 10000:
        guard += 1
        n = len(idx)
        for k in range(n):
            i0, i1, i2 = idx[(k - 1) % n], idx[k], idx[(k + 1) % n]
            a, b, c = poly[i0], poly[i1], poly[i2]
            if cross(a, b, c) <= 1e-12:
                continue
            if any(inside(poly[m], a, b, c) for m in idx if m not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
    tris.append(tuple(idx))
    return tris


# a piece's foot, R across: its flat bottom, its rim and the step in over it
def foot(R):
    return [(0, 0), (R, 0), (R, 0.08), (R - 0.06, 0.13), (R - 0.06, 0.17)]


def pawn():
    m = Mesh()
    p = foot(0.28) + [(0.15, 0.20), (0.125, 0.27), (0.105, 0.34), (0.092, 0.41), (0.088, 0.47),
                      (0.16, 0.49), (0.16, 0.53), (0.09, 0.555)]
    p += arc(0, 0.69, 0.145, -52, 90, 8)[1:]
    p[-1] = (0, p[-1][1])
    m.lathe(p)
    return m


# a lathe up to its turret's rim, B (0.25 across at 0.84): its profile
# turns in off the top of the base's step 66 degrees, past the crease, so
# the base inks a ring there as the others' do, then eases into a straight
# column under 30 degrees a point, and at its top steps out on a ledge to
# the turret's wall, turning 69 degrees at each of the ledge's edges, so
# both ink and the turret stands on the column as a drum. the turret's
# top stitched onto that rim as one closed surface with the rest: five
# merlons, each two of the 20 sides, and five gaps between them as wide.
# under a merlon its outer face goes straight on up from the wall below
# it, sharing the rim's vertices, so no line is drawn where they meet; on
# top it is flat at 0.96 and inside it is a wall 0.17 across facing the
# axis. in a gap the rim turns in, flat, to the inner ring C (0.17 at
# 0.84), its sill a real corner; and inside C the turret's floor closes
# to the axis at P. where a merlon meets a gap its end is a flat side
# facing the gap. every edge is two faces'
def rook():
    m = Mesh()
    seg, r0, r1, y0, y1 = 20, 0.17, 0.25, 0.84, 0.96
    p = foot(0.33) + [(0.19, 0.205), (0.175, 0.225), (0.17, 0.26), (r0, 0.60), (r1, 0.63), (r1, y0)]
    B = m.lathe(p, seg)[-1][1]
    merlon = lambda j: j % 4 < 2                   # side j is under a merlon
    up = lambda k: merlon(k) or merlon(k - 1)      # vertex k is a merlon's
    at = lambda r, y, k: (r * math.cos(2 * math.pi * k / seg), y, r * math.sin(2 * math.pi * k / seg))
    C = len(m.v)
    m.v += [at(r0, y0, k) for k in range(seg)]
    P = len(m.v)
    m.v.append((0.0, y0, 0.0))
    D, E = {}, {}
    for k in range(seg):
        if up(k):
            D[k], E[k] = len(m.v), len(m.v) + 1
            m.v += [at(r1, y1, k), at(r0, y1, k)]
    for j in range(seg):
        j1 = (j + 1) % seg
        if merlon(j):
            m.f += [[B + j1, B + j, D[j], D[j1]], [D[j1], D[j], E[j], E[j1]], [E[j1], E[j], C + j, C + j1]]
        else:
            m.f.append([B + j1, B + j, C + j, C + j1])
        m.f.append([C + j1, C + j, P])
    for k in range(seg):
        if merlon(k) and not merlon(k - 1):
            m.f.append([B + k, C + k, E[k], D[k]])  # a merlon's first side, facing the gap before it
        elif merlon(k - 1) and not merlon(k):
            m.f.append([D[k], E[k], C + k, B + k])  # its last, facing the gap after it
    m.parts.append(("band", r0, r1, y0, y1, 0.5))  # the merlons, for weighing: half a ring
    return m


def bishop():
    m = Mesh()
    p = foot(0.32) + [(0.18, 0.21), (0.13, 0.31), (0.10, 0.43), (0.085, 0.56), (0.08, 0.66),
                      (0.17, 0.69), (0.17, 0.73), (0.10, 0.76),
                      (0.135, 0.86), (0.15, 0.94), (0.135, 1.03), (0.09, 1.12), (0.04, 1.18)]
    p += arc(0, 1.215, 0.045, -60, 90, 5)
    p[-1] = (0, p[-1][1])
    m.lathe(p)
    return m


def queen():
    m = Mesh()
    p = foot(0.35) + [(0.20, 0.21), (0.145, 0.33), (0.115, 0.48), (0.10, 0.64), (0.095, 0.80),
                      (0.19, 0.83), (0.19, 0.87), (0.11, 0.90),
                      (0.125, 1.00), (0.16, 1.10), (0.21, 1.19), (0.20, 1.22), (0.14, 1.22),
                      (0.12, 1.27), (0.08, 1.31), (0.04, 1.335)]
    p += arc(0, 1.385, 0.055, -55, 90, 5)
    p[-1] = (0, p[-1][1])
    m.lathe(p)
    return m


def king():
    m = Mesh()
    p = foot(0.36) + [(0.21, 0.21), (0.155, 0.34), (0.125, 0.50), (0.11, 0.68), (0.105, 0.86),
                      (0.20, 0.89), (0.20, 0.93), (0.12, 0.96),
                      (0.135, 1.08), (0.17, 1.19), (0.215, 1.28), (0.215, 1.31), (0.16, 1.35), (0.08, 1.375), (0, 1.38)]
    m.lathe(p)
    a, b, y0, y1, y2, y3 = 0.03, 0.10, 1.36, 1.48, 1.54, 1.62
    cross = [(-a, y0), (a, y0), (a, y1), (b, y1), (b, y2), (a, y2), (a, y3), (-a, y3), (-a, y2), (-b, y2), (-b, y1), (-a, y1)]
    m.extrude(cross, -0.03, 0.03)
    return m


# a lathe foot and a head, a side view pulled 0.17 thick, looking along +x
def knight():
    m = Mesh()
    p = foot(0.33) + [(0.21, 0.21), (0.21, 0.27), (0, 0.27)]
    m.lathe(p)
    head = [(-0.17, 0.25), (0.17, 0.25), (0.20, 0.42), (0.16, 0.56), (0.10, 0.66), (0.26, 0.62), (0.31, 0.68),
            (0.30, 0.78), (0.20, 0.90), (0.12, 1.00), (0.10, 1.10), (0.04, 1.00), (-0.06, 0.96), (-0.14, 0.84),
            (-0.19, 0.66), (-0.20, 0.48)]
    m.extrude(head, -0.085, 0.085)
    return m


# the board: a slab half across, thick deep, its corners rounded round_
# with n steps to a corner, its top at y = 0
def slab(half=4.4, thick=0.35, round_=0.45, n=6):
    m = Mesh()
    ring = []
    for (sx, sz, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            ring.append(((half - round_) * sx + round_ * math.cos(a), (half - round_) * sz + round_ * math.sin(a)))
    k = len(ring)
    verts = [(x, 0.0, z) for (x, z) in ring] + [(x, -thick, z) for (x, z) in ring]
    faces = [list(range(k - 1, -1, -1)), [k + i for i in range(k)]]
    for i in range(k):
        j = (i + 1) % k
        faces.append([i, j, k + j, k + i])
    m.add(verts, faces)
    return m


# the dark squares on the board's top, a1 (the corner at -x, -z) dark,
# each square its own quad facing up
def dark():
    m = Mesh()
    for r in range(8):
        for f in range(8):
            if (r + f) % 2:
                continue
            x0, z0 = f - 4.0, r - 4.0
            m.add([(x0, 0.0, z0), (x0 + 1, 0.0, z0), (x0 + 1, 0.0, z0 + 1), (x0, 0.0, z0 + 1)], [[3, 2, 1, 0]])
    return m


# the field's edge, one quad over all 64 squares
def frame():
    m = Mesh()
    m.add([(-4, 0, -4), (4, 0, -4), (4, 0, 4), (-4, 0, 4)], [[3, 2, 1, 0]])
    return m


# the ring a held piece casts on the table: a circle of radius 1 lying flat,
# facing up, one face that the glue draws filling nothing, so only its
# edge inks
def ring(n=24):
    m = Mesh()
    m.add([(math.cos(2 * math.pi * k / n), 0.0, -math.sin(2 * math.pi * k / n)) for k in range(n)], [list(range(n))])
    return m


# a square lying flat with its middle at the origin, facing up, side across:
# laid on a square of the board to fill it, all but a little round its edge
def tile(side=0.94):
    a = side / 2
    m = Mesh()
    m.add([(-a, 0, -a), (a, 0, -a), (a, 0, a), (-a, 0, a)], [[3, 2, 1, 0]])
    return m


# the tile's border, wide across, facing up: four faces, one a side, each
# from the tile's edge in, so the band's own edges, outside and in, are all
# that inks
def band(side=0.94, wide=0.08):
    a, b = side / 2, side / 2 - wide
    m = Mesh()
    ring = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    verts = [(a * x, 0, a * z) for (x, z) in ring] + [(b * x, 0, b * z) for (x, z) in ring]
    m.add(verts, [[4 + k, 4 + (k + 1) % 4, (k + 1) % 4, k] for k in range(4)])
    return m


MESHES = [("pawn", pawn), ("rook", rook), ("knight", knight), ("bishop", bishop), ("queen", queen),
          ("king", king), ("slab", slab), ("dark", dark), ("frame", frame), ("ring", ring), ("tile", tile),
          ("band", band)]

# --- the pieces as bodies ------------------------------------------------------
# what the solver (physics_box's pb::Bodies) knows of each piece: two rims,
# the foot and the top of the base's wall, BASE_TOP up, each as wide as the
# base; and balls (x, y, z, r, floor) from the middle of its foot: the
# first as wide as the base and low, meeting nothing but the other pieces'
# balls and the walls, the rest up the stem and the head meeting the floor
# too, the knight's last two off the axis in its head, which looks along +x
BASE_TOP = 0.08
BALLS = {
    "pawn": [(0, 0.10, 0, 0.28, False), (0, 0.33, 0, 0.13, True), (0, 0.51, 0, 0.16, True), (0, 0.69, 0, 0.145, True)],
    "rook": [(0, 0.10, 0, 0.33, False), (0, 0.38, 0, 0.17, True), (0, 0.55, 0, 0.17, True), (0, 0.76, 0, 0.25, True)],
    "knight": [(0, 0.10, 0, 0.33, False), (0, 0.40, 0, 0.20, True), (0, 0.66, 0, 0.21, True), (0, 0.90, 0, 0.16, True),
               (0.20, 0.70, 0, 0.11, True), (0.05, 1.02, 0, 0.08, True)],
    "bishop": [(0, 0.10, 0, 0.32, False), (0, 0.33, 0, 0.14, True), (0, 0.55, 0, 0.10, True), (0, 0.71, 0, 0.17, True),
               (0, 0.95, 0, 0.15, True), (0, 1.19, 0, 0.07, True)],
    "queen": [(0, 0.10, 0, 0.35, False), (0, 0.36, 0, 0.15, True), (0, 0.62, 0, 0.11, True), (0, 0.85, 0, 0.19, True),
              (0, 1.12, 0, 0.20, True), (0, 1.37, 0, 0.07, True)],
    "king": [(0, 0.10, 0, 0.36, False), (0, 0.38, 0, 0.16, True), (0, 0.66, 0, 0.12, True), (0, 0.91, 0, 0.20, True),
             (0, 1.20, 0, 0.21, True), (0, 1.50, 0, 0.10, True)],
}

# a piece's stuff weighs 1 a cubic square, and its foot, the base up to
# the top of its step (FOOT), as many times that as puts its centre of mass
# COM_AT of its height up, so it sits low as a weighted piece's does. it is
# weighed in slices STEP tall and, off the lathe, cells STEP across
FOOT, COM_AT, STEP = 0.17, 0.135, 0.001
LOWEST = 0.15  # of its height, the highest a piece's centre of mass may be


# a lathe's radius at height y: its profile's y never goes down, so the
# radius is read off the segment that spans y, 0 where none does
def radius_at(profile, y):
    for (r0, y0), (r1, y1) in zip(profile, profile[1:]):
        if y0 <= y <= y1 and y1 > y0:
            return r0 + (r1 - r0) * (y - y0) / (y1 - y0)
    return 0.0


def inside(poly, x, y):
    n, hit = len(poly), False
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


# a piece's mass, its centre of mass up its axis, and its inertia about that
# centre, round the axis and across it, its foot heavy times as dense as the
# rest, summed over what it is made of: the
# lathe a disc a slice; a prism (the knight's head, the king's cross) a
# column a cell of its polygon, where the lathe is not already; a band (the
# rook's merlons) a share of a ring. the centre of mass is taken on the
# axis, the knight's head's pull off it left out
def weigh(mesh, heavy):
    lathe = next(p[1] for p in mesh.parts if p[0] == "lathe")
    density = lambda y: heavy if y < FOOT else 1.0
    m = my = myy = axis = across = 0.0  # across: each bit's about its own middle; myy carries it to the centre

    def put(dm, y, ia, ix):
        nonlocal m, my, myy, axis, across
        m, my, myy, axis, across = m + dm, my + dm * y, myy + dm * y * y, axis + ia, across + ix

    for part in mesh.parts:
        if part[0] == "lathe":
            p = part[1]
            y = p[0][1] + STEP / 2
            while y < p[-1][1]:
                R = radius_at(p, y)
                dm = density(y) * math.pi * R * R * STEP
                put(dm, y, dm * R * R / 2, dm * R * R / 4)
                y += STEP
        elif part[0] == "prism":
            poly, z0, z1 = part[1:]
            t, cell = z1 - z0, 2 * STEP
            xs, ys = [q[0] for q in poly], [q[1] for q in poly]
            y = min(ys) + cell / 2
            while y < max(ys):
                x = min(xs) + cell / 2
                while x < max(xs):
                    if inside(poly, x, y) and abs(x) >= radius_at(lathe, y):
                        dm = density(y) * cell * cell * t
                        put(dm, y, dm * (x * x + t * t / 12), dm * (x * x + t * t / 12) / 2)
                    x += cell
                y += cell
        elif part[0] == "band":
            r0, r1, y0, y1, share = part[1:]
            dm = density(y0) * share * math.pi * (r1 * r1 - r0 * r0) * (y1 - y0)
            put(dm, (y0 + y1) / 2, dm * (r0 * r0 + r1 * r1) / 2, dm * ((r0 * r0 + r1 * r1) / 4 + (y1 - y0) ** 2 / 12))
    com = my / m
    return m, com, axis, across + myy - m * com * com


# shapes.h: for each mesh, its ChessShape; and for each piece, its body
def header(fits, bodies):
    lines = ["// made by tools/chess-web/pieces.py (make pieces): do not edit.",
             "// for each of the chess set's meshes, what tools/obj2mesh.py takes away",
             "// from its obj, the middle of its bounds (cx, cy, cz) and its radius about",
             "// that (r), so the mesh drawn at scale r with its middle at c stands where",
             "// its obj does; and the highest it reaches over y = 0 (top). a square is 1",
             "// unit, y up. and for each piece, what physics_box's solver knows of it",
             "// (<name>_body): its rims and balls from the middle of its foot, its mass,",
             "// its centre of mass up its axis, and its inertia about that, round the",
             "// axis and across it.",
             "#pragma once",
             "",
             "#include <core/pb_bodies.h>",
             "",
             "struct ChessShape { float cx, cy, cz, r, top; };",
             ""]
    for (name, c, r, top) in fits:
        lines.append("static const ChessShape %s_shape = { %.6ff, %.6ff, %.6ff, %.6ff, %.6ff };" % (name, c[0], c[1], c[2], r, top))
    for (name, foot, balls, (m, com, ia, ix)) in bodies:
        lines += ["",
                  "static const pb::Rim %s_rims[2] = { { 0.0f, %.6ff }, { %.6ff, %.6ff } };" % (name, foot, BASE_TOP, foot),
                  "static const pb::Ball %s_balls[%d] = {" % (name, len(balls))]
        lines += ["    { %.6ff, %.6ff, %.6ff, %.6ff, %s }," % (x, y, z, r, "true" if f else "false") for (x, y, z, r, f) in balls]
        lines += ["};",
                  "static const pb::BodyShape %s_body = { %s_rims, 2, %s_balls, %d, %.6ff, %.6ff, %.6ff, %.6ff };"
                  % (name, name, name, len(balls), m, com, ia, ix)]
    return "\n".join(lines) + "\n"


# the meshes that must be closed: the dark squares, the frame, the ring, the tile and the band are open
CLOSED = {"pawn", "rook", "knight", "bishop", "queen", "king", "slab"}


def main():
    made = [(name, make()) for (name, make) in MESHES]
    shut = True
    for (name, mesh) in made:
        n = mesh.open_edges()
        print("%-7s verts %4d faces %4d volume %+.4f open edges %d" % (name, len(mesh.v), len(mesh.f), mesh.volume(), n))
        if name in CLOSED and (n or mesh.volume() <= 0):
            print("%s is not closed, wound outward" % name)
            shut = False
    # each piece weighed, its foot as dense as puts its centre of mass
    # COM_AT of its height up, and no higher than LOWEST of it; and the lean
    # past which it falls over, its centre of mass over its foot's edge
    bodies = []
    print("%-7s %7s %7s %6s %7s %10s %10s %7s" % ("", "foot", "mass", "com", "share", "round", "across", "falls"))
    for (name, mesh) in made:
        if name not in BALLS:
            continue
        top = max(v[1] for v in mesh.v)
        lo, hi = 1.0, 200.0
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if weigh(mesh, mid)[1] > COM_AT * top else (lo, mid)
        heavy = (lo + hi) / 2
        w = weigh(mesh, heavy)
        foot = next(p[1] for p in mesh.parts if p[0] == "lathe")[1][0]
        bodies.append((name, foot, BALLS[name], w))
        print("%-7s %6.1fx %7.4f %6.3f %6.1f%% %10.5f %10.5f %6.1f deg"
              % (name, heavy, w[0], w[1], 100 * w[1] / top, w[2], w[3], math.degrees(math.atan2(foot, w[1]))))
        if not w[1] < LOWEST * top:
            print("%s's weight sits too high" % name)
            shut = False
    if not shut:
        raise SystemExit(1)
    os.makedirs(OUT, exist_ok=True)
    fits = []
    for (name, mesh) in made:
        c, r, top = mesh.write(name)
        fits.append((name, c, r, top))
    with open(os.path.join(OUT, "shapes.h"), "w") as fp:
        fp.write(header(fits, bodies))


if __name__ == "__main__":
    main()
