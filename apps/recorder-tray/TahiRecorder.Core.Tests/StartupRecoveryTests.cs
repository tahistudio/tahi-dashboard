using TahiRecorder.Core.Security;

namespace TahiRecorder.Core.Tests;

public sealed class StartupRecoveryTests
{
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void BareStartupAccessErrorsIncludeFolderAndRecovery(bool accessDenied)
    {
        Exception error = accessDenied ? new UnauthorizedAccessException("Access denied.") : new IOException("Disk unavailable.");
        var message = StartupRecovery.DataFolderError("C:/LocalData/TahiRecorder", error);
        Assert.Contains(error.Message, message);
        Assert.Contains("'C:/LocalData/TahiRecorder'", message);
        Assert.Contains("Close Tahi Recorder", message);
        Assert.Contains("back up retained recordings", message);
        Assert.Contains("fix the folder permissions", message);
        Assert.Contains("delete it so the recorder can recreate it", message);
    }
}
