#include "Canvas.h"

#include "Places.h"

namespace
{
juce::Font font (float size, bool bold = false)
{
    return juce::Font (juce::FontOptions (size, bold ? juce::Font::bold : juce::Font::plain));
}

juce::Colour typeColour (const juce::String& type)
{
    if (type == "audio")
        return juce::Colour (0xff4fb3ff);
    if (type == "notes")
        return juce::Colour (0xffffb347);
    return juce::Colour (0xffb0b0b0);
}

const juce::Colour boardColour (0xff16181c), faceColour (0xff262a31), headerColour (0xff32373f), inkColour (0xffe6e6e6),
    dimColour (0xff9aa0a8);
} // namespace

// ─────────────────────────────────────────────────────────────── sockets

Socket::Socket (Canvas& c, int m, bool in, int i, const SocketInfo& info)
    : module (m), isInput (in), index (i), type (info.type), name (info.name), canvas (c)
{
    setSize (14, 14);
    setTooltip (name + " (" + type + ")");
}

juce::Point<float> Socket::centreOnBoard() const
{
    auto* face = getParentComponent();
    return (face->getPosition() + getBounds().getCentre()).toFloat();
}

void Socket::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat().reduced (1.5f);
    g.setColour (typeColour (type));
    g.fillEllipse (r);
    g.setColour (boardColour);
    g.fillEllipse (r.reduced (3.5f));
}

void Socket::mouseDown (const juce::MouseEvent&)
{
    canvas.beginCable (this);
}

void Socket::mouseDrag (const juce::MouseEvent& e)
{
    canvas.dragCable (e.getEventRelativeTo (getParentComponent()->getParentComponent()).position);
}

void Socket::mouseUp (const juce::MouseEvent& e)
{
    canvas.endCable (e.getEventRelativeTo (getParentComponent()->getParentComponent()).position);
}

// ───────────────────────────────────────────────────────────────── faces

ModuleFace::ModuleFace (Canvas& c, int i, const KindInfo& k) : id (i), kind (k), canvas (c)
{
    setSize (kind.width, kind.height);
    build();
}

ModuleFace::~ModuleFace()
{
    keyState.removeListener (this);
}

