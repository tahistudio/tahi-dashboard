using Microsoft.Toolkit.Uwp.Notifications;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.Core.Tests;

public sealed class ToastActivationTests
{
    [Theory]
    [InlineData("stop")]
    [InlineData("unlinked")]
    public void RealToastBuilderButtonsRoundTrip(string action)
    {
        var identity = Guid.NewGuid().ToString("D");
        var content = new ToastContentBuilder().AddArgument("action", "open").AddArgument("clientRef", identity)
            .AddText("Recording: Example")
            .AddButton(new ToastButton().SetContent("Action").AddArgument("action", action).AddArgument("clientRef", identity))
            .GetToastContent();
        var xml = System.Xml.Linq.XDocument.Parse(content.GetContent());
        var arguments = xml.Descendants("action").Single().Attribute("arguments")!.Value;
        Assert.Contains(';', arguments);
        var parsed = ToastActivation.Parse(arguments);
        Assert.Equal(action, parsed["action"]);
        Assert.Equal(identity, parsed["clientRef"]);
        Assert.Equal("open", ToastActivation.Parse(xml.Root!.Attribute("launch")!.Value)["action"]);
    }

    [Fact]
    public void PlainPipeOpenStillParses() => Assert.Equal("open", ToastActivation.Parse("action=open")["action"]);
}
