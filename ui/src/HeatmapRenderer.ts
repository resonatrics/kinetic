import type { HeatmapValues } from './modulation';

const DETECTION_SCALE = 0.5;
const MAX_DETECTION_DIMENSION = 960;

const PARAMETERS_WGSL = /* wgsl */ `
struct Parameters {
  threshold: f32,
  decay: f32,
  mixAmount: f32,
  intensity: f32,
  canvasAspect: f32,
  videoAspect: f32,
  hasPreviousFrame: f32,
  padding: f32,
}
`;

const MOTION_COMPUTE_SHADER = /* wgsl */ `
${PARAMETERS_WGSL}

@group(0) @binding(0) var videoTexture: texture_2d<f32>;
@group(0) @binding(1) var stateReadTexture: texture_2d<f32>;
@group(0) @binding(2) var stateWriteTexture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> parameters: Parameters;

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.299, 0.587, 0.114));
}

@compute @workgroup_size(8, 8)
fn computeMotion(@builtin(global_invocation_id) id: vec3u) {
  let dimensions = textureDimensions(stateWriteTexture);
  if (any(id.xy >= dimensions)) {
    return;
  }

  let coord = vec2i(id.xy);
  let outputUv = (vec2f(id.xy) + vec2f(0.5)) / vec2f(dimensions);
  let videoDimensions = textureDimensions(videoTexture);
  let videoCoord = clamp(
    vec2i(outputUv * vec2f(videoDimensions)),
    vec2i(0),
    vec2i(videoDimensions) - vec2i(1)
  );
  let currentLuminance = luminance(textureLoad(videoTexture, videoCoord, 0).rgb);
  let previousState = textureLoad(stateReadTexture, coord, 0);
  let difference = abs(currentLuminance - previousState.r);
  var motion = 0.0;

  if (parameters.hasPreviousFrame > 0.5) {
    let lowerThreshold = parameters.threshold;
    let upperThreshold = max(lowerThreshold * 4.0, lowerThreshold + 0.004);
    motion = pow(smoothstep(lowerThreshold, upperThreshold, difference), 0.5);
  }

  let previousTrail = select(0.0, previousState.a, parameters.hasPreviousFrame > 0.5);
  let decayedTrail = max(previousTrail * parameters.decay - 0.012, 0.0);
  let motionTrail = max(decayedTrail, motion);

  // R stores current luminance and A stores the persistent motion mask.
  textureStore(stateWriteTexture, coord, vec4f(currentLuminance, 0.0, 0.0, motionTrail));
}
`;

const RENDER_SHADER = /* wgsl */ `
${PARAMETERS_WGSL}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var linearSampler: sampler;
@group(0) @binding(1) var motionState: texture_2d<f32>;
@group(0) @binding(2) var<uniform> parameters: Parameters;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let coordinates = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = coordinates[index];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  var videoUv = input.uv;

  if (parameters.canvasAspect > parameters.videoAspect) {
    let width = parameters.videoAspect / parameters.canvasAspect;
    videoUv.x = (videoUv.x - (1.0 - width) * 0.5) / width;
  } else {
    let height = parameters.canvasAspect / parameters.videoAspect;
    videoUv.y = (videoUv.y - (1.0 - height) * 0.5) / height;
  }

  if (any(videoUv < vec2f(0.0)) || any(videoUv > vec2f(1.0))) {
    return vec4f(0.0);
  }

  let motion = clamp(textureSampleLevel(motionState, linearSampler, videoUv, 0.0).a, 0.0, 1.0);
  let cool = vec3f(0.0, 0.5, 2.0);
  let hot = vec3f(1.0, 0.35, 0.5);
  let heatColor = mix(cool, hot, smoothstep(0.0, 1.0, motion));
  let strength = clamp(motion * 1.3 * parameters.intensity, 0.0, 1.0);
  let alpha = strength * parameters.mixAmount;
  return vec4f(heatColor * alpha, alpha);
}
`;

interface VideoResources {
  width: number;
  height: number;
  detectionWidth: number;
  detectionHeight: number;
  currentFrame: GPUTexture;
  stateTextures: [GPUTexture, GPUTexture];
  motionBindGroups: [GPUBindGroup, GPUBindGroup];
  renderBindGroups: [GPUBindGroup, GPUBindGroup];
}

