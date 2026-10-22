//! 平台相关：读选区（UIA / 剪贴板）、记录与归还前台窗口、鼠标位置。
//! 只实现 Windows；其他平台是桩，便于在 macOS 上编译与跑平台无关的测试。

pub use imp::*;

#[cfg(not(windows))]
mod imp {
    use crate::selection::{SelectionReader, UiaRead};
    use std::time::Instant;

    pub struct Reader;

    impl SelectionReader for Reader {
        fn read_uia(&self) -> Option<UiaRead> {
            None
        }
        fn read_clipboard(&self, _deadline: Instant) -> Option<String> {
            None
        }
    }

    pub fn foreground() -> isize {
        0
    }
    pub fn restore_foreground(_hwnd: isize) {}
    pub fn cursor_pos() -> (i32, i32) {
        (0, 0)
    }
    pub fn start_double_tap(_on_fire: impl Fn() + Send + Sync + 'static) {}
    pub fn set_double_tap(_target: Option<crate::doubletap::Modifier>) {}
}

#[cfg(windows)]
mod imp {
    use crate::selection::{Rect, SelectionReader, UiaRead};
    use std::ffi::c_void;
    use std::thread;
    use std::time::{Duration, Instant};
    use windows::core::Result;
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND, POINT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, SAFEARRAY,
    };
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData, GetClipboardSequenceNumber,
        OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{
        SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetLBound, SafeArrayGetUBound, SafeArrayUnaccessData,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationTextPattern, IUIAutomationTextRange, TextPatternRangeEndpoint_End,
        TextPatternRangeEndpoint_Start, TextUnit_Paragraph, UIA_TextPatternId,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
        VIRTUAL_KEY, VK_C, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetForegroundWindow, SetForegroundWindow};

    pub struct Reader;

    impl SelectionReader for Reader {
        fn read_uia(&self) -> Option<UiaRead> {
            // 每次在调用线程上初始化 COM（编排层为每次读取开新线程）
            unsafe {
                let inited = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
                let out = uia_read().ok().flatten();
                if inited {
                    CoUninitialize();
                }
                out
            }
        }

        fn read_clipboard(&self, deadline: Instant) -> Option<String> {
            clipboard_read(deadline)
        }
    }

    // ---------- UI Automation ----------

    unsafe fn uia_read() -> Result<Option<UiaRead>> {
        let uia: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
        let walker = uia.ControlViewWalker()?;
        let mut el = uia.GetFocusedElement()?;

        // 焦点元素本身常常不支持 TextPattern（如编辑区里的子元素），沿祖先链找
        let mut pattern = None;
        for _ in 0..12 {
            if let Ok(p) = el.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
                pattern = Some(p);
                break;
            }
            match walker.GetParentElement(&el) {
                Ok(parent) => el = parent,
                Err(_) => break,
            }
        }
        let Some(pattern) = pattern else { return Ok(None) };

