// release 下不弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod doubletap;
mod platform;
mod position;
mod selection;

use selection::{Rect, Selection};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering::SeqCst};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, State, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_store::StoreExt;

const POPUP: &str = "popup";
const SETTINGS: &str = "settings";
const DEFAULT_SHORTCUT: &str = "Ctrl+Alt+Space";
const TOOLTIP: &str = "划词查词";
/// 与 tauri.conf.json 里 popup 的逻辑尺寸一致
const POPUP_SIZE: (f64, f64) = (380.0, 460.0);

#[derive(Default)]
struct AppState {
    seq: AtomicU64,
    latest: Mutex<Option<Selection>>,
    /// 触发前的前台窗口，关闭弹窗时把焦点还给它
    prev_foreground: AtomicIsize,
    capturing: AtomicBool,
    /// 每次显示/隐藏递增，闲置销毁任务据此判断是否已被新的使用打断
    hide_gen: AtomicU64,
    shortcut: Mutex<Option<Trigger>>,
    shortcut_error: Mutex<Option<String>>,
    paused: AtomicBool,
    pause_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

fn setting(app: &AppHandle, key: &str) -> Option<serde_json::Value> {
    app.store("settings.json").ok()?.get(key)
}

fn window_from_config(app: &AppHandle, label: &str) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(label) {
        return Ok(w);
    }
    let cfg = app.config().app.windows.iter().find(|w| w.label == label).cloned().expect("窗口配置缺失");
    WebviewWindowBuilder::from_config(app, &cfg)?.build()
}

// ---------- 弹窗 ----------

/// 快捷键回调（在事件循环线程上）：弹窗开着就关掉，否则在新线程读选区再弹出。
/// 窗口创建放在新线程里：Windows 上在事件处理器里同步建窗口会死锁。
fn on_hotkey(app: &AppHandle, double_tap: bool) {
    let st = app.state::<AppState>();
    if app.get_webview_window(POPUP).is_some_and(|w| w.is_visible().unwrap_or(false)) {
        hide_popup_and_restore(app, true);
        return;
    }
    if st.capturing.swap(true, SeqCst) {
        return;
    }
    // 读选区必须在弹窗抢焦点之前
    st.prev_foreground.store(platform::foreground(), SeqCst);
    let cursor = platform::cursor_pos();
    let app = app.clone();
    thread::spawn(move || {
        if double_tap {
            // 单按 Alt 会让 Word / VS Code 进入菜单模式，第二下又退出；稍等焦点回到正文再读
            thread::sleep(Duration::from_millis(120));
        }
        let mut sel = selection::capture(Arc::new(platform::Reader), &selection::TIMEOUTS);
        let st = app.state::<AppState>();
        sel.seq = st.seq.fetch_add(1, SeqCst) + 1;
        *st.latest.lock().unwrap() = Some(sel.clone());
        if let Err(e) = show_popup(&app, &sel, cursor) {
            eprintln!("弹窗显示失败: {e}");
        }
        st.capturing.store(false, SeqCst);
    });
}

fn show_popup(app: &AppHandle, sel: &Selection, cursor: (i32, i32)) -> tauri::Result<()> {
    app.state::<AppState>().hide_gen.fetch_add(1, SeqCst); // 取消待执行的闲置销毁
    let w = window_from_config(app, POPUP)?;

    let probe = sel.rect.map_or(cursor, |r| (r.left, r.bottom));
    if let Some(m) = app.monitor_from_point(probe.0 as f64, probe.1 as f64)?.or(app.primary_monitor()?) {
        let wa = m.work_area();
        let work = Rect {
            left: wa.position.x,
            top: wa.position.y,
            right: wa.position.x + wa.size.width as i32,
            bottom: wa.position.y + wa.size.height as i32,
        };
        let scale = m.scale_factor();
        let size = ((POPUP_SIZE.0 * scale) as i32, (POPUP_SIZE.1 * scale) as i32);
        let (x, y) = position::place(sel.rect, cursor, size, work);
        w.set_position(PhysicalPosition::new(x, y))?;
    }
    w.show()?;
    w.set_focus()?;
    app.emit_to(POPUP, "selection", sel)?;
    Ok(())
}

/// 隐藏弹窗；`restore` 时把焦点还给触发前的窗口（点击外部关闭时焦点已在被点处，不抢回）。
fn hide_popup_and_restore(app: &AppHandle, restore: bool) {
    let Some(w) = app.get_webview_window(POPUP) else { return };
    if !w.is_visible().unwrap_or(false) {
        return;
    }
    let _ = w.hide();
    let st = app.state::<AppState>();
    if restore {
        platform::restore_foreground(st.prev_foreground.load(SeqCst));
    }

    // 闲置超过设定分钟数就销毁，释放 WebView2 进程
    let gen = st.hide_gen.fetch_add(1, SeqCst) + 1;
    let minutes = setting(app, "idleDestroyMinutes").and_then(|v| v.as_u64()).unwrap_or(10).max(1);
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(minutes * 60));
        if app.state::<AppState>().hide_gen.load(SeqCst) != gen {
            return;
        }
        if let Some(w) = app.get_webview_window(POPUP) {
            if !w.is_visible().unwrap_or(true) {
                let _ = w.destroy();
            }
        }
    });
}

/// 设置窗口：按需创建，关闭即销毁（Tauri 默认行为）。不能在事件循环线程上调用。
fn open_settings_window(app: &AppHandle) {
    match window_from_config(app, SETTINGS) {
        Ok(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        Err(e) => eprintln!("设置窗口打开失败: {e}"),
    }
}

fn open_settings_async(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || open_settings_window(&app));
}

