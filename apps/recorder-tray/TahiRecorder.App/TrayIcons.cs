using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace TahiRecorder.App;

internal enum TrayState { Idle, Waiting, Recording, Uploading }

internal sealed class TrayIcons : IDisposable
{
    private readonly Dictionary<TrayState, Icon> _icons = [];
    internal TrayIcons()
    {
        _icons[TrayState.Idle] = Create(SystemColors.GrayText, false);
        _icons[TrayState.Waiting] = Create(Color.DarkGoldenrod, false);
        _icons[TrayState.Recording] = Create(Color.Red, false);
        _icons[TrayState.Uploading] = Create(Color.RoyalBlue, true);
    }
    internal Icon this[TrayState state] => _icons[state];

    private static Icon Create(Color color, bool uploading)
    {
        using var image = new Bitmap(32, 32);
        using (var graphics = Graphics.FromImage(image))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var brush = new SolidBrush(color);
            graphics.FillEllipse(brush, 3, 3, 26, 26);
            using var pen = new Pen(Color.White, 3);
            if (uploading)
            {
                graphics.DrawLine(pen, 16, 24, 16, 9);
                graphics.DrawLines(pen, new Point[] { new(10, 15), new(16, 9), new(22, 15) });
            }
            else
            {
                graphics.DrawEllipse(pen, 12, 9, 8, 13);
                graphics.DrawLine(pen, 16, 23, 16, 27);
            }
        }
        var handle = image.GetHicon();
        try { return (Icon)Icon.FromHandle(handle).Clone(); }
        finally { DestroyIcon(handle); }
    }

    public void Dispose()
    {
        foreach (var icon in _icons.Values) icon.Dispose();
    }
    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);
}