void ModuleFace::build()
{
    addAndMakeVisible (close);
    close.setTooltip ("Take this module off the canvas");
    close.onClick = [this] { juce::MessageManager::callAsync ([c = &canvas, i = id] { c->removeModule (i); }); };
    if (kind.id == "wave")
    {
        addAndMakeVisible (preset);
        preset.setTooltip ("Open or save a Wave preset (MGL's presets open here)");
        preset.onClick = [this] { presetMenu(); };
    }
    close.setBounds (getWidth() - 26, 4, 22, 20);
    preset.setBounds (getWidth() - 92, 4, 62, 20);

    for (int s = 0; s < (int) kind.ins.size(); ++s)
    {
        auto socket = std::make_unique<Socket> (canvas, id, true, s, kind.ins[(size_t) s]);
        socket->setTopLeftPosition (3, header + 10 + s * 24);
        addAndMakeVisible (*socket);
        sockets.push_back (std::move (socket));
    }
    for (int s = 0; s < (int) kind.outs.size(); ++s)
    {
        auto socket = std::make_unique<Socket> (canvas, id, false, s, kind.outs[(size_t) s]);
        socket->setTopLeftPosition (getWidth() - 17, header + 10 + s * 24);
        addAndMakeVisible (*socket);
        sockets.push_back (std::move (socket));
    }

    // Wave is MGL's own page, at its own size, under the header.
    if (kind.id == "wave")
    {
        auto* host = &canvas.host;
        const auto module = (uint32_t) id;
        wave = std::make_unique<WaveFace> (
            [host, module] (const juce::String& key, const juce::String& value) {
                host->with ([&] (NaApp* a) { return na_wave_set (a, module, key.toRawUTF8(), value.toRawUTF8()); });
            },
            [host, module] {
                return juce::String (host->with ([&] (NaApp* a) { return naText ([&] (char* b, uint32_t c) { return na_wave_patch (a, module, b, c); }); }));
            },
            [] (const juce::String& name) {
                wave::Table t (na_table_frames (name.toRawUTF8(), nullptr, 0));
                if (!t.empty())
                    na_table_frames (name.toRawUTF8(), t.front().data(), (uint32_t) t.size());
                return t;
            });
        wave->setTopLeftPosition (0, header);
        addAndMakeVisible (*wave);
        for (auto& s : sockets)
            s->toFront (false);
        return;
    }

    // The controls, in a fixed grid between the sockets.
    const int left = 24, top = header + 6;
    const int columns = juce::jmax (1, (getWidth() - 2 * left) / cellW);
    auto* list = kind.controls.getArray();
    for (int i = 0; list != nullptr && i < list->size(); ++i)
    {
        const auto& c = list->getReference (i);
        const auto type = c["type"].toString();
        const auto key = c["key"].toString();
        const int x = left + (i % columns) * cellW, y = top + (i / columns) * cellH;

        auto label = std::make_unique<juce::Label> (key, key);
        label->setFont (font (10.0f));
        label->setColour (juce::Label::textColourId, dimColour);
        label->setJustificationType (juce::Justification::centred);
        label->setBounds (x, y, cellW, 14);
        label->setTooltip (key);
        label->setInterceptsMouseClicks (false, false);
        addAndMakeVisible (*label);
        labels.push_back (std::move (label));

        if (type == "knob")
        {
            auto s = std::make_unique<juce::Slider> (juce::Slider::RotaryHorizontalVerticalDrag, juce::Slider::TextBoxBelow);
            const double step = (double) c["step"];
            s->setRange ((double) c["min"], (double) c["max"], step > 0.0 ? step : 0.0);
            s->setValue ((double) c["default"], juce::dontSendNotification);
            s->setDoubleClickReturnValue (true, (double) c["default"]);
            s->setNumDecimalPlacesToDisplay (step > 0.0 ? 0 : 3);
            s->setTextBoxStyle (juce::Slider::TextBoxBelow, false, cellW - 8, 14);
            s->setScrollWheelEnabled (false);
            s->setTooltip (key);
            s->setBounds (x + 4, y + 14, cellW - 8, cellH - 18);
            s->onValueChange = [this, i, knob = s.get()] { canvas.set (id, i, (float) knob->getValue()); };
            addAndMakeVisible (*s);
            controls.push_back (std::move (s));
        }
        else if (type == "switch")
        {
            auto b = std::make_unique<juce::ToggleButton> ("on");
            b->setToggleState ((double) c["default"] >= 0.5, juce::dontSendNotification);
            b->setTooltip (key);
            b->setBounds (x + 12, y + 30, cellW - 16, 24);
            b->onClick = [this, i, button = b.get()] { canvas.set (id, i, button->getToggleState() ? 1.0f : 0.0f); };
            addAndMakeVisible (*b);
            controls.push_back (std::move (b));
        }
        else
        {
            auto box = std::make_unique<juce::ComboBox> (key);
            if (auto* options = c["options"].getArray())
                for (int o = 0; o < options->size(); ++o)
                    box->addItem (options->getReference (o).toString(), o + 1);
            box->setSelectedId ((int) c["default"] + 1, juce::dontSendNotification);
            box->setTooltip (key);
            box->setBounds (x + 2, y + 30, cellW - 4, 22);
            box->onChange = [this, i, b = box.get()] {
                if (b->getSelectedId() > 0)
                    canvas.set (id, i, (float) (b->getSelectedId() - 1));
            };
            addAndMakeVisible (*box);
            controls.push_back (std::move (box));
        }
    }

    if (kind.keyboard)
    {
        keyboard = std::make_unique<juce::MidiKeyboardComponent> (keyState, juce::MidiKeyboardComponent::horizontalKeyboard);
        keyboard->setAvailableRange (21, 108);
        const int width = getWidth() - 2 * left;
        keyboard->setBounds (left, getHeight() - keyboardH - 8, width, keyboardH);
        keyboard->setKeyWidth ((float) width / 52.0f);
        keyboard->setLowestVisibleKey (21);
        keyboard->setVelocity (0.8f, true);
        addAndMakeVisible (*keyboard);
        keyState.addListener (this);
    }
}

