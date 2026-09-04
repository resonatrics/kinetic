/// <reference types="vite/client" />

interface JuceEventBackend {
  addEventListener(eventId: string, listener: (payload: unknown) => void): [string, number];
  removeEventListener(handle: [string, number]): void;
  emitEvent(eventId: string, payload: unknown): void;
}

interface Window {
  __JUCE__?: {
    backend: JuceEventBackend;
  };
}
