using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using TahiRecorder.Core.Security;

namespace TahiRecorder.Core.Api;

/// <summary>The origin is fixed. Tokens and upload grants never follow redirects.</summary>
public sealed class RecorderApiClient : IRecorderApi, IDisposable
{
    public const string PortalOrigin = "https://portal.tahi.studio";
    private static readonly Uri Origin = new(PortalOrigin);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
    private readonly HttpClient http;
    private readonly ITokenStore tokens;
    private readonly bool ownsClient;

    public RecorderApiClient(ITokenStore tokens, HttpClient? http = null)
    {
        this.tokens = tokens;
        ownsClient = http is null;
        this.http = http ?? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        { Timeout = TimeSpan.FromSeconds(120) };
    }

    public Task<PairResponse> PairAsync(string code, string deviceName, CancellationToken cancellationToken = default)
    {
        if (!Regex.IsMatch(code.Trim(), "^[A-Za-z0-9]{8}$") || string.IsNullOrWhiteSpace(deviceName))
            throw new ArgumentException("Enter the eight-character code and a device name.");
        return SendAsync<PairResponse>(HttpMethod.Post, "/api/public/recorder/pair",
            new { code = code.Trim().ToUpperInvariant(), deviceName = deviceName.Trim() }, false, cancellationToken);
    }

    public async Task<IReadOnlyList<UpcomingCall>> UpcomingCallsAsync(CancellationToken cancellationToken = default) =>
        (await SendAsync<ItemEnvelope<UpcomingCall>>(HttpMethod.Get, "/api/admin/recordings/upcoming-calls", null, true, cancellationToken)).Items;

    public async Task<RecordingState> CreateAsync(CreateRecordingRequest request, CancellationToken cancellationToken)
    {
        if ((request.CallId is null) != (request.CallKind is null))
            throw new ArgumentException("Call id and kind must be supplied together.");
        return (await SendAsync<CreateEnvelope>(HttpMethod.Post, "/api/admin/recordings", request, true, cancellationToken)).Recording;
    }

    public Task<ChunkReservation> ReserveAsync(string recordingId, ChunkMetadata metadata, CancellationToken cancellationToken) =>
        SendAsync<ChunkReservation>(HttpMethod.Post, RecordingPath(recordingId) + "/chunks", metadata, true, cancellationToken);

    public async Task UploadAsync(string uploadUrl, byte[] wav, CancellationToken cancellationToken)
    {
        var uri = SafeUri(uploadUrl);
        if (!uri.AbsolutePath.StartsWith("/api/admin/recordings/", StringComparison.Ordinal)
            || !uri.AbsolutePath.EndsWith("/chunks", StringComparison.Ordinal))
            throw new InvalidOperationException("Unexpected upload path.");
        using var request = new HttpRequestMessage(HttpMethod.Put, uri);
        await AuthenticateAsync(request, cancellationToken);
        request.Content = new ByteArrayContent(wav);
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("audio/wav");
        using var response = await http.SendAsync(request, cancellationToken);
        if (response.IsSuccessStatusCode) return;
        var error = await ReadErrorAsync(response, cancellationToken);
        if (error.StatusCode == 409 && error.Code == "duplicate" && error.Uploaded) return;
        throw error;
    }

    public Task<RecordingDetail> StopAsync(string recordingId, StopRecordingRequest request, CancellationToken cancellationToken) =>
        SendAsync<RecordingDetail>(HttpMethod.Post, RecordingPath(recordingId) + "/stop", request, true, cancellationToken);
    public Task<RecordingDetail> ReadAsync(string recordingId, CancellationToken cancellationToken) =>
        SendAsync<RecordingDetail>(HttpMethod.Get, RecordingPath(recordingId), null, true, cancellationToken);
    public Task<RecordingDetail> TranscribeAsync(string recordingId, CancellationToken cancellationToken) =>
        SendAsync<RecordingDetail>(HttpMethod.Post, RecordingPath(recordingId) + "/transcribe", new { }, true, cancellationToken);
    public async Task<IReadOnlyList<RecordingDetail>> ListAsync(CancellationToken cancellationToken) =>
        (await SendAsync<ItemEnvelope<RecordingDetail>>(HttpMethod.Get, "/api/admin/recordings", null, true, cancellationToken)).Items;

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, bool authenticate, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(method, SafeUri(path));
        if (authenticate) await AuthenticateAsync(request, cancellationToken);
        if (body is not null) request.Content = JsonContent.Create(body, options: Json);
        using var response = await http.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw await ReadErrorAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<T>(Json, cancellationToken)
            ?? throw new InvalidDataException("Recorder returned an empty response.");
    }

    private async Task AuthenticateAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var token = await tokens.LoadAsync(cancellationToken);
        if (token is null || !token.StartsWith("tahi_rec_", StringComparison.Ordinal)) throw new RecorderApiException(401);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }

    private static Uri SafeUri(string value)
    {
        if (!Uri.TryCreate(Origin, value, out var uri) || uri.Scheme != "https"
            || uri.Host != Origin.Host || uri.Port != 443 || uri.UserInfo.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("Recorder requests must use the built-in portal origin.");
        return uri;
    }

    private static string RecordingPath(string id)
    {
        if (!Regex.IsMatch(id, "^[A-Za-z0-9_-]{1,128}$")) throw new ArgumentException("Invalid recording id.");
        return "/api/admin/recordings/" + id;
    }

    private static async Task<RecorderApiException> ReadErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        string? code = null;
        string? message = null;
        bool uploaded = false;
        try
        {
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
            if (json.RootElement.TryGetProperty("code", out var value) && value.ValueKind == JsonValueKind.String) code = value.GetString();
            if (json.RootElement.TryGetProperty("error", out value) && value.ValueKind == JsonValueKind.String
                && value.GetString() is { } text)
                message = text.Length > 200 ? text[..200] : text;
            if (message is null && json.RootElement.TryGetProperty("message", out value) && value.ValueKind == JsonValueKind.String
                && value.GetString() is { } alternative)
                message = alternative.Length > 200 ? alternative[..200] : alternative;
            if (json.RootElement.TryGetProperty("uploaded", out value)) uploaded = value.ValueKind == JsonValueKind.True;
        }
        catch (JsonException) { }
        var retryAfter = response.Headers.RetryAfter?.Delta;
        if (retryAfter is null && response.Headers.RetryAfter?.Date is { } date)
            retryAfter = date - DateTimeOffset.UtcNow;
        return new RecorderApiException((int)response.StatusCode, code, uploaded, retryAfter, message);
    }

    public void Dispose() { if (ownsClient) http.Dispose(); }
    private record ItemEnvelope<T>(IReadOnlyList<T> Items);
    private record CreateEnvelope(RecordingState Recording);
}
