// daedalus's pins.h for the page: only the panel's size, which here is the
// canvas the body is drawn on (web_main.cpp). daedalus's body/body_rig.cpp
// puts the head's pivot on its middle and sizes its scratch canvases from
// it, and its body/beard.cpp keeps every strand inside it. 128 across keeps
// the middle column the body's model takes for the panel's (body_rig.h's
// kBodyMidX), so the left arms and the right mirror each other, and holds
// the arms' reach either side at the size the page draws them
// (web_main.cpp's kArm and kFar); 132 down is the head with the lower
// shoulders' reach under it and the upper shoulders' over it. a mallet's
// head at the reach's end stays a pixel inside every edge.
#pragma once

#include <stdint.h>

constexpr uint16_t kOledWidth  = 128;
constexpr uint16_t kOledHeight = 132;
