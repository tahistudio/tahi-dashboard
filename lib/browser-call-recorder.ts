import type { RecordingTrack, ReserveRecordingChunk } from '@/lib/meeting-recordings-types'
import { encodeRecordingPcmWav, RECORDING_PCM_SAMPLE_RATE } from '@/lib/recording-group-audio'

export interface CallAudioStreams {
  mic: MediaStream
  system: MediaStream | null
  systemError: string | null
}

export interface RecordedAudioChunk extends ReserveRecordingChunk {
  blob: Blob
}

export async function convertRecordingGroupAudioBlob(blob: Blob, context?: AudioContext): Promise<Blob> {
  const decoder = context ?? new AudioContext()
  try {
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer())
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 180) {
      throw new Error('System audio chunk is too long or has invalid timing. Keep the recorder open and retry.')
    }
    const frameCount = Math.max(1, Math.round(decoded.duration * RECORDING_PCM_SAMPLE_RATE))
    const offline = new OfflineAudioContext(1, frameCount, RECORDING_PCM_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const mono = await offline.startRendering()
    return new Blob([encodeRecordingPcmWav(mono.getChannelData(0))], { type: 'audio/wav' })
  } catch (error) {
    throw new Error(error instanceof Error ? `System audio conversion failed: ${error.message}` : 'System audio conversion failed. Retry the recording.')
  } finally {
    if (!context) await decoder.close()
  }
}

export function releaseCallStreams(streams: CallAudioStreams): void {
  for (const stream of [streams.mic, streams.system]) {
    stream?.getTracks().forEach(track => track.stop())
  }
}

/** Display capture must start in the click handler to retain browser activation. */
export async function acquireCallStreams(isActive: () => boolean = () => true): Promise<CallAudioStreams> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Audio recording is unavailable in this browser. Use Chrome, Edge or Vivaldi on Windows.')
  }
  let display: MediaStream | null = null
  let systemError: string | null = null
  try {
    if (!navigator.mediaDevices.getDisplayMedia) {
      systemError = 'This browser cannot share system audio.'
    } else {
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        const surface = display.getVideoTracks()[0]?.getSettings?.().displaySurface
        display.getVideoTracks().forEach(track => track.stop())
        if (surface && surface !== 'monitor') {
          display.getTracks().forEach(track => track.stop())
          display = null
          systemError = 'A tab or window was selected. Pick Entire screen and tick Share system audio to capture your PC audio.'
        } else if (!display.getAudioTracks().some(track => track.readyState === 'live')) {
          display.getTracks().forEach(track => track.stop())
          display = null
          systemError = 'System audio was not shared. Pick Entire screen and tick Share system audio.'
        }
      } catch {
        systemError = 'Screen sharing was cancelled or system audio is unavailable. Pick Entire screen and tick Share system audio.'
      }
    }
    if (!isActive()) throw new Error('Recording preparation was cancelled.')
    const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (!isActive()) {
      mic.getTracks().forEach(track => track.stop())
      throw new Error('Recording preparation was cancelled.')
    }
    if (!mic.getAudioTracks().some(track => track.readyState === 'live')) {
      mic.getTracks().forEach(track => track.stop())
      throw new Error('No microphone audio is available. Check your microphone and browser permission, then retry.')
    }
    return { mic, system: display ? new MediaStream(display.getAudioTracks()) : null, systemError }
  } catch (error) {
    display?.getTracks().forEach(track => track.stop())
    throw error
  }
}

interface RecorderCallbacks {
  onChunk: (chunk: RecordedAudioChunk) => Promise<void>
  onLevels: (levels: { mic: number; system: number }) => void
  onEnded: (message: string) => void
}

interface ActiveChunk {
  recorder: MediaRecorder
  complete: Promise<void>
}

export interface BrowserCallRecorderOptions {
  separateSpeakers?: boolean
}

/** Each recorder produces an independently decodable WebM, including its header. */
export class BrowserCallRecorder {
  private readonly active = new Map<RecordingTrack, ActiveChunk>()
  private readonly completed: Promise<void>[] = []
  private readonly sequences = { mic: 0, system: 0 }
  private context: AudioContext | null = null
  private sources: MediaStreamAudioSourceNode[] = []
  private analysers = new Map<RecordingTrack, AnalyserNode>()
  private rotation: ReturnType<typeof setInterval> | null = null
  private meterFrame: number | null = null
  private started = -1
  private stopping = false
  private ended = false
  private stopPromise: Promise<{ expectedChunks: { mic: number; system: number }; durationMs: number }> | null = null

  constructor(
    private readonly streams: CallAudioStreams,
    private readonly callbacks: RecorderCallbacks,
    private readonly options: BrowserCallRecorderOptions = {},
  ) {}

