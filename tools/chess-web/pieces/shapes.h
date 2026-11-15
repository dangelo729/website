// made by tools/chess-web/pieces.py (make pieces): do not edit.
// for each of the chess set's meshes, what tools/obj2mesh.py takes away
// from its obj, the middle of its bounds (cx, cy, cz) and its radius about
// that (r), so the mesh drawn at scale r with its middle at c stands where
// its obj does; and the highest it reaches over y = 0 (top). a square is 1
// unit, y up. and for each piece, what physics_box's solver knows of it
// (<name>_body): its rims and balls from the middle of its foot, its mass,
// its centre of mass up its axis, and its inertia about that, round the
// axis and across it.
#pragma once

#include <core/pb_bodies.h>

struct ChessShape { float cx, cy, cz, r, top; };

static const ChessShape pawn_shape = { 0.000000f, 0.417500f, 0.000000f, 0.502699f, 0.835000f };
static const ChessShape rook_shape = { 0.000000f, 0.480000f, 0.000000f, 0.582495f, 0.960000f };
static const ChessShape knight_shape = { 0.000000f, 0.550000f, 0.000000f, 0.641405f, 1.100000f };
static const ChessShape bishop_shape = { 0.000000f, 0.630000f, 0.000000f, 0.706612f, 1.260000f };
static const ChessShape queen_shape = { 0.000000f, 0.720000f, 0.000000f, 0.800562f, 1.440000f };
static const ChessShape king_shape = { 0.000000f, 0.810000f, 0.000000f, 0.886397f, 1.620000f };
static const ChessShape slab_shape = { 0.000000f, -0.175000f, 0.000000f, 6.121489f, 0.000000f };
static const ChessShape dark_shape = { 0.000000f, 0.000000f, 0.000000f, 5.656854f, 0.000000f };
static const ChessShape frame_shape = { 0.000000f, 0.000000f, 0.000000f, 5.656854f, 0.000000f };
static const ChessShape ring_shape = { 0.000000f, 0.000000f, 0.000000f, 1.000000f, 0.000000f };
static const ChessShape tile_shape = { 0.000000f, 0.000000f, 0.000000f, 0.664680f, 0.000000f };
static const ChessShape band_shape = { 0.000000f, 0.000000f, 0.000000f, 0.664680f, 0.000000f };

static const pb::Rim pawn_rims[2] = { { 0.0f, 0.280000f }, { 0.080000f, 0.280000f } };
static const pb::Ball pawn_balls[4] = {
    { 0.000000f, 0.100000f, 0.000000f, 0.280000f, false },
    { 0.000000f, 0.330000f, 0.000000f, 0.130000f, true },
    { 0.000000f, 0.510000f, 0.000000f, 0.160000f, true },
    { 0.000000f, 0.690000f, 0.000000f, 0.145000f, true },
};
static const pb::BodyShape pawn_body = { pawn_rims, 2, pawn_balls, 4, 0.357790f, 0.112725f, 0.011580f, 0.012600f };

static const pb::Rim rook_rims[2] = { { 0.0f, 0.330000f }, { 0.080000f, 0.330000f } };
static const pb::Ball rook_balls[4] = {
    { 0.000000f, 0.100000f, 0.000000f, 0.330000f, false },
    { 0.000000f, 0.380000f, 0.000000f, 0.170000f, true },
    { 0.000000f, 0.550000f, 0.000000f, 0.170000f, true },
    { 0.000000f, 0.760000f, 0.000000f, 0.250000f, true },
};
static const pb::BodyShape rook_body = { rook_rims, 2, rook_balls, 4, 0.902123f, 0.129600f, 0.041783f, 0.048097f };

static const pb::Rim knight_rims[2] = { { 0.0f, 0.330000f }, { 0.080000f, 0.330000f } };
static const pb::Ball knight_balls[6] = {
    { 0.000000f, 0.100000f, 0.000000f, 0.330000f, false },
    { 0.000000f, 0.400000f, 0.000000f, 0.200000f, true },
    { 0.000000f, 0.660000f, 0.000000f, 0.210000f, true },
    { 0.000000f, 0.900000f, 0.000000f, 0.160000f, true },
    { 0.200000f, 0.700000f, 0.000000f, 0.110000f, true },
    { 0.050000f, 1.020000f, 0.000000f, 0.080000f, true },
};
static const pb::BodyShape knight_body = { knight_rims, 2, knight_balls, 6, 0.389446f, 0.148500f, 0.017167f, 0.023521f };

static const pb::Rim bishop_rims[2] = { { 0.0f, 0.320000f }, { 0.080000f, 0.320000f } };
static const pb::Ball bishop_balls[6] = {
    { 0.000000f, 0.100000f, 0.000000f, 0.320000f, false },
    { 0.000000f, 0.330000f, 0.000000f, 0.140000f, true },
    { 0.000000f, 0.550000f, 0.000000f, 0.100000f, true },
    { 0.000000f, 0.710000f, 0.000000f, 0.170000f, true },
    { 0.000000f, 0.950000f, 0.000000f, 0.150000f, true },
    { 0.000000f, 1.190000f, 0.000000f, 0.070000f, true },
};
static const pb::BodyShape bishop_body = { bishop_rims, 2, bishop_balls, 6, 0.301491f, 0.170100f, 0.012003f, 0.024252f };

static const pb::Rim queen_rims[2] = { { 0.0f, 0.350000f }, { 0.080000f, 0.350000f } };
static const pb::Ball queen_balls[6] = {
    { 0.000000f, 0.100000f, 0.000000f, 0.350000f, false },
    { 0.000000f, 0.360000f, 0.000000f, 0.150000f, true },
    { 0.000000f, 0.620000f, 0.000000f, 0.110000f, true },
    { 0.000000f, 0.850000f, 0.000000f, 0.190000f, true },
    { 0.000000f, 1.120000f, 0.000000f, 0.200000f, true },
    { 0.000000f, 1.370000f, 0.000000f, 0.070000f, true },
};
static const pb::BodyShape queen_body = { queen_rims, 2, queen_balls, 6, 0.420024f, 0.194400f, 0.020041f, 0.047660f };

static const pb::Rim king_rims[2] = { { 0.0f, 0.360000f }, { 0.080000f, 0.360000f } };
static const pb::Ball king_balls[6] = {
    { 0.000000f, 0.100000f, 0.000000f, 0.360000f, false },
    { 0.000000f, 0.380000f, 0.000000f, 0.160000f, true },
    { 0.000000f, 0.660000f, 0.000000f, 0.120000f, true },
    { 0.000000f, 0.910000f, 0.000000f, 0.200000f, true },
    { 0.000000f, 1.200000f, 0.000000f, 0.210000f, true },
    { 0.000000f, 1.500000f, 0.000000f, 0.100000f, true },
};
static const pb::BodyShape king_body = { king_rims, 2, king_balls, 6, 0.458232f, 0.218700f, 0.022812f, 0.063809f };
