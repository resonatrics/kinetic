#include "PluginProcessor.h"

#include "PluginEditor.h"

AudioPluginAudioProcessor::AudioPluginAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
}

AudioPluginAudioProcessor::~AudioPluginAudioProcessor() = default;

const juce::String AudioPluginAudioProcessor::getName() const {
    return JucePlugin_Name;
}

bool AudioPluginAudioProcessor::acceptsMidi() const {
    return true;
}

bool AudioPluginAudioProcessor::producesMidi() const {
    return false;
}

bool AudioPluginAudioProcessor::isMidiEffect() const {
    return false;
}

double AudioPluginAudioProcessor::getTailLengthSeconds() const {
    return 0.0;
}

int AudioPluginAudioProcessor::getNumPrograms() {
    return 1;
}

int AudioPluginAudioProcessor::getCurrentProgram() {
    return 0;
}

void AudioPluginAudioProcessor::setCurrentProgram(int index) {
    juce::ignoreUnused(index);
}

const juce::String AudioPluginAudioProcessor::getProgramName(int index) {
    juce::ignoreUnused(index);
    return {};
}

void AudioPluginAudioProcessor::changeProgramName(int index, const juce::String& newName) {
    juce::ignoreUnused(index, newName);
}

void AudioPluginAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    juce::ignoreUnused(sampleRate, samplesPerBlock);
}

void AudioPluginAudioProcessor::releaseResources() {
}

bool AudioPluginAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    const auto output = layouts.getMainOutputChannelSet();
    return output == juce::AudioChannelSet::mono()
        || output == juce::AudioChannelSet::stereo();
}

void AudioPluginAudioProcessor::processBlock(
    juce::AudioBuffer<float>& buffer,
    juce::MidiBuffer& midiMessages
) {
    juce::ScopedNoDenormals noDenormals;
    buffer.clear();

    if (!midiConsumerActive.load(std::memory_order_relaxed))
        return;

    for (const auto metadata : midiMessages) {
        const auto message = metadata.getMessage();
        if (message.isNoteOn())
            pushMidiTrigger(message.getFloatVelocity());
    }
}

void AudioPluginAudioProcessor::pushMidiTrigger(float velocity) noexcept {
    const auto write = midiFifo.write(1);
    if (write.blockSize1 > 0)
        midiQueue[static_cast<size_t>(write.startIndex1)] = { velocity };
}

int AudioPluginAudioProcessor::popMidiTriggers(
    MidiTrigger* destination,
    int maximumToRead
) noexcept {
    if (destination == nullptr || maximumToRead <= 0)
        return 0;

    const auto read = midiFifo.read(maximumToRead);
    int copied = 0;

    for (int index = 0; index < read.blockSize1; ++index)
        destination[copied++] = midiQueue[static_cast<size_t>(read.startIndex1 + index)];

    for (int index = 0; index < read.blockSize2; ++index)
        destination[copied++] = midiQueue[static_cast<size_t>(read.startIndex2 + index)];

    return copied;
}

void AudioPluginAudioProcessor::setMidiConsumerActive(bool shouldBeActive) noexcept {
    midiConsumerActive.store(shouldBeActive, std::memory_order_relaxed);
}

bool AudioPluginAudioProcessor::hasEditor() const {
    return true;
}

juce::AudioProcessorEditor* AudioPluginAudioProcessor::createEditor() {
    return new AudioPluginAudioProcessorEditor(*this);
}

void AudioPluginAudioProcessor::getStateInformation(juce::MemoryBlock& destData) {
    destData.reset();
}

void AudioPluginAudioProcessor::setStateInformation(const void* data, int sizeInBytes) {
    juce::ignoreUnused(data, sizeInBytes);
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() {
    return new AudioPluginAudioProcessor();
}
