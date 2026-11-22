// Wave's FX view: the master bus as a board (ui/app/395-397b).
#include "WaveView.h"

namespace
{
class WaveBoard final : public WaveView
{
public:
    WaveBoard (WaveCtx& c, const juce::var& captured) : WaveView (c, captured) {}
};
} // namespace

std::unique_ptr<WaveView> makeWaveFx (WaveCtx& c, const juce::var& captured)
{
    return std::make_unique<WaveBoard> (c, captured);
}