void ModuleFace::setValues (const juce::var& values)
{
    auto* list = values.getArray();
    if (list == nullptr)
        return;
    for (size_t i = 0; i < controls.size() && (int) i < list->size(); ++i)
    {
        const double v = (double) list->getReference ((int) i);
        if (auto* s = dynamic_cast<juce::Slider*> (controls[i].get()))
            s->setValue (v, juce::dontSendNotification);
        else if (auto* b = dynamic_cast<juce::ToggleButton*> (controls[i].get()))
            b->setToggleState (v >= 0.5, juce::dontSendNotification);
        else if (auto* box = dynamic_cast<juce::ComboBox*> (controls[i].get()))
            box->setSelectedId (v < 0.0 ? 0 : (int) v + 1, juce::dontSendNotification);
    }
}

void ModuleFace::setPatchName (const juce::String& name)
{
    patchName = name;
    repaint();
}

void ModuleFace::paint (juce::Graphics& g)
{
    auto r = getLocalBounds().toFloat();
    g.setColour (faceColour);
    g.fillRoundedRectangle (r, 6.0f);
    g.setColour (headerColour);
    g.fillRoundedRectangle (r.withHeight ((float) header), 6.0f);
    g.fillRect (r.withTop ((float) header - 6.0f).withHeight (6.0f));
    g.setColour (inkColour);
    g.setFont (font (13.0f, true));
    juce::String title = kind.title + "  " + juce::String (id);
    g.drawText (title, 10, 0, 300, header, juce::Justification::centredLeft);
    if (patchName.isNotEmpty())
    {
        g.setColour (dimColour);
        g.setFont (font (11.0f));
        g.drawText (patchName, 140, 0, 400, header, juce::Justification::centredLeft);
    }
    g.setFont (font (9.0f));
    g.setColour (dimColour);
    for (auto& s : sockets)
    {
        auto b = s->getBounds();
        if (s->isInput)
            g.drawText (s->name, b.getRight() + 2, b.getY(), 60, b.getHeight(), juce::Justification::centredLeft);
        else
            g.drawText (s->name, b.getX() - 62, b.getY(), 60, b.getHeight(), juce::Justification::centredRight);
    }
}

// Drag the header to move the module.
void ModuleFace::mouseDown (const juce::MouseEvent& e)
{
    moving = e.y < header;
    grabbedAt = e.getPosition();
    if (moving)
        toFront (false);
}

void ModuleFace::mouseDrag (const juce::MouseEvent& e)
{
    if (!moving)
        return;
    auto onBoard = e.getEventRelativeTo (getParentComponent()).getPosition() - grabbedAt;
    setTopLeftPosition (juce::jlimit (0, Board::size - getWidth(), onBoard.x), juce::jlimit (0, Board::size - getHeight(), onBoard.y));
    getParentComponent()->repaint();
}

void ModuleFace::mouseUp (const juce::MouseEvent&)
{
    if (moving)
        canvas.faceMoved (id);
    moving = false;
}

void ModuleFace::presetMenu()
{
    juce::PopupMenu m;
    m.addItem ("Open preset...", [this] { canvas.openWavePreset (id); });
    m.addItem ("Save preset...", [this] { canvas.saveWavePreset (id); });
    m.showMenuAsync (juce::PopupMenu::Options().withTargetComponent (&preset));
}

