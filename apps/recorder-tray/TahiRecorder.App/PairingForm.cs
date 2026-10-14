using TahiRecorder.Core.Api;

namespace TahiRecorder.App;

internal sealed class PairingForm : Form
{
    private readonly RecorderApiClient _api;
    private readonly Func<PairResponse, Task> _paired;
    private readonly TextBox _code = new()
    {
        MaxLength = 8, CharacterCasing = CharacterCasing.Upper, Dock = DockStyle.Fill,
        AutoSize = false, MinimumSize = new Size(0, 44), AccessibleName = "Pairing code", TabIndex = 0
    };
    private readonly TextBox _name = new()
    {
        Text = Environment.MachineName, MaxLength = 120, Dock = DockStyle.Fill,
        AutoSize = false, MinimumSize = new Size(0, 44), AccessibleName = "Device name", TabIndex = 1
    };
    private readonly Label _error = new() { AutoSize = true, ForeColor = SystemColors.HotTrack, Dock = DockStyle.Fill };
    private readonly Button _pair = new()
    {
        Text = "&Pair this device", AutoSize = true, MinimumSize = new Size(0, 44),
        AccessibleName = "Pair this device", TabIndex = 2
    };
    private readonly CancellationTokenSource _closed = new();
    private bool _busy;

    internal PairingForm(RecorderApiClient api, Func<PairResponse, Task> paired)
    {
        _api = api;
        _paired = paired;
        Text = "Pair Tahi Recorder";
        AutoScaleDimensions = new SizeF(96, 96);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(450, 430);
        MinimumSize = new Size(350, 390);
        AutoScroll = true;
        StartPosition = FormStartPosition.CenterScreen;
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top, Padding = new Padding(24), ColumnCount = 1, RowCount = 9,
            AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink
        };
        layout.Controls.Add(new Label
        {
            Text = "Pair your device", Font = new Font(SystemFonts.MessageBoxFont!, FontStyle.Bold),
            AutoSize = true, Margin = new Padding(0, 0, 0, 16)
        });
        layout.Controls.Add(new Label
        {
            Text = "Open Settings > Recorder devices in the Tahi dashboard and choose Pair a device. Enter the eight-character code here.",
            AutoSize = true, MaximumSize = new Size(390, 0), Margin = new Padding(0, 0, 0, 16)
        });
        layout.Controls.Add(new Label { Text = "Pairing &code", AutoSize = true });
        layout.Controls.Add(_code);
        layout.Controls.Add(new Label { Text = "Device &name", AutoSize = true, Margin = new Padding(0, 16, 0, 0) });
        layout.Controls.Add(_name);
        layout.Controls.Add(new Label
        {
            Text = "The microphone records even while you are muted in Zoom, Teams or Meet. Recording starts automatically during detected calls. Stop is always available in the tray menu.",
            AutoSize = true, MaximumSize = new Size(390, 0), Margin = new Padding(0, 16, 0, 16)
        });
        layout.Controls.Add(_error);
        layout.Controls.Add(_pair);
        for (var index = 0; index < layout.Controls.Count; index++)
        {
            var control = layout.Controls[index];
            control.TabIndex = index;
            if (control is Label) control.TabStop = false;
        }
        Controls.Add(layout);
        layout.SizeChanged += (_, _) =>
        {
            foreach (var label in layout.Controls.OfType<Label>())
                label.MaximumSize = new Size(Math.Max(120, layout.ClientSize.Width - layout.Padding.Horizontal - label.Margin.Horizontal), 0);
        };
        AcceptButton = _pair;
        _pair.Click += PairClicked;
        FormClosed += (_, _) => _closed.Cancel();
        Shown += (_, _) =>
        {
            var area = Screen.FromControl(this).WorkingArea;
            MinimumSize = new Size(Math.Min(MinimumSize.Width, area.Width), Math.Min(MinimumSize.Height, area.Height));
            Size = new Size(Math.Min(Width, area.Width), Math.Min(Height, area.Height));
            Location = new Point(area.Left + (area.Width - Width) / 2, area.Top + (area.Height - Height) / 2);
            _code.Focus();
        };
    }

    private async void PairClicked(object? sender, EventArgs eventArgs)
    {
        if (_busy) return;
        if (_code.Text.Trim().Length != 8 || !_code.Text.All(char.IsAsciiLetterOrDigit) || string.IsNullOrWhiteSpace(_name.Text))
        {
            _error.Text = "Enter the eight-character code and a device name.";
            return;
        }
        _busy = true;
        _pair.Enabled = false;
        _code.Enabled = false;
        _name.Enabled = false;
        _error.Text = "Pairing this device...";
        try
        {
            var response = await _api.PairAsync(_code.Text, _name.Text, _closed.Token);
            if (!Guid.TryParse(response.Device.Id, out _))
                throw new InvalidDataException("Invalid paired device identity.");
            await _paired(response);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (OperationCanceledException) when (_closed.IsCancellationRequested) { }
        catch (RecorderApiException error)
        {
            _error.Text = error.StatusCode == 429
                ? "Too many attempts. Wait fifteen minutes and create a fresh code."
                : "That code could not be used. Create a fresh code in Settings and try again.";
        }
        catch (Exception error)
        {
            HostLog.Error("Device pairing failed", error);
            _error.Text = "Pairing could not finish. Check your connection, then try a fresh code.";
        }
        finally
        {
            _busy = false;
            if (!IsDisposed)
            {
                _pair.Enabled = true;
                _code.Enabled = true;
                _name.Enabled = true;
            }
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _closed.Dispose();
        base.Dispose(disposing);
    }
}