// ---------- 快捷键 ----------

/// 触发方式：普通组合键（RegisterHotKey），或双击修饰键（键盘钩子，RegisterHotKey 注册不了单独的修饰键）。
#[derive(Clone, Copy, PartialEq)]
enum Trigger {
    Combo(Shortcut),
    Double(doubletap::Modifier),
}

impl Trigger {
    fn parse(accelerator: &str) -> Result<Trigger, String> {
        match doubletap::Modifier::parse(accelerator) {
            Some(m) => Ok(Trigger::Double(m)),
            None => accelerator.parse().map(Trigger::Combo).map_err(|e| format!("{e}")),
        }
    }

    fn activate(self, app: &AppHandle) -> Result<(), String> {
        match self {
            Trigger::Combo(sc) if app.global_shortcut().is_registered(sc) => Ok(()),
            Trigger::Combo(sc) => app.global_shortcut().register(sc).map_err(|e| e.to_string()),
            Trigger::Double(m) => {
                platform::set_double_tap(Some(m));
                Ok(())
            }
        }
    }

    fn deactivate(self, app: &AppHandle) {
        match self {
            Trigger::Combo(sc) => {
                let _ = app.global_shortcut().unregister(sc);
            }
            Trigger::Double(_) => platform::set_double_tap(None),
        }
    }
}

/// 启用新快捷键，成功后才停用旧的；失败时旧快捷键保持不变。
fn register_shortcut(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let new = Trigger::parse(accelerator)?;
    let st = app.state::<AppState>();
    let mut cur = st.shortcut.lock().unwrap();
    new.activate(app)?;
    if let Some(old) = cur.replace(new) {
        // 双击换成另一个双击时 activate 已经切换了目标，不能再关掉
        let same_kind = matches!((old, new), (Trigger::Double(_), Trigger::Double(_)));
        if old != new && !same_kind {
            old.deactivate(app);
        }
    }
    *st.shortcut_error.lock().unwrap() = None;
    set_paused(app, false);
    Ok(())
}

fn set_paused(app: &AppHandle, paused: bool) {
    let st = app.state::<AppState>();
    st.paused.store(paused, SeqCst);
    if let Some(item) = st.pause_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(paused);
    }
    let tip = if paused { "划词查词 · 快捷键已暂停" } else { TOOLTIP };
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tip));
    }
}

fn toggle_pause(app: &AppHandle) {
    let st = app.state::<AppState>();
    let Some(trigger) = *st.shortcut.lock().unwrap() else { return };
    if st.paused.load(SeqCst) {
        match trigger.activate(app) {
            Ok(()) => set_paused(app, false),
            Err(e) => {
                *st.shortcut_error.lock().unwrap() = Some(e);
                set_paused(app, true);
            }
        }
    } else {
        trigger.deactivate(app);
        set_paused(app, true);
    }
}

// ---------- 前端命令 ----------

#[tauri::command]
fn take_selection(state: State<AppState>) -> Option<Selection> {
    state.latest.lock().unwrap().clone()
}

#[tauri::command]
fn hide_popup(app: AppHandle) {
    hide_popup_and_restore(&app, true);
}

#[tauri::command]
async fn open_settings(app: AppHandle) {
    open_settings_window(&app);
}

#[tauri::command]
fn apply_shortcut(app: AppHandle, accelerator: String) -> Result<(), String> {
    register_shortcut(&app, &accelerator)
}

#[tauri::command]
fn shortcut_error(state: State<AppState>) -> Option<String> {
    state.shortcut_error.lock().unwrap().clone()
}

fn setup(app: &AppHandle) -> tauri::Result<()> {
    let settings_i = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let pause_i = CheckMenuItem::with_id(app, "pause", "暂停快捷键", true, false, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings_i, &pause_i, &quit_i])?;
    *app.state::<AppState>().pause_item.lock().unwrap() = Some(pause_i);

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("缺少应用图标"))
        .tooltip(TOOLTIP)
        .menu(&menu)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "settings" => open_settings_async(app),
            "pause" => toggle_pause(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    // 钩子回调在钩子线程上，转到事件循环线程，与组合键回调走同一条路
    let handle = app.clone();
    platform::start_double_tap(move || {
        let app = handle.clone();
        let _ = handle.run_on_main_thread(move || on_hotkey(&app, true));
    });

    let accel = setting(app, "shortcut")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| DEFAULT_SHORTCUT.into());
    if let Err(e) = register_shortcut(app, &accel) {
        // 不静默失败：记下原因、托盘提示，并打开设置页
        *app.state::<AppState>().shortcut_error.lock().unwrap() = Some(format!("{accel}（{e}）"));
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some("划词查词 · 快捷键被占用"));
        }
        open_settings_async(app);
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // 单实例必须最先注册：第二次启动转为打开设置
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| open_settings_async(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        on_hotkey(app, false);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![take_selection, hide_popup, open_settings, apply_shortcut, shortcut_error])
        .on_window_event(|window, event| {
            if window.label() == POPUP {
                if let WindowEvent::Focused(false) = event {
                    hide_popup_and_restore(window.app_handle(), false);
                }
            }
        })
        .setup(|app| Ok(setup(app.handle())?))
        .build(tauri::generate_context!())
        .expect("启动失败")
        .run(|_app, event| {
            // 没有任何窗口时也常驻托盘；只有托盘「退出」（带退出码）才真正退出
            if let RunEvent::ExitRequested { api, code, .. } = event {
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