void ModuleFace::handleNoteOn (juce::MidiKeyboardState*, int, int n, float velocity)
{
    canvas.note (id, true, n, velocity);
}

void ModuleFace::handleNoteOff (juce::MidiKeyboardState*, int, int n, float)
{
    canvas.note (id, false, n, 0.0f);
}

// ──────────────────────────────────────────────────────────────── cables

void CableLayer::paint (juce::Graphics& g)
{
    for (size_t i = 0; i < canvas.wires.size(); ++i)
    {
        auto* from = canvas.socketOf (canvas.wires[i].from, false, canvas.wires[i].fromSocket);
        g.setColour (from != nullptr ? typeColour (from->type) : dimColour);
        g.strokePath (canvas.wirePath (canvas.wires[i]), juce::PathStrokeType ((int) i == canvas.selectedWire ? 5.0f : 3.0f));
    }
    if (canvas.pendingFrom != nullptr)
    {
        const auto a = canvas.pendingFrom->centreOnBoard(), b = canvas.pendingEnd;
        juce::Path p;
        p.startNewSubPath (a);
        const float dx = juce::jmax (40.0f, std::abs (b.x - a.x) * 0.5f) * (canvas.pendingFrom->isInput ? -1.0f : 1.0f);
        p.cubicTo (a.x + dx, a.y, b.x - dx, b.y, b.x, b.y);
        g.setColour (typeColour (canvas.pendingFrom->type).withAlpha (0.7f));
        g.strokePath (p, juce::PathStrokeType (3.0f));
    }
}

bool CableLayer::hitTest (int x, int y)
{
    const juce::Point<float> at ((float) x, (float) y);
    for (const auto& w : canvas.wires)
    {
        juce::Point<float> nearest;
        canvas.wirePath (w).getNearestPoint (at, nearest);
        if (nearest.getDistanceFrom (at) < 6.0f)
            return true;
    }
    return false;
}

void CableLayer::mouseDown (const juce::MouseEvent& e)
{
    int best = -1;
    float bestDistance = 6.0f;
    for (size_t i = 0; i < canvas.wires.size(); ++i)
    {
        juce::Point<float> nearest;
        canvas.wirePath (canvas.wires[i]).getNearestPoint (e.position, nearest);
        const float d = nearest.getDistanceFrom (e.position);
        if (d < bestDistance)
            best = (int) i, bestDistance = d;
    }
    canvas.selectedWire = best;
    repaint();
    canvas.grabKeyboardFocus();
    if (best >= 0 && e.mods.isPopupMenu())
    {
        juce::PopupMenu m;
        m.addItem ("Remove cable", [c = &canvas, best] { c->removeWire (best); });
        m.showMenuAsync ({});
    }
    else if (best >= 0 && canvas.status)
        canvas.status ("Cable selected: press Delete to remove it");
}

// ───────────────────────────────────────────────────────────────── board

void Board::paint (juce::Graphics& g)
{
    g.fillAll (boardColour);
    g.setColour (juce::Colour (0xff22252b));
    const auto clip = g.getClipBounds();
    const int step = 40;
    for (int x = clip.getX() / step * step; x < clip.getRight(); x += step)
        for (int y = clip.getY() / step * step; y < clip.getBottom(); y += step)
            g.fillRect (x, y, 2, 2);
}

void Board::mouseDown (const juce::MouseEvent& e)
{
    canvas.selectedWire = -1;
    canvas.repaint();
    canvas.grabKeyboardFocus();
    if (e.mods.isPopupMenu())
    {
        juce::PopupMenu m;
        const auto at = e.position;
        for (const auto& k : canvas.kinds)
            m.addItem ("Add " + k.title, [c = &canvas, id = k.id, at] { c->addModule (id, at); });
        m.showMenuAsync ({});
        return;
    }
    panFrom = e.getEventRelativeTo (&canvas).position;
    offsetFrom = canvas.offset;
}

