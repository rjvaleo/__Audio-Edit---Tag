#include "MglLibrary.h"

#include "Places.h"
#include "na.h"

namespace mgllib
{
bool askInline = false;

namespace
{
NaLib* lib()
{
    static NaLib* l = [] {
        // MGL_LIBRARY_HOME: another copy (the tests' and captures').
        const auto env = juce::SystemStats::getEnvironmentVariable ("MGL_LIBRARY_HOME", {});
        const auto home = env.isNotEmpty() ? juce::File (env) : places::home().getChildFile ("library");
        home.createDirectory();
        const auto mgl = places::mgl();
        const auto models = mgl.getParentDirectory().getChildFile ("models");
        return na_lib_open (home.getFullPathName().toRawUTF8(), mgl.isDirectory() ? mgl.getFullPathName().toRawUTF8() : nullptr,
                            models.isDirectory() ? models.getFullPathName().toRawUTF8() : nullptr);
    }();
    return l;
}

juce::ThreadPool& pool()
{
    static juce::ThreadPool p (juce::ThreadPoolOptions().withThreadName ("library").withNumberOfThreads (3));
    return p;
}
} // namespace

juce::String esc (const juce::String& s)
{
    juce::String out;
    for (auto c : s.toStdString())
    {
        const auto u = (unsigned char) c;
        if (std::isalnum (u) || juce::String ("-_.!~*'()").containsChar ((juce::juce_wchar) u))
            out << (char) c;
        else
            out << "%" << juce::String::toHexString ((int) u).paddedLeft ('0', 2).toUpperCase();
    }
    return out;
}

Answer call (const juce::String& method, const juce::String& target, const juce::String& body)
{
    Answer a;
    auto* l = lib();
    if (l == nullptr)
        return a;
    const auto b = body.toStdString();
    if (auto* r = na_lib_call (l, method.toRawUTF8(), target.toRawUTF8(), (const uint8_t*) b.data(), (uint32_t) b.size()))
    {
        a.status = (int) na_reply_status (r);
        a.type = juce::String::fromUTF8 (na_reply_type (r));
        uint32_t n = 0;
        if (const auto* p = na_reply_body (r, &n); p != nullptr && n > 0)
            a.body.append (p, n);
        na_reply_free (r);
    }
    return a;
}

void ask (const juce::String& method, const juce::String& target, const juce::String& body, std::function<void (const Answer&)> done)
{
    if (askInline)
    {
        const auto a = call (method, target, body);
        if (done)
            done (a);
        return;
    }
    pool().addJob ([method, target, body, done] {
        auto a = std::make_shared<Answer> (call (method, target, body));
        juce::MessageManager::callAsync ([a, done] {
            if (done)
                done (*a);
        });
    });
}

juce::String folder()
{
    auto* l = lib();
    if (l == nullptr)
        return {};
    std::vector<char> buf (4096);
    const auto n = na_lib_folder (l, buf.data(), (uint32_t) buf.size());
    return n == 0 ? juce::String() : juce::String::fromUTF8 (buf.data());
}

juce::File fileOf (const juce::String& rel)
{
    const auto f = folder();
    return f.isEmpty() ? juce::File() : juce::File (f).getChildFile (rel);
}
} // namespace mgllib
