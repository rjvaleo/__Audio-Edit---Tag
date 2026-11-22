#include "Canvas.h"

#include "Places.h"

namespace
{
float num (const juce::var& v, float fallback = 0.0f)
{
    return v.isVoid() || v.isUndefined() ? fallback : (float) (double) v;
}

// The captured parts of idMLab's canvas.
const juce::var& frameTree() { return face::part ("idmlab-node-audio")["tree"]; }
const juce::var& canvasStyle() { return face::part ("idmlab-style"); }

const juce::var* frameNode (const char* cls)
{
    return face::find (frameTree(), cls);
}

// A module's accent, as idMLab's families colour them.
juce::Colour accentFor (const juce::String& kind)
{
    const auto& a = canvasStyle()["accents"];
    if (kind == "midi-in")
        return c2d::css (a["m.midi-output"].toString().isEmpty() ? "#9b5de5" : a["m.midi-output"].toString());
    return c2d::css (a["m.audio-output"].toString().isEmpty() ? "#ef755a" : a["m.audio-output"].toString());
}

// The jack the worn kit draws for a socket of this kind, and its label.
const juce::var* jackPart (const juce::String& type, bool isInput, const juce::var*& label)
{
    const juce::var* port = face::jack (type, isInput);
    if (port == nullptr)
    {
        const bool audio = type == "audio";
        const auto& tree = face::part (audio ? "idmlab-node-audio" : "idmlab-node-notes")["tree"];
        port = face::find (tree, audio ? "mm-port--audio" : "mm-port--note-event");
    }
    label = port != nullptr ? face::find (*port, "mm-port__label") : nullptr;
    return port;
}

juce::Colour cssColour (const juce::var& v, const char* fallback)
{
    const auto s = v.toString();
    return c2d::css (s.isEmpty() ? juce::String (fallback) : s);
}

// A drop-shadow's colour and blur from a computed `filter` value.
std::pair<juce::Colour, float> glowOf (const juce::String& filter)
{
    // drop-shadow(color(srgb r g b / a) 0px 0px 5px)
    auto inner = filter.fromFirstOccurrenceOf ("srgb", false, false).upToFirstOccurrenceOf (")", false, false);
    auto p = juce::StringArray::fromTokens (inner.replace ("/", " "), " ", "");
    p.removeEmptyStrings();
    juce::Colour c (154, 154, 162);
    if (p.size() >= 4)
        c = juce::Colour::fromFloatRGBA (p[0].getFloatValue(), p[1].getFloatValue(), p[2].getFloatValue(), p[3].getFloatValue());
    const float blur = filter.trim().dropLastCharacters (1).fromLastOccurrenceOf (" ", false, false).getFloatValue();
    return { c, blur > 0 ? blur : 5.0f };
}
} // namespace

// ───────────────────────────────────────────────────────────────── camera

// A module's picture, kept at a few fixed sharpnesses (a power of two of the
// screen's pixels, as many as it takes to stay sharp) rather than at exactly
// the zoom: between steps the canvas only scales the picture, so zooming never
// waits for every module to be drawn again; it is drawn again only when the
// zoom crosses into another step. Otherwise as JUCE's own cache
// (StandardCachedComponentImage).
class SteppedCache final : public juce::CachedComponentImage
{
public:
    explicit SteppedCache (juce::Component& c) : owner (c) {}

    // The step for a screen scale: the next power of two up, no larger than
    // keeps the picture under about 24 million pixels.
    static float stepFor (float scale, juce::Rectangle<int> bounds)
    {
        float step = 0.25f;
        while (step < scale && step < 8.0f)
            step *= 2.0f;
        const float area = (float) juce::jmax (1, bounds.getWidth() * bounds.getHeight());
        const float most = std::sqrt (24.0e6f / area);
        return juce::jmax (0.25f, juce::jmin (step, most));
    }

    void paint (juce::Graphics& g) override
    {
        const float scale = g.getInternalContext().getPhysicalPixelScaleFactor();
        const auto bounds = owner.getLocalBounds();
        // The step it has, kept while it is near enough (a little soft above
        // it, down to well below it), so a zoom back and forth across a step
        // does not draw the module again each time.
        if (step <= 0 || scale > step * 1.15f || scale < step / 2.5f)
            step = stepFor (scale, bounds);
        const auto imageBounds = (bounds.toFloat() * step).getSmallestIntegerContainer();
        if (image.isNull() || image.getBounds() != imageBounds.withZeroOrigin())
        {
            image = juce::Image (juce::Image::ARGB, juce::jmax (1, imageBounds.getWidth()), juce::jmax (1, imageBounds.getHeight()), true,
                                 *g.getInternalContext().getPreferredImageTypeForTemporaryImages());
            image.setBackupEnabled (false);
            valid.clear();
        }
        if (auto ptr = image.getPixelData())
            if (auto* ext = ptr->getBackupExtensions())
                if (ext->needsBackup() && !ext->canBackup())
                    valid.clear();
        if (!valid.containsRectangle (bounds))
        {
            juce::Graphics ig (image);
            auto& lg = ig.getInternalContext();
            lg.addTransform (juce::AffineTransform::scale (step));
            for (auto& r : valid)
                lg.excludeClipRectangle (r);
            lg.setFill (juce::Colours::transparentBlack);
            lg.fillRect (bounds, true);
            lg.setFill (juce::Colours::black);
            owner.paintEntireComponent (ig, true);
        }
        valid = bounds;
        g.setColour (juce::Colours::black.withAlpha (owner.getAlpha()));
        g.setImageResamplingQuality (juce::Graphics::highResamplingQuality);
        g.drawImageTransformed (image, juce::AffineTransform::scale ((float) bounds.getWidth() / (float) image.getWidth(), (float) bounds.getHeight() / (float) image.getHeight()), false);
    }
    bool invalidateAll() override { valid.clear(); return true; }
    bool invalidate (const juce::Rectangle<int>& area) override { valid.subtract (area); return true; }
    void releaseResources() override { image = {}; }

private:
    juce::Component& owner;
    juce::Image image;
    juce::RectangleList<int> valid;
    float step = 0;
};

namespace camera
{
float clampZoom (float z) { return std::isfinite (z) ? juce::jlimit (minZoom, maxZoom, z) : 1.0f; }

juce::Point<float> toCanvas (const Camera& c, juce::Point<float> s) { return { (s.x + c.left) / c.zoom, (s.y + c.top) / c.zoom }; }

Camera zoomAround (const Camera& c, juce::Point<float> p, float factor)
{
    const float z = clampZoom (c.zoom * factor);
    if (std::abs (z - c.zoom) < 1e-7f)
        return c;
    const auto at = toCanvas (c, p);
    return { at.x * z - p.x, at.y * z - p.y, z };
}

Camera panBy (const Camera& c, float dx, float dy) { return { c.left - dx, c.top - dy, c.zoom }; }

Camera centreOn (juce::Point<float> point, juce::Point<float> view, float zoom) { return { point.x * zoom - view.x / 2, point.y * zoom - view.y / 2, zoom }; }

// The whole patch in view with a margin round it, never magnified past 100%.
Camera fit (const std::vector<juce::Rectangle<float>>& boxes, juce::Point<float> view, float margin)
{
    if (boxes.empty())
        return {};
    auto all = boxes.front();
    for (auto& b : boxes)
        all = all.getUnion (b);
    const float zoom = clampZoom (juce::jmin (1.0f, (view.x - margin * 2) / juce::jmax (1.0f, all.getWidth()), (view.y - margin * 2) / juce::jmax (1.0f, all.getHeight())));
    return centreOn (all.getCentre(), view, zoom);
}
} // namespace camera

// ──────────────────────────────────────────────────────────────── sockets

