


































use crate::robotfile;
use serde::Serialize;
use serde_json::{json, Value};

struct Cur<'a> {
    b: &'a [u8],
    o: usize,
}

impl<'a> Cur<'a> {
    fn need(&self, n: usize) -> Result<(), String> {
        if self.o + n > self.b.len() {
            Err("unexpected end of station data".into())
        } else {
            Ok(())
        }
    }
    fn u8(&mut self) -> Result<u8, String> {
        self.need(1)?;
        let v = self.b[self.o];
        self.o += 1;
        Ok(v)
    }
    fn boolean(&mut self) -> Result<bool, String> {
        Ok(self.u8()? != 0)
    }
    fn i32(&mut self) -> Result<i32, String> {
        self.need(4)?;
        let v = i32::from_le_bytes(self.b[self.o..self.o + 4].try_into().unwrap());
        self.o += 4;
        Ok(v)
    }
    fn i64(&mut self) -> Result<i64, String> {
        self.need(8)?;
        let v = i64::from_le_bytes(self.b[self.o..self.o + 8].try_into().unwrap());
        self.o += 8;
        Ok(v)
    }
    fn f64(&mut self) -> Result<f64, String> {
        self.need(8)?;
        let v = f64::from_le_bytes(self.b[self.o..self.o + 8].try_into().unwrap());
        self.o += 8;
        Ok(v)
    }
    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.need(n)?;
        self.o += n;
        Ok(())
    }
    fn qstring(&mut self) -> Result<Option<String>, String> {
        self.need(4)?;
        let n = u32::from_le_bytes(self.b[self.o..self.o + 4].try_into().unwrap());
        self.o += 4;
        if n == 0xFFFF_FFFF {
            return Ok(None);
        }
        let n = n as usize;
        if !n.is_multiple_of(2) {
            return Err("bad string length".into());
        }
        self.need(n)?;
        let u: Vec<u16> = self.b[self.o..self.o + n].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        self.o += n;
        Ok(Some(String::from_utf16_lossy(&u)))
    }
    fn string(&mut self) -> Result<String, String> {
        Ok(self.qstring()?.unwrap_or_default())
    }
    
    fn mat(&mut self) -> Result<Vec<f64>, String> {
        let mut c = [0.0; 16];
        for v in c.iter_mut() {
            *v = self.f64()?;
        }
        Ok(col_to_row(&c))
    }
}

fn col_to_row(c: &[f64]) -> Vec<f64> {
    let mut m = vec![0.0; 16];
    for col in 0..4 {
        for row in 0..4 {
            m[row * 4 + col] = c[col * 4 + row];
        }
    }
    m
}




fn skip_mesh_object(cur: &mut Cur, uv: bool) -> Result<(), String> {
    let ns = cur.i64()?;
    if !(0..=10_000_000).contains(&ns) {
        return Err(format!("bad shape count {ns}"));
    }
    for _ in 0..ns {
        let nt = cur.i64()?;
        if nt < 0 {
            return Err("bad triangle count".into());
        }
        cur.skip(16 + nt as usize * 42)?;
        if uv {
            let tex = cur.i64()?;
            if tex != 0 && nt > 0 {
                cur.skip(nt as usize * 24)?;
            }
        }
    }
    let npt = cur.i64()?;
    for _ in 0..npt.max(0) {
        cur.qstring()?;
        cur.skip(14 * 4)?;
    }
    let ncv = cur.i64()?;
    for _ in 0..ncv.max(0) {
        let n = cur.i64()?;
        cur.qstring()?;
        cur.skip(16 + n.max(0) as usize * 13 * 4)?;
    }
    Ok(())
}

#[derive(Serialize, Default)]
struct Counts {
    records: usize,
    imported: usize,
    skipped: usize,
}




struct Be<'a> {
    b: &'a [u8],
    o: usize,
}

impl<'a> Be<'a> {
    fn take<const N: usize>(&mut self) -> Result<[u8; N], String> {
        let v: [u8; N] = self.b.get(self.o..self.o + N).ok_or("unexpected end of project settings")?.try_into().unwrap();
        self.o += N;
        Ok(v)
    }
    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take::<1>()?[0])
    }
    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_be_bytes(self.take::<8>()?))
    }
    fn qstring(&mut self) -> Result<String, String> {
        let n = u32::from_be_bytes(self.take::<4>()?);
        if n == 0xFFFF_FFFF {
            return Ok(String::new());
        }
        let raw = self.b.get(self.o..self.o + n as usize).ok_or("bad string in project settings")?;
        self.o += n as usize;
        Ok(String::from_utf16_lossy(&raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect::<Vec<u16>>()))
    }
}



































