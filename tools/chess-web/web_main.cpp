// chess on the web: the chess set, headless, compiled with nothing else into
// ../../chess/chess.wasm, which js/chess.js steps a frame at a time on the
// page. a square is 1 unit, y up: the board's top is y = 0 with its middle
// at the origin, white's pieces stand at -z and black's at +z, a1 dark at
// the corner at -x, -z. the meshes are pieces/ (pieces.py): the slab, the
// dark squares, the field's frame, the ring and the six pieces, each a
// header made by third_dimension's obj2mesh, which centres a mesh and
// scales it to a unit radius; shapes.h has what it took away, and each
// object is put back at that scale and place. one renderer and one camera
// draw three scenes into one canvas in third_dimension's outline look,
// each pass on what the last drew: the slab, then the dark squares, the
// frame and the ring, then the 32 pieces. its fills are sorted by depth a
// face at a time and only its lines are tested a pixel at a time, so a
// square drawn with the pieces could land over the foot of one standing at
// its far edge; drawn first, it cannot. the board's top is the table the
// pieces stand on and the camera is held above it, so nothing a later pass
// draws can be under what an earlier one drew. every pass always has
// something to draw (the renderer writes through a depth buffer it has not
// yet made when the first pass of an outline frame draws nothing). the
// canvas is a target of our own with two planes: the picture, each pixel
// the page's v for what is drawn there (paper, ink or the tone), and the
// pick plane, a byte a pixel, the piece whose fill is there or none. each
// object's colour is a small record the canvas reads as each face and line
// is handed to it: its fill's class, its lines' and which piece it is. the
// look (chess_look) picks the classes. the camera orbits the board's middle
// at a fixed distance, its turn round and over eased toward where the page
// has turned it by the house approach; its focal and its centre are fitted
// each time the canvas changes size, so the whole slab, and a king standing
// anywhere on it, stays inside the canvas at every turn and tilt it can
// take.
//
// the pieces are physics_box's rigid bodies (pb::Bodies), each its shape
// from shapes.h, in a box that is the table: kHalf each way from the
// board's middle, a square past the slab, its floor the board's top, its
// walls and its ceiling never drawn. each body is a piece, in the pieces'
// order, and each drawn frame each piece is posed from its body. the hand
// holds one piece at a time by the point on its axis kGrip under its top,
// so it hangs upright from there; the hand rides a level plane as high as
// that point stands plus kLift, so a carried piece passes over the others,
// at the place where the pointer's ray from the eye meets that plane, kept
// as far from it as the held point was at the take, so the piece first
// rises straight up, and kept inside the table by the piece's base. the
// hand eases there by the house approach, never faster than kHandMost, so
// the solver never has far to pull it. while a piece is held a ring as wide
// as its base lies on the table under its foot, in a line that is ink on
// paper and paper on ink. the solver's friction is ours (kStatic and on),
// so a piece knocked about slides and rolls a little and stops. the piece
// held, or else the one the page has under the pointer, has the hover
// colour where it would have the ink. a step draws only while something
// moves: a body awake or held, the camera easing, or anything else changed.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <TD_Scene.h>
#include <core/pb_bodies.h>

#include "meshes/bishop.h"
#include "meshes/dark.h"
#include "meshes/frame.h"
#include "meshes/king.h"
#include "meshes/knight.h"
#include "meshes/pawn.h"
#include "meshes/queen.h"
#include "meshes/ring.h"
#include "meshes/rook.h"
#include "meshes/slab.h"
#include "pieces/shapes.h"

