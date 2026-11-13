// the gfx daedalus's body draws on, for the page: a canvas over the
// caller's bytes, a byte a pixel, with the three things the body asks of
// an Adafruit_GFX: its size, a pixel (second_dimension's SD_GFXTarget,
// which plots lit and dark alike) and a 1 px line (the beard's strands),
// walked as the library's own is. a pixel off the canvas is dropped.
#pragma once

#include <stdint.h>

class Adafruit_GFX {
public:
    Adafruit_GFX(uint8_t* px, int16_t w, int16_t h) : px_(px), w_(w), h_(h) {}

    int16_t width() const { return w_; }
    int16_t height() const { return h_; }

    void drawPixel(int16_t x, int16_t y, uint16_t color)
    {
        if (x < 0 || y < 0 || x >= w_ || y >= h_) return;
        px_[y * w_ + x] = color ? 1 : 0;
    }

    void drawLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color)
    {
        const bool steep = abs16(y1 - y0) > abs16(x1 - x0);
        if (steep) { swap(x0, y0); swap(x1, y1); }
        if (x0 > x1) { swap(x0, x1); swap(y0, y1); }
        const int16_t dx = x1 - x0, dy = abs16(y1 - y0), ystep = y0 < y1 ? 1 : -1;
        int16_t       err = dx / 2;
        for (; x0 <= x1; x0++) {
            if (steep) drawPixel(y0, x0, color);
            else drawPixel(x0, y0, color);
            err -= dy;
            if (err < 0) {
                y0 += ystep;
                err += dx;
            }
        }
    }

private:
    static int16_t abs16(int16_t v) { return v < 0 ? -v : v; }
    static void    swap(int16_t& a, int16_t& b) { const int16_t t = a; a = b; b = t; }

    uint8_t* px_;
    int16_t  w_, h_;
};