fn read_machining(slice: &[u8], item: &mut Value, payload: &mut Vec<f32>) -> Result<(), String> {
    let mut c = Cur { b: slice, o: 0 };
    if c.string()? != "MachiningChkptStart" {
        return Err("machining checkpoint missing".into());
    }
    item["name"] = json!(c.string()?);
    item["flag"] = json!(c.u8()?);
    for key in ["robot", "frame", "tool", "object", "program"] {
        item[key] = json!(c.i32()?);
    }
    item["input_file"] = json!(c.qstring()?);
    c.u8()?;
    item["project_kind"] = json!(c.i32()?);
    let n = c.i64()?;
    if n < 0 || n as usize > c.b.len().saturating_sub(c.o) / 12 {
        return Err(format!("bad path item count {n}"));
    }
    let mut path = Vec::new();
    for _ in 0..n {
        let (index, flag) = (c.i64()?, c.i32()?);
         
        path.push(json!([index, 0, flag]));
    }
    item["path_items"] = json!(path);
    let mut poses = serde_json::Map::new();
    for key in ["frame_offset", "tool_orientation", "path_to_tool"] {
        let bytes = qbytes(&mut c)?;
        if let Some(p) = pose_formula(bytes) {
            poses.insert(key.into(), p);
        }
    }
    item["poses"] = Value::Object(poses);
    let mut s = serde_json::Map::new();
    let mut put = |k: &str, v: Value| {
        s.insert(k.to_string(), v);
    };
    put("Algorithm", json!(c.i32()?));
    for key in ["OrientXaxis", "OrientXaxis2"] {
        for axis in ["X", "Y", "Z"] {
            put(&format!("{key}_{axis}"), json!(c.f64()?));
        }
    }
    put("FollowAngleOn", json!(c.u8()?));
    put("FollowStepOn", json!(c.u8()?));
    for key in ["FollowAngle", "FollowStep", "RotZ_Range", "RotZ_Step"] {
        put(key, json!(c.f64()?));
    }
    let mut extra = serde_json::Map::new();
    extra.insert("field_b58".into(), json!(c.i32()?));
    extra.insert("result".into(), json!(c.f64()?));
    put("AutoUpdate", json!(c.u8()?));
    item["approach"] = json!(columns4(&mut c)?);
    item["retract"] = json!(columns4(&mut c)?);
    for key in ["apt_input", "apt_path", "robot_path"] {
        item[key] = mat2d(&mut c, payload)?;
    }
    item["start_configs"] = mat2d_json(&mut c)?;
    if c.string()? != "MachiningChkptEnd" {
        return Err("machining end checkpoint missing".into());
    }
    let more = |c: &Cur| c.o < c.b.len();
    if more(&c) {
        let events = qbytes(&mut c)?;
        item["events"] = read_events(events)?;
        extra.insert("orient_tol".into(), json!(c.f64()?));
        put("TurntableActive", json!(c.f64()?));
        put("TurntableOffset", json!(c.f64()?));
        put("AvoidCollisions", json!(c.u8()?));
        let nj = c.i32()?;
        let mut joints = Vec::new();
        for _ in 0..nj.clamp(0, 64) {
            joints.push(c.f64()?);
        }
        extra.insert("start_joints".into(), json!(joints));
    }
    if more(&c) {
        put("ApproachRetractAll", json!(c.u8()?));
        put("PointApproach", json!(c.f64()?));
    }
    if more(&c) {
        put("TrackActive", json!(c.f64()?));
        put("TrackOffset", json!(c.f64()?));
    }
    if more(&c) {
        put("JoinCurvesTol", json!(c.f64()?));
    }
    if more(&c) {
        put("RapidApproachRetract", json!(c.f64()?));
        put("SpeedOperation", json!(c.f64()?));
    }
    if more(&c) {
        let mut colors = Vec::new();
        for _ in 0..8 {
            colors.push(c.f64()?);
        }
        extra.insert("colors".into(), json!(colors));
    }
    if more(&c) {
        put("TurntableRZcomp", json!(c.f64()?));
        for axis in ["X", "Y", "Z"] {
            put(&format!("TrackVector_{axis}"), json!(c.f64()?));
        }
    }
    if more(&c) {
        put("VisibleNormals", json!(c.i32()?));
    }
    if more(&c) {
        qbytes(&mut c)?;
    }
    if more(&c) {
        put("FollowRealignOn", json!(c.u8()?));
        put("FollowRealign", json!(c.f64()?));
    }
    if more(&c) {
        let nl = c.i32()?;
        for _ in 0..nl.clamp(0, 10_000) {
            c.qstring()?;
            qbytes(&mut c)?;
        }
    }
    if more(&c) {
         
        let weld = qbytes(&mut c)?;
        let mut v = [0.0, 0.0, 30.0, 0.0, 30.0, 0.0, 0.0, 0.0];
        if weld.len() >= 64 {
            let mut be = Be { b: weld, o: 0 };
            for x in v.iter_mut() {
                *x = be.f64()?;
            }
        }
        for (key, x) in ["CutStartMM", "CutEndMM", "FlareStartDeg", "FlareStartMM", "FlareEndDeg", "FlareEndMM", "OffsetSideMM", "OffsetNormalMM"].iter().zip(v) {
            put(key, json!(x));
        }
    }
    if more(&c) {
        extra.insert("cam_geo".into(), json!(c.u8()?));
    }
     
    if let Some(r) = item.get("events").and_then(|e| e.get("RapidSpeed")).cloned() {
        put("SpeedRapid", r);
    }
    item["settings"] = Value::Object(s);
    item["extra"] = Value::Object(extra);
    Ok(())
}





fn object_locked(slice: &[u8], header_bytes: usize, uv: bool) -> bool {
    let read = || -> Result<bool, String> {
        let mut c = Cur { b: slice, o: header_bytes };
        skip_mesh_object(&mut c, uv)?;
        let more = |c: &Cur| c.o < c.b.len();
        if !more(&c) {
            return Ok(false);
        }
        c.qstring()?;
        if !more(&c) {
            return Ok(false);
        }
        c.qstring()?;
        if !more(&c) {
            return Ok(false);
        }
        c.u8()?;
        if !more(&c) {
            return Ok(false);
        }
        qbytes(&mut c)?;
        if !more(&c) {
            return Ok(false);
        }
        c.qstring()?;
        if !more(&c) {
            return Ok(false);
        }
        let n = c.i32()?;
        for _ in 0..n.clamp(0, 100_000) {
            c.qstring()?;
            qbytes(&mut c)?;
        }
        if !more(&c) {
            return Ok(false);
        }
        Ok(c.u8()? != 0)
    };
    read().unwrap_or(false)
}


fn qbytes<'a>(c: &mut Cur<'a>) -> Result<&'a [u8], String> {
    let n = c.i32()?;
    if n < 0 {
        return Ok(&[]);
    }
    c.need(n as usize)?;
    let b = &c.b[c.o..c.o + n as usize];
    c.o += n as usize;
    Ok(b)
}



fn pose_formula(b: &[u8]) -> Option<Value> {
    let mut be = Be { b, o: 0 };
    let mut m = [0.0; 16];
    for v in m.iter_mut() {
        *v = be.f64().ok()?;
    }
    let mut out = json!({ "pose": col_to_row(&m) });
    if let Ok(mode) = be.take::<4>() {
        out["mode"] = json!(i32::from_be_bytes(mode));
        if be.qstring().is_ok() {
            if let Ok(f) = be.qstring() {
                out["formula"] = json!(f);
            }
        }
    }
    Some(out)
}


fn mat2d_header(c: &mut Cur) -> Result<(usize, usize), String> {
    let dims = c.i32()?;
    let (rows, cols) = (c.i32()?, c.i32()?);
    if dims != 2 || rows < 0 || cols < 0 {
        return Err(format!("bad matrix {dims}:{rows}x{cols}"));
    }
    c.need(rows as usize * cols as usize * 8)?;
    Ok((rows as usize, cols as usize))
}



fn mat2d(c: &mut Cur, payload: &mut Vec<f32>) -> Result<Value, String> {
    let (rows, cols) = mat2d_header(c)?;
    let at = payload.len();
    for k in 0..rows * cols {
        let bits = u64::from_le_bytes(c.b[c.o + 8 * k..c.o + 8 * k + 8].try_into().unwrap());
        payload.push(f32::from_bits(bits as u32));
        payload.push(f32::from_bits((bits >> 32) as u32));
    }
    c.o += rows * cols * 8;
    Ok(json!({ "rows": rows, "cols": cols, "at": at }))
}


fn mat2d_json(c: &mut Cur) -> Result<Value, String> {
    let (rows, cols) = mat2d_header(c)?;
    let mut data = Vec::with_capacity(rows * cols);
    for _ in 0..rows * cols {
        data.push(c.f64()?);
    }
    Ok(json!({ "rows": rows, "cols": cols, "data": data }))
}




