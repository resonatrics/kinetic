#pragma once

#include <array>
#include <atomic>
#include <cstddef>
#include <juce_audio_processors/juce_audio_processors.h>

class AudioPluginAudioProcessor final : public juce::AudioProcessor {
public:
    struct MidiTrigger {
        float velocity = 0.0f;
    };

    AudioPluginAudioProcessor();
    ~AudioPluginAudioProcessor() override;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    bool isBusesLayoutSupported(const BusesLayout& layouts) const override;

    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override;

    const juce::String getName() const override;
    bool acceptsMidi() const override;
    bool producesMidi() const override;
    bool isMidiEffect() const override;
    double getTailLengthSeconds() const override;

    int getNumPrograms() override;
    int getCurrentProgram() override;
    void setCurrentProgram(int index) override;
    const juce::String getProgramName(int index) override;
    void changeProgramName(int index, const juce::String& newName) override;

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    int popMidiTriggers(MidiTrigger* destination, int maximumToRead) noexcept;
    void setMidiConsumerActive(bool shouldBeActive) noexcept;

private:
    static constexpr int midiQueueCapacity = 1024;

    void pushMidiTrigger(float velocity) noexcept;

    std::array<MidiTrigger, midiQueueCapacity> midiQueue {};
    juce::AbstractFifo midiFifo { midiQueueCapacity };
    std::atomic<bool> midiConsumerActive { false };

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AudioPluginAudioProcessor)
};
