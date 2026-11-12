// the_ship on the web: the ship in a bottle, headless, compiled with nothing
// else into ../../the_ship/the_ship.wasm, which js/ship.js steps a frame at
// a time on the page. this file is the ship's water scene and its view, cut
// down to what the page shows. the scene is scenes/scene_water.cpp's: the
// boat built from the steam whistle's body and size, the tank begun in its
// default shape, the bottle on its side, and the boat on its water; each
// step the drawn yaw eases toward where the page has turned it, its change
// a second is the spin the water feels, and gravity sways under it as the
// ship's does, turned into the box's frame. the view is water/tank_view.cpp's
// in its outline look: one third_dimension scene holding the water (the
// tank's skin), the boat posed on it (boat/boat_pose), the glass, which
// fills nothing, and the cork, solid, each turned by the yaw. the camera is
// ours: it stands where the shape's says, but its focal and its centre are
// fitted once, at init, so the whole glass and cork lie inside the canvas
// at every yaw. the picture lands in one canvas, a byte a pixel, 1 where
// the render inks it and 0 elsewhere, cleared each step.
#include <math.h>
#include <stdint.h>
#include <string.h>

#include <PhysicsBox_TD.h>
#include <TD_MonoTarget.h>
#include <TD_Scene.h>

#include "boat/boat.h"
#include "boat/boat_build.h"
#include "boat/boat_pose.h"
#include "core/util.h"
#include "water/tank.h"