fn columns4(c: &mut Cur) -> Result<Vec<Vec<f64>>, String> {
    let (rows, cols) = mat2d_header(c)?;
    let mut out = Vec::with_capacity(cols);
    for _ in 0..cols {
        let mut col = Vec::with_capacity(rows);
        for _ in 0..rows {
            col.push(c.f64()?);
        }
        out.push(col);
    }
    Ok(out)
}





fn read_events(bytes: &[u8]) -> Result<Value, String> {
    let mut be = Be { b: bytes, o: 0 };
    let mut ev = serde_json::Map::new();
    let mut call = |be: &mut Be, key: &str| -> Result<(), String> {
        ev.insert(format!("{key}On"), json!(be.u8()? as i32));
        ev.insert(key.to_string(), json!(be.qstring()?));
        Ok(())
    };
    for key in ["CallProgStart", "CallPathStart", "CallApproach", "CallAction", "CallRetract", "CallProgFinish"] {
        call(&mut be, key)?;
    }
    let mut strings = Vec::new();
    for _ in 0..9 {
        strings.push(be.qstring()?);
    }
    call(&mut be, "CallPathFinish")?;
    for (key, v) in ["SpindleRPM", "SpindleCW", "SpindleCCW", "ToolChange", "Extruder", "IO_On", "IO_Off", "IO_OnMotion", "IO_OffMotion"].iter().zip(strings) {
        ev.insert(key.to_string(), json!(v));
    }
    ev.insert("RapidSpeed".into(), json!(be.f64()?));
    ev.insert("RoundingOn".into(), json!(be.u8()? as i32));
    ev.insert("Rounding".into(), json!(be.f64()?));
    ev.insert("Mcode".into(), json!(be.qstring()?));
    Ok(Value::Object(ev))
}

fn parse_robotfile_slice(slice: &[u8], payload: &mut Vec<f32>, uv: bool) -> Result<Value, String> {
    let buf = robotfile::parse_with_uv(slice, uv)?;
    let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
    let mut v: Value = serde_json::from_slice(&buf[4..4 + n]).map_err(|e| e.to_string())?;
    let mut off = 4 + n;
    off += (4 - off % 4) % 4;
    let base = payload.len();
    payload.extend(buf[off..].chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])));
    if let Some(links) = v.get_mut("links").and_then(|l| l.as_array_mut()) {
        for link in links {
            if let Some(shapes) = link.as_array_mut() {
                for sh in shapes {
                    for key in ["positions", "normals"] {
                        if let Some(p) = sh.get(key).and_then(|x| x.as_u64()) {
                            sh[key] = json!(p as usize + base);
                        }
                    }
                }
            }
        }
    }
    Ok(v)
}

fn header_cell(slice: &[u8], rows: usize, c: usize, r: usize) -> f64 {
    let i = (c * rows + r) * 8;
    if i + 8 > slice.len() {
        return 0.0;
    }
    f64::from_le_bytes(slice[i..i + 8].try_into().unwrap())
}

fn header_mat(slice: &[u8], rows: usize, col: usize) -> Vec<f64> {
    let c: Vec<f64> = (0..16).map(|r| header_cell(slice, rows, col, r)).collect();
    col_to_row(&c)
}



fn read_instruction(cur: &mut Cur, version: i32, base: usize) -> Result<Value, String> {
    let _marker = cur.qstring()?;  
    let index = cur.i32()?;
    let typ = cur.i32()?;
    let end = if version > 100 { Some(cur.i64()?) } else { None };
    let start = cur.o;
    let name = cur.string()?;
    let mut ins = json!({ "index": index, "type": typ, "name": name });
    let res: Result<(), String> = (|| {
        match typ {
            0 => {
                 
                 
                let move_type = cur.i32()?;
                let mode = cur.i32()?;
                ins["move_type"] = json!(move_type);
                if mode == 2 {
                     
                    let is_joint = cur.boolean()?;
                    let unreachable = cur.boolean()?;
                    let nj = cur.i32()?;
                    let mut joints = Vec::new();
                    for _ in 0..nj.clamp(0, 64) {
                        joints.push(cur.f64()?);
                    }
                    ins["is_joint"] = json!(is_joint);
                    ins["unreachable"] = json!(unreachable);
                    ins["joints"] = json!(joints);
                    ins["pose"] = json!(cur.mat()?);
                    ins["target"] = json!(-1);
                } else {
                    ins["target"] = json!(cur.i32()?);
                }
            }
            1 => {
                 
                 
                 
                ins["move_type"] = json!(cur.i32()?);
                let (mut refs, mut poses, mut joints, mut unreachable) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
                for _ in 0..2 {
                    match cur.i32()? {
                        2 => {
                            let _is_joint = cur.boolean()?;
                            unreachable.push(cur.boolean()?);
                            let nj = cur.i32()?;
                            let mut q = Vec::new();
                            for _ in 0..nj.clamp(0, 64) {
                                q.push(cur.f64()?);
                            }
                            poses.push(json!(cur.mat()?));
                            joints.push(json!(q));
                            refs.push(cur.i32()?);
                        }
                        _ => {
                            refs.push(cur.i32()?);
                            poses.push(Value::Null);
                            joints.push(Value::Null);
                            unreachable.push(false);
                        }
                    }
                }
                ins["refs"] = json!(refs);
                ins["poses"] = json!(poses);
                ins["joints"] = json!(joints);
                ins["unreachable"] = json!(unreachable);
            }
            2 => {
                 
                 
                 
                 
                let (lin_on, lacc_on) = (cur.u8()?, cur.u8()?);
                let speed = cur.f64()?;
                let accel = cur.f64()?;
                let _unknown = cur.i32()?;
                let (j_on, jacc_on) = (cur.u8()?, cur.u8()?);
                let jspeed = cur.f64()?;
                let jaccel = cur.f64()?;
                let flags = (lin_on != 0) as i32 | ((lacc_on != 0) as i32) << 1 | ((j_on != 0) as i32) << 2 | ((jacc_on != 0) as i32) << 3;
                ins["speed"] = json!({ "flags": flags, "linear": speed, "linear_accel": accel, "joint": jspeed, "joint_accel": jaccel });
            }
            3..=5 => {
                let r = cur.i32()?;
                ins["ref"] = json!(r);
                if typ != 5 {
                     
                     
                    ins["flag"] = json!(cur.u8()?);
                    ins["pose"] = json!(cur.mat()?);
                }
            }
            6 => ins["pause_ms"] = json!(cur.f64()?),
            7 => {
                 
                 
                 
                 
                 
                let behavior = cur.i32()?;
                let tool = cur.i32()?;
                let frame = cur.i32()?;
                let count = |cur: &mut Cur, size: usize| -> Result<usize, String> {
                    let n = cur.i32()?;
                    if n < 0 || n as usize > (cur.b.len() - cur.o) / size {
                        return Err(format!("bad event list length {n}"));
                    }
                    Ok(n as usize)
                };
                let mut poses = Vec::new();
                for _ in 0..count(&mut *cur, 128)? {
                    poses.push(cur.mat()?);
                }
                let mut objects = Vec::new();
                for _ in 0..count(&mut *cur, 4)? {
                    objects.push(cur.i32()?);
                }
                let mut parents = Vec::new();
                if cur.o + 4 <= cur.b.len() {
                    for _ in 0..count(&mut *cur, 4)? {
                        parents.push(cur.i32()?);
                    }
                }
                let (option, distance) = if cur.o + 16 <= cur.b.len() {
                    cur.i32()?;
                    (Some(cur.i32()?), Some(cur.f64()?))
                } else {
                    (None, None)
                };
                ins["event"] = json!({ "behavior": behavior, "tool": tool, "frame": frame, "objects": objects, "poses": poses, "parents": parents, "option": option, "distance": distance });
            }
            8 => {
                let code_type = cur.i32()?;
                let text = cur.string()?;
                ins["code_type"] = json!(code_type);
                ins["text"] = json!(text);
            }
            9 => {
                 
                if let Ok(Some(t)) = cur.qstring() {
                    ins["text"] = json!(t);
                }
            }
            10 => ins["rounding"] = json!(cur.f64()?),
            11 => {
                 
                 
                let mode = cur.i32()?;
                let name = cur.string()?;
                let value = cur.string()?;
                let timeout = cur.f64()?;
                ins["io"] = json!({ "mode": if mode == 1 { "wait" } else { "set" }, "name": name, "value": value, "timeout_ms": timeout });
            }
            _ => {}
        }
        Ok(())
    })();
    if let Err(e) = res {
        ins["error"] = json!(e);
    }
    match end {
        Some(e) if e as usize >= base + start && e as usize - base <= cur.b.len() => cur.o = e as usize - base,
        Some(_) => return Err("bad instruction end offset".into()),
        None => {
            if ins.get("error").is_some() {
                return Err("instruction layout unknown in an old station file".into());
            }
        }
    }
    Ok(ins)
}