Jack::Jack (Canvas& c, int m, bool in, int i, const SocketInfo& info)
    : module (m), isInput (in), index (i), type (info.type), name (info.name), canvas (c)
{
    setSize (size, size);
    setTooltip (name);
    const juce::var* label = nullptr;
    if (auto* port = jackPart (type, isInput, label))
        if (auto* svg = face::find (*port, "svg"))
            art = juce::Drawable::createFromSVGString ((*svg)["svg"].toString());
}

juce::Point<float> Jack::centreOnStage() const
{
    auto* node = getParentComponent();
    return (node->getPosition() + getBounds().getCentre()).toFloat();
}

void Jack::paint (juce::Graphics& g)
{
    if (art != nullptr)
        art->drawWithin (g, getLocalBounds().toFloat().expanded (1.0f), juce::RectanglePlacement::centred, 1.0f);
}

void Jack::mouseDown (const juce::MouseEvent& e)
{
    if (canvas.panGesture (e))
        return;
    canvas.beginCable (this);
}

void Jack::mouseDrag (const juce::MouseEvent& e)
{
    if (!canvas.isPanning())
        canvas.dragCable (e.getEventRelativeTo (&canvas.stage).position);
}

void Jack::mouseUp (const juce::MouseEvent& e)
{
    if (!canvas.isPanning())
        canvas.endCable (e.getEventRelativeTo (&canvas.stage).position);
}

// ───────────────────────────────────────────────────────────────── modules

Node::Node (Canvas& c, int i, const KindInfo& k) : id (i), kind (k), canvas (c)
{
    accent = accentFor (kind.id);
    // A pan moves a finished picture of the module; a change inside it draws
    // only that part again.
    setCachedComponentImage (new SteppedCache (*this));

    for (int s = 0; s < (int) kind.ins.size(); ++s)
    {
        jacks.push_back (std::make_unique<Jack> (canvas, id, true, s, kind.ins[(size_t) s]));
        addAndMakeVisible (*jacks.back());
    }
    for (int s = 0; s < (int) kind.outs.size(); ++s)
    {
        jacks.push_back (std::make_unique<Jack> (canvas, id, false, s, kind.outs[(size_t) s]));
        addAndMakeVisible (*jacks.back());
    }
    if (kind.id == "wave")
    {
        auto* host = &canvas.host;
        const auto module = (uint32_t) id;
        wave = std::make_unique<WaveFace> (
            [host, module] (const juce::String& key, const juce::String& value) {
                host->with ([&] (NaApp* a) { return na_wave_set (a, module, key.toRawUTF8(), value.toRawUTF8()); });
            },
            [host, module] {
                return juce::String (host->with ([&] (NaApp* a) { return naText ([&] (char* b, uint32_t cap) { return na_wave_patch (a, module, b, cap); }); }));
            },
            [] (const juce::String& name) {
                wave::Table t (na_table_frames (name.toRawUTF8(), nullptr, 0));
                if (!t.empty())
                    na_table_frames (name.toRawUTF8(), t.front().data(), (uint32_t) t.size());
                return t;
            });
        wave->onNote = [host, module] (int n, float vel, bool on) {
            host->with ([&] (NaApp* a) { return na_note (a, module, on ? 1u : 0u, (uint32_t) n, vel); });
        };
        wave->onWheel = [host, module] (int which, float value) {
            host->with ([&] (NaApp* a) { return na_wave_wheel (a, module, (uint32_t) which, value); });
        };
        wave->blocked = [this] (const juce::MouseEvent& e) { return canvas.panGesture (e); };
        addAndMakeVisible (*wave);
    }
    else if (kind.id == "atmos")
    {
        auto* host = &canvas.host;
        const auto module = (uint32_t) id;
        atmos = std::make_unique<AtmosFace> (
            [host, module] (const juce::String& key, const juce::String& value) {
                host->with ([&] (NaApp* a) { return na_atmos_set (a, module, key.toRawUTF8(), value.toRawUTF8()); });
            },
            [host, module] {
                return juce::String (host->with ([&] (NaApp* a) { return naText ([&] (char* b, uint32_t cap) { return na_atmos_state (a, module, b, cap); }); }));
            },
            [host, module] (int which, float* out) { return (int) host->with ([&] (NaApp* a) { return na_atmos_view (a, module, (uint32_t) which, out); }); },
            [host, module] (float* out, int n) { return (int) host->with ([&] (NaApp* a) { return na_atmos_scope (a, module, out, (uint32_t) n); }); },
            [] { return juce::String (naText ([] (char* b, uint32_t cap) { return na_fx_kinds (b, cap); })); });
        atmos->rate = (float) host->rate();
        atmos->meter = [host, module] (float* peak, float* peaks, float* work, int n) {
            return (int) host->with ([&] (NaApp* a) { return na_atmos_fx_meter (a, module, peak, peaks, work, (uint32_t) n); });
        };
        atmos->onNote = [host, module] (int n, float vel, bool on) {
            host->with ([&] (NaApp* a) { return na_note (a, module, on ? 1u : 0u, (uint32_t) n, vel); });
        };
        atmos->blocked = [this] (const juce::MouseEvent& e) { return canvas.panGesture (e); };
        addAndMakeVisible (*atmos);
    }
    else if (kind.id == "midi-in")
    {
        channel = std::make_unique<juce::ComboBox>();
        if (auto* list = kind.controls.getArray())
            if (list->size() > 0)
                if (auto* options = list->getReference (0)["options"].getArray())
                    for (int o = 0; o < options->size(); ++o)
                        channel->addItem (options->getReference (o).toString(), o + 1);
        channel->setSelectedId (1, juce::dontSendNotification);
        // idMLab's select, dark.
        channel->setColour (juce::ComboBox::backgroundColourId, juce::Colour (0xff141415));
        channel->setColour (juce::ComboBox::textColourId, juce::Colour (0xffe8e8ec));
        channel->setColour (juce::ComboBox::outlineColourId, juce::Colour (0xff3a3a3f));
        channel->setColour (juce::ComboBox::arrowColourId, juce::Colour (0xffb0b0b6));
        channel->onChange = [this] {
            if (channel->getSelectedId() > 0)
                canvas.set (id, 0, (float) (channel->getSelectedId() - 1));
        };
        addAndMakeVisible (*channel);
    }
    layout();
}

juce::Rectangle<int> Node::bodyBounds() const
{
    return { border, border + header, kind.width, kind.height };
}

void Node::layout()
{
    const int w = kind.width + 2 * border, h = collapsed ? header + 2 * border : kind.height + header + 2 * border;
    setSize (w, h);
    int in = 0, out = 0;
    for (auto& j : jacks)
    {
        // idMLab's sockets: half outside the frame, 18 px apart from y 27.
        const int y = collapsed ? 4 : 27 + 18 * (j->isInput ? in++ : out++);
        j->setTopLeftPosition (j->isInput ? -8 : w - 4, y);
    }
    if (auto* b = body())
    {
        b->setTopLeftPosition (bodyBounds().getTopLeft());
        b->setVisible (!collapsed);
    }
    if (channel != nullptr)
    {
        channel->setBounds (bodyBounds().reduced (12, 0).withHeight (24).withY (bodyBounds().getY() + 32));
        channel->setVisible (!collapsed);
    }
    // The header's parts, where idMLab puts them.
    const float hy = (float) border;
    collapseR = { 8, hy + 4, 15, 11 };
    powerR = { 28.9f, hy + 4, 12.7f, 11 };
    menuR = { 47.6f, hy + 3.5f, 17.3f, 12 };
    handleR = { 70.8f, hy + 3, 6.6f, 13 };
    closeR = { (float) w - 18.2f, hy + 3.5f, 11.2f, 12 };
    nameR = { 83.4f, hy + 3, closeR.getX() - 6 - 83.4f, 13 };
    repaint();
}

void Node::setValues (const juce::var& values)
{
    if (channel != nullptr)
        if (auto* list = values.getArray(); list != nullptr && !list->isEmpty())
            channel->setSelectedId ((int) (double) list->getReference (0) + 1, juce::dontSendNotification);
}

