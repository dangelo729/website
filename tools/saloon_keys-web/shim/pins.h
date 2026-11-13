// saloon's pins.h for the page: only the panel's size, which here is the
// canvas the keys are drawn on (web_main.cpp). saloon's keys/keys.cpp
// centres the row of white keys across it and stands every key on its
// bottom edge: 121 across is the ten white keys with nothing either side
// of them, and 21 down the rows a white key shows at the layout's length
// (keys/keys_layout.h), so the keys fill it.
#pragma once

#include <stdint.h>

constexpr uint16_t kOledWidth  = 121;
constexpr uint16_t kOledHeight = 21;
