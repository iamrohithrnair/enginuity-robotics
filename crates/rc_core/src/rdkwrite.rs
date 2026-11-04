




















































use crate::math::{inv, Mat4, IDENTITY};
use serde_json::{json, Value};
use std::collections::HashMap;


struct W {
    b: Vec<u8>,
}

impl W {
    fn u8(&mut self, v: u8) {
        self.b.push(v);
    }
    fn i32(&mut self, v: i32) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    fn i64(&mut self, v: i64) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    fn f64(&mut self, v: f64) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.b.extend_from_slice(&v.to_le_bytes());
    }
    
    fn qstring(&mut self, s: Option<&str>) {
        match s {
            None => self.b.extend_from_slice(&u32::MAX.to_le_bytes()),
            Some(s) => {
                let u: Vec<u16> = s.encode_utf16().collect();
                self.b.extend_from_slice(&((u.len() * 2) as u32).to_le_bytes());
                for c in u {
                    self.b.extend_from_slice(&c.to_le_bytes());
                }
            }
        }
    }
    fn text(&mut self, s: &str) {
        self.qstring(Some(s));
    }
    
    fn text_or_null(&mut self, s: &str) {
        self.qstring(if s.is_empty() { None } else { Some(s) });
    }
    fn qbytes(&mut self, b: Option<&[u8]>) {
        match b {
            None => self.b.extend_from_slice(&u32::MAX.to_le_bytes()),
            Some(b) => {
                self.b.extend_from_slice(&(b.len() as u32).to_le_bytes());
                self.b.extend_from_slice(b);
            }
        }
    }
    
    fn mat(&mut self, m: &Mat4) {
        for c in 0..4 {
            for r in 0..4 {
                self.f64(m[r * 4 + c]);
            }
        }
    }
    
    fn no_params(&mut self) {
        self.i32(0);
    }
    fn pos(&self) -> usize {
        self.b.len()
    }
    fn patch_i64(&mut self, at: usize, v: i64) {
        self.b[at..at + 8].copy_from_slice(&v.to_le_bytes());
    }
}

fn mat4(v: Option<&Value>) -> Option<Mat4> {
    let a = v?.as_array()?;
    if a.len() != 16 {
        return None;
    }
    let mut m = [0.0; 16];
    for (i, x) in a.iter().enumerate() {
        m[i] = x.as_f64()?;
    }
    Some(m)
}

fn f64s(v: Option<&Value>) -> Vec<f64> {
    v.and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.as_f64()).collect()).unwrap_or_default()
}


fn joints_of(v: Option<&Value>) -> Vec<f64> {
    v.and_then(|a| a.as_array()).map(|a| a.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect()).unwrap_or_default()
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn bool_of(v: &Value, key: &str, default: bool) -> bool {
    match v.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        _ => default,
    }
}

fn i64_of(v: &Value, key: &str, default: i64) -> i64 {
    v.get(key).and_then(|x| x.as_i64().or_else(|| x.as_f64().map(|f| f as i64))).unwrap_or(default)
}

fn f64_of(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(default)
}



fn encode_normal(n: [f32; 3]) -> [u8; 2] {
    let (x, y, z) = (n[0] as f64, n[1] as f64, n[2] as f64);
    let len = (x * x + y * y + z * z).sqrt();
    if !(len > 1e-12) {
        return [0, 0];
    }
    let th = (z / len).clamp(-1.0, 1.0).acos();
    let mut ph = y.atan2(x);
    if ph < 0.0 {
        ph += 2.0 * std::f64::consts::PI;
    }
    let b0 = (th * 255.0 / std::f64::consts::PI).round().clamp(0.0, 255.0) as u8;
    let b1 = ((ph * 255.0 / (2.0 * std::f64::consts::PI)).round() as i64).rem_euclid(256) as u8;
    [b0, b1]
}


fn put_text(h: &mut [f64], rows: usize, col: usize, max: usize, s: &str) {
    let start = col * rows;
    for k in 0..max {
        if start + k < h.len() {
            h[start + k] = 0.0;
        }
    }
    for (k, c) in s.chars().take(max).enumerate() {
        if start + k < h.len() {
            h[start + k] = c as u32 as f64;
        }
    }
}


fn put_mat(h: &mut [f64], rows: usize, col: usize, m: &Mat4) {
    for c in 0..4 {
        for r in 0..4 {
            h[col * rows + c * 4 + r] = m[r * 4 + c];
        }
    }
}


struct Feat<'a> {
    points: Vec<[f64; 6]>,
    names: Vec<&'a str>,
    curves: Vec<(&'a str, [f32; 4], Vec<[f64; 6]>)>,
}

fn rows6(v: Option<&Value>) -> Vec<[f64; 6]> {
    v.and_then(|a| a.as_array())
        .map(|rows| {
            rows.iter()
                .map(|r| {
                    let x = f64s(Some(r));
                    let g = |i: usize| x.get(i).copied().unwrap_or(0.0);
                    [g(0), g(1), g(2), g(3), g(4), g(5)]
                })
                .collect()
        })
        .unwrap_or_default()
}

fn features_of(v: Option<&Value>) -> Feat<'_> {
    let Some(v) = v else { return Feat { points: vec![], names: vec![], curves: vec![] } };
    let points = rows6(v.get("points"));
    let names = v.get("point_names").and_then(|a| a.as_array()).map(|a| a.iter().map(|s| s.as_str().unwrap_or("")).collect()).unwrap_or_default();
    let curves = v
        .get("curves")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .map(|c| {
                    let rgba = f64s(c.get("rgba"));
                    let g = |i: usize| rgba.get(i).copied().unwrap_or(0.0) as f32;
                    (str_of(c, "name"), [g(0), g(1), g(2), g(3)], rows6(c.get("points")))
                })
                .collect()
        })
        .unwrap_or_default();
    Feat { points, names, curves }
}





