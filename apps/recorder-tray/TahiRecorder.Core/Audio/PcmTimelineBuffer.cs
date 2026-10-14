namespace TahiRecorder.Core.Audio;

/// <summary>
/// Positions PCM against a shared recording clock. Missing loopback data stays
/// silent, while late packets cannot move already emitted audio backwards.
/// </summary>
public sealed class PcmTimelineBuffer
{
    private readonly object _gate = new();
    private readonly SortedDictionary<long, byte[]> _segments = new();
    public long ConsumedSamples { get; private set; }

    public void AddAt(long startSample, ReadOnlySpan<byte> pcm)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(startSample);
        if (pcm.Length % 2 != 0) throw new ArgumentException("PCM must contain complete 16-bit samples.", nameof(pcm));
        if (pcm.Length == 0) return;
        lock (_gate)
        {
            var skip = Math.Max(0, ConsumedSamples - startSample);
            if (skip >= pcm.Length / 2) return;
            _segments[startSample + skip] = pcm[checked((int)skip * 2)..].ToArray();
        }
    }

    public byte[] TakeThrough(long endSample)
    {
        lock (_gate)
        {
            if (endSample < ConsumedSamples) throw new ArgumentOutOfRangeException(nameof(endSample));
            var result = new byte[checked((int)(endSample - ConsumedSamples) * 2)];
            var remove = new List<long>();
            byte[]? remainder = null;
            foreach (var (start, data) in _segments)
            {
                if (start >= endSample) break;
                var copyStart = Math.Max(start, ConsumedSamples);
                var copyEnd = Math.Min(start + data.Length / 2, endSample);
                if (copyEnd > copyStart)
                    data.AsSpan(checked((int)(copyStart - start) * 2), checked((int)(copyEnd - copyStart) * 2))
                        .CopyTo(result.AsSpan(checked((int)(copyStart - ConsumedSamples) * 2)));
                remove.Add(start);
                if (start + data.Length / 2 > endSample)
                    remainder = data.AsSpan(checked((int)(endSample - start) * 2)).ToArray();
            }
            foreach (var key in remove) _segments.Remove(key);
            if (remainder is not null) _segments[endSample] = remainder;
            ConsumedSamples = endSample;
            return result;
        }
    }
}
