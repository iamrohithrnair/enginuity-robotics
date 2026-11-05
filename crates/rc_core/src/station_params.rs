// Decodes station-tail records and configuration parameters.
































struct Le<'a> {
    b: &'a [u8],
    o: usize,
}

impl Le<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let end = self.o.checked_add(n).filter(|&e| e <= self.b.len()).ok_or("station record ends inside the station parameters")?;
        let s = &self.b[self.o..end];
        self.o = end;
        Ok(s)
    }
    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn i64(&mut self) -> Result<i64, String> {
        Ok(i64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    
    fn qstring(&mut self) -> Result<String, String> {
        let n = u32::from_le_bytes(self.take(4)?.try_into().unwrap());
        if n == u32::MAX {
            return Ok(String::new());
        }
        if !n.is_multiple_of(2) {
            return Err("bad string length in the station parameters".into());
        }
        let raw = self.take(n as usize)?;
        let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        Ok(String::from_utf16_lossy(&units))
    }
}




pub fn read(payload: &[u8]) -> Result<Vec<(String, String)>, String> {
    let mut c = Le { b: payload, o: 0 };
    c.take(1)?;  
    c.qstring()?;  
    let n = u64::try_from(c.i64()?).map_err(|_| "bad station matrix size")?;
    let cells = n.checked_mul(n.saturating_sub(1)).map(|v| v / 2).and_then(|v| usize::try_from(v).ok()).ok_or("bad station matrix size")?;
    c.take(cells)?;
    let mut params = Vec::new();
     
    if c.o >= payload.len() {
        return Ok(params);
    }
    let count = c.i32()?;
    for _ in 0..count.max(0) {
        let name = c.qstring()?;
        let value = c.qstring()?;
        params.push((name, value));
    }
    Ok(params)
}




#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct StationTail {
    
    pub attach_distance: Option<f64>,
    
    pub data_params: Vec<(String, Vec<u8>)>,
    
    
    
    pub flags: i64,
    
    pub version: String,
    pub platform: String,
    pub build: i64,
    pub date: i64,
    
    pub min_build: i64,
}