interface HeatmapRendererOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  getValues: () => HeatmapValues;
  onReady?: () => void;
  onError?: (message: string) => void;
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export class HeatmapRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly video: VideoWithFrameCallback;
  private readonly getValues: () => HeatmapValues;
  private readonly onReady?: () => void;
  private readonly onError?: (message: string) => void;

  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  private motionPipeline: GPUComputePipeline | null = null;
  private renderPipeline: GPURenderPipeline | null = null;
  private sampler: GPUSampler | null = null;
  private parameterBuffer: GPUBuffer | null = null;
  private resources: VideoResources | null = null;

  private animationFrame = 0;
  private videoFrameCallback = 0;
  private frameVersion = 0;
  private processedFrameVersion = -1;
  private lastVideoTime = -1;
  private stateIndex: 0 | 1 = 0;
  private hasHistory = false;
  private reportedFrameError = false;
  private disposed = false;

  constructor(options: HeatmapRendererOptions) {
    this.canvas = options.canvas;
    this.video = options.video;
    this.getValues = options.getValues;
    this.onReady = options.onReady;
    this.onError = options.onError;
  }

  async start() {
    try {
      if (!navigator.gpu) {
        throw new Error('WebGPU is unavailable. Kinetic requires a current WebView2 runtime and compatible GPU.');
      }

      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        throw new Error('No WebGPU adapter was found.');
      }

      this.device = await adapter.requestDevice();
      if (this.disposed) {
        this.device.destroy();
        return;
      }

      this.context = this.canvas.getContext('webgpu');
      if (!this.context) {
        throw new Error('The WebGPU canvas could not be initialized.');
      }

      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.resizeCanvas();
      this.context.configure({
        device: this.device,
        format: this.format,
        alphaMode: 'premultiplied',
      });

      this.parameterBuffer = this.device.createBuffer({
        label: 'heatmap parameters',
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.sampler = this.device.createSampler({
        label: 'linear sampler',
        magFilter: 'linear',
        minFilter: 'linear',
      });

      this.motionPipeline = await this.device.createComputePipelineAsync({
        label: 'motion mask pipeline',
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({ code: MOTION_COMPUTE_SHADER }),
          entryPoint: 'computeMotion',
        },
      });
      this.renderPipeline = await this.device.createRenderPipelineAsync({
        label: 'heatmap render pipeline',
        layout: 'auto',
        vertex: {
          module: this.device.createShaderModule({ code: RENDER_SHADER }),
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: this.device.createShaderModule({ code: RENDER_SHADER }),
          entryPoint: 'fragmentMain',
          targets: [{
            format: this.format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
            },
          }],
        },
        primitive: { topology: 'triangle-list' },
      });

      if (this.disposed) {
        this.device.destroy();
        return;
      }

      void this.device.lost.then((info) => {
        if (!this.disposed && info.reason !== 'destroyed') {
          this.onError?.(`WebGPU device lost: ${info.message || info.reason}`);
        }
      });

      this.watchVideoFrames();
      this.onReady?.();
      this.animationFrame = requestAnimationFrame(this.draw);
    } catch (error) {
      this.onError?.(error instanceof Error ? error.message : 'WebGPU initialization failed.');
    }
  }

  resetHistory() {
    this.destroyVideoResources();
    this.processedFrameVersion = -1;
    this.lastVideoTime = -1;
    this.stateIndex = 0;
    this.hasHistory = false;
    this.reportedFrameError = false;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    if (this.videoFrameCallback && this.video.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.videoFrameCallback);
    }
    this.destroyVideoResources();
    this.parameterBuffer?.destroy();
    this.device?.destroy();
  }

  private watchVideoFrames() {
    if (!this.video.requestVideoFrameCallback || this.disposed) {
      return;
    }

    this.videoFrameCallback = this.video.requestVideoFrameCallback(() => {
      this.frameVersion += 1;
      this.watchVideoFrames();
    });
  }

  private readonly draw = () => {
    if (this.disposed || !this.device || !this.context || !this.renderPipeline || !this.parameterBuffer) {
      return;
    }

    this.resizeCanvas();
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.animationFrame = requestAnimationFrame(this.draw);
      return;
    }

    const values = this.getValues();
    this.video.style.opacity = String(values.opacity);
    const videoAspect = this.video.videoWidth > 0 && this.video.videoHeight > 0
      ? this.video.videoWidth / this.video.videoHeight
      : 1;

    this.device.queue.writeBuffer(
      this.parameterBuffer,
      0,
      new Float32Array([
        values.threshold,
        values.decay,
        values.mix,
        values.intensity,
        this.canvas.width / this.canvas.height,
        videoAspect,
        this.hasHistory ? 1 : 0,
        0,
      ]),
    );

    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.video.videoWidth > 0) {
      this.ensureVideoResources(this.video.videoWidth, this.video.videoHeight);
      this.updateVideoFrame();
    }

    this.render();
    this.animationFrame = requestAnimationFrame(this.draw);
  };

  private resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private ensureVideoResources(width: number, height: number) {
    if (this.resources?.width === width && this.resources.height === height) {
      return;
    }
    if (!this.device || !this.motionPipeline || !this.renderPipeline || !this.sampler || !this.parameterBuffer) {
      return;
    }

    this.destroyVideoResources();
    const scale = Math.min(DETECTION_SCALE, MAX_DETECTION_DIMENSION / Math.max(width, height));
    const detectionWidth = Math.max(1, Math.floor(width * scale));
    const detectionHeight = Math.max(1, Math.floor(height * scale));
    const currentFrame = this.device.createTexture({
      label: 'current video frame',
      size: [width, height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING
        | GPUTextureUsage.COPY_DST
        | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const makeState = (label: string) => this.device!.createTexture({
      label,
      size: [detectionWidth, detectionHeight],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
    const stateTextures: [GPUTexture, GPUTexture] = [
      makeState('motion state a'),
      makeState('motion state b'),
    ];

    const makeMotionBindGroup = (readIndex: 0 | 1, writeIndex: 0 | 1) => this.device!.createBindGroup({
      layout: this.motionPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: currentFrame.createView() },
        { binding: 1, resource: stateTextures[readIndex].createView() },
        { binding: 2, resource: stateTextures[writeIndex].createView() },
        { binding: 3, resource: { buffer: this.parameterBuffer! } },
      ],
    });
    const makeRenderBindGroup = (state: GPUTexture) => this.device!.createBindGroup({
      layout: this.renderPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler! },
        { binding: 1, resource: state.createView() },
        { binding: 2, resource: { buffer: this.parameterBuffer! } },
      ],
    });

    this.resources = {
      width,
      height,
      detectionWidth,
      detectionHeight,
      currentFrame,
      stateTextures,
      motionBindGroups: [makeMotionBindGroup(0, 1), makeMotionBindGroup(1, 0)],
      renderBindGroups: [makeRenderBindGroup(stateTextures[0]), makeRenderBindGroup(stateTextures[1])],
    };
    this.stateIndex = 0;
    this.hasHistory = false;
    this.processedFrameVersion = -1;
    this.lastVideoTime = -1;
  }

  private updateVideoFrame() {
    if (!this.device || !this.resources || !this.motionPipeline) {
      return;
    }

    const usesFrameCallback = Boolean(this.video.requestVideoFrameCallback);
    const hasNewFrame = !this.hasHistory
      || (usesFrameCallback
        ? this.processedFrameVersion !== this.frameVersion
        : Math.abs(this.video.currentTime - this.lastVideoTime) > 0.0001);
    if (!hasNewFrame) {
      return;
    }

    if (this.lastVideoTime >= 0 && this.video.currentTime + 0.05 < this.lastVideoTime) {
      this.resetHistory();
      this.ensureVideoResources(this.video.videoWidth, this.video.videoHeight);
      if (!this.resources) {
        return;
      }
    }

    try {
      this.device.queue.copyExternalImageToTexture(
        { source: this.video },
        { texture: this.resources.currentFrame },
        [this.resources.width, this.resources.height],
      );
    } catch (error) {
      if (!this.reportedFrameError) {
        this.reportedFrameError = true;
        const detail = error instanceof Error ? error.message : 'Unable to copy the video frame.';
        this.onError?.(`Video frame unavailable: ${detail}`);
      }
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'motion frame update' });
    const pass = encoder.beginComputePass({ label: 'motion mask pass' });
    pass.setPipeline(this.motionPipeline);
    pass.setBindGroup(0, this.resources.motionBindGroups[this.stateIndex]);
    pass.dispatchWorkgroups(
      Math.ceil(this.resources.detectionWidth / 8),
      Math.ceil(this.resources.detectionHeight / 8),
    );
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    this.stateIndex = this.stateIndex === 0 ? 1 : 0;
    this.hasHistory = true;
    this.processedFrameVersion = this.frameVersion;
    this.lastVideoTime = this.video.currentTime;
  }

  private render() {
    if (!this.device || !this.context || !this.renderPipeline) {
      return;
    }

    const encoder = this.device.createCommandEncoder({ label: 'heatmap render' });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    if (this.resources && this.hasHistory) {
      pass.setPipeline(this.renderPipeline);
      pass.setBindGroup(0, this.resources.renderBindGroups[this.stateIndex]);
      pass.draw(3);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private destroyVideoResources() {
    if (!this.resources) {
      return;
    }
    this.resources.currentFrame.destroy();
    this.resources.stateTextures[0].destroy();
    this.resources.stateTextures[1].destroy();
    this.resources = null;
  }
}