namespace {

// --- the scene, as scenes/scene_water.cpp has it ---------------------------------
constexpr float kTurnRate = 8.0f;  // 1/s: how fast the drawn box catches up with where it is turned
constexpr float kSwayXSec = 5.0f;  // s: one sway along x
constexpr float kSwayZSec = 7.0f;  // s: one sway along z
constexpr float kGravity  = 9.8f;  // units/s²
constexpr float kTwoPi    = 6.2831853f;

// the boat's knobs, the steam whistle's body and size, as the board's
// rig has them (audio/wind_rig.h, boat/boat_build.h): the obj's boat
constexpr float kBoatBody = -0.5f;
constexpr float kBoatSize = 0.01f;

// a step's longest dt, s, as the ship's main loop clamps its hitches
constexpr float kMaxDt = 0.1f;

// --- the canvas -------------------------------------------------------------------
// canvas px, the picture's: w x h, a byte each, drawn on the page at
// Ship.SCALE world px a px (js/ship.js) to fill the ship's box (index.html:
// SHIP), 170 x 100 world px: 85 x 50 at 2, or 170 x 100 at 1. kH is as
// tall as the fit needs at that width: the lap's sweep (below) stands
// about 0.56 as tall as it is wide. the fit keeps the glass and the cork
// kRoom px in from every edge at every yaw, sweeping the lap kLapSteps
// yaws at a time
constexpr int   kW        = 170;
constexpr int   kH        = 100;
constexpr float kRoom     = 2.0f;
constexpr int   kLapSteps = 360;

uint8_t ink_[kW * kH];

// the render's plot: a pixel it inks lit, one it covers dark
void plot(void*, int16_t x, int16_t y, uint8_t on) { ink_[y * kW + x] = on ? 1 : 0; }

// everything the picture holds, as tank_view's: the views third_dimension
// draws (filled by pb::skinAttach), the water's object over them, the
// boat's object over its mesh as built, the glass's and the cork's over the
// shape's meshes, the scene and its target on the canvas
struct View {
    pb::SkinMesh  water;
    TD_Object     object;
    TD_Object     boat;
    TD_Object     glass;
    TD_Object     cork;
    TD_Scene      scene;
    TD_MonoTarget target;
    View(const TankShapeMesh& m)
        : water(), object(water.mesh), boat(boatBuildMesh()), glass(*m.mesh), cork(*m.cork),
          target(plot, nullptr, kW, kH)
    {
    }
};

View*  view_      = nullptr;
bool   water_     = false; // the renderer's memory is taken and the skin was attached at begin
bool   attached_  = true;  // the views hold the last build, attached
double t_         = 0.0;   // the scene's clock, s
float  yaw_       = 0.0f;
float  yawTarget_ = 0.0f;

// --- the framed box, as water/tank_view.cpp has it ----------------------------------
float framedHeight() { return fminf(tankShapeInfo().framedHeight, tankHeight()); }

TD_Vec3 half()
{
    const float w = 0.5f * tankWidth();
    return { fmaxf(w, tankShapeInfo().framedLength - w), 0.5f * framedHeight(), 0.5f * tankDepth() };
}

TD_Vec3 centre() { return { 0.0f, 0.5f * (framedHeight() - tankHeight()), 0.0f }; }

// the camera stands the shape's distance from the framed box's centre, or
// four of its half diagonals
float distance()
{
    if (tankShapeInfo().distance > 0.0f) return tankShapeInfo().distance;
    const TD_Vec3 h = half();
    return 4.0f * sqrtf(h.x * h.x + h.y * h.y + h.z * h.z);
}

// where a drawn mesh sits in the box-centred world: its centre c less the box's
TD_Vec3 placeOf(const float c[3])
{
    return { c[0] - 0.5f * tankWidth(), c[1] - 0.5f * tankHeight(), c[2] - 0.5f * tankDepth() };
}

// --- the fit ------------------------------------------------------------------------
// the bounds of a mesh, placed at c and scaled r in the box, turned by the
// pose, as the camera sees it: each vertex's view x and its view y, down,
// over its depth, the tangents a focal of 1 and a centre at 0 make of it
struct Bounds {
    float x0 = 1e30f, x1 = -1e30f, y0 = 1e30f, y1 = -1e30f;
};
void sweep(Bounds& b, const TD_Camera& cam, const TD_Mat3& pose, const TD_Mesh& m, float r, const float c[3])
{
    const TD_Vec3 at = placeOf(c);
    for (uint16_t i = 0; i < m.nverts; ++i) {
        const float*  q = m.verts[i];
        const TD_Vec3 p = cam.worldToView(tdMat3MulVec(pose, { at.x + r * q[0], at.y + r * q[1], at.z + r * q[2] }));
        const float   x = p.x / p.z, y = -p.y / p.z;
        b.x0 = fminf(b.x0, x);
        b.x1 = fmaxf(b.x1, x);
        b.y0 = fminf(b.y0, y);
        b.y1 = fmaxf(b.y1, y);
    }
}

// the camera at the shape's orbit and distance, aimed at the framed box's
// centre, and fitted: the glass and the cork swept through a lap as it
// sees them, its focal the largest that keeps all of that kRoom px in from
// the canvas's edges, across and up and down, and its centre on the canvas
// where the sweep's middle lands on the canvas's
void aim(TD_Camera& cam)
{
    const TankShapeInfo& at = tankShapeInfo();
    const TankShapeMesh& m  = tankShapeMesh();
    cam.setOrbit(at.azimuth, at.elevation);
    cam.setDistance(distance());
    cam.setTarget(0.0f, centre().y, 0.0f);
    cam.setFocalPixels(1.0f);
    cam.setCenterPixels(0.0f, 0.0f);
    cam.resolve(kW, kH, centre(), 1.0f); // the pose alone
    Bounds b;
    for (int k = 0; k < kLapSteps; ++k) {
        const TD_Mat3 pose = tdEulerXYZ(0.0f, kTwoPi * (float)k / (float)kLapSteps, 0.0f);
        sweep(b, cam, pose, *m.mesh, m.r, m.c);
        sweep(b, cam, pose, *m.cork, m.corkR, m.corkC);
    }
    const float f = fminf(((float)kW - 2.0f * kRoom) / (b.x1 - b.x0), ((float)kH - 2.0f * kRoom) / (b.y1 - b.y0));
    cam.setFocalPixels(f);
    cam.setCenterPixels(0.5f * (float)kW - f * 0.5f * (b.x0 + b.x1), 0.5f * (float)kH - f * 0.5f * (b.y0 + b.y1));
}

// --- the view, as water/tank_view.cpp has it ------------------------------------------
// the scene: the water lit by nothing (the outline look shades nothing),
// the boat, the glass filling nothing and hiding nothing, the cork solid,
// the baked edge tables at the glass's crease before any table is taken;
// the renderer's working buffers reserved for the largest surface the skin
// can build, the boat, the glass and the cork, and the skin attached.
// false: no water is drawn
bool viewBegin()
{
    const TankShapeMesh& m = tankShapeMesh();
    view_   = new View(m);
    View& v = *view_;
    v.scene.add(v.object);
    v.scene.add(v.boat);
    v.scene.add(v.glass);
    v.glass.setFill(false);
    v.glass.setScale(m.r);
    v.scene.add(v.cork);
    v.cork.setScale(m.corkR);
    v.scene.setRenderMode(TD_OUTLINE);
    v.scene.setOutlineCrease(m.crease);
    v.scene.setOutlineEdges(*m.mesh, *m.edges);
    v.scene.setOutlineEdges(*m.cork, *m.corkEdges);
    v.target.setAutoClear(false); // the canvas is cleared each step here
    aim(v.scene.camera);
    const pb::Skin& skin = tankSkin();
    const TD_Mesh&  boat = v.boat.mesh();
    if (!skin.ready() ||
        !v.scene.renderer().reserve(skin.config().maxVerts + boat.nverts + m.mesh->nverts + m.cork->nverts,
                                    skin.config().maxTris + boat.nfaces + m.mesh->nfaces + m.cork->nfaces, 4))
        return false;
    attached_ = pb::skinAttach(skin, v.scene, v.water);
    return attached_;
}

// the boat's object in the pose its state and the box's yaw give it
void poseBoat(View& v, float yaw)
{
    const BoatPose p = boatPose(boatState(), yaw, tankWidth(), tankHeight(), tankDepth(), tankShapeInfo().boatScale);
    v.boat.setPosition(p.position.x, p.position.y, p.position.z);
    v.boat.setRotation(p.rx, p.ry, p.rz);
    v.boat.setScale(p.scale);
}

// one frame with the box turned yaw: the skin attached again after a
// build, the water, the glass and the cork turned by the yaw, the glass and
// the cork at their places in the box, the boat posed on the water, and
// the render, of views attached after the build they show, the water's
// object hidden while the skin has no triangles
void viewDraw(float yaw)
{
    if (!view_) return;
    View& v = *view_;
    if (water_ && tankRebuilt()) attached_ = pb::skinAttach(tankSkin(), v.scene, v.water);
    const TD_Mat3        pose = tdEulerXYZ(0.0f, yaw, 0.0f);
    const TankShapeMesh& m    = tankShapeMesh();
    v.object.setRotation(0.0f, yaw, 0.0f);
    v.glass.setRotation(0.0f, yaw, 0.0f);
    const TD_Vec3 glassAt = tdMat3MulVec(pose, placeOf(m.c));
    v.glass.setPosition(glassAt.x, glassAt.y, glassAt.z);
    v.cork.setRotation(0.0f, yaw, 0.0f);
    const TD_Vec3 corkAt = tdMat3MulVec(pose, placeOf(m.corkC));
    v.cork.setPosition(corkAt.x, corkAt.y, corkAt.z);
    poseBoat(v, yaw);
    v.object.setVisible(v.water.mesh.ntris > 0);
    if (water_ && attached_) v.scene.render(v.target);
}

} // namespace

