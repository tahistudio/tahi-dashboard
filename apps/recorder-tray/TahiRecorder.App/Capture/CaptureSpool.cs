using System.Globalization;
using System.Text.Json;
using TahiRecorder.Core.Audio;

namespace TahiRecorder.App.Capture;

/// <summary>Incremental PCM stays on disk until durable outbox ownership is acknowledged.</summary>
internal sealed class CaptureSpool : IDisposable
{
    public const int ChunkDurationMs = 30_000;
    private const int SamplesPerChunk = ChunkDurationMs * CanonicalWav.SampleRate / 1_000;
    private const int MaximumDurationMs = 12 * 60 * 60 * 1_000;
    private readonly string _directory;
    private readonly Guid _clientRef;
    private readonly Dictionary<string, TrackState> _tracks;
    private int _durationMs;
    private bool _completed;

    private sealed class TrackState
    {
        public int NextSequence { get; set; }
        public Dictionary<int, FileStream> Streams { get; } = [];
    }

    private sealed record Journal(Guid ClientRef, int DurationMs, bool Completed, Dictionary<string, int> NextSequences);

    public CaptureSpool(string spoolDirectory, Guid clientRef)
    {
        _directory = Path.Combine(Path.GetFullPath(spoolDirectory), clientRef.ToString("D"));
        _clientRef = clientRef;
        if (Directory.Exists(_directory))
            throw new IOException("Capture spool already exists for this recording.");
        Directory.CreateDirectory(_directory);
        _tracks = new Dictionary<string, TrackState>
        {
            ["mic"] = new(),
            ["system"] = new()
        };
        SaveJournal();
    }

    public void AddAt(string track, long startSample, ReadOnlySpan<byte> pcm)
    {
        var state = _tracks[track];
        var minimumSample = (long)state.NextSequence * SamplesPerChunk;
        if (startSample < minimumSample)
        {
            var skip = (int)Math.Min(pcm.Length, (minimumSample - startSample) * 2);
            pcm = pcm[skip..];
            startSample = minimumSample;
        }
        startSample = Math.Clamp(startSample, 0, (long)MaximumDurationMs * 16);
        var maximumBytes = (int)Math.Min(pcm.Length, ((long)MaximumDurationMs * 16 - startSample) * 2);
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
    }

    public IReadOnlyList<CapturedChunk> Advance(int durationMs, bool complete)
    {
        _durationMs = Math.Clamp(Math.Max(_durationMs, durationMs), 0, MaximumDurationMs);
        var result = new List<CapturedChunk>();
        foreach (var (track, state) in _tracks)
        {
            while ((long)state.NextSequence * ChunkDurationMs < _durationMs)
            {
                var chunkDuration = Math.Min(ChunkDurationMs, _durationMs - state.NextSequence * ChunkDurationMs);
                var stream = GetStream(track, state, state.NextSequence);
                var requiredLength = chunkDuration * CanonicalWav.BytesPerMillisecond;
                if (stream.Length < requiredLength)
                    stream.SetLength(requiredLength);
                stream.Flush(flushToDisk: true);
                if (chunkDuration < ChunkDurationMs && !complete)
                    break;
                result.Add(FinalizeChunk(track, state, chunkDuration));
            }
        }
        _completed = complete;
        SaveJournal();
        return result;
    }

    private CapturedChunk FinalizeChunk(string track, TrackState state, int durationMs)
    {
        var sequence = state.NextSequence;
        var pcmPath = Path.Combine(_directory, $"{track}-{sequence:D4}.pcm");
        if (state.Streams.Remove(sequence, out var stream))
            stream.Dispose();
        var wavPath = Path.Combine(_directory, $"{track}-{sequence:D4}.wav");
        WriteCanonicalFile(wavPath, pcmPath, durationMs);
        File.Delete(pcmPath);
        state.NextSequence++;
        return new CapturedChunk(_clientRef, track, sequence, sequence * ChunkDurationMs, durationMs, wavPath);
    }

    private FileStream GetStream(string track, TrackState state, int sequence)
    {
        if (state.Streams.TryGetValue(sequence, out var stream))
            return stream;
        stream = new FileStream(Path.Combine(_directory, $"{track}-{sequence:D4}.pcm"),
            FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read, 4_096, FileOptions.WriteThrough);
        state.Streams[sequence] = stream;
        return stream;
    }

