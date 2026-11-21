// The canvas: idMLab's board of modules, panned and zoomed, with cables.
//
// Every module is one fixed pixel size (its kind's width and height) and
// never grows, shrinks or reflows. Zoom scales the whole board; the window
// shows as much of it as fits. A module's face is built from its kind's list
// of controls (na_controls): a knob is a rotary slider, a switch a toggle, a
// choice a combo box, in a fixed grid. Stock JUCE controls: the designed
// faces come later (phase 8).
#pragma once

#include "Host.h"
#include "WaveFace.h"

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_basics/juce_gui_basics.h>

#include <functional>
#include <map>
#include <memory>
#include <vector>

class Canvas;

struct SocketInfo
{
    juce::String name, type;
};

struct KindInfo
{
    juce::String id, title;
    int width = 0, height = 0;
    std::vector<SocketInfo> ins, outs;
    bool keyboard = false;
    juce::var controls;
};

class Socket final : public juce::Component, public juce::SettableTooltipClient
{
public:
    Socket (Canvas&, int module, bool isInput, int index, const SocketInfo&);
    const int module;
    const bool isInput;
    const int index;
    const juce::String type, name;

    // The middle of the socket, on the board.
    juce::Point<float> centreOnBoard() const;

    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;

private:
    Canvas& canvas;
};

class ModuleFace final : public juce::Component, private juce::MidiKeyboardState::Listener
{
public:
    ModuleFace (Canvas&, int id, const KindInfo&);
    ~ModuleFace() override;

    const int id;
    const KindInfo& kind;
    std::vector<std::unique_ptr<Socket>> sockets;

    // Show these values (one per control), sending nothing.
    void setValues (const juce::var& values);
    void setPatchName (const juce::String& name);

    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseUp (const juce::MouseEvent&) override;

    static constexpr int header = 28;
    static constexpr int cellW = 70, cellH = 86;
    static constexpr int keyboardH = 96;

private:
    Canvas& canvas;
    juce::String patchName;
    std::vector<std::unique_ptr<juce::Component>> controls;
    std::vector<std::unique_ptr<juce::Label>> labels;
    juce::MidiKeyboardState keyState;
    std::unique_ptr<juce::MidiKeyboardComponent> keyboard;
    std::unique_ptr<WaveFace> wave;
    juce::TextButton close { "x" }, preset { "Preset" };
    juce::Point<int> grabbedAt;
    bool moving = false;

    void build();
    void presetMenu();
    void handleNoteOn (juce::MidiKeyboardState*, int, int note, float velocity) override;
    void handleNoteOff (juce::MidiKeyboardState*, int, int note, float) override;
};

// The cables, drawn over the modules. It takes a click only near a cable.
class CableLayer final : public juce::Component
{
public:
    explicit CableLayer (Canvas& c) : canvas (c) {}
    void paint (juce::Graphics&) override;
    bool hitTest (int x, int y) override;
    void mouseDown (const juce::MouseEvent&) override;

private:
    Canvas& canvas;
};

// The board the modules sit on: a large fixed area, scaled and moved as one.
class Board final : public juce::Component
{
public:
    explicit Board (Canvas& c) : canvas (c) {}
    void paint (juce::Graphics&) override;
    void mouseDown (const juce::MouseEvent&) override;
    void mouseDrag (const juce::MouseEvent&) override;
    void mouseWheelMove (const juce::MouseEvent&, const juce::MouseWheelDetails&) override;
    void mouseMagnify (const juce::MouseEvent&, float scale) override;

    static constexpr int size = 12000;

private:
    Canvas& canvas;
    juce::Point<float> panFrom, offsetFrom;
};

class Canvas final : public juce::Component
{
public:
    explicit Canvas (Host&);
    ~Canvas() override;

    Host& host;
    std::vector<KindInfo> kinds;
    const KindInfo* kindById (const juce::String&) const;

    // Says what a button did, or why it couldn't.
    std::function<void (const juce::String&)> status;

    struct Wire
    {
        int from, fromSocket, to, toSocket;
    };
    std::vector<Wire> wires;
    int selectedWire = -1;
    std::map<int, std::unique_ptr<ModuleFace>> faces;

    // What the toolbar and the menus do.
    void starter();
    void addModule (const juce::String& kind, juce::Point<float> onBoard);
    void removeModule (int id);
    void newCanvas();
    void openPatch();
    void savePatch (bool askWhere);
    void fit();
    void actualSize();
    void zoomBy (float factor, juce::Point<float> aroundOnCanvas);
    void panBy (juce::Point<float> delta);
    juce::Point<float> boardPoint (juce::Point<float> onCanvas) const;

    // From the faces.
    void set (int id, int index, float value);
    void note (int id, bool on, int note, float velocity);
    void faceMoved (int id);
    void openWavePreset (int id);
    void saveWavePreset (int id);

    // A cable being dragged from a socket.
    void beginCable (Socket*);
    void dragCable (juce::Point<float> onBoard);
    void endCable (juce::Point<float> onBoard);
    Socket* pendingFrom = nullptr;
    juce::Point<float> pendingEnd;
    Socket* socketOf (int module, bool isInput, int index) const;
    juce::Path wirePath (const Wire&) const;
    void removeWire (int index);

    // Rebuild every face from what the engine holds.
    void refresh();

    float zoom = 1.0f;
    juce::Point<float> offset;

    void resized() override;
    bool keyPressed (const juce::KeyPress&) override;

private:
    Board board { *this };
    CableLayer cables { *this };
    juce::File currentFile;
    std::unique_ptr<juce::FileChooser> chooser;

    void applyTransform();
    void pushMidiIns();
    void report (int code, const juce::String& what);
    void pushView();
    void writePatch (const juce::File&);
};