void Node::setPatchName (const juce::String& name)
{
    shownName = name;
    repaint();
}

void Node::paint (juce::Graphics& g)
{
    // The frame, drawn once at 2x and kept: zooming and panning only move it.
    const auto key = juce::String (getWidth()) + "x" + juce::String (getHeight()) + (collapsed ? "c" : "") + shownName + "/" + juce::String (face::stamp());
    if (!frame.isValid() || frameKey != key)
    {
        frameKey = key;
        const int pad = 48;
        frame = juce::Image (juce::Image::ARGB, (getWidth() + 2 * pad) * 2, (getHeight() + 2 * pad) * 2, true);
        juce::Graphics fg (frame);
        fg.addTransform (juce::AffineTransform::scale (2.0f).translated ((float) pad * 2, (float) pad * 2));
        paintFrame (fg);
    }
    g.setImageResamplingQuality (juce::Graphics::highResamplingQuality);
    g.drawImageTransformed (frame, juce::AffineTransform::scale (0.5f).translated (-48.0f, -48.0f));
}

void Node::paintFrame (juce::Graphics& g)
{
    const auto all = getLocalBounds().toFloat();
    if (auto* article = frameNode ("mm-node"))
        face::paintBox (g, *article, all);
    auto* head = frameNode ("n4-header");
    if (head == nullptr)
        return;
    face::paintBox (g, *head, { (float) border, (float) border, all.getWidth() - 2 * border, (float) header });
    const auto* kids = (*head)["kids"].getArray();
    auto kid = [&] (int i) -> const juce::var* { return kids != nullptr && i < kids->size() ? &kids->getReference (i) : nullptr; };
    if (auto* n = kid (0))
        face::paintText (g, *n, collapseR, juce::String::fromUTF8 (collapsed ? "\xe2\x96\xb6" : "\xe2\x96\xbc"), juce::Justification::centred);
    {
        // Bypass isn't in the native engine yet: shown, dimmed.
        juce::Graphics::ScopedSaveState keep (g);
        g.setOpacity (0.35f);
        if (auto* n = frameNode ("n4-header__power"))
            face::paintText (g, *n, powerR, juce::String::fromUTF8 ("\xe2\x8f\xbb"), juce::Justification::centred);
    }
    if (auto* menuSpan = frameNode ("n4-header__menu"))
        if (auto* b = face::find (*menuSpan, "button"))
        {
            juce::Graphics::ScopedSaveState keep (g);
            if (body() == nullptr)
                g.setOpacity (0.35f);
            face::paintText (g, *b, menuR, juce::String::fromUTF8 ("\xe2\x9a\x99\xe2\x96\xbe"), juce::Justification::centred);
        }
    if (auto* n = kid (3))
        face::paintText (g, *n, handleR, juce::String::fromUTF8 ("\xe2\x87\x95"), juce::Justification::centred);
    if (auto* n = frameNode ("n4-header__name"))
    {
        auto label = kind.title;
        if (shownName.isNotEmpty())
            label << juce::String::fromUTF8 (" \xc2\xb7 ") << shownName;
        face::paintText (g, *n, nameR, label);
    }
    if (auto* n = frameNode ("n4-header__close"))
        face::paintText (g, *n, closeR, juce::String::fromUTF8 ("\xc3\x97"), juce::Justification::centred);

    // The body of the small modules: idMLab's section with its title.
    if (!collapsed && body() == nullptr)
        if (auto* section = frameNode ("mm-node-section"))
        {
            const auto body = bodyBounds().toFloat().reduced (4);
            face::paintBox (g, *section, body);
            if (auto* h2 = face::find (*section, "h2"))
                face::paintText (g, *h2, body.reduced (1).withHeight (11), kind.id == "midi-in" ? "CHANNEL" : "OUTPUT");
            if (kind.id == "output")
                if (auto* label = face::find (*section, "n4-knob__label"))
                    face::paintText (g, *label, body.reduced (6).withY (body.getY() + 24).withHeight (10), "TO THE SOUND CARD");
        }

    // The sockets' names, outside the frame, as idMLab writes them.
    for (auto& j : jacks)
    {
        const juce::var* label = nullptr;
        jackPart (j->type, j->isInput, label);
        if (label == nullptr)
            continue;
        const auto b = j->getBounds().toFloat();
        const auto r = j->isInput ? juce::Rectangle<float> (b.getX() - 64, b.getY() - 2, 60, b.getHeight() + 4) : juce::Rectangle<float> (b.getRight() + 4, b.getY() - 2, 60, b.getHeight() + 4);
        face::paintText (g, *label, r, j->name, j->isInput ? juce::Justification::centredRight : juce::Justification::centredLeft);
    }
}

void Node::paintOverChildren (juce::Graphics& g)
{
    if (!selected)
        return;
    // idMLab's selection: a 3 px outline 3 px out, in the module's accent.
    g.setColour (accent);
    g.drawRoundedRectangle (getLocalBounds().toFloat().reduced (1.5f), 6.0f, 3.0f);
}

void Node::mouseDown (const juce::MouseEvent& e)
{
    if (canvas.panGesture (e))
        return;
    canvas.select (id);
    toFront (false);
    const auto p = e.position;
    if (p.y > (float) (header + border))
        return;
    if (collapseR.expanded (2).contains (p))
    {
        collapsed = !collapsed;
        layout();
        canvas.cables.update();
        return;
    }
    if (closeR.expanded (2).contains (p))
    {
        juce::MessageManager::callAsync ([c = &canvas, i = id] { c->removeModule (i); });
        return;
    }
    if (menuR.expanded (2).contains (p) && atmos != nullptr)
    {
        juce::PopupMenu m;
        m.addSubMenu ("Presets", canvas.atmosPresetList (id));
        m.addItem ("Open preset...", [this] { canvas.openAtmosPreset (id); });
        m.addItem ("Save preset...", [this] { canvas.saveAtmosPreset (id); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (menuR).toNearestInt()));
        return;
    }
    if (menuR.expanded (2).contains (p) && wave != nullptr)
    {
        juce::PopupMenu m;
        m.addItem ("Open preset...", [this] { canvas.openWavePreset (id); });
        m.addItem ("Save preset...", [this] { canvas.saveWavePreset (id); });
        m.showMenuAsync (juce::PopupMenu::Options().withTargetScreenArea (localAreaToGlobal (menuR).toNearestInt()));
        return;
    }
    // The header is the drag handle.
    moving = true;
    grabbedAt = e.getPosition();
}

void Node::mouseDrag (const juce::MouseEvent& e)
{
    if (!moving)
        return;
    setTopLeftPosition (e.getEventRelativeTo (&canvas.stage).getPosition() - grabbedAt);
    canvas.cables.update();
}

void Node::mouseUp (const juce::MouseEvent&)
{
    if (moving)
        canvas.nodeMoved (id);
    moving = false;
}

// ───────────────────────────────────────────────────────────────── cables

void Cables::update()
{
    juce::Rectangle<float> all;
    bool any = false;
    auto take = [&] (juce::Rectangle<float> r) {
        all = any ? all.getUnion (r) : r;
        any = true;
    };
    for (const auto& w : canvas.wires)
        take (canvas.wirePath (w).getBounds());
    if (canvas.pendingFrom != nullptr)
        take (juce::Rectangle<float> (canvas.pendingFrom->centreOnStage(), canvas.pendingEnd).expanded (90, 10));
    const auto box = any ? all.expanded (24).getSmallestIntegerContainer() : juce::Rectangle<int>();
    if (box != getBounds())
        setBounds (box);
    repaint();
}

