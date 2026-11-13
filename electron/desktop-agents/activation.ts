import { execFile } from "node:child_process";
import { app } from "electron";

// Mutter accepts recent X11 startup sequences when activating a native Wayland
// window. Obtain server time on a private, unmapped window for this user click.
const STARTUP_TOKEN = String.raw`
import ctypes as c
x = c.CDLL('libX11.so.6')
s = c.CDLL('libstartup-notification-1.so.0')
p = c.c_void_p
def bind(lib, name, result, *args):
 fn = getattr(lib, name)
 fn.restype = result
 fn.argtypes = args
 return fn
class PropertyEvent(c.Structure):
 _fields_ = [('type', c.c_int), ('serial', c.c_ulong), ('send_event', c.c_int),
            ('display', p), ('window', c.c_ulong), ('atom', c.c_ulong),
            ('time', c.c_ulong), ('state', c.c_int)]
d = bind(x, 'XOpenDisplay', p, c.c_char_p)(None)
if not d: raise RuntimeError('X11 display unavailable')
screen = bind(x, 'XDefaultScreen', c.c_int, p)(d)
root = bind(x, 'XDefaultRootWindow', c.c_ulong, p)(d)
w = bind(x, 'XCreateSimpleWindow', c.c_ulong, p, c.c_ulong, c.c_int, c.c_int,
         c.c_uint, c.c_uint, c.c_uint, c.c_ulong, c.c_ulong)(d, root, 0, 0, 1, 1, 0, 0, 0)
atom = bind(x, 'XInternAtom', c.c_ulong, p, c.c_char_p, c.c_int)(d, b'_DECK_CLICK_TIME', False)
bind(x, 'XSelectInput', c.c_int, p, c.c_ulong, c.c_long)(d, w, 1 << 22)
bind(x, 'XChangeProperty', c.c_int, p, c.c_ulong, c.c_ulong, c.c_ulong,
     c.c_int, c.c_int, c.c_char_p, c.c_int)(d, w, atom, 31, 8, 0, b'', 0)
event = c.create_string_buffer(24 * c.sizeof(c.c_long))
bind(x, 'XWindowEvent', c.c_int, p, c.c_ulong, c.c_long, p)(d, w, 1 << 22, event)
timestamp = c.cast(event, c.POINTER(PropertyEvent)).contents.time
sd = bind(s, 'sn_display_new', p, p, p, p)(d, None, None)
ctx = bind(s, 'sn_launcher_context_new', p, p, c.c_int)(sd, screen)
bind(s, 'sn_launcher_context_set_name', None, p, c.c_char_p)(ctx, b'SpaceVibe Deck')
bind(s, 'sn_launcher_context_initiate', None, p, c.c_char_p, c.c_char_p, c.c_ulong)(
 ctx, b'deck-widget', b'spacevibe-deck', timestamp)
bind(x, 'XSync', c.c_int, p, c.c_int)(d, False)
print(bind(s, 'sn_launcher_context_get_startup_id', c.c_char_p, p)(ctx).decode())
bind(x, 'XDestroyWindow', c.c_int, p, c.c_ulong)(d, w)
bind(x, 'XCloseDisplay', c.c_int, p)(d)
`;

/** Called only by the separate widget helper, which owns no single-instance lock. */
export async function activateDesktopAgent(userData: string, key: string): Promise<boolean> {
  if (!process.env.WAYLAND_DISPLAY || !process.env.DISPLAY) return false;
  try {
    const token = await new Promise<string>((resolve, reject) => {
      execFile(
        "python3",
        ["-c", STARTUP_TOKEN],
        { timeout: 1000, maxBuffer: 4096 },
        (error, stdout) => {
          if (error) reject(error);
          else resolve(stdout.trim());
        },
      );
    });
    if (!token || token.length > 1024) return false;
    const previousData = app.getPath("userData");
    const previousToken = process.env.XDG_ACTIVATION_TOKEN;
    try {
      // Electron forwards this token to the existing owner before second-instance
      // listeners run. Keep the helper's profile separate outside this sync call.
      app.setPath("userData", userData);
      process.env.XDG_ACTIVATION_TOKEN = token;
      const acquired = app.requestSingleInstanceLock({ desktopAgentKey: key });
      if (acquired) app.releaseSingleInstanceLock();
      return !acquired;
    } finally {
      app.setPath("userData", previousData);
      if (previousToken === undefined) delete process.env.XDG_ACTIVATION_TOKEN;
      else process.env.XDG_ACTIVATION_TOKEN = previousToken;
    }
  } catch (error) {
    console.warn("Deck widget activation unavailable:", error);
    return false;
  }
}