  async start(): Promise<void> {
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type))
    if (!mimeType) throw new Error('This browser cannot record WebM audio. Use a Chromium browser on Windows.')
    if (this.options.separateSpeakers && !this.streams.system) throw new Error('Speaker separation requires system audio. Share system audio or turn speaker separation off.')
    if (this.options.separateSpeakers && typeof OfflineAudioContext === 'undefined') throw new Error('Speaker separation audio conversion is unavailable in this browser. Turn speaker separation off or use a current Windows Chromium browser.')
    this.context = new AudioContext()
    await this.context.resume()
    this.started = performance.now()
    for (const track of ['mic', 'system'] as const) {
      const stream = this.streams[track]
      if (!stream) continue
      if (!stream.getAudioTracks().some(audio => audio.readyState === 'live')) {
        throw new Error(`${track === 'mic' ? 'Microphone' : 'System audio'} ended before recording started. Retry capture.`)
      }
      stream.getAudioTracks().forEach(audio => audio.addEventListener('ended', () => {
        this.notifyEnded(track === 'system' ? 'Screen sharing ended. Recording has stopped.' : 'The microphone disconnected. Recording has stopped.')
      }, { once: true }))
      const source = this.context.createMediaStreamSource(stream)
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      this.sources.push(source)
      this.analysers.set(track, analyser)
      this.active.set(track, this.beginChunk(track, stream, mimeType))
    }
    this.rotation = setInterval(() => {
      if (this.stopping) return
      try {
        for (const [track, previous] of this.active) {
          const stream = this.streams[track]
          if (!stream) continue
          const next = this.beginChunk(track, stream, mimeType)
          this.active.set(track, next)
          if (previous.recorder.state !== 'inactive') previous.recorder.stop()
        }
      } catch {
        this.notifyEnded('An audio input stopped working. Recording has stopped; saved chunks can still be recovered.')
      }
    }, 30_000)
    this.readLevels()
  }

  private notifyEnded(message: string): void {
    if (this.stopping || this.ended) return
    this.ended = true
    this.callbacks.onEnded(message)
  }

  private beginChunk(track: RecordingTrack, stream: MediaStream, mimeType: string): ActiveChunk {
    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 64_000 })
    const sequence = this.sequences[track]
    const startMs = Math.round(performance.now() - this.started)
    const parts: Blob[] = []
    const complete = new Promise<void>((resolve, reject) => {
      recorder.ondataavailable = event => { if (event.data.size > 0) parts.push(event.data) }
      recorder.onstop = () => {
        const blob = new Blob(parts, { type: recorder.mimeType })
        const durationMs = Math.max(1, Math.round(performance.now() - this.started) - startMs)
        if (blob.size === 0) {
          reject(new Error(`${track === 'mic' ? 'Microphone' : 'System audio'} produced an empty chunk.`))
          return
        }
        // Persist the original before upload preparation converts an opt-in system chunk.
        void this.callbacks.onChunk({ track, sequence, startMs, durationMs, mimeType: blob.type, size: blob.size, blob }).then(resolve, reject)
      }
      recorder.onerror = () => {
        this.notifyEnded('Audio capture failed. Saved chunks remain available for recovery.')
      }
    })
    // Observe errors immediately, even while a long call is still recording.
    void complete.catch(error => this.notifyEnded(error instanceof Error ? error.message : 'Audio could not be saved. Recording has stopped.'))
    recorder.start()
    this.completed.push(complete)
    this.sequences[track] += 1
    return { recorder, complete }
  }

  private readLevels = (): void => {
    if (this.stopping) return
    const levels = { mic: 0, system: 0 }
    for (const [track, analyser] of this.analysers) {
      const samples = new Uint8Array(analyser.fftSize)
      analyser.getByteTimeDomainData(samples)
      const squareSum = samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0)
      levels[track] = Math.min(1, Math.sqrt(squareSum / samples.length) * 4)
    }
    this.callbacks.onLevels(levels)
    this.meterFrame = requestAnimationFrame(this.readLevels)
  }

  stop(): Promise<{ expectedChunks: { mic: number; system: number }; durationMs: number }> {
    if (this.stopPromise) return this.stopPromise
    this.stopping = true
    if (this.rotation) clearInterval(this.rotation)
    if (this.meterFrame !== null) cancelAnimationFrame(this.meterFrame)
    const durationMs = this.started >= 0 ? Math.max(1, Math.round(performance.now() - this.started)) : 0
    this.stopPromise = (async () => {
      try {
        for (const chunk of this.active.values()) {
          if (chunk.recorder.state !== 'inactive') chunk.recorder.stop()
        }
        await Promise.all(this.completed)
        return { expectedChunks: { ...this.sequences }, durationMs }
      } finally {
        releaseCallStreams(this.streams)
        this.sources.forEach(source => source.disconnect())
        this.analysers.forEach(analyser => analyser.disconnect())
        await this.context?.close()
      }
    })()
    return this.stopPromise
  }
}
