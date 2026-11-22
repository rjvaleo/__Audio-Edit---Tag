// Wave's Matrix view (ui/app/393-wave-matrix.js, 391c-wave-tiles.js).
#include "WaveView.h"

namespace
{
class WaveMatrix final : public WaveView
{
public:
    WaveMatrix (WaveCtx& c, const juce::var& captured) : WaveView (c, captured) {}
};
} // namespace

std::unique_ptr<WaveView> makeWaveMatrix (WaveCtx& c, const juce::var& captured)
{
    return std::make_unique<WaveMatrix> (c, captured);
}
