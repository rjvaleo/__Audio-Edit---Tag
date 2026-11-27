// Browse's face and Library's: MGL's Browse page (every sound in the library:
// ui/app/010-library.js, 250-library-panels.js, 251-browse-types.js,
// 255-advanced-view.js, 050-metastrip.js) and its Library page (the PC's own
// sounds: 430-library-page.js), drawn natively at the size RJ uses them:
// Browse is the window less MGL's rail with the Now Playing bar under it,
// 1500 x 1100; Library its fixed page, 1500 x 780.
//
// The frame is the page's own, captured (tools/face-capture/capture-browse.mjs,
// in the main three themes). What the library holds is drawn over it from the
// captured rows, cards, chips and tiles, written with the library's words:
// the folder list and its files, the panes (Search and Sounds like it, Scan,
// Folder), the sound picked (its picture, its stats, why, its tags), the
// types and their files; on the Library page the prompts, the tiles and the
// sound. Every answer is MGL's own, from the library in the app (MglLibrary);
// what is heard plays out of the module's Audio socket (na_browse_call), and a
// sound chosen opens in the Sound modules cabled from its Sound socket.
#pragma once

#include "Face.h"
#include "MglLibrary.h"
#include "na.h"

#include <functional>
#include <map>
#include <memory>
#include <set>
#include <vector>

namespace browse
{
// One captured node, found by its class or id, and its place.
struct N
{
    juce::var n;
    juce::Rectangle<float> r;
    bool ok() const { return n.isObject(); }
};

// What both faces share: the frame, the calls, the text fields.
class Base : public juce::Component, protected juce::Timer
{
public:
    using Call = std::function<int64_t (const std::function<int64_t (NaApp*)>&)>;
    Base (Call, uint32_t id);
    ~Base() override;

    std::function<void (const juce::String&)> onMessage;
    std::function<bool (const juce::MouseEvent&)> blocked;
    // A sound chosen: `file` (where it is), `rel` (the library's path for it),
    // `name`, and `then`, a page to open it on ("" for none).
    std::function<void (const juce::String& file, const juce::String& rel, const juce::String& name, const juce::String& then)> choose;

    // The module's call; its answer.
    juce::var module (const char* what, const juce::var& body = {});
    // One frame of the face (the snapshots and the bench).
    void poll() { timerCallback(); }
    // Where a part is, in the face's pixels (the bench).
    virtual juce::Rectangle<float> where (const juce::String& part) const = 0;
    // The time the last change took to draw again, at `scale`, as the window would.
    double paintTimed (float scale);
    // A colour as the page's stylesheet gives it: c2d's, and oklch() as well.
    static juce::Colour colourOf (const juce::String& css);

protected:
    Call call;
    const uint32_t id;
    juce::var info;
    std::vector<char> buf;
    void say (const juce::String& m) { if (onMessage) onMessage (m); }
    void timerCallback() override;
    virtual void tick() {}

    // Drawing from a capture: a part found by class (and `nth`), drawn at
    // another place with its words replaced.
    static N find (const juce::var& tree, const juce::String& cls, int nth = 0);
    static N byId (const juce::var& tree, const juce::String& id);
    static void findAll (const juce::var& tree, const juce::String& cls, std::vector<N>& out);
    static std::vector<juce::var> texts (const juce::var& node);
    // `node` drawn moved by `by`, its runs of text written as `words` gives
    // them (the run's own words when `words` gives nothing). A count keeps its
    // right edge. With `flowRight` (the row's right edge, in the capture's
    // pixels) the words on a line follow one another as the page flows them,
    // each moved by what the ones before it gained or lost, cut at that edge.
    void drawRow (juce::Graphics&, face::Chrome&, const juce::var& node, juce::Point<float> by,
                  const std::function<juce::String (const juce::var& textNode, const juce::String& captured)>& words, float opacity = 1.0f,
                  float flowRight = 0.0f);
    // Words in a captured run's font and colour, cut short with "…" to `room`.
    // Words the page writes in capitals (`text-transform`) are written so here.
    static void write (juce::Graphics&, const juce::var& run, juce::Point<float> by, const juce::String& text, float room, juce::Colour* tint = nullptr);
    // Parts of a row the next drawRow leaves out (the face draws them itself).
    std::set<int> rowSkip;
    juce::TextEditor& field (const juce::String& key, const N& at, const juce::String& hint, bool multi = false);
    std::map<juce::String, std::unique_ptr<juce::TextEditor>> fields;
};
} // namespace browse

class BrowseFace final : public browse::Base
{
public:
    BrowseFace (Call, uint32_t id);
    ~BrowseFace() override;
    juce::Rectangle<float> where (const juce::String& part) const override;

    // The state the face shows (the bench reads it back).
    juce::String pane = "browse";
    juce::String picked;     // the library path of the sound picked
    juce::String typeName;   // the type picked
    juce::String sort = "name", instrument, find, filter;
    bool playAll = false;
    juce::StringArray openFolders;

    void paint (juce::Graphics&) override;
    void resized() override {}
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    bool keyPressed (const juce::KeyPress&) override;

    // The page's own actions, as its controls do them (the bench presses them).
    void toggleFolder (const juce::String& name);
    void selectFile (const juce::var& file);
    void playFile (const juce::var& file);
    void openFile (const juce::var& file);
    void pickType (const juce::String& name);
    void showPane (const juce::String& p);
    void similar();
    void startScan();
    // Load everything it shows (the start, after Scan, after the library is set).
    void refresh();
    // The page's state, to the module (saved in the patch).
    void saveUi();
    bool busy() const { return pending > 0; }

    struct Impl;

private:
    std::unique_ptr<Impl> d;
    int pending = 0;
    bool scanning = false;
    int scanTicks = 0;
    void tick() override;
    friend struct Impl;
};

class LibraryFace final : public browse::Base
{
public:
    LibraryFace (Call, uint32_t id);
    ~LibraryFace() override;
    juce::Rectangle<float> where (const juce::String& part) const override;

    juce::String kind, order = "prompt", q, group;
    int pick = -1;
    bool loop = false;

    void paint (juce::Graphics&) override;
    void resized() override {}
    void mouseDown (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;

    void load();
    void play (int i);
    void use (const juce::String& act);
    bool busy() const { return pending > 0; }

    struct Impl;

private:
    std::unique_ptr<Impl> d;
    int pending = 0;
    void tick() override;
    friend struct Impl;
};