        let ranges = pattern.GetSelection()?;
        for i in 0..ranges.Length()? {
            let r = ranges.GetElement(i)?;
            let text = r.GetText(-1)?.to_string();
            if text.trim().is_empty() {
                continue;
            }
            let (paragraph, offset) = paragraph_of(&r).unwrap_or((None, None));
            return Ok(Some(UiaRead { text, paragraph, offset, rect: bounding(&r) }));
        }
        Ok(None)
    }

    /// 选区所在段落与偏移（UTF-16 下标）。选区跨段时返回 (None, None)。
    unsafe fn paragraph_of(r: &IUIAutomationTextRange) -> Result<(Option<String>, Option<usize>)> {
        let para = r.Clone()?;
        para.ExpandToEnclosingUnit(TextUnit_Paragraph)?;
        let starts_inside = para.CompareEndpoints(TextPatternRangeEndpoint_Start, r, TextPatternRangeEndpoint_Start)? <= 0;
        let ends_inside = para.CompareEndpoints(TextPatternRangeEndpoint_End, r, TextPatternRangeEndpoint_End)? >= 0;
        if !starts_inside || !ends_inside {
            return Ok((None, None));
        }
        let pre = para.Clone()?;
        pre.MoveEndpointByRange(TextPatternRangeEndpoint_End, r, TextPatternRangeEndpoint_Start)?;
        let offset = pre.GetText(-1)?.len();
        Ok((Some(para.GetText(-1)?.to_string()), Some(offset)))
    }

    /// 选区各行矩形的并集（物理像素）。
    unsafe fn bounding(r: &IUIAutomationTextRange) -> Option<Rect> {
        let sa: *mut SAFEARRAY = r.GetBoundingRectangles().ok()?;
        if sa.is_null() {
            return None;
        }
        let rect = read_rects(sa);
        let _ = SafeArrayDestroy(sa);
        rect
    }

    unsafe fn read_rects(sa: *mut SAFEARRAY) -> Option<Rect> {
        let n = (SafeArrayGetUBound(sa, 1).ok()? - SafeArrayGetLBound(sa, 1).ok()? + 1).max(0) as usize;
        let mut data: *mut c_void = std::ptr::null_mut();
        SafeArrayAccessData(sa, &mut data).ok()?;
        let vals = std::slice::from_raw_parts(data as *const f64, n);
        let mut out: Option<Rect> = None;
        for c in vals.chunks_exact(4) {
            let r = Rect {
                left: c[0] as i32,
                top: c[1] as i32,
                right: (c[0] + c[2]) as i32,
                bottom: (c[1] + c[3]) as i32,
            };
            out = Some(match out {
                None => r,
                Some(o) => Rect {
                    left: o.left.min(r.left),
                    top: o.top.min(r.top),
                    right: o.right.max(r.right),
                    bottom: o.bottom.max(r.bottom),
                },
            });
        }
        let _ = SafeArrayUnaccessData(sa);
        out
    }

    // ---------- 剪贴板兜底 ----------

    const CF_UNICODETEXT: u32 = 13;

    /// GDI 句柄类格式无法按字节复制，跳过（CF_BITMAP 等会由 CF_DIB 自动合成）。
    fn copyable(fmt: u32) -> bool {
        !matches!(fmt, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E | 0x200..=0x3FF)
    }

    struct Clip;

    impl Clip {
        fn open() -> Option<Clip> {
            for _ in 0..10 {
                if unsafe { OpenClipboard(None) }.is_ok() {
                    return Some(Clip);
                }
                thread::sleep(Duration::from_millis(10));
            }
            None
        }
    }

    impl Drop for Clip {
        fn drop(&mut self) {
            let _ = unsafe { CloseClipboard() };
        }
    }

    fn snapshot() -> Option<Vec<(u32, Vec<u8>)>> {
        let _clip = Clip::open()?;
        let mut out = Vec::new();
        let mut fmt = 0;
        unsafe {
            loop {
                fmt = EnumClipboardFormats(fmt);
                if fmt == 0 {
                    break;
                }
                if !copyable(fmt) {
                    continue;
                }
                let Ok(h) = GetClipboardData(fmt) else { continue };
                let g = HGLOBAL(h.0);
                let size = GlobalSize(g);
                let p = GlobalLock(g);
                if size == 0 || p.is_null() {
                    continue;
                }
                out.push((fmt, std::slice::from_raw_parts(p as *const u8, size).to_vec()));
                let _ = GlobalUnlock(g);
            }
        }
        Some(out)
    }

    /// 逐个格式写回；单个格式失败不影响其他格式（文本总在其中）。
    fn restore(snap: &[(u32, Vec<u8>)]) -> bool {
        let Some(_clip) = Clip::open() else { return false };
        unsafe {
            let _ = EmptyClipboard();
            for (fmt, bytes) in snap {
                let Ok(h) = GlobalAlloc(GMEM_MOVEABLE, bytes.len()) else { continue };
                let p = GlobalLock(h);
                if p.is_null() {
                    let _ = GlobalFree(Some(h));
                    continue;
                }
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), p as *mut u8, bytes.len());
                let _ = GlobalUnlock(h);
                if SetClipboardData(*fmt, Some(HANDLE(h.0))).is_err() {
                    let _ = GlobalFree(Some(h));
                }
            }
        }
        true
    }

    fn read_text() -> Option<String> {
        let _clip = Clip::open()?;
        unsafe {
            let h = GetClipboardData(CF_UNICODETEXT).ok()?;
            let g = HGLOBAL(h.0);
            let p = GlobalLock(g) as *const u16;
            if p.is_null() {
                return None;
            }
            let max = GlobalSize(g) / 2;
            let len = (0..max).find(|&i| *p.add(i) == 0).unwrap_or(max);
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            let _ = GlobalUnlock(g);
            Some(s)
        }
    }

    fn key_down(vk: VIRTUAL_KEY) -> bool {
        (unsafe { GetAsyncKeyState(vk.0 as i32) } as u16 & 0x8000) != 0
    }

    fn modifiers_down() -> bool {
        [VK_CONTROL, VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN].into_iter().any(key_down)
    }

    fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn clipboard_read(deadline: Instant) -> Option<String> {
        // 等快捷键的修饰键松开，否则模拟出的是 Ctrl+Alt+C 之类
        let wait_until = (Instant::now() + Duration::from_millis(500)).min(deadline);
        while modifiers_down() && Instant::now() < wait_until {
            thread::sleep(Duration::from_millis(10));
        }
        if modifiers_down() {
            return None;
        }

        // 拿不到快照就不碰剪贴板
        let snap = snapshot()?;
        let seq0 = unsafe { GetClipboardSequenceNumber() };
        let inputs = [key(VK_CONTROL, false), key(VK_C, false), key(VK_C, true), key(VK_CONTROL, true)];
        unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };

        let until = (Instant::now() + Duration::from_millis(300)).min(deadline);
        let mut changed = false;
        while Instant::now() < until {
            if unsafe { GetClipboardSequenceNumber() } != seq0 {
                changed = true;
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        if !changed {
            return None; // 复制没生效，剪贴板原样未动
        }

        // 序列号在 EmptyClipboard 时就变了，数据可能稍后才写入，到期前再试几次
        let mut text = read_text();
        while text.as_deref().map_or(true, str::is_empty) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
            text = read_text();
        }
        if !restore(&snap) {
            eprintln!("剪贴板恢复失败");
        }
        text
    }

    // ---------- 焦点与鼠标 ----------

    pub fn foreground() -> isize {
        unsafe { GetForegroundWindow().0 as isize }
    }

    pub fn restore_foreground(hwnd: isize) {
        if hwnd != 0 {
            let _ = unsafe { SetForegroundWindow(HWND(hwnd as *mut c_void)) };
        }
    }

    pub fn cursor_pos() -> (i32, i32) {
        let mut p = POINT::default();
        let _ = unsafe { GetCursorPos(&mut p) };
        (p.x, p.y)
    }

    // ---------- 双击修饰键（低级键盘钩子） ----------

    use crate::doubletap::{DoubleTap, Key, Modifier};
    use std::sync::atomic::{AtomicU8, Ordering::Relaxed};
    use std::sync::{Mutex, OnceLock};
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG,
        WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    /// 0 = 关闭；1/2/3 = Alt/Ctrl/Shift。钩子一直挂着，关闭时只是直接放行。
    static MODE: AtomicU8 = AtomicU8::new(0);
    static STATE: Mutex<Option<DoubleTap>> = Mutex::new(None);
    static ON_FIRE: OnceLock<Box<dyn Fn() + Send + Sync>> = OnceLock::new();

    fn is_target(mode: u8, vk: u32) -> bool {
        match mode {
            1 => matches!(vk, 0x12 | 0xA4 | 0xA5), // VK_MENU / LMENU / RMENU
            2 => matches!(vk, 0x11 | 0xA2 | 0xA3), // VK_CONTROL / LCONTROL / RCONTROL
            3 => matches!(vk, 0x10 | 0xA0 | 0xA1), // VK_SHIFT / LSHIFT / RSHIFT
            _ => false,
        }
    }

    unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        let mode = MODE.load(Relaxed);
        if code == HC_ACTION as i32 && mode != 0 {
            let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            // 忽略模拟输入（包括自己发的 Ctrl+C）
            if kb.flags.0 & LLKHF_INJECTED.0 == 0 {
                let key = if is_target(mode, kb.vkCode) { Key::Target } else { Key::Other };
                let now = Instant::now();
                let fired = {
                    let mut st = STATE.lock().unwrap();
                    let d = st.get_or_insert_with(DoubleTap::default);
                    match wparam.0 as u32 {
                        WM_KEYDOWN | WM_SYSKEYDOWN => {
                            d.key_down(key, now);
                            false
                        }
                        WM_KEYUP | WM_SYSKEYUP => d.key_up(key, now),
                        _ => false,
                    }
                };
                if fired {
                    if let Some(f) = ON_FIRE.get() {
                        f(); // 回调只投递任务，钩子必须立即返回
                    }
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    /// 启动钩子线程（只调用一次）。钩子需要所在线程有消息循环。
    pub fn start_double_tap(on_fire: impl Fn() + Send + Sync + 'static) {
        if ON_FIRE.set(Box::new(on_fire)).is_err() {
            return;
        }
        thread::spawn(|| unsafe {
            let module = GetModuleHandleW(None).ok();
            if let Err(e) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module.map(Into::into), 0) {
                eprintln!("键盘钩子安装失败: {e}");
                return;
            }
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
        });
    }

    pub fn set_double_tap(target: Option<Modifier>) {
        *STATE.lock().unwrap() = None;
        MODE.store(
            match target {
                None => 0,
                Some(Modifier::Alt) => 1,
                Some(Modifier::Ctrl) => 2,
                Some(Modifier::Shift) => 3,
            },
            Relaxed,
        );
    }
}