fn mesh_object(w: &mut W, shapes: &[Value], payload: &[f32], feat: &Feat) -> Result<(), String> {
    w.i64(shapes.len() as i64);
    for sh in shapes {
        let nt = i64_of(sh, "triangles", 0).max(0) as usize;
        let rgba = f64s(sh.get("rgba"));
        let pos = i64_of(sh, "positions", 0).max(0) as usize;
        let nor = sh.get("normals").and_then(|x| x.as_u64()).map(|x| x as usize);
        if pos + nt * 9 > payload.len() || nor.is_some_and(|n| n + nt * 9 > payload.len()) {
            return Err("mesh data out of range".into());
        }
        w.i64(nt as i64);
        for k in 0..4 {
            w.f32(rgba.get(k).copied().unwrap_or(1.0) as f32);
        }
        for v in 0..nt * 3 {
            let p = &payload[pos + v * 3..pos + v * 3 + 3];
            w.f32(p[0]);
            w.f32(p[1]);
            w.f32(p[2]);
            let n = match nor {
                Some(n) => [payload[n + v * 3], payload[n + v * 3 + 1], payload[n + v * 3 + 2]],
                None => {
                     
                    let t = v / 3 * 3;
                    let q = |i: usize| [payload[pos + i * 3] as f64, payload[pos + i * 3 + 1] as f64, payload[pos + i * 3 + 2] as f64];
                    let (a, b, c) = (q(t), q(t + 1), q(t + 2));
                    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
                    let e = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
                    [(u[1] * e[2] - u[2] * e[1]) as f32, (u[2] * e[0] - u[0] * e[2]) as f32, (u[0] * e[1] - u[1] * e[0]) as f32]
                }
            };
            let [b0, b1] = encode_normal(n);
            w.u8(b0);
            w.u8(b1);
        }
    }
    w.i64(feat.points.len() as i64);
    for (i, p) in feat.points.iter().enumerate() {
        w.text_or_null(feat.names.get(i).copied().unwrap_or(""));
        for v in [0.0, 0.0, 0.7, 1.0] {
            w.f32(v);
        }
        for k in 0..3 {
            w.f32(p[k] as f32);
        }
        for k in 0..3 {
            w.f32(p[k] as f32);
        }
        for k in 3..6 {
            w.f32(p[k] as f32);
        }
        w.f32(1e20);
    }
    w.i64(feat.curves.len() as i64);
    for (name, rgba, pts) in &feat.curves {
        w.i64(pts.len() as i64);
        w.text_or_null(name);
        for v in rgba {
            w.f32(*v);
        }
        for (i, p) in pts.iter().enumerate() {
            w.f32(0.0);
            for k in 0..6 {
                w.f32(p[k] as f32);
            }
             
            let (a, b) = if i + 1 < pts.len() { (p, &pts[i + 1]) } else if i > 0 { (&pts[i - 1], p) } else { (p, p) };
            let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
            for k in 0..3 {
                w.f32(if l > 1e-12 { (d[k] / l) as f32 } else { 0.0 });
            }
            for k in 0..3 {
                w.f32(p[k] as f32);
            }
        }
    }
    Ok(())
}


fn target_data(w: &mut W, is_joint: bool, unreachable: bool, joints: &[f64], pose: &Mat4, link: i32) {
    w.u8(is_joint as u8);
    w.u8(unreachable as u8);
    w.i32(joints.len() as i32);
    for q in joints {
        w.f64(*q);
    }
    w.mat(pose);
    w.i32(link);
}


fn record_type(kind: &str) -> Option<i32> {
    Some(match kind {
        "robot" => 2,
        "frame" => 3,
        "tool" => 4,
        "object" => 5,
        "target" => 6,
        "program" => 8,
        "python" => 10,
        "folder" => 17,
        "notes" => 22,
        _ => return None,
    })
}


pub fn julian_day(unix_seconds: i64) -> i64 {
    unix_seconds.div_euclid(86_400) + 2_440_588
}


pub struct Options {
    
    pub version: String,
    pub platform: String,
    
    pub julian_day: i64,
}



