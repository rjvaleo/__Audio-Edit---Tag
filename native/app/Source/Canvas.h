// The canvas: idMLab's own (M Clone, src/modular/ui/ModularApp.tsx and
// camera.ts), the ComfyUI one, ported.
//
// - The camera is idMLab's (LiteGraph's DragAndScale): one transform, translate
//   then scale, in a window that never scrolls, so there are no edges. The wheel
//   zooms about the cursor, 1.1x a notch, from 0.1x to 10x; a trackpad glides;
//   a pinch holds the canvas.
// - Pan as ComfyUI does: drag the empty canvas, or hold Space and drag anywhere,
//   or drag with the middle button anywhere.
// - Double-click or right-click the empty canvas: Add module, with search.
//   Delete or Backspace removes what is selected; "." fits the patch (or the
//   selected module); Cmd+D duplicates; Cmd+Z and Shift+Cmd+Z undo and redo.
// - Every module wears idMLab's frame and header (collapse, power, its menu,
//   its name, close) and its sockets, captured from idMLab itself; cables are
//   idMLab's curve and stroke. MGL's pages are the modules' faces, at their
//   own fixed size.
#pragma once

#include <set>

#include "Face.h"
#include "Host.h"
#include "AtmosFace.h"
#include "SeqFace.h"
#include "ChopFace.h"
#include "PrismFace.h"
#include "BrowseFace.h"
#include "FxFace.h"
#include "EditFace.h"
#include "GrainFace.h"
#include "SoundFace.h"
#include "WaveFace.h"

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>
#include <map>
#include <memory>
#include <vector>

// idMLab's camera (camera.ts): `left` and `top` are where the window's
// top-left corner sits on the scaled canvas.
struct Camera
{
    float left = 0, top = 0, zoom = 1;
};

namespace camera
{
constexpr float minZoom = 0.1f, maxZoom = 10.0f, notch = 1.1f;
float clampZoom (float);
juce::Point<float> toCanvas (const Camera&, juce::Point<float> screen);
Camera zoomAround (const Camera&, juce::Point<float> pointer, float factor);
Camera panBy (const Camera&, float dx, float dy);
Camera centreOn (juce::Point<float> point, juce::Point<float> view, float zoom);
Camera fit (const std::vector<juce::Rectangle<float>>& boxes, juce::Point<float> view, float margin = 48);
} // namespace camera

class Canvas;

struct SocketInfo
{
    juce::String name, type;
};

struct KindInfo
{
    juce::String id, title;
    juce::String group;   // an effect module's module (Reverb, Delay, ...)
    bool listed = true;
    int width = 0, height = 0;
    std::vector<SocketInfo> ins, outs;
    bool keyboard = false;
    juce::var controls;
};

// A socket: idMLab's jack, its label outside the module.
class Jack final : public juce::Component, public juce::SettableTooltipClient
{
public:
    Jack (Canvas&, int module, bool isInput, int index, const SocketInfo&);
    const int module;
    const bool isInput;
    const int index;
    const juce::String type, name;
    juce::Point<float> centreOnStage() const;
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    static constexpr int size = 12;

private:
    Canvas& canvas;
    std::unique_ptr<juce::Drawable> art;
};

// A module on the canvas: idMLab's frame and header round its face.
class Node final : public juce::Component
{
public:
    Node (Canvas&, int id, const KindInfo&);
    const int id;
    const KindInfo& kind;
    std::vector<std::unique_ptr<Jack>> jacks;
    std::unique_ptr<WaveFace> wave;
    std::unique_ptr<AtmosFace> atmos;
    std::unique_ptr<SeqFace> seq;
    std::unique_ptr<EditFace> edit;
    std::unique_ptr<SoundFace> sound;
    std::unique_ptr<GrainFace> grain;
    std::unique_ptr<ChopFace> chop;
    std::unique_ptr<PrismFace> prism;
    std::unique_ptr<FxFace> fxFace;
    std::unique_ptr<BrowseFace> browse;
    std::unique_ptr<LibraryFace> library;
    // The page that is this module's face, if it has one.
    juce::Component* body() const
    {
        if (browse != nullptr)
            return browse.get();
        if (library != nullptr)
            return library.get();
        if (seq != nullptr)
            return seq.get();
        if (chop != nullptr)
            return chop.get();
        if (fxFace != nullptr)
            return fxFace.get();
        if (prism != nullptr)
            return prism.get();
        if (grain != nullptr)
            return grain.get();
        if (edit != nullptr)
            return edit.get();
        if (sound != nullptr)
            return sound.get();
        return wave != nullptr ? (juce::Component*) wave.get() : (juce::Component*) atmos.get();
    }
    bool collapsed = false, selected = false;
    juce::Colour accent;

