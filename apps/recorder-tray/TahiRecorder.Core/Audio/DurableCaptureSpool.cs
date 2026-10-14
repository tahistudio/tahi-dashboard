using System.Globalization;
using System.Text.Json;

namespace TahiRecorder.Core.Audio;

public sealed record SpoolChunk(Guid ClientRef, string Track, int Sequence, int StartMs, int DurationMs, string FilePath);
public sealed record RecoveredSpool(Guid ClientRef, int DurationMs, IReadOnlyList<SpoolChunk> Chunks);

/// <summary>A discontinuity ends capture instead of creating an unbounded silent audio file.</summary>
public sealed class CaptureGapExceededException(int stopDurationMs) : Exception("Audio capture paused for more than 10 seconds.")
{
    public int StopDurationMs { get; } = stopDurationMs;
}

/// <summary>Durable two-track PCM timeline, chunk formation and interrupted-session recovery.</summary>
public sealed class DurableCaptureSpool : IDisposable
{
    public const int ChunkDurationMs = 30_000;
    public const int MinimumFinalChunkMs = 2_000;
    public const int MaximumPaddingMs = 10_000;
    public const int MaximumDurationMs = 12 * 60 * 60 * 1_000;
    private const int SamplesPerMillisecond = CanonicalWav.SampleRate / 1_000;
    private const int SamplesPerChunk = ChunkDurationMs * SamplesPerMillisecond;
    private readonly string _directory;
    private readonly Guid _clientRef;
    private readonly Dictionary<string, TrackState> _tracks;
    private int _durationMs;
    private bool _completed;

    private sealed class TrackState
    {
        public int NextSequence { get; set; }
        public long AudioEndSample { get; set; }
        public Dictionary<int, FileStream> Streams { get; } = [];
    }

    private sealed record Journal(Guid ClientRef, int DurationMs, bool Completed,
        Dictionary<string, int> NextSequences, Dictionary<string, long>? AudioEndSamples = null);

    public DurableCaptureSpool(string spoolDirectory, Guid clientRef)
        : this(Path.Combine(Path.GetFullPath(spoolDirectory), clientRef.ToString("D")), clientRef,
            new Dictionary<string, TrackState> { ["mic"] = new(), ["system"] = new() })
    {
        if (Directory.Exists(_directory)) throw new IOException("Capture spool already exists for this recording.");
        Directory.CreateDirectory(_directory);
        SaveJournal();
    }

    private DurableCaptureSpool(string directory, Guid clientRef, Dictionary<string, TrackState> tracks)
    {
        _directory = directory;
        _clientRef = clientRef;
        _tracks = tracks;
    }