void Cables::paint (juce::Graphics& g)
{
    // The layer sits at its own place on the stage; the cables are drawn on
    // the stage's coordinates.
    g.addTransform (juce::AffineTransform::translation ((float) -getX(), (float) -getY()));
    const auto& st = canvasStyle();
    // idMLab's cable: its stroke, width and opacity, and a soft glow round it.
    auto drawCable = [&] (const juce::Path& p, const juce::var& look, bool dashed) {
        const auto colour = cssColour (look["stroke"], "rgb(154,154,162)");
        const float width = look["stroke-width"].toString().getFloatValue();
        const float opacity = look["opacity"].toString().isEmpty() ? 1.0f : look["opacity"].toString().getFloatValue();
        const auto [glow, blur] = glowOf (look["filter"].toString());
        juce::Path stroked;
        juce::PathStrokeType type (width > 0 ? width : 5.0f);
        if (dashed)
        {
            const float dash[] = { 7, 5 };
            type.createDashedStroke (stroked, p, dash, 2);
        }
        else
            type.createStrokedPath (stroked, p);
        juce::DropShadow (glow.withMultipliedAlpha (opacity), juce::roundToInt (blur), {}).drawForPath (g, stroked);
        g.setColour (colour.withMultipliedAlpha (opacity));
        g.fillPath (stroked);
    };
    for (size_t i = 0; i < canvas.wires.size(); ++i)
        drawCable (canvas.wirePath (canvas.wires[i]), (int) i == canvas.selectedWire ? st["selected"] : st["cable"], false);
    if (canvas.pendingFrom != nullptr)
    {
        const auto a = canvas.pendingFrom->centreOnStage(), b = canvas.pendingEnd;
        const auto from = canvas.pendingFrom->isInput ? b : a, to = canvas.pendingFrom->isInput ? a : b;
        const float bend = juce::jmax (80.0f, std::abs (to.x - from.x) * 0.5f);
        juce::Path p;
        p.startNewSubPath (from);
        p.cubicTo (from.x + bend, from.y, to.x - bend, to.y, to.x, to.y);
        drawCable (p, st["dragging"], true);
    }
}

// ─────────────────────────────────────────────────────────── add module

AddMenu::AddMenu (Canvas& c, juce::Point<float> onStage) : at (onStage), canvas (c)
{
    const auto& tree = face::part ("idmlab-menu")["tree"];
    search.setTextToShowWhenEmpty (juce::String::fromUTF8 ("Search modules\xe2\x80\xa6"), juce::Colour (0xff8b8b92));
    if (auto* input = face::find (tree, "mm-module-menu__search"))
    {
        const auto& f = (*input)["font"];
        search.setFont (face::font (f));
        search.setColour (juce::TextEditor::textColourId, face::colour (f["colour"]));
        search.setColour (juce::TextEditor::backgroundColourId, (*input)["bg"].isArray() ? face::colour ((*input)["bg"]) : juce::Colour (0xff141415));
        auto* border = (*input)["border"].getArray();
        const auto line = border != nullptr && border->size() > 0 && border->getReference (0).isObject() ? face::colour (border->getReference (0)["colour"]) : juce::Colour (0xff3a3a3f);
        search.setColour (juce::TextEditor::outlineColourId, line);
        search.setColour (juce::TextEditor::focusedOutlineColourId, line.brighter (0.4f));
    }
    search.addListener (this);
    addAndMakeVisible (search);
    setSize (211, 300);
    filter();
}

void AddMenu::filter()
{
    rows.clear();
    const auto q = search.getText().trim().toLowerCase();
    // idMLab groups its modules by family; MGL's sit under their own.
    const std::vector<std::pair<juce::String, juce::StringArray>> groups {
        { "MULTIGRAINLIVE", { "wave", "atmos" } },
        { "MIDI", { "midi-in" } },
        { "AUDIO", { "output" } },
    };
    float y = 63;
    for (const auto& [label, ids] : groups)
    {
        std::vector<Row> items;
        for (const auto& kid : ids)
            if (auto* k = canvas.kindById (kid))
                if (q.isEmpty() || k->title.toLowerCase().contains (q) || label.toLowerCase().contains (q))
                    items.push_back ({ k->title, k->id, false, {} });
        if (items.empty())
            continue;
        rows.push_back ({ label, {}, true, { 8, y, 195, 20 } });
        y += 22;
        for (auto& r : items)
        {
            r.r = { 8, y, 195, 26 };
            y += 27;
            rows.push_back (r);
        }
        y += 6;
    }
    if (rows.empty())
    {
        rows.push_back ({ juce::String::fromUTF8 ("No module matches \xe2\x80\x9c") + search.getText() + juce::String::fromUTF8 ("\xe2\x80\x9d."), {}, true, { 8, y, 195, 20 } });
        y += 26;
    }
    setSize (211, (int) y + 8);
    repaint();
}

void AddMenu::resized()
{
    search.setBounds (8, 33, 195, 25);
}

void AddMenu::paint (juce::Graphics& g)
{
    const auto& tree = face::part ("idmlab-menu")["tree"];
    face::paintBox (g, tree, getLocalBounds().toFloat());
    if (auto* title = face::find (tree, "b"))
        face::paintText (g, *title, { 8, 8, 195, 22 }, "ADD MODULE");
    const juce::var* group = face::find (tree, "mm-module-menu__group");
    const juce::var* groupLabel = group != nullptr ? face::find (*group, "b") : nullptr;
    const juce::var* item = group != nullptr ? face::find (*group, "button") : nullptr;
    for (size_t i = 0; i < rows.size(); ++i)
    {
        const auto& r = rows[i];
        if (r.group)
        {
            if (groupLabel != nullptr)
                face::paintText (g, *groupLabel, r.r, r.label);
            continue;
        }
        if ((int) i == hover)
        {
            g.setColour (juce::Colours::white.withAlpha (0.08f));
            g.fillRoundedRectangle (r.r, 5.0f);
        }
        if (item != nullptr)
            face::paintText (g, *item, r.r.withTrimmedLeft (6), r.label);
    }
}

void AddMenu::mouseMove (const juce::MouseEvent& e)
{
    int h = -1;
    for (size_t i = 0; i < rows.size(); ++i)
        if (!rows[i].group && rows[i].r.contains (e.position))
            h = (int) i;
    if (h != hover)
    {
        hover = h;
        repaint();
    }
}

void AddMenu::mouseExit (const juce::MouseEvent&)
{
    hover = -1;
    repaint();
}

void AddMenu::mouseDown (const juce::MouseEvent& e)
{
    for (const auto& r : rows)
        if (!r.group && r.r.contains (e.position))
        {
            const auto kind = r.kind;
            const auto where = at;
            auto* c = &canvas;
            juce::MessageManager::callAsync ([c, kind, where] { c->addModule (kind, where); });
            return;
        }
}

// Enter adds the module only when the search means one thing.
void AddMenu::textEditorReturnKeyPressed (juce::TextEditor&)
{
    juce::String kind;
    int count = 0;
    for (const auto& r : rows)
        if (!r.group)
            kind = r.kind, ++count;
    if (count == 1)
    {
        const auto where = at;
        auto* c = &canvas;
        juce::MessageManager::callAsync ([c, kind, where] { c->addModule (kind, where); });
    }
}

void AddMenu::textEditorEscapeKeyPressed (juce::TextEditor&)
{
    auto* c = &canvas;
    juce::MessageManager::callAsync ([c] { c->closeMenu(); });
}

// ───────────────────────────────────────────────────────────────── canvas

namespace
{
// Pans from anywhere (Space held, the middle button), even over a module.
struct PanListener final : juce::MouseListener
{
    explicit PanListener (Canvas& c) : canvas (c) {}
    Canvas& canvas;
    void mouseDown (const juce::MouseEvent& e) override
    {
        if (e.eventComponent != &canvas && canvas.panGesture (e))
            canvas.startPan (e.getEventRelativeTo (&canvas));
    }
    void mouseDrag (const juce::MouseEvent& e) override
    {
        if (e.eventComponent != &canvas && canvas.isPanning())
            canvas.movePan (e.getEventRelativeTo (&canvas));
    }
    void mouseUp (const juce::MouseEvent& e) override
    {
        if (e.eventComponent != &canvas && canvas.isPanning())
            canvas.endPan();
    }
};
} // namespace

