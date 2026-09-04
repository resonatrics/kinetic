import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { HeatmapRenderer } from './HeatmapRenderer';
import {
  HEATMAP_CONTROLS,
  INITIAL_MAPPING,
  INITIAL_VALUES,
  MidiEnvelope,
  sampleHeatmapValues,
  type HeatmapTarget,
  type HeatmapValues,
  type MappingSettings,
} from './modulation';

interface MidiTrigger {
  velocity: number;
}

const TARGETS = Object.keys(HEATMAP_CONTROLS) as HeatmapTarget[];

function IconButton({ label, active = false, onClick, children }: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`icon-button${active ? ' is-active' : ''}`}
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V14" />
    </svg>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z" /></svg>;
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>;
}

function SliderControl({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const decimals = step < 0.01 ? 3 : step < 0.1 ? 2 : 1;

  return (
    <label className="control-row">
      <span>{label}</span>
      <input
        className="number-input"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(decimals))}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onChange(Math.min(max, Math.max(min, next)));
          }
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function formatTime(time: number) {
  if (!Number.isFinite(time) || time < 0) {
    return '0:00';
  }
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rendererRef = useRef<HeatmapRenderer | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const baseRef = useRef<HeatmapValues>({ ...INITIAL_VALUES });
  const mappingRef = useRef<MappingSettings>({ ...INITIAL_MAPPING });
  const envelopeRef = useRef(new MidiEnvelope());
  const pulseTimerRef = useRef<number | undefined>(undefined);

  const [baseValues, setBaseValues] = useState<HeatmapValues>({ ...INITIAL_VALUES });
  const [mapping, setMapping] = useState<MappingSettings>({ ...INITIAL_MAPPING });
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const [rendererError, setRendererError] = useState('');
  const [videoError, setVideoError] = useState('');
  const [midiActive, setMidiActive] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) {
      return;
    }

    const renderer = new HeatmapRenderer({
      canvas,
      video,
      getValues: () => sampleHeatmapValues(baseRef.current, mappingRef.current, envelopeRef.current),
      onReady: () => setRendererReady(true),
      onError: setRendererError,
    });
    rendererRef.current = renderer;
    void renderer.start();

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    const backend = window.__JUCE__?.backend;
    if (!backend) {
      return;
    }

    const handle = backend.addEventListener('midiTriggers', (payload) => {
      const triggers = Array.isArray(payload) ? payload as MidiTrigger[] : [];
      const velocity = triggers.reduce((maximum, trigger) => (
        Number.isFinite(trigger.velocity) ? Math.max(maximum, trigger.velocity) : maximum
      ), 0);
      if (triggers.length === 0) {
        return;
      }

      envelopeRef.current.trigger(velocity, mappingRef.current);
      setMidiActive(true);
      if (pulseTimerRef.current !== undefined) {
        window.clearTimeout(pulseTimerRef.current);
      }
      pulseTimerRef.current = window.setTimeout(() => setMidiActive(false), 90);
    });

    backend.emitEvent('frontendReady', {});
    return () => {
      backend.removeEventListener(handle);
      if (pulseTimerRef.current !== undefined) {
        window.clearTimeout(pulseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
  }, []);

  const updateBase = (target: HeatmapTarget, value: number) => {
    const next = { ...baseRef.current, [target]: value };
    baseRef.current = next;
    setBaseValues(next);
  };

  const updateMapping = (update: Partial<MappingSettings>) => {
    const next = { ...mappingRef.current, ...update };
    if (update.target && update.target !== mappingRef.current.target) {
      envelopeRef.current.clear();
    }
    mappingRef.current = next;
    setMapping(next);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    rendererRef.current?.resetHistory();
    setVideoError('');
    setDuration(0);
    setCurrentTime(0);
    setVideoName(file.name);
    setVideoUrl(url);
    event.target.value = '';
  };

  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      openFilePicker();
      return;
    }

    if (video.paused) {
      void video.play().catch(() => setVideoError('The video could not be played.'));
    } else {
      video.pause();
    }
  };

  const seekVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    const video = videoRef.current;
    if (!video || !Number.isFinite(nextTime)) {
      return;
    }
    setCurrentTime(nextTime);
    video.currentTime = nextTime;
  };

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <main className="app-shell">
      <section className="visual-panel">
        <header className="toolbar">
          <div className="brand">
            <span className="brand-mark" />
            <strong>Kinetic</strong>
            <span className="subtitle">MIDI heatmap</span>
          </div>
          <span className={`midi-indicator${midiActive ? ' is-active' : ''}`}>
            <i /> MIDI
          </span>
          <div className="toolbar-spacer" />
          {videoName && <span className="file-name" title={videoName}>{videoName}</span>}
          <IconButton label="Open video" onClick={openFilePicker}><UploadIcon /></IconButton>
        </header>

        <div className="video-stage">
          <video
            ref={videoRef}
            className="source-video"
            src={videoUrl || undefined}
            muted
            loop
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setCurrentTime(video.currentTime);
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
            }}
            onDurationChange={(event) => {
              const nextDuration = event.currentTarget.duration;
              setDuration(Number.isFinite(nextDuration) ? nextDuration : 0);
            }}
            onLoadedData={() => rendererRef.current?.resetHistory()}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onSeeked={(event) => {
              setCurrentTime(event.currentTarget.currentTime);
              rendererRef.current?.resetHistory();
            }}
            onError={() => setVideoError('This video format is not supported by WebView2.')}
          />
          <canvas ref={canvasRef} />

          {rendererReady && !videoUrl && !rendererError && (
            <button className="empty-state" type="button" onClick={openFilePicker}>
              <UploadIcon />
              <span>Choose a video</span>
            </button>
          )}
          {!rendererReady && !rendererError && <span className="loading-spinner" aria-label="Loading renderer" />}
          {(rendererError || videoError) && (
            <div className="error-message" role="alert">{rendererError || videoError}</div>
          )}

          {videoUrl && (
            <div className="video-timeline">
              <IconButton label={playing ? 'Pause video' : 'Play video'} active={playing} onClick={toggleVideo}>
                {playing ? <PauseIcon /> : <PlayIcon />}
              </IconButton>
              <span className="time-label">{formatTime(currentTime)}</span>
              <input
                className="video-scrubber"
                type="range"
                min="0"
                max={duration || 1}
                step="any"
                value={duration ? Math.min(currentTime, duration) : 0}
                aria-label="Video position"
                disabled={!duration}
                style={{
                  background: `linear-gradient(to right, #9ac7ff 0%, #9ac7ff ${progress}%, #343941 ${progress}%, #343941 100%)`,
                }}
                onChange={seekVideo}
              />
              <span className="time-label">{formatTime(duration)}</span>
            </div>
          )}
        </div>
      </section>

      <aside className="control-panel">
        <section className="control-section">
          <div className="section-heading">
            <span>Heatmap</span>
            <small>base values</small>
          </div>
          {TARGETS.map((target) => {
            const definition = HEATMAP_CONTROLS[target];
            return (
              <SliderControl
                key={target}
                label={definition.label}
                value={baseValues[target]}
                min={definition.min}
                max={definition.max}
                step={definition.step}
                onChange={(value) => updateBase(target, value)}
              />
            );
          })}
        </section>

        <section className="control-section midi-section">
          <div className="section-heading">
            <span>MIDI envelope</span>
            <small>all note-ons</small>
          </div>
          <label className="select-row">
            <span>target</span>
            <select
              value={mapping.target}
              onChange={(event) => updateMapping({ target: event.target.value as HeatmapTarget })}
            >
              {TARGETS.map((target) => (
                <option key={target} value={target}>{HEATMAP_CONTROLS[target].label}</option>
              ))}
            </select>
          </label>
          <SliderControl
            label="amount"
            value={mapping.amount}
            min={-3}
            max={3}
            step={0.005}
            onChange={(amount) => updateMapping({ amount })}
          />
          <SliderControl
            label="attack (s)"
            value={mapping.attack}
            min={0}
            max={2}
            step={0.005}
            onChange={(attack) => updateMapping({ attack })}
          />
          <SliderControl
            label="release (s)"
            value={mapping.release}
            min={0.01}
            max={4}
            step={0.01}
            onChange={(release) => updateMapping({ release })}
          />
          <label className="toggle-row">
            <span>velocity sensitive</span>
            <input
              type="checkbox"
              checked={mapping.velocitySensitive}
              onChange={(event) => updateMapping({ velocitySensitive: event.target.checked })}
            />
          </label>
        </section>
      </aside>

      <input
        ref={fileInputRef}
        className="file-input"
        type="file"
        accept="video/*"
        onChange={selectFile}
      />
    </main>
  );
}
