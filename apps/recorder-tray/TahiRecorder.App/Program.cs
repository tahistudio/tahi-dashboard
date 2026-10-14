using System.Collections.Concurrent;
using TahiRecorder.App.Integration;

namespace TahiRecorder.App;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        AppPaths.EnsureDirectories();
        using var singleInstance = new SingleInstance();
        using var activationReceived = new ManualResetEventSlim();
        var activations = new ConcurrentQueue<string>();
        TrayApplicationContext? context = null;

        void Activated(string argument)
        {
            if (singleInstance.IsOwner)
            {
                var current = Volatile.Read(ref context);
                if (current is null)
                    activations.Enqueue(argument);
                else
                    current.DispatchActivation(argument);
            }
            else
            {
                singleInstance.SendToOwnerAsync(argument).GetAwaiter().GetResult();
            }
            activationReceived.Set();
        }

        try
        {
            using var notifications = new WindowsNotifications(Activated);
            var toastLaunch = args.Contains("--toast-activated", StringComparer.Ordinal);
            if (!singleInstance.IsOwner)
            {
                if (toastLaunch)
                {
                    using var activationLoop = new ApplicationContext();
                    using var timer = new System.Windows.Forms.Timer { Interval = 100 };
                    var deadline = DateTimeOffset.UtcNow.AddSeconds(15);
                    timer.Tick += (_, _) =>
                    {
                        if (activationReceived.IsSet || DateTimeOffset.UtcNow >= deadline)
                            activationLoop.ExitThread();
                    };
                    timer.Start();
                    Application.Run(activationLoop);
                }
                else
                    singleInstance.SendToOwnerAsync("action=open").GetAwaiter().GetResult();
                return;
            }

            WindowsStartup.EnsureDefault();
            context = new TrayApplicationContext(notifications);
            singleInstance.StartListening(context.DispatchActivation);
            while (activations.TryDequeue(out var activation))
                context.DispatchActivation(activation);
            Application.Run(context);
        }
        catch (Exception error)
        {
            HostLog.Error("Application startup failed", error);
            MessageBox.Show("Tahi Recorder could not start. Check the local logs and try again.",
                "Tahi Recorder", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