pub fn parse(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let data = robotfile::inflate(bytes)?;
    let mut cur = Cur { b: &data, o: 0 };
    let header = cur.string()?;
    if !header.starts_with("Station File ") {
        return Err("Problems reading file: The Enginuity Station file is corrupted or there's not enough available space. Errors will follow.".into());
    }
    let version = (header["Station File ".len()..].trim().parse::<f64>().unwrap_or(1.0) * 100.0).round() as i32;

    let mut items: Vec<Value> = Vec::new();
    let mut skipped: Vec<Value> = Vec::new();
    let mut payload: Vec<f32> = Vec::new();
    let mut counts = Counts::default();
    let mut station_name = String::new();
     
    let mut stack: Vec<i64> = vec![-1];
    let mut index: i64 = -1;
     
    let mut uv = false;
    let mut file_info = Value::Null;

    loop {
        let rec_start = cur.o;
        let tag = cur.qstring()?;
        if tag.as_deref() != Some("lvl") {
            cur.o = rec_start;
            break;
        }
        index += 1;
        counts.records += 1;
        let typ = cur.i32()?;
        let depth = cur.i32()?;
        let end = cur.i64()?;
        let p = cur.o;
         
        if end < p as i64 || end as usize > data.len() {
            return Err(format!("Problems reading file (invalid position for record {index})"));
        }
        let end = end as usize;
        let d = depth.max(0) as usize;
        let parent = if d < stack.len() { stack[d] } else { -1 };
        stack.truncate(d + 1);
        stack.push(index);
        let slice = &data[p..end];
        let mut rc = Cur { b: slice, o: 0 };

        let mut item = json!({ "index": index, "type": typ, "parent": parent, "depth": depth });
        let result: Result<bool, String> = (|| {
            match typ {
                1 => {
                    let visible = rc.boolean()?;
                    let name = rc.string()?;
                    if station_name.is_empty() {
                        station_name = name.clone();
                    }
                    item["kind"] = json!("station");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                     
                    match crate::station_params::read(slice) {
                        Ok(params) => item["params"] = json!(params),
                        Err(e) => item["params_error"] = json!(e),
                    }
                     
                     
                    if let Ok(t) = crate::station_params::read_tail(slice) {
                        if let Some(d) = t.attach_distance {
                            item["attach_distance"] = json!(d);
                        }
                        if !t.data_params.is_empty() {
                            item["data_params"] = json!(t.data_params);
                        }
                        uv = t.flags & 1 != 0;
                        file_info = json!({ "flags": t.flags, "version": t.version, "platform": t.platform, "build": t.build, "date": t.date, "min_build": t.min_build });
                    }
                }
                3 => {
                    let start = rc.string()?;
                    if start != "FrameChkptStart" {
                        return Err("frame checkpoint missing".into());
                    }
                    let name = rc.string()?;
                    let visible = rc.boolean()?;
                    let pose = rc.mat()?;
                    item["kind"] = json!("frame");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                    item["pose"] = json!(pose);
                }
                2 => {
                    let rows = header_cell(slice, 0, 0, 2) as usize;
                    let robot = parse_robotfile_slice(slice, &mut payload, uv)?;
                     
                    let cols = header_cell(slice, 0, 0, 3) as usize;
                    rc.o = rows * cols * 8;
                    let nlinks = rc.i64()?;
                    for _ in 0..nlinks.clamp(0, 64) {
                        skip_mesh_object(&mut rc, uv)?;
                    }
                    let frame_ref = rc.i32().unwrap_or(-1);
                    let tool_ref = rc.i32().unwrap_or(-1);
                    item["kind"] = json!("robot");
                    item["name"] = robot.get("name").cloned().unwrap_or(json!(""));
                    item["visible"] = json!(header_cell(slice, rows, 47, 0) != 0.0);
                    item["active_frame"] = json!(frame_ref);
                    item["active_tool"] = json!(tool_ref);
                    item["robot"] = robot;
                     
                     
                     
                     
                     
                    let sync = (|| -> Result<Vec<i32>, String> {
                        rc.qstring()?;
                        rc.i64()?;
                        rc.i64()?;
                        for _ in 0..4 {
                            rc.qstring()?;
                        }
                        if rc.o + 4 > rc.b.len() {
                            return Ok(Vec::new());
                        }
                        let n = rc.i32()?;
                        if n < 0 || n as usize > (rc.b.len() - rc.o) / 4 {
                            return Err(format!("bad synchronized axes count {n}"));
                        }
                        (0..n).map(|_| rc.i32()).collect()
                    })();
                    if let Ok(refs) = sync {
                        if !refs.is_empty() {
                            item["sync"] = json!(refs);
                        }
                         
                         
                         
                         
                         
                        if rc.o < rc.b.len() {
                            item["record_tail"] = json!(rc.b[rc.o..].to_vec());
                        }
                    }
                }
                4 | 5 | 16 => {
                    let rows = header_cell(slice, 0, 0, 2) as usize;
                    let cols = header_cell(slice, 0, 0, 3) as usize;
                    if rows != 16 || cols != 100 {
                        return Err(format!("unsupported object header {rows}x{cols}"));
                    }
                    let parsed = parse_robotfile_slice(slice, &mut payload, uv)?;
                    item["kind"] = json!(if typ == 4 { "tool" } else { "object" });
                    item["name"] = parsed.get("name").cloned().unwrap_or(json!(""));
                    item["visible"] = json!(header_cell(slice, rows, 3, 0) != 0.0);
                    item["pose"] = json!(header_mat(slice, rows, 6));
                    item["tcp"] = json!(header_mat(slice, rows, 10));
                     
                     
                     
                    let col2: crate::math::Mat4 = header_mat(slice, rows, 2).try_into().unwrap();
                    if col2.iter().zip(crate::math::IDENTITY).any(|(a, b)| (a - b).abs() > 1e-9) {
                        item["geometry_pose"] = json!(crate::math::inv(&col2).to_vec());
                    }
                    item["links"] = parsed.get("links").cloned().unwrap_or(json!([]));
                    if let Some(f) = parsed.get("features").and_then(|f| f.as_array()).and_then(|f| f.first()) {
                        for key in ["points", "point_names", "curves"] {
                            item[key] = f[key].clone();
                        }
                    }
                    item["locked"] = json!(object_locked(slice, rows * cols * 8, uv));
                }
                11 => {
                    item["kind"] = json!("machining");
                    read_machining(slice, &mut item, &mut payload)?;
                }
                6 => {
                    let name = rc.string()?;
                    let visible = rc.boolean()?;
                    let robot = rc.i32()?;
                    let is_joint = rc.boolean()?;
                    let unreachable = rc.boolean()?;
                    let nj = rc.i32()?;
                    let mut joints = Vec::new();
                    for _ in 0..nj.clamp(0, 64) {
                        joints.push(rc.f64()?);
                    }
                    let pose = rc.mat()?;
                    item["kind"] = json!("target");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                    item["robot"] = json!(robot);
                    item["is_joint"] = json!(is_joint);
                    item["unreachable"] = json!(unreachable);
                    item["joints"] = json!(joints);
                    item["pose"] = json!(pose);
                }
                8 => {
                    let name = rc.string()?;
                    let _second = rc.qstring()?;
                     
                     
                    let (f514, f515) = (rc.u8()?, rc.u8()?);
                    let looping = rc.boolean()?;
                    let visible = rc.boolean()?;
                    let f517 = rc.u8()?;
                     
                    item["flags"] = json!([f514, f515, f517]);
                    let robot = rc.i32()?;
                    let n = rc.i32()?;
                    let mut list = Vec::new();
                    let mut problem = Value::Null;
                    for _ in 0..n.clamp(0, 1_000_000) {
                        match read_instruction(&mut rc, version, p) {
                            Ok(i) => list.push(i),
                            Err(e) => {
                                problem = json!(e);
                                break;
                            }
                        }
                    }
                    item["kind"] = json!("program");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                    item["loop"] = json!(looping);
                    item["robot"] = json!(robot);
                    item["instructions"] = json!(list);
                    if !problem.is_null() {
                        item["instruction_error"] = problem;
                    }
                }
                9 => return Ok(false),  
                17 => {
                    let name = rc.string()?;
                    let visible = rc.boolean()?;
                    item["kind"] = json!("folder");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                }
                22 => {
                    let name = rc.string()?;
                    let visible = rc.boolean()?;
                    let html = rc.string().unwrap_or_default();
                    item["kind"] = json!("notes");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                    item["html"] = json!(html);
                }
                10 => {
                    let name = rc.string()?;
                    let visible = rc.boolean()?;
                    let n = rc.i64().unwrap_or(0);
                    let code = if n > 0 && (n as usize) <= slice.len().saturating_sub(rc.o) {
                        String::from_utf8_lossy(&slice[rc.o..rc.o + n as usize]).into_owned()
                    } else {
                        String::new()
                    };
                    item["kind"] = json!("python");
                    item["name"] = json!(name);
                    item["visible"] = json!(visible);
                    item["code"] = json!(code);
                }
                _ => {
                     
                     
                    let mut nc = Cur { b: slice, o: 0 };
                    let mut name = nc.qstring().ok().flatten().filter(|s| s.len() < 200 && !s.contains('\0'));
                    if name.as_deref().is_some_and(|n| n.ends_with("ChkptStart")) {
                        name = nc.qstring().ok().flatten();
                    }
                    item["kind"] = json!("unsupported");
                    item["name"] = json!(name.unwrap_or_default());
                    return Err(format!("unsupported item type {typ}"));
                }
            }
            Ok(true)
        })();
        match result {
            Ok(true) => {
                counts.imported += 1;
                items.push(item);
            }
            Ok(false) => {}
            Err(e) => {
                counts.skipped += 1;
                item["reason"] = json!(e);
                skipped.push(item);
            }
        }
        cur.o = end;
    }

     
    let mut view = Value::Null;
    if cur.qstring().ok().flatten().as_deref() == Some("Station File End") && cur.qstring().ok().flatten().as_deref() == Some("STATION DATA") {
        if let Ok(m) = cur.mat() {
            view = json!(m);
        }
    }

    let out = json!({
        "format": "rdk",
        "header": header,
        "version": version,
        "name": station_name,
        "view": view,
        "file_info": file_info,
        "items": items,
        "skipped": skipped,
        "counts": counts,
    });
    let js = serde_json::to_vec(&out).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(4 + js.len() + 4 + payload.len() * 4);
    buf.extend_from_slice(&(js.len() as u32).to_le_bytes());
    buf.extend_from_slice(&js);
    while buf.len() % 4 != 0 {
        buf.push(0);
    }
    for v in payload {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    Ok(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load(rel: &str) -> Option<(Value, usize)> {
        let path = format!("{}/../../{}", env!("CARGO_MANIFEST_DIR"), rel);
        let bytes = std::fs::read(path).ok()?;
        let buf = parse(&bytes).expect("parse");
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        Some((serde_json::from_slice(&buf[4..4 + n]).unwrap(), buf.len()))
    }

    fn by_name<'a>(v: &'a Value, name: &str) -> &'a Value {
        v["items"].as_array().unwrap().iter().find(|i| i["name"] == name).unwrap_or_else(|| panic!("no item {name}"))
    }

    #[test]
    fn minimal_station() {
        let Some((v, _)) = load("research/evidence/slf/minimal.rdk") else { return };
        assert_eq!(v["name"], "MinStation");
        let f = by_name(&v, "FrameA");
        assert_eq!(f["kind"], "frame");
         
        assert_eq!(f["pose"][3], 100.0);
        assert_eq!(f["pose"][7], 200.0);
        assert_eq!(f["pose"][11], 300.0);
        let t = by_name(&v, "TargetB");
        assert_eq!(t["kind"], "target");
        assert_eq!(t["parent"], f["index"]);
        assert_eq!(t["pose"][3], 10.0);
        assert_eq!(t["robot"], -1);
    }

    
    
    
    
    
    #[test]
    fn sample_station_tree_and_programs() {
        let Some(bytes) = crate::testlib::read_library_file("stations", "Assembly-and-Material-Handling-with-ABB-IRB-120-3-0-6.rdk") else { return };
        let raw = crate::robotfile::inflate(&bytes).expect("inflate");
        let buf = parse(&raw).expect("parse the decoded stream");
        assert_eq!(buf, parse(&bytes).expect("parse the file"));
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        let v: Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
        assert_eq!(v["name"], "Assembly and Material Handling with ABB IRB 120-3/0.6");
        assert_eq!(v["counts"]["records"], 309);
        let items = v["items"].as_array().unwrap();
        let count = |k: &str| items.iter().filter(|i| i["kind"] == k).count();
        assert_eq!(count("frame"), 47);
        assert_eq!(count("target"), 18);
        assert_eq!(count("object"), 41);
        assert_eq!(count("robot"), 3);
        assert_eq!(count("tool"), 1);
        assert_eq!(count("program"), 28);
        assert_eq!(count("python"), 4);
         
        let f = by_name(&v, "PalletTube1_Ref");
        assert!((f["pose"][3].as_f64().unwrap() - 300.0).abs() < 1e-9);
        assert!((f["pose"][7].as_f64().unwrap() - 160.0).abs() < 1e-9);
        let abb = by_name(&v, "ABB IRB 120-3/0.6");
        assert_eq!(abb["robot"]["dof"], 6);
        assert_eq!(abb["robot"]["links"].as_array().unwrap().len(), 7);
        let tool = by_name(&v, "GripperTCP");
        assert_eq!(tool["tcp"][11], 70.0);
        assert_eq!(abb["active_tool"], tool["index"]);
         
        let p = items.iter().find(|i| i["kind"] == "program" && i["name"] == "GripperOpen").unwrap();
        let ins = p["instructions"].as_array().unwrap();
        assert_eq!(ins.len(), 3);
        assert_eq!(ins[0]["name"], "Set Ref.: Assembly");
        assert_eq!(ins[2]["name"], "MoveJ (GripperOpen)");
        let tref = ins[2]["target"].as_i64().unwrap();
        let target = items.iter().find(|i| i["index"].as_i64() == Some(tref)).unwrap();
        assert_eq!(target["name"], "GripperOpen");
        assert_eq!(p["robot"], by_name(&v, "Gripper")["index"]);
    }
}

