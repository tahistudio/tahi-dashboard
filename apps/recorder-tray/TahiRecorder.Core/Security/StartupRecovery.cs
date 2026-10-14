namespace TahiRecorder.Core.Security;

public static class StartupRecovery
{
    public static string DataFolderError(string path, Exception error) =>
        error.Message.Contains(path, StringComparison.OrdinalIgnoreCase)
            ? error.Message
            : $"{error.Message} The local data folder '{path}' could not be protected. " +
                "Close Tahi Recorder, back up retained recordings, and fix the folder permissions " +
                "or delete it so the recorder can recreate it.";
}
