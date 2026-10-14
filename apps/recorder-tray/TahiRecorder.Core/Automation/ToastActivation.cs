using Microsoft.Toolkit.Uwp.Notifications;

namespace TahiRecorder.Core.Automation;

public static class ToastActivation
{
    public static IReadOnlyDictionary<string, string> Parse(string argument)
    {
        // The single-instance pipe's plain action=open is also a valid ToastArguments string.
        if (argument.Length > 4096) return new Dictionary<string, string>();
        return ToastArguments.Parse(argument).ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
    }
}
