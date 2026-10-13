import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acquireCallStreams, BrowserCallRecorder, type CallAudioStreams, type RecordedAudioChunk } from '@/lib/browser-call-recorder'

class AudioTrack extends EventTarget {
  readyState: MediaStreamTrackState = 'live'
  stop = vi.fn(() => { this.readyState = 'ended' })
}

function stream(audio = new AudioTrack(), video?: AudioTrack): MediaStream {
  return {
    getTracks: () => video ? [audio, video] : [audio],
    getAudioTracks: () => [audio],
    getVideoTracks: () => video ? [video] : [],
  } as unknown as MediaStream
}

const events: string[] = []
class Recorder {
  static isTypeSupported = () => true
  static instances: Recorder[] = []
  state: RecordingState = 'inactive'
  mimeType = 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  index: number
  constructor(readonly input: MediaStream) { this.index = Recorder.instances.push(this) - 1 }
  start() { this.state = 'recording'; events.push(`start:${this.index}`) }
  stop() {
    this.state = 'inactive'
    events.push(`stop:${this.index}`)
    this.ondataavailable?.({ data: new Blob([`header:${this.index}:audio`], { type: this.mimeType }) })
    this.onstop?.()
  }
}

const closeContext = vi.fn(async () => {})
class TestAudioContext {
  resume = async () => {}
  close = closeContext
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
  createAnalyser = () => ({ fftSize: 256, getByteTimeDomainData: (array: Uint8Array) => array.fill(128), disconnect: vi.fn() })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  events.length = 0
  Recorder.instances = []
  closeContext.mockClear()
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('AudioContext', TestAudioContext)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('MediaStream', class { constructor(readonly tracks: AudioTrack[]) {} getAudioTracks() { return this.tracks } getTracks() { return this.tracks } })
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('manual call audio capture', () => {
  it('captures audio only, discards display video and keeps separate microphone input', async () => {
    const video = new AudioTrack()
    const systemAudio = new AudioTrack()
    const microphone = stream()
    const getDisplayMedia = vi.fn(async () => stream(systemAudio, video))
    const getUserMedia = vi.fn(async () => microphone)
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia, getUserMedia } })
    const acquired = await acquireCallStreams()
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true })
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(video.stop).toHaveBeenCalledOnce()
    expect(systemAudio.stop).not.toHaveBeenCalled()
    expect(acquired.mic).toBe(microphone)
    expect(acquired.system?.getAudioTracks()).toEqual([systemAudio])
  })

  it('reports missing system audio explicitly instead of treating it as a full capture', async () => {
    const video = new AudioTrack()
    vi.stubGlobal('navigator', { mediaDevices: {
      getDisplayMedia: async () => ({ getVideoTracks: () => [video], getAudioTracks: () => [], getTracks: () => [video] }),
      getUserMedia: async () => stream(),
    } })
    const acquired = await acquireCallStreams()
    expect(acquired.system).toBeNull()
    expect(acquired.systemError).toContain('Share system audio')
  })

  it('releases granted system audio if the microphone permission fails', async () => {
    const systemAudio = new AudioTrack()
    vi.stubGlobal('navigator', { mediaDevices: {
      getDisplayMedia: async () => stream(systemAudio),
      getUserMedia: async () => { throw new Error('Microphone permission denied') },
    } })
    await expect(acquireCallStreams()).rejects.toThrow('Microphone permission denied')
    expect(systemAudio.stop).toHaveBeenCalledOnce()
  })

  it('refuses tab audio as PC system audio and asks for Entire screen', async () => {
    const audio = new AudioTrack()
    const video = Object.assign(new AudioTrack(), { getSettings: () => ({ displaySurface: 'browser' }) })
    vi.stubGlobal('navigator', { mediaDevices: {
      getDisplayMedia: async () => stream(audio, video), getUserMedia: async () => stream(),
    } })
    const acquired = await acquireCallStreams()
    expect(acquired.system).toBeNull()
    expect(acquired.systemError).toContain('Entire screen')
    expect(audio.stop).toHaveBeenCalledOnce()
  })

  it('does not request a microphone after preparation is canceled during the screen prompt', async () => {
    const systemAudio = new AudioTrack()
    const getUserMedia = vi.fn(async () => stream())
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => stream(systemAudio), getUserMedia } })
    await expect(acquireCallStreams(() => false)).rejects.toThrow('cancelled')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(systemAudio.stop).toHaveBeenCalledOnce()
  })

  it('starts the next self-contained recorder before stopping the previous one, per track', async () => {
    const chunks: RecordedAudioChunk[] = []
    const acquired: CallAudioStreams = { mic: stream(), system: stream(), systemError: null }
    const recording = new BrowserCallRecorder(acquired, {
      onChunk: async chunk => { chunks.push(chunk) }, onLevels: vi.fn(), onEnded: vi.fn(),
    })
    await recording.start()
    expect(Recorder.instances[0].input).toBe(acquired.mic)
    expect(Recorder.instances[1].input).toBe(acquired.system)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(events).toEqual(['start:0', 'start:1', 'start:2', 'stop:0', 'start:3', 'stop:1'])
    await vi.advanceTimersByTimeAsync(5000)
    const stopped = await recording.stop()
    expect(stopped).toEqual({ durationMs: 35_000, expectedChunks: { mic: 2, system: 2 } })
    expect(chunks.map(chunk => [chunk.track, chunk.sequence, chunk.startMs, chunk.durationMs])).toEqual([
      ['mic', 0, 0, 30_000], ['system', 0, 0, 30_000], ['mic', 1, 30_000, 5000], ['system', 1, 30_000, 5000],
    ])
    expect(await chunks[0].blob.text()).toBe('header:0:audio')
    expect(await chunks[2].blob.text()).toBe('header:2:audio')
    expect(closeContext).toHaveBeenCalledOnce()
    expect(acquired.mic.getTracks()[0].readyState).toBe('ended')
  })

  it('waits for durable chunk writes before resolving Stop and makes Stop idempotent', async () => {
    let persist: (() => void) | undefined
    const recording = new BrowserCallRecorder({ mic: stream(), system: null, systemError: null }, {
      onChunk: () => new Promise<void>(resolve => { persist = resolve }), onLevels: vi.fn(), onEnded: vi.fn(),
    })
    await recording.start()
    await vi.advanceTimersByTimeAsync(1000)
    const stopped = recording.stop()
    expect(recording.stop()).toBe(stopped)
    let resolved = false
    void stopped.then(() => { resolved = true })
    await Promise.resolve()
    expect(resolved).toBe(false)
    persist?.()
    expect(await stopped).toEqual({ durationMs: 1000, expectedChunks: { mic: 1, system: 0 } })
  })

  it('notifies once when screen sharing or microphone capture ends', async () => {
    const system = new AudioTrack()
    const mic = new AudioTrack()
    const onEnded = vi.fn()
    const recording = new BrowserCallRecorder({ mic: stream(mic), system: stream(system), systemError: null }, {
      onChunk: async () => {}, onLevels: vi.fn(), onEnded,
    })
    await recording.start()
    system.dispatchEvent(new Event('ended'))
    mic.dispatchEvent(new Event('ended'))
    expect(onEnded).toHaveBeenCalledOnce()
    expect(onEnded).toHaveBeenCalledWith('Screen sharing ended. Recording has stopped.')
    await recording.stop()
  })
})