static std::map<Canvas*, std::unique_ptr<PanListener>>& panListeners()
{
    static std::map<Canvas*, std::unique_ptr<PanListener>> listeners;
    return listeners;
}

Canvas::Canvas (Host& h) : host (h)
{
    setWantsKeyboardFocus (true);
    setOpaque (true);
    addKeyListener (this);
    const auto kindsJson = juce::JSON::parse (juce::String (naText ([] (char* b, uint32_t c) { return na_kinds (b, c); })));
    if (auto* list = kindsJson.getArray())
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
    stage.setBounds (0, 0, Stage::size, Stage::size);
    stage.setInterceptsMouseClicks (false, true);
    cables.setBufferedToImage (true);
    stage.addAndMakeVisible (cables);
    addAndMakeVisible (stage);
    auto& l = panListeners()[this];
    l = std::make_unique<PanListener> (*this);
    stage.addMouseListener (l.get(), true);
    host.onRebuilt = [this] { refresh(); };
}

Canvas::~Canvas()
{
    host.onRebuilt = nullptr;
    removeKeyListener (this);
    if (auto it = panListeners().find (this); it != panListeners().end())
    {
        stage.removeMouseListener (it->second.get());
        panListeners().erase (it);
    }
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

juce::String Canvas::fileName() const
{
    return currentFile == juce::File() ? juce::String ("Untitled") : currentFile.getFileName();
}

bool Canvas::panGesture (const juce::MouseEvent& e) const
{
    return e.mods.isMiddleButtonDown() || (e.mods.isLeftButtonDown() && juce::KeyPress::isKeyCurrentlyDown (juce::KeyPress::spaceKey));
}

// ─── the camera

void Canvas::applyCamera()
{
    stage.setTransform (juce::AffineTransform::scale (cam.zoom).translated (-cam.left, -cam.top));
    repaint();
    if (changed)
        changed();
}

void Canvas::setZoom (float z)
{
    zoomTo (camera::zoomAround (cam, getLocalBounds().getCentre().toFloat(), camera::clampZoom (z) / cam.zoom));
}

void Canvas::zoomTo (const Camera& next)
{
    if (!zooming)
    {
        // The picture to move: the canvas as it is, at the screen's density.
        auto* peer = getPeer();
        shotDensity = peer != nullptr ? (float) peer->getPlatformScaleFactor() * (float) juce::Desktop::getInstance().getDisplays().getDisplayForRect (getScreenBounds())->scale : 2.0f;
        shotDensity = juce::jlimit (1.0f, 2.0f, shotDensity);
        shot = juce::Image (juce::Image::ARGB, juce::jmax (1, (int) ((float) getWidth() * shotDensity)), juce::jmax (1, (int) ((float) getHeight() * shotDensity)), true);
        {
            juce::Graphics g (shot);
            g.addTransform (juce::AffineTransform::scale (shotDensity));
            stage.paintEntireComponent (g, true);
        }
        shotCam = cam;
        zooming = true;
        // Out of sight, not hidden: hiding a component throws away every
        // picture cached inside it (JUCE releases them), so the gesture's end
        // would draw every module again from nothing.
        stage.setTransform (juce::AffineTransform::translation (-1.0e7f, -1.0e7f));
    }
    cam = next;
    repaint();
    if (changed)
        changed();
    startTimer (160);
}

void Canvas::timerCallback()
{
    stopTimer();
    zooming = false;
    shot = {};
    applyCamera();
}

void Canvas::fit()
{
    std::vector<juce::Rectangle<float>> boxes;
    if (auto it = nodes.find (selectedNode); it != nodes.end())
        boxes.push_back (it->second->getBounds().toFloat());
    else
        for (const auto& [id, n] : nodes)
            boxes.push_back (n->getBounds().toFloat());
    cam = camera::fit (boxes, { (float) getWidth(), (float) getHeight() });
    applyCamera();
}

void Canvas::retheme()
{
    dotTile = {};
    refresh();
    cables.update();
    repaint();
}

void Canvas::pan (float dx, float dy)
{
    cam = camera::panBy (cam, dx, dy);
    applyCamera();
}

void Canvas::centrePatch()
{
    if (nodes.empty())
        return;
    auto all = nodes.begin()->second->getBounds().toFloat();
    for (const auto& [id, n] : nodes)
        all = all.getUnion (n->getBounds().toFloat());
    cam = camera::centreOn (all.getCentre(), { (float) getWidth(), (float) getHeight() }, cam.zoom);
    applyCamera();
}

void Canvas::paint (juce::Graphics& g)
{
    // The board: its colour, and the dot grid laid out by the camera, so it
    // runs on forever however far the canvas is panned.
    g.fillAll (cssColour (canvasStyle()["viewport"]["background-color"], "rgb(28,28,29)"));
    const float step = 20 * cam.zoom;
    if (step < 3.0f)
        return;
    // One tile with its dot, at the screen's density, laid over the window.
    const float density = g.getInternalContext().getPhysicalPixelScaleFactor();
    const int tile = juce::jmax (1, juce::roundToInt (step * density));
    if (!dotTile.isValid() || dotTile.getWidth() != tile || std::abs (dotStep - step) > 1e-4f || dotStamp != face::stamp())
    {
        dotStep = step;
        dotStamp = face::stamp();
        dotTile = juce::Image (juce::Image::ARGB, tile, tile, true);
        juce::Graphics tg (dotTile);
        // The theme's dot: the first colour of the board's radial gradient.
        const auto image = canvasStyle()["viewport"]["background-image"].toString();
        const auto dot = image.fromFirstOccurrenceOf ("circle,", false, false).upToFirstOccurrenceOf (")", true, false).trim();
        tg.setColour (dot.isNotEmpty() ? c2d::css (dot) : juce::Colour (180, 180, 186).withAlpha (0.2f));
        const float c = (float) tile / 2, r = density;
        tg.fillEllipse (c - r, c - r, 2 * r, 2 * r);
    }
    const float x0 = std::fmod (-cam.left, step), y0 = std::fmod (-cam.top, step);
    g.setFillType (juce::FillType (dotTile, juce::AffineTransform::scale ((float) step / (float) tile).translated (x0, y0)));
    g.fillRect (getLocalBounds());
    if (zooming && shot.isValid())
    {
        // A screen point as the gesture began is a canvas point; that point
        // is where the camera puts it now.
        const float k = cam.zoom / shotCam.zoom;
        g.drawImageTransformed (shot, juce::AffineTransform::scale (1.0f / shotDensity).translated (shotCam.left, shotCam.top).scaled (k).translated (-cam.left, -cam.top));
    }
}

void Canvas::resized()
{
    applyCamera();
}

void Canvas::startPan (const juce::MouseEvent& e)
{
    if (zooming)
        timerCallback();
    panning = true;
    panFrom = e.position;
    panCamera = cam;
    setMouseCursor (juce::MouseCursor::DraggingHandCursor);
}

void Canvas::movePan (const juce::MouseEvent& e)
{
    if (!panning)
        return;
    const auto d = e.position - panFrom;
    cam = camera::panBy (panCamera, d.x, d.y);
    applyCamera();
}

void Canvas::endPan()
{
    panning = false;
    setMouseCursor (spaceHeld ? juce::MouseCursor::DraggingHandCursor : juce::MouseCursor::NormalCursor);
}

void Canvas::mouseDown (const juce::MouseEvent& e)
{
    grabKeyboardFocus();
    if (e.mods.isPopupMenu())
        return openMenu (e.position);
    if (!panGesture (e))
        if (const int w = wireAt (stagePoint (e.position)); w >= 0)
        {
            select (-1);
            selectedWire = w;
            cables.update();
            report (0, "Cable selected: press Delete to remove it");
            return;
        }
    // A press on the empty canvas: nothing selected, the menu closed, and a pan.
    selectedWire = -1;
    select (-1);
    closeMenu();
    startPan (e);
}

void Canvas::mouseDrag (const juce::MouseEvent& e)
{
    movePan (e);
}

void Canvas::mouseUp (const juce::MouseEvent&)
{
    endPan();
}

// Double-click the empty canvas to search for a module, as in ComfyUI.
void Canvas::mouseDoubleClick (const juce::MouseEvent& e)
{
    openMenu (e.position);
}

void Canvas::mouseWheelMove (const juce::MouseEvent& e, const juce::MouseWheelDetails& wheel)
{
    const auto at = e.getEventRelativeTo (this);
    if (menu != nullptr && menu->getBounds().contains (at.getPosition()))
        return;
    // A mouse notch is one 1.1x step; a trackpad's small steps are each worth
    // their share of one, so the zoom glides (camera.ts, wheelZoomFactor).
    const float notches = wheel.isSmooth ? juce::jlimit (-1.0f, 1.0f, wheel.deltaY * 5.0f) : (wheel.deltaY > 0 ? 1.0f : wheel.deltaY < 0 ? -1.0f : 0.0f);
    if (std::abs (notches) < 1e-6f)
        return;
    wheelZoom (at.position, notches);
}

void Canvas::wheelZoom (juce::Point<float> at, float notches)
{
    // Eased, not jumped: the wheel moves where the zoom is going, and each
    // frame of the screen takes it part of the way there (glide()).
    targetZoom = camera::clampZoom ((gliding ? targetZoom : cam.zoom) * std::pow (camera::notch, notches));
    anchor = at;
    if (!gliding)
    {
        gliding = true;
        lastFrame = juce::Time::getMillisecondCounterHiRes();
        glide();
    }
}

void Canvas::glide()
{
    if (!gliding)
        return;
    const double now = juce::Time::getMillisecondCounterHiRes();
    const float dt = (float) juce::jlimit (1.0, 50.0, now - lastFrame) / 1000.0f;
    lastFrame = now;
    // About two thirds of the way in 60 ms, as a browser eases its smooth scrolling.
    const float a = 1.0f - std::exp (-dt / 0.06f);
    const float ratio = targetZoom / cam.zoom;
    if (std::abs (std::log (ratio)) < 0.002f)
    {
        gliding = false;
        zoomTo (camera::zoomAround (cam, anchor, ratio));
        return;
    }
    zoomTo (camera::zoomAround (cam, anchor, std::pow (ratio, a)));
}

void Canvas::mouseMagnify (const juce::MouseEvent& e, float scale)
{
    gliding = false;
    // A pinch holds the canvas.
    zoomTo (camera::zoomAround (cam, e.getEventRelativeTo (this).position, juce::jlimit (0.8f, 1.25f, scale)));
}

bool Canvas::keyPressed (const juce::KeyPress& key)
{
    if (key == juce::KeyPress::deleteKey || key == juce::KeyPress::backspaceKey)
    {
        deleteSelection();
        return true;
    }
    if (key.getModifiers().isCommandDown() && key.getKeyCode() == 'D')
    {
        duplicateSelection();
        return true;
    }
    if (key.getModifiers().isCommandDown() && key.getKeyCode() == 'Z')
    {
        if (key.getModifiers().isShiftDown())
            redo();
        else
            undo();
        return true;
    }
    if (key.getTextCharacter() == '.' && !key.getModifiers().isCommandDown())
    {
        fit();
        return true;
    }
    return false;
}

bool Canvas::keyPressed (const juce::KeyPress& key, juce::Component*) { return keyPressed (key); }

bool Canvas::keyStateChanged (bool, juce::Component*)
{
    const bool space = juce::KeyPress::isKeyCurrentlyDown (juce::KeyPress::spaceKey);
    if (space != spaceHeld)
    {
        spaceHeld = space;
        setMouseCursor (space ? juce::MouseCursor::DraggingHandCursor : juce::MouseCursor::NormalCursor);
    }
    return false;
}

// ─── the menu

void Canvas::openMenu (juce::Point<float> onCanvas)
{
    closeMenu();
    menu = std::make_unique<AddMenu> (*this, stagePoint (onCanvas));
    menu->setTopLeftPosition (onCanvas.toInt());
    addAndMakeVisible (*menu);
    juce::Component::SafePointer<juce::Component> field (menu->getChildComponent (0));
    juce::MessageManager::callAsync ([field] { if (field != nullptr && field->isShowing()) field->grabKeyboardFocus(); });
}

void Canvas::closeMenu()
{
    menu.reset();
}

void Canvas::addModuleAtCentre()
{
    openMenu (getLocalBounds().getCentre().toFloat());
}

// ─── the patch

juce::String Canvas::snapshot()
{
    return host.with ([] (NaApp* a) { return juce::String (naText ([a] (char* b, uint32_t c) { return na_save (a, b, c); })); });
}

void Canvas::restore (const juce::String& text)
{
    const auto t = text.toStdString();
    host.with ([&] (NaApp* a) { return na_load (a, t.c_str()); });
    refresh();
}

void Canvas::remember()
{
    undoStack.push_back (snapshot());
    if (undoStack.size() > 100)
        undoStack.erase (undoStack.begin());
    redoStack.clear();
}

void Canvas::undo()
{
    if (undoStack.empty())
        return report (0, "Nothing to undo");
    redoStack.push_back (snapshot());
    const auto s = undoStack.back();
    undoStack.pop_back();
    restore (s);
    report (0, "Undone");
}

void Canvas::redo()
{
    if (redoStack.empty())
        return report (0, "Nothing to redo");
    undoStack.push_back (snapshot());
    const auto s = redoStack.back();
    redoStack.pop_back();
    restore (s);
    report (0, "Redone");
}

// MIDI in into Wave into Output, so there is something to play at once.
void Canvas::starter()
{
    const auto ids = host.with ([] (NaApp* a) {
        const int midi = na_add (a, "midi-in", 0.0f, 420.0f);
        const int wave = na_add (a, "wave", 360.0f, 0.0f);
        const int out = na_add (a, "output", 2380.0f, 420.0f);
        na_connect (a, (uint32_t) midi, 0, (uint32_t) wave, 0);
        na_connect (a, (uint32_t) wave, 0, (uint32_t) out, 0);
        return std::array<int, 3> { midi, wave, out };
    });
    undoStack.clear();
    redoStack.clear();
    refresh();
    fit();
    report (ids[1] > 0 ? 0 : -1, ids[1] > 0 ? "idMLab graph ready" : "The starting patch");
}

void Canvas::addModule (const juce::String& kind, juce::Point<float> onStage)
{
    closeMenu();
    remember();
    const auto k = kind.toStdString();
    const int id = host.with ([&] (NaApp* a) { return na_add (a, k.c_str(), onStage.x, onStage.y); });
    if (id < 0)
        return report (id, "Adding " + kind);
    refresh();
    select (id);
    if (auto* info = kindById (kind))
        report (0, "Added " + info->title);
}

void Canvas::removeModule (int id)
{
    remember();
    const auto label = nodes.count (id) ? nodes[id]->kind.title : juce::String ("module");
    const int code = host.with ([id] (NaApp* a) { return na_remove (a, (uint32_t) id); });
    if (code < 0)
        return report (code, "Removing " + label);
    refresh();
    report (0, "Deleted " + label);
}

void Canvas::deleteSelection()
{
    if (selectedWire >= 0)
        return removeWire (selectedWire);
    if (selectedNode >= 0)
        removeModule (selectedNode);
}

void Canvas::duplicateSelection()
{
    auto it = nodes.find (selectedNode);
    if (it == nodes.end())
        return report (0, "Select a module to duplicate");
    remember();
    const auto kind = it->second->kind.id.toStdString();
    const auto title = it->second->kind.title;
    const auto at = it->second->getPosition().toFloat() + juce::Point<float> (40, 40);
    const int src = selectedNode;
    const int id = host.with ([&] (NaApp* a) {
        const int made = na_add (a, kind.c_str(), at.x, at.y);
        if (made > 0 && kind == "wave")
        {
            const auto patch = naText ([&] (char* b, uint32_t c) { return na_wave_patch (a, (uint32_t) src, b, c); });
            na_load_wave_patch (a, (uint32_t) made, patch.c_str());
        }
        if (made > 0 && kind == "atmos")
        {
            // Every key the original holds; the chain first, so its controls land on it.
            const auto state = juce::JSON::parse (juce::String (naText ([&] (char* b, uint32_t c) { return na_atmos_state (a, (uint32_t) src, b, c); })));
            if (auto* o = state.getDynamicObject())
            {
                na_atmos_set (a, (uint32_t) made, "fx", juce::JSON::toString (o->getProperty ("fx"), true).toRawUTF8());
                for (const auto& p : o->getProperties())
                    if (p.name.toString() != "fx")
                        na_atmos_set (a, (uint32_t) made, p.name.toString().toRawUTF8(), juce::JSON::toString (p.value, true).toRawUTF8());
            }
        }
        return made;
    });
    if (id < 0)
        return report (id, "Duplicating");
    refresh();
    select (id);
    report (0, "Duplicated " + title);
}

void Canvas::newCanvas()
{
    remember();
    host.with ([] (NaApp* a) { return na_load (a, "{\"format\":\"idmlab-patch\",\"version\":1,\"modules\":[],\"cables\":[]}"); });
    currentFile = juce::File();
    starter();
}

void Canvas::select (int id)
{
    selectedNode = id;
    if (id >= 0)
        selectedWire = -1;
    for (auto& [nid, n] : nodes)
        if (n->selected != (nid == id))
        {
            n->selected = nid == id;
            n->repaint();
        }
    cables.update();
}

void Canvas::refresh()
{
    const auto described = juce::JSON::parse (juce::String (host.with ([] (NaApp* a) {
        return naText ([a] (char* b, uint32_t c) { return na_describe (a, b, c); });
    })));
    nodes.clear();
    wires.clear();
    selectedWire = -1;
    if (auto* modules = described["modules"].getArray())
        for (const auto& m : *modules)
        {
            const auto* kind = kindById (m["kind"].toString());
            if (kind == nullptr)
                continue;
            const int id = (int) m["id"];
            auto node = std::make_unique<Node> (*this, id, *kind);
            node->setTopLeftPosition ((int) num (m["x"]), (int) num (m["y"]));
            node->setValues (m["values"]);
            node->setPatchName (m["name"].toString());
            node->selected = id == selectedNode;
            stage.addAndMakeVisible (*node);
            nodes[id] = std::move (node);
        }
    if (nodes.count (selectedNode) == 0)
        selectedNode = -1;
    if (auto* list = described["cables"].getArray())
        for (const auto& c : *list)
            wires.push_back ({ (int) c["from"][0], (int) c["from"][1], (int) c["to"][0], (int) c["to"][1] });
    cables.toBack();
    const auto& view = described["view"];
    if (view.isObject() && view.hasProperty ("zoom"))
    {
        cam = { num (view["left"]), num (view["top"]), camera::clampZoom (num (view["zoom"], 1)) };
        applyCamera();
    }
    std::vector<uint32_t> midi;
    for (const auto& [id, n] : nodes)
        if (n->kind.id == "midi-in")
            midi.push_back ((uint32_t) id);
    host.setMidiIns (std::move (midi));
    cables.update();
    if (changed)
        changed();
}

void Canvas::pushView()
{
    juce::DynamicObject::Ptr v = new juce::DynamicObject();
    v->setProperty ("left", cam.left);
    v->setProperty ("top", cam.top);
    v->setProperty ("zoom", cam.zoom);
    const auto text = juce::JSON::toString (juce::var (v.get()), true).toStdString();
    host.with ([&] (NaApp* a) { return na_set_view (a, text.c_str()); });
}

void Canvas::writePatch (const juce::File& file)
{
    pushView();
    if (file.replaceWithText (snapshot()))
    {
        currentFile = file;
        report (0, "Saved " + file.getFileName());
        if (changed)
            changed();
    }
    else
        report (0, "Couldn't write " + file.getFullPathName());
}

void Canvas::savePatch (bool askWhere)
{
    if (!askWhere && currentFile != juce::File())
        return writePatch (currentFile);
    chooser = std::make_unique<juce::FileChooser> ("Save the patch", places::patches().getChildFile ("Untitled.json"), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this] (const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f != juce::File())
            writePatch (f.withFileExtension ("json"));
    });
}