void Board::mouseDrag (const juce::MouseEvent& e)
{
    if (e.mods.isPopupMenu())
        return;
    canvas.offset = offsetFrom + (e.getEventRelativeTo (&canvas).position - panFrom);
    canvas.panBy ({});
}

void Board::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& wheel)
{
    const auto at = e.getEventRelativeTo (&canvas).position;
    if (e.mods.isCommandDown())
        canvas.zoomBy (std::pow (1.15f, wheel.deltaY * 4.0f), at);
    else
        canvas.panBy ({ wheel.deltaX * 400.0f, wheel.deltaY * 400.0f });
}

void Board::mouseMagnify (const juce::MouseEvent& e, float scale)
{
    canvas.zoomBy (scale, e.getEventRelativeTo (&canvas).position);
}

// ──────────────────────────────────────────────────────────────── canvas

Canvas::Canvas (Host& h) : host (h)
{
    setWantsKeyboardFocus (true);
    const auto kindsJson = juce::JSON::parse (juce::String (naText ([] (char* b, uint32_t c) { return na_kinds (b, c); })));
    if (auto* list = kindsJson.getArray())
    {
        for (const auto& k : *list)
        {
            KindInfo info;
            info.id = k["id"].toString();
            info.title = k["title"].toString();
            info.width = (int) k["width"];
            info.height = (int) k["height"];
            info.keyboard = (bool) k["keyboard"];
            for (auto* side : { &info.ins, &info.outs })
                if (auto* sockets = k[side == &info.ins ? "ins" : "outs"].getArray())
                    for (const auto& s : *sockets)
                        side->push_back ({ s["name"].toString(), s["type"].toString() });
            const auto id = info.id.toStdString();
            info.controls = juce::JSON::parse (juce::String (naText ([&id] (char* b, uint32_t c) { return na_controls (id.c_str(), b, c); })));
            kinds.push_back (std::move (info));
        }
    }
    board.setBounds (0, 0, Board::size, Board::size);
    cables.setBounds (board.getLocalBounds());
    board.addAndMakeVisible (cables);
    addAndMakeVisible (board);
    host.onRebuilt = [this] { refresh(); };
}

Canvas::~Canvas()
{
    host.onRebuilt = nullptr;
}

const KindInfo* Canvas::kindById (const juce::String& id) const
{
    for (const auto& k : kinds)
        if (k.id == id)
            return &k;
    return nullptr;
}

void Canvas::report (int code, const juce::String& what)
{
    if (status)
        status (code < 0 ? what + " didn't work: " + juce::String (host.lastError()) : what);
}

// MIDI in into Wave into Output, so there is something to play at once.
void Canvas::starter()
{
    const auto ids = host.with ([] (NaApp* a) {
        const int midi = na_add (a, "midi-in", 120.0f, 500.0f);
        const int wave = na_add (a, "wave", 420.0f, 120.0f);
        const int out = na_add (a, "output", 1960.0f, 450.0f);
        na_connect (a, (uint32_t) midi, 0, (uint32_t) wave, 0);
        na_connect (a, (uint32_t) wave, 0, (uint32_t) out, 0);
        return std::array<int, 3> { midi, wave, out };
    });
    refresh();
    fit();
    if (status)
        status (ids[1] > 0 ? "A new canvas: MIDI in into Wave into Output. Play the keys on Wave or a MIDI keyboard."
                           : "Couldn't make the starting canvas: " + juce::String (host.lastError()));
}

void Canvas::addModule (const juce::String& kind, juce::Point<float> onBoard)
{
    const auto k = kind.toStdString();
    const int id = host.with ([&] (NaApp* a) { return na_add (a, k.c_str(), onBoard.x, onBoard.y); });
    if (id < 0)
        return report (id, "Adding " + kind);
    refresh();
    if (auto* info = kindById (kind))
        report (0, "Added " + info->title + " " + juce::String (id));
}

