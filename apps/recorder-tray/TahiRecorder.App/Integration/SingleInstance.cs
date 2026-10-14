using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace TahiRecorder.App.Integration;

internal sealed class SingleInstance : IDisposable
{
    private readonly Mutex _mutex;
    private readonly string _pipeName;
    private readonly CancellationTokenSource _shutdown = new();
    private Task? _listener;
    internal bool IsOwner { get; }

    internal SingleInstance()
    {
        var user = WindowsIdentity.GetCurrent().User?.Value ?? Environment.UserName;
        var identity = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(user)))[..24];
        _pipeName = "TahiRecorder-" + identity;
        _mutex = new Mutex(initiallyOwned: false, "Local\\" + _pipeName);
        try { IsOwner = _mutex.WaitOne(0); }
        catch (AbandonedMutexException) { IsOwner = true; }
    }

    internal void StartListening(Action<string> activated)
    {
        if (!IsOwner) throw new InvalidOperationException("Only the primary recorder may listen.");
        _listener = Task.Run(async () =>
        {
            while (!_shutdown.IsCancellationRequested)
            {
                try
                {
                    using var pipe = new NamedPipeServerStream(_pipeName, PipeDirection.In, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await pipe.WaitForConnectionAsync(_shutdown.Token).ConfigureAwait(false);
                    var data = new byte[4097];
                    var used = 0;
                    while (used < data.Length)
                    {
                        var read = await pipe.ReadAsync(data.AsMemory(used), _shutdown.Token).ConfigureAwait(false);
                        if (read == 0) break;
                        used += read;
                    }
                    if (used is > 0 and <= 4096)
                        activated(Encoding.UTF8.GetString(data, 0, used));
                }
                catch (OperationCanceledException) when (_shutdown.IsCancellationRequested) { break; }
                catch (IOException error) { HostLog.Error("Activation pipe failed", error); }
            }
        });
    }

    internal async Task SendToOwnerAsync(string argument)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            using var pipe = new NamedPipeClientStream(".", _pipeName, PipeDirection.Out, PipeOptions.Asynchronous);
            await pipe.ConnectAsync(timeout.Token).ConfigureAwait(false);
            var data = Encoding.UTF8.GetBytes(argument);
            if (data.Length > 4096) return;
            await pipe.WriteAsync(data, timeout.Token).ConfigureAwait(false);
            await pipe.FlushAsync(timeout.Token).ConfigureAwait(false);
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or TimeoutException)
        {
            HostLog.Error("Activation forwarding failed", error);
        }
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        if (_listener is not null)
        {
            try { _listener.GetAwaiter().GetResult(); }
            catch (OperationCanceledException) { }
        }
        _shutdown.Dispose();
        if (IsOwner) _mutex.ReleaseMutex();
        _mutex.Dispose();
    }
}