void Canvas::openPatch()
{
    chooser = std::make_unique<juce::FileChooser> ("Open a patch", places::patches(), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this] (const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f == juce::File())
            return;
        remember();
        const auto text = f.loadFileAsString().toStdString();
        const int code = host.with ([&] (NaApp* a) { return na_load (a, text.c_str()); });
        if (code < 0)
            return report (code, "Open failed: " + f.getFileName());
        currentFile = f;
        refresh();
        report (0, "Opened " + f.getFileName());
    });
}

void Canvas::openWavePreset (int id)
{
    const auto start = places::mglWavePresets().isDirectory() ? places::mglWavePresets() : places::wavePresets();
    chooser = std::make_unique<juce::FileChooser> ("Open a Wave preset", start, "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, id] (const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f == juce::File())
            return;
        const auto text = f.loadFileAsString().toStdString();
        const int code = host.with ([&] (NaApp* a) { return na_load_wave_patch (a, (uint32_t) id, text.c_str()); });
        if (code < 0)
            return report (code, "Opening " + f.getFileName());
        refresh();
        report (0, "Wave plays " + f.getFileNameWithoutExtension());
    });
}

void Canvas::saveWavePreset (int id)
{
    chooser = std::make_unique<juce::FileChooser> ("Save a Wave preset", places::wavePresets().getChildFile ("preset.json"), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this, id] (const juce::FileChooser& fc) {
        auto f = fc.getResult();
        if (f == juce::File())
            return;
        f = f.withFileExtension ("json");
        const auto patch = host.with ([id] (NaApp* a) { return naText ([a, id] (char* b, uint32_t c) { return na_wave_patch (a, (uint32_t) id, b, c); }); });
        // MGL's preset shape, so its Wave page can open it too.
        juce::DynamicObject::Ptr held = new juce::DynamicObject();
        held->setProperty ("name", f.getFileNameWithoutExtension());
        held->setProperty ("tags", juce::Array<juce::var>());
        held->setProperty ("patch", juce::JSON::parse (juce::String::fromUTF8 (patch.c_str())));
        held->setProperty ("hidden", false);
        report (0, f.replaceWithText (juce::JSON::toString (juce::var (held.get()))) ? "Saved the preset " + f.getFileName() : "Couldn't write " + f.getFullPathName());
    });
}

