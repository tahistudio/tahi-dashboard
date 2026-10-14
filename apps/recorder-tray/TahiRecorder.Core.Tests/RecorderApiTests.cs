using System.Net;
using System.Text;
using System.Text.Json;
using TahiRecorder.Core.Api;
using TahiRecorder.Core.Security;

namespace TahiRecorder.Core.Tests;

public sealed class RecorderApiTests
{
    [Fact]
    public async Task PairUsesExactShapeWithoutBearer()
    {
        using var http = new HttpClient(new Handler(async request =>
        {
            Assert.Equal("https://portal.tahi.studio/api/public/recorder/pair", request.RequestUri!.AbsoluteUri);
            Assert.Null(request.Headers.Authorization);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            Assert.Equal("ABCDEFGH", body.RootElement.GetProperty("code").GetString());
            Assert.Equal("Desktop", body.RootElement.GetProperty("deviceName").GetString());
            return Json(HttpStatusCode.Created, "{\"token\":\"tahi_rec_fake\",\"device\":{\"id\":\"device\",\"name\":\"Desktop\"}}");
        }));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        var result = await api.PairAsync("abcdefgh", "Desktop");
        Assert.Equal("device", result.Device.Id);
    }

    [Fact]
    public async Task CreateSuppliesBothCallFieldsOrNeither()
    {
        using var http = new HttpClient(new Handler(async request =>
        {
            Assert.Equal("Bearer", request.Headers.Authorization!.Scheme);
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync());
            Assert.False(body.RootElement.TryGetProperty("callId", out _));
            Assert.False(body.RootElement.TryGetProperty("callKind", out _));
            Assert.Equal(2, body.RootElement.GetProperty("tracks").GetArrayLength());
            return Json(HttpStatusCode.Created, "{\"recording\":{\"id\":\"recording1\",\"state\":\"recording\"}}");
        }));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        await api.CreateAsync(new(Guid.NewGuid(), "Unknown call", ["mic", "system"]), default);
        await Assert.ThrowsAsync<ArgumentException>(() => api.CreateAsync(new(Guid.NewGuid(), "Call", ["mic"], CallId: "call1"), default));
    }

    [Theory]
    [InlineData("https://attacker.example/chunks")]
    [InlineData("http://portal.tahi.studio/api/admin/recordings/id/chunks")]
    [InlineData("https://portal.tahi.studio:8443/api/admin/recordings/id/chunks")]
    [InlineData("https://user@portal.tahi.studio/api/admin/recordings/id/chunks")]
    [InlineData("/api/public/recorder/pair")]
    public async Task UploadRejectsOtherOriginsAndUnexpectedPaths(string url)
    {
        var requests = 0;
        using var http = new HttpClient(new Handler(request =>
        { requests++; return Task.FromResult(Json(HttpStatusCode.OK, "{}")); }));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        await Assert.ThrowsAsync<InvalidOperationException>(() => api.UploadAsync(url, [], default));
        Assert.Equal(0, requests);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task PutRequiresDuplicateAndUploadedToAccept409(bool uploaded)
    {
        using var http = new HttpClient(new Handler(request =>
        {
            Assert.Equal("audio/wav", request.Content!.Headers.ContentType!.ToString());
            return Task.FromResult(Json(HttpStatusCode.Conflict, $"{{\"code\":\"duplicate\",\"uploaded\":{uploaded.ToString().ToLowerInvariant()}}}"));
        }));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        var upload = api.UploadAsync("/api/admin/recordings/id/chunks?track=mic&sequence=0&token=grant", [], default);
        if (uploaded) await upload;
        else Assert.False((await Assert.ThrowsAsync<RecorderApiException>(() => upload)).Uploaded);
    }

    [Theory]
    [InlineData(429, "daily_quota")]
    [InlineData(429, "open_recording")]
    [InlineData(409, "busy")]
    [InlineData(503, "membership_unavailable")]
    public async Task ErrorsKeepCodeAndRetryAfter(int status, string code)
    {
        using var http = new HttpClient(new Handler(request =>
        {
            var response = Json((HttpStatusCode)status, $"{{\"code\":\"{code}\"}}");
            response.Headers.RetryAfter = new(TimeSpan.FromSeconds(45));
            return Task.FromResult(response);
        }));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        var error = await Assert.ThrowsAsync<RecorderApiException>(() => api.ListAsync(default));
        Assert.Equal(code, error.Code);
        Assert.True(error.IsRetryable);
        Assert.Equal(TimeSpan.FromSeconds(45), error.RetryAfter);
    }

    [Fact]
    public async Task RedirectIsNotAConfirmation()
    {
        using var http = new HttpClient(new Handler(request =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.Redirect);
            response.Headers.Location = new Uri("https://attacker.example/");
            return Task.FromResult(response);
        }));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        Assert.Equal(302, (await Assert.ThrowsAsync<RecorderApiException>(() => api.ListAsync(default))).StatusCode);
    }

    [Fact]
    public async Task UpcomingCallsReadExactMillisecondsFields()
    {
        using var http = new HttpClient(new Handler(request => Task.FromResult(Json(HttpStatusCode.OK,
            "{\"items\":[{\"id\":\"call\",\"kind\":\"scheduled\",\"title\":\"Review\",\"startMs\":1720000000000,\"endMs\":1720003600000,\"platform\":\"zoom\"}]}"))));
        using var api = new RecorderApiClient(new FakeTokens(), http);
        var call = Assert.Single(await api.UpcomingCallsAsync());
        Assert.Equal(1720000000000, call.StartMs);
        Assert.Equal("scheduled", call.Kind);
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) => new(status)
    { Content = new StringContent(json, Encoding.UTF8, "application/json") };
    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> handle) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => handle(request);
    }
    private sealed class FakeTokens : ITokenStore
    {
        public Task<string?> LoadAsync(CancellationToken cancellationToken = default) => Task.FromResult<string?>("tahi_rec_fake");
        public Task SaveAsync(string token, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task ClearAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