#[cfg(test)]
mod library_stations {
    use super::*;

    
    
    fn load(name: &str) -> Option<Value> {
        let research = format!("{}/../../research/evidence/slf/rdk/{name}", env!("CARGO_MANIFEST_DIR"));
        let bytes = crate::testlib::read_library_file("stations", name).or_else(|| std::fs::read(research).ok())?;
        let buf = parse(&bytes).expect("parse");
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        Some(serde_json::from_slice(&buf[4..4 + n]).unwrap())
    }

    #[test]
    fn embedded_move_targets() {
        let Some(v) = load("Dispensing-with-UR5e.rdk") else { return };
        let prog = v["items"].as_array().unwrap().iter().find(|i| i["kind"] == "program").unwrap();
        let ins = prog["instructions"].as_array().unwrap();
        let first = ins.iter().find(|i| i["name"] == "MoveJ 1").unwrap();
        assert_eq!(first["target"], -1);
        assert_eq!(first["is_joint"], true);
        assert_eq!(first["joints"].as_array().unwrap().len(), 6);
        assert!(ins.iter().all(|i| i.get("error").is_none()));
         
        let project = v["items"].as_array().unwrap().iter().find(|i| i["kind"] == "machining").unwrap();
        assert_eq!(project["type"], 11);
        assert!(project["program"].as_i64().unwrap() >= 0);
    }

    
    