void Canvas::removeModule (int id)
{
    const int code = host.with ([id] (NaApp* a) { return na_remove (a, (uint32_t) id); });
    if (code < 0)
        return report (code, "Removing module " + juce::String (id));
    refresh();
    report (0, "Removed module " + juce::String (id));
}

void Canvas::newCanvas()
{
    host.with ([] (NaApp* a) {
        return na_load (a, "{\"format\":\"idmlab-patch\",\"version\":1,\"modules\":[],\"cables\":[]}");
    });
    currentFile = juce::File();
    starter();
}

void Canvas::refresh()
{
    const auto described = juce::JSON::parse (juce::String (host.with ([] (NaApp* a) {
        return naText ([a] (char* b, uint32_t c) { return na_describe (a, b, c); });
    })));
    faces.clear();
    wires.clear();
    selectedWire = -1;
    if (auto* modules = described["modules"].getArray())
    {
        for (const auto& m : *modules)
        {
            const auto* kind = kindById (m["kind"].toString());
            if (kind == nullptr)
                continue;
            const int id = (int) m["id"];
            auto face = std::make_unique<ModuleFace> (*this, id, *kind);
            face->setTopLeftPosition ((int) (double) m["x"], (int) (double) m["y"]);
            face->setValues (m["values"]);
            face->setPatchName (m["name"].toString());
            board.addAndMakeVisible (*face);
            faces[id] = std::move (face);
        }
    }
    if (auto* list = described["cables"].getArray())
        for (const auto& c : *list)
            wires.push_back ({ (int) c["from"][0], (int) c["from"][1], (int) c["to"][0], (int) c["to"][1] });
    cables.toFront (false);
    const auto& view = described["view"];
    if (view.isObject())
    {
        zoom = juce::jlimit (0.1f, 2.0f, (float) (double) view["zoom"]);
        offset = { (float) (double) view["x"], (float) (double) view["y"] };
        applyTransform();
    }
    pushMidiIns();
    board.repaint();
}

void Canvas::pushMidiIns()
{
    std::vector<uint32_t> ids;
    for (const auto& [id, face] : faces)
        if (face->kind.id == "midi-in")
            ids.push_back ((uint32_t) id);
    host.setMidiIns (std::move (ids));
}

void Canvas::pushView()
{
    juce::DynamicObject::Ptr v = new juce::DynamicObject();
    v->setProperty ("zoom", zoom);
    v->setProperty ("x", offset.x);
    v->setProperty ("y", offset.y);
    const auto text = juce::JSON::toString (juce::var (v.get()), true).toStdString();
    host.with ([&] (NaApp* a) { return na_set_view (a, text.c_str()); });
}

void Canvas::writePatch (const juce::File& file)
{
    pushView();
    const auto text = host.with ([] (NaApp* a) { return naText ([a] (char* b, uint32_t c) { return na_save (a, b, c); }); });
    if (file.replaceWithText (juce::String::fromUTF8 (text.c_str())))
    {
        currentFile = file;
        report (0, "Saved " + file.getFullPathName());
    }
    else if (status)
        status ("Couldn't write " + file.getFullPathName());
}

void Canvas::savePatch (bool askWhere)
{
    if (!askWhere && currentFile != juce::File())
        return writePatch (currentFile);
    chooser = std::make_unique<juce::FileChooser> ("Save the canvas", places::patches().getChildFile ("canvas.json"), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                          [this] (const juce::FileChooser& fc) {
                              const auto f = fc.getResult();
                              if (f != juce::File())
                                  writePatch (f.withFileExtension ("json"));
                          });
}

void Canvas::openPatch()
{
    chooser = std::make_unique<juce::FileChooser> ("Open a canvas", places::patches(), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                          [this] (const juce::FileChooser& fc) {
                              const auto f = fc.getResult();
                              if (f == juce::File())
                                  return;
                              const auto text = f.loadFileAsString().toStdString();
                              const int code = host.with ([&] (NaApp* a) { return na_load (a, text.c_str()); });
                              if (code < 0)
                                  return report (code, "Opening " + f.getFileName());
                              currentFile = f;
                              refresh();
                              report (0, "Opened " + f.getFullPathName());
                          });
}

