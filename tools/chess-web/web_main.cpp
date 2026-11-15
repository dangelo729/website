// chess on the web: the chess set, headless, compiled with nothing else into
// ../../chess/chess.wasm, which js/chess.js steps a frame at a time on the
// page. a square is 1 unit, y up: the board's top is y = 0 with its middle
// at the origin, white's pieces stand at -z and black's at +z, a1 dark at
// the corner at -x, -z. the meshes are pieces/ (pieces.py): the slab, the
// dark squares, the field's frame, the ring, the tile and the band that
// mark a square, and the six pieces, each a header made by
// third_dimension's obj2mesh, which centres a mesh and scales it to a unit
// radius; shapes.h has what it took away, and each object is put back at
// that scale and place. one renderer and one camera draw four scenes into
// one canvas in third_dimension's outline look, each pass on what the last
// drew: the slab, then the dark squares and the frame, then the marks (the
// tile on the square filled, a band on each square bordered, and the
// ring), then the 32 pieces. its fills are sorted by depth a face at a
// time and only its lines are tested a pixel at a time, so a square drawn
// with the pieces could land over the foot of one standing at its far
// edge, and a band drawn with the dark squares under one of them; each
// drawn in a pass before, it cannot. the board's top is the table the
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
// take; and from there the page can zoom it in (chess_zoom), its focal as
// many times the fitted one, eased the same way, about the board's middle.
//
// the pieces are physics_box's rigid bodies (pb::Bodies), each its shape
// from shapes.h, in a box whose floor is the table the board lies on,
// never drawn: kMid each way from the board's middle, as good as endless,
// the slab a stand on it, its top the board's, kThick up, so a piece
// stands on the board, slides or is knocked off its edge and falls to the
// table, and lies there. each body is a piece, in the pieces'
// order, and each drawn frame each piece is posed from its body. the hand
// holds one piece at a time by the point on its axis kGrip under its top,
// so it hangs upright from there; the hand rides a level plane as high as
// that point stands plus kLift, so a carried piece passes over the others,
// over the place where the pointer's ray from the eye meets the board's
// top, kept as far from it as the held point was at the take, so the piece
// first rises straight up and then goes as far across the board as the
// pointer does, and kept within kHalf of the board's middle by the piece's
// base. the
// hand eases there by the house approach, never faster than kHandMost, so
// the solver never has far to pull it. while a piece is held a ring as wide
// as its base lies on the table under its foot, in a line that is ink on
// paper and paper on ink. the solver's friction is ours (kStatic and on),
// so a piece knocked about slides and rolls a little and stops. the piece
// held, or else the one the page has under the pointer, has the hover
// colour where it would have the ink. every piece has a place, where it
// stands, as it starts the square it starts on, and a piece can be led to
// its place, still meeting the others on its way. a reset leads every piece
// back to where it starts: one off its square is towed there by the point
// the hand would hold it by, a towed body, gravity still on it, so it is
// pulled up by its head, hangs upright under that point and swings as it
// is drawn across over the standing pieces, and is drawn down onto its
// square as it comes over it; once it stands there it is a led body, drawn
// to its pose itself by a spring in gravity's place. one that is knocked
// off its way is towed back onto it; when all that are led are where they
// stand they are put exactly there, asleep. a piece taken on its way is
// the hand's, and the rest go on.
//
// for a game played on it (js/match.js, which knows the rules; the set
// knows none) the page says whose pieces the hand may take (chess_mover),
// and but for anyone's a piece knocked off its place is led back to it.
// it marks the squares the piece held may be put on (chess_mark), each
// bordered in the hover colour, and of those and the square the piece
// stands on the one nearest the pointer, where its ray meets the board's
// top, is filled (chess_near), or the one the page picks in the pointer's
// place (chess_spot); it says whether the pointer has moved since it took
// the piece (chess_aimed) and which square is under a canvas px
// (chess_square). it gives a piece a new place (chess_go): one held is let
// go and drawn down onto it, across and then down faster the nearer it
// is, so it lands as if pulled there; one not held is led there over the
// others. it takes a piece off the board (chess_off): the piece stands
// where it is, a fraction of its weight, until the piece that takes it
// comes down on it, drawn onto its near side first even where it stands
// on another square than the one that piece is given; shoved, it is
// thrown the way it was shoved, far harder than the shove, tumbling, and
// from there it meets no other piece: it flies off the board, lands on
// the table and lies there. a reset leads it back from wherever it lies,
// and so one such piece may be, onto a square (chess_back). and it crowns
// a pawn (chess_crown), a queen's mesh and a queen's body where it is,
// growing from the pawn's height, until a reset or until it is made a
// pawn again. a step draws
// only while something moves: a body awake or held, the camera easing, a
// queen growing, or anything else changed.
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include <TD_Scene.h>
#include <core/pb_bodies.h>

#include "meshes/band.h"
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
#include "meshes/tile.h"
#include "pieces/shapes.h"

