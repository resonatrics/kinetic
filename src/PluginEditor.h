#pragma once

#include "PluginProcessor.h"

#include <array>
#include <optional>
#include <juce_gui_extra/juce_gui_extra.h>

class AudioPluginAudioProcessorEditor final
    : public juce::AudioProcessorEditor,
      private juce::Timer {
public:
    explicit AudioPluginAudioProcessorEditor(AudioPluginAudioProcessor&);
    ~AudioPluginAudioProcessorEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    static juce::WebBrowserComponent::Options createBrowserOptions(
        AudioPluginAudioProcessorEditor& owner
    );
    static std::optional<juce::WebBrowserComponent::Resource> getResource(
        const juce::String& url
    );

    void timerCallback() override;

    AudioPluginAudioProcessor& processorRef;
    bool browserReady = false;
    juce::WebBrowserComponent webComponent;
    std::array<AudioPluginAudioProcessor::MidiTrigger, 256> triggerBatch {};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AudioPluginAudioProcessorEditor)
};
