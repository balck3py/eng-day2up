//! 弹窗定位：放在选区矩形下方（没有矩形时在鼠标下方），放不下就翻到上方，并整体夹在显示器工作区内。
//! 全部是物理像素，DPI 换算由调用方用目标显示器的缩放比完成。

use crate::selection::Rect;

const GAP: i32 = 8;

/// 返回弹窗左上角坐标。`anchor` 为选区矩形；None 时用鼠标点（视为零高矩形）。
pub fn place(anchor: Option<Rect>, cursor: (i32, i32), size: (i32, i32), work: Rect) -> (i32, i32) {
    let (w, h) = size;
    let a = anchor.unwrap_or(Rect { left: cursor.0, top: cursor.1, right: cursor.0, bottom: cursor.1 });
    // 鼠标指针本身有高度，别让弹窗盖住它
    let below_gap = if anchor.is_some() { GAP } else { GAP * 2 };

    let mut y = a.bottom + below_gap;
    if y + h > work.bottom {
        y = a.top - GAP - h;
    }
    let y = y.clamp(work.top, (work.bottom - h).max(work.top));
    let x = a.left.clamp(work.left, (work.right - w).max(work.left));
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1040 };
    const SIZE: (i32, i32) = (380, 460);

    fn rect(l: i32, t: i32, r: i32, b: i32) -> Option<Rect> {
        Some(Rect { left: l, top: t, right: r, bottom: b })
    }

    #[test]
    fn below_selection() {
        assert_eq!(place(rect(100, 200, 180, 220), (0, 0), SIZE, WORK), (100, 228));
    }

    #[test]
    fn flips_above_at_screen_bottom() {
        assert_eq!(place(rect(100, 900, 180, 920), (0, 0), SIZE, WORK), (100, 900 - 8 - 460));
    }

    #[test]
    fn clamped_to_right_edge() {
        assert_eq!(place(rect(1800, 100, 1900, 120), (0, 0), SIZE, WORK).0, 1920 - 380);
    }

    #[test]
    fn cursor_when_no_rect() {
        assert_eq!(place(None, (500, 300), SIZE, WORK), (500, 316));
    }

    #[test]
    fn second_monitor_with_offset_origin() {
        let work = Rect { left: 1920, top: 0, right: 3840, bottom: 1040 };
        assert_eq!(place(None, (1900, 300), SIZE, work).0, 1920);
    }

    #[test]
    fn tiny_work_area_pins_top_left() {
        let work = Rect { left: 0, top: 0, right: 200, bottom: 200 };
        assert_eq!(place(rect(50, 50, 60, 60), (0, 0), SIZE, work), (0, 0));
    }
}
