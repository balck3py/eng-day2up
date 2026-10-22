//! 选区读取的降级编排：UIA（800ms）→ 剪贴板兜底 → 空，整次不超过 1500ms。
//! 平台相关的读取由 `SelectionReader` 提供，这里只管决策与超时，可在任何平台测试。

use serde::Serialize;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

/// 屏幕物理像素坐标的矩形。
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Rect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Rect {
    pub fn is_empty(&self) -> bool {
        self.right <= self.left || self.bottom <= self.top
    }
}

/// UIA 读到的结果。`offset` 是选中文本在 `paragraph` 中的 UTF-16 下标（与 JS 字符串下标一致）。
#[derive(Debug, Clone, Default, PartialEq)]
pub struct UiaRead {
    pub text: String,
    pub paragraph: Option<String>,
    pub offset: Option<usize>,
    pub rect: Option<Rect>,
}

/// 发给前端的选区。
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Selection {
    pub seq: u64,
    pub text: String,
    pub paragraph: Option<String>,
    pub offset: Option<usize>,
    pub rect: Option<Rect>,
    /// "uia" | "clipboard" | "none"
    pub source: &'static str,
}

pub trait SelectionReader: Send + Sync + 'static {
    /// UI Automation 读取；不支持或没选中返回 None。可能阻塞（目标程序挂起）。
    fn read_uia(&self) -> Option<UiaRead>;
    /// 剪贴板兜底：`deadline` 前必须返回，且无论成败都要恢复剪贴板。
    fn read_clipboard(&self, deadline: Instant) -> Option<String>;
}

pub struct Timeouts {
    pub uia: Duration,
    pub total: Duration,
}

pub const TIMEOUTS: Timeouts = Timeouts {
    uia: Duration::from_millis(800),
    total: Duration::from_millis(1500),
};

/// 在独立线程上跑 `f`，最多等 `timeout`。超时就放弃结果（线程自行结束）。
// ponytail: 目标程序永久挂起时每次触发会遗留一个阻塞线程，真遇到再改成可复用的 COM 工作线程
fn with_timeout<T: Send + 'static>(timeout: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(f());
    });
    rx.recv_timeout(timeout).ok()
}

/// 读取一次选区（不含 seq，seq 由调用方分配）。
pub fn capture<R: SelectionReader>(reader: Arc<R>, t: &Timeouts) -> Selection {
    let start = Instant::now();
    let deadline = start + t.total;

    let r = reader.clone();
    if let Some(Some(read)) = with_timeout(t.uia, move || r.read_uia()) {
        if !read.text.trim().is_empty() {
            return Selection {
                seq: 0,
                text: read.text,
                paragraph: read.paragraph,
                offset: read.offset,
                rect: read.rect.filter(|r| !r.is_empty()),
                source: "uia",
            };
        }
    }

    let remaining = deadline.saturating_duration_since(Instant::now());
    let r = reader.clone();
    if let Some(Some(text)) = with_timeout(remaining, move || r.read_clipboard(deadline)) {
        if !text.trim().is_empty() {
            return Selection { seq: 0, text, paragraph: None, offset: None, rect: None, source: "clipboard" };
        }
    }

    Selection { seq: 0, text: String::new(), paragraph: None, offset: None, rect: None, source: "none" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    struct Fake {
        uia: Option<UiaRead>,
        uia_delay: Duration,
        clip: Option<String>,
        clip_called: AtomicBool,
    }

    impl Fake {
        fn new(uia: Option<UiaRead>, clip: Option<&str>) -> Self {
            Fake { uia, uia_delay: Duration::ZERO, clip: clip.map(String::from), clip_called: AtomicBool::new(false) }
        }
    }

    impl SelectionReader for Fake {
        fn read_uia(&self) -> Option<UiaRead> {
            thread::sleep(self.uia_delay);
            self.uia.clone()
        }
        fn read_clipboard(&self, _deadline: Instant) -> Option<String> {
            self.clip_called.store(true, Ordering::SeqCst);
            self.clip.clone()
        }
    }

    const FAST: Timeouts = Timeouts { uia: Duration::from_millis(100), total: Duration::from_millis(300) };

    fn uia(text: &str) -> UiaRead {
        UiaRead {
            text: text.into(),
            paragraph: Some(format!("A {text} here.")),
            offset: Some(2),
            rect: Some(Rect { left: 0, top: 0, right: 10, bottom: 10 }),
        }
    }

    #[test]
    fn uia_hit_skips_clipboard() {
        let f = Arc::new(Fake::new(Some(uia("word")), Some("clip")));
        let s = capture(f.clone(), &FAST);
        assert_eq!(s.source, "uia");
        assert_eq!(s.text, "word");
        assert_eq!(s.offset, Some(2));
        assert!(!f.clip_called.load(Ordering::SeqCst));
    }

    #[test]
    fn uia_blank_falls_back_to_clipboard() {
        let f = Arc::new(Fake::new(Some(uia("  ")), Some("word")));
        let s = capture(f, &FAST);
        assert_eq!(s.source, "clipboard");
        assert_eq!(s.text, "word");
        assert_eq!(s.paragraph, None);
    }

    #[test]
    fn uia_timeout_falls_back_within_total() {
        let mut fake = Fake::new(Some(uia("late")), Some("word"));
        fake.uia_delay = Duration::from_millis(1000);
        let start = Instant::now();
        let s = capture(Arc::new(fake), &FAST);
        assert_eq!(s.source, "clipboard");
        assert!(start.elapsed() < Duration::from_millis(300));
    }

    #[test]
    fn nothing_selected_is_none() {
        let s = capture(Arc::new(Fake::new(None, None)), &FAST);
        assert_eq!(s.source, "none");
        assert!(s.text.is_empty());
    }

    #[test]
    fn empty_rect_dropped() {
        let mut read = uia("word");
        read.rect = Some(Rect { left: 5, top: 5, right: 5, bottom: 5 });
        let s = capture(Arc::new(Fake::new(Some(read), None)), &FAST);
        assert_eq!(s.rect, None);
    }
}