pub fn write_stream(station: &Value, payload: &[f32], opts: &Options) -> Result<(Vec<u8>, Value), String> {
    let items: Vec<&Value> = station.get("items").and_then(|a| a.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
    let st = items.iter().copied().find(|i| str_of(i, "kind") == "station");
    let st_index = st.map(|s| i64_of(s, "index", 0)).unwrap_or(0);

     
    let by_index: HashMap<i64, &Value> = items.iter().map(|i| (i64_of(i, "index", -1), *i)).collect();
    let mut skipped = Vec::new();
    let supported = |it: &Value| record_type(str_of(it, "kind")).is_some();
    let mut children: HashMap<i64, Vec<&Value>> = HashMap::new();
    for it in &items {
        let kind = str_of(it, "kind");
        if kind == "station" {
            continue;
        }
        if !supported(it) {
            skipped.push(json!({ "index": it.get("index"), "kind": kind, "name": it.get("name") }));
            continue;
        }
         
        let mut p = i64_of(it, "parent", st_index);
        for _ in 0..100_000 {
            if p == st_index || p < 0 {
                p = st_index;
                break;
            }
            match by_index.get(&p) {
                Some(pi) if supported(pi) => break,
                Some(pi) => p = i64_of(pi, "parent", st_index),
                None => {
                    p = st_index;
                    break;
                }
            }
        }
        children.entry(p).or_default().push(*it);
    }
     
    let mut order: Vec<(&Value, i32)> = Vec::new();
    let mut index_of: HashMap<i64, i32> = HashMap::new();
    let mut next = 1;
    fn walk<'a>(p: i64, depth: i32, children: &HashMap<i64, Vec<&'a Value>>, order: &mut Vec<(&'a Value, i32)>, index_of: &mut HashMap<i64, i32>, next: &mut i32) {
        for c in children.get(&p).map(|v| v.as_slice()).unwrap_or(&[]) {
            index_of.insert(i64_of(c, "index", -1), *next);
            *next += 1;
            order.push((c, depth));
            if str_of(c, "kind") == "program" {
                *next += c.get("instructions").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0) as i32;
            }
            walk(i64_of(c, "index", -1), depth + 1, children, order, index_of, next);
        }
    }
    walk(st_index, 1, &children, &mut order, &mut index_of, &mut next);
    index_of.insert(st_index, 0);
    let refmap = |v: Option<&Value>| -> i32 {
        match v.and_then(|x| x.as_i64()) {
            Some(r) if r >= 0 => index_of.get(&r).copied().unwrap_or(-1),
            _ => -1,
        }
    };

    let mut w = W { b: Vec::with_capacity(1 << 20) };
    w.text("Station File 01.01");
    let record = |w: &mut W, typ: i32, depth: i32| -> usize {
        w.text("lvl");
        w.i32(typ);
        w.i32(depth);
        let at = w.pos();
        w.i64(-1);
        at
    };

     
    {
        let at = record(&mut w, 1, 0);
        let empty = json!({});
        let s = st.unwrap_or(&empty);
        w.u8(bool_of(s, "visible", true) as u8);
        let name = s.get("name").and_then(|x| x.as_str()).or_else(|| station.get("name").and_then(|x| x.as_str())).unwrap_or("Station");
        w.text(name);
         
        w.i64(0);
        let params: Vec<(String, String)> = s
            .get("params")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().filter_map(|p| Some((p.get(0)?.as_str()?.to_string(), p.get(1).and_then(|x| x.as_str()).unwrap_or("").to_string()))).collect())
            .unwrap_or_default();
        w.i32(params.len() as i32);
        for (k, v) in &params {
            w.text(k);
            w.text_or_null(v);
        }
        w.f64(f64_of(s, "attach_distance", 200.0));
        w.i32(0);
        w.i32(0);
        w.u8(0);
         
        let data: Vec<(&str, Vec<u8>)> = s
            .get("data_params")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|p| Some((p.get(0)?.as_str()?, p.get(1)?.as_array()?.iter().map(|b| b.as_u64().unwrap_or(0) as u8).collect())))
                    .collect()
            })
            .unwrap_or_default();
        w.i32(data.len() as i32);
        for (k, b) in &data {
            w.text(k);
            w.qbytes(Some(b));
        }
         
        w.i64(0);
        w.text(&opts.version);
        w.text(&opts.platform);
        w.i64(0);
        w.i64(opts.julian_day);
         
        w.i64(0);
        w.u8(0);
        w.u8(1);
        w.i32(50_000_000);
        w.u8(0);
        let end = w.pos() as i64;
        w.patch_i64(at, end);
    }

    for (it, depth) in &order {
        let kind = str_of(it, "kind");
        let typ = record_type(kind).unwrap();
        let own = index_of[&i64_of(it, "index", -1)];
        let at = record(&mut w, typ, *depth);
        let name = str_of(it, "name");
        let visible = bool_of(it, "visible", true);
        match kind {
            "frame" => {
                w.text("FrameChkptStart");
                w.text(name);
                w.u8(visible as u8);
                w.mat(&mat4(it.get("pose")).unwrap_or(IDENTITY));
                w.text("FrameChkptEnd");
                w.qbytes(None);
                w.no_params();
            }
            "robot" => {
                let robot = it.get("robot").ok_or("robot without its robot data")?;
                let mut h = f64s(robot.get("header"));
                if h.len() != 4000 || (h[2] - 20.0).abs() > 0.5 || (h[3] - 200.0).abs() > 0.5 {
                    return Err(format!("robot '{name}' has no 20×200 robot header"));
                }
                put_text(&mut h, 20, 90, 100, name);
                if let Some(q) = it.get("joints").or_else(|| robot.get("joints")).and_then(|v| v.as_array()) {
                    for (j, v) in q.iter().enumerate().take(20) {
                        h[35 * 20 + j] = v.as_f64().unwrap_or(0.0);
                    }
                }
                h[47 * 20] = if visible { 1.0 } else { 0.0 };
                for v in &h {
                    w.f64(*v);
                }
                let links: Vec<&Value> = robot.get("links").and_then(|a| a.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
                let feats: Vec<&Value> = robot.get("features").and_then(|a| a.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
                w.i64(links.len() as i64);
                for (li, link) in links.iter().enumerate() {
                    let shapes = link.as_array().cloned().unwrap_or_default();
                    let f = features_of(feats.iter().copied().find(|f| i64_of(f, "link", -1) == li as i64));
                    mesh_object(&mut w, &shapes, payload, &f)?;
                }
                w.i32(refmap(it.get("active_frame")));
                w.i32(refmap(it.get("active_tool")));
                 
                let empty = json!({});
                let c = it.get("connection").unwrap_or(&empty);
                w.text(c.get("ip").and_then(|x| x.as_str()).unwrap_or("127.0.0.1"));
                w.i64(i64_of(c, "port", 2000));
                w.i64(5000);
                w.text(c.get("remotePath").and_then(|x| x.as_str()).unwrap_or("/"));
                w.text(str_of(c, "ftpUser"));
                w.text(str_of(c, "ftpPass"));
                w.text(str_of(c, "driver"));
                let sync: Vec<i32> = it.get("sync").and_then(|a| a.as_array()).map(|a| a.iter().map(|r| refmap(Some(r))).filter(|r| *r >= 0).collect()).unwrap_or_default();
                w.i32(sync.len() as i32);
                for r in sync {
                    w.i32(r);
                }
                 
                 
                 
                 
                 
                if let Some(tail) = it.get("record_tail").and_then(|t| t.as_array()) {
                    w.b.extend(tail.iter().map(|x| x.as_u64().unwrap_or(0) as u8));
                }
            }
            "tool" | "object" => {
                 
                let rows = 16;
                let mut h = vec![0.0; 1600];
                h[0] = 1.0;
                h[1] = 1600.0;
                h[2] = 16.0;
                h[3] = 100.0;
                h[rows] = if kind == "tool" { 1.0 } else { 0.0 };
                let g = mat4(it.get("geometry_pose")).unwrap_or(IDENTITY);
                put_mat(&mut h, rows, 2, &inv(&g));
                let feat = features_of(Some(*it));
                h[3 * rows] = visible as u8 as f64;
                h[3 * rows + 1] = (!feat.points.is_empty()) as u8 as f64;
                h[3 * rows + 2] = (!feat.curves.is_empty()) as u8 as f64;
                put_mat(&mut h, rows, 6, &mat4(it.get("pose")).unwrap_or(IDENTITY));
                h[9 * rows] = 1.0;
                put_mat(&mut h, rows, 10, &mat4(it.get("tcp")).unwrap_or(IDENTITY));
                put_text(&mut h, rows, 90, 100, name);
                for v in &h {
                    w.f64(*v);
                }
                let shapes = it.get("links").and_then(|l| l.as_array()).and_then(|l| l.first()).and_then(|s| s.as_array()).cloned().unwrap_or_default();
                mesh_object(&mut w, &shapes, payload, &feat)?;
                w.qstring(None);
                w.qstring(None);
                w.u8(0);
                w.qbytes(None);
                w.qstring(None);
                w.no_params();
                w.u8(bool_of(it, "locked", false) as u8);
            }
            "target" => {
                w.text(name);
                w.u8(visible as u8);
                w.i32(refmap(it.get("robot")));
                let joints = joints_of(it.get("joints"));
                target_data(&mut w, bool_of(it, "is_joint", false), bool_of(it, "unreachable", false), &joints, &mat4(it.get("pose")).unwrap_or(IDENTITY), own);
                w.no_params();
            }
            "program" => {
                w.text(name);
                w.qstring(None);
                 
                 
                let fl = f64s(it.get("flags"));
                let flag = |k: usize, d: f64| fl.get(k).copied().unwrap_or(d) as u8;
                w.u8(flag(0, 1.0));
                w.u8(flag(1, 0.0));
                w.u8(bool_of(it, "loop", false) as u8);
                w.u8(visible as u8);
                w.u8(flag(2, 0.0));
                w.i32(refmap(it.get("robot")));
                let list: Vec<&Value> = it.get("instructions").and_then(|a| a.as_array()).map(|a| a.iter().collect()).unwrap_or_default();
                w.i32(list.len() as i32);
                for (i, ins) in list.iter().enumerate() {
                    instruction(&mut w, i as i32, ins, &refmap)?;
                }
                w.u8(1);
                w.i32(0);
                w.no_params();
                w.u8(0);
                w.u8(0);
            }
            "folder" => {
                w.text(name);
                w.u8(visible as u8);
                w.no_params();
            }
            "notes" => {
                w.text(name);
                w.u8(visible as u8);
                w.text(str_of(it, "html"));
                w.no_params();
            }
            "python" => {
                w.text(name);
                w.u8(visible as u8);
                let code = str_of(it, "code").as_bytes();
                w.i64(code.len() as i64);
                w.b.extend_from_slice(code);
                w.no_params();
            }
            _ => unreachable!(),
        }
        let end = w.pos() as i64;
        w.patch_i64(at, end);
        if kind == "program" {
             
            let n = it.get("instructions").and_then(|a| a.as_array()).map(|a| a.len()).unwrap_or(0);
            for _ in 0..n {
                let at = record(&mut w, 9, depth + 1);
                let end = w.pos() as i64;
                w.patch_i64(at, end);
            }
        }
    }
    w.text("Station File End");
    w.text("STATION DATA");
    w.mat(&mat4(station.get("view")).unwrap_or(IDENTITY));
    w.i32(0);
    w.i32(0);
    w.text("STATION DATA END");
    w.text("TREE DATA");
    w.i32(0);
    w.text("END TREE DATA");
     
    w.i32(0xBD);
    w.i32(0);

    let indices: serde_json::Map<String, Value> = index_of.iter().map(|(k, v)| (k.to_string(), json!(v))).collect();
    Ok((w.b, json!({ "records": next, "indices": indices, "skipped": skipped })))
}



fn instruction(w: &mut W, i: i32, ins: &Value, refmap: &dyn Fn(Option<&Value>) -> i32) -> Result<(), String> {
    let mut typ = i64_of(ins, "type", 8) as i32;
    if typ == 12 || !(0..=11).contains(&typ) {
        typ = 8;
    }
    w.text("ins");
    w.i32(i);
    w.i32(typ);
    let at = w.pos();
    w.i64(-1);
    w.text(str_of(ins, "name"));
     
    let target = |w: &mut W, r: Option<&Value>, pose: Option<Mat4>, is_joint: bool, unreachable: bool, joints: &[f64]| {
        let r = refmap(r);
        if r >= 0 {
            w.i32(1);
            w.i32(r);
        } else if let Some(p) = pose {
            w.i32(2);
            target_data(w, is_joint, unreachable, joints, &p, -1);
        } else {
            w.i32(3);
        }
    };
    match typ {
        0 => {
            let mt = i64_of(ins, "move_type", 1) as i32;
            w.i32(mt);
            target(w, ins.get("target"), mat4(ins.get("pose")), bool_of(ins, "is_joint", false), bool_of(ins, "unreachable", false), &joints_of(ins.get("joints")));
            w.qstring(None);
            if mt == 5 {
                w.i32(0);
            }
        }
        1 => {
            w.i32(i64_of(ins, "move_type", 3) as i32);
            let refs: Vec<Value> = ins.get("refs").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            let poses: Vec<Value> = ins.get("poses").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            let joints: Vec<Value> = ins.get("joints").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            let unreach: Vec<Value> = ins.get("unreachable").and_then(|a| a.as_array()).cloned().unwrap_or_default();
            for k in 0..2 {
                let pose = mat4(poses.get(k));
                let r = if pose.is_some() { None } else { refs.get(k) };
                target(w, r, pose, false, unreach.get(k).and_then(|b| b.as_bool()).unwrap_or(false), &joints_of(joints.get(k)));
            }
            w.qstring(None);
        }
        2 => {
            let empty = json!({});
            let s = ins.get("speed").unwrap_or(&empty);
            let f = i64_of(s, "flags", 1);
            w.u8((f & 1 != 0) as u8);
            w.u8((f & 2 != 0) as u8);
            w.f64(f64_of(s, "linear", 0.0));
            w.f64(f64_of(s, "linear_accel", 0.0));
            w.qstring(None);
            w.u8((f & 4 != 0) as u8);
            w.u8((f & 8 != 0) as u8);
            w.f64(f64_of(s, "joint", 0.0));
            w.f64(f64_of(s, "joint_accel", 0.0));
        }
        3 | 4 => {
            w.i32(refmap(ins.get("ref")));
            w.u8(i64_of(ins, "flag", 0) as u8);
            w.mat(&mat4(ins.get("pose")).unwrap_or(IDENTITY));
            w.qstring(None);
        }
        5 => {
            w.i32(refmap(ins.get("ref")));
            w.qstring(None);
        }
        6 => {
            w.f64(f64_of(ins, "pause_ms", -1.0));
            w.qstring(None);
        }
        7 => {
            let empty = json!({});
            let e = ins.get("event").unwrap_or(&empty);
            w.i32(i64_of(e, "behavior", 0) as i32);
            w.i32(refmap(e.get("tool")));
            w.i32(refmap(e.get("frame")));
            let poses: Vec<Mat4> = e.get("poses").and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|p| mat4(Some(p))).collect()).unwrap_or_default();
            w.i32(poses.len() as i32);
            for p in &poses {
                w.mat(p);
            }
            for key in ["objects", "parents"] {
                let refs: Vec<i32> = e.get(key).and_then(|a| a.as_array()).map(|a| a.iter().map(|r| refmap(Some(r))).collect()).unwrap_or_default();
                w.i32(refs.len() as i32);
                for r in refs {
                    w.i32(r);
                }
            }
            w.qstring(None);
            w.i32(i64_of(e, "option", 0) as i32);
            w.f64(f64_of(e, "distance", 200.0));
        }
        8 => {
            w.i32(i64_of(ins, "code_type", 1) as i32);
            let text = ins.get("text").and_then(|x| x.as_str()).unwrap_or_else(|| str_of(ins, "name"));
            w.text(text);
            w.qstring(None);
        }
        9 => {
            w.text(str_of(ins, "text"));
            w.qstring(None);
        }
        10 => {
            w.f64(f64_of(ins, "rounding", -1.0));
            w.qstring(None);
        }
        11 => {
            let empty = json!({});
            let io = ins.get("io").unwrap_or(&empty);
            w.i32(if str_of(io, "mode") == "wait" { 1 } else { 0 });
            w.text(str_of(io, "name"));
            w.text(str_of(io, "value"));
            w.f64(f64_of(io, "timeout_ms", -1.0));
        }
        _ => unreachable!(),
    }
    let end = w.pos() as i64;
    w.patch_i64(at, end);
    Ok(())
}


