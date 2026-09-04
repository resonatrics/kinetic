#include "PluginEditor.h"

#include <KineticAssets.h>

#include <cstddef>
#include <vector>

namespace {
std::vector<std::byte> copyBytes(const char* data, int size) {
    const auto* first = reinterpret_cast<const std::byte*>(data);
    return { first, first + size };
}

juce::WebBrowserComponent::Resource makeResource(
    const char* data,
    int size,
    const juce::String& mimeType
) {
    return { copyBytes(data, size), mimeType };
}
} // namespace

juce::WebBrowserComponent::Options AudioPluginAudioProcessorEditor::createBrowserOptions(
    AudioPluginAudioProcessorEditor& owner
) {
    auto options = juce::WebBrowserComponent::Options {}
        .withNativeIntegrationEnabled()
        .withEventListener("frontendReady", [&owner](const juce::var&) {
            owner.browserReady = true;
        })
        .withResourceProvider([](const juce::String& url) {
            return getResource(url);
        });

#if JUCE_WINDOWS
    auto userDataFolder = juce::File::getSpecialLocation(juce::File::tempDirectory)
        .getChildFile("Kinetic-WebView2");
    userDataFolder.createDirectory();

    options = options
        .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options(
            juce::WebBrowserComponent::Options::WinWebView2 {}
                .withUserDataFolder(userDataFolder)
                .withStatusBarDisabled()
                .withBuiltInErrorPageDisabled()
                .withBackgroundColour(juce::Colours::transparentBlack)
        );
#endif

    return options;
}

std::optional<juce::WebBrowserComponent::Resource>
AudioPluginAudioProcessorEditor::getResource(const juce::String& url) {
    const auto path = url.upToFirstOccurrenceOf("?", false, false);

    if (path == "/" || path == "/index.html")
        return makeResource(KineticAssets::index_html, KineticAssets::index_htmlSize, "text/html");

    if (path == "/index.js")
        return makeResource(KineticAssets::index_js, KineticAssets::index_jsSize, "text/javascript");

    if (path == "/styles.css")
        return makeResource(KineticAssets::styles_css, KineticAssets::styles_cssSize, "text/css");

    return std::nullopt;
}

AudioPluginAudioProcessorEditor::AudioPluginAudioProcessorEditor(
    AudioPluginAudioProcessor& processor
)
    : AudioProcessorEditor(&processor),
      processorRef(processor),
      webComponent(createBrowserOptions(*this)) {
    setOpaque(true);
    addAndMakeVisible(webComponent);

    setResizable(true, true);
    setResizeLimits(760, 480, 1920, 1200);
    setSize(1040, 680);

    processorRef.setMidiConsumerActive(true);
    startTimerHz(60);
    webComponent.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
}

AudioPluginAudioProcessorEditor::~AudioPluginAudioProcessorEditor() {
    stopTimer();
    processorRef.setMidiConsumerActive(false);
}

void AudioPluginAudioProcessorEditor::paint(juce::Graphics& graphics) {
    graphics.fillAll(juce::Colour(0xff090b0f));
}

void AudioPluginAudioProcessorEditor::resized() {
    webComponent.setBounds(getLocalBounds());
}

void AudioPluginAudioProcessorEditor::timerCallback() {
    const auto count = processorRef.popMidiTriggers(
        triggerBatch.data(),
        static_cast<int>(triggerBatch.size())
    );

    if (!browserReady || count == 0)
        return;

    juce::Array<juce::var> triggers;
    triggers.ensureStorageAllocated(count);

    for (int index = 0; index < count; ++index) {
        auto* trigger = new juce::DynamicObject();
        trigger->setProperty("velocity", triggerBatch[static_cast<size_t>(index)].velocity);
        triggers.add(juce::var(trigger));
    }

    webComponent.emitEventIfBrowserIsVisible("midiTriggers", juce::var(std::move(triggers)));
}