pub fn read_tail(payload: &[u8]) -> Result<StationTail, String> {
    let mut c = Le { b: payload, o: 0 };
    let mut t = StationTail::default();
    c.take(1)?;
    c.qstring()?;
    let n = u64::try_from(c.i64()?).map_err(|_| "bad station matrix size")?;
    let cells = n.checked_mul(n.saturating_sub(1)).map(|v| v / 2).and_then(|v| usize::try_from(v).ok()).ok_or("bad station matrix size")?;
    c.take(cells)?;
    let more = |c: &Le| c.o < c.b.len();
    if !more(&c) {
        return Ok(t);
    }
    let count = c.i32()?;
    for _ in 0..count.max(0) {
        c.qstring()?;
        c.qstring()?;
    }
    if !more(&c) {
        return Ok(t);
    }
    t.attach_distance = Some(f64::from_le_bytes(c.take(8)?.try_into().unwrap()));
    c.i32()?;
    if !more(&c) {
        return Ok(t);
    }
    c.i32()?;
    if !more(&c) {
        return Ok(t);
    }
    c.take(1)?;
    let n = c.i32()?;
    for _ in 0..n.max(0) {
        let name = c.qstring()?;
        let len = u32::from_le_bytes(c.take(4)?.try_into().unwrap());
        let bytes = if len == u32::MAX { Vec::new() } else { c.take(len as usize)?.to_vec() };
        t.data_params.push((name, bytes));
    }
    if !more(&c) {
        return Ok(t);
    }
    t.flags = c.i64()?;
    t.version = c.qstring()?;
    t.platform = c.qstring()?;
    t.build = c.i64()?;
    t.date = c.i64()?;
    t.min_build = c.i64()?;
    Ok(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn qs(out: &mut Vec<u8>, s: Option<&str>) {
        match s {
            None => out.extend_from_slice(&u32::MAX.to_le_bytes()),
            Some(s) => {
                let u: Vec<u16> = s.encode_utf16().collect();
                out.extend_from_slice(&((u.len() * 2) as u32).to_le_bytes());
                for c in u {
                    out.extend_from_slice(&c.to_le_bytes());
                }
            }
        }
    }

    
    fn record(n: i64, table: Option<&[(&str, Option<&str>)]>, tail: &[u8]) -> Vec<u8> {
        let mut b = vec![1u8];
        qs(&mut b, Some("Station"));
        b.extend_from_slice(&n.to_le_bytes());
        b.extend(std::iter::repeat_n(1u8, (n * (n - 1) / 2) as usize));
        if let Some(t) = table {
            b.extend_from_slice(&(t.len() as i32).to_le_bytes());
            for (k, v) in t {
                qs(&mut b, Some(k));
                qs(&mut b, *v);
            }
        }
        b.extend_from_slice(tail);
        b
    }

    #[test]
    fn table_after_the_station_matrix() {
         
         
        let tail = [0u8; 16];
        let rec = record(4, Some(&[("SizeBox", Some("150, 200, 150")), ("Box_X", None), ("TestVar", Some("red")), ("TestVar", Some("green"))]), &tail);
        let p = read(&rec).unwrap();
        let want = [("SizeBox", "150, 200, 150"), ("Box_X", ""), ("TestVar", "red"), ("TestVar", "green")];
        assert_eq!(p, want.map(|(k, v)| (k.to_string(), v.to_string())));
    }

    #[test]
    fn no_table_when_the_record_ends_after_the_matrix() {
        assert_eq!(read(&record(3, None, &[])).unwrap(), Vec::<(String, String)>::new());
        assert_eq!(read(&record(0, Some(&[]), &[])).unwrap(), Vec::<(String, String)>::new());
    }

    #[test]
    fn truncated_or_corrupt_tables_are_errors() {
        let rec = record(2, Some(&[("ConvSpeed", Some("25.0"))]), &[]);
        assert!(read(&rec[..rec.len() - 3]).is_err());
        let mut bad = vec![1u8];
        qs(&mut bad, Some("S"));
        bad.extend_from_slice(&(-5i64).to_le_bytes());
        assert!(read(&bad).is_err());
        let mut huge = vec![1u8];
        qs(&mut huge, Some("S"));
        huge.extend_from_slice(&i64::MAX.to_le_bytes());
        assert!(read(&huge).is_err());
    }

    fn station_item(bytes: &[u8]) -> Value {
        let buf = crate::rdkfile::parse(bytes).expect("parse");
        let n = u32::from_le_bytes(buf[0..4].try_into().unwrap()) as usize;
        let v: Value = serde_json::from_slice(&buf[4..4 + n]).unwrap();
        v["items"].as_array().unwrap().iter().find(|i| i["kind"] == "station").cloned().expect("station item")
    }

    fn pairs(st: &Value) -> Vec<(String, String)> {
        assert!(st.get("params_error").is_none(), "{:?}", st.get("params_error"));
        st["params"].as_array().unwrap().iter().map(|p| (p[0].as_str().unwrap().to_string(), p[1].as_str().unwrap().to_string())).collect()
    }

    fn get<'a>(p: &'a [(String, String)], k: &str) -> &'a str {
        p.iter().find(|(n, _)| n == k).map(|(_, v)| v.as_str()).unwrap_or_else(|| panic!("no {k}"))
    }

    
    
    fn mirror(name: &str) -> Option<Vec<u8>> {
        let research = format!("{}/../../research/evidence/slf/rdk/{name}", env!("CARGO_MANIFEST_DIR"));
        crate::testlib::read_library_file("stations", name).or_else(|| std::fs::read(research).ok())
    }

    #[test]
    fn minimal_station_has_an_empty_table() {
        let bytes = std::fs::read(format!("{}/../../research/evidence/slf/minimal.rdk", env!("CARGO_MANIFEST_DIR"))).unwrap();
        assert!(pairs(&station_item(&bytes)).is_empty());
    }

    
    
    
    
    
    #[test]
    fn conveying_with_ur10_parameters() {
        let Some(bytes) = mirror("Conveying-with-UR10.rdk") else { return };
        let p = pairs(&station_item(&bytes));
        let names: Vec<&str> = p.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(names, ["SizeBox", "SizePallet", "ConvSpeed", "SENSOR"]);
        assert_eq!(get(&p, "SizeBox"), "150, 200, 150");
        let size: Vec<f64> = get(&p, "SizeBox").split(',').map(|x| x.replace(' ', "").parse().unwrap()).collect();
        assert_eq!(size, [150.0, 200.0, 150.0]);
        let pallet: Vec<f64> = get(&p, "SizePallet").split(',').map(|x| x.replace(' ', "").parse().unwrap()).collect();
        assert_eq!(pallet, [3.0, 2.0, 3.0]);
        assert_eq!(get(&p, "ConvSpeed").parse::<f64>().unwrap(), 25.0);
        assert_eq!(get(&p, "SENSOR").parse::<f64>().unwrap(), 0.0);
    }

    
    
    
    
    
    #[test]
    fn abb_and_mixed_applications_parameters() {
        if let Some(bytes) = mirror("Conveying-and-Material-Handling-with-ABB.rdk") {
            let p = pairs(&station_item(&bytes));
            assert_eq!(get(&p, "ConvSpeed_MMS").parse::<f64>().unwrap(), 10.0);
            assert_eq!(get(&p, "PartCycles").parse::<f64>().unwrap(), 20.0);
        }
        if let Some(bytes) = mirror("Mixed-Applications-with-RoboDK-RDK-1440-02.rdk") {
            let p = pairs(&station_item(&bytes));
            assert_eq!(p.len(), 29);
            assert_eq!(get(&p, "Box_Num"), "0");
            assert_eq!(get(&p, "Conveyor_Travel"), "400");
            assert_eq!(get(&p, "Box_X"), "");
            let tv: Vec<&str> = p.iter().filter(|(k, _)| k == "TestVar").map(|(_, v)| v.as_str()).collect();
            assert_eq!(tv, ["red", "green"]);
        }
    }

    
    #[test]
    fn every_mirror_station_reads() {
        let Some(dir) = crate::testlib::library_kind_dir("stations") else { return };
        let Ok(entries) = std::fs::read_dir(&dir) else { return };
        let (mut stations, mut with_params) = (0, 0);
        for e in entries.flatten() {
            let path = e.path();
            if !path.extension().is_some_and(|x| x == "rdk" || x == "rdka") {
                continue;
            }
            let st = station_item(&std::fs::read(&path).unwrap());
            stations += 1;
            with_params += (!pairs(&st).is_empty()) as usize;
        }
        assert!(stations > 0 && with_params > 0);
    }
}