pub fn qcompress(data: &[u8]) -> Vec<u8> {
    let z = miniz_oxide::deflate::compress_to_vec_zlib(data, 6);
    let mut out = Vec::with_capacity(4 + z.len());
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(&z);
    out
}


pub fn write(station: &Value, payload: &[f32], opts: &Options) -> Result<(Vec<u8>, Value), String> {
    let (stream, report) = write_stream(station, payload, opts)?;
    Ok((qcompress(&stream), report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rdkfile;

    fn opts() -> Options {
        Options { version: "test".into(), platform: "test".into(), julian_day: julian_day(1_760_000_000) }
    }

    fn parse(bytes: &[u8]) -> (Value, Vec<f32>) {
        let buf = rdkfile::parse(bytes).expect("parse");
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        let v: Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
        let mut off = 4 + n;
        off += (4 - off % 4) % 4;
        (v, buf[off..].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
    }

    
    const REFS: [&str; 10] = ["parent", "robot", "active_frame", "active_tool", "target", "ref", "tool", "frame", "objects", "parents"];

    fn remap(v: &Value, key: &str, map: &HashMap<i64, i64>) -> Value {
        let one = |x: &Value| match x.as_i64() {
            Some(r) if r >= 0 => json!(map.get(&r).copied().unwrap_or(-1)),
            _ => x.clone(),
        };
        match v {
            Value::Array(a) if key == "refs" || key == "objects" || key == "parents" || key == "sync" => Value::Array(a.iter().map(one).collect()),
            Value::Number(_) if REFS.contains(&key) => one(v),
            _ => v.clone(),
        }
    }

    
    
    fn same(a: &Value, b: &Value, tol: f64, path: &str, map: &HashMap<i64, i64>, out: &mut Vec<String>) {
        match (a, b) {
            (Value::Null, _) => {}
            (Value::Number(x), Value::Number(y)) => {
                let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
                if (x - y).abs() > tol * (1.0 + x.abs()) {
                    out.push(format!("{path}: {x} != {y}"));
                }
            }
            (Value::Array(x), Value::Array(y)) => {
                if x.len() != y.len() {
                    out.push(format!("{path}: length {} != {}", x.len(), y.len()));
                    return;
                }
                for (i, (p, q)) in x.iter().zip(y).enumerate() {
                    same(p, q, tol, &format!("{path}[{i}]"), map, out);
                }
            }
            (Value::Object(x), Value::Object(y)) => {
                for (k, p) in x {
                    let p = remap(p, k, map);
                    same(&p, y.get(k).unwrap_or(&Value::Null), tol, &format!("{path}.{k}"), map, out);
                }
            }
            _ if a == b => {}
            _ => out.push(format!("{path}: {a} != {b}")),
        }
    }

    
    fn shape_floats(shapes: &Value, payload: &[f32]) -> Vec<f32> {
        let mut out = Vec::new();
        for sh in shapes.as_array().into_iter().flatten() {
            let n = sh["triangles"].as_u64().unwrap() as usize * 9;
            for key in ["positions", "normals"] {
                let o = sh[key].as_u64().unwrap() as usize;
                out.extend_from_slice(&payload[o..o + n]);
            }
        }
        out
    }

    
    
    fn round_trip(bytes: &[u8]) -> (Vec<String>, usize) {
        let (v1, p1) = parse(bytes);
        let (out, report) = write(&v1, &p1, &opts()).expect("write");
        let (v2, p2) = parse(&out);
        let map: HashMap<i64, i64> = report["indices"].as_object().unwrap().iter().map(|(k, v)| (k.parse().unwrap(), v.as_i64().unwrap())).collect();
        let by2: HashMap<i64, &Value> = v2["items"].as_array().unwrap().iter().map(|i| (i["index"].as_i64().unwrap(), i)).collect();
         
        let all1: Vec<&Value> = v1["items"].as_array().unwrap().iter().chain(v1["skipped"].as_array().unwrap()).collect();
        let parent1: HashMap<i64, i64> = all1.iter().map(|i| (i["index"].as_i64().unwrap(), i["parent"].as_i64().unwrap())).collect();
        let mut diffs = Vec::new();
        let mut compared = 0;
        for it in v1["items"].as_array().unwrap() {
            let kind = it["kind"].as_str().unwrap();
            if kind != "station" && record_type(kind).is_none() {
                continue;
            }
            let old = it["index"].as_i64().unwrap();
            let Some(it2) = map.get(&old).and_then(|n| by2.get(n)) else {
                diffs.push(format!("{kind} '{}' not written", it["name"]));
                continue;
            };
            compared += 1;
            let mut a = it.clone();
            let o = a.as_object_mut().unwrap();
            o.remove("index");
            if kind == "station" {
                o.remove("parent");
            } else {
                let mut p = it["parent"].as_i64().unwrap();
                while p > 0 && !map.contains_key(&p) {
                    p = parent1.get(&p).copied().unwrap_or(0);
                }
                o.insert("parent".into(), json!(p.max(0)));
            }
            o.remove("depth");
            if kind == "robot" {
                 
                let h = o["robot"]["header"].as_array_mut().unwrap();
                for k in 90 * 20..95 * 20 {
                    h[k] = Value::Null;
                }
                o["robot"]["links"] = Value::Null;
            }
            for key in ["links"] {
                o.remove(key);
            }
            if let Some(list) = o.get_mut("instructions").and_then(|l| l.as_array_mut()) {
                for ins in list.iter_mut() {
                    if ins.get("error").is_some() {
                        *ins = Value::Null;
                    } else if ins["type"] == 12 {
                         
                        *ins = json!({ "index": ins["index"], "type": 8, "name": ins["name"], "code_type": 1, "text": ins["name"] });
                    }
                }
            }
            same(&a, it2, 1e-6, &format!("{kind} '{}'", it["name"].as_str().unwrap_or("")), &map, &mut diffs);
             
            let shapes = |i: &Value| -> Vec<Value> {
                if i["kind"] == "robot" {
                    i["robot"]["links"].as_array().unwrap().clone()
                } else {
                    i["links"].as_array().cloned().unwrap_or_default()
                }
            };
            let (s1, s2) = (shapes(it), shapes(it2));
            if s1.len() != s2.len() {
                diffs.push(format!("{kind} '{}': {} links != {}", it["name"], s1.len(), s2.len()));
            }
            for (l1, l2) in s1.iter().zip(&s2) {
                let (f1, f2) = (shape_floats(l1, &p1), shape_floats(l2, &p2));
                if f1.len() != f2.len() || f1.iter().zip(&f2).any(|(x, y)| (x - y).abs() > 1e-5) {
                    diffs.push(format!("{kind} '{}': mesh differs", it["name"]));
                }
                for (a, b) in l1.as_array().unwrap().iter().zip(l2.as_array().unwrap()) {
                    if a["rgba"] != b["rgba"] || a["triangles"] != b["triangles"] {
                        diffs.push(format!("{kind} '{}': shape colour or size differs", it["name"]));
                    }
                }
            }
        }
        same(&v1["view"], &v2["view"], 1e-12, "view", &map, &mut diffs);
        (diffs, compared)
    }

    fn header(h: &mut [f64]) {
        h[0] = 1.0;
        h[1] = 4000.0;
        h[2] = 20.0;
        h[3] = 200.0;
        h[20] = 1.0;  
        h[21] = 6.0;  
    }

    
    #[test]
    fn synthetic_station_round_trip() {
        let mut h = vec![0.0; 4000];
        header(&mut h);
        let tri = |z: f32| vec![0.0, 0.0, z, 100.0, 0.0, z, 0.0, 100.0, z];
        let mut payload: Vec<f32> = Vec::new();
        payload.extend(tri(0.0));
        payload.extend([0.0, 0.0, 1.0].repeat(3));
        payload.extend(tri(5.0));
        payload.extend([0.0, 1.0, 0.0].repeat(3));
        let shape = |at: usize| json!({ "triangles": 1, "rgba": [0.5, 0.25, 1.0, 1.0], "positions": at, "normals": at + 9 });
        let pose = |x: f64| json!([1.0, 0.0, 0.0, x, 0.0, 0.0, -1.0, 2.0, 0.0, 1.0, 0.0, 3.0, 0.0, 0.0, 0.0, 1.0]);
        let prog_ins = json!([
                    { "index": 0, "type": 3, "name": "Set Ref.", "ref": 7, "flag": 0, "pose": pose(800.0) },
                    { "index": 1, "type": 4, "name": "Set Tool", "ref": 3, "flag": 1, "pose": pose(120.0) },
                    { "index": 2, "type": 2, "name": "Speed 100 mm/s", "speed": { "flags": 5, "linear": 100.0, "linear_accel": 0.0, "joint": 30.0, "joint_accel": 0.0 } },
                    { "index": 3, "type": 0, "name": "MoveJ Home", "move_type": 1, "target": 8 },
                    { "index": 4, "type": 0, "name": "MoveL 2", "move_type": 2, "target": -1, "is_joint": false, "unreachable": false, "joints": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], "pose": pose(3.0) },
                    { "index": 5, "type": 1, "name": "MoveC", "move_type": 3, "refs": [9, -1], "poses": [null, pose(4.0)], "joints": [null, [6.0, 5.0, 4.0, 3.0, 2.0, 1.0]], "unreachable": [false, false] },
                    { "index": 6, "type": 6, "name": "Pause 500 ms", "pause_ms": 500.0 },
                    { "index": 7, "type": 7, "name": "Attach to Gripper", "event": { "behavior": 0, "tool": 3, "frame": 7, "objects": [5], "poses": [], "parents": [], "option": 2, "distance": 150.0 } },
                    { "index": 8, "type": 8, "name": "Call Sub", "code_type": 0, "text": "Sub" },
                    { "index": 9, "type": 9, "name": "Print: hi", "text": "hi" },
                    { "index": 10, "type": 10, "name": "Rounding 5 mm", "rounding": 5.0 },
                    { "index": 11, "type": 11, "name": "Wait IO_2=1", "io": { "mode": "wait", "name": "IO_2", "value": "1", "timeout_ms": 1500.0 } },
                    { "index": 12, "type": 5, "name": "Select robot", "ref": 2 }
        ]);
        let st = json!({
            "name": "Cell",
            "view": pose(-500.0),
            "items": [
                { "index": 0, "parent": -1, "kind": "station", "name": "Cell", "visible": true, "params": [["SizeBox", "150, 200, 150"], ["Empty", ""]], "attach_distance": 300.0, "data_params": [["Blob", [1, 2, 3]]] },
                { "index": 1, "parent": 0, "kind": "frame", "name": "Base", "visible": true, "pose": pose(10.0) },
                { "index": 2, "parent": 1, "kind": "robot", "name": "Arm", "visible": true, "joints": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], "active_frame": 7, "active_tool": 3,
                  "robot": { "header": h, "links": [[shape(0)], [], [shape(18)]] } },
                { "index": 3, "parent": 2, "kind": "tool", "name": "Gripper", "visible": true, "pose": pose(0.0), "tcp": pose(120.0), "links": [[shape(18)]], "locked": true,
                  "geometry_pose": pose(7.0) },
                { "index": 4, "parent": 0, "kind": "folder", "name": "Parts", "visible": false },
                { "index": 5, "parent": 4, "kind": "object", "name": "Part", "visible": true, "pose": pose(400.0), "links": [[shape(0), shape(18)]],
                  "points": [[1.0, 2.0, 3.0, 0.0, 0.0, 1.0]], "point_names": ["P1"],
                  "curves": [{ "name": "Edge", "rgba": [1.0, 0.0, 0.0, 1.0], "points": [[0.0, 0.0, 0.0, 0.0, 0.0, 1.0], [10.0, 0.0, 0.0, 0.0, 0.0, 1.0]] }] },
                { "index": 6, "parent": 0, "kind": "notes", "name": "Notes", "visible": true, "html": "<b>hello</b>" },
                { "index": 7, "parent": 1, "kind": "frame", "name": "Table", "visible": true, "pose": pose(800.0) },
                { "index": 8, "parent": 7, "kind": "target", "name": "Home", "visible": true, "robot": 2, "is_joint": true, "unreachable": false, "joints": [0.0, -90.0, 90.0, 0.0, 90.0, 0.0], "pose": pose(1.0) },
                { "index": 9, "parent": 7, "kind": "target", "name": "Approach", "visible": true, "robot": 2, "is_joint": false, "unreachable": true, "joints": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], "pose": pose(2.0) },
                { "index": 10, "parent": 0, "kind": "program", "name": "Main", "visible": true, "loop": true, "robot": 2, "instructions": prog_ins },
                { "index": 11, "parent": 0, "kind": "python", "name": "Script", "visible": true, "code": "print('é')\n" }
            ]
        });
        let (bytes, report) = write(&st, &payload, &opts()).unwrap();
         
        assert_eq!(report["records"], 25);
        let (diffs, n) = round_trip(&bytes);
        assert!(diffs.is_empty(), "{diffs:#?}");
        assert_eq!(n, 12);
        let (v, _) = parse(&bytes);
        let items = v["items"].as_array().unwrap();
        let get = |name: &str| items.iter().find(|i| i["name"] == name).unwrap().clone();
         
        assert_eq!(get("Cell")["params"], json!([["SizeBox", "150, 200, 150"], ["Empty", ""]]));
        assert_eq!(get("Cell")["data_params"], json!([["Blob", [1, 2, 3]]]));
        assert_eq!(get("Cell")["attach_distance"], 300.0);
        assert_eq!(get("Arm")["robot"]["joints"], json!([1.0, 2.0, 3.0, 4.0, 5.0, 6.0]));
        assert_eq!(get("Arm")["active_tool"], get("Gripper")["index"]);
        assert_eq!(get("Gripper")["geometry_pose"], pose(7.0));
        assert_eq!(get("Gripper")["locked"], true);
        assert_eq!(get("Part")["curves"][0]["points"][1], json!([10.0, 0.0, 0.0, 0.0, 0.0, 1.0]));
        assert_eq!(get("Part")["point_names"], json!(["P1"]));
        assert_eq!(get("Script")["code"], "print('é')\n");
        let main = get("Main");
        let ins = main["instructions"].as_array().unwrap();
        assert_eq!(ins[3]["target"], get("Home")["index"]);
        assert_eq!(ins[11]["io"], json!({ "mode": "wait", "name": "IO_2", "value": "1", "timeout_ms": 1500.0 }));
        assert_eq!(ins[7]["event"]["objects"], json!([get("Part")["index"]]));
        assert_eq!(v["file_info"]["flags"], 0);
        assert_eq!(v["file_info"]["min_build"], 0);
         
        let raw = robotfile_inflate(&bytes);
        let tail: Vec<u8> = [0xBDi32.to_le_bytes(), 0i32.to_le_bytes()].concat();
        assert!(raw.ends_with(&tail));
        let marker: Vec<u8> = "END TREE DATA".encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
        assert_eq!(raw.len() - tail.len() - marker.len(), raw.windows(marker.len()).rposition(|w| w == marker.as_slice()).unwrap());
    }

    fn robotfile_inflate(b: &[u8]) -> Vec<u8> {
        crate::robotfile::inflate(b).unwrap()
    }

    #[test]
    fn normals_re_encode_to_the_same_bytes() {
        for b0 in (0..=255u8).step_by(5) {
            for b1 in (0..=255u8).step_by(7) {
                let th = b0 as f64 * std::f64::consts::PI / 255.0;
                let ph = b1 as f64 * 2.0 * std::f64::consts::PI / 255.0;
                let n = [(th.sin() * ph.cos()) as f32, (th.sin() * ph.sin()) as f32, th.cos() as f32];
                let [c0, c1] = encode_normal(n);
                assert_eq!(c0, b0);
                if b0 != 0 && b0 != 255 && b1 != 255 {
                    assert_eq!(c1, b1, "b0 {b0}");
                }
            }
        }
    }

    
    
    
    
    #[test]
    fn mirror_stations_round_trip() {
        let Some(dir) = crate::testlib::library_kind_dir("stations") else { return };
        let mut files: Vec<_> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "rdk")).collect();
        files.sort();
        let (mut stations, mut items, mut bad) = (0, 0, Vec::new());
        for f in files {
            let (diffs, n) = round_trip(&std::fs::read(&f).unwrap());
            stations += 1;
            items += n;
            if !diffs.is_empty() {
                bad.push(format!("{}: {:?}", f.display(), &diffs[..diffs.len().min(5)]));
            }
        }
        assert!(bad.is_empty(), "{} of {stations} stations differ:\n{}", bad.len(), bad.join("\n"));
        eprintln!("[rdkwrite] {stations} stations, {items} items round-tripped");
    }
}