void Canvas::loadAtmosPreset (int id, const juce::var& preset)
{
    remember();
    const auto text = juce::JSON::toString (preset, true).toStdString();
    const int n = host.with ([&] (NaApp* a) { return na_load_atmos_preset (a, (uint32_t) id, text.c_str()); });
    const auto name = preset["name"].toString();
    if (n < 0)
        return report (n, "Opening the preset " + name);
    refresh();
    // A Seq preset from before Atmosphere holds few of its controls: say so.
    report (0, n == 0 ? name + " holds none of Atmosphere's controls"
                      : n < 60 ? "Atmosphere took " + juce::String (n) + " controls from " + name + "; the rest are as they were"
                               : "Atmosphere plays " + name);
}

namespace
{
// The presets a file holds: a list (as MGL's Seq exports them) or one.
juce::Array<juce::var> presetsIn (const juce::File& f)
{
    const auto parsed = juce::JSON::parse (f.loadFileAsString());
    juce::Array<juce::var> out;
    if (auto* list = parsed.getArray())
    {
        for (const auto& p : *list)
            if (p.isObject())
                out.add (p);
    }
    else if (parsed.isObject())
        out.add (parsed);
    return out;
}
} // namespace

juce::PopupMenu Canvas::atmosPresetList (int id)
{
    juce::PopupMenu m;
    auto files = places::atmosPresets().findChildFiles (juce::File::findFiles, false, "*.json");
    files.sort();
    for (const auto& f : files)
    {
        const auto presets = presetsIn (f);
        if (presets.size() == 1)
        {
            const auto p = presets[0];
            m.addItem (f.getFileNameWithoutExtension(), [this, id, p] { loadAtmosPreset (id, p); });
        }
        else if (presets.size() > 1)
        {
            juce::PopupMenu sub;
            for (const auto& p : presets)
                sub.addItem (p["name"].toString(), [this, id, p] { loadAtmosPreset (id, p); });
            m.addSubMenu (f.getFileNameWithoutExtension(), sub);
        }
    }
    if (m.getNumItems() == 0)
        m.addItem ("None saved yet", false, false, nullptr);
    return m;
}

