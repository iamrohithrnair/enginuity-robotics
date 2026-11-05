// Parses robot definitions, shapes, and motion settings from library files.















use miniz_oxide::inflate::decompress_to_vec_zlib;
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct DhRow {
    pub alpha: f64,
    pub a: f64,
    pub theta: f64,
    pub d: f64,
    
    pub kind: u8,
}

#[derive(Serialize, Default, Clone)]
pub struct ShapeInfo {
    pub triangles: usize,
    pub rgba: [f32; 4],
    
    pub positions: usize,
    pub normals: usize,
}







#[derive(Serialize, Default, Clone)]
pub struct Features {
    
    pub link: usize,
    
    pub points: Vec<[f64; 6]>,
    
    pub point_names: Vec<String>,
    pub curves: Vec<Curve>,
}

#[derive(Serialize, Default, Clone)]
pub struct Curve {
    pub name: String,
    pub rgba: [f32; 4],
    
    pub points: Vec<[f64; 6]>,
}


fn short(x: f32) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    format!("{x}").parse().unwrap_or(x as f64)
}

#[derive(Serialize, Default)]
pub struct Speeds {
    pub linear: f64,
    pub linear_accel: f64,
    pub rounding: f64,
    pub joint: f64,
    pub joint_accel: f64,
}

#[derive(Serialize, Default)]
pub struct ParsedFile {
    pub kind: String,
    pub rows: usize,
    pub cols: usize,
    pub name: String,
    pub native_name: String,
    pub post_processor: String,
    pub mech: i32,
    pub joints_type: i32,
    pub euler_type: i32,
    
    pub dof: usize,
    
    pub dh: Vec<DhRow>,
    
    pub map: Vec<f64>,
    pub lower: Vec<f64>,
    pub upper: Vec<f64>,
    pub lower_internal: Vec<f64>,
    pub upper_internal: Vec<f64>,
    pub home: Vec<f64>,
    pub joints: Vec<f64>,
    
    pub base: Vec<f64>,
    pub flange: Vec<f64>,
    
    pub tcp: Vec<f64>,
    pub polygon: Vec<[f64; 2]>,
    pub speeds: Speeds,
    pub payload: f64,
    pub reach: f64,
    pub repeatability: f64,
    pub weight: f64,
    pub links: Vec<Vec<ShapeInfo>>,
    
    pub features: Vec<Features>,
    pub supported_kinematics: bool,
    
    pub nlinks: usize,
    
    
    pub mech_params: Vec<f64>,
    
    
    pub header: Vec<f64>,
}

pub fn inflate(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > 6 && bytes[4] == 0x78 {
        let declared = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        let out = decompress_to_vec_zlib(&bytes[4..]).map_err(|e| format!("zlib: {e:?}"))?;
        if declared != 0 && declared != out.len() {
            return Err(format!("declared size {declared} != inflated {}", out.len()));
        }
        Ok(out)
    } else {
        Ok(bytes.to_vec())
    }
}

struct Header {
    rows: usize,
    v: Vec<f64>,
}

impl Header {
    fn cell(&self, c: usize, r: usize) -> f64 {
        *self.v.get(c * self.rows + r).unwrap_or(&0.0)
    }
    fn text(&self, col: usize, max: usize) -> String {
        let mut s = String::new();
        for k in 0..max {
            let v = *self.v.get(col * self.rows + k).unwrap_or(&0.0);
            if v <= 0.0 || v > 0x10FFFF as f64 {
                break;
            }
            if let Some(c) = char::from_u32(v as u32) {
                s.push(c);
            }
        }
        s
    }
    
    fn mat_col(&self, col: usize) -> Vec<f64> {
        let mut m = vec![0.0; 16];
        for c in 0..4 {
            for r in 0..4 {
                m[r * 4 + c] = self.cell(col, c * 4 + r);
            }
        }
        m
    }
}


fn pose_xyz_rxryrz(h: &Header, col: usize) -> Vec<f64> {
    use crate::math::*;
    let t = mul(
        &mul(&mul(&transl(h.cell(col, 0), h.cell(col, 1), h.cell(col, 2)), &rotx(h.cell(col, 3))), &roty(h.cell(col, 4))),
        &rotz(h.cell(col, 5)),
    );
    t.to_vec()
}

struct Cursor<'a> {
    b: &'a [u8],
    o: usize,
}

