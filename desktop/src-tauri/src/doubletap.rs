//! 修饰键双击检测（如 Alt×2）。纯状态机，可在任何平台测试；Windows 键盘钩子只负责把按键事件喂进来。
//! 只看目标修饰键的按下/抬起时机，不记录任何按键内容。

use std::time::{Duration, Instant};

/// 单次轻按最长按住时间，超过算长按
const MAX_HOLD: Duration = Duration::from_millis(300);
/// 两次轻按（抬起到抬起）的最大间隔
const MAX_GAP: Duration = Duration::from_millis(400);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Modifier {
    Alt,
    Ctrl,
    Shift,
}

impl Modifier {
    /// 设置里的写法：DoubleAlt / DoubleCtrl / DoubleShift
    pub fn parse(accelerator: &str) -> Option<Modifier> {
        match accelerator.trim().to_ascii_lowercase().as_str() {
            "doublealt" => Some(Modifier::Alt),
            "doublectrl" => Some(Modifier::Ctrl),
            "doubleshift" => Some(Modifier::Shift),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Key {
    Target,
    Other,
}

#[derive(Default)]
pub struct DoubleTap {
    down_at: Option<Instant>,
    /// 按住目标键期间按过别的键（如 Alt+Tab），这次不算轻按
    tainted: bool,
    last_tap: Option<Instant>,
}

impl DoubleTap {
    pub fn key_down(&mut self, key: Key, now: Instant) {
        match key {
            // 按住时的自动重复按下事件不重置计时
            Key::Target if self.down_at.is_none() => {
                self.down_at = Some(now);
                self.tainted = false;
            }
            Key::Target => {}
            Key::Other => {
                self.tainted = true;
                self.last_tap = None;
            }
        }
    }

    /// 返回 true 表示完成了一次双击。
    pub fn key_up(&mut self, key: Key, now: Instant) -> bool {
        if key == Key::Other {
            return false;
        }
        let Some(down) = self.down_at.take() else { return false };
        if self.tainted || now.duration_since(down) > MAX_HOLD {
            self.last_tap = None;
            return false;
        }
        if self.last_tap.is_some_and(|t| now.duration_since(t) <= MAX_GAP) {
            self.last_tap = None;
            return true;
        }
        self.last_tap = Some(now);
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(base: Instant, n: u64) -> Instant {
        base + Duration::from_millis(n)
    }

    fn tap(d: &mut DoubleTap, base: Instant, at: u64) -> bool {
        d.key_down(Key::Target, ms(base, at));
        d.key_up(Key::Target, ms(base, at + 60))
    }

    #[test]
    fn two_quick_taps_fire() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        assert!(!tap(&mut d, t, 0));
        assert!(tap(&mut d, t, 200));
    }

    #[test]
    fn slow_second_tap_does_not_fire() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        tap(&mut d, t, 0);
        assert!(!tap(&mut d, t, 600));
    }

    #[test]
    fn third_tap_starts_over() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        tap(&mut d, t, 0);
        assert!(tap(&mut d, t, 200));
        assert!(!tap(&mut d, t, 400));
    }

    #[test]
    fn combo_while_held_does_not_count() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        tap(&mut d, t, 0);
        d.key_down(Key::Target, ms(t, 200));
        d.key_down(Key::Other, ms(t, 220)); // Alt+Tab
        assert!(!d.key_up(Key::Target, ms(t, 260)));
    }

    #[test]
    fn other_key_between_taps_resets() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        tap(&mut d, t, 0);
        d.key_down(Key::Other, ms(t, 100));
        assert!(!tap(&mut d, t, 200));
    }

    #[test]
    fn long_press_does_not_count() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        tap(&mut d, t, 0);
        d.key_down(Key::Target, ms(t, 100));
        assert!(!d.key_up(Key::Target, ms(t, 500)));
    }

    #[test]
    fn autorepeat_keeps_first_down_time() {
        let (mut d, t) = (DoubleTap::default(), Instant::now());
        d.key_down(Key::Target, ms(t, 0));
        d.key_down(Key::Target, ms(t, 250)); // 自动重复
        assert!(!d.key_up(Key::Target, ms(t, 350))); // 实际按了 350ms，算长按
    }

    #[test]
    fn parse_accelerator() {
        assert_eq!(Modifier::parse("DoubleAlt"), Some(Modifier::Alt));
        assert_eq!(Modifier::parse("doublectrl"), Some(Modifier::Ctrl));
        assert_eq!(Modifier::parse("Ctrl+Alt+Space"), None);
    }
}