void Canvas::openWavePreset (int id)
{
    const auto start = places::mglWavePresets().isDirectory() ? places::mglWavePresets() : places::wavePresets();
    chooser = std::make_unique<juce::FileChooser> ("Open a Wave preset", start, "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles,
                          [this, id] (const juce::FileChooser& fc) {
                              const auto f = fc.getResult();
                              if (f == juce::File())
                                  return;
                              const auto text = f.loadFileAsString().toStdString();
                              const int code = host.with ([&] (NaApp* a) { return na_load_wave_patch (a, (uint32_t) id, text.c_str()); });
                              if (code < 0)
                                  return report (code, "Opening " + f.getFileName());
                              refresh();
                              report (0, "Wave " + juce::String (id) + " plays " + f.getFileNameWithoutExtension());
                          });
}

void Canvas::saveWavePreset (int id)
{
    chooser = std::make_unique<juce::FileChooser> ("Save a Wave preset", places::wavePresets().getChildFile ("preset.json"), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting,
                          [this, id] (const juce::FileChooser& fc) {
                              auto f = fc.getResult();
                              if (f == juce::File())
                                  return;
                              f = f.withFileExtension ("json");
                              const auto patch = host.with ([id] (NaApp* a) {
                                  return naText ([a, id] (char* b, uint32_t c) { return na_wave_patch (a, (uint32_t) id, b, c); });
                              });
                              // MGL's preset shape, so its Wave page can open it too.
                              juce::DynamicObject::Ptr held = new juce::DynamicObject();
                              held->setProperty ("name", f.getFileNameWithoutExtension());
                              held->setProperty ("tags", juce::Array<juce::var>());
                              held->setProperty ("patch", juce::JSON::parse (juce::String::fromUTF8 (patch.c_str())));
                              held->setProperty ("hidden", false);
                              if (f.replaceWithText (juce::JSON::toString (juce::var (held.get()))))
                                  report (0, "Saved the preset " + f.getFullPathName());
                              else if (status)
                                  status ("Couldn't write " + f.getFullPathName());
                          });
}

void Canvas::set (int id, int index, float value)
{
    const int code = host.with ([=] (NaApp* a) { return na_set (a, (uint32_t) id, (uint32_t) index, value); });
    if (code < 0)
        report (code, "That control");
}

void Canvas::note (int id, bool on, int n, float velocity)
{
    host.with ([=] (NaApp* a) { return na_note (a, (uint32_t) id, on ? 1u : 0u, (uint32_t) n, velocity); });
}

void Canvas::faceMoved (int id)
{
    auto it = faces.find (id);
    if (it == faces.end())
        return;
    const auto p = it->second->getPosition().toFloat();
    host.with ([=] (NaApp* a) { return na_place (a, (uint32_t) id, p.x, p.y); });
}

Socket* Canvas::socketOf (int module, bool isInput, int index) const
{
    auto it = faces.find (module);
    if (it == faces.end())
        return nullptr;
    for (auto& s : it->second->sockets)
        if (s->isInput == isInput && s->index == index)
            return s.get();
    return nullptr;
}

juce::Path Canvas::wirePath (const Wire& w) const
{
    juce::Path p;
    auto* a = socketOf (w.from, false, w.fromSocket);
    auto* b = socketOf (w.to, true, w.toSocket);
    if (a == nullptr || b == nullptr)
        return p;
    const auto from = a->centreOnBoard(), to = b->centreOnBoard();
    const float dx = juce::jmax (40.0f, std::abs (to.x - from.x) * 0.5f);
    p.startNewSubPath (from);
    p.cubicTo (from.x + dx, from.y, to.x - dx, to.y, to.x, to.y);
    return p;
}