impl<'a> Cursor<'a> {
    fn remaining(&self) -> usize {
        self.b.len().saturating_sub(self.o)
    }
    fn i64(&mut self) -> Result<i64, String> {
        if self.remaining() < 8 {
            return Err("unexpected end of file".into());
        }
        let v = i64::from_le_bytes(self.b[self.o..self.o + 8].try_into().unwrap());
        self.o += 8;
        Ok(v)
    }
    fn f32(&mut self) -> Result<f32, String> {
        if self.remaining() < 4 {
            return Err("unexpected end of file".into());
        }
        let v = f32::from_le_bytes(self.b[self.o..self.o + 4].try_into().unwrap());
        self.o += 4;
        Ok(v)
    }
    fn qstring(&mut self) -> Result<String, String> {
        if self.remaining() < 4 {
            return Err("unexpected end of file".into());
        }
        let n = u32::from_le_bytes(self.b[self.o..self.o + 4].try_into().unwrap());
        self.o += 4;
        if n == 0xFFFF_FFFF {
            return Ok(String::new());
        }
        let n = n as usize;
        if self.remaining() < n {
            return Err("bad string".into());
        }
        let u: Vec<u16> = self.b[self.o..self.o + n].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        self.o += n;
        Ok(String::from_utf16_lossy(&u))
    }
}

fn read_features(cur: &mut Cursor, feat: &mut Features) -> Result<(), String> {
    if cur.remaining() < 8 {
        return Ok(());
    }
    let npt = cur.i64()?;
    if npt < 0 || npt as usize > cur.remaining() / 60 {
        return Err(format!("bad point count {npt}"));
    }
    for _ in 0..npt {
        let name = cur.qstring()?;
        let mut v = [0f32; 14];
        for x in v.iter_mut() {
            *x = cur.f32()?;
        }
        feat.points.push([short(v[4]), short(v[5]), short(v[6]), short(v[10]), short(v[11]), short(v[12])]);
        feat.point_names.push(name);
    }
    if cur.remaining() < 8 {
        return Ok(());
    }
    let ncv = cur.i64()?;
    if ncv < 0 || ncv as usize > cur.remaining() / 28 {
        return Err(format!("bad curve count {ncv}"));
    }
    for _ in 0..ncv {
        let n = cur.i64()?;
        let name = cur.qstring()?;
        if n < 0 || n as usize > cur.remaining() / 52 {
            return Err(format!("bad curve length {n}"));
        }
        let rgba = [cur.f32()?, cur.f32()?, cur.f32()?, cur.f32()?];
        let mut points = Vec::with_capacity(n as usize);
        for _ in 0..n {
            let mut v = [0f32; 13];
            for x in v.iter_mut() {
                *x = cur.f32()?;
            }
            points.push([short(v[1]), short(v[2]), short(v[3]), short(v[4]), short(v[5]), short(v[6])]);
        }
        feat.curves.push(Curve { name, rgba, points });
    }
    Ok(())
}


fn decode_normal(b0: u8, b1: u8) -> [f32; 3] {
    let th = b0 as f64 * std::f64::consts::PI / 255.0;
    let ph = b1 as f64 * 2.0 * std::f64::consts::PI / 255.0;
    [(th.sin() * ph.cos()) as f32, (th.sin() * ph.sin()) as f32, th.cos() as f32]
}





fn read_mesh_object(cur: &mut Cursor, out: &mut Vec<f32>, feat: &mut Features, uv: bool) -> Result<Vec<ShapeInfo>, String> {
    let ns = cur.i64()?;
    if !(0..=10_000_000).contains(&ns) {
        return Err(format!("bad shape count {ns}"));
    }
    let mut shapes = Vec::with_capacity(ns as usize);
    for _ in 0..ns {
        let nt = cur.i64()?;
        if nt < 0 || cur.remaining() < 16 + nt as usize * 42 {
            return Err(format!("bad triangle count {nt}"));
        }
        let rgba = [cur.f32()?, cur.f32()?, cur.f32()?, cur.f32()?];
        let nv = nt as usize * 3;
        let pos_off = out.len();
        let mut normals: Vec<f32> = Vec::with_capacity(nv * 3);
        out.reserve(nv * 6);
        for _ in 0..nv {
            let x = cur.f32()?;
            let y = cur.f32()?;
            let z = cur.f32()?;
            let b0 = cur.b[cur.o];
            let b1 = cur.b[cur.o + 1];
            cur.o += 2;
            out.extend_from_slice(&[x, y, z]);
            normals.extend_from_slice(&decode_normal(b0, b1));
        }
        let norm_off = out.len();
        out.extend_from_slice(&normals);
        if uv {
             
            let tex = cur.i64()?;
            if tex != 0 && nt > 0 {
                if cur.remaining() < nt as usize * 24 {
                    return Err("bad texture coordinates".into());
                }
                cur.o += nt as usize * 24;
            }
        }
        shapes.push(ShapeInfo { triangles: nt as usize, rgba, positions: pos_off, normals: norm_off });
    }
     
     
    let start = cur.o;
    if read_features(cur, feat).is_err() {
        cur.o = start;
        feat.points.clear();
        feat.point_names.clear();
        feat.curves.clear();
    }
    Ok(shapes)
}


