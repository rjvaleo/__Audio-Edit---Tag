// The FX modules' snapshots and bench (FxBench.cpp), for Main.
#pragma once

#include <juce_gui_basics/juce_gui_basics.h>

juce::Image fxSnapshot (const juce::StringArray& args, float scale);
int fxCards (const juce::StringArray& args);
int fxBench (const juce::StringArray& args);
