






#![allow(dead_code)]

use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};


pub fn library_dir() -> PathBuf {
    match std::env::var_os("ENGINUITY_LIBRARY_DIR") {
        Some(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data/library"),
    }
}


pub fn library_kind_dir(kind: &str) -> Option<PathBuf> {
    let dir = library_dir().join("files").join(format!("library-{kind}"));
    if dir.is_dir() {
        return Some(dir);
    }
    skipped(&format!("library-{kind}/"));
    None
}


pub fn library_file(kind: &str, name: &str) -> Option<PathBuf> {
    let p = library_dir().join("files").join(format!("library-{kind}")).join(name);
    if p.is_file() {
        return Some(p);
    }
    skipped(&format!("library-{kind}/{name}"));
    None
}


pub fn read_library_file(kind: &str, name: &str) -> Option<Vec<u8>> {
    std::fs::read(library_file(kind, name)?).ok()
}



fn skipped(what: &str) {
    static TOLD: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let root = library_dir();
    let present = root.join("files").is_dir();
    let key = if present { what.to_string() } else { String::new() };
    let mut told = TOLD.get_or_init(|| Mutex::new(HashSet::new())).lock().unwrap_or_else(|e| e.into_inner());
    if !told.insert(key) {
        return;
    }
    let text = if present {
        format!("[library] {what} is not in the offline library mirror ({}): the tests that need it are skipped", root.display())
    } else {
        format!(
            "[library] No offline library mirror at {}: tests that need library robots, tools or stations are skipped (npm run library:mirror creates it; ENGINUITY_LIBRARY_DIR points at another one)",
            root.display()
        )
    };
    let _ = writeln!(std::io::stderr(), "{text}");
}
