// Where the app keeps things, and where it reads MGL's.
//
// The app's own files go on the 1 TB drive, in WORK DIR/native-app, so
// nothing new lands on the main drive (APP-PLAN question 4; the plan's
// proposal, used until RJ says otherwise). On a machine without that drive
// they go in Documents/idMLab instead.
#pragma once

#include <juce_core/juce_core.h>

namespace places
{
inline juce::File home()
{
    const juce::File drive ("/Volumes/1 TB Funtime/WORK DIR");
    if (drive.isDirectory())
        return drive.getChildFile ("native-app");
    return juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("idMLab");
}

inline juce::File patches()
{
    auto d = home().getChildFile ("patches");
    d.createDirectory();
    return d;
}

inline juce::File wavePresets()
{
    auto d = home().getChildFile ("presets").getChildFile ("wave");
    d.createDirectory();
    return d;
}

// Atmosphere's presets: each file one of MGL's preset lists (what its Seq
// exports and imports), holding only Atmosphere's controls.
inline juce::File atmosPresets()
{
    auto d = home().getChildFile ("presets").getChildFile ("atmos");
    d.createDirectory();
    return d;
}

// Grain's presets: one file in MGL's own shape (its data/PRESETS.json).
inline juce::File grainPresets()
{
    auto d = home().getChildFile ("presets").getChildFile ("grain");
    d.createDirectory();
    return d.getChildFile ("PRESETS.json");
}

// Prism's presets: one file in MGL's own shape (its data/PAD-PRESETS.json).
inline juce::File prismPresets()
{
    auto d = home().getChildFile ("presets").getChildFile ("prism");
    d.createDirectory();
    return d.getChildFile ("PAD-PRESETS.json");
}

// MultiGrainLive's own data folder on this machine, read only.
inline juce::File mgl()
{
    return juce::File::getSpecialLocation (juce::File::userDocumentsDirectory).getChildFile ("MultiGrainLive").getChildFile ("data");
}

// Saved Wave tables: the app's own first, then MGL's.
inline juce::Array<juce::File> tableDirs()
{
    return { home().getChildFile ("wave-tables"), mgl().getChildFile ("wave").getChildFile ("tables") };
}

// MGL's Wave presets, offered when a preset is opened.
inline juce::File mglWavePresets()
{
    return mgl().getChildFile ("wave").getChildFile ("presets");
}
} // namespace places
