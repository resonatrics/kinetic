# Kinetic

Kinetic is a silent MIDI instrument that turns an uploaded video into a WebGPU motion heatmap. Incoming MIDI note-ons trigger a configurable modulation envelope for one heatmap parameter.

## FL Studio workflow

1. Load `Kinetic.vst3` as an instrument in the Channel Rack.
2. Open Kinetic and choose a video.
3. Start the video with Kinetic's local play button. Video playback is independent of FL Studio's transport.
4. Add notes at any pitch to Kinetic's Piano Roll. Every note-on triggers the same envelope; note pitch and duration are ignored.
5. Choose the modulation target, amount, attack, release, and whether velocity scales the envelope.

Kinetic intentionally produces silence. If MIDI or timing is interrupted, disable **Smart disable** for Kinetic in FL Studio's plug-in wrapper settings.

The uploaded video and UI settings are session-only and are not restored with the DAW project.

## Build

Requirements:

- CMake 3.22+
- A C++17 compiler
- Node.js and pnpm
- Windows: Visual Studio 2022 and the WebView2 Runtime

Clone with the JUCE submodule and build:

```sh
git clone --recurse-submodules <repository-url>
cd kinetic
make build
```

Or run the steps directly:

```sh
cd ui
pnpm install
pnpm build
cd ..
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --parallel
```

The VST3 and standalone application are written to `build/Kinetic_artefacts/Release/`.

On Windows, CMake downloads the WebView2 SDK used to build the plug-in. The small WebView2 loader is linked into Kinetic; the WebView2 Runtime itself remains a system dependency.

## License

AGPL-3.0. See `THIRD_PARTY_NOTICES.md` for third-party material.
