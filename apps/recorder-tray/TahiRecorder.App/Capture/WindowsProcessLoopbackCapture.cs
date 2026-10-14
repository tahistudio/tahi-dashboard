using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wasapi.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace TahiRecorder.App.Capture;

/// <summary>Runtime-gated process-tree loopback using the Windows SDK activation ABI.</summary>
internal sealed class WindowsProcessLoopbackCapture : IWaveIn
{
    private readonly AudioClient _client;
    private readonly AutoResetEvent _sampleReady = new(false);
    private readonly ManualResetEvent _stop = new(false);
    private Thread? _thread;
    private bool _disposed;
    public static bool IsSupported => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 20348);
    public WaveFormat WaveFormat { get; set; } = new(16_000, 16, 1);
    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    internal WindowsProcessLoopbackCapture(int processId)
    {
        if (!IsSupported)
            throw new NotSupportedException("Process loopback requires Windows build 20348 or later.");
        if (processId <= 0)
            throw new ArgumentOutOfRangeException(nameof(processId));
        try { _client = Activate(processId); }
        catch
        {
            _sampleReady.Dispose();
            _stop.Dispose();
            throw;
        }
    }

    public void StartRecording()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (_thread is not null)
            throw new InvalidOperationException("Process loopback is already recording.");
        // Microsoft ApplicationLoopback sample uses this shared-mode conversion path.
        _client.Initialize(AudioClientShareMode.Shared,
            AudioClientStreamFlags.Loopback | AudioClientStreamFlags.EventCallback
            | AudioClientStreamFlags.AutoConvertPcm | AudioClientStreamFlags.SrcDefaultQuality,
            0, 0, WaveFormat, Guid.Empty);
        _client.SetEventHandle(_sampleReady.SafeWaitHandle.DangerousGetHandle());
        _ = _client.AudioCaptureClient;
        _thread = new Thread(Capture) { IsBackground = true, Name = "Tahi meeting process loopback" };
        _thread.SetApartmentState(ApartmentState.MTA);
        _client.Start();
        try { _thread.Start(); }
        catch
        {
            try { _client.Stop(); }
            catch (COMException) { }
            throw;
        }
    }

    private void Capture()
    {
        Exception? failure = null;
        try
        {
            var capture = _client.AudioCaptureClient;
            while (!_stop.WaitOne(0))
            {
                // Timeout also drains packets on Windows versions that miss an event signal.
                if (WaitHandle.WaitAny([_stop, _sampleReady], TimeSpan.FromMilliseconds(100)) == 0)
                    break;
                while (!_stop.WaitOne(0) && capture.GetNextPacketSize() > 0)
                {
                    var pointer = capture.GetBuffer(out var frames, out var flags);
                    byte[] bytes;
                    try
                    {
                        bytes = new byte[checked(frames * WaveFormat.BlockAlign)];
                        if ((flags & AudioClientBufferFlags.Silent) == 0 && bytes.Length > 0)
                            Marshal.Copy(pointer, bytes, 0, bytes.Length);
                    }
                    finally { capture.ReleaseBuffer(frames); }
                    if (bytes.Length > 0)
                        DataAvailable?.Invoke(this, new WaveInEventArgs(bytes, bytes.Length));
                }
            }
        }
        catch (Exception exception) { failure = exception; }
        finally
        {
            try { _client.Stop(); }
            catch (Exception exception) { failure ??= exception; }
            try { RecordingStopped?.Invoke(this, new StoppedEventArgs(failure)); }
            catch { /* A host subscriber must not escape the native capture thread. */ }
        }
    }

    public void StopRecording()
    {
        _stop.Set();
        if (_thread is not null && _thread != Thread.CurrentThread
            && (_thread.ThreadState & ThreadState.Unstarted) == 0)
            _thread.Join();
    }

    public void Dispose()
    {
        if (_disposed)
            return;
        StopRecording();
        _disposed = true;
        try { _client.Dispose(); }
        finally
        {
            _sampleReady.Dispose();
            _stop.Dispose();
        }
    }

    private static AudioClient Activate(int processId)
    {
        var completion = new ActivationCompletion(processId);
        IActivateAudioInterfaceAsyncOperation? operation = null;
        try
        {
            var iid = typeof(IAudioClient).GUID;
            Marshal.ThrowExceptionForHR(ActivateAudioInterfaceAsync("VAD\\Process_Loopback", ref iid,
                completion.Parameters, completion, out operation));
            try { return completion.Result.Task.WaitAsync(TimeSpan.FromSeconds(3)).GetAwaiter().GetResult(); }
            catch (TimeoutException)
            {
                // The ABI has no cancel operation. Retain native activation memory and the
                // callback until completion, then release any late interface without using it.
                _ = completion.Result.Task.ContinueWith(task =>
                {
                    if (task.IsCompletedSuccessfully) task.Result.Dispose();
                    else _ = task.Exception;
                }, CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
                throw;
            }
        }
        catch
        {
            if (operation is null)
                completion.FreeParameters();
            throw;
        }
        finally
        {
            if (operation is not null)
                Marshal.ReleaseComObject(operation);
            GC.KeepAlive(completion);
        }
    }

    [DllImport("Mmdevapi.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int ActivateAudioInterfaceAsync(string deviceInterfacePath, ref Guid iid,
        nint activationParams, IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);

    [StructLayout(LayoutKind.Sequential)]
    private struct ActivationParameters
    {
        public int ActivationType;
        public uint TargetProcessId;
        public int ProcessLoopbackMode;
    }

    // PROPVARIANT's union starts at offset 8. BLOB has a DWORD followed by an
    // aligned pointer, making the x64 layout 24 bytes. This app targets win-x64.
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct BlobPropVariant
    {
        [FieldOffset(0)] public ushort VariantType;
        [FieldOffset(8)] public uint Length;
        [FieldOffset(16)] public nint Data;
    }

    // ComImport makes this marker visible to native QueryInterface on the managed callback.
    [ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"),
        InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAgileObject { }

    [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
    private sealed class ActivationCompletion : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        private nint _blob;
        private nint _parameters;
        internal nint Parameters => _parameters;
        internal TaskCompletionSource<AudioClient> Result { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        internal ActivationCompletion(int processId)
        {
            _blob = Marshal.AllocHGlobal(Marshal.SizeOf<ActivationParameters>());
            Marshal.StructureToPtr(new ActivationParameters
            {
                ActivationType = 1,
                TargetProcessId = checked((uint)processId),
                ProcessLoopbackMode = 0 // Include the root process and its descendants.
            }, _blob, false);
            _parameters = Marshal.AllocHGlobal(Marshal.SizeOf<BlobPropVariant>());
            Marshal.StructureToPtr(new BlobPropVariant
            {
                VariantType = 65, // VT_BLOB
                Length = checked((uint)Marshal.SizeOf<ActivationParameters>()),
                Data = _blob
            }, _parameters, false);
        }

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation)
        {
            object? activated = null;
            try
            {
                operation.GetActivateResult(out var result, out activated);
                Marshal.ThrowExceptionForHR(result);
                var client = new AudioClient((IAudioClient)activated);
                activated = null;
                Result.TrySetResult(client);
            }
            catch (Exception exception) { Result.TrySetException(exception); }
            finally
            {
                if (activated is not null && Marshal.IsComObject(activated))
                    Marshal.ReleaseComObject(activated);
                FreeParameters();
            }
        }

        internal void FreeParameters()
        {
            var parameters = Interlocked.Exchange(ref _parameters, nint.Zero);
            var blob = Interlocked.Exchange(ref _blob, nint.Zero);
            if (parameters != nint.Zero) Marshal.FreeHGlobal(parameters);
            if (blob != nint.Zero) Marshal.FreeHGlobal(blob);
        }
    }
}