namespace {

constexpr float kDeg   = 0.017453292f;
constexpr float kTwoPi = 6.2831853f;

// --- the canvas -----------------------------------------------------------------
// canvas px: at most kMaxW x kMaxH, the planes sized for that and never
// moved; no less than kLeast either way
constexpr int kMaxW  = 800;
constexpr int kMaxH  = 600;
constexpr int kLeast = 16;

// a step's longest dt, s
constexpr float kMaxDt = 0.1f;

// --- the camera ---------------------------------------------------------------------
constexpr float kRoundAt   = 25.0f * kDeg; // where it starts, round the board from white's side
constexpr float kOverAt    = 36.0f * kDeg; // and up over it
constexpr float kOverLeast = 15.0f * kDeg; // the least it is over the board
constexpr float kOverMost  = 80.0f * kDeg; // and the most
constexpr float kDistance  = 20.0f;        // units, the eye from the point it orbits
constexpr float kAimY      = 0.2f;         // units, that point, over the board's middle
constexpr float kTurnRate  = 10.0f;        // 1/s: how fast the drawn turn catches up with where it is turned
constexpr float kStill     = 1e-4f;        // radians: a drawn turn this near where it is turned is there
// the fit keeps the slab, and a king anywhere on it, kRoom px in from every
// edge of the canvas, sweeping kRoundSteps turns round a lap at each of
// kOverSteps + 1 tilts from the least to the most
constexpr float kRoom       = 3.0f;
constexpr int   kRoundSteps = 90;
constexpr int   kOverSteps  = 26;

// --- the table and the hand -----------------------------------------------------------
constexpr float   kHalf     = 5.4f;   // squares the table reaches from the board's middle each way: a square past the slab
constexpr float   kTall     = 12.0f;  // squares to the box's ceiling, out of reach
constexpr float   kGravity  = 120.0f; // squares/s², some two thirds of life size: a fall that lands
constexpr float   kStepHz   = 60.0f;  // the solver's fixed steps a second
constexpr uint8_t kSubsteps = 10;     // and the substeps each is cut into
constexpr float   kGrip     = 0.1f;   // squares under a piece's top, on its axis, where the hand holds it
constexpr float   kLift     = 1.7f;   // squares a held piece is carried up: its foot clear of the tallest piece
constexpr float   kHandRate = 12.0f;  // 1/s: how fast the hand catches up with where the pointer has it
constexpr float   kHandMost = 10.0f;  // squares/s: the fastest the hand moves
constexpr float   kRingUp   = 0.005f; // squares over the table the ring lies, so its line is over the squares' fills
// the solver's friction and roll, so a piece knocked about slides and rolls
// a little and stops
constexpr float kStatic   = 0.9f;  // static friction
constexpr float kSliding  = 0.75f; // dynamic friction
constexpr float kRollDrag = 5.0f;  // per second, off a touching body's spin
constexpr float kRollStop = 8.0f;  // rad/s a second, off it flat

// --- the classes ----------------------------------------------------------------------
// what a fill or a line is drawn in, each the page's v (chess_colours), and
// a line that is the ink over paper and the paper over anything else
enum { kPaper = 0, kInk = 1, kTone = 2, kHover = 3, kInvert = 4 };
constexpr uint8_t kNone   = 0xFF; // the pick plane where no piece is drawn
constexpr uint8_t kRinged = 0xFE; // and where the ring's line is, so it inverts each pixel once

// an object's colour as the canvas reads it: its fill's class, its lines'
// and which piece it is, -1 for none
uint16_t record(int fill, int line, int piece) { return (uint16_t)(fill | line << 3 | (piece + 1) << 6); }

uint16_t picture_[kMaxW * kMaxH];
uint8_t  pick_[kMaxW * kMaxH];
uint16_t colours_[4] = { 0, 1, 2, 3 }; // each class's v but the ring's

// the canvas the renderer draws into, w x h: a face's fill in its fill's
// class, a line's pixels in its lines' class, and each its piece into the
// pick plane. under the outline look the renderer hands fills as spans and
// lines a pixel at a time, each line pixel only where it is not behind a
// fill, so the pick plane holds the piece drawn there, outline and all
struct Canvas : TD_RenderTarget {
    int      w = 0, h = 0;
    uint16_t fill = 0, line = 1;
    int      lineClass = kInk;
    uint8_t  who       = kNone;
    int16_t  width() override { return (int16_t)w; }
    int16_t  height() override { return (int16_t)h; }
    void     setMaterial(const TD_MaterialCtx& c) override
    {
        fill      = colours_[c.baseColor & 7];
        lineClass = c.baseColor >> 3 & 7;
        line      = colours_[lineClass & 3];
        who       = (uint8_t)((c.baseColor >> 6) - 1);
    }
    void plotShade(int16_t x, int16_t y, float) override
    {
        const int i = y * w + x;
        if (lineClass != kInvert) {
            picture_[i] = line;
            pick_[i]    = who;
            return;
        }
        if (pick_[i] == kRinged) return;
        pick_[i]    = kRinged;
        picture_[i] = picture_[i] == colours_[kPaper] ? colours_[kInk] : colours_[kPaper];
    }
    void plotShadeSpan(int16_t y, int16_t xs, int16_t xe, float, float, float) override
    {
        uint16_t* p = picture_ + y * w;
        uint8_t*  q = pick_ + y * w;
        for (int x = xs; x <= xe; ++x) {
            p[x] = fill;
            q[x] = who;
        }
    }
};

// --- the set -----------------------------------------------------------------------------
// the six kinds of piece, each its mesh, its shape and its body, and the
// back rank from a to h, kinds
struct Kind {
    const TD_Mesh*       mesh;
    const ChessShape*    shape;
    const pb::BodyShape* body;
};
const Kind kKinds[6] = {
    { &pawn_mesh, &pawn_shape, &pawn_body },       { &rook_mesh, &rook_shape, &rook_body },
    { &knight_mesh, &knight_shape, &knight_body }, { &bishop_mesh, &bishop_shape, &bishop_body },
    { &queen_mesh, &queen_shape, &queen_body },    { &king_mesh, &king_shape, &king_body },
};
const int kBack[8] = { 1, 2, 3, 4, 5, 3, 2, 1 };

// the 32 pieces: 0 to 7 white's back rank a to h, 8 to 15 its pawns, 16 to
// 31 black's the same
constexpr int kPieces = 32;
int         kindOf(int i) { return i % 16 < 8 ? kBack[i % 8] : 0; }
bool        blackAt(int i) { return i >= 16; }
const Kind& kind(int i) { return kKinds[kindOf(i)]; }

// everything the picture holds: the board's objects and the ring, the
// pieces', the three scenes (the renderer and the camera are the pieces'
// scene's), and the canvas
struct Set {
    TD_Object  slab, dark, frame, ring;
    TD_Object* piece[kPieces];
    TD_Scene   board, field, pieces;
    Canvas     canvas;
    Set() : slab(slab_mesh), dark(dark_mesh), frame(frame_mesh), ring(ring_mesh)
    {
        for (int i = 0; i < kPieces; ++i) piece[i] = new TD_Object(*kind(i).mesh);
    }
};

Set*       set_   = nullptr;
pb::Bodies bodies_;               // the pieces as the solver has them, in the box's frame
float      start_[kPieces][7];    // each piece's place and turn as it starts, board frame, x y z then w x y z
int        look_  = 1;            // 1 solid, 0 tone
bool       dirty_ = true;         // the picture no longer shows the set as it is
int        w_ = 480, h_ = 360;    // the canvas as asked for
int        pw_ = 0, ph_ = 0;      // and as the planes were last drawn
TD_Camera  seen_;                 // the camera as the picture was last drawn
float round_ = kRoundAt, roundTo_ = kRoundAt; // the camera's turn round the board as drawn, and where it is turned
float over_ = kOverAt, overTo_ = kOverAt;     // and over it
int   held_  = -1;                // the piece held, or -1
int   hover_ = -1;                // the piece the page has under the pointer, or -1
int   lit_   = -1;                // the piece drawn in the hover colour: the one held, else the one hovered
int   awake_ = 0;                 // the bodies awake as of the last step
float hand_[3], goal_[3];         // where the hand is, and where it is going, box frame
float off_[2];                    // the held point from where the pointer's ray met the hand's plane at the take, across and in
float out_[8];                    // what chess_piece, chess_point and chess_meet answer with

// the house approach: current eased toward target at rate a second, the
// classic x += (target - x) * rate made the same at any frame rate
float approach(float current, float target, float rate, float dt)
{
    return current + (target - current) * (1.0f - expf(-rate * dt));
}

// --- posing -------------------------------------------------------------------------------
// the turn of the quaternion q (w, x, y, z) as a matrix m, and the euler
// angles third_dimension turns an object by (R = Rx Ry Rz) that make it,
// read off as physics_box's bodyPose reads them
void eulerOf(const float q[4], float& rx, float& ry, float& rz, float m[9])
{
    const float w = q[0], x = q[1], y = q[2], z = q[3];
    m[0] = 1 - 2 * (y * y + z * z);
    m[1] = 2 * (x * y - w * z);
    m[2] = 2 * (x * z + w * y);
    m[3] = 2 * (x * y + w * z);
    m[4] = 1 - 2 * (x * x + z * z);
    m[5] = 2 * (y * z - w * x);
    m[6] = 2 * (x * z - w * y);
    m[7] = 2 * (y * z + w * x);
    m[8] = 1 - 2 * (x * x + y * y);
    rz             = atan2f(-m[1], m[0]);
    ry             = atan2f(m[2], sqrtf(m[0] * m[0] + m[1] * m[1]));
    const float sz = sinf(rz), cz = cosf(rz);
    rx             = atan2f(m[6] * sz + m[7] * cz, m[3] * sz + m[4] * cz);
}

// piece i with its origin (the middle of its foot) at p, board frame, and
// turned by the quaternion q (w, x, y, z): its object turned by q's turn,
// at its mesh's scale, and placed where the mesh's middle is on the piece
// so turned
void pose(int i, const float p[3], const float q[4])
{
    const ChessShape& s = *kind(i).shape;
    TD_Object&        o = *set_->piece[i];
    float             rx, ry, rz, m[9];
    eulerOf(q, rx, ry, rz, m);
    o.setScale(s.r);
    o.setRotation(rx, ry, rz);
    o.setPosition(p[0] + m[0] * s.cx + m[1] * s.cy + m[2] * s.cz, p[1] + m[3] * s.cx + m[4] * s.cy + m[5] * s.cz,
                  p[2] + m[6] * s.cx + m[7] * s.cy + m[8] * s.cz);
}

// body i's origin, board frame, and its turn
void placeOf(int i, float p[3], float q[4])
{
    bodies_.pose((uint8_t)i, p, q);
    p[0] -= kHalf;
    p[2] -= kHalf;
}

// every piece posed from its body; and the ring, while a piece is held, as
// wide as its base and on the table straight under its foot
void poseAll()
{
    float p[3], q[4];
    for (int i = 0; i < kPieces; ++i) {
        placeOf(i, p, q);
        pose(i, p, q);
    }
    TD_Object& ring = set_->ring;
    ring.setVisible(held_ >= 0);
    if (held_ < 0) return;
    placeOf(held_, p, q);
    ring.setScale(kind(held_).body->rims[0].r);
    ring.setPosition(p[0], kRingUp, p[2]);
}

// every piece where it starts: on its square, white's turned a quarter one
// way about y and black's the other, so each knight looks across the board
void setUp()
{
    for (int i = 0; i < kPieces; ++i) {
        const bool  black = blackAt(i), pawn = i % 16 >= 8;
        const float yaw   = black ? 1.5707963f : -1.5707963f;
        float*      s     = start_[i];
        s[0]              = (float)(i % 8) - 3.5f;
        s[1]              = 0.0f;
        s[2]              = (pawn ? 2.5f : 3.5f) * (black ? 1.0f : -1.0f);
        s[3]              = cosf(0.5f * yaw);
        s[4]              = 0.0f;
        s[5]              = sinf(0.5f * yaw);
        s[6]              = 0.0f;
    }
}

// every body where its piece starts, still and asleep, nothing held
void putBack()
{
    for (int i = 0; i < kPieces; ++i) {
        const float at[3] = { start_[i][0] + kHalf, start_[i][1], start_[i][2] + kHalf };
        bodies_.place((uint8_t)i, at, start_[i] + 3);
    }
    held_  = -1;
    awake_ = 0;
}

// each object's colour in the look: the board and white's pieces paper
// with ink lines, the dark squares ink, black's pieces ink with paper
// lines, or, in the tone look, the tone with ink lines, and the ring's line
// the ink on paper and the paper on ink. the piece lit has the hover colour
// where it would have the ink: a white piece's lines, a black piece's fill
// in the solid look and its lines in the tone look
void dress()
{
    Set& s = *set_;
    s.slab.setColor(record(kPaper, kInk, -1));
    s.dark.setColor(record(kInk, kInk, -1));
    s.frame.setColor(record(kPaper, kInk, -1));
    s.ring.setColor(record(kPaper, kInvert, -1));
    for (int i = 0; i < kPieces; ++i) {
        const int ink = i == lit_ ? kHover : kInk;
        s.piece[i]->setColor(!blackAt(i) ? record(kPaper, ink, i) : look_ ? record(ink, kPaper, i) : record(kTone, ink, i));
    }
}

// the piece lit again, the one held or else the one hovered: dressed and
// drawn again when it is another
void relight()
{
    const int l = held_ >= 0 ? held_ : hover_;
    if (l == lit_ || !set_) return;
    lit_ = l;
    dress();
    dirty_ = true;
}

// --- the camera ----------------------------------------------------------------------------
// the camera orbiting the point over the board's middle, round and over it
void place(TD_Camera& cam, float round, float over)
{
    cam.setTarget(0.0f, kAimY, 0.0f);
    cam.setOrbit(round, over);
    cam.setDistance(kDistance);
}

// where the slab and a king anywhere on it reach as the camera sees them
// at every turn and tilt it can take: each of the slab's corners, and each
// lifted as high as a king stands, as the tangents a focal of 1 and a
// centre at 0 make of it, across and down. all that is the prism over the
// slab's outline as tall as a king, and a king standing on the slab is
// inside it
struct Bounds {
    float x0 = 1e30f, x1 = -1e30f, y0 = 1e30f, y1 = -1e30f;
};
Bounds reach_;

void sweep()
{
    TD_Camera cam;
    cam.setFocalPixels(1.0f);
    cam.setCenterPixels(0.0f, 0.0f);
    const ChessShape& s = slab_shape;
    Bounds            b;
    for (int j = 0; j <= kOverSteps; ++j) {
        const float over = kOverLeast + (kOverMost - kOverLeast) * (float)j / (float)kOverSteps;
        for (int k = 0; k < kRoundSteps; ++k) {
            place(cam, kTwoPi * (float)k / (float)kRoundSteps, over);
            cam.resolve(1, 1, { 0.0f, 0.0f, 0.0f }, 1.0f); // the pose alone
            for (uint16_t i = 0; i < slab_mesh.nverts; ++i) {
                const float* v = slab_mesh.verts[i];
                const float  x = s.cx + s.r * v[0], y = s.cy + s.r * v[1], z = s.cz + s.r * v[2];
                for (int up = 0; up < 2; ++up) {
                    const TD_Vec3 p  = cam.worldToView({ x, up ? king_shape.top : y, z });
                    const float   tx = p.x / p.z, ty = -p.y / p.z;
                    b.x0             = fminf(b.x0, tx);
                    b.x1             = fmaxf(b.x1, tx);
                    b.y0             = fminf(b.y0, ty);
                    b.y1             = fmaxf(b.y1, ty);
                }
            }
        }
    }
    reach_ = b;
}

// the camera fitted to a canvas w x h: its focal the largest that keeps
// all the sweep reached kRoom px in from the canvas's edges, across and
// down, and its centre where the sweep's middle lands on the canvas's
void fit(TD_Camera& cam, int w, int h)
{
    const Bounds& b = reach_;
    const float   f = fminf(((float)w - 2.0f * kRoom) / (b.x1 - b.x0), ((float)h - 2.0f * kRoom) / (b.y1 - b.y0));
    cam.setFocalPixels(f);
    cam.setCenterPixels(0.5f * (float)w - f * 0.5f * (b.x0 + b.x1), 0.5f * (float)h - f * 0.5f * (b.y0 + b.y1));
}

// a board point at canvas px (sx, sy) as the camera last drew it: its view
// x over its depth, times the focal, from the centre across, and its view
// y down
void project(const float p[3], float& sx, float& sy)
{
    const TD_Vec3 v = seen_.worldToView({ p[0], p[1], p[2] });
    sx              = seen_.centerX() + seen_.focalPixels() * v.x / v.z;
    sy              = seen_.centerY() - seen_.focalPixels() * v.y / v.z;
}

// where the ray from the eye through canvas px (sx, sy), as the camera
// last drew it, meets the level plane y = h, board frame: the ray goes
// along the camera's right as far as px across from the centre over the
// focal, its up as far down, and its forward 1. false where it never does
bool meet(float sx, float sy, float h, float at[3])
{
    const float   f = seen_.focalPixels(), u = (sx - seen_.centerX()) / f, v = -(sy - seen_.centerY()) / f;
    const TD_Vec3 r = seen_.right(), up = seen_.up(), fw = seen_.forward(), eye = seen_.eye();
    const TD_Vec3 d = { r.x * u + up.x * v + fw.x, r.y * u + up.y * v + fw.y, r.z * u + up.z * v + fw.z };
    if (!(d.y < 0.0f) || !(eye.y > h)) return false;
    const float t = (h - eye.y) / d.y;
    at[0]         = eye.x + d.x * t;
    at[1]         = h;
    at[2]         = eye.z + d.z * t;
    return true;
}

// --- the hand --------------------------------------------------------------------------------
// where the hand holds piece i, up its axis from its foot's middle
float gripOf(int i) { return kind(i).shape->top - kGrip; }

// where the hand is headed, box frame: (x, z) in the box, kept inside the
// table by the held piece's base, at the height of its plane
void aimAt(float x, float z)
{
    const float r = kind(held_).body->rims[0].r, lo = r, hi = 2.0f * kHalf - r;
    goal_[0]      = x < lo ? lo : x > hi ? hi : x;
    goal_[1]      = gripOf(held_) + kLift;
    goal_[2]      = z < lo ? lo : z > hi ? hi : z;
}

// the hand dt on: eased toward where it is headed, never faster than
// kHandMost, and handed to the solver
void moveHand(float dt)
{
    const float k = 1.0f - expf(-kHandRate * dt);
    float       d[3], n = 0.0f;
    for (int a = 0; a < 3; ++a) {
        d[a] = (goal_[a] - hand_[a]) * k;
        n += d[a] * d[a];
    }
    const float most = kHandMost * dt, s = n > most * most ? most / sqrtf(n) : 1.0f;
    for (int a = 0; a < 3; ++a) hand_[a] += d[a] * s;
    bodies_.holdAt(hand_[0], hand_[1], hand_[2]);
}

// --- the picture -----------------------------------------------------------------------------
// the planes cleared at the canvas's size, the picture to paper and the
// pick plane to none, every piece posed from its body, and the three passes
// drawn into them with the camera where it is drawn, which is kept as the
// camera the picture was seen with
void draw()
{
    Set&       s   = *set_;
    TD_Camera& cam = s.pieces.camera;
    s.canvas.w     = w_;
    s.canvas.h     = h_;
    const int n    = w_ * h_;
    for (int i = 0; i < n; ++i) picture_[i] = colours_[kPaper];
    memset(pick_, kNone, (size_t)n);
    poseAll();
    place(cam, round_, over_);
    TD_Renderer& r = s.pieces.renderer();
    r.renderPass(s.board, cam, s.canvas);
    r.renderPass(s.field, cam, s.canvas);
    r.renderPass(s.pieces, cam, s.canvas);
    seen_ = cam;
    pw_   = w_;
    ph_   = h_;
}

} // namespace