void Canvas::openAtmosPreset (int id)
{
    chooser = std::make_unique<juce::FileChooser> ("Open an Atmosphere preset, or presets MGL's Seq exported", places::atmosPresets(), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this, id] (const juce::FileChooser& fc) {
        const auto f = fc.getResult();
        if (f == juce::File())
            return;
        const auto presets = presetsIn (f);
        if (presets.isEmpty())
            return report (0, f.getFileName() + " holds no presets");
        if (presets.size() == 1)
            return loadAtmosPreset (id, presets[0]);
        // A list: choose one.
        juce::PopupMenu m;
        m.addSectionHeader (f.getFileNameWithoutExtension().toUpperCase());
        for (const auto& p : presets)
            m.addItem (p["name"].toString(), [this, id, p] { loadAtmosPreset (id, p); });
        m.showMenuAsync (juce::PopupMenu::Options().withMousePosition());
    });
}

void Canvas::saveAtmosPreset (int id)
{
    juce::String name = "Atmosphere";
    if (auto it = nodes.find (id); it != nodes.end() && it->second->patchName().isNotEmpty())
        name = it->second->patchName();
    chooser = std::make_unique<juce::FileChooser> ("Save an Atmosphere preset", places::atmosPresets().getChildFile (juce::File::createLegalFileName (name) + ".json"), "*.json");
    chooser->launchAsync (juce::FileBrowserComponent::saveMode | juce::FileBrowserComponent::warnAboutOverwriting, [this, id] (const juce::FileChooser& fc) {
        auto f = fc.getResult();
        if (f == juce::File())
            return;
        f = f.withFileExtension ("json");
        const auto title = f.getFileNameWithoutExtension().toStdString();
        const auto preset = host.with ([&] (NaApp* a) { return naText ([&] (char* b, uint32_t c) { return na_atmos_preset (a, (uint32_t) id, title.c_str(), b, c); }); });
        if (preset.empty())
            return report (-1, "Saving the preset");
        // A list of one, as MGL's Seq exports them, so its Import takes it.
        const bool ok = f.replaceWithText ("[" + juce::String::fromUTF8 (preset.c_str()) + "]");
        refresh();
        report (0, ok ? "Saved the preset " + f.getFileName() : "Couldn't write " + f.getFullPathName());
    });
}

void Canvas::set (int id, int index, float value)
{
    const int code = host.with ([=] (NaApp* a) { return na_set (a, (uint32_t) id, (uint32_t) index, value); });
    if (code < 0)
        report (code, "That control");
}

void Canvas::nodeMoved (int id)
{
    auto it = nodes.find (id);
    if (it == nodes.end())
        return;
    const auto p = it->second->getPosition().toFloat();
    host.with ([=] (NaApp* a) { return na_place (a, (uint32_t) id, p.x, p.y); });
}

// ─── cables

Jack* Canvas::jackOf (int module, bool isInput, int index) const
{
    auto it = nodes.find (module);
    if (it == nodes.end())
        return nullptr;
    for (auto& j : it->second->jacks)
        if (j->isInput == isInput && j->index == index)
            return j.get();
    return nullptr;
}

// idMLab's cable: it leaves an output and arrives at an input horizontally;
// the bend grows with the gap and never collapses (portGeometry.ts, cablePath).
juce::Path Canvas::wirePath (const Wire& w) const
{
    juce::Path p;
    auto* a = jackOf (w.from, false, w.fromSocket);
    auto* b = jackOf (w.to, true, w.toSocket);
    if (a == nullptr || b == nullptr)
        return p;
    const auto from = a->centreOnStage(), to = b->centreOnStage();
    const float bend = juce::jmax (80.0f, std::abs (to.x - from.x) * 0.5f);
    p.startNewSubPath (from);
    p.cubicTo (from.x + bend, from.y, to.x - bend, to.y, to.x, to.y);
    return p;
}

int Canvas::wireAt (juce::Point<float> onStage) const
{
    int best = -1;
    float bestDistance = 8.0f / juce::jmax (0.2f, cam.zoom);
    for (size_t i = 0; i < wires.size(); ++i)
    {
        juce::Point<float> nearest;
        wirePath (wires[i]).getNearestPoint (onStage, nearest);
        const float d = nearest.getDistanceFrom (onStage);
        if (d < bestDistance)
            best = (int) i, bestDistance = d;
    }
    return best;
}

void Canvas::beginCable (Jack* j)
{
    pendingFrom = j;
    pendingEnd = j->centreOnStage();
}

void Canvas::dragCable (juce::Point<float> onStage)
{
    pendingEnd = onStage;
    cables.update();
}

void Canvas::endCable (juce::Point<float> onStage)
{
    auto* from = pendingFrom;
    pendingFrom = nullptr;
    cables.update();
    if (from == nullptr)
        return;
    Jack* target = nullptr;
    for (const auto& [id, n] : nodes)
        for (auto& j : n->jacks)
            if (j.get() != from && j->getBounds().translated (n->getX(), n->getY()).expanded (8).toFloat().contains (onStage))
                target = j.get();
    if (target == nullptr || target->isInput == from->isInput)
        return;
    auto* out = from->isInput ? target : from;
    auto* in = from->isInput ? from : target;
    remember();
    const int code = host.with ([=] (NaApp* a) {
        return na_connect (a, (uint32_t) out->module, (uint32_t) out->index, (uint32_t) in->module, (uint32_t) in->index);
    });
    if (code < 0)
    {
        undoStack.pop_back();
        return report (code, "That cable");
    }
    wires.push_back ({ out->module, out->index, in->module, in->index });
    cables.update();
    report (0, "Connected " + nodes[out->module]->kind.title + " to " + nodes[in->module]->kind.title);
    if (changed)
        changed();
}

void Canvas::removeWire (int index)
{
    if (index < 0 || index >= (int) wires.size())
        return;
    remember();
    const auto w = wires[(size_t) index];
    const int code = host.with ([=] (NaApp* a) {
        return na_disconnect (a, (uint32_t) w.from, (uint32_t) w.fromSocket, (uint32_t) w.to, (uint32_t) w.toSocket);
    });
    if (code < 0)
        return report (code, "Removing the cable");
    wires.erase (wires.begin() + index);
    selectedWire = -1;
    cables.update();
    report (0, "Deleted the cable");
    if (changed)
        changed();
}