    #[test]
    fn synchronized_axes() {
        let items = |v: &Value| v["items"].as_array().unwrap().clone();
        let index_of = |v: &Value, name: &str| items(v).iter().find(|i| i["kind"] == "robot" && i["name"].as_str().is_some_and(|n| n.starts_with(name))).map(|i| i["index"].clone());
        if let Some(v) = load("Synchronization-and-Welding-with-ABB-02.rdk") {
            let robot = items(&v).into_iter().find(|i| i["kind"] == "robot" && i["name"].as_str().unwrap().starts_with("ABB IRB 2600ID")).unwrap();
            assert_eq!(robot["sync"], json!([index_of(&v, "ABB IRBP L2000 L3150").unwrap()]));
            let positioner = items(&v).into_iter().find(|i| i["kind"] == "robot" && i["name"].as_str().unwrap().starts_with("ABB IRBP")).unwrap();
            assert!(positioner.get("sync").is_none());
        }
        if let Some(v) = load("Machining-and-Synchronization-with-KUKA.rdk") {
             
            let robot = items(&v).into_iter().find(|i| i["kind"] == "robot" && i["name"] == "KUKA KR 500 3").unwrap();
            assert_eq!(robot["sync"], json!([index_of(&v, "Rail").unwrap(), index_of(&v, "KUKA DKP-400").unwrap()]));
        }
        if let Some(v) = load("Mixed-Applications-with-Multiple-Robots.rdk") {
            let rail = items(&v).into_iter().find(|i| i["kind"] == "robot" && i["name"] == "KL4000").unwrap();
            assert_eq!(rail["robot"]["joints_type"], 5);
            assert_eq!(rail["robot"]["map"], json!([-1.0]));
        }
    }

    
    
    
    
    #[test]
    fn textured_station() {
        let Some(v) = load("Material-Handling-with-Mecademic-and-RoboDK.rdk") else { return };
        assert_eq!(v["counts"]["skipped"], 0, "{}", v["skipped"]);
        assert_eq!(v["file_info"]["flags"], 3);
        assert_eq!(v["file_info"]["version"], "6.0.3");
        assert_eq!(v["file_info"]["build"], 26800);
        let items = v["items"].as_array().unwrap();
        let robots = items.iter().filter(|i| i["kind"] == "robot").count();
        assert_eq!(robots, 3);
        let tools: Vec<_> = items.iter().filter(|i| i["kind"] == "tool").collect();
        assert!(tools.iter().any(|t| t.get("geometry_pose").is_some()), "the EPick gripper keeps its geometry pose");
         
        assert!(items.iter().filter(|i| i["kind"] == "object").all(|o| o["links"][0].as_array().is_some_and(|s| !s.is_empty())));
    }

    
    