extern "C" {

void ship_step(float dt);

// the ship made, as the water scene enters: the boat built, the tank begun
// in its shape, the bottle, the boat on its water, the view begun and
// fitted, and a first frame at rest. 1 when the water is drawn, 0 when its
// memory could not be had (a step then draws nothing)
int ship_init()
{
    boatBuild(kBoatBody, kBoatSize); // before the view takes its mesh
    if (!tankBegin()) return 0;
    boatBegin();
    water_     = viewBegin();
    t_         = 0.0;
    yaw_       = 0.0f;
    yawTarget_ = 0.0f;
    ship_step(0.0f);
    return water_ ? 1 : 0;
}

// the bottle turned rad further about its vertical axis (+ counterclockwise
// seen from above): where it is headed moves, and the drawn bottle eases
// there. a turn that is not a number does nothing
void ship_turn(float rad)
{
    if (rad == rad) yawTarget_ += rad;
}

// one frame, dt seconds on (held to 0 .. kMaxDt), as the water scene ticks:
// the drawn yaw eased toward its target, its change a second the spin; a
// lap from 0 the yaw and its target come back a lap together; gravity, the
// world's swaying, turned into the box's frame; the water, then the boat on
// it; and the frame drawn into the canvas, cleared
void ship_step(float dt)
{
    if (!(dt > 0.0f)) dt = 0.0f;
    if (dt > kMaxDt) dt = kMaxDt;
    t_ += dt;
    const TankShapeInfo& at  = tankShapeInfo();
    const float          was = yaw_;
    yaw_ = approach(yaw_, yawTarget_, kTurnRate, dt);
    const float spin = dt > 0.0f ? (yaw_ - was) / dt : 0.0f;
    if (yaw_ > kTwoPi || yaw_ < -kTwoPi) {
        const float lap = yaw_ > 0.0f ? kTwoPi : -kTwoPi;
        yaw_ -= lap;
        yawTarget_ -= lap;
    }
    const float gx = sinf(at.sway * (float)sin(kTwoPi * t_ / kSwayXSec));
    const float gz = sinf(at.sway * (float)sin(kTwoPi * t_ / kSwayZSec));
    const float g  = kGravity / sqrtf(gx * gx + 1.0f + gz * gz);
    const float c = cosf(yaw_), s = sinf(yaw_);
    tankTick(dt, c * g * gx - s * g * gz, -g, s * g * gx + c * g * gz, spin);
    boatTick(dt);
    memset(ink_, 0, sizeof ink_);
    viewDraw(yaw_);
}

// the canvas: w x h bytes, row by row, 1 lit
uint8_t* ship_ink() { return ink_; }
int      ship_w() { return kW; }
int      ship_h() { return kH; }

// the bottle's turn as drawn, radians, within a lap of 0
float ship_yaw() { return yaw_; }

} // extern "C"