    void setValues (const juce::var& values);
    void setPatchName (const juce::String&);
    const juce::String& patchName() const { return shownName; }
    void layout();
    void paint (juce::Graphics&) override;
    void paintOverChildren (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;

    static constexpr int header = 20, border = 1;
    juce::Rectangle<int> bodyBounds() const;
    // A press on something inside it, as its listener hears it (the check).
    void pressedInside (const juce::MouseEvent& e) { raise.mouseDown (e); }

private:
    Canvas& canvas;
    juce::String shownName;
    std::unique_ptr<juce::ComboBox> channel;
    juce::Point<int> grabbedAt;
    bool moving = false;
    // A press on what is inside it (its face, a socket) selects the module
    // and brings it to the front; the press itself stays the face's.
    struct Raise final : juce::MouseListener
    {
        explicit Raise (Node& n) : node (n) {}
        Node& node;
        void mouseDown (const juce::MouseEvent& e) override;
    } raise { *this };
    juce::Rectangle<float> collapseR, powerR, menuR, handleR, nameR, closeR;
    juce::Image frame;
    juce::String frameKey;
    void paintFrame (juce::Graphics&);
};

// The cables, under the modules.
class Cables final : public juce::Component
{
public:
    explicit Cables (Canvas& c) : canvas (c) { setInterceptsMouseClicks (false, false); }
    void paint (juce::Graphics&) override;
    // Fit the layer to the cables (and the one being dragged), and draw again.
    void update();

private:
    Canvas& canvas;
};

// The stage: the canvas itself, moved and scaled by the camera.
class Stage final : public juce::Component
{
public:
    explicit Stage (Canvas&) {}
    // The board runs every way from the patch's (0, 0): the stage is this far
    // either side of it, and a module at the patch's (x, y) sits at
    // (x + origin, y + origin) on the stage. With the patch's origin at the
    // stage's corner nothing could be moved up or left of where it started
    // (RJ, 26 Nov 2026: "you can't move it up past where you first show it").
    static constexpr int origin = 100000;
    static constexpr int size = 2 * origin;
};

// idMLab's Add module panel, with its search.
class AddMenu final : public juce::Component, private juce::TextEditor::Listener
{
public:
    AddMenu (Canvas&, juce::Point<float> onStage);
    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseMove (const juce::MouseEvent&) override;
    void mouseExit (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    const juce::Point<float> at;
    float scrolledBy() const { return scroll; }
    // Every group opened, then all but the first shut again (the check).
    void openEveryGroup (bool all);

private:
    Canvas& canvas;
    juce::TextEditor search;
    struct Row
    {
        juce::String label, kind;
        bool group;
        juce::Rectangle<float> r;
        int count = 0;     // a group's modules
        bool open = false; // a group shown with its modules
    };
    // The groups shown open: each is shut until it is pressed, and stays as
    // it was left the next time the menu opens (RJ, 26 Nov 2026). A search
    // shows every group that has a match, open.
    static std::set<juce::String>& openGroups();
    std::vector<Row> rows;
    int hover = -1;
    // The list scrolls under the title and the search (the first 63 px).
    static constexpr int listTop = 61;
    float scroll = 0, contentH = 0;
    void filter();
    void textEditorTextChanged (juce::TextEditor&) override { filter(); }
    void textEditorReturnKeyPressed (juce::TextEditor&) override;
    void textEditorEscapeKeyPressed (juce::TextEditor&) override;
};

class Canvas final : public juce::Component, private juce::KeyListener, private juce::Timer
{
public:
    explicit Canvas (Host&);
    ~Canvas() override;

    Host& host;
    std::vector<KindInfo> kinds;
    const KindInfo* kindById (const juce::String&) const;

    // Says what a command did, or why it couldn't (the status line).
    std::function<void (const juce::String&)> status;
    // Asks for the bar and status line to be drawn again (zoom, file, counts).
    std::function<void()> changed;

    struct Wire
    {
        int from, fromSocket, to, toSocket;
    };
    std::vector<Wire> wires;
    int selectedWire = -1, selectedNode = -1;
    // The Add menu, opened at a place on the canvas (the check).
    AddMenu* openMenuForCheck (juce::Point<float> onCanvas) { openMenu (onCanvas); return menu.get(); }
    juce::String patchForCheck() { return snapshot(); }
    std::map<int, std::unique_ptr<Node>> nodes;