extern "C" {

void chess_step(float dt);

// the set made: the scenes, the outline look, the renderer's buffers
// reserved for the largest pass and every mesh's edge table built, the
// solver's block taken once, gravity, its friction, and a body for each
// piece put where it starts, asleep; the look, the fit's sweep, the camera fitted to the
// canvas, and a first frame. 1 when it is ready, 0 when its memory could
// not be had (nothing else then does anything)
int chess_init()
{
    if (set_) return 1;
    Set* s = new Set();
    s->board.add(s->slab);
    s->field.add(s->dark);
    s->field.add(s->frame);
    s->field.add(s->ring);
    s->frame.setFill(false);
    s->ring.setFill(false);
    for (int i = 0; i < kPieces; ++i) s->pieces.add(*s->piece[i]);
    s->slab.setScale(slab_shape.r);
    s->slab.setPosition(slab_shape.cx, slab_shape.cy, slab_shape.cz);
    s->dark.setScale(dark_shape.r);
    s->dark.setPosition(dark_shape.cx, dark_shape.cy, dark_shape.cz);
    s->frame.setScale(frame_shape.r);
    s->frame.setPosition(frame_shape.cx, frame_shape.cy, frame_shape.cz);
    s->pieces.setRenderMode(TD_OUTLINE);
    TD_Renderer& r  = s->pieces.renderer();
    uint32_t     nv = 0, nf = 0;
    for (int i = 0; i < kPieces; ++i) {
        nv += kind(i).mesh->nverts;
        nf += kind(i).mesh->nfaces;
    }
    if (!r.reserve(nv, nf, kPieces) || !r.prebuildOutline(s->board) || !r.prebuildOutline(s->field) ||
        !r.prebuildOutline(s->pieces))
        return 0;
    pb::BodiesConfig c;
    c.width        = 2.0f * kHalf;
    c.height       = kTall;
    c.depth        = 2.0f * kHalf;
    c.maxBodies    = kPieces;
    c.stepHz       = kStepHz;
    c.substeps     = kSubsteps;
    const size_t n = pb::Bodies::bytesNeeded(c);
    void*        b = n ? malloc(n) : nullptr;
    if (!b || !bodies_.begin(c, b, n)) return 0;
    bodies_.setGravity(0.0f, -kGravity, 0.0f);
    pb::BodiesTuning& t = bodies_.tuning();
    t.grip              = kStatic;
    t.slide             = kSliding;
    t.rollDrag          = kRollDrag;
    t.rollStop          = kRollStop;
    set_ = s;
    setUp();
    for (int i = 0; i < kPieces; ++i) {
        const float at[3] = { start_[i][0] + kHalf, start_[i][1], start_[i][2] + kHalf };
        if (bodies_.add(*kind(i).body, at, start_[i] + 3) < 0) {
            set_ = nullptr;
            return 0;
        }
    }
    putBack();
    dress();
    sweep();
    fit(s->pieces.camera, w_, h_);
    dirty_ = true;
    chess_step(0.0f);
    return 1;
}

// the page's v for each class: paper, ink, the tone and the hover colour
void chess_colours(int paper, int ink, int tone, int hover)
{
    const uint16_t c[4] = { (uint16_t)paper, (uint16_t)ink, (uint16_t)tone, (uint16_t)hover };
    if (!memcmp(c, colours_, sizeof c)) return;
    memcpy(colours_, c, sizeof c);
    dirty_ = true;
}

// the look: 1, solid, black's pieces in ink with paper lines, as it
// starts; 0, the tone look, in the tone with ink lines
void chess_look(int look)
{
    look = look ? 1 : 0;
    if (look == look_ || !set_) {
        look_ = look;
        return;
    }
    look_ = look;
    dress();
    dirty_ = true;
}

// the canvas w x h px, held to kLeast .. kMaxW across and kLeast .. kMaxH
// down, and the camera fitted to it; drawn at that size at the next step
void chess_size(int w, int h)
{
    w = w < kLeast ? kLeast : w > kMaxW ? kMaxW : w;
    h = h < kLeast ? kLeast : h > kMaxH ? kMaxH : h;
    if (w == w_ && h == h_) return;
    w_ = w;
    h_ = h;
    if (!set_) return;
    fit(set_->pieces.camera, w_, h_);
    dirty_ = true;
}

// one frame, dt seconds on (held to 0 .. kMaxDt): the drawn turn eased
// toward where it is turned, and there once within kStill; a lap from 0
// the turn and where it is turned come back a lap together; the hand
// moved; the solver advanced; and the frame drawn, only if the turn moved,
// a body was awake through a step, or anything else has changed since it
// was last drawn
void chess_step(float dt)
{
    if (!set_) return;
    if (!(dt > 0.0f)) dt = 0.0f;
    if (dt > kMaxDt) dt = kMaxDt;
    bool moved = false;
    if (round_ != roundTo_) {
        round_ = approach(round_, roundTo_, kTurnRate, dt);
        if (fabsf(roundTo_ - round_) < kStill) round_ = roundTo_;
        moved = true;
    }
    if (over_ != overTo_) {
        over_ = approach(over_, overTo_, kTurnRate, dt);
        if (fabsf(overTo_ - over_) < kStill) over_ = overTo_;
        moved = true;
    }
    if (round_ > kTwoPi || round_ < -kTwoPi) {
        const float lap = round_ > 0.0f ? kTwoPi : -kTwoPi;
        round_ -= lap;
        roundTo_ -= lap;
    }
    if (held_ >= 0) moveHand(dt);
    const bool was = held_ >= 0 || awake_ > 0;
    if (bodies_.advance(dt) > 0 && (was || bodies_.state().awake > 0)) moved = true;
    awake_ = bodies_.state().awake;
    if (!moved && !dirty_) return;
    draw();
    dirty_ = false;
}

// the picture: w x h v's, row by row, as last drawn
uint16_t* chess_px() { return picture_; }
int       chess_w() { return pw_; }
int       chess_h() { return ph_; }

// the piece whose fill is at canvas px (x, y), as last drawn: 0 .. 31, or
// -1 for none
int chess_at(float x, float y)
{
    if (!(x >= 0.0f && y >= 0.0f && x < (float)pw_ && y < (float)ph_)) return -1;
    const uint8_t who = pick_[(int)y * pw_ + (int)x];
    return who < kPieces ? who : -1;
}

// a press at canvas px (x, y): the piece drawn there taken by the point on
// its axis kGrip under its top. the hand starts where that point is now
// and is headed straight up from it to the hand's plane, and the pointer's
// ray met that plane this far from it. 1 if a piece is now held
int chess_take(float x, float y)
{
    const int i = chess_at(x, y);
    if (i < 0) return 0;
    if (held_ >= 0) bodies_.letGo();
    const float g = gripOf(i);
    bodies_.hold((uint8_t)i, 0.0f, g, 0.0f);
    held_ = i;
    float p[3], q[4], rx, ry, rz, m[9];
    bodies_.pose((uint8_t)i, p, q);
    eulerOf(q, rx, ry, rz, m);
    hand_[0] = p[0] + m[1] * g;
    hand_[1] = p[1] + m[4] * g;
    hand_[2] = p[2] + m[7] * g;
    float at[3];
    const bool met = meet(x, y, g + kLift, at);
    off_[0]        = met ? hand_[0] - (at[0] + kHalf) : 0.0f;
    off_[1]        = met ? hand_[2] - (at[2] + kHalf) : 0.0f;
    aimAt(hand_[0], hand_[2]);
    relight();
    dirty_ = true;
    return 1;
}

// the pointer at canvas px (x, y) while a piece is held: the hand headed
// where its ray meets the hand's plane, as far from it as at the take. a
// ray that never meets it leaves the hand headed where it was
void chess_carry(float x, float y)
{
    float at[3];
    if (held_ < 0 || !meet(x, y, gripOf(held_) + kLift, at)) return;
    aimAt(at[0] + kHalf + off_[0], at[2] + kHalf + off_[1]);
}

// the piece held let go: it falls
void chess_drop()
{
    if (held_ < 0) return;
    bodies_.letGo();
    held_  = -1;
    relight();
    dirty_ = true;
}

// the camera turned round radians further round the board (+ the board's
// near side going right) and over radians further over it (+ the near side
// going down), held to kOverLeast .. kOverMost: where it is turned moves,
// and the drawn turn eases there. a turn that is not a number does nothing
void chess_turn(float round, float over)
{
    if (round == round) roundTo_ += round;
    if (over == over) {
        const float to = overTo_ + over;
        overTo_        = to < kOverLeast ? kOverLeast : to > kOverMost ? kOverMost : to;
    }
}

// every piece where it starts, asleep, nothing held, drawn so at the next
// step; the camera stays
void chess_reset()
{
    if (!set_) return;
    putBack();
    relight();
    dirty_ = true;
}

// the piece the page has under the pointer, 0 .. 31, or -1 for none: lit,
// unless one is held, and drawn so at the next step
void chess_hover(int i)
{
    hover_ = i >= 0 && i < kPieces ? i : -1;
    relight();
}

// 1 while the next step may draw: the drawn turn is not yet where it is
// turned, a piece is held or a body awake, or something has changed since
// the picture was drawn
int chess_stirring()
{
    return set_ && (dirty_ || round_ != roundTo_ || over_ != overTo_ || held_ >= 0 || awake_ > 0) ? 1 : 0;
}

// for the test: piece i's origin, board frame, its turn (w, x, y, z), and
// the height of the plane the hand carries it at
float* chess_piece(int i)
{
    memset(out_, 0, sizeof out_);
    if (!set_ || i < 0 || i >= kPieces) return out_;
    placeOf(i, out_, out_ + 3);
    out_[7] = gripOf(i) + kLift;
    return out_;
}

// for the test: piece i leaned rad about the edge of its foot, toward -x
// (toward +x for less than 0), where it stands, and let go, awake
void chess_tip(int i, float rad)
{
    if (!set_ || i < 0 || i >= kPieces) return;
    float       p[3], q[4];
    const float r = kind(i).body->rims[0].r, s = rad > 0.0f ? -1.0f : 1.0f;
    bodies_.pose((uint8_t)i, p, q);
    const float at[3] = { p[0] + s * r * (1.0f - cosf(rad)), -s * r * sinf(rad), p[2] };
    const float tq[4] = { cosf(0.5f * rad), 0.0f, 0.0f, sinf(0.5f * rad) };
    bodies_.place((uint8_t)i, at, tq);
    bodies_.hold((uint8_t)i, 0.0f, 0.0f, 0.0f);
    bodies_.letGo();
    dirty_ = true;
}

// for the test: the hardest meeting of the last step's advance, squares/s
float chess_hit() { return bodies_.state().hit; }

// for the test: a board point (x, y, z) at canvas px, as last drawn
float* chess_point(float x, float y, float z)
{
    const float p[3] = { x, y, z };
    project(p, out_[0], out_[1]);
    return out_;
}

// for the test: where the ray through canvas px (x, y) meets the plane y =
// h, board frame; not a number where it does not
float* chess_meet(float x, float y, float h)
{
    if (!meet(x, y, h, out_)) out_[0] = out_[1] = out_[2] = NAN;
    return out_;
}

} // extern "C"
