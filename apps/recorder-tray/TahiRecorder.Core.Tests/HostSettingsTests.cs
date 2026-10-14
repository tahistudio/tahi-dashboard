using System.Text.Json;
using TahiRecorder.App;
using TahiRecorder.Core.Audio;
using TahiRecorder.Core.Automation;

namespace TahiRecorder.Core.Tests;

public sealed class HostSettingsTests
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    [Fact]
    public void ExistingSettingsWithoutAudioFieldsStillLoadAndDefaultToAutomatic()
    {
        const string previous = """
            {"deviceId":"local-device","deviceName":"Liam PC","automation":null,"activeCaptureRef":null}
            """;

        var loaded = JsonSerializer.Deserialize<HostSettings>(previous, Json)!;

        Assert.Equal("local-device", loaded.DeviceId);
        Assert.Equal("Liam PC", loaded.DeviceName);
        Assert.Null(loaded.AudioDevices);
        Assert.Null(loaded.RenderEndpointName);
        Assert.Null(loaded.CaptureEndpointName);
        Assert.Null(loaded.LastAudioLevels);
        Assert.Equal(new AudioDevicePreferences(), loaded.AudioDevices ?? new AudioDevicePreferences());
    }

    [Fact]
    public void BothOverridesNamesAndIndependentLevelsSurviveJsonRoundTrip()
    {
        var initial = new HostSettings(AudioDevices: new("render-id", "capture-id"),
            RenderEndpointName: "Speakers & headset", CaptureEndpointName: "NVIDIA Broadcast",
            LastAudioLevels: new(true, 0.04f, 0.5f));

        var loaded = JsonSerializer.Deserialize<HostSettings>(JsonSerializer.Serialize(initial, Json), Json)!;

        Assert.Equal(initial, loaded);
        Assert.True(loaded.LastAudioLevels!.SystemAudioOk);
        Assert.True(loaded.LastAudioLevels.MicrophoneAudioOk);
    }

    [Fact]
    public void AutomaticRenderWithManualMicrophoneSurvivesJsonRoundTrip()
    {
        var initial = new HostSettings(AudioDevices: new(null, "virtual-mic"),
            CaptureEndpointName: "NVIDIA Broadcast");

        var loaded = JsonSerializer.Deserialize<HostSettings>(JsonSerializer.Serialize(initial, Json), Json)!;

        Assert.Null(loaded.AudioDevices!.RenderEndpointId);
        Assert.Equal("virtual-mic", loaded.AudioDevices.CaptureEndpointId);
    }

    [Fact]
    public void AudioPreferenceChangePreservesDeviceIdentityAndAutomationState()
    {
        var startedAt = DateTimeOffset.Parse("2026-10-14T01:00:00Z");
        var clientRef = Guid.Parse("357bb198-93fa-4583-aa1e-5eb0c797b48e");
        var automation = new AutomationSnapshot(startedAt.AddHours(1), startedAt, true,
            [new("call-id", "scheduled", startedAt.ToUnixTimeMilliseconds())]);
        var initial = new HostSettings("local-device", "Liam PC", automation, clientRef);
        var changed = initial with { AudioDevices = new("call-speakers", "virtual-mic") };

        var loaded = JsonSerializer.Deserialize<HostSettings>(JsonSerializer.Serialize(changed, Json), Json)!;

        Assert.Equal(initial.DeviceId, loaded.DeviceId);
        Assert.Equal(initial.DeviceName, loaded.DeviceName);
        Assert.Equal(initial.ActiveCaptureRef, loaded.ActiveCaptureRef);
        Assert.Equal(initial.Automation!.PausedUntil, loaded.Automation!.PausedUntil);
        Assert.Equal(initial.Automation.ManuallyStoppedAt, loaded.Automation.ManuallyStoppedAt);
        Assert.Equal(initial.Automation.SuppressCurrentSession, loaded.Automation.SuppressCurrentSession);
        Assert.Equal(initial.Automation.SuppressedCalls, loaded.Automation.SuppressedCalls);
        Assert.Equal(new AudioDevicePreferences("call-speakers", "virtual-mic"), loaded.AudioDevices);
    }

    [Fact]
    public void RecordedSilenceRemainsDistinctFromNoRecordingAfterRestart()
    {
        var initial = new HostSettings(LastAudioLevels: new(true, 0f, 0.5f));

        var loaded = JsonSerializer.Deserialize<HostSettings>(JsonSerializer.Serialize(initial, Json), Json)!;

        Assert.True(loaded.LastAudioLevels!.HasRecording);
        Assert.False(loaded.LastAudioLevels.SystemAudioOk);
        Assert.True(loaded.LastAudioLevels.MicrophoneAudioOk);
    }
}