    // The menus' and the bar's commands (appMenus.ts).
    void starter();
    void newCanvas();
    void openPatch();
    void savePatch (bool askWhere);
    void undo();
    void redo();
    void duplicateSelection();
    void deleteSelection();
    void addModuleAtCentre();
    void addModule (const juce::String& kind, juce::Point<float> onStage);
    void centrePatch();
    void pan (float dx, float dy);
    // A new theme or kit was put on: everything drawn again in it.
    void retheme();
    // End a zoom gesture now and draw sharp (for the bench).
    // The zoom at rest now, every module drawn sharp (for the bench).
    void settleZoom() { if (zooming) timerCallback(); while (!sharpen.empty()) timerCallback(); }
    // A wheel's notches at a point (the bench drives it), and one screen frame of its glide.
    void wheelZoom (juce::Point<float> at, float notches);
    void glideFrame() { glide(); }
    bool isGliding() const { return gliding; }
    void fit();
    void setZoom (float);
    float zoom() const { return cam.zoom; }
    juce::String fileName() const;

    // From the modules.
    void removeModule (int id);
    void select (int id);
    void nodeMoved (int id);
    void set (int id, int index, float value);
    void openWavePreset (int id);
    void saveWavePreset (int id);
    // Atmosphere's presets: MGL's own preset shape (a list, as its Seq
    // exports them), only Atmosphere's controls in it.
    void openAtmosPreset (int id);
    void saveAtmosPreset (int id);
    void loadAtmosPreset (int id, const juce::var& preset);
    // Seq's presets: MGL's own (its presets.json) and those saved here, by name.
    std::vector<std::pair<juce::String, juce::var>> seqPresets();
    void loadSeqPreset (int id, const juce::var& preset);
    void saveSeqPreset (int id);
    void deleteSeqPreset (const juce::String& name);
    // The presets saved in the app's folder, each a menu item that loads it.
    juce::PopupMenu atmosPresetList (int id);

    // A cable being dragged from a socket.
    void beginCable (Jack*);
    void dragCable (juce::Point<float> onStage);
    void endCable (juce::Point<float> onStage);
    Jack* pendingFrom = nullptr;
    juce::Point<float> pendingEnd;
    Jack* jackOf (int module, bool isInput, int index) const;
    juce::Path wirePath (const Wire&) const;
    void removeWire (int index);
    int wireAt (juce::Point<float> onStage) const;

    void refresh();
    void closeMenu();

    juce::Point<float> stagePoint (juce::Point<float> onCanvas) const { return camera::toCanvas (cam, onCanvas) + juce::Point<float> ((float) Stage::origin, (float) Stage::origin); }
    Stage stage { *this };
    Cables cables { *this };

    void paint (juce::Graphics&) override;
    void resized() override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;
    void mouseDoubleClick (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    void mouseMagnify (const juce::MouseEvent&, float scale) override;
    bool keyPressed (const juce::KeyPress&) override;
    bool keyPressed (const juce::KeyPress&, juce::Component*) override;
    bool keyStateChanged (bool, juce::Component*) override;
    using juce::Component::keyStateChanged;

    // Space held, or a middle-button drag: the hand, panning even over a module.
    bool spaceHeld = false;
    bool panGesture (const juce::MouseEvent&) const;

    // Pan from wherever the pointer went down (Space, the middle button).
    void startPan (const juce::MouseEvent&);
    void movePan (const juce::MouseEvent&);
    void endPan();
    bool isPanning() const { return panning; }

private:
    Camera cam;
    juce::File currentFile;
    std::unique_ptr<juce::FileChooser> chooser;
    std::unique_ptr<AddMenu> menu;
    bool panning = false;
    juce::Point<float> panFrom;
    Camera panCamera;
    std::vector<juce::String> undoStack, redoStack;
    juce::Image dotTile;
    float dotStep = 0;
    int dotStamp = -1;

    // A wheel's zoom, eased toward where it is going, one step a screen frame.
    bool gliding = false;
    float targetZoom = 1;
    juce::Point<float> anchor;
    double lastFrame = 0;
    void glide();
    juce::VBlankAttachment vblank { this, [this] { glide(); } };

    // While a zoom runs, every module's kept picture is only moved and scaled
    // (it is held at the sharpness it has); once the zoom has rested, the
    // modules on screen are drawn sharp again one a frame, so nothing waits.
    bool zooming = false;
    std::vector<int> sharpen;   // the modules still to draw sharp, by id
    void holdPictures (bool);
    void zoomTo (const Camera&);
    void timerCallback() override;

    void applyCamera();
    void report (int code, const juce::String& what);
    void pushView();
    void writePatch (const juce::File&);
    void remember();
    juce::String snapshot();
    void restore (const juce::String&);
    void openMenu (juce::Point<float> onCanvas);
};