    private void SaveJournal()
    {
        var path = Path.Combine(_directory, "session.json");
        var journal = new Journal(_clientRef, _durationMs, _completed,
            _tracks.ToDictionary(item => item.Key, item => item.Value.NextSequence));
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

    private static void WriteCanonicalFile(string wavPath, string pcmPath, int durationMs)
    {
        using (var output = new FileStream(wavPath + ".tmp", FileMode.Create, FileAccess.Write,
            FileShare.None, 4_096, FileOptions.WriteThrough))
        {
            using var input = File.Exists(pcmPath) ? File.OpenRead(pcmPath) : Stream.Null;
            CanonicalWav.Write(output, input, durationMs);
            output.Flush(flushToDisk: true);
        }
        File.Move(wavPath + ".tmp", wavPath, overwrite: true);
    }

    public static IReadOnlyList<RecoveredCapture> RecoverInterrupted(string spoolDirectory)
    {
        if (!Directory.Exists(spoolDirectory))
            return [];
        var recovered = new List<RecoveredCapture>();
        foreach (var directory in Directory.EnumerateDirectories(spoolDirectory))
        {
            if (!Guid.TryParseExact(Path.GetFileName(directory), "D", out var clientRef))
                continue;
            var journalPath = Path.Combine(directory, "session.json");
            if (!File.Exists(journalPath))
                continue;
            Journal? journal;
            try
            {
                journal = JsonSerializer.Deserialize<Journal>(File.ReadAllBytes(journalPath));
            }
            catch (JsonException)
            {
                // Preserve damaged spools for recovery instead of deleting audio.
                continue;
            }
            if (journal is null || journal.ClientRef != clientRef || journal.NextSequences is null)
                continue;
            var durationMs = Math.Clamp(journal.DurationMs, 0, MaximumDurationMs);
            foreach (var file in journal.Completed ? Array.Empty<string>() : Directory.EnumerateFiles(directory))
            {
                if (!TryParseChunkFile(file, out _, out var sequence))
                    continue;
                var length = new FileInfo(file).Length;
                var payloadLength = Path.GetExtension(file) == ".wav" ? length - CanonicalWav.HeaderSize : length;
                if (payloadLength < 0)
                    continue;
                durationMs = Math.Max(durationMs, Math.Min(MaximumDurationMs,
                    sequence * ChunkDurationMs + (int)Math.Min(ChunkDurationMs, payloadLength / 32)));
            }
            if (!journal.Completed)
            {
                foreach (var track in new[] { "mic", "system" })
                {
                    var nextSequence = journal.NextSequences.GetValueOrDefault(track);
                    if (nextSequence < 0 || nextSequence > MaximumDurationMs / ChunkDurationMs)
                        continue;
                    while ((long)nextSequence * ChunkDurationMs < durationMs)
                    {
                        var chunkDuration = Math.Min(ChunkDurationMs, durationMs - nextSequence * ChunkDurationMs);
                        var wavPath = Path.Combine(directory, $"{track}-{nextSequence:D4}.wav");
                        var pcmPath = Path.Combine(directory, $"{track}-{nextSequence:D4}.pcm");
                        if (!File.Exists(wavPath))
                            WriteCanonicalFile(wavPath, pcmPath, chunkDuration);
                        File.Delete(pcmPath);
                        nextSequence++;
                    }
                    journal.NextSequences[track] = nextSequence;
                }
                journal = journal with { DurationMs = durationMs, Completed = true };
                WriteDurably(journalPath + ".tmp", JsonSerializer.SerializeToUtf8Bytes(journal));
                File.Move(journalPath + ".tmp", journalPath, overwrite: true);
            }
            var chunks = new List<CapturedChunk>();
            foreach (var wavPath in Directory.EnumerateFiles(directory, "*.wav"))
            {
                if (!TryParseChunkFile(wavPath, out var track, out var sequence))
                    continue;
                var length = new FileInfo(wavPath).Length - CanonicalWav.HeaderSize;
                if (length <= 0 || length % 32 != 0 || length > ChunkDurationMs * 32)
                    continue;
                chunks.Add(new CapturedChunk(clientRef, track, sequence, sequence * ChunkDurationMs,
                    checked((int)(length / 32)), wavPath));
            }
            recovered.Add(new RecoveredCapture(clientRef, durationMs,
                chunks.OrderBy(chunk => chunk.Sequence).ThenBy(chunk => chunk.Track).ToList()));
        }
        return recovered;
    }

    private static bool TryParseChunkFile(string path, out string track, out int sequence)
    {
        track = string.Empty;
        sequence = 0;
        var extension = Path.GetExtension(path);
        if (extension is not (".pcm" or ".wav"))
            return false;
        var name = Path.GetFileNameWithoutExtension(path).Split('-');
        if (name.Length != 2 || name[0] is not ("mic" or "system") ||
            !int.TryParse(name[1], NumberStyles.None, CultureInfo.InvariantCulture, out sequence) ||
            sequence < 0 || sequence >= MaximumDurationMs / ChunkDurationMs)
            return false;
        track = name[0];
        return true;
    }

    public void Dispose()
    {
        foreach (var state in _tracks.Values)
        {
            foreach (var stream in state.Streams.Values)
                stream.Dispose();
            state.Streams.Clear();
        }
    }
}