    #[test]
    fn rdk_1440_robots() {
        let Some(v) = load("Mixed-Applications-with-RoboDK-RDK-1440-02.rdk") else { return };
        let robots = v["items"].as_array().unwrap().iter().filter(|i| i["kind"] == "robot").count();
        assert_eq!(robots, 2);
        let skipped: Vec<_> = v["skipped"].as_array().unwrap().iter().map(|s| s["type"].as_i64().unwrap()).collect();
        assert_eq!(skipped, [19]);
         
        assert_eq!(v["items"][0]["attach_distance"], 200.0);
    }

    #[test]
    fn conveyor_and_two_robots() {
        let Some(v) = load("Conveying-with-UR10.rdk") else { return };
        let robots: Vec<_> = v["items"].as_array().unwrap().iter().filter(|i| i["kind"] == "robot").map(|i| i["name"].as_str().unwrap().to_string()).collect();
        assert_eq!(robots, ["UR10 A", "UR10 B", "Conveyor Belt"]);
        assert_eq!(v["counts"]["skipped"], 0);
    }
}

#[cfg(test)]
mod library_mirror {
    use super::*;

    
    
    
    
    #[test]
    fn projects_curves_points_and_events() {
        let Some(dir) = crate::testlib::library_kind_dir("stations") else { return };
        let dir = dir.display().to_string();
        let Ok(entries) = std::fs::read_dir(&dir) else { return };
        let (mut projects, mut with_events, mut curves, mut vertices, mut points, mut kinds) = (0, 0, 0, 0, 0, [0usize; 4]);
        let (mut events, mut with_poses, mut failed) = (0, 0, Vec::new());
        let (mut speeds, mut named_speeds, mut arcs, mut embedded_arcs) = (0, 0, 0, 0);
        for e in entries.flatten() {
            let path = e.path();
            if !path.extension().is_some_and(|x| x == "rdk" || x == "rdka") {
                continue;
            }
            let buf = parse(&std::fs::read(&path).unwrap()).unwrap_or_else(|err| panic!("{path:?}: {err}"));
            let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
            let v: Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
             
            let skipped: Vec<_> = v["skipped"].as_array().unwrap().iter().filter(|s| [2, 4, 5, 11, 16].contains(&s["type"].as_i64().unwrap_or(0))).collect();
            assert!(skipped.is_empty(), "{path:?}: {skipped:?}");
            for it in v["items"].as_array().unwrap() {
                if it["kind"] == "machining" {
                    projects += 1;
                    with_events += it.get("events").is_some() as usize;
                    kinds[it["project_kind"].as_i64().unwrap().clamp(0, 3) as usize] += 1;
                }
                if let Some(c) = it.get("curves").and_then(|c| c.as_array()) {
                    curves += c.len();
                    vertices += c.iter().map(|c| c["points"].as_array().unwrap().len()).sum::<usize>();
                }
                points += it.get("points").and_then(|p| p.as_array()).map_or(0, |p| p.len());
                if it["kind"] == "program" {
                    let items = v["items"].as_array().unwrap();
                    for ins in it["instructions"].as_array().unwrap() {
                        let name = ins["name"].as_str().unwrap_or("");
                        if ins["type"] == 2 {
                             
                            speeds += 1;
                            let sp = &ins["speed"];
                            let f = sp["flags"].as_i64().unwrap();
                            if let Some(shown) = name.strip_prefix("Set speed (").and_then(|r| r.split(' ').next()).and_then(|x| x.parse::<f64>().ok()) {
                                let first = if f & 1 != 0 { sp["linear"].as_f64().unwrap() } else { sp["joint"].as_f64().unwrap() };
                                assert!((shown - first).abs() <= 0.05 + 1e-9, "{path:?} {name} {sp}");
                                named_speeds += 1;
                            }
                        }
                        if ins["type"] == 1 {
                            arcs += 1;
                            assert!(ins.get("error").is_none(), "{path:?} {name} {ins}");
                            let refs = ins["refs"].as_array().unwrap();
                            assert_eq!(refs.len(), 2);
                            embedded_arcs += ins["poses"].as_array().unwrap().iter().filter(|p| !p.is_null()).count();
                             
                            if let Some(inner) = name.strip_prefix("MoveC (").and_then(|n| n.strip_suffix(')')) {
                                let names: Vec<&str> = inner.split(", ").collect();
                                for (r, n) in refs.iter().zip(&names) {
                                    let t = items.iter().find(|x| x["index"] == *r).unwrap_or_else(|| panic!("{path:?} {name}: ref {r}"));
                                    assert_eq!(t["name"], *n, "{path:?} {name}");
                                }
                            }
                        }
                    }
                    for ins in it["instructions"].as_array().unwrap().iter().filter(|i| i["type"] == 7) {
                        events += 1;
                        if ins.get("error").is_some() {
                            failed.push(format!("{:?} {} {}", path.file_name().unwrap(), it["name"], ins["name"]));
                        } else if !ins["event"]["poses"].as_array().unwrap().is_empty() {
                            with_poses += 1;
                            assert_eq!(ins["event"]["poses"].as_array().unwrap().len(), ins["event"]["objects"].as_array().unwrap().len());
                        }
                    }
                }
            }
        }
        eprintln!("projects {projects} (events {with_events}, kinds {kinds:?}), curves {curves} ({vertices} vertices), points {points}; simulation events {events}, with recorded poses {with_poses}; speeds {speeds} ({named_speeds} checked by name); MoveC {arcs} ({embedded_arcs} embedded targets)");
        assert!(speeds > 27_000 && named_speeds > 20_000 && arcs > 0 && embedded_arcs > 0);
        assert!(projects >= 100 && with_events == projects && vertices > 300_000 && points > 400);
        assert!(failed.is_empty(), "{failed:?}");
        assert!(with_poses >= 44);

        let buf = parse(&std::fs::read(format!("{dir}/Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk")).unwrap()).unwrap();
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        let v: Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
        let items = v["items"].as_array().unwrap();
        let by_index = |i: i64| items.iter().find(|x| x["index"].as_i64() == Some(i));
        let tube = items.iter().find(|i| i["kind"] == "object" && i["name"] == "TubeType1-1").unwrap();
         
        let mut abs = crate::math::IDENTITY;
        let mut cur = Some(tube);
        while let Some(it) = cur {
            let p: Vec<f64> = it["pose"].as_array().map(|a| a.iter().map(|x| x.as_f64().unwrap()).collect()).unwrap_or_else(|| crate::math::IDENTITY.to_vec());
            abs = crate::math::mul(&p.try_into().unwrap(), &abs);
            cur = by_index(it["parent"].as_i64().unwrap());
        }
        let event = items
            .iter()
            .filter(|i| i["kind"] == "program")
            .flat_map(|p| p["instructions"].as_array().unwrap())
            .find(|ins| ins["type"] == 7 && ins["event"]["objects"].as_array().unwrap().first() == Some(&tube["index"]) && !ins["event"]["poses"].as_array().unwrap().is_empty())
            .expect("a Move objects event of TubeType1-1");
        let pose: Vec<f64> = event["event"]["poses"][0].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect();
        assert!(([pose[3], pose[7], pose[11]].iter().zip([225.0, 165.0, 5.0]).all(|(a, b)| (a - b).abs() < 1e-9)), "{pose:?}");
        assert!(pose.iter().zip(abs.iter()).all(|(a, b)| (a - b).abs() < 1e-9), "{pose:?} vs {abs:?}");
        assert_eq!(event["event"]["distance"], 200.0);
        assert_eq!(event["event"]["parents"].as_array().unwrap().len(), 40);
        assert_eq!(event["event"]["parents"][0], items.iter().find(|i| i["kind"] == "frame" && i["name"] == "TubeType1-1").unwrap()["index"]);
    }

    
    
