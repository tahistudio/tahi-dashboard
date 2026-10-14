using System.Buffers.Binary;

namespace TahiRecorder.Core.Audio;

/// <summary>Canonical wire format required by the device chunk endpoint.</summary>
public static class CanonicalWav
{
    public const int HeaderSize = 44;
    public const int SampleRate = 16_000;
    public const int BytesPerMillisecond = 32;
    public const string MimeType = "audio/wav";

    public static byte[] Write(ReadOnlySpan<byte> pcm, int durationMs)
    {
        var payloadSize = PayloadSize(durationMs);
        var result = new byte[checked(HeaderSize + payloadSize)];
        CreateHeader(durationMs).CopyTo(result, 0);
        pcm[..Math.Min(pcm.Length, payloadSize)].CopyTo(result.AsSpan(HeaderSize));
        return result;
    }

    public static byte[] CreateHeader(int durationMs)
    {
        var payloadSize = PayloadSize(durationMs);
        var result = new byte[HeaderSize];
        "RIFF"u8.CopyTo(result);
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(4), checked((uint)(36L + payloadSize)));
        "WAVEfmt "u8.CopyTo(result.AsSpan(8));
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(16), 16);
        BinaryPrimitives.WriteUInt16LittleEndian(result.AsSpan(20), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(result.AsSpan(22), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(24), SampleRate);
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(28), SampleRate * 2);
        BinaryPrimitives.WriteUInt16LittleEndian(result.AsSpan(32), 2);
        BinaryPrimitives.WriteUInt16LittleEndian(result.AsSpan(34), 16);
        "data"u8.CopyTo(result.AsSpan(36));
        BinaryPrimitives.WriteUInt32LittleEndian(result.AsSpan(40), checked((uint)payloadSize));
        return result;
    }

    public static void Write(Stream output, Stream pcm, int durationMs)
    {
        ArgumentNullException.ThrowIfNull(output);
        ArgumentNullException.ThrowIfNull(pcm);
        var remaining = PayloadSize(durationMs);
        output.Write(CreateHeader(durationMs));
        var buffer = new byte[8192];
        while (remaining > 0)
        {
            var count = Math.Min(buffer.Length, remaining);
            var read = pcm.Read(buffer, 0, count);
            if (read == 0)
            {
                Array.Clear(buffer);
                output.Write(buffer, 0, count);
                remaining -= count;
            }
            else
            {
                output.Write(buffer, 0, read);
                remaining -= read;
            }
        }
    }

    private static int PayloadSize(int durationMs)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(durationMs);
        return checked(durationMs * BytesPerMillisecond);
    }
}
