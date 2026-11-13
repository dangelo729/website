// the gfx saloon's keys draw on, for the page: a canvas over the caller's
// bytes, a byte a pixel, with the two things the keys ask of an
// Adafruit_GFX: its size and a pixel (second_dimension's SD_GFXTarget,
// which plots lit and dark alike). a lit pixel is written kGfxLit and a
// dark one kGfxDark, so a canvas cleared to 0 keeps the pixels no key
// painted apart from both. a pixel off the canvas is dropped.
#pragma once

#include <stdint.h>

constexpr uint8_t kGfxLit  = 1;
constexpr uint8_t kGfxDark = 2;

class Adafruit_GFX {
public:
    Adafruit_GFX(uint8_t* px, int16_t w, int16_t h) : px_(px), w_(w), h_(h) {}

    int16_t width() const { return w_; }
    int16_t height() const { return h_; }

    void drawPixel(int16_t x, int16_t y, uint16_t color)
    {
        if (x < 0 || y < 0 || x >= w_ || y >= h_) return;
        px_[y * w_ + x] = color ? kGfxLit : kGfxDark;
    }

private:
    uint8_t* px_;
    int16_t  w_, h_;
};