namespace {

constexpr float kDeg   = 0.017453292f;
constexpr float kTwoPi = 6.2831853f;

// --- the canvas -----------------------------------------------------------------
// canvas px: at most kMaxW x kMaxH, the planes sized for that and never
// moved; no less than kLeast either way
constexpr int kMaxW  = 1280;
constexpr int kMaxH  = 720;
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
constexpr float kZoomMost  = 3.0f;         // times its fitted focal, the most the camera is zoomed in
constexpr float kZoomStill = 1e-3f;        // a drawn zoom this near where it is zoomed is there
// the fit keeps the slab, and a king anywhere on it, kRoom px in from every
// edge of the canvas, sweeping kRoundSteps turns round a lap at each of
// kOverSteps + 1 tilts from the least to the most
constexpr float kRoom       = 3.0f;
constexpr int   kRoundSteps = 90;
constexpr int   kOverSteps  = 26;

// --- the table and the hand -----------------------------------------------------------
constexpr float   kMid      = 32.0f;  // squares from each of the box's walls to its middle, where the board's is: the table, as good as endless
constexpr float   kSlab     = 4.4f;   // squares from the board's middle to the slab's sides (pieces.py),
constexpr float   kSlabR    = 0.25f;  //   its corners' radius,
constexpr float   kThick    = 0.35f;  //   and how thick it is: the board's top over the table
constexpr float   kHalf     = 5.4f;   // squares the hand reaches from the board's middle each way: a square past the slab
constexpr float   kTall     = 12.0f;  // squares to the box's ceiling, out of reach
constexpr float   kGravity  = 105.0f; // squares/s², some three fifths of life size: a fall that lands
constexpr float   kStepHz   = 60.0f;  // the solver's fixed steps a second
constexpr uint8_t kSubsteps = 10;     // and the substeps each is cut into
constexpr float   kGrip     = 0.1f;   // squares under a piece's top, on its axis, where the hand holds it
constexpr float   kLift     = 1.7f;   // squares a held piece is carried up: its foot clear of the tallest piece
constexpr float   kHandRate = 12.0f;  // 1/s: how fast the hand catches up with where the pointer has it
constexpr float   kHandMost = 10.0f;  // squares/s: the fastest the hand moves
constexpr float   kRingUp   = 0.005f; // squares over the table the ring lies, so its line is over the squares' fills
constexpr float   kSlop     = 5.0f;   // canvas px the pointer goes from where it took a piece before it picks the square filled
// a piece led to its place over the others: a reset, and when it is over
constexpr float kOver      = 0.25f;      // squares: a piece let go this near over its square is led down onto it
constexpr float kLow       = 0.9f;       // squares: one whose foot is under this is drawn the least of the way across,
constexpr float kHigh      = 1.45f;      //   and from this high all of it
constexpr float kSlow      = 0.35f;      // of the way across, that least
constexpr float kVeer      = 0.5f;       // squares to the right of its square it is drawn across toward, at most
constexpr float kAhead     = 2.0f;       // squares across, at most, the point it is towed by is drawn ahead of where it is
constexpr float kTowRate   = 16.0f;      // 1/s: how fast that point closes on where it is drawn,
constexpr float kTowMost   = 24.0f;      //   squares/s, its speed at most,
constexpr float kTowSwing  = 14.0f;      //   and 1/s, the drag on the piece's swing under it
constexpr float kSwung     = 0.3f;       // squares further from over its place its foot may be than that point, swinging, and count as near
constexpr float kUpright   = 0.97f;      // the cosine of 14 degrees: a piece leaning no more, on its square, is led to its pose itself
constexpr float kNear      = 0.01f;      // squares (a led piece standing on the board comes no nearer than 0.005 each way, across and in, this far from the box's corner, where a float is 4e-6 apart), and
constexpr float kTurned    = 0.9999875f; // the cosine of half of 0.01 rad: a piece this near how it starts is there
constexpr float kResetMost = 6.0f;       // s pieces are led at most, from when the last of them began
// a piece let go onto a square (chess_go): drawn across to it and down onto it
constexpr float kPull   = 0.6f;  // squares: one this near over its place is drawn down as well as across,
constexpr float kPullIn = 0.15f; //   and all the way down from this near
constexpr float kUnder  = 1.0f;  // squares under the table it is drawn down toward, so it lands still drawn
constexpr float kTouch  = 0.03f; // squares: with its foot this near the table it is led to its place itself
// a piece taken off the board (chess_off)
constexpr float kLight     = 0.03f;  // times its mass it weighs, so what comes down on it shoves it aside at once
constexpr float kShort     = 0.18f;  // squares short of over it, on the side it comes from, the piece that takes it is drawn down, so it lands on its near side
constexpr float kShoved    = 0.03f;  // squares its top has been shoved, across, when it is thrown
constexpr float kHit       = 0.4f;   // squares over its top the foot of the piece that takes it is at most when that piece is on it,
constexpr float kReach     = 0.8f;   //   if it is this near it, across,
constexpr int   kWait      = 6;      //   and the steps that piece may be on it, not shoving it, before it is thrown anyway
constexpr float kFling     = 30.0f;  // squares/s it is thrown, across, some more or less,
constexpr float kFlingUp   = 13.0f;  //   and up,
constexpr float kFlingSide = 0.25f;  // radians either side of the way it is thrown it may go,
constexpr float kFlingOut  = 0.6f;   // of the way it is thrown when nothing shoved it, how much is out from the board's middle,
constexpr float kTumble    = 28.0f;  // rad/s it tumbles end over end, some more or less,
constexpr float kTwirl     = 14.0f;  //   and about its own axis either way, at most
constexpr float kOffAgain  = 0.4f;   // of all that, how hard one that comes to rest over the board is thrown again
// a pawn crowned
constexpr float kGrow  = 18.0f; // 1/s: how fast the queen it becomes is drawn up to her size
constexpr float kSized = 0.02f; // of her size: drawn this near it she is drawn at it
// the marks (chess_mark)
constexpr int kMarks = 27; // the most squares one piece can go to
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
enum { kPawn = 0, kQueen = 4 };
const int kBack[8] = { 1, 2, 3, 4, 5, 3, 2, 1 };

// the 32 pieces: 0 to 7 white's back rank a to h, 8 to 15 its pawns, 16 to
// 31 black's the same; the kind each starts as, and the kind it is now (a
// pawn crowned is a queen until a reset)
constexpr int kPieces = 32;
int         kind_[kPieces];
int         kindOf(int i) { return i % 16 < 8 ? kBack[i % 8] : kPawn; }
bool        blackAt(int i) { return i >= 16; }
const Kind& kind(int i) { return kKinds[kind_[i]]; }

// the squares, a1 0, b1 1 and on to h8 63: a square's middle, board frame,
// and the square a board point is over
float squareX(int sq) { return (float)(sq % 8) - 3.5f; }
float squareZ(int sq) { return (float)(sq / 8) - 3.5f; }
int   squareAt(float x, float z)
{
    const int f = (int)floorf(x + 4.0f), r = (int)floorf(z + 4.0f);
    return (f < 0 ? 0 : f > 7 ? 7 : f) + 8 * (r < 0 ? 0 : r > 7 ? 7 : r);
}

// everything the picture holds: the board's objects, the ring, the square
// filled (spot) and the squares bordered (mark), the pieces', the four
// scenes (the renderer and the camera are the pieces' scene's), and the
// canvas
struct Set {
    TD_Object  slab, dark, frame, ring, spot;
    TD_Object* mark[kMarks];
    TD_Object* piece[kPieces];
    TD_Scene   board, field, marks, pieces;
    Canvas     canvas;
    Set() : slab(slab_mesh), dark(dark_mesh), frame(frame_mesh), ring(ring_mesh), spot(tile_mesh)
    {
        for (int k = 0; k < kMarks; ++k) mark[k] = new TD_Object(band_mesh);
        for (int i = 0; i < kPieces; ++i) piece[i] = new TD_Object(*kKinds[kindOf(i)].mesh);
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
float zoom_ = 1.0f, zoomTo_ = 1.0f;           // its zoom as drawn, times its fitted focal, and where it is zoomed
int   held_  = -1;                // the piece held, or -1
int   hover_ = -1;                // the piece the page has under the pointer, or -1
int   lit_   = -1;                // the piece drawn in the hover colour: the one held, else the one hovered
int   awake_ = 0;                 // the bodies awake as of the last step
float hand_[3], goal_[3];         // where the hand is, and where it is going, box frame
float off_[2];                    // the held point from where the pointer's ray met the board's top at the take, across and in
float press_[2];                  // the canvas px the pointer took the held piece at
float cursor_[2];                 // where the pointer's ray last met the board's top, x and z, board frame
bool  aimed_ = false;             // the pointer has gone kSlop from where it took the piece: it picks the square filled
int   spot_  = -1;                // the square the page has picked to be filled while the piece is held (chess_spot), or -1
float out_[8];                    // what chess_piece, chess_point and chess_meet answer with
float   to_[kPieces][7];        // each piece's place, where it stands: board frame, x y z then its turn, w x y z
bool    led_[kPieces];          // the pieces being led to their places
uint8_t how_[kPieces];          // and how each is: kHome over the others, kDrop drawn down onto it
int     leading_ = 0;           // how many it is
float   since_   = 0.0f;        // s since the last of them began
// where a piece is in being taken off the board: on it; taken, standing
// where it was, light, until the piece that takes it shoves it; and flung,
// thrown off it, a body alone that lands on the table and lies there
enum { kOn = 0, kDoomed, kFlung };
uint8_t state_[kPieces];
int     by_[kPieces];           // one taken: the piece that takes it, or -1,
float   stood_[kPieces][2];     //   where its top stood as it was taken, x and z,
uint8_t wait_[kPieces];         //   the steps the piece that takes it has been on it, not shoving it,
bool    risen_[kPieces];        //   and whether that piece has been off the table since
float   from_[kPieces][2];      // where each piece stood before it was last given a place, x and z
bool    struck_[kPieces];       // the pieces led that have struck one they take, and go on to their places from there
uint32_t dice_ = 1;             // what chance() is rolled from
float   size_[kPieces];         // how big each is drawn, of its size: 1, or less while a queen just crowned grows
int     mover_ = -1;            // whose pieces the hand may take: -1 anyone's, 0 white's, 1 black's, 2 no one's
bool    out(int i) { return state_[i] != kOn; } // whether piece i is off the board
int     marks_[kMarks];         // the squares outlined
int     nmarks_ = 0;            // how many
int     near_   = -1;           // the square filled, or -1
enum { kHome = 0, kDrop = 1 };

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
// turned by the quaternion q (w, x, y, z), k of its size: its object turned
// by q's turn, at its mesh's scale times k, and placed where the mesh's
// middle is on the piece so turned, so it is small about its foot
void pose(int i, const float p[3], const float q[4], float k)
{
    const ChessShape& s = *kind(i).shape;
    TD_Object&        o = *set_->piece[i];
    float             rx, ry, rz, m[9];
    eulerOf(q, rx, ry, rz, m);
    const float cx = k * s.cx, cy = k * s.cy, cz = k * s.cz;
    o.setScale(k * s.r);
    o.setRotation(rx, ry, rz);
    o.setPosition(p[0] + m[0] * cx + m[1] * cy + m[2] * cz, p[1] + m[3] * cx + m[4] * cy + m[5] * cz,
                  p[2] + m[6] * cx + m[7] * cy + m[8] * cz);
}

// a board point as the box has it: the board's middle the box's, its top
// kThick over the floor
struct Boxed {
    float at[3];
    Boxed(float x, float y, float z) : at{ x + kMid, y + kThick, z + kMid } {}
    explicit Boxed(const float p[3]) : Boxed(p[0], p[1], p[2]) {}
};

// body i's origin, board frame, and its turn
void placeOf(int i, float p[3], float q[4])
{
    bodies_.pose((uint8_t)i, p, q);
    p[0] -= kMid;
    p[1] -= kThick;
    p[2] -= kMid;
}

// every piece posed from its body at the size it is drawn; a band on each
// square marked and the tile on the one filled; and the ring, while a piece
// is held, as wide as its base and straight under its foot, on the board's
// top or, past the slab, on the table
void poseAll()
{
    float p[3], q[4];
    for (int i = 0; i < kPieces; ++i) {
        placeOf(i, p, q);
        pose(i, p, q, size_[i]);
    }
    for (int k = 0; k < kMarks; ++k) {
        TD_Object& o = *set_->mark[k];
        o.setVisible(k < nmarks_);
        if (k < nmarks_) o.setPosition(squareX(marks_[k]), 0.0f, squareZ(marks_[k]));
    }
    set_->spot.setVisible(near_ >= 0);
    if (near_ >= 0) set_->spot.setPosition(squareX(near_), 0.0f, squareZ(near_));
    TD_Object& ring = set_->ring;
    ring.setVisible(held_ >= 0);
    if (held_ < 0) return;
    placeOf(held_, p, q);
    ring.setScale(kind(held_).body->rims[0].r);
    ring.setPosition(p[0], kRingUp - (fabsf(p[0]) > kSlab || fabsf(p[2]) > kSlab ? kThick : 0.0f), p[2]);
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

// every piece standing where it starts and every body there, still and
// asleep: nothing held, led or taken off the board
void putBack()
{
    for (int i = 0; i < kPieces; ++i) {
        memcpy(to_[i], start_[i], sizeof to_[i]);
        bodies_.place((uint8_t)i, Boxed(to_[i]).at, to_[i] + 3);
        bodies_.alone((uint8_t)i, false);
        bodies_.weigh((uint8_t)i, 1.0f);
        led_[i]   = false;
        state_[i] = kOn;
        size_[i]  = 1.0f;
    }
    leading_ = 0;
    held_    = -1;
    awake_   = 0;
}

// piece i's object the mesh of kind k, the pieces in the scene in their
// order as before
void wear(int i, int k)
{
    Set& s = *set_;
    for (int j = 0; j < kPieces; ++j) s.pieces.remove(*s.piece[j]);
    delete s.piece[i];
    kind_[i]   = k;
    s.piece[i] = new TD_Object(*kKinds[k].mesh);
    for (int j = 0; j < kPieces; ++j) s.pieces.add(*s.piece[j]);
}

// the solver's bodies made again, each the shape of its piece's kind now,
// where it was and still: asleep if it was, light if its piece is off the
// board and alone if it is flung, and the piece held held again
void rebody()
{
    float p[kPieces][3], q[kPieces][4];
    bool  asleep[kPieces];
    for (int i = 0; i < kPieces; ++i) {
        bodies_.pose((uint8_t)i, p[i], q[i]);
        asleep[i] = bodies_.asleep((uint8_t)i);
    }
    bodies_.clear();
    for (int i = 0; i < kPieces; ++i) {
        bodies_.add(*kind(i).body, p[i], q[i]);
        if (asleep[i]) bodies_.place((uint8_t)i, p[i], q[i]);
        bodies_.alone((uint8_t)i, state_[i] == kFlung);
        bodies_.weigh((uint8_t)i, out(i) ? kLight : 1.0f);
    }
    if (held_ < 0) return;
    bodies_.hold((uint8_t)held_, 0.0f, kind(held_).shape->top - kGrip, 0.0f);
    bodies_.holdAt(hand_[0], hand_[1], hand_[2]);
}

// where the hand holds piece i, up its axis from its foot's middle
float gripOf(int i) { return kind(i).shape->top - kGrip; }

// piece i led to its place from the next step, how: kHome, towed there
// over the others, or kDrop, drawn down onto it
void leadTo(int i, int how)
{
    how_[i]    = (uint8_t)how;
    struck_[i] = false;
    since_     = 0.0f;
    if (led_[i]) return;
    led_[i] = true;
    ++leading_;
}

// piece i led no more
void unlead(int i)
{
    if (!led_[i]) return;
    led_[i] = false;
    --leading_;
}

// whether piece i is where it stands: within kNear of its place and kTurned
// of its turn
bool there(int i)
{
    const float* s = to_[i];
    float        p[3], q[4];
    placeOf(i, p, q);
    const float dx = s[0] - p[0], dy = s[1] - p[1], dz = s[2] - p[2];
    const float turned = q[0] * s[3] + q[1] * s[4] + q[2] * s[5] + q[3] * s[6];
    return dx * dx + dy * dy + dz * dz <= kNear * kNear && fabsf(turned) >= kTurned;
}

// piece i, led home (kHome), a step on. standing on its place, its foot
// within kPullIn of it across and kTouch of the board and leaning no more
// than kUpright, it is led to its pose there itself. else it is towed by
// the point the hand would hold it by, on its axis kGrip under its top,
// its turn about its axis drawn to the one it stands with: that point is
// drawn across toward over its place, no more than kAhead ahead of where
// it is, and toward a point to the right of the place as it comes, kVeer
// of the way it has left to go and no more than kVeer, so two that meet
// head on each pass on the other's left; and up to where the piece hangs
// from it with its foot kLift over the board, clear of the pieces standing
// (as far over that as the spring that draws it gives under the piece's
// weight). while its foot is under kLow it is drawn only kSlow of the way
// across, more the higher it is and all of it from kHigh. once that point
// is within kPull of over its place, and its foot, swinging under it,
// within kSwung more, it is drawn down as well, more the nearer the
// further of them is and all the way from kPullIn, toward where it stands
// with its foot kUnder below the table, so it lands still drawn down, and
// is drawn all the way across, straight
void towOn(int i)
{
    const float* s = to_[i];
    float        p[3], q[4], rx, ry, rz, m[9];
    placeOf(i, p, q);
    eulerOf(q, rx, ry, rz, m);
    const float fx = s[0] - p[0], fz = s[2] - p[2], foot = sqrtf(fx * fx + fz * fz);
    if (foot <= kPullIn && fabsf(p[1] - s[1]) <= kTouch && m[4] >= kUpright) {
        bodies_.lead((uint8_t)i, Boxed(s).at, s + 3);
        return;
    }
    const float g  = gripOf(i), px = p[0] + m[1] * g, pz = p[2] + m[7] * g;
    const float dx = s[0] - px, dz = s[2] - pz, far = sqrtf(dx * dx + dz * dz);
    const float off  = foot - kSwung > far ? foot - kSwung : far;
    const float w    = off <= kPullIn ? 0.0f : off >= kPull ? 1.0f : (off - kPullIn) / (kPull - kPullIn);
    const float veer = far > 1e-6f ? w * kVeer * (far < 1.0f ? far : 1.0f) / far : 0.0f;
    const float ax = dx - dz * veer, az = dz + dx * veer, n = sqrtf(ax * ax + az * az);
    const float up = p[1] < kLow ? kSlow : p[1] > kHigh ? 1.0f : kSlow + (1.0f - kSlow) * (p[1] - kLow) / (kHigh - kLow);
    const float by = (1.0f - w * (1.0f - up)) * (n > kAhead ? kAhead / n : 1.0f);
    const float y  = w * (kLift + kGravity / (kTowRate * kTowRate)) - (1.0f - w) * kUnder;
    bodies_.tow((uint8_t)i, 0.0f, g, 0.0f, Boxed(px + ax * by, s[1] + y + g, pz + az * by).at, s + 3);
}

// the pieces being led, dt on: each led toward its place, turned as it
// stands there all the way. one led home (kHome) is towed there (towOn).
// one let go onto its place (kDrop) is led up to kLift and across to over
// it, straight up while its foot is under kLow and from there more of the
// way across the higher it is, all of it from kHigh, and within kOver of
// over it down onto it; within kPull of over it, it is drawn down as well
// as across, more of the way the nearer it is and all of it from kPullIn,
// toward kUnder below the table, so it lands still drawn down; with its
// foot within kTouch of the table it is led to its place itself. while a
// piece it takes still stands, it is drawn so onto that piece, wherever it
// is, kShort short of over it on the side it came from, so it lands on
// that piece's near side and shoves it on; once that piece is thrown
// (strike) it goes straight on to its own place, across at the height it
// is at and down. once every one is where it stands (there), or kResetMost
// after the last began, each is put exactly there, asleep, and none is led
void leadOn(float dt)
{
    since_ += dt;
    bool all = true;
    for (int i = 0; i < kPieces; ++i) {
        if (!led_[i]) continue;
        if (how_[i] == kHome) {
            towOn(i);
            if (!there(i)) all = false;
            continue;
        }
        const float* s = to_[i];
        float        p[3], q[4], on[3], qv[4];
        placeOf(i, p, q);
        const float* aim = s; // where it is drawn: its place, or the piece it takes
        for (int v = 0; v < kPieces; ++v)
            if (state_[v] == kDoomed && by_[v] == i) {
                placeOf(v, on, qv);
                const float ax = on[0] - from_[i][0], az = on[2] - from_[i][1], n = sqrtf(ax * ax + az * az);
                if (n > 1e-3f) {
                    on[0] -= kShort * ax / n;
                    on[2] -= kShort * az / n;
                }
                aim = on;
            }
        const float dx = aim[0] - p[0], dz = aim[2] - p[2];
        float       to[3] = { aim[0], s[1], aim[2] }; // board frame
        const float far = sqrtf(dx * dx + dz * dz);
        if (far <= kPull || struck_[i]) {
            const float w = far <= kPullIn ? 0.0f : far >= kPull ? 1.0f : (far - kPullIn) / (kPull - kPullIn);
            if (p[1] > kTouch) to[1] = w * p[1] - (1.0f - w) * kUnder;
        } else if (far > kOver) {
            const float up = p[1] < kLow ? 0.0f : p[1] > kHigh ? 1.0f : (p[1] - kLow) / (kHigh - kLow);
            to[0]          = p[0] + dx * up;
            to[1]          = kLift;
            to[2]          = p[2] + dz * up;
        }
        bodies_.lead((uint8_t)i, Boxed(to).at, s + 3);
        if (!there(i)) all = false;
    }
    if (!all && since_ < kResetMost) return;
    for (int i = 0; i < kPieces; ++i) {
        if (!led_[i]) continue;
        bodies_.place((uint8_t)i, Boxed(to_[i]).at, to_[i] + 3);
        led_[i] = false;
    }
    leading_ = 0;
    dirty_   = true;
}

// while a side is to move, or no one is: every piece on the board that is
// awake, not held, and not where it stands, led home; and one that has
// come to rest where it stands, but not exactly, put exactly there
void guard()
{
    for (int i = 0; i < kPieces; ++i) {
        if (out(i) || led_[i] || i == held_) continue;
        if (!bodies_.asleep((uint8_t)i)) {
            if (!there(i)) leadTo(i, kHome);
            continue;
        }
        float p[3], q[4];
        placeOf(i, p, q);
        if (!there(i) || (!memcmp(p, to_[i], sizeof p) && !memcmp(q, to_[i] + 3, sizeof q))) continue;
        bodies_.place((uint8_t)i, Boxed(to_[i]).at, to_[i] + 3);
        dirty_ = true;
    }
}

// each piece's size dt on toward all of it, by the house approach, and
// there once within kSized: whether any moved
bool resize(float dt)
{
    bool moved = false;
    for (int i = 0; i < kPieces; ++i) {
        if (size_[i] == 1.0f) continue;
        size_[i] = approach(size_[i], 1.0f, kGrow, dt);
        if (1.0f - size_[i] < kSized) size_[i] = 1.0f;
        moved = true;
    }
    return moved;
}

// a number from 0 up to 1, the next of a run that is the same every time
float chance()
{
    dice_ = dice_ * 1664525u + 1013904223u;
    return (float)(dice_ >> 8) / 16777216.0f;
}

// piece v thrown, hard times as hard as a piece taken is: the way (dx, dz)
// across, turned up to kFlingSide either way, at kFling, and up at
// kFlingUp, each some more or less, tumbling end over end the way it goes
// and twirling
void toss(int v, float dx, float dz, float hard)
{
    const float n = sqrtf(dx * dx + dz * dz), a = (2.0f * chance() - 1.0f) * kFlingSide, ca = cosf(a), sa = sinf(a);
    const float hx = n > 1e-3f ? (dx * ca - dz * sa) / n : ca, hz = n > 1e-3f ? (dx * sa + dz * ca) / n : sa;
    const float go = hard * kFling * (0.85f + 0.3f * chance()), spin = hard * kTumble * (0.7f + 0.6f * chance());
    const float u[3] = { hx * go, hard * kFlingUp * (0.8f + 0.4f * chance()), hz * go };
    const float w[3] = { hz * spin, hard * (2.0f * chance() - 1.0f) * kTwirl, -hx * spin };
    bodies_.toss((uint8_t)v, u, w);
}

// where piece i's top is, across: x and z, board frame
void topOf(int i, float at[2])
{
    float p[3], q[4], rx, ry, rz, m[9];
    placeOf(i, p, q);
    eulerOf(q, rx, ry, rz, m);
    const float h = kind(i).shape->top;
    at[0]         = p[0] + m[1] * h;
    at[1]         = p[2] + m[7] * h;
}

// piece v, taken, thrown off the board the way (dx, dz) across: alone from
// here, meeting no other piece; and the piece that took it has struck
void fling(int v, float dx, float dz)
{
    bodies_.alone((uint8_t)v, true);
    toss(v, dx, dz, 1.0f);
    state_[v] = kFlung;
    if (by_[v] >= 0) struck_[by_[v]] = true;
    dirty_ = true;
}

// the pieces taken and still standing. one whose top has been shoved
// kShoved across from where it stood, by the piece that takes it coming
// down on it, is thrown the way it was shoved (fling). one that piece has
// been on for kWait steps without shoving it, its foot within kHit of its
// top and within kReach of it across, or that it has left the table and
// landed beside, or that it is neither holding nor led to, or that no
// piece takes, is
// thrown the way that piece came at it and, kFlingOut as much, out from
// the board's middle. while that piece is held it stands. and a piece
// flung that has come to rest over the slab is thrown again, out from the
// board's middle, kOffAgain as hard
void strike()
{
    float p[3], q[4], on[3], qv[4], top[2];
    for (int v = 0; v < kPieces; ++v) {
        if (state_[v] == kFlung) {
            if (!bodies_.asleep((uint8_t)v)) continue;
            placeOf(v, on, qv);
            if (fabsf(on[0]) < kSlab && fabsf(on[2]) < kSlab) toss(v, on[0], on[2], kOffAgain);
            continue;
        }
        if (state_[v] != kDoomed) continue;
        const int c = by_[v];
        if (c >= 0 && c == held_) continue;
        topOf(v, top);
        const float sx = top[0] - stood_[v][0], sz = top[1] - stood_[v][1];
        if (sx * sx + sz * sz > kShoved * kShoved) {
            fling(v, sx, sz);
            continue;
        }
        placeOf(v, on, qv);
        if (c >= 0 && led_[c]) {
            placeOf(c, p, q);
            const float dx = p[0] - on[0], dz = p[2] - on[2];
            const bool  onIt = dx * dx + dz * dz < kReach * kReach && p[1] <= on[1] + kind(v).shape->top + kHit;
            if (p[1] > kTouch) risen_[v] = true;
            if (onIt ? ++wait_[v] <= kWait : p[1] > kTouch || !risen_[v]) continue;
        }
        float dx = c >= 0 ? on[0] - from_[c][0] : 0.0f, dz = c >= 0 ? on[2] - from_[c][1] : 0.0f;
        const float n = sqrtf(dx * dx + dz * dz), far = sqrtf(on[0] * on[0] + on[2] * on[2]);
        if (n > 1e-3f) {
            dx /= n;
            dz /= n;
        }
        if (far > 0.5f) {
            dx += kFlingOut * on[0] / far;
            dz += kFlingOut * on[2] / far;
        }
        fling(v, dx, dz);
    }
}

// whether the hand may take piece i: one on the board, of the side whose
// pieces it may take
bool free(int i) { return !out(i) && (mover_ < 0 || mover_ == (blackAt(i) ? 1 : 0)); }

// the square filled: while a side to move holds a piece, the one the page
// has picked (chess_spot), or with none picked the one the piece stands
// on, until the pointer has gone kSlop from where it took it, and from
// then the nearest to where the pointer's ray meets the board's top of the
// squares marked and that one; else none, and none picked
void nearest()
{
    int n = -1;
    if (held_ < 0) spot_ = -1;
    if (spot_ >= 0 && (mover_ == 0 || mover_ == 1)) {
        n = spot_;
    } else if (held_ >= 0 && (mover_ == 0 || mover_ == 1)) {
        const auto apart = [&](int sq) {
            const float dx = squareX(sq) - cursor_[0], dz = squareZ(sq) - cursor_[1];
            return dx * dx + dz * dz;
        };
        n          = squareAt(to_[held_][0], to_[held_][2]);
        float best = apart(n);
        for (int k = 0; aimed_ && k < nmarks_; ++k) {
            const float d = apart(marks_[k]);
            if (d < best) {
                best = d;
                n    = marks_[k];
            }
        }
    }
    if (n == near_) return;
    near_  = n;
    dirty_ = true;
}

// each object's colour in the look: the board and white's pieces paper
// with ink lines, the dark squares ink, black's pieces ink with paper
// lines, or, in the tone look, the tone with ink lines, the ring's line
// the ink on paper and the paper on ink, and the tile and the bands the
// hover colour. the piece lit has the hover colour
// where it would have the ink: a white piece's lines, a black piece's fill
// in the solid look and its lines in the tone look
void dress()
{
    Set& s = *set_;
    s.slab.setColor(record(kPaper, kInk, -1));
    s.dark.setColor(record(kInk, kInk, -1));
    s.frame.setColor(record(kPaper, kInk, -1));
    s.ring.setColor(record(kPaper, kInvert, -1));
    s.spot.setColor(record(kHover, kHover, -1));
    for (int k = 0; k < kMarks; ++k) s.mark[k]->setColor(record(kHover, kHover, -1));
    for (int i = 0; i < kPieces; ++i) {
        const int ink = i == lit_ ? kHover : kInk;
        s.piece[i]->setColor(!blackAt(i) ? record(kPaper, ink, i) : look_ ? record(ink, kPaper, i) : record(kTone, ink, i));
    }
}

// the piece lit again, the one held or else the one hovered, if the hand
// may take it: dressed and drawn again when it is another
void relight()
{
    const int l = held_ >= 0 ? held_ : hover_ >= 0 && free(hover_) ? hover_ : -1;
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
// down, and its centre where the sweep's middle lands on the canvas's;
// then zoomed, its focal that many times the fitted one, its centre left
// where it is, so the point it orbits stays where it is on the canvas
void fit(TD_Camera& cam, int w, int h)
{
    const Bounds& b = reach_;
    const float   f = fminf(((float)w - 2.0f * kRoom) / (b.x1 - b.x0), ((float)h - 2.0f * kRoom) / (b.y1 - b.y0));
    cam.setFocalPixels(f * zoom_);
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
// where the hand is headed, box frame: (x, z) in the box, the held piece's
// base kept within kHalf of the board's middle each way, at the height of
// its plane
void aimAt(float x, float z)
{
    const float r = kind(held_).body->rims[0].r, lo = kMid - kHalf + r, hi = kMid + kHalf - r;
    goal_[0]      = x < lo ? lo : x > hi ? hi : x;
    goal_[1]      = gripOf(held_) + kLift + kThick;
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
// pick plane to none, every piece posed from its body, and the passes
// drawn into them, the marks' only while there is one to draw, with the
// camera where it is drawn, which is kept as the camera the picture was
// seen with
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
    if (held_ >= 0 || nmarks_ > 0 || near_ >= 0) r.renderPass(s.marks, cam, s.canvas);
    r.renderPass(s.pieces, cam, s.canvas);
    seen_ = cam;
    pw_   = w_;
    ph_   = h_;
}

} // namespace

extern "C" {

void chess_step(float dt);

// the set made: the scenes, the outline look, the renderer's buffers
// reserved for the largest pass, every pawn a queen, and every mesh's edge table built, the
// solver's block taken once, gravity, its friction, and a body for each
// piece put where it starts, asleep; the look, the fit's sweep, the camera fitted to the
// canvas, and a first frame. 1 when it is ready, 0 when its memory could
// not be had (nothing else then does anything)
int chess_init()
{
    if (set_) return 1;
    for (int i = 0; i < kPieces; ++i) kind_[i] = kindOf(i);
    Set* s = new Set();
    s->board.add(s->slab);
    s->field.add(s->dark);
    s->field.add(s->frame);
    s->marks.add(s->spot);
    for (int k = 0; k < kMarks; ++k) {
        s->marks.add(*s->mark[k]);
        s->mark[k]->setScale(band_shape.r);
    }
    s->marks.add(s->ring);
    s->frame.setFill(false);
    s->ring.setFill(false);
    s->spot.setScale(tile_shape.r);
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
        const TD_Mesh &m = *kind(i).mesh, &c = kind_[i] == kPawn ? queen_mesh : m; // a pawn may be crowned
        nv += m.nverts > c.nverts ? m.nverts : c.nverts;
        nf += m.nfaces > c.nfaces ? m.nfaces : c.nfaces;
    }
    if (!r.reserve(nv, nf, kPieces) || !r.prebuildOutline(s->board) || !r.prebuildOutline(s->field) ||
        !r.prebuildOutline(s->marks) || !r.prebuildOutline(s->pieces))
        return 0;
    pb::BodiesConfig c;
    c.width        = 2.0f * kMid;
    c.height       = kTall;
    c.depth        = 2.0f * kMid;
    c.standX0 = c.standZ0 = kMid - kSlab;
    c.standX1 = c.standZ1 = kMid + kSlab;
    c.standRound          = kSlabR;
    c.standHeight         = kThick;
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
    t.towRate           = kTowRate;
    t.towMost           = kTowMost;
    t.towSwing          = kTowSwing;
    set_ = s;
    setUp();
    for (int i = 0; i < kPieces; ++i) {
        if (bodies_.add(*kind(i).body, Boxed(start_[i]).at, start_[i] + 3) < 0) {
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
// the turn and where it is turned come back a lap together; the drawn
// zoom eased the same way toward where it is zoomed, there once within
// kZoomStill; the hand moved; while a side is to move or no one is, the pieces knocked off
// their places led home (guard); the pieces taken struck off the board
// as what takes them comes down on them (strike); the pieces led, led on;
// the solver advanced; the pieces' sizes eased; the square nearest the
// piece held found; and the frame drawn, only if the turn or the zoom
// moved, a body was awake through a step, a piece's size moved, or
// anything else has changed since it was last drawn
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
    if (zoom_ != zoomTo_) {
        zoom_ = approach(zoom_, zoomTo_, kTurnRate, dt);
        if (fabsf(zoomTo_ - zoom_) < kZoomStill) zoom_ = zoomTo_;
        fit(set_->pieces.camera, w_, h_);
        moved = true;
    }
    if (held_ >= 0) moveHand(dt);
    if (mover_ >= 0 && awake_ > 0) guard();
    strike();
    if (leading_ > 0) leadOn(dt);
    const bool was = held_ >= 0 || awake_ > 0;
    if (bodies_.advance(dt) > 0 && (was || bodies_.state().awake > 0)) moved = true;
    awake_ = bodies_.state().awake;
    if (resize(dt)) moved = true;
    nearest();
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

// a press at canvas px (x, y): the piece drawn there, if the hand may take
// it (free), taken by the point on its axis kGrip under its top. the hand
// starts where that point is now and is headed straight up from it to the
// hand's plane, and the pointer's ray met the board's top this far from
// it, across. a piece that was being led is led no more, no square is
// marked or picked by the page, and the pointer picks no square until it
// has moved. 1 if a piece is now held
int chess_take(float x, float y)
{
    const int i = chess_at(x, y);
    if (i < 0 || !free(i)) return 0;
    if (held_ >= 0) bodies_.letGo();
    if (led_[i]) bodies_.letBe((uint8_t)i);
    unlead(i);
    nmarks_ = 0;
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
    const bool met = meet(x, y, 0.0f, at);
    off_[0]        = met ? hand_[0] - (at[0] + kMid) : 0.0f;
    off_[1]        = met ? hand_[2] - (at[2] + kMid) : 0.0f;
    press_[0]      = x;
    press_[1]      = y;
    aimed_         = false;
    spot_          = -1;
    aimAt(hand_[0], hand_[2]);
    relight();
    dirty_ = true;
    return 1;
}

// the pointer at canvas px (x, y) while a piece is held: the hand headed
// over where its ray meets the board's top, as far from it as at the take,
// and that place kept, the one the square filled is nearest to once the
// pointer has gone kSlop from where it took the piece (nearest). a ray that
// never meets the board's top leaves the hand headed where it was
void chess_carry(float x, float y)
{
    float at[3];
    if (held_ < 0 || !meet(x, y, 0.0f, at)) return;
    const float dx = x - press_[0], dy = y - press_[1];
    if (dx * dx + dy * dy >= kSlop * kSlop) aimed_ = true;
    cursor_[0] = at[0];
    cursor_[1] = at[2];
    aimAt(at[0] + kMid + off_[0], at[2] + kMid + off_[1]);
}

// the piece held let go: it falls, and no square is marked. while a side
// is to move it is then led back to where it stands (guard)
void chess_drop()
{
    if (held_ < 0) return;
    bodies_.letGo();
    held_   = -1;
    nmarks_ = 0;
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

// the camera zoomed by times as far in again (under 1, out), held to its
// fit, where the whole board is in the canvas however it is turned, and
// kZoomMost times that: where it is zoomed moves, and the drawn zoom eases
// there. 1 if that moved it, 0 at either end or for a by that is not a
// number over 0
int chess_zoom(float by)
{
    if (!(by > 0.0f)) return 0;
    const float z = zoomTo_ * by, to = z < 1.0f ? 1.0f : z > kZoomMost ? kZoomMost : z;
    if (to == zoomTo_) return 0;
    zoomTo_ = to;
    return 1;
}

// a reset begun: the piece held let go, no square marked, every pawn
// crowned a pawn again, and every piece's place where it starts, each led
// there over the steps that follow (leadOn), those off the board from
// wherever on the table they lie, bodies among the others again; the
// camera stays, and so does whose pieces the hand may take
void chess_reset()
{
    if (!set_) return;
    if (held_ >= 0) bodies_.letGo();
    held_       = -1;
    nmarks_     = 0;
    bool worn   = false;
    for (int i = 0; i < kPieces; ++i) {
        if (kind_[i] == kindOf(i)) continue;
        wear(i, kindOf(i));
        worn = true;
    }
    if (worn) {
        rebody();
        dress();
    }
    for (int i = 0; i < kPieces; ++i) {
        memcpy(to_[i], start_[i], sizeof to_[i]);
        state_[i] = kOn;
        bodies_.alone((uint8_t)i, false);
        bodies_.weigh((uint8_t)i, 1.0f);
        leadTo(i, kHome);
    }
    relight();
    dirty_ = true;
}

// whose pieces the hand may take: -1 anyone's, as it starts, 0 white's, 1
// black's, 2 no one's. but for anyone's, a piece on the board that is
// knocked off its place is led back to it (guard), and while it is white's
// or black's the square nearest the pointer holding a piece is filled
void chess_mover(int side)
{
    mover_ = side >= 0 && side <= 2 ? side : -1;
    relight();
}

// the piece held, 0 .. 31, or -1 for none
int chess_held() { return held_; }

// square sq (a1 0 .. h8 63) marked, outlined in the hover colour: one the
// piece held may be put on. no more than kMarks at once
void chess_mark(int sq)
{
    if (!set_ || sq < 0 || sq > 63 || nmarks_ >= kMarks) return;
    marks_[nmarks_++] = sq;
    dirty_            = true;
}

// no square marked
void chess_unmark()
{
    if (nmarks_) dirty_ = true;
    nmarks_ = 0;
}

// the square filled as of the last step: the one the piece held stands on,
// or, once the pointer has moved, the nearest to where its ray meets the
// board's top of those marked and that one, or the one the page has picked
// (nearest): a1 0 .. h8 63, or -1
int chess_near() { return near_; }

// whether the pointer has gone kSlop from where it took the piece held, so
// that it picks the square filled: 0 while the press is still where it began
int chess_aimed() { return held_ >= 0 && aimed_ ? 1 : 0; }

// the square filled picked by the page while a piece is held, in the
// pointer's place: sq, a1 0 .. h8 63, or -1 for the set's own pick again.
// it lasts until the piece is let go or another is taken
void chess_spot(int sq)
{
    if (held_ < 0) return;
    spot_ = sq >= 0 && sq <= 63 ? sq : -1;
    nearest();
}

// the square of the board under canvas px (x, y), where the ray through it
// meets the board's top: a1 0 .. h8 63, or -1 where it meets none
int chess_square(float x, float y)
{
    float at[3];
    if (!set_ || !meet(x, y, 0.0f, at) || !(fabsf(at[0]) < 4.0f && fabsf(at[2]) < 4.0f)) return -1;
    return squareAt(at[0], at[2]);
}

// piece i's place is square sq, turned as it starts: held, it is let go
// and drawn down onto it (kDrop); not held, it is led there over the
// others (kHome). nothing for a piece off the board
void chess_go(int i, int sq)
{
    if (!set_ || i < 0 || i >= kPieces || sq < 0 || sq > 63 || out(i)) return;
    from_[i][0] = to_[i][0];
    from_[i][1] = to_[i][2];
    to_[i][0]   = squareX(sq);
    to_[i][1] = 0.0f;
    to_[i][2] = squareZ(sq);
    const bool let = held_ == i;
    if (let) {
        bodies_.letGo();
        held_ = -1;
        relight();
    }
    leadTo(i, let ? kDrop : kHome);
    dirty_ = true;
}

// piece i taken off the board by piece by, or by none (-1): let go if it
// is held and led no more, and light, kLight of its mass, so the piece
// that takes it, coming down on it, shoves it aside; it stands where it is
// until then, and is then thrown off the board the way it was shoved
// (strike), to land on the table and lie there. it comes back at a reset
void chess_off(int i, int by)
{
    if (!set_ || i < 0 || i >= kPieces || out(i)) return;
    if (held_ == i) {
        bodies_.letGo();
        held_ = -1;
    }
    if (led_[i]) bodies_.letBe((uint8_t)i);
    unlead(i);
    bodies_.weigh((uint8_t)i, kLight);
    topOf(i, stood_[i]);
    wait_[i]  = 0;
    risen_[i] = false;
    state_[i] = kDoomed;
    by_[i]    = by >= 0 && by < kPieces && by != i ? by : -1;
    relight();
    dirty_ = true;
}

// piece i, off the board, a piece on it again, its place square sq,
// turned as it starts: its body among the others at its own weight, led
// there over them (kHome) from wherever it stands or lies
void chess_back(int i, int sq)
{
    if (!set_ || i < 0 || i >= kPieces || sq < 0 || sq > 63 || !out(i)) return;
    state_[i] = kOn;
    bodies_.alone((uint8_t)i, false);
    bodies_.weigh((uint8_t)i, 1.0f);
    from_[i][0] = to_[i][0];
    from_[i][1] = to_[i][2];
    to_[i][0]   = squareX(sq);
    to_[i][1]   = 0.0f;
    to_[i][2]   = squareZ(sq);
    leadTo(i, kHome);
    relight();
    dirty_ = true;
}

// pawn i crowned (on): a queen where it is, its object and its body, until
// a reset, drawn as tall as the pawn was and growing from there (resize);
// or, not on, a pawn again where it is
void chess_crown(int i, int on)
{
    if (!set_ || i < 0 || i >= kPieces || kindOf(i) != kPawn || kind_[i] == (on ? kQueen : kPawn)) return;
    wear(i, on ? kQueen : kPawn);
    rebody();
    size_[i] = on ? pawn_shape.top / queen_shape.top : 1.0f;
    dress();
    dirty_ = true;
}

// 1 while any piece is being led to its place
int chess_leading() { return leading_ > 0 ? 1 : 0; }

// the piece the page has under the pointer, 0 .. 31, or -1 for none: lit,
// unless one is held or the hand may not take it, and drawn so at the next
// step
void chess_hover(int i)
{
    hover_ = i >= 0 && i < kPieces ? i : -1;
    relight();
}

// 1 while the next step may draw: the drawn turn or zoom is not yet where
// it is turned or zoomed, a piece is held or led or yet to be struck, a
// body is awake, a queen just crowned is still growing, or something has
// changed since the picture was drawn
int chess_stirring()
{
    if (!set_) return 0;
    for (int i = 0; i < kPieces; ++i)
        if (size_[i] != 1.0f || state_[i] == kDoomed) return 1;
    return dirty_ || round_ != roundTo_ || over_ != overTo_ || zoom_ != zoomTo_ || held_ >= 0 || leading_ > 0 || awake_ > 0 ? 1 : 0;
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
    const float at[3] = { p[0] + s * r * (1.0f - cosf(rad)), p[1] - s * r * sinf(rad), p[2] };
    const float tq[4] = { cosf(0.5f * rad), 0.0f, 0.0f, sinf(0.5f * rad) };
    bodies_.place((uint8_t)i, at, tq);
    bodies_.hold((uint8_t)i, 0.0f, 0.0f, 0.0f);
    bodies_.letGo();
    dirty_ = true;
}

// for the test: piece i put with the middle of its foot at (x, y, z), board
// frame, turned by the quaternion (w, a, b, c), still and asleep
void chess_put(int i, float x, float y, float z, float w, float a, float b, float c)
{
    if (!set_ || i < 0 || i >= kPieces) return;
    const float q[4] = { w, a, b, c };
    bodies_.place((uint8_t)i, Boxed(x, y, z).at, q);
    bodies_.alone((uint8_t)i, false);
    bodies_.weigh((uint8_t)i, 1.0f);
    if (held_ == i) held_ = -1;
    unlead(i);
    state_[i] = kOn;
    size_[i]  = 1.0f;
    dirty_    = true;
}

// for the test: piece i's kind now, 0 a pawn .. 5 a king; how big it is
// drawn, of its size; and where it is in being taken off the board, 0 on
// it, 1 taken and standing, 2 flung
int   chess_kind(int i) { return set_ && i >= 0 && i < kPieces ? kind_[i] : -1; }
float chess_shown(int i) { return set_ && i >= 0 && i < kPieces ? size_[i] : 0.0f; }
int   chess_state(int i) { return set_ && i >= 0 && i < kPieces ? state_[i] : -1; }

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