    #[test]
    fn locked_objects() {
        let Some((v, _, _)) = station("Conveying-04.rdk") else { return };
        let items = v["items"].as_array().unwrap();
        let init = items.iter().find(|i| i["name"] == "Box Conveyor Init Frame").unwrap();
        let templates: Vec<_> = items.iter().filter(|i| i["parent"] == init["index"] && i["name"] == "RoboDK Box").collect();
        assert_eq!(templates.len(), 6);
        assert!(templates.iter().all(|t| t["locked"] == true));
        assert!(items.iter().any(|i| i["kind"] == "object" && i["locked"] == false));
    }

    
    
    #[test]
    fn looping_programs() {
        let Some((v, _, _)) = station("Conveying-with-ABB-CRB-1300-7-1-4.rdk") else { return };
        let programs: Vec<_> = v["items"].as_array().unwrap().iter().filter(|i| i["kind"] == "program").collect();
        let mut looping: Vec<&str> = programs.iter().filter(|p| p["loop"] == true).map(|p| p["name"].as_str().unwrap()).collect();
        looping.sort_unstable();
        assert_eq!(looping, ["BoxDeleterA", "BoxDeleterB", "BoxFeeder", "ConveyorSwap"]);
        assert!(programs.len() > looping.len() && programs.iter().all(|p| p["loop"].is_boolean()));
    }

    
    
    fn station(name: &str) -> Option<(Value, Vec<u8>, usize)> {
        let buf = parse(&crate::testlib::read_library_file("stations", name)?).unwrap();
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        let v = serde_json::from_slice(&buf[4..4 + n]).unwrap();
        let off = (4 + n).div_ceil(4) * 4;
        Some((v, buf, off))
    }

    
    fn column(buf: &[u8], off: usize, m: &Value, col: usize) -> Vec<f64> {
        let rows = m["rows"].as_u64().unwrap() as usize;
        let at = off + m["at"].as_u64().unwrap() as usize * 4;
        (0..rows).map(|r| f64::from_le_bytes(buf[at + (col * rows + r) * 8..at + (col * rows + r) * 8 + 8].try_into().unwrap())).collect()
    }

    
    
    
    
    #[test]
    fn machining_project_fields() {
        let Some((v, buf, off)) = station("Welding-with-Yaskawa-GP7.rdk") else { return };
        let items = v["items"].as_array().unwrap();
        let side = items.iter().find(|i| i["kind"] == "machining" && i["name"] == "Approach Side Settings").unwrap();
        let s = &side["settings"];
        assert_eq!(s["Algorithm"], 0);
        assert_eq!(s["RotZ_Range"], 180.0);
        assert_eq!(s["RotZ_Step"], 20.0);
        assert_eq!(s["ApproachRetractAll"], 1);
        assert_eq!(s["JoinCurvesTol"], 0.5);
        assert_eq!(s["RapidApproachRetract"], 1.0);
        assert_eq!(s["SpeedOperation"], 300.0);
        assert_eq!(s["PointApproach"], 20.0);
        assert_eq!(s["FlareStartDeg"], 30.0);
        assert_eq!(side["approach"], json!([[3.0, 100.0, 0.0, 0.0]]));
        assert_eq!(side["retract"], json!([[3.0, 100.0, 0.0, 0.0]]));
        assert_eq!(side["path_items"], json!([[0, 0, 0]]));
        let apt = &side["apt_path"];
        assert_eq!((apt["rows"].as_u64(), apt["cols"].as_u64()), (Some(7), Some(52)));
         
         
        assert_eq!(column(&buf, off, apt, 0), [7.0, -1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert_eq!(column(&buf, off, apt, 1)[..4], [2.0, 0.0, 100.0, 0.0]);
        assert_eq!(column(&buf, off, apt, 2)[..2], [100.0, 1.0]);
        assert_eq!(column(&buf, off, apt, 4)[..2], [100.0, 0.0]);
        assert_eq!(column(&buf, off, apt, 6)[..2], [7.0, 300.0]);
         
        assert_eq!(column(&buf, off, apt, 50)[..4], [2.0, 400.0, -100.0, 0.0]);
        assert_eq!(column(&buf, off, apt, 51)[..2], [100.0, 2.0]);
        let rp = &side["robot_path"];
        assert_eq!(column(&buf, off, rp, 3)[0], 1.0, "MoveJ before the first move");
        let arc = items.iter().find(|i| i["kind"] == "machining" && i["name"] == "Approach Arc Normal Settings").unwrap();
        assert_eq!(arc["approach"], json!([[201.0, 400.0, 60.0, 0.0]]));

        let Some((v, _, _)) = station("Curve-Following-with-Omron-TM5-700.rdk") else { return };
        let outline = v["items"].as_array().unwrap().iter().find(|i| i["kind"] == "machining" && i["name"] == "Outline settings").unwrap();
        assert_eq!(outline["poses"]["path_to_tool"]["formula"], "rotz(70)");
        let p = outline["poses"]["path_to_tool"]["pose"].as_array().unwrap();
        assert!((p[0].as_f64().unwrap() - 70f64.to_radians().cos()).abs() < 1e-12 && (p[4].as_f64().unwrap() - 70f64.to_radians().sin()).abs() < 1e-12);
        assert_eq!(outline["poses"]["frame_offset"]["formula"], "rotZ(0)");
    }
}