void Canvas::beginCable (Socket* s)
{
    pendingFrom = s;
    pendingEnd = s->centreOnBoard();
}

void Canvas::dragCable (juce::Point<float> onBoard)
{
    pendingEnd = onBoard;
    cables.repaint();
}

void Canvas::endCable (juce::Point<float> onBoard)
{
    auto* from = pendingFrom;
    pendingFrom = nullptr;
    cables.repaint();
    if (from == nullptr)
        return;
    Socket* target = nullptr;
    for (const auto& [id, face] : faces)
        for (auto& s : face->sockets)
            if (s.get() != from && s->getBounds().translated (face->getX(), face->getY()).expanded (6).toFloat().contains (onBoard))
                target = s.get();
    if (target == nullptr || target->isInput == from->isInput)
        return;
    auto* out = from->isInput ? target : from;
    auto* in = from->isInput ? from : target;
    const int code = host.with ([=] (NaApp* a) {
        return na_connect (a, (uint32_t) out->module, (uint32_t) out->index, (uint32_t) in->module, (uint32_t) in->index);
    });
    if (code < 0)
        return report (code, "That cable");
    wires.push_back ({ out->module, out->index, in->module, in->index });
    cables.repaint();
    report (0, "Cabled " + juce::String (out->module) + " " + out->name + " to " + juce::String (in->module) + " " + in->name);
}

void Canvas::removeWire (int index)
{
    if (index < 0 || index >= (int) wires.size())
        return;
    const auto w = wires[(size_t) index];
    const int code = host.with ([=] (NaApp* a) {
        return na_disconnect (a, (uint32_t) w.from, (uint32_t) w.fromSocket, (uint32_t) w.to, (uint32_t) w.toSocket);
    });
    if (code < 0)
        return report (code, "Removing the cable");
    wires.erase (wires.begin() + index);
    selectedWire = -1;
    cables.repaint();
    report (0, "Removed the cable");
}

bool Canvas::keyPressed (const juce::KeyPress& key)
{
    if ((key == juce::KeyPress::deleteKey || key == juce::KeyPress::backspaceKey) && selectedWire >= 0)
    {
        removeWire (selectedWire);
        return true;
    }
    return false;
}

void Canvas::applyTransform()
{
    board.setTransform (juce::AffineTransform::scale (zoom).translated (offset));
}

void Canvas::panBy (juce::Point<float> delta)
{
    offset += delta;
    applyTransform();
}

juce::Point<float> Canvas::boardPoint (juce::Point<float> onCanvas) const
{
    return (onCanvas - offset) / zoom;
}

void Canvas::zoomBy (float factor, juce::Point<float> around)
{
    const auto fixed = boardPoint (around);
    zoom = juce::jlimit (0.1f, 2.0f, zoom * factor);
    offset = around - fixed * zoom;
    applyTransform();
    if (status)
        status ("Zoom " + juce::String (juce::roundToInt (zoom * 100.0f)) + "%");
}

void Canvas::fit()
{
    if (faces.empty())
        return actualSize();
    juce::Rectangle<int> all = faces.begin()->second->getBounds();
    for (const auto& [id, face] : faces)
        all = all.getUnion (face->getBounds());
    const auto area = getLocalBounds().toFloat().reduced (20.0f);
    zoom = juce::jlimit (0.1f, 1.0f, juce::jmin (area.getWidth() / (float) all.getWidth(), area.getHeight() / (float) all.getHeight()));
    offset = area.getCentre() - all.toFloat().getCentre() * zoom;
    applyTransform();
    if (status)
        status ("Fit: zoom " + juce::String (juce::roundToInt (zoom * 100.0f)) + "%");
}

void Canvas::actualSize()
{
    zoomBy (1.0f / zoom, getLocalBounds().getCentre().toFloat());
}

void Canvas::resized()
{
    applyTransform();
}