    public void AddAt(string track, long startSample, ReadOnlySpan<byte> pcm)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(startSample);
        if (!_tracks.TryGetValue(track, out var state)) throw new ArgumentException("Unknown audio track.", nameof(track));
        if (pcm.Length % 2 != 0) throw new ArgumentException("PCM must contain complete 16-bit samples.", nameof(pcm));
        if (_completed) throw new InvalidOperationException("Capture spool is already complete.");
        if (pcm.IsEmpty) return;
        var minimumSample = (long)state.NextSequence * SamplesPerChunk;
        if (startSample < minimumSample)
        {
            var skip = (int)Math.Min(pcm.Length, (minimumSample - startSample) * 2);
            pcm = pcm[skip..];
            startSample = minimumSample;
        }
        if (pcm.IsEmpty) return;
        if (startSample - state.AudioEndSample > MaximumPaddingMs * SamplesPerMillisecond)
            throw new CaptureGapExceededException(PaddingLimitMs());
        startSample = Math.Min(startSample, (long)MaximumDurationMs * SamplesPerMillisecond);
        var maximumBytes = (int)Math.Min(pcm.Length, ((long)MaximumDurationMs * SamplesPerMillisecond - startSample) * 2);
        pcm = pcm[..(maximumBytes - maximumBytes % 2)];
        while (!pcm.IsEmpty)
        {
            var sequence = checked((int)(startSample / SamplesPerChunk));
            var sampleInChunk = startSample % SamplesPerChunk;
            var count = (int)Math.Min(pcm.Length, (SamplesPerChunk - sampleInChunk) * 2);
            var stream = GetStream(track, state, sequence);
            stream.Position = sampleInChunk * 2;
            stream.Write(pcm[..count]);
            stream.Flush(flushToDisk: true);
            pcm = pcm[count..];
            startSample += count / 2;
        }
        state.AudioEndSample = Math.Max(state.AudioEndSample, startSample);
    }

    public IReadOnlyList<SpoolChunk> Advance(int durationMs, bool complete)
    {
        if (_completed) throw new InvalidOperationException("Capture spool is already complete.");
        durationMs = Math.Clamp(Math.Max(_durationMs, durationMs), 0, MaximumDurationMs);
        if (durationMs > PaddingLimitMs()) throw new CaptureGapExceededException(PaddingLimitMs());
        _durationMs = durationMs;
        var result = new List<SpoolChunk>();
        foreach (var (track, state) in _tracks)
        {
            while ((long)state.NextSequence * ChunkDurationMs < _durationMs)
            {
                var remainingMs = _durationMs - state.NextSequence * ChunkDurationMs;
                // Retain the most recent full chunk until a possible short tail can be folded into it.
                if (!complete && remainingMs < ChunkDurationMs + MinimumFinalChunkMs) break;
                var chunkDuration = complete && remainingMs < ChunkDurationMs + MinimumFinalChunkMs
                    ? remainingMs : ChunkDurationMs;
                result.Add(FinalizeChunk(track, state, chunkDuration));
            }
        }
        _completed = complete;
        SaveJournal();
        return result;
    }

    private int PaddingLimitMs() => checked((int)Math.Min(MaximumDurationMs,
        _tracks.Values.Min(state => state.AudioEndSample) / SamplesPerMillisecond + MaximumPaddingMs));

    private SpoolChunk FinalizeChunk(string track, TrackState state, int durationMs)
    {
        var sequence = state.NextSequence;
        var slots = (durationMs + ChunkDurationMs - 1) / ChunkDurationMs;
        var pcmPaths = new List<string>();
        for (var slot = sequence; slot < sequence + slots; slot++)
        {
            if (state.Streams.Remove(slot, out var stream)) stream.Dispose();
            pcmPaths.Add(ChunkPath(_directory, track, slot, ".pcm"));
        }
        var wavPath = ChunkPath(_directory, track, sequence, ".wav");
        WriteCanonicalFile(wavPath, pcmPaths, durationMs);
        foreach (var pcmPath in pcmPaths) File.Delete(pcmPath);
        state.NextSequence += slots;
        return new SpoolChunk(_clientRef, track, sequence, sequence * ChunkDurationMs, durationMs, wavPath);
    }

    private FileStream GetStream(string track, TrackState state, int sequence)
    {
        if (state.Streams.TryGetValue(sequence, out var stream)) return stream;
        stream = new FileStream(ChunkPath(_directory, track, sequence, ".pcm"),
            FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read, 4_096, FileOptions.WriteThrough);
        state.Streams[sequence] = stream;
        return stream;
    }

    private void SaveJournal()
    {
        var path = Path.Combine(_directory, "session.json");
        var journal = new Journal(_clientRef, _durationMs, _completed,
            _tracks.ToDictionary(item => item.Key, item => item.Value.NextSequence),
            _tracks.ToDictionary(item => item.Key, item => item.Value.AudioEndSample));
        WriteDurably(path + ".tmp", JsonSerializer.SerializeToUtf8Bytes(journal));
        File.Move(path + ".tmp", path, overwrite: true);
    }

    private static void WriteDurably(string path, ReadOnlySpan<byte> content)
    {
        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None,
            4_096, FileOptions.WriteThrough);
        stream.Write(content);
        stream.Flush(flushToDisk: true);
    }

    private static void WriteCanonicalFile(string wavPath, IReadOnlyList<string> pcmPaths, int durationMs)
    {
        using (var output = new FileStream(wavPath + ".tmp", FileMode.Create, FileAccess.Write,
            FileShare.None, 4_096, FileOptions.WriteThrough))
        {
            output.Write(CanonicalWav.CreateHeader(durationMs));
            var remainingMs = durationMs;
            var buffer = new byte[8_192];
            foreach (var pcmPath in pcmPaths)
            {
                using var input = File.Exists(pcmPath) ? File.OpenRead(pcmPath) : Stream.Null;
                var remainingBytes = Math.Min(remainingMs, ChunkDurationMs) * CanonicalWav.BytesPerMillisecond;
                remainingMs -= remainingBytes / CanonicalWav.BytesPerMillisecond;
                while (remainingBytes > 0)
                {
                    var count = Math.Min(buffer.Length, remainingBytes);
                    var read = input.Read(buffer, 0, count);
                    if (read == 0)
                    {
                        Array.Clear(buffer);
                        output.Write(buffer, 0, count);
                        remainingBytes -= count;
                    }
                    else
                    {
                        output.Write(buffer, 0, read);
                        remainingBytes -= read;
                    }
                }
            }
            output.Flush(flushToDisk: true);
        }
        File.Move(wavPath + ".tmp", wavPath, overwrite: true);
    }

    public static IReadOnlyList<RecoveredSpool> RecoverInterrupted(string spoolDirectory)
    {
        if (!Directory.Exists(spoolDirectory)) return [];
        var recovered = new List<RecoveredSpool>();
        foreach (var directory in Directory.EnumerateDirectories(spoolDirectory))
        {
            if (!Guid.TryParseExact(Path.GetFileName(directory), "D", out var clientRef)) continue;
            try
            {
                var capture = RecoverOne(directory, clientRef);
                if (capture is not null) recovered.Add(capture);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Keep damaged audio untouched. The host surfaces its missing recovery as needs attention.
            }
        }
        return recovered;
    }

    private static RecoveredSpool? RecoverOne(string directory, Guid clientRef)
    {
        var journalPath = Path.Combine(directory, "session.json");
        if (!File.Exists(journalPath)) return null;
        var journal = JsonSerializer.Deserialize<Journal>(File.ReadAllBytes(journalPath));
        if (journal is null || journal.ClientRef != clientRef || journal.NextSequences is null
            || journal.DurationMs is < 0 or > MaximumDurationMs || journal.NextSequences.Count != 2
            || !journal.NextSequences.ContainsKey("mic") || !journal.NextSequences.ContainsKey("system")
            || journal.NextSequences.Values.Any(sequence => sequence < 0 || sequence > MaximumDurationMs / ChunkDurationMs)
            || journal.AudioEndSamples is not null && (journal.AudioEndSamples.Count != 2
                || !journal.AudioEndSamples.ContainsKey("mic") || !journal.AudioEndSamples.ContainsKey("system")
                || journal.AudioEndSamples.Values.Any(sample => sample < 0
                    || sample > (long)MaximumDurationMs * SamplesPerMillisecond)))
            throw new InvalidDataException("Invalid capture journal.");
        var tracks = journal.NextSequences.ToDictionary(item => item.Key, item => new TrackState
        {
            NextSequence = item.Value,
            AudioEndSample = journal.AudioEndSamples?.GetValueOrDefault(item.Key) ?? (long)item.Value * SamplesPerChunk
        });
        var durationMs = journal.DurationMs;
        var chunks = new List<SpoolChunk>();
        foreach (var file in Directory.EnumerateFiles(directory))
        {
            if (!TryParseChunkFile(file, out var track, out var sequence)) continue;
            var state = tracks[track];
            var isWav = Path.GetExtension(file) == ".wav";
            var payloadLength = new FileInfo(file).Length - (isWav ? CanonicalWav.HeaderSize : 0);
            if (payloadLength < 0 || payloadLength % 2 != 0
                || payloadLength > (long)(isWav ? ChunkDurationMs + MinimumFinalChunkMs - 1 : ChunkDurationMs)
                    * CanonicalWav.BytesPerMillisecond)
                throw new InvalidDataException("Invalid captured audio length.");
            var fileDuration = checked((int)(payloadLength / CanonicalWav.BytesPerMillisecond));
            var endMs = sequence * ChunkDurationMs + fileDuration;
            if (endMs > MaximumDurationMs) throw new InvalidDataException("Captured audio exceeds maximum duration.");
            if (!journal.Completed) durationMs = Math.Max(durationMs, endMs);
            if (isWav)
            {
                if (fileDuration <= 0 || payloadLength % CanonicalWav.BytesPerMillisecond != 0)
                    throw new InvalidDataException("Invalid captured WAV duration.");
                using var stream = File.OpenRead(file);
                var header = new byte[CanonicalWav.HeaderSize];
                stream.ReadExactly(header);
                if (!header.AsSpan().SequenceEqual(CanonicalWav.CreateHeader(fileDuration)))
                    throw new InvalidDataException("Invalid captured WAV header.");
                chunks.Add(new SpoolChunk(clientRef, track, sequence, sequence * ChunkDurationMs, fileDuration, file));
                state.NextSequence = Math.Max(state.NextSequence,
                    sequence + (fileDuration + ChunkDurationMs - 1) / ChunkDurationMs);
            }
            state.AudioEndSample = Math.Max(state.AudioEndSample, (long)sequence * SamplesPerChunk + payloadLength / 2);
        }
        if (!journal.Completed)
        {
            using var spool = new DurableCaptureSpool(directory, clientRef, tracks);
            // Recovery also refuses to manufacture more than 10 seconds of missing audio.
            var safeDuration = Math.Min(durationMs, spool.PaddingLimitMs());
            chunks.AddRange(spool.Advance(safeDuration, complete: true));
            durationMs = safeDuration;
        }
        return new RecoveredSpool(clientRef, durationMs,
            chunks.OrderBy(chunk => chunk.Sequence).ThenBy(chunk => chunk.Track).ToList());
    }

    private static string ChunkPath(string directory, string track, int sequence, string extension) =>
        Path.Combine(directory, $"{track}-{sequence:D4}{extension}");

    private static bool TryParseChunkFile(string path, out string track, out int sequence)
    {
        track = string.Empty;
        sequence = 0;
        if (Path.GetExtension(path) is not (".pcm" or ".wav")) return false;
        var name = Path.GetFileNameWithoutExtension(path).Split('-');
        if (name.Length != 2 || name[0] is not ("mic" or "system")
            || !int.TryParse(name[1], NumberStyles.None, CultureInfo.InvariantCulture, out sequence)
            || sequence < 0 || sequence >= MaximumDurationMs / ChunkDurationMs) return false;
        track = name[0];
        return true;
    }

    public void Dispose()
    {
        foreach (var state in _tracks.Values)
        {
            foreach (var stream in state.Streams.Values) stream.Dispose();
            state.Streams.Clear();
        }
    }
}