fn preset(code: i32) -> Option<([f64; 6], f64)> {
    Some(match code {
        0 | 1 | 13 | 14 => ([1.0, 1.0, 1.0, 1.0, 1.0, 1.0], 0.0),
        2 => ([1.0, 1.0, -1.0, -1.0, -1.0, -1.0], -1.0),
        3 => ([1.0, 1.0, -1.0, -1.0, -1.0, -1.0], 0.0),
        4 => ([1.0, 1.0, 1.0, 1.0, 1.0, 1.0], -1.0),
        5 => ([-1.0, 1.0, 1.0, -1.0, 1.0, -1.0], 0.0),
        6 => ([1.0, 1.0, -1.0, 1.0, 1.0, 1.0], 0.0),
        8 => ([-1.0, 1.0, -1.0, -1.0, 1.0, 1.0], -1.0),
        9 => ([-1.0, 1.0, 1.0, -1.0, 1.0, -1.0], -1.0),
        11 => ([-1.0, 1.0, -1.0, -1.0, 1.0, -1.0], -1.0),
        _ => return None,
    })
}

pub fn parse(bytes: &[u8]) -> Result<Vec<u8>, String> {
    parse_with_uv(bytes, false)
}



pub fn parse_with_uv(bytes: &[u8], uv: bool) -> Result<Vec<u8>, String> {
    let data = inflate(bytes)?;
    if data.len() < 32 {
        return Err("The robot file is not valid. The robot file is corrupted or there's not enough available space. Errors will follow.".into());
    }
    let f = |i: usize| f64::from_le_bytes(data[i * 8..i * 8 + 8].try_into().unwrap());
    let (kind0, values, rows, cols) = (f(0), f(1) as usize, f(2) as usize, f(3) as usize);
    if (kind0 - 1.0).abs() > 1e-6 || values == 0 || rows == 0 || cols == 0 || values != rows * cols || values * 8 > data.len() {
        return Err("The robot file is not valid. The robot file is corrupted or there's not enough available space. Errors will follow.".into());
    }
    let h = Header { rows, v: (0..values).map(f).collect() };
    let mut cur = Cursor { b: &data, o: values * 8 };
    let mut payload: Vec<f32> = Vec::new();
    let mut out = ParsedFile { rows, cols, header: h.v.clone(), ..Default::default() };

    if rows == 20 && cols == 200 {
        out.kind = "robot".into();
        out.name = h.text(90, 100);
        out.native_name = h.text(95, 100);
        out.post_processor = h.text(190, 200);
        out.mech = h.cell(1, 0).round() as i32;
        let n = h.cell(1, 1).round().max(0.0) as usize;
        out.dof = n;
        out.euler_type = h.cell(3, 0).round() as i32;
        out.joints_type = h.cell(3, 1).round() as i32;
        let ndh = if out.mech == 9 { n + 1 } else { n };
        for j in 0..ndh {
            let c = 10 + j;
            out.dh.push(DhRow { alpha: h.cell(c, 0), a: h.cell(c, 1), theta: h.cell(c, 2), d: h.cell(c, 3), kind: h.cell(c, 4).round() as u8 });
        }
         
        let rows_s: Vec<f64> = (4..4 + 12).map(|r| h.cell(3, r)).collect();
        let (senses, coupling): (Vec<f64>, f64) = if n == 6 && preset(out.joints_type).is_some() {
            let (s, c) = preset(out.joints_type).unwrap();
            (s.to_vec(), c)
        } else if n == 6 && out.joints_type == 12 {
             
             
            (vec![rows_s[0], rows_s[7], rows_s[8], rows_s[3], rows_s[4], rows_s[5]], rows_s[9])
        } else if matches!(out.joints_type, 7 | 10 | 12) {
            let c = if out.joints_type == 10 && out.mech == 9 { rows_s[n] } else { 0.0 };
            (rows_s[..n].to_vec(), c)
        } else if let Some((s, _)) = preset(out.joints_type) {
             
             
             
             
             
             
            ((0..n).map(|j| s.get(j).copied().unwrap_or(1.0)).collect(), 0.0)
        } else {
            (vec![1.0; n], 0.0)
        };
        let mut a = vec![0.0; ndh * n];
        for j in 0..n.min(3) {
            a[j * n + j] = senses[j];
        }
        if n >= 3 && coupling != 0.0 {
            a[2 * n + 1] += coupling;
        }
        if out.mech == 9 && n >= 4 {
             
            for k in 0..n {
                a[3 * n + k] = -(a[n + k] + a[2 * n + k]);
            }
            a[4 * n + 3] = senses[3];
        } else {
            for j in 3..n {
                a[j * n + j] = senses[j];
            }
        }
        out.map = a;
        for j in 0..n {
            out.lower.push(h.cell(30, j));
            out.upper.push(h.cell(31, j));
            out.home.push(h.cell(34, j));
            out.joints.push(h.cell(35, j));
        }
        for j in 0..ndh {
            if out.mech == 9 && j == 3 {
                out.lower_internal.push(-1e9);
                out.upper_internal.push(1e9);
            } else {
                let jj = if out.mech == 9 && j > 3 { j - 1 } else { j };
                out.lower_internal.push(h.cell(32, jj));
                out.upper_internal.push(h.cell(33, jj));
            }
        }
        let np = h.cell(36, 0).round().max(0.0) as usize;
        for k in 1..=np.min(rows - 1) {
            out.polygon.push([h.cell(36, k), h.cell(37, k)]);
        }
        out.base = pose_xyz_rxryrz(&h, 9);
        out.flange = pose_xyz_rxryrz(&h, 28);
        out.speeds = Speeds { linear: h.cell(6, 0), linear_accel: h.cell(6, 1), rounding: h.cell(6, 2), joint: h.cell(6, 3), joint_accel: h.cell(6, 4) };
        out.payload = h.cell(5, 0);
        out.reach = h.cell(5, 1);
        out.repeatability = h.cell(5, 2);
        out.weight = h.cell(5, 3);
        out.supported_kinematics = true;
        for c in (10..=14).chain(53..=55) {
            for r in 0..20 {
                out.mech_params.push(h.cell(c, r));
            }
        }
        let nlinks = cur.i64()?;
        if nlinks < 0 || nlinks > 64 {
            return Err(format!("bad link count {nlinks}"));
        }
        for link in 0..nlinks as usize {
            let mut feat = Features { link, ..Default::default() };
            out.links.push(read_mesh_object(&mut cur, &mut payload, &mut feat, uv)?);
            if !feat.points.is_empty() || !feat.curves.is_empty() {
                out.features.push(feat);
            }
        }
        out.nlinks = out.links.len();
    } else if rows == 16 && cols == 100 {
        out.kind = "tool".into();
        out.name = h.text(90, 100);
        out.tcp = h.mat_col(10);
        let mut feat = Features::default();
        out.links.push(read_mesh_object(&mut cur, &mut payload, &mut feat, uv)?);
        if !feat.points.is_empty() || !feat.curves.is_empty() {
            out.features.push(feat);
        }
        out.nlinks = 1;
    } else {
        return Err(format!("unsupported header {rows}x{cols}"));
    }

    let json = serde_json::to_vec(&out).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(4 + json.len() + 4 + payload.len() * 4);
    buf.extend_from_slice(&(json.len() as u32).to_le_bytes());
    buf.extend_from_slice(&json);
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

    
    fn load(name: &str) -> Option<(serde_json::Value, usize)> {
        let bytes = crate::testlib::read_library_file("robots", name)?;
        let buf = parse(&bytes).expect("parse");
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        Some((serde_json::from_slice(&buf[4..4 + n]).unwrap(), buf.len()))
    }

    #[test]
    fn parses_irb120() {
        let Some((v, _)) = load("ABB-IRB-120-3-0-6.robot") else { return };
        assert_eq!(v["name"], "ABB IRB 120-3/0.6");
        assert_eq!(v["post_processor"], "ABB_RAPID_IRC5");
        assert_eq!(v["dof"], 6);
        assert_eq!(v["dh"][0]["d"], 290.0);
        assert_eq!(v["upper"][2], 70.0);
        assert_eq!(v["links"].as_array().unwrap().len(), 7);
         
        assert_eq!(v["speeds"]["linear"], 1000.0);
    }

    #[test]
    fn parses_kuka_with_senses() {
        let Some((v, _)) = load("KUKA-KR-6-R900-sixx.robot") else { return };
        assert_eq!(v["joints_type"], 5);
         
        let map = v["map"].as_array().unwrap();
        assert_eq!(map[0], -1.0);
        assert_eq!(map[7], 1.0);
        assert_eq!(map[21], -1.0);
    }

    
    
    #[test]
    fn parses_tool_file() {
        let Some(dir) = crate::testlib::library_kind_dir("tools") else { return };
        let mut tools = 0;
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let path = e.path();
            if !path.extension().is_some_and(|x| x == "tool") {
                continue;
            }
            let buf = parse(&std::fs::read(&path).unwrap()).unwrap_or_else(|err| panic!("{path:?}: {err}"));
            let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
            let v: serde_json::Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
            assert!(v["name"].as_str().is_some_and(|s| !s.is_empty()), "{path:?}");
            tools += 1;
        }
        assert!(tools > 0);
    }
}
